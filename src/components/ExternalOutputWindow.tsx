import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { TVChannel } from '../types/playout';
import { videoGenerator } from '../services/videoGenerator';
import { isImageUrl, isSwfFile, isVideoFile, swfEngine } from '../services/swfEngine';
import { hydrateCompactChannel } from '../utils/stateCompactor';
import { getMediaFromOfflineVault } from '../services/offlineMediaVault';
import {
  getActivePlaybackCycleKey,
  advanceMainPlaybackOnClipEnd,
  computeFastPlaylistSignature,
  needsBackendTranscodeFallback,
  resolveDeckResumeTargetSec,
  shouldKeepExistingVideoFrameInPlace,
} from '../utils/playoutPlaybackEngine';
import { connectDisplayStreamReceiver } from '../utils/masterBroadcastBus';
import {
  createLiveBroadcastCaptureStream,
  stopFallbackCaptureStream,
} from '../utils/liveCaptureFallbackStream';
import { YouTubeBroadcastLayer } from './YouTubeBroadcastLayer';
import {
  isYouTubeLiveStageActive,
  shouldKeepYouTubeLayerMounted,
} from '../utils/youtubeLive';
import { requestFullscreenOnDisplay } from '../utils/displayManager';

interface ExternalOutputWindowProps {
  channel: TVChannel;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  targetDisplayIndex?: number;
  onExitOutputMode?: () => void;
}

export const ExternalOutputWindow: React.FC<ExternalOutputWindowProps> = ({
  channel: initialChannel,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  targetDisplayIndex = 2,
  onExitOutputMode,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rtcVideoRef = useRef<HTMLVideoElement | null>(null);

  const isStandaloneWindow =
    typeof window !== 'undefined' &&
    (window.location.search.includes('output=true') || Boolean(window.opener));

  const hasDirectStudioVideo = Boolean(activeVideoElement) && !isStandaloneWindow;

  const [liveChannel, setLiveChannel] = useState<TVChannel>(initialChannel);
  const [rtcActive, setRtcActive] = useState<boolean>(false);
  const rtcStreamRef = useRef<MediaStream | null>(null);

  // Refs used by the continuous 60fps canvas loop so state sync NEVER restarts rAF
  const liveChannelRef = useRef<TVChannel>(initialChannel);
  const isCleanPlayoutRef = useRef<boolean>(false);
  const directRefs = useRef({
    activeVideoElement,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
  });

  useEffect(() => {
    directRefs.current = {
      activeVideoElement,
      activeOverlayVideoElement,
      activeTopOverlayVideoElement,
      activeLShapeVideoElement,
    };
  }, [
    activeVideoElement,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
  ]);

  // Fallback internal video decoders (used only when WebRTC host bridge is unavailable)
  const internalMainVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalProgVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalAdVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalLiveVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalBottomOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalTopOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalLShapeVideoRef = useRef<HTMLVideoElement | null>(null);

  const liveStreamRef = useRef<MediaStream | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hadEnteredFullscreenRef = useRef<boolean>(false);
  const pendingMainSyncTimeRef = useRef<number | null>(null);
  const pendingProgSyncTimeRef = useRef<number | null>(null);
  const pendingAdSyncTimeRef = useRef<number | null>(null);
  const [hydratedMainUrl, setHydratedMainUrl] = useState<string>('');
  const [hydratedProgUrl, setHydratedProgUrl] = useState<string>('');
  const [hydratedAdUrl, setHydratedAdUrl] = useState<string>('');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const isAudioMutedRef = useRef<boolean>(false);
  const hasAudioGestureRef = useRef<boolean>(false);
  const [audioUnlockTick, setAudioUnlockTick] = useState<number>(0);

  useEffect(() => {
    isAudioMutedRef.current = isAudioMuted;
  }, [isAudioMuted]);

  const [isCleanPlayout, setIsCleanPlayout] = useState<boolean>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('clean');
      if (q === 'true' || q === '1') return true;
      const noOv = new URLSearchParams(window.location.search).get('overlays');
      if (noOv === 'false' || noOv === '0') return true;
      return false;
    } catch {
      return false;
    }
  });

  const [fitMode, setFitMode] = useState<'contain' | 'fill'>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('fit');
      if (q === 'contain') return 'contain';
      return 'fill';
    } catch {
      return 'fill';
    }
  });

  useEffect(() => {
    if (isStandaloneWindow) return;
    setLiveChannel(initialChannel);
    liveChannelRef.current = initialChannel;
  }, [initialChannel, isStandaloneWindow]);

  useEffect(() => {
    liveChannelRef.current = liveChannel;
  }, [liveChannel]);

  useEffect(() => {
    isCleanPlayoutRef.current = isCleanPlayout;
  }, [isCleanPlayout]);

  const isDisplay2AudioDisabled = (ch?: TVChannel) => {
    const a = ch?.transmission?.audio;
    if (!a) return false;
    if (a.muted) return true;
    if (typeof a.display2AudioEnabled === 'boolean') return !a.display2AudioEnabled;
    return a.audioOutputTarget === 'software';
  };

  const restoreDisplayDeckAudio = (v: HTMLVideoElement | null) => {
    if (!v) return;
    const ch = liveChannelRef.current;
    const d2Disabled = isDisplay2AudioDisabled(ch);
    const liveMuted =
      ch.liveInput?.active && !ch.activeEveryNMinAd && !ch.activeProgramId
        ? Boolean(ch.liveInput?.muted)
        : false;
    const shouldMute = isAudioMutedRef.current || d2Disabled || liveMuted;
    v.volume = Math.max(0.05, Math.min(1, ch.transmission?.audio?.masterVolume ?? 0.9));
    if (shouldMute) {
      v.muted = true;
    } else if (hasAudioGestureRef.current || !v.muted) {
      v.muted = false;
    }
  };

  const playWithAudioSync = (v: HTMLVideoElement | null) => {
    if (!v) return;
    const ch = liveChannelRef.current;
    const d2Disabled = isDisplay2AudioDisabled(ch);
    const liveMuted =
      ch.liveInput?.active && !ch.activeEveryNMinAd && !ch.activeProgramId
        ? Boolean(ch.liveInput?.muted)
        : false;
    const shouldMute = isAudioMutedRef.current || d2Disabled || liveMuted;
    const vol = Math.max(0.05, Math.min(1, ch.transmission?.audio?.masterVolume ?? 0.9));

    v.volume = vol;
    v.muted = shouldMute;

    const p = v.paused ? v.play() : Promise.resolve();
    p.catch((err: any) => {
      if (err?.name === 'NotAllowedError') {
        v.muted = true;
        v.play().catch(() => {});
      }
    });
  };

  // Use WebRTC loopback ONLY for live USB Camera / HDMI Capture Card (which Windows locks to 1 process).
  // For all playlist videos, ads, and programs, decode natively via hardware <video> for zero CPU lag/buffer/stick!
  const needsCameraRtcBridge =
    Boolean(liveChannel.liveInput?.active) &&
    liveChannel.liveInput?.sourceType === 'camera' &&
    !liveChannel.activeEveryNMinAd &&
    !liveChannel.activeProgramId;

  useEffect(() => {
    if (!isStandaloneWindow || isCleanPlayout || !needsCameraRtcBridge) {
      setRtcActive(false);
      return;
    }

    const disconnect = connectDisplayStreamReceiver(
      (stream) => {
        rtcStreamRef.current = stream;
        setRtcActive(true);
        const v = rtcVideoRef.current;
        if (v) {
          if (v.srcObject !== stream) {
            v.srcObject = stream;
          }
          playWithAudioSync(v);
        }
      },
      () => {
        rtcStreamRef.current = null;
        setRtcActive(false);
      }
    );

    return () => {
      disconnect();
      rtcStreamRef.current = null;
      setRtcActive(false);
    };
  }, [isStandaloneWindow, isCleanPlayout, needsCameraRtcBridge]);

  // Keep RTC video element attached & mute/volume-synced whenever channel state or mute changes
  useEffect(() => {
    const v = rtcVideoRef.current;
    if (!v || !rtcActive || !rtcStreamRef.current) return;
    if (v.srcObject !== rtcStreamRef.current) {
      v.srcObject = rtcStreamRef.current;
    }
    playWithAudioSync(v);
  }, [
    rtcActive,
    isAudioMuted,
    liveChannel.transmission?.audio?.muted,
    liveChannel.transmission?.audio?.display2AudioEnabled,
    liveChannel.transmission?.audio?.audioOutputTarget,
    liveChannel.transmission?.audio?.masterVolume,
    liveChannel.liveInput?.muted,
  ]);

  const getActiveOutputVideoElement = (): HTMLVideoElement | null => {
    if (hasDirectStudioVideo && directRefs.current.activeVideoElement) {
      return directRefs.current.activeVideoElement;
    }
    const ch = liveChannelRef.current;
    if (ch.activeEveryNMinAd) return internalAdVideoRef.current;
    if (ch.activeProgramId) return internalProgVideoRef.current;
    if (ch.liveInput?.active) return internalLiveVideoRef.current;
    return internalMainVideoRef.current;
  };

  // Silent user interaction listener to satisfy browser autoplay policy & target-display fullscreen without any on-screen prompt
  useEffect(() => {
    const handleGesture = () => {
      hasAudioGestureRef.current = true;
      const containerEl = containerRef.current;
      if (containerEl && !document.fullscreenElement) {
        requestFullscreenOnDisplay(containerEl, targetDisplayIndex).catch(() => {});
      }
      setAudioUnlockTick((prev) => prev + 1);
      if (rtcActive && rtcVideoRef.current) {
        playWithAudioSync(rtcVideoRef.current);
        return;
      }
      const v = getActiveOutputVideoElement();
      if (v) {
        const shouldMute =
          isAudioMutedRef.current || isDisplay2AudioDisabled(liveChannelRef.current);
        v.muted = shouldMute;
        v.volume = Math.max(
          0.05,
          Math.min(1, liveChannelRef.current.transmission?.audio?.masterVolume ?? 0.9)
        );
        if (v.paused && liveChannelRef.current.status === 'PLAYING') {
          v.play().catch(() => {});
        }
      }
    };
    window.addEventListener('click', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('touchstart', handleGesture, { passive: true });
    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('keydown', handleGesture);
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, [rtcActive, targetDisplayIndex]);

  const lastBcSyncAtRef = useRef<number>(0);

  // Resolve any cross-profile blob: URLs & compact masks/logos when running standalone
  const normalizeStandaloneChannelMedia = (rawCh: TVChannel): TVChannel => {
    if (!rawCh) return rawCh;
    const ch: TVChannel = hydrateCompactChannel(rawCh);
    const fixClipUrl = (cl: any) => {
      if (!cl) return cl;
      const rawUrl = String(cl.url || cl.videoUrl || '');
      const nameHint = String(cl.fileName || cl.title || cl.label || '').trim();
      if (cl.serverUrl && !String(cl.serverUrl).startsWith('blob:')) {
        if (rawUrl.startsWith('blob:') || !rawUrl || rawUrl.startsWith('/api/media/by-name/')) {
          return { ...cl, url: cl.serverUrl, videoUrl: cl.serverUrl };
        }
      }
      if (rawUrl.startsWith('blob:') && nameHint) {
        const byName = `/api/media/by-name/${encodeURIComponent(nameHint)}`;
        return { ...cl, url: byName, videoUrl: byName, serverUrl: cl.serverUrl || byName };
      }
      return cl;
    };
    const fixLogo = (lg: any) => {
      if (!lg) return lg;
      const next = { ...lg };
      const nameHint = String(next.fileName || next.label || '').trim();
      if (next.serverUrl && !String(next.serverUrl).startsWith('blob:')) {
        if (!next.url || String(next.url).startsWith('blob:')) {
          next.url = next.serverUrl;
        }
      } else if (String(next.url || '').startsWith('blob:') && nameHint) {
        next.url = `/api/media/by-name/${encodeURIComponent(nameHint)}`;
        next.serverUrl = next.url;
      }
      if (Array.isArray(next.playlist)) {
        next.playlist = next.playlist.map(fixClipUrl);
      }
      return next;
    };
    const g: any = ch.graphics ? { ...ch.graphics } : {};
    g.channelLogo = fixLogo(g.channelLogo);
    g.sponsorLogo1 = fixLogo(g.sponsorLogo1);
    g.sponsorLogo2 = fixLogo(g.sponsorLogo2);
    g.sponsorLogo3 = fixLogo(g.sponsorLogo3);
    g.sponsorLogo4 = fixLogo(g.sponsorLogo4);

    return {
      ...ch,
      playlist: (ch.playlist || []).map(fixClipUrl),
      scheduledPrograms: (ch.scheduledPrograms || []).map((p) => ({
        ...p,
        playlist: (p.playlist || []).map(fixClipUrl),
      })),
      everyNMinAds: (ch.everyNMinAds || []).map(fixClipUrl),
      activeEveryNMinAd: ch.activeEveryNMinAd ? fixClipUrl(ch.activeEveryNMinAd) : null,
      bottomOverlay: ch.bottomOverlay
        ? { ...ch.bottomOverlay, playlist: (ch.bottomOverlay.playlist || []).map(fixClipUrl) }
        : ch.bottomOverlay,
      topOverlay: ch.topOverlay
        ? { ...ch.topOverlay, playlist: (ch.topOverlay.playlist || []).map(fixClipUrl) }
        : ch.topOverlay,
      lShape: ch.lShape
        ? { ...ch.lShape, playlist: (ch.lShape.playlist || []).map(fixClipUrl) }
        : ch.lShape,
      graphics: g,
    };
  };

  const lastSyncSeqRef = useRef<number>(0);
  const lastSyncUpdatedAtMsRef = useRef<number>(0);
  const lastSyncReceivedAtRef = useRef<number>(0);
  const lastSyncSeekAtRef = useRef<number>(0);
  const lastDisplayVisualSigRef = useRef<string>('');

  const buildDisplayVisualSignature = (ch: TVChannel, licensedNow: boolean): string => {
    const stripLogo = (lg: any) => (lg && typeof lg === 'object' ? { ...lg, currentTime: 0 } : lg);
    const g: any = ch.graphics || {};
    return JSON.stringify({
      st: ch.status,
      ci: ch.currentClipIndex,
      lc: ch.loopCycle,
      lm: ch.loopMode,
      pl: computeFastPlaylistSignature(ch.playlist, ch.currentClipIndex),
      sp: (ch.scheduledPrograms || []).map(
        (p) =>
          `${p.id}:${p.enabled}:${p.status}:${p.completed}:${p.startDate}:${p.startTime}:${p.overlayMode}:${computeFastPlaylistSignature(p.playlist, 0)}`
      ),
      api: ch.activeProgramId,
      apci: ch.activeProgramClipIndex,
      aa: ch.activeEveryNMinAd?.id || null,
      li: ch.liveInput,
      bo: ch.bottomOverlay ? { ...ch.bottomOverlay, currentTime: 0 } : null,
      to: ch.topOverlay ? { ...ch.topOverlay, currentTime: 0 } : null,
      ls: ch.lShape ? { ...ch.lShape, currentTime: 0, periodicCounter: 0 } : null,
      gr: {
        ...g,
        channelLogo: stripLogo(g.channelLogo),
        sponsorLogo1: stripLogo(g.sponsorLogo1),
        sponsorLogo2: stripLogo(g.sponsorLogo2),
        sponsorLogo3: stripLogo(g.sponsorLogo3),
        sponsorLogo4: stripLogo(g.sponsorLogo4),
        demoWatermarkEnabled: !licensedNow,
      },
      tr: ch.transmission,
    });
  };

  const applyAuthoritativeSync = (
    incomingRaw: TVChannel,
    data: {
      time?: number;
      updatedAtMs?: number;
      isLicensed?: boolean;
      licenseRecord?: any;
      syncSeq?: number;
      cgSync?: any;
    }
  ) => {
    if (data.cgSync) {
      videoGenerator.setAuthoritativeCgSync(data.cgSync);
    }
    const nowMs = Date.now();
    if (
      typeof data.syncSeq === 'number' &&
      data.syncSeq > 0 &&
      data.syncSeq === lastSyncSeqRef.current &&
      typeof data.updatedAtMs === 'number' &&
      data.updatedAtMs === lastSyncUpdatedAtMsRef.current
    ) {
      return;
    }
    if (
      typeof data.syncSeq === 'number' &&
      data.syncSeq > 2 &&
      lastSyncSeqRef.current > 0 &&
      data.syncSeq < lastSyncSeqRef.current &&
      nowMs - lastSyncReceivedAtRef.current < 4000 &&
      lastSyncSeqRef.current - data.syncSeq < 50
    ) {
      return;
    }
    lastSyncReceivedAtRef.current = nowMs;
    if (typeof data.syncSeq === 'number' && data.syncSeq > 0) {
      lastSyncSeqRef.current = data.syncSeq;
    }
    if (typeof data.updatedAtMs === 'number') {
      lastSyncUpdatedAtMsRef.current = data.updatedAtMs;
    }

    const incoming = isStandaloneWindow
      ? normalizeStandaloneChannelMedia(incomingRaw)
      : hydrateCompactChannel(incomingRaw);

    const nextActiveAd = incoming.activeEveryNMinAd ?? null;
    const nextActiveProgId = incoming.activeProgramId ?? null;
    const nextLiveInput = incoming.liveInput ?? null;
    const isMainActive = !nextActiveAd && !nextActiveProgId && !nextLiveInput?.active;
    const isProgActive = !nextActiveAd && Boolean(nextActiveProgId) && !nextLiveInput?.active;
    const isAdActive = Boolean(nextActiveAd);

    const licensedNow =
      typeof data.isLicensed === 'boolean'
        ? data.isLicensed
        : Boolean(incoming.graphics && (incoming.graphics as any).demoWatermarkEnabled === false);

    const nextVisualSig = buildDisplayVisualSignature(incoming, licensedNow);
    if (nextVisualSig === lastDisplayVisualSigRef.current) {
      // Pure time heartbeat: mutate time fields on ref in-place for the canvas loop without triggering React re-renders
      const cur = liveChannelRef.current;
      cur.currentTime =
        isMainActive && typeof data.time === 'number'
          ? data.time
          : incoming.currentTime ?? cur.currentTime ?? 0;
      cur.activeProgramTime =
        isProgActive && typeof data.time === 'number'
          ? data.time
          : incoming.activeProgramTime ?? 0;
      cur.everyNMinTime =
        isAdActive && typeof data.time === 'number'
          ? data.time
          : incoming.everyNMinTime ?? 0;
      if (cur.bottomOverlay && incoming.bottomOverlay) {
        cur.bottomOverlay.currentTime = incoming.bottomOverlay.currentTime;
      }
      if (cur.topOverlay && incoming.topOverlay) {
        cur.topOverlay.currentTime = incoming.topOverlay.currentTime;
      }
      if (cur.lShape && incoming.lShape) {
        cur.lShape.currentTime = incoming.lShape.currentTime;
        cur.lShape.periodicCounter = incoming.lShape.periodicCounter;
      }
    } else {
      lastDisplayVisualSigRef.current = nextVisualSig;
      setLiveChannel((prev) => {
        const updated: TVChannel = {
          ...prev,
          ...incoming,
          status: incoming.status || prev.status || 'STOPPED',
          currentClipIndex: incoming.currentClipIndex ?? 0,
          loopCycle: incoming.loopCycle ?? prev.loopCycle ?? 0,
          activeProgramId: nextActiveProgId,
          activeProgramClipIndex: incoming.activeProgramClipIndex ?? 0,
          activeEveryNMinAd: nextActiveAd,
          everyNMinQueue: Array.isArray(incoming.everyNMinQueue) ? incoming.everyNMinQueue : [],
          liveInput: nextLiveInput,
          savedMainPlaybackState: incoming.savedMainPlaybackState ?? null,
          savedProgramPlaybackState: incoming.savedProgramPlaybackState ?? null,
          playbackContext:
            incoming.playbackContext ??
            (nextActiveAd
              ? 'everyNMinAd'
              : nextActiveProgId
              ? 'program'
              : nextLiveInput?.active
              ? 'live'
              : 'main'),
          currentTime:
            isMainActive && typeof data.time === 'number'
              ? data.time
              : incoming.currentTime ?? prev.currentTime ?? 0,
          activeProgramTime:
            isProgActive && typeof data.time === 'number'
              ? data.time
              : incoming.activeProgramTime ?? 0,
          everyNMinTime:
            isAdActive && typeof data.time === 'number'
              ? data.time
              : incoming.everyNMinTime ?? 0,
          graphics: {
            ...(incoming.graphics || prev.graphics),
            demoWatermarkEnabled: !licensedNow,
            ...(data.licenseRecord ? { licenseRecord: data.licenseRecord } : {}),
          } as any,
        };
        liveChannelRef.current = updated;
        return updated;
      });
    }

    if (typeof data.time === 'number' && data.time > 0.05 && !rtcStreamRef.current) {
      const chNow = liveChannelRef.current;
      const v = getActiveOutputVideoElement();
      const targetRef = chNow.activeEveryNMinAd
        ? pendingAdSyncTimeRef
        : chNow.activeProgramId
        ? pendingProgSyncTimeRef
        : pendingMainSyncTimeRef;
      const ageSec =
        data.updatedAtMs && chNow.status === 'PLAYING'
          ? Math.max(0, Math.min(2.5, (Date.now() - data.updatedAtMs) / 1000))
          : 0;
      const targetPlayhead = data.time + ageSec;
      const nearEnd = v && Number.isFinite(v.duration) && v.duration > 3 && v.currentTime >= v.duration - 2.0;

      if (v && !v.seeking && v.readyState >= 2) {
        if (
          !nearEnd &&
          (v.readyState >= 3 || v.paused) &&
          Date.now() - lastSyncSeekAtRef.current >= 4000 &&
          Math.abs(v.currentTime - targetPlayhead) > 3.5
        ) {
          lastSyncSeekAtRef.current = Date.now();
          try {
            v.currentTime = targetPlayhead;
          } catch {}
        }
      } else {
        targetRef.current = targetPlayhead;
      }
    }
  };

  // Seed immediately from localStorage snapshot when running in standalone window
  useEffect(() => {
    if (!isStandaloneWindow) return;
    try {
      const rawSnap = localStorage.getItem('ashoka_live_sync_snapshot_v1');
      if (rawSnap) {
        const parsed = JSON.parse(rawSnap);
        if (parsed && parsed.channel) {
          applyAuthoritativeSync(parsed.channel, {
            time: parsed.time,
            updatedAtMs: parsed.updatedAtMs,
            isLicensed: parsed.isLicensed,
            licenseRecord: parsed.licenseRecord,
            syncSeq: parsed.syncSeq,
            cgSync: parsed.cgSync,
          });
        }
      }
    } catch {}
  }, [isStandaloneWindow]);

  // BroadcastChannel Listener for instant multi-window synchronization (fallback & mute/license sync)
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const bc = new BroadcastChannel('ashoka_playout_broadcast_sync');

    try {
      bc.postMessage({ type: 'REQUEST_INITIAL_STATE' });
    } catch {}

    bc.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      lastBcSyncAtRef.current = Date.now();

      if (data.type === 'SYNC_CHANNEL' && data.channel) {
        applyAuthoritativeSync(data.channel, {
          time: data.time,
          updatedAtMs: data.updatedAtMs,
          isLicensed: data.isLicensed,
          licenseRecord: data.licenseRecord,
          syncSeq: data.syncSeq,
          cgSync: data.cgSync,
        });
      } else if (data.type === 'SYNC_TIME' && typeof data.time === 'number') {
        if (data.cgSync) {
          videoGenerator.setAuthoritativeCgSync(data.cgSync);
        }
        if (!rtcStreamRef.current) {
          const v = getActiveOutputVideoElement();
          const chNow = liveChannelRef.current;
          const targetRef = chNow.activeEveryNMinAd
            ? pendingAdSyncTimeRef
            : chNow.activeProgramId
            ? pendingProgSyncTimeRef
            : pendingMainSyncTimeRef;
          const ageSec =
            data.updatedAtMs && chNow.status === 'PLAYING'
              ? Math.max(0, Math.min(2.5, (Date.now() - data.updatedAtMs) / 1000))
              : 0;
          const targetPlayhead = data.time + ageSec;
          const nearEnd = v && Number.isFinite(v.duration) && v.duration > 3 && v.currentTime >= v.duration - 2.0;

          if (v && !v.seeking && v.readyState >= 2 && data.time > 0.05) {
            if (
              !nearEnd &&
              (v.readyState >= 3 || v.paused) &&
              Date.now() - lastSyncSeekAtRef.current >= 4000 &&
              Math.abs(v.currentTime - targetPlayhead) > 3.5
            ) {
              lastSyncSeekAtRef.current = Date.now();
              try {
                v.currentTime = targetPlayhead;
              } catch {}
            }
          } else if (data.time > 0.05) {
            targetRef.current = targetPlayhead;
          }
        }
      } else if (data.type === 'TOGGLE_MUTE' && typeof data.muted === 'boolean') {
        setIsAudioMuted(data.muted);
        const effectiveMute = data.muted || isDisplay2AudioDisabled(liveChannelRef.current);
        if (rtcVideoRef.current) rtcVideoRef.current.muted = effectiveMute;
        const v = getActiveOutputVideoElement();
        if (v) v.muted = effectiveMute;
      } else if (data.type === 'TOGGLE_CLEAN_FEED' && typeof data.isClean === 'boolean') {
        setIsCleanPlayout(data.isClean);
      } else if (data.type === 'CLIP_ENDED' && !isStandaloneWindow) {
        const randSeed = Math.random();
        setLiveChannel((prev) => {
          const next = advanceMainPlaybackOnClipEnd(prev, data.clipKey, randSeed);
          liveChannelRef.current = next;
          return next;
        });
      } else if (data.type === 'LICENSE_UPDATED') {
        setLiveChannel((prev) => ({
          ...prev,
          graphics: {
            ...prev.graphics,
            demoWatermarkEnabled: false,
            licenseRecord: data.licenseRecord,
          } as any,
        }));
      }
    };

    return () => {
      bc.close();
    };
  }, [isStandaloneWindow]);

  // HTTP /api/playout/live-sync Polling Bridge (guarantees 2nd Display matches PGM OUT across any process boundary)
  useEffect(() => {
    if (!isStandaloneWindow) return;
    let cancelled = false;
    let inFlight = false;

    const pullLiveSync = async () => {
      if (cancelled || inFlight) return;
      // If BroadcastChannel delivered a frame < 1.0s ago on the same profile, skip redundant poll
      if (Date.now() - lastBcSyncAtRef.current < 1000) return;
      inFlight = true;
      try {
        const res = await fetch('/api/playout/live-sync', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!data || cancelled) return;

        const incomingCh = data.channel || (Array.isArray(data.channels) ? data.channels[0] : null);
        if (incomingCh) {
          applyAuthoritativeSync(incomingCh, {
            time: data.time,
            updatedAtMs: data.updatedAtMs,
            isLicensed: data.isLicensed,
            licenseRecord: data.licenseRecord,
            syncSeq: data.syncSeq,
            cgSync: data.cgSync,
          });
        }
      } catch {
        // Ignore transient network hiccup
      } finally {
        inFlight = false;
      }
    };

    pullLiveSync();
    const pollTimer = setInterval(pullLiveSync, 250);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [isStandaloneWindow]);

  const activeAd = liveChannel.activeEveryNMinAd;
  const activeProg = liveChannel.activeProgramId
    ? (liveChannel.scheduledPrograms || []).find((p) => p.id === liveChannel.activeProgramId)
    : undefined;
  const activeMainClip = liveChannel.playlist[liveChannel.currentClipIndex];
  const activeProgClip = activeProg?.playlist[liveChannel.activeProgramClipIndex || 0];
  const activeClip = activeAd ? activeAd : activeProg ? activeProgClip : activeMainClip;

  const handleNotifyClipEnded = (endedKey?: string) => {
    // In standalone Display 2 window, PGM OUT (Window 1) is the sole playback authority.
    // We only notify Window 1 via BroadcastChannel when not running in-window, without locally diverging.
    if (isStandaloneWindow) return;
    const cycleKey = endedKey || getActivePlaybackCycleKey(liveChannelRef.current);
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('ashoka_playout_broadcast_sync');
        bc.postMessage({
          type: 'CLIP_ENDED',
          clipKey: cycleKey,
        });
        bc.close();
      }
    } catch {}
    setLiveChannel((prev) => advanceMainPlaybackOnClipEnd(prev, cycleKey, Math.random()));
  };

  // Keyboard Shortcuts: ESC = exit; F = Fullscreen; M = Mute; C = Clean Feed; S = Scale 16:9 / Fill
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        if (onExitOutputMode) {
          onExitOutputMode();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        const el = containerRef.current;
        if (!document.fullscreenElement && el) {
          requestFullscreenOnDisplay(el, targetDisplayIndex).catch(() => {});
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } else if (e.key === 'm' || e.key === 'M') {
        setIsAudioMuted((prev) => {
          const next = !prev;
          if (rtcVideoRef.current) rtcVideoRef.current.muted = next;
          const v = getActiveOutputVideoElement();
          if (v) v.muted = next;
          return next;
        });
      } else if (e.key === 'c' || e.key === 'C') {
        setIsCleanPlayout((prev) => !prev);
      } else if (e.key === 's' || e.key === 'S') {
        setFitMode((prev) => (prev === 'fill' ? 'contain' : 'fill'));
      }
    };

    const handleFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      if (isFs) {
        hadEnteredFullscreenRef.current = true;
      } else if (hadEnteredFullscreenRef.current) {
        hadEnteredFullscreenRef.current = false;
        if (onExitOutputMode && window.location.search.indexOf('output=true') === -1) {
          onExitOutputMode();
        }
      }
    };

    const handleParentFullscreenMsg = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === 'ASHOKA_TRY_FULLSCREEN' &&
        containerRef.current &&
        !document.fullscreenElement
      ) {
        requestFullscreenOnDisplay(containerRef.current, targetDisplayIndex).catch(() => {});
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('message', handleParentFullscreenMsg);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const el = containerRef.current;
    if (el && !document.fullscreenElement) {
      requestFullscreenOnDisplay(el, targetDisplayIndex)
        .then((entered) => {
          if (entered) hadEnteredFullscreenRef.current = true;
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('message', handleParentFullscreenMsg);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [onExitOutputMode, targetDisplayIndex]);

  const useStandaloneFallbackDecoders = !hasDirectStudioVideo && !rtcActive;

  const overlayPlaylistSig = [
    ...(liveChannel.bottomOverlay?.playlist || []).map((i) => `${i.id}:${(i as any).serverUrl || i.url || ''}:${i.enabled !== false}`),
    '|',
    ...(liveChannel.topOverlay?.playlist || []).map((i) => `${i.id}:${(i as any).serverUrl || i.url || ''}:${i.enabled !== false}`),
    '|',
    ...(liveChannel.lShape?.playlist || []).map((i) => `${i.id}:${(i as any).serverUrl || i.url || ''}:${i.enabled !== false}`),
  ].join(',');

  // Preload SWF headers & warm ONLY the active on-air SWF players (prevents spawning redundant idle WebGL Ruffle instances on 2nd Display)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const rawUrl = activeClip?.videoUrl || activeClip?.url || '';
    if (activeClip && isSwfFile(activeClip.fileName || activeClip.title || rawUrl) && rawUrl) {
      swfEngine.warmSwfPlayer(rawUrl, activeClip.title || activeClip.fileName, 1920, 1080, 'fullscreen');
    }

    const warmActiveAndPreloadNextBanner = (
      banner: { enabled?: boolean; currentIndex?: number; playlist?: any[] } | undefined,
      w: number,
      h: number,
      role: 'banner' | 'lshape'
    ) => {
      if (!banner?.enabled || !Array.isArray(banner.playlist)) return;
      const enabled = banner.playlist.filter((it) => it && it.enabled !== false);
      if (enabled.length === 0) return;
      const curRaw = banner.playlist[Math.max(0, Math.min(banner.playlist.length - 1, banner.currentIndex || 0))];
      const activeItem = curRaw && curRaw.enabled !== false ? curRaw : enabled[0];
      if (activeItem) {
        const u = activeItem.serverUrl || activeItem.url || '';
        if (u && (activeItem.mediaType === 'swf' || isSwfFile(activeItem.fileName || activeItem.title || u))) {
          swfEngine.warmSwfPlayer(u, activeItem.title || activeItem.fileName, w, h, role);
        }
      }
      if (enabled.length > 1) {
        const activePos = enabled.findIndex((it) => it.id === activeItem?.id);
        const nextItem = enabled[(activePos >= 0 ? activePos + 1 : 0) % enabled.length];
        const nu = nextItem?.serverUrl || nextItem?.url || '';
        if (nu && (nextItem.mediaType === 'swf' || isSwfFile(nextItem.fileName || nextItem.title || nu))) {
          swfEngine.preloadSwf(nu);
        }
      }
    };

    const botW = Math.max(64, Math.min(1920, liveChannel.bottomOverlay?.width || 1920));
    const botH = Math.max(30, Math.min(1080, liveChannel.bottomOverlay?.height || 200));
    const topW = Math.max(64, Math.min(1920, liveChannel.topOverlay?.width || 1920));
    const topH = Math.max(30, Math.min(1080, liveChannel.topOverlay?.height || 90));
    warmActiveAndPreloadNextBanner(liveChannel.bottomOverlay, botW, botH, 'banner');
    warmActiveAndPreloadNextBanner(liveChannel.topOverlay, topW, topH, 'banner');
    warmActiveAndPreloadNextBanner(liveChannel.lShape, 1920, 1080, 'lshape');

    const gAny: any = liveChannel.graphics || {};
    for (const lg of [gAny.channelLogo, gAny.sponsorLogo1, gAny.sponsorLogo2, gAny.sponsorLogo3, gAny.sponsorLogo4]) {
      if (!lg || !lg.enabled) continue;
      const lw = Math.max(60, Math.min(800, lg.customWidth || lg.size || 140));
      const lh = Math.max(60, Math.min(800, lg.customHeight || lg.size || 140));
      const items = Array.isArray(lg.playlist) ? lg.playlist.filter((li: any) => li && li.enabled !== false) : [];
      if (items.length > 0) {
        const curLogoIdx = Math.max(0, Math.min(items.length - 1, lg.currentIndex || 0));
        const activeLogoItem = items[curLogoIdx];
        const lu = activeLogoItem?.serverUrl || activeLogoItem?.url || '';
        if (lu && isSwfFile(activeLogoItem.fileName || activeLogoItem.title || lu)) {
          swfEngine.warmSwfPlayer(lu, activeLogoItem.title || activeLogoItem.fileName, lw, lh, 'logo');
        }
      } else if (lg.url && isSwfFile(lg.fileName || lg.label || lg.url)) {
        swfEngine.warmSwfPlayer(lg.url, lg.label || lg.fileName, lw, lh, 'logo');
      }
    }
  }, [
    useStandaloneFallbackDecoders,
    activeClip?.id,
    activeClip?.fileName,
    activeClip?.title,
    liveChannel.bottomOverlay?.enabled,
    liveChannel.bottomOverlay?.currentIndex,
    liveChannel.topOverlay?.enabled,
    liveChannel.topOverlay?.currentIndex,
    liveChannel.lShape?.enabled,
    liveChannel.lShape?.currentIndex,
    overlayPlaylistSig,
    liveChannel.graphics,
  ]);

  const resolveStandaloneMediaUrl = async (clip: any): Promise<string> => {
    if (!clip) return '';
    const srvUrl = String(clip.serverUrl || '').trim();
    const rawUrl = String(clip.videoUrl || clip.url || '').trim();
    const nameHint = String(clip.fileName || clip.title || '').trim();
    const maybeVlc = (candidate: string): string => {
      if (
        candidate &&
        !candidate.startsWith('blob:') &&
        !candidate.includes('/api/media/vlc-stream') &&
        !candidate.includes('_vlc.mp4') &&
        needsBackendTranscodeFallback(nameHint || candidate)
      ) {
        return `/api/media/vlc-stream?url=${encodeURIComponent(candidate)}`;
      }
      return candidate;
    };
    if (srvUrl && !srvUrl.startsWith('blob:')) {
      return maybeVlc(srvUrl);
    }
    if (rawUrl && !rawUrl.startsWith('blob:')) {
      return maybeVlc(rawUrl);
    }
    if (clip.vaultId || clip.fileName) {
      const rec = await getMediaFromOfflineVault(clip.vaultId, clip.fileName);
      if (rec?.serverUrl && !rec.serverUrl.startsWith('blob:') && needsBackendTranscodeFallback(nameHint || rec.serverUrl)) {
        return maybeVlc(rec.serverUrl);
      }
      if (rec?.blobUrl) return rec.blobUrl;
      if (rec?.serverUrl) return maybeVlc(rec.serverUrl);
    }
    if (nameHint) {
      return maybeVlc(`/api/media/by-name/${encodeURIComponent(nameHint)}`);
    }
    return rawUrl;
  };

  // Hydrate Main Playlist Media from Offline Vault or Backend Server (cross-profile safe)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    let cancelled = false;
    if (!activeMainClip) {
      setHydratedMainUrl('');
      return;
    }
    const rawUrl = activeMainClip.videoUrl || activeMainClip.url || '';
    if (isSwfFile(activeMainClip.fileName || activeMainClip.title || rawUrl)) {
      const swfSrv = (activeMainClip as any).serverUrl;
      setHydratedMainUrl(swfSrv && !swfSrv.startsWith('blob:') ? swfSrv : rawUrl);
      return;
    }

    resolveStandaloneMediaUrl(activeMainClip).then((resolved) => {
      if (!cancelled) setHydratedMainUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [
    useStandaloneFallbackDecoders,
    activeMainClip?.id,
    activeMainClip?.vaultId,
    activeMainClip?.fileName,
    activeMainClip?.url,
    (activeMainClip as any)?.serverUrl,
  ]);

  // Hydrate Scheduled Program Media from Offline Vault or Backend Server (cross-profile safe)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    let cancelled = false;
    if (!activeProgClip) {
      setHydratedProgUrl('');
      return;
    }
    resolveStandaloneMediaUrl(activeProgClip).then((resolved) => {
      if (!cancelled) setHydratedProgUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [
    useStandaloneFallbackDecoders,
    activeProgClip?.id,
    activeProgClip?.vaultId,
    activeProgClip?.fileName,
    activeProgClip?.url,
    (activeProgClip as any)?.serverUrl,
  ]);

  // Hydrate Commercial Ad Media from Offline Vault or Backend Server (cross-profile safe)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    let cancelled = false;
    if (!activeAd) {
      setHydratedAdUrl('');
      return;
    }
    resolveStandaloneMediaUrl(activeAd).then((resolved) => {
      if (!cancelled) setHydratedAdUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [
    useStandaloneFallbackDecoders,
    activeAd?.id,
    activeAd?.vaultId,
    activeAd?.fileName,
    activeAd?.url,
    (activeAd as any)?.serverUrl,
  ]);

  // DECK 1 (Fallback): Main Playlist Decoder (pre-loads paused clips so PLAY starts instantaneously)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const v = internalMainVideoRef.current;
    if (!v) return;

    if (activeAd || activeProg || liveChannel.liveInput?.active) {
      if (!v.paused) v.pause();
      v.muted = true;
      return;
    }

    if (!activeMainClip || activeMainClip.enabled === false) {
      v.pause();
      return;
    }

    const clipUrl = hydratedMainUrl || activeMainClip.videoUrl || activeMainClip.url || '';
    const mainHint = activeMainClip.fileName || activeMainClip.title || clipUrl;
    if (!clipUrl || isSwfFile(mainHint) || isImageUrl(clipUrl, mainHint)) {
      v.pause();
      return;
    }

    const clipBaseId = `main:${activeMainClip.id}:${liveChannel.currentClipIndex}`;
    const clipKey = `${clipBaseId}:cycle:${liveChannel.loopCycle || 0}`;
    const prevLoaded = v.dataset.loadedUrl || '';
    const isSameClipInstance = v.dataset.clipBaseId === clipBaseId;
    const isAlreadyPlayingHealthy =
      isSameClipInstance &&
      !v.error &&
      v.readyState >= 2 &&
      v.videoWidth > 0 &&
      !v.paused &&
      !v.ended;
    const isUrlUpgrade =
      !isAlreadyPlayingHealthy &&
      prevLoaded !== clipUrl &&
      (!clipUrl.startsWith('blob:') || Boolean(v.error) || v.readyState === 0);

    if (v.dataset.clipKey !== clipKey || isUrlUpgrade) {
      const preserveSec =
        isSameClipInstance && isUrlUpgrade && v.currentTime > 0 ? v.currentTime : null;
      const resumeTarget = resolveDeckResumeTargetSec({
        preserveCurrentSec: preserveSec,
        pendingResumeSeekSec: pendingMainSyncTimeRef.current,
        channelTimeSec: liveChannel.currentTime,
      });
      pendingMainSyncTimeRef.current = null;

      v.dataset.clipKey = clipKey;
      v.dataset.clipBaseId = clipBaseId;
      v.dataset.loadedUrl = clipUrl;

      const alreadyHasSameValidSrc =
        isSameClipInstance && !isUrlUpgrade && !v.error && v.readyState >= 1 && Boolean(v.src);

      if (alreadyHasSameValidSrc) {
        if (
          !shouldKeepExistingVideoFrameInPlace({
            alreadyHasSameValidSrc,
            currentVideoSec: v.currentTime,
            resumeTargetSec: resumeTarget,
            isVideoEnded: v.ended,
          })
        ) {
          try {
            v.currentTime = resumeTarget;
          } catch {}
        }
      } else {
        delete v.dataset.triedServerFallback;
        delete v.dataset.triedVlcStream;
        delete v.dataset.triedVault;
        delete v.dataset.retryCount;
        if (resumeTarget > 0.05) {
          pendingMainSyncTimeRef.current = resumeTarget;
        }
        v.src = clipUrl;
        v.load();
      }
    }

    if (liveChannel.status === 'PLAYING') {
      playWithAudioSync(v);
    } else if (!v.paused) {
      v.pause();
    }
  }, [
    useStandaloneFallbackDecoders,
    hydratedMainUrl,
    activeMainClip?.id,
    activeMainClip?.url,
    activeMainClip?.enabled,
    liveChannel.playlist.length,
    liveChannel.currentClipIndex,
    liveChannel.loopCycle,
    liveChannel.status,
    activeAd?.id,
    liveChannel.activeProgramId,
    activeProg?.id,
    liveChannel.liveInput?.active,
    isAudioMuted,
    liveChannel.transmission?.audio?.muted,
    liveChannel.transmission?.audio?.display2AudioEnabled,
    liveChannel.transmission?.audio?.audioOutputTarget,
    liveChannel.transmission?.audio?.masterVolume,
  ]);

  // DECK 2 (Fallback): Scheduled Program Playlist Decoder
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const v = internalProgVideoRef.current;
    if (!v) return;

    if (!activeProg || activeProg.enabled === false || !activeProgClip || activeProgClip.enabled === false) {
      v.pause();
      return;
    }

    if (activeAd || liveChannel.liveInput?.active) {
      if (!v.paused) v.pause();
      v.muted = true;
      return;
    }

    const clipUrl = hydratedProgUrl || activeProgClip.videoUrl || activeProgClip.url || '';
    const progHint = activeProgClip.fileName || activeProgClip.title || clipUrl;
    if (!clipUrl || isSwfFile(progHint) || isImageUrl(clipUrl, progHint)) {
      v.pause();
      return;
    }

    const clipBaseId = `prog:${activeProg.id}:${liveChannel.activeProgramClipIndex || 0}`;
    const clipKey = `${clipBaseId}:cycle:${liveChannel.loopCycle || 0}`;
    const prevLoaded = v.dataset.loadedUrl || '';
    const isSameClipInstance = v.dataset.clipBaseId === clipBaseId;
    const isAlreadyPlayingHealthy =
      isSameClipInstance &&
      !v.error &&
      v.readyState >= 2 &&
      v.videoWidth > 0 &&
      !v.paused &&
      !v.ended;
    const isUrlUpgrade =
      !isAlreadyPlayingHealthy &&
      prevLoaded !== clipUrl &&
      (!clipUrl.startsWith('blob:') || Boolean(v.error) || v.readyState === 0);

    if (v.dataset.clipKey !== clipKey || isUrlUpgrade) {
      const preserveSec =
        isSameClipInstance && isUrlUpgrade && v.currentTime > 0 ? v.currentTime : null;
      const resumeTarget = resolveDeckResumeTargetSec({
        preserveCurrentSec: preserveSec,
        pendingResumeSeekSec: pendingProgSyncTimeRef.current,
        channelTimeSec: liveChannel.activeProgramTime,
      });
      pendingProgSyncTimeRef.current = null;

      v.dataset.clipKey = clipKey;
      v.dataset.clipBaseId = clipBaseId;
      v.dataset.loadedUrl = clipUrl;

      const alreadyHasSameValidSrc =
        isSameClipInstance && !isUrlUpgrade && !v.error && v.readyState >= 1 && Boolean(v.src);

      if (alreadyHasSameValidSrc) {
        if (
          !shouldKeepExistingVideoFrameInPlace({
            alreadyHasSameValidSrc,
            currentVideoSec: v.currentTime,
            resumeTargetSec: resumeTarget,
            isVideoEnded: v.ended,
          })
        ) {
          try {
            v.currentTime = resumeTarget;
          } catch {}
        }
      } else {
        delete v.dataset.triedServerFallback;
        delete v.dataset.triedVlcStream;
        delete v.dataset.triedVault;
        delete v.dataset.retryCount;
        if (resumeTarget > 0.05) {
          pendingProgSyncTimeRef.current = resumeTarget;
        }
        v.src = clipUrl;
        v.load();
      }
    }

    if (liveChannel.status === 'PLAYING') {
      playWithAudioSync(v);
    } else if (!v.paused) {
      v.pause();
    }
  }, [
    useStandaloneFallbackDecoders,
    hydratedProgUrl,
    liveChannel.activeProgramId,
    liveChannel.scheduledPrograms?.length,
    activeProg?.id,
    activeProg?.enabled,
    activeProgClip?.id,
    activeProgClip?.url,
    activeProgClip?.enabled,
    liveChannel.activeProgramClipIndex,
    liveChannel.loopCycle,
    liveChannel.status,
    activeAd?.id,
    liveChannel.liveInput?.active,
    isAudioMuted,
    liveChannel.transmission?.audio?.muted,
    liveChannel.transmission?.audio?.display2AudioEnabled,
    liveChannel.transmission?.audio?.audioOutputTarget,
    liveChannel.transmission?.audio?.masterVolume,
  ]);

  // DECK 3 (Fallback): Commercial Ad Decoder
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const v = internalAdVideoRef.current;
    if (!v) return;

    if (!activeAd || activeAd.enabled === false) {
      v.pause();
      return;
    }

    const clipUrl = hydratedAdUrl || activeAd.videoUrl || activeAd.url || '';
    const adHint = activeAd.fileName || activeAd.title || clipUrl;
    if (!clipUrl || isSwfFile(adHint) || isImageUrl(clipUrl, adHint)) {
      v.pause();
      return;
    }

    const clipKey = `ad:${activeAd.id}:cycle:${liveChannel.loopCycle || 0}`;
    const prevLoaded = v.dataset.loadedUrl || '';
    const isSameAd = v.dataset.clipBaseId === `ad:${activeAd.id}`;
    const isAlreadyPlayingHealthy =
      isSameAd &&
      !v.error &&
      v.readyState >= 2 &&
      v.videoWidth > 0 &&
      !v.paused &&
      !v.ended;
    const isUrlUpgrade =
      !isAlreadyPlayingHealthy &&
      prevLoaded !== clipUrl &&
      (!clipUrl.startsWith('blob:') || Boolean(v.error) || v.readyState === 0);
    if (v.dataset.clipKey !== clipKey || isUrlUpgrade) {
      const preserveSec = isSameAd && isUrlUpgrade && v.currentTime > 0 ? v.currentTime : null;
      const resumeTarget = resolveDeckResumeTargetSec({
        preserveCurrentSec: preserveSec,
        pendingResumeSeekSec: pendingAdSyncTimeRef.current,
        channelTimeSec: liveChannel.everyNMinTime,
      });
      pendingAdSyncTimeRef.current = null;

      v.dataset.clipKey = clipKey;
      v.dataset.clipBaseId = `ad:${activeAd.id}`;
      v.dataset.loadedUrl = clipUrl;
      delete v.dataset.triedServerFallback;
      delete v.dataset.triedVlcStream;
      delete v.dataset.triedVault;
      delete v.dataset.retryCount;
      if (resumeTarget > 0.05) {
        pendingAdSyncTimeRef.current = resumeTarget;
      }
      v.src = clipUrl;
      v.load();
    }

    if (liveChannel.status === 'PLAYING') {
      playWithAudioSync(v);
    } else if (!v.paused) {
      v.pause();
    }
  }, [
    useStandaloneFallbackDecoders,
    hydratedAdUrl,
    activeAd?.id,
    activeAd?.url,
    activeAd?.enabled,
    liveChannel.loopCycle,
    liveChannel.status,
    isAudioMuted,
    liveChannel.transmission?.audio?.muted,
    liveChannel.transmission?.audio?.display2AudioEnabled,
    liveChannel.transmission?.audio?.audioOutputTarget,
    liveChannel.transmission?.audio?.masterVolume,
  ]);

  // DECK 4 (Fallback): Live Input Decoder (USB Camera / HDMI Card, M3U8, RTMP/RTSP)
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const v = internalLiveVideoRef.current;
    if (!v) return;

    const live = liveChannel.liveInput;
    if (!live?.active || liveChannel.status !== 'PLAYING' || live.sourceType === 'youtube') {
      if (v.srcObject) v.srcObject = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      stopFallbackCaptureStream();
      liveStreamRef.current?.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
      delete v.dataset.streamUrl;
      v.pause();
      return;
    }

    // Mute & pause Live Input while an Every N Min Ad or Scheduled Program is interrupting, keeping HLS/camera alive!
    if (activeAd || activeProg) {
      v.muted = true;
      if (!v.paused) v.pause();
      return;
    }

    // Live USB Camera / HDMI Capture Card
    if (live.sourceType === 'camera') {
      let cancelled = false;
      const attachCamera = async () => {
        if (!liveStreamRef.current && navigator.mediaDevices?.getUserMedia) {
          try {
            liveStreamRef.current = await navigator.mediaDevices.getUserMedia({
              video: live.cameraDeviceId
                ? { deviceId: { ideal: live.cameraDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
                : { width: { ideal: 1920 }, height: { ideal: 1080 } },
              audio: true,
            });
          } catch {
            try {
              liveStreamRef.current = await navigator.mediaDevices.getUserMedia({
                video: live.cameraDeviceId ? { deviceId: { ideal: live.cameraDeviceId } } : true,
                audio: false,
              });
            } catch {}
          }
        }
        if (cancelled) return;
        if (!liveStreamRef.current) {
          liveStreamRef.current = createLiveBroadcastCaptureStream('camera', live.cameraDeviceId);
        }
        if (v.srcObject !== liveStreamRef.current) {
          v.pause();
          v.removeAttribute('src');
          v.srcObject = liveStreamRef.current;
        }
        v.muted =
          isAudioMuted || Boolean(live.muted) || isDisplay2AudioDisabled(liveChannel);
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      };
      attachCamera();
      return () => {
        cancelled = true;
      };
    }

    // Live M3U8 / HLS / Direct HTTP Stream
    if (live.sourceType === 'm3u8' || live.sourceType === 'stream') {
      if (v.srcObject) v.srcObject = null;
      const streamUrl = (live.streamUrl || '').trim().replace(/^["']+|["']+$/g, '').trim();
      if (!streamUrl) return;

      if (v.dataset.streamUrl !== streamUrl) {
        v.dataset.streamUrl = streamUrl;
        delete v.dataset.triedProxyFallback;
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const lower = streamUrl.toLowerCase();

        if (lower.includes('.m3u8') && Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });
          hlsRef.current = hls;
          let retriedProxy = false;
          hls.loadSource(streamUrl);
          hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            playWithAudioSync(v);
          });
          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (data.fatal && !retriedProxy) {
              retriedProxy = true;
              hls.loadSource(`/api/live/m3u8-proxy?url=${encodeURIComponent(streamUrl)}`);
              hls.startLoad();
            }
          });
        } else {
          v.src = streamUrl;
          v.load();
          playWithAudioSync(v);
        }
      }

      restoreDisplayDeckAudio(v);
      if (v.paused && !v.error) playWithAudioSync(v);
    }
  }, [
    useStandaloneFallbackDecoders,
    liveChannel.liveInput,
    activeAd,
    activeProg,
    liveChannel.status,
    isAudioMuted,
    liveChannel.transmission?.audio?.muted,
    liveChannel.transmission?.audio?.display2AudioEnabled,
    liveChannel.transmission?.audio?.audioOutputTarget,
    liveChannel.transmission?.audio?.masterVolume,
  ]);

  // Overlays decoders for fallback mode (matches App.tsx & videoGenerator enabled-item selection)
  const resolveEnabledOverlayItem = <T extends { enabled?: boolean }>(
    banner?: { enabled?: boolean; keyEnabled?: boolean; playlist?: T[]; currentIndex?: number }
  ): T | undefined => {
    if (!banner?.enabled || banner.keyEnabled === false || !banner.playlist || banner.playlist.length === 0) return undefined;
    const ticked = banner.playlist.filter((it) => it && it.enabled !== false);
    if (ticked.length === 0) return undefined;
    const idx = Math.max(0, Math.min(banner.playlist.length - 1, banner.currentIndex || 0));
    const chosen = banner.playlist[idx];
    return chosen && chosen.enabled !== false ? chosen : ticked[0];
  };

  const activeBottomBannerItem = resolveEnabledOverlayItem(liveChannel.bottomOverlay);
  const activeBottomTickedCount = (liveChannel.bottomOverlay?.playlist || []).filter((it) => it && it.enabled !== false).length;

  const activeTopBannerItem = resolveEnabledOverlayItem(liveChannel.topOverlay);
  const activeTopTickedCount = (liveChannel.topOverlay?.playlist || []).filter((it) => it && it.enabled !== false).length;

  const activeLShapeItem = resolveEnabledOverlayItem(liveChannel.lShape);

  const syncBannerVideoElement = (
    v: HTMLVideoElement | null,
    slot: 'bot' | 'top' | 'lshape',
    item: any,
    tickedCount: number,
    bannerCurrentTimeSec: number | undefined,
    forceLoop: boolean
  ) => {
    if (!v) return;
    if (!item) {
      v.pause();
      return;
    }
    const bestUrl =
      item.serverUrl && !String(item.serverUrl).startsWith('blob:')
        ? String(item.serverUrl)
        : String(item.url || '');
    const hint = String(item.fileName || item.title || bestUrl);
    const isVideoBanner =
      Boolean(bestUrl) &&
      (item.mediaType === 'video' || isVideoFile(hint)) &&
      !isSwfFile(hint) &&
      !isImageUrl(bestUrl, hint);

    if (!isVideoBanner) {
      v.pause();
      return;
    }

    const nextKey = `${slot}:${item.id || ''}:${bestUrl}`;
    const nextItemId = `${slot}:${item.id || ''}`;
    if (v.dataset.ovKey !== nextKey) {
      const preserveSec =
        v.dataset.ovItemId === nextItemId && v.currentTime > 0.1 && !v.error
          ? v.currentTime
          : bannerCurrentTimeSec && bannerCurrentTimeSec > 2.5
          ? bannerCurrentTimeSec
          : 0;
      v.dataset.ovKey = nextKey;
      v.dataset.ovItemId = nextItemId;
      v.dataset.pendingSeek = preserveSec > 0.1 ? String(preserveSec) : '';
      delete v.dataset.triedServerFb;
      delete v.dataset.triedVlcStream;
      delete v.dataset.retryCount;
      v.src = bestUrl;
      v.muted = true;
      v.load();
    } else if (
      bannerCurrentTimeSec &&
      bannerCurrentTimeSec > 1.0 &&
      v.readyState >= 2 &&
      !v.seeking &&
      Number.isFinite(v.duration) &&
      v.duration > 2 &&
      Math.abs(v.currentTime - bannerCurrentTimeSec) > 1.2
    ) {
      try {
        v.currentTime = Math.min(bannerCurrentTimeSec, Math.max(0, v.duration - 0.5));
      } catch {}
    }

    v.muted = true;
    v.loop = forceLoop || tickedCount <= 1;
    if (v.paused) v.play().catch(() => {});
  };

  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    syncBannerVideoElement(
      internalBottomOverlayVideoRef.current,
      'bot',
      activeBottomBannerItem,
      activeBottomTickedCount,
      liveChannel.bottomOverlay?.currentTime,
      false
    );
  }, [
    useStandaloneFallbackDecoders,
    activeBottomBannerItem?.id,
    activeBottomBannerItem?.url,
    (activeBottomBannerItem as any)?.serverUrl,
    activeBottomBannerItem?.mediaType,
    activeBottomTickedCount,
    liveChannel.bottomOverlay?.enabled,
    liveChannel.bottomOverlay?.keyEnabled,
  ]);

  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    syncBannerVideoElement(
      internalTopOverlayVideoRef.current,
      'top',
      activeTopBannerItem,
      activeTopTickedCount,
      liveChannel.topOverlay?.currentTime,
      false
    );
  }, [
    useStandaloneFallbackDecoders,
    activeTopBannerItem?.id,
    activeTopBannerItem?.url,
    (activeTopBannerItem as any)?.serverUrl,
    activeTopBannerItem?.mediaType,
    activeTopTickedCount,
    liveChannel.topOverlay?.enabled,
    liveChannel.topOverlay?.keyEnabled,
  ]);

  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    syncBannerVideoElement(
      internalLShapeVideoRef.current,
      'lshape',
      activeLShapeItem,
      1,
      liveChannel.lShape?.currentTime,
      true
    );
  }, [
    useStandaloneFallbackDecoders,
    activeLShapeItem?.id,
    activeLShapeItem?.url,
    (activeLShapeItem as any)?.serverUrl,
    activeLShapeItem?.mediaType,
    liveChannel.lShape?.enabled,
  ]);

  // 1s Display 2 Watchdog: keeps active main/prog/ad deck & overlay banner videos playing & unmuted cleanly
  useEffect(() => {
    if (!useStandaloneFallbackDecoders) return;
    const t = setInterval(() => {
      const ch = liveChannelRef.current;
      const activeV = getActiveOutputVideoElement();
      if (ch.status === 'PLAYING' && activeV && !activeV.error && activeV.readyState >= 2) {
        restoreDisplayDeckAudio(activeV);
        if (activeV.paused && !activeV.ended) {
          playWithAudioSync(activeV);
        }
      }
      const ensureOvPlay = (v: HTMLVideoElement | null, banner: any) => {
        if (!v || !banner?.enabled || banner?.keyEnabled === false) return;
        if (!v.getAttribute('src') || v.error) return;
        if (v.ended) {
          try {
            v.currentTime = 0;
          } catch {}
          v.play().catch(() => {});
        } else if (v.paused && v.readyState >= 2) {
          v.play().catch(() => {});
        }
      };
      ensureOvPlay(internalBottomOverlayVideoRef.current, ch.bottomOverlay);
      ensureOvPlay(internalTopOverlayVideoRef.current, ch.topOverlay);
      ensureOvPlay(internalLShapeVideoRef.current, ch.lShape);
    }, 1000);
    return () => clearInterval(t);
  }, [useStandaloneFallbackDecoders]);

  const handleOverlayVideoFallback = (v: HTMLVideoElement, item: any) => {
    if (!item) return;
    if (v.dataset.triedServerFb !== 'true') {
      v.dataset.triedServerFb = 'true';
      const nm = String(item.fileName || item.title || '').trim();
      const fb = item.serverUrl || (nm ? `/api/media/by-name/${encodeURIComponent(nm)}` : '');
      if (fb && !fb.startsWith('blob:') && !v.src.includes(fb)) {
        v.src = fb;
        v.load();
        v.play().catch(() => {});
        return;
      }
    }
    if (v.dataset.triedVlcStream !== 'true') {
      try {
        const parsed = new URL(v.src, window.location.origin);
        if (parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) {
          v.dataset.triedVlcStream = 'true';
          v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
          v.load();
          v.play().catch(() => {});
          return;
        }
      } catch {}
    }
    const retries = Number(v.dataset.retryCount || '0');
    if (retries < 4) {
      v.dataset.retryCount = String(retries + 1);
      const retryUrl =
        item.serverUrl && !String(item.serverUrl).startsWith('blob:')
          ? String(item.serverUrl)
          : String(item.url || '');
      if (retryUrl && !retryUrl.startsWith('blob:')) {
        const delayMs = retries === 0 ? 900 : retries === 1 ? 1400 : 2000;
        const expectedKey = v.dataset.ovKey;
        setTimeout(() => {
          if (v.dataset.ovKey === expectedKey && (v.error || v.readyState === 0)) {
            v.src = `${retryUrl}${retryUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
            v.load();
            v.play().catch(() => {});
          }
        }, delayMs);
      }
    }
  };

  const activeClipRawUrl = activeClip?.videoUrl || activeClip?.url || '';
  const activeClipNameOrTitle = activeClip?.fileName || activeClip?.title || '';
  const isSwfOrImgClip =
    Boolean(activeClipRawUrl) &&
    (isSwfFile(activeClipNameOrTitle || activeClipRawUrl) ||
      isImageUrl(activeClipRawUrl, activeClipNameOrTitle) ||
      (activeClip as any)?.mediaType === 'image');
  const isChannelActiveNow = liveChannel.status !== 'STOPPED';
  const activeHardwareDeck: 'ad' | 'prog' | 'live' | 'main' | 'none' =
    !useStandaloneFallbackDecoders || !isChannelActiveNow || isYouTubeLiveStageActive(liveChannel)
      ? 'none'
      : activeAd
      ? isSwfOrImgClip || activeAd.isTranscoding
        ? 'none'
        : 'ad'
      : activeProg
      ? isSwfOrImgClip || activeProgClip?.isTranscoding
        ? 'none'
        : 'prog'
      : liveChannel.liveInput?.active
      ? 'live'
      : activeMainClip && !isSwfOrImgClip && !activeMainClip.isTranscoding
      ? 'main'
      : 'none';

  const useHardwareVideoLayer = activeHardwareDeck !== 'none';
  const useHardwareVideoLayerRef = useRef<boolean>(useHardwareVideoLayer);
  useHardwareVideoLayerRef.current = useHardwareVideoLayer;

  const progViewportRect = useHardwareVideoLayer
    ? videoGenerator.calculateProgramViewportRect(liveChannel, isCleanPlayout)
    : { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };

  const getDeckVideoStyle = (deck: 'ad' | 'prog' | 'live' | 'main'): React.CSSProperties => {
    if (activeHardwareDeck === deck) {
      return {
        position: 'absolute',
        left: `${progViewportRect.xPct}%`,
        top: `${progViewportRect.yPct}%`,
        width: `${progViewportRect.wPct}%`,
        height: `${progViewportRect.hPct}%`,
        objectFit: fitMode === 'fill' ? 'fill' : 'contain',
        opacity: 1,
        zIndex: 4,
        pointerEvents: 'none',
        backgroundColor: '#000000',
      };
    }
    return {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 4,
      height: 4,
      opacity: 0.02,
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: 1,
    };
  };

  // Continuous 60FPS Broadcast Canvas Render Loop (reads from refs so it NEVER restarts on state ticks!)
  useEffect(() => {
    if (rtcActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;
    let rafId = 0;

    const renderLoop = (timestamp: number) => {
      if (!running) return;
      const activeVideo = getActiveOutputVideoElement();
      const refs = directRefs.current;
      const clean = isCleanPlayoutRef.current;
      videoGenerator.renderChannelFrame(
        canvas,
        liveChannelRef.current,
        timestamp,
        activeVideo,
        refs.activeOverlayVideoElement || internalBottomOverlayVideoRef.current,
        refs.activeTopOverlayVideoElement || internalTopOverlayVideoRef.current,
        refs.activeLShapeVideoElement || internalLShapeVideoRef.current,
        {
          disableAllOverlays: clean,
          forceCleanFeed: clean,
          transparentVideoStage: useHardwareVideoLayerRef.current,
          stateScope: 'ext-',
        }
      );
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [rtcActive, hasDirectStudioVideo]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onDoubleClick={() => {
        const el = containerRef.current;
        if (!document.fullscreenElement && el) {
          requestFullscreenOnDisplay(el, targetDisplayIndex).catch(() => {});
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }}
      className="fixed inset-0 z-[200] w-screen h-screen bg-black flex items-center justify-center overflow-hidden select-none outline-none cursor-none"
    >
      {/* Off-canvas Banner Overlay Video Preloaders (composite via alpha/L-shape on CG canvas) */}
      {useStandaloneFallbackDecoders && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 16,
            height: 16,
            opacity: 0.01,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          <video
            ref={internalBottomOverlayVideoRef}
            style={{ width: 16, height: 16, objectFit: 'fill' }}
            playsInline
            autoPlay
            muted
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const pending = Number(v.dataset.pendingSeek || 0);
              if (pending > 0.1) {
                delete v.dataset.pendingSeek;
                try {
                  v.currentTime = Number.isFinite(v.duration)
                    ? Math.min(Math.max(0, v.duration - 0.2), pending)
                    : pending;
                } catch {}
              }
              if (liveChannelRef.current.bottomOverlay?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.bottomOverlay?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onEnded={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.bottomOverlay?.enabled) {
                try {
                  v.currentTime = 0;
                } catch {}
                v.play().catch(() => {});
              }
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.dataset.triedVlcStream !== 'true') {
                handleOverlayVideoFallback(v, activeBottomBannerItem);
              }
            }}
            onError={(e) => handleOverlayVideoFallback(e.currentTarget, activeBottomBannerItem)}
          />
          <video
            ref={internalTopOverlayVideoRef}
            style={{ width: 16, height: 16, objectFit: 'fill' }}
            playsInline
            autoPlay
            muted
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const pending = Number(v.dataset.pendingSeek || 0);
              if (pending > 0.1) {
                delete v.dataset.pendingSeek;
                try {
                  v.currentTime = Number.isFinite(v.duration)
                    ? Math.min(Math.max(0, v.duration - 0.2), pending)
                    : pending;
                } catch {}
              }
              if (liveChannelRef.current.topOverlay?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.topOverlay?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onEnded={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.topOverlay?.enabled) {
                try {
                  v.currentTime = 0;
                } catch {}
                v.play().catch(() => {});
              }
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.dataset.triedVlcStream !== 'true') {
                handleOverlayVideoFallback(v, activeTopBannerItem);
              }
            }}
            onError={(e) => handleOverlayVideoFallback(e.currentTarget, activeTopBannerItem)}
          />
          <video
            ref={internalLShapeVideoRef}
            style={{ width: 16, height: 16, objectFit: 'fill' }}
            playsInline
            autoPlay
            muted
            loop
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const pending = Number(v.dataset.pendingSeek || 0);
              if (pending > 0.1) {
                delete v.dataset.pendingSeek;
                try {
                  v.currentTime = Number.isFinite(v.duration)
                    ? Math.min(Math.max(0, v.duration - 0.2), pending)
                    : pending;
                } catch {}
              }
              if (liveChannelRef.current.lShape?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.lShape?.enabled && v.paused) {
                v.play().catch(() => {});
              }
            }}
            onEnded={(e) => {
              const v = e.currentTarget;
              if (liveChannelRef.current.lShape?.enabled) {
                try {
                  v.currentTime = 0;
                } catch {}
                v.play().catch(() => {});
              }
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.dataset.triedVlcStream !== 'true') {
                handleOverlayVideoFallback(v, activeLShapeItem);
              }
            }}
            onError={(e) => handleOverlayVideoFallback(e.currentTarget, activeLShapeItem)}
          />
        </div>
      )}

      {/* Primary Zero-Buffer Output Stage */}
      {rtcActive ? (
        <video
          ref={rtcVideoRef}
          playsInline
          autoPlay
          muted={isAudioMuted || isDisplay2AudioDisabled(liveChannel)}
          style={{
            width: fitMode === 'fill' ? '100vw' : '100%',
            height: fitMode === 'fill' ? '100vh' : '100%',
            maxWidth: '100vw',
            maxHeight: '100vh',
            objectFit: fitMode === 'fill' ? 'fill' : 'contain',
          }}
          className="relative z-10 bg-black block"
        />
      ) : (
        <div
          style={
            fitMode === 'fill'
              ? { width: '100vw', height: '100vh' }
              : { width: '100vw', height: '56.25vw', maxWidth: '177.7778vh', maxHeight: '100vh' }
          }
          className="relative bg-black flex items-center justify-center overflow-hidden"
        >
          {/* GPU Hardware Direct-Video Decks (active deck fills stage; inactive decks stay ready offscreen) */}
          {useStandaloneFallbackDecoders && (
            <>
              <video
                ref={internalMainVideoRef}
                playsInline
                autoPlay
                crossOrigin="anonymous"
                style={getDeckVideoStyle('main')}
                onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (pendingMainSyncTimeRef.current !== null && pendingMainSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingMainSyncTimeRef.current)
                  : pendingMainSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingMainSyncTimeRef.current = null;
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              restoreDisplayDeckAudio(v);
              if (pendingMainSyncTimeRef.current !== null && pendingMainSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingMainSyncTimeRef.current)
                  : pendingMainSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingMainSyncTimeRef.current = null;
              }
              if (
                v.paused &&
                liveChannel.status === 'PLAYING' &&
                !activeAd &&
                !activeProg &&
                !liveChannel.liveInput?.active
              ) {
                playWithAudioSync(v);
              }
            }}
            onPlaying={(e) => {
              restoreDisplayDeckAudio(e.currentTarget);
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.videoHeight === 0) {
                try {
                  const parsed = new URL(v.src, window.location.origin);
                  if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                    v.dataset.triedVlcStream = 'true';
                    v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                    v.load();
                    v.play().catch(() => {});
                  }
                } catch {}
              }
            }}
            onError={(e) => {
              const v = e.currentTarget;
              if (v.dataset.triedServerFallback !== 'true' && activeMainClip) {
                v.dataset.triedServerFallback = 'true';
                const fb =
                  (activeMainClip as any).serverUrl ||
                  (activeMainClip.fileName || activeMainClip.title
                    ? `/api/media/by-name/${encodeURIComponent(activeMainClip.fileName || activeMainClip.title)}`
                    : '');
                if (fb && !fb.startsWith('blob:') && !v.src.includes(fb)) {
                  v.src = fb;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              }
              try {
                const parsed = new URL(v.src, window.location.origin);
                if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                  v.dataset.triedVlcStream = 'true';
                  v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              } catch {}
              if (v.dataset.triedVault !== 'true' && activeMainClip) {
                v.dataset.triedVault = 'true';
                getMediaFromOfflineVault(activeMainClip.vaultId, activeMainClip.fileName).then((rec) => {
                  if (rec?.blobUrl) {
                    v.src = rec.blobUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                });
                return;
              }
              const retryN = Number(v.dataset.retryCount || 0);
              if (retryN < 3 && activeMainClip) {
                v.dataset.retryCount = String(retryN + 1);
                setTimeout(() => {
                  const freshUrl =
                    (activeMainClip as any).serverUrl ||
                    (activeMainClip.fileName || activeMainClip.title
                      ? `/api/media/by-name/${encodeURIComponent(activeMainClip.fileName || activeMainClip.title)}`
                      : v.src);
                  if (freshUrl && !freshUrl.startsWith('blob:')) {
                    v.src = freshUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                }, 1800);
              }
            }}
            onEnded={(e) => {
              handleNotifyClipEnded(e.currentTarget.dataset.clipKey);
            }}
          />

          <video
            ref={internalProgVideoRef}
            playsInline
            autoPlay
            crossOrigin="anonymous"
            style={getDeckVideoStyle('prog')}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (pendingProgSyncTimeRef.current !== null && pendingProgSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingProgSyncTimeRef.current)
                  : pendingProgSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingProgSyncTimeRef.current = null;
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              restoreDisplayDeckAudio(v);
              if (pendingProgSyncTimeRef.current !== null && pendingProgSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingProgSyncTimeRef.current)
                  : pendingProgSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingProgSyncTimeRef.current = null;
              }
              if (
                v.paused &&
                liveChannel.status === 'PLAYING' &&
                Boolean(liveChannel.activeProgramId) &&
                !activeAd &&
                !liveChannel.liveInput?.active
              ) {
                playWithAudioSync(v);
              }
            }}
            onPlaying={(e) => {
              restoreDisplayDeckAudio(e.currentTarget);
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.videoHeight === 0) {
                try {
                  const parsed = new URL(v.src, window.location.origin);
                  if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                    v.dataset.triedVlcStream = 'true';
                    v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                    v.load();
                    v.play().catch(() => {});
                  }
                } catch {}
              }
            }}
            onError={(e) => {
              const v = e.currentTarget;
              if (v.dataset.triedServerFallback !== 'true' && activeProgClip) {
                v.dataset.triedServerFallback = 'true';
                const fb =
                  (activeProgClip as any).serverUrl ||
                  (activeProgClip.fileName || activeProgClip.title
                    ? `/api/media/by-name/${encodeURIComponent(activeProgClip.fileName || activeProgClip.title)}`
                    : '');
                if (fb && !fb.startsWith('blob:') && !v.src.includes(fb)) {
                  v.src = fb;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              }
              try {
                const parsed = new URL(v.src, window.location.origin);
                if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                  v.dataset.triedVlcStream = 'true';
                  v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              } catch {}
              if (v.dataset.triedVault !== 'true' && activeProgClip) {
                v.dataset.triedVault = 'true';
                getMediaFromOfflineVault(activeProgClip.vaultId, activeProgClip.fileName).then((rec) => {
                  if (rec?.blobUrl) {
                    v.src = rec.blobUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                });
                return;
              }
              const retryN = Number(v.dataset.retryCount || 0);
              if (retryN < 3 && activeProgClip) {
                v.dataset.retryCount = String(retryN + 1);
                setTimeout(() => {
                  const freshUrl =
                    (activeProgClip as any).serverUrl ||
                    (activeProgClip.fileName || activeProgClip.title
                      ? `/api/media/by-name/${encodeURIComponent(activeProgClip.fileName || activeProgClip.title)}`
                      : v.src);
                  if (freshUrl && !freshUrl.startsWith('blob:')) {
                    v.src = freshUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                }, 1800);
              }
            }}
            onEnded={(e) => {
              handleNotifyClipEnded(e.currentTarget.dataset.clipKey);
            }}
          />

          <video
            ref={internalAdVideoRef}
            playsInline
            autoPlay
            crossOrigin="anonymous"
            style={getDeckVideoStyle('ad')}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (pendingAdSyncTimeRef.current !== null && pendingAdSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingAdSyncTimeRef.current)
                  : pendingAdSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingAdSyncTimeRef.current = null;
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              restoreDisplayDeckAudio(v);
              if (pendingAdSyncTimeRef.current !== null && pendingAdSyncTimeRef.current > 0.05) {
                const t = Number.isFinite(v.duration)
                  ? Math.min(Math.max(0, v.duration - 0.25), pendingAdSyncTimeRef.current)
                  : pendingAdSyncTimeRef.current;
                try {
                  v.currentTime = t;
                } catch {}
                pendingAdSyncTimeRef.current = null;
              }
              if (
                v.paused &&
                liveChannel.status === 'PLAYING' &&
                Boolean(liveChannel.activeEveryNMinAd)
              ) {
                playWithAudioSync(v);
              }
            }}
            onPlaying={(e) => {
              restoreDisplayDeckAudio(e.currentTarget);
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth === 0 && v.videoHeight === 0) {
                try {
                  const parsed = new URL(v.src, window.location.origin);
                  if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                    v.dataset.triedVlcStream = 'true';
                    v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                    v.load();
                    v.play().catch(() => {});
                  }
                } catch {}
              }
            }}
            onError={(e) => {
              const v = e.currentTarget;
              if (v.dataset.triedServerFallback !== 'true' && activeAd) {
                v.dataset.triedServerFallback = 'true';
                const fb =
                  (activeAd as any).serverUrl ||
                  (activeAd.fileName || activeAd.title
                    ? `/api/media/by-name/${encodeURIComponent(activeAd.fileName || activeAd.title)}`
                    : '');
                if (fb && !fb.startsWith('blob:') && !v.src.includes(fb)) {
                  v.src = fb;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              }
              try {
                const parsed = new URL(v.src, window.location.origin);
                if ((parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) && v.dataset.triedVlcStream !== 'true') {
                  v.dataset.triedVlcStream = 'true';
                  v.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
              } catch {}
              if (v.dataset.triedVault !== 'true' && activeAd) {
                v.dataset.triedVault = 'true';
                getMediaFromOfflineVault(activeAd.vaultId, activeAd.fileName).then((rec) => {
                  if (rec?.blobUrl) {
                    v.src = rec.blobUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                });
                return;
              }
              const retryN = Number(v.dataset.retryCount || 0);
              if (retryN < 3 && activeAd) {
                v.dataset.retryCount = String(retryN + 1);
                setTimeout(() => {
                  const freshUrl =
                    (activeAd as any).serverUrl ||
                    (activeAd.fileName || activeAd.title
                      ? `/api/media/by-name/${encodeURIComponent(activeAd.fileName || activeAd.title)}`
                      : v.src);
                  if (freshUrl && !freshUrl.startsWith('blob:')) {
                    v.src = freshUrl;
                    v.load();
                    v.play().catch(() => {});
                  }
                }, 1800);
              }
            }}
            onEnded={(e) => {
              handleNotifyClipEnded(e.currentTarget.dataset.clipKey);
            }}
          />

          <video
            ref={internalLiveVideoRef}
            playsInline
            autoPlay
            crossOrigin="anonymous"
            style={getDeckVideoStyle('live')}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              restoreDisplayDeckAudio(v);
              if (
                v.paused &&
                liveChannelRef.current.status === 'PLAYING' &&
                Boolean(liveChannelRef.current.liveInput?.active) &&
                !liveChannelRef.current.activeEveryNMinAd &&
                !liveChannelRef.current.activeProgramId
              ) {
                playWithAudioSync(v);
              }
            }}
            onCanPlay={(e) => {
              const v = e.currentTarget;
              restoreDisplayDeckAudio(v);
              if (
                v.paused &&
                liveChannelRef.current.status === 'PLAYING' &&
                Boolean(liveChannelRef.current.liveInput?.active) &&
                !liveChannelRef.current.activeEveryNMinAd &&
                !liveChannelRef.current.activeProgramId
              ) {
                playWithAudioSync(v);
              }
            }}
            onPlaying={(e) => {
              restoreDisplayDeckAudio(e.currentTarget);
            }}
            onError={(e) => {
              const v = e.currentTarget;
              const ch = liveChannelRef.current;
              const rawUrl = (ch.liveInput?.streamUrl || '').trim().replace(/^["']+|["']+$/g, '').trim();
              if (!rawUrl || !ch.liveInput?.active || ch.status !== 'PLAYING') return;
              const lower = rawUrl.toLowerCase();
              if (
                (lower.startsWith('http://') || lower.startsWith('https://')) &&
                v.dataset.triedProxyFallback !== 'true'
              ) {
                v.dataset.triedProxyFallback = 'true';
                v.src = `/api/live/m3u8-proxy?url=${encodeURIComponent(rawUrl)}`;
                v.load();
                playWithAudioSync(v);
              }
            }}
          />
            </>
          )}

          {shouldKeepYouTubeLayerMounted(liveChannel) && (
            <YouTubeBroadcastLayer
              channel={liveChannel}
              muted={
                isAudioMuted ||
                isDisplay2AudioDisabled(liveChannel) ||
                Boolean(liveChannel.liveInput?.muted)
              }
              volume={liveChannel.liveInput?.volume ?? 100}
              paused={liveChannel.status !== 'PLAYING' || !isYouTubeLiveStageActive(liveChannel)}
              visible={isYouTubeLiveStageActive(liveChannel)}
              isAuthoritative={false}
              fitMode={fitMode}
              audioUnlockTick={audioUnlockTick}
            />
          )}
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            className="relative z-10 w-full h-full block pointer-events-none bg-transparent"
          />
        </div>
      )}
    </div>
  );
};
