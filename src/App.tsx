import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { Maximize2 } from 'lucide-react';
import { INITIAL_CHANNELS } from './constants/initialChannels';
import {
  TVChannel,
  PlaylistItem,
  BottomScrollConfig,
  TransmissionConfig,
  OverlayBannerConfig,
  LShapeConfig,
  ScheduledProgram,
  EveryNMinAdItem,
  EveryNMinIntervalOption,
  LiveInputConfig
} from './types/playout';
import { Header } from './components/Header';
import { LeftPlaylistWorkspace, LeftWorkspaceTab } from './components/LeftPlaylistWorkspace';
import { RightMonitorDeck } from './components/RightMonitorDeck';
import { BottomControlCards } from './components/BottomControlCards';
import { StudioFeatureModals, ActiveModalType } from './components/StudioFeatureModals';
import { ExternalOutputWindow } from './components/ExternalOutputWindow';
import { YouTubeBroadcastLayer } from './components/YouTubeBroadcastLayer';
import { broadcastAudio } from './services/audioEngine';
import { videoGenerator } from './services/videoGenerator';
import { fetchCgBackendState, saveCgBackendState } from './services/cgBackendService';
import {
  filterFolderVideoAndSwfFiles,
  isImageUrl,
  isVideoFile,
  probeMediaFileDuration,
  swfEngine,
  uploadMediaFileToBackend,
} from './services/swfEngine';
import {
  compactChannel,
  compactPlayoutStateEnvelope,
  hydrateCompactChannel,
} from './utils/stateCompactor';
import {
  clearOfflineVaultForReset,
  computeVaultIdForFile,
  extractFolderName,
  hydrateChannelsAndAdsFromVault,
  loadPlayoutStateFromVault,
  registerLiveMediaInVault,
  restoreMediaUrlFromVault,
  saveMediaToOfflineVault,
  savePlayoutStateToVault
} from './services/offlineMediaVault';
import {
  createLiveBroadcastCaptureStream,
  stopFallbackCaptureStream
} from './utils/liveCaptureFallbackStream';
import {
  StationLicenseRecord,
  evaluateLicenseStatus,
  verifyLicenseSignature,
} from './utils/licenseCrypto';
import {
  getSavedFixedDisplayIndex,
  saveFixedDisplayIndex,
  requestFullscreenOnDisplay,
  openDisplayOutputWindow,
} from './utils/displayManager';
import {
  getActivePlaybackCycleKey as getActivePlaybackCycleKeyEngine,
  advanceMainPlaybackOnClipEnd as advanceMainPlaybackOnClipEndEngine,
  buildBroadcastChannelPayload,
  captureDeckPausedTimeSec,
  computeFastPlaylistSignature,
  needsBackendTranscodeFallback,
  resolveDeckResumeTargetSec,
  shouldKeepExistingVideoFrameInPlace,
  shouldSkipUnplayableClip,
  getActiveChannelPlaybackTimeSec,
  startScheduledProgramOnChannel,
  triggerEveryNMinAdOnChannel,
} from './utils/playoutPlaybackEngine';
import { masterBroadcastBus } from './utils/masterBroadcastBus';
import {
  ensureDefaultTickedSlots,
  getCurrentHHMM,
  secondsUntilNextTickedSlot,
  isAdDateMatch,
} from './utils/adTrackingTracks';
import {
  advanceYouTubeQueueIndex,
  isYouTubeLiveStageActive,
  shouldKeepYouTubeLayerMounted,
} from './utils/youtubeLive';
import { isTickerBarExpired } from './utils/tickerSync';
import {
  buildFastPlaylistItems,
  createMediaBatchQueue,
  shouldEagerUploadOnImport,
  shouldEagerVaultSaveOnImport,
} from './utils/folderImport';

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function resolvePersistedUrl(url: string | undefined, fallbackName?: string): string {
  const u = (url || '').trim();
  if (!u) {
    return fallbackName ? `/api/media/by-name/${encodeURIComponent(fallbackName)}` : '';
  }
  if (u.startsWith('blob:')) {
    return fallbackName ? `/api/media/by-name/${encodeURIComponent(fallbackName)}` : '';
  }
  return u;
}

function sanitizeLoadedLShape(
  raw: LShapeConfig | undefined,
  fallback: LShapeConfig
): LShapeConfig {
  const base = { ...fallback, ...(raw || {}) };
  const cleanList = Array.isArray(base.playlist)
    ? base.playlist
        .filter((it) => it && (it.url || it.title) && !it.id?.startsWith('lshape-gen-'))
        .map((it) => {
          const resolvedUrl = resolvePersistedUrl(it.url, (it as any).fileName || it.title);
          return {
            ...it,
            url: resolvedUrl,
            presetSize: it.presetSize || 'full_image',
            cgOverlayMode:
              !it.cgOverlayMode || it.cgOverlayMode === 'all_overlays'
                ? ('lshape_and_logo' as const)
                : it.cgOverlayMode,
          };
        })
        .filter((it) => Boolean(it.url))
    : [];
  const renderMode =
    base.renderMode || (base.squeezeProgramVideo === false ? 'overlay' : 'squeeze');
  return {
    ...base,
    enabled: cleanList.length > 0 ? Boolean(base.enabled) : false,
    keyEnabled: true,
    isPlaying: true,
    opacity:
      typeof base.opacity === 'number' && base.opacity > 0
        ? Math.min(1, base.opacity)
        : 1,
    presetSize: base.presetSize || 'full_image',
    cgOverlayMode:
      !base.cgOverlayMode || base.cgOverlayMode === 'all_overlays'
        ? ('lshape_and_logo' as const)
        : base.cgOverlayMode,
    sideWidth: base.sideWidth && base.sideWidth >= 50 ? base.sideWidth : 280,
    bottomHeight: base.bottomHeight && base.bottomHeight >= 28 ? base.bottomHeight : 130,
    renderMode,
    squeezeProgramVideo: renderMode === 'squeeze',
    playMode: base.playMode || 'periodic',
    periodicActive: base.periodicActive !== false,
    periodicCounter: 0,
    pendingAfterAd: false,
    currentTime: 0,
    currentIndex: 0,
    playlist: cleanList,
  };
}

function sanitizeOverlayBanner(
  raw: OverlayBannerConfig | undefined,
  fallback: OverlayBannerConfig
): OverlayBannerConfig {
  const targetPos: 'top' | 'bottom' = fallback.position === 'top' ? 'top' : 'bottom';
  const base = { ...fallback, ...(raw || {}), position: targetPos };
  const rawOpacity = Number(base.opacity ?? 1);
  const cleanOpacity = !Number.isFinite(rawOpacity) || rawOpacity >= 0.9 ? 1 : Math.max(0.1, rawOpacity);
  const cleanPlaylist = Array.isArray(base.playlist)
    ? base.playlist
        .filter((it) => {
          if (!it || !(it.url || it.title)) return false;
          const idLower = String(it.id || '').toLowerCase();
          if (targetPos === 'top' && (idLower.startsWith('bot-') || idLower.startsWith('bottom-'))) {
            return false;
          }
          if (targetPos === 'bottom' && idLower.startsWith('top-')) {
            return false;
          }
          return true;
        })
        .map(({ file, ...it }) => ({
          ...it,
          url: resolvePersistedUrl(it.url, it.fileName || it.title),
        }))
        .filter((it) => Boolean(it.url))
    : [];
  return {
    ...base,
    position: targetPos,
    opacity: cleanOpacity,
    enabled: cleanPlaylist.length > 0 ? Boolean(base.enabled) : false,
    keyEnabled: base.keyEnabled !== false,
    isPlaying: true,
    currentIndex: Math.max(0, Math.min(Math.max(0, cleanPlaylist.length - 1), base.currentIndex || 0)),
    currentTime: 0,
    playlist: cleanPlaylist,
  };
}

function isSoftwareAudioMuted(audio?: TVChannel['transmission']['audio']): boolean {
  if (!audio) return true;
  if (audio.muted) return true;
  if (typeof audio.softwareAudioEnabled === 'boolean') {
    return !audio.softwareAudioEnabled;
  }
  return audio.audioOutputTarget === 'display2';
}

function normalizePersistedChannel(rawCh: any, fallbackCh: TVChannel): TVChannel {
  if (!rawCh || typeof rawCh !== 'object') return fallbackCh;
  const ch = hydrateCompactChannel(rawCh);

  const cleanPlaylist: PlaylistItem[] = Array.isArray(ch.playlist)
    ? ch.playlist
        .filter((it: any) => it && (it.url || it.videoUrl || it.fileName || it.title))
        .map(({ file, ...it }: any) => {
          const resolved = resolvePersistedUrl(it.url || it.videoUrl, it.fileName || it.title);
          return {
            ...it,
            url: resolved,
            videoUrl: resolved,
            isTranscoding: false,
            enabled: it.enabled !== false,
          };
        })
        .filter((it: PlaylistItem) => Boolean(it.url))
    : [];

  const cleanPrograms: ScheduledProgram[] = Array.isArray(ch.scheduledPrograms)
    ? ch.scheduledPrograms
        .map((p: any) => {
          const rawClips = Array.isArray(p?.playlist)
            ? p.playlist
            : Array.isArray(p?.clips)
            ? p.clips
            : [];
          const pClips = rawClips
            .filter((it: any) => it && (it.url || it.videoUrl || it.fileName || it.title))
            .map(({ file, ...it }: any) => {
              const resolved = resolvePersistedUrl(it.url || it.videoUrl, it.fileName || it.title);
              return {
                ...it,
                url: resolved,
                videoUrl: resolved,
                isTranscoding: false,
                enabled: it.enabled !== false,
              };
            })
            .filter((it: PlaylistItem) => Boolean(it.url));
          return {
            ...p,
            playlist: pClips,
          };
        })
        .filter((p: ScheduledProgram) => p.playlist.length > 0)
    : [];

  const cleanAds: EveryNMinAdItem[] = Array.isArray(ch.everyNMinAds)
    ? ch.everyNMinAds
        .filter((it: any) => it && (it.url || it.videoUrl || it.fileName || it.title))
        .map(({ file, ...it }: any, idx: number) => {
          const resolved = resolvePersistedUrl(it.url || it.videoUrl, it.fileName || it.title);
          return {
            ...it,
            url: resolved,
            videoUrl: resolved,
            isTranscoding: false,
            orderIndex: it.orderIndex || idx + 1,
            elapsedSec: 0,
          };
        })
        .filter((it: EveryNMinAdItem) => Boolean(it.url))
    : [];

  const botOverlay = sanitizeOverlayBanner(ch.bottomOverlay, fallbackCh.bottomOverlay!);
  const topOverlay = sanitizeOverlayBanner(ch.topOverlay, fallbackCh.topOverlay!);
  const lShape = sanitizeLoadedLShape(ch.lShape, fallbackCh.lShape!);

  const rawGraphics: any = {
    ...fallbackCh.graphics,
    ...(ch.graphics || {}),
  };
  const normalizeLogoObj = (logo: any) => {
    if (!logo) return logo;
    const nextLogo = { ...logo };
    if (nextLogo.url && String(nextLogo.url).startsWith('blob:')) {
      nextLogo.url = resolvePersistedUrl(nextLogo.url, nextLogo.fileName || nextLogo.label);
    }
    if (Array.isArray(nextLogo.playlist)) {
      nextLogo.playlist = nextLogo.playlist
        .map((it: any) => {
          if (!it) return null;
          const resolved = resolvePersistedUrl(it.url, it.fileName || it.title || it.label);
          return {
            ...it,
            url: resolved || it.url,
          };
        })
        .filter((it: any) => Boolean(it && it.url));
    }
    return nextLogo;
  };
  rawGraphics.channelLogo = normalizeLogoObj(rawGraphics.channelLogo);
  rawGraphics.sponsorLogo1 = normalizeLogoObj(rawGraphics.sponsorLogo1);
  rawGraphics.sponsorLogo2 = normalizeLogoObj(rawGraphics.sponsorLogo2);
  rawGraphics.sponsorLogo3 = normalizeLogoObj(rawGraphics.sponsorLogo3);
  rawGraphics.sponsorLogo4 = normalizeLogoObj(rawGraphics.sponsorLogo4);
  if (rawGraphics.sponsorLogo1) rawGraphics.sponsor1Logo = rawGraphics.sponsorLogo1;
  if (rawGraphics.sponsorLogo2) rawGraphics.sponsor2Logo = rawGraphics.sponsorLogo2;
  rawGraphics.backInTimer = {
    ...(fallbackCh.graphics?.backInTimer || {}),
    ...(ch.backInTimer || {}),
    ...(rawGraphics.backInTimer || {}),
  };

  // Recover exact paused Main Playlist clip & time if shutdown occurred during an ad/program interrupt
  const savedMain =
    ch.savedMainPlaybackState &&
    typeof ch.savedMainPlaybackState.clipIndex === 'number' &&
    typeof ch.savedMainPlaybackState.currentTime === 'number'
      ? ch.savedMainPlaybackState
      : null;

  const rawClipIdx = savedMain ? savedMain.clipIndex : ch.currentClipIndex || 0;
  const safeClipIdx = Math.max(
    0,
    Math.min(Math.max(0, cleanPlaylist.length - 1), rawClipIdx)
  );
  const rawTime = savedMain ? savedMain.currentTime : ch.currentTime;
  const safeCurrentTime =
    typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime >= 0 ? rawTime : 0;

  const hasPlayableContent =
    cleanPlaylist.length > 0 || Boolean(ch.liveInput?.active);

  return {
    ...fallbackCh,
    ...ch,
    id: 1,
    standbyScreenMode: ch.standbyScreenMode || 'black',
    loopMode: ch.loopMode === 'off' ? 'off' : 'playlist',
    loopFolders: [],
    playlist: cleanPlaylist,
    currentClipIndex: safeClipIdx,
    currentTime: safeCurrentTime,
    savedMainPlaybackState: ch.liveInput?.active ? savedMain : null,
    savedProgramPlaybackState: null,
    scheduledPrograms: cleanPrograms,
    everyNMinAds: cleanAds,
    activeEveryNMinAd: null,
    everyNMinQueue: [],
    activeProgramId: null,
    activeProgramClipIndex: 0,
    activeProgramTime: 0,
    backInTimer: rawGraphics.backInTimer,
    graphics: rawGraphics,
    liveInput: (() => {
      const rawLive: any = {
        ...fallbackCh.liveInput!,
        ...(ch.liveInput || {}),
      };
      const st = rawLive.sourceType;
      const safeSourceType =
        st === 'camera' || st === 'stream' || st === 'm3u8' || st === 'youtube' ? st : 'm3u8';
      return {
        active: Boolean(rawLive.active),
        sourceType: safeSourceType,
        streamUrl: rawLive.streamUrl || '',
        cameraDeviceId: rawLive.cameraDeviceId,
        playEveryMinAdsOnLive: rawLive.playEveryMinAdsOnLive !== false,
        playEveryNMinAdsOnLive: rawLive.playEveryNMinAdsOnLive,
        showOverlaysOnLive: rawLive.showOverlaysOnLive,
        liveOverlayMode: rawLive.liveOverlayMode,
        volume: typeof rawLive.volume === 'number' ? rawLive.volume : 100,
        muted: Boolean(rawLive.muted),
        activeStreamId: rawLive.activeStreamId ?? null,
        streams: Array.isArray(rawLive.streams) ? rawLive.streams : undefined,
        youtubeInputText: typeof rawLive.youtubeInputText === 'string' ? rawLive.youtubeInputText : '',
        youtubeQueue: Array.isArray(rawLive.youtubeQueue) ? rawLive.youtubeQueue : [],
        youtubeQueueIndex: typeof rawLive.youtubeQueueIndex === 'number' ? rawLive.youtubeQueueIndex : 0,
        youtubeLoop: rawLive.youtubeLoop !== false,
        youtubeCycle: typeof rawLive.youtubeCycle === 'number' ? rawLive.youtubeCycle : 0,
      };
    })(),
    bottomOverlay: botOverlay,
    topOverlay: topOverlay,
    lShape,
    transmission: (() => {
      const rawAudio: any = {
        ...fallbackCh.transmission.audio,
        ...(ch.transmission?.audio || {}),
      };
      const softOn =
        typeof rawAudio.softwareAudioEnabled === 'boolean'
          ? rawAudio.softwareAudioEnabled
          : false;
      const d2On =
        typeof rawAudio.display2AudioEnabled === 'boolean'
          ? rawAudio.display2AudioEnabled
          : rawAudio.audioOutputTarget === 'software'
          ? false
          : true;
      const derivedTarget: 'both' | 'software' | 'display2' =
        softOn && d2On ? 'both' : softOn ? 'software' : 'display2';
      return {
        ...fallbackCh.transmission,
        ...(ch.transmission || {}),
        audio: {
          ...rawAudio,
          softwareAudioEnabled: softOn,
          display2AudioEnabled: d2On,
          audioOutputTarget: derivedTarget,
          muted: false,
        },
      };
    })(),
    status: ch.status === 'PAUSED' ? 'PAUSED' : hasPlayableContent ? 'PLAYING' : 'STOPPED',
  };
}

function StandaloneDisplayOutputApp() {
  const [initialChannel] = useState<TVChannel>(() => {
    try {
      const snapRaw = localStorage.getItem('ashoka_live_sync_snapshot_v1');
      if (snapRaw) {
        const snap = JSON.parse(snapRaw);
        if (
          snap?.channel &&
          typeof snap.updatedAtMs === 'number' &&
          Date.now() - snap.updatedAtMs < 30000
        ) {
          const hydrated = hydrateCompactChannel(snap.channel);
          const norm = normalizePersistedChannel(hydrated, INITIAL_CHANNELS[0]);
          return {
            ...norm,
            activeEveryNMinAd: hydrated.activeEveryNMinAd || null,
            everyNMinQueue: Array.isArray(hydrated.everyNMinQueue) ? hydrated.everyNMinQueue : [],
            activeProgramId: hydrated.activeProgramId || null,
            activeProgramClipIndex: hydrated.activeProgramClipIndex || 0,
            activeProgramTime: hydrated.activeProgramTime || 0,
            currentClipIndex:
              typeof hydrated.currentClipIndex === 'number'
                ? hydrated.currentClipIndex
                : norm.currentClipIndex,
            currentTime:
              typeof hydrated.currentTime === 'number' ? hydrated.currentTime : norm.currentTime,
            liveInput: hydrated.liveInput ? { ...norm.liveInput, ...hydrated.liveInput } : norm.liveInput,
            graphics: {
              ...norm.graphics,
              ...(typeof snap.isLicensed === 'boolean'
                ? { demoWatermarkEnabled: !snap.isLicensed }
                : {}),
              ...(snap.licenseRecord ? { licenseRecord: snap.licenseRecord } : {}),
            },
          };
        }
      }
      const saved = localStorage.getItem('ashoka_playlist_playout_v15');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          return normalizePersistedChannel(parsed[0], INITIAL_CHANNELS[0]);
        }
      }
    } catch {}
    return INITIAL_CHANNELS[0];
  });

  const targetDisplayIndex = (() => {
    try {
      const d = Number(new URLSearchParams(window.location.search).get('display') || '0');
      if (Number.isFinite(d) && d >= 1) return Math.round(d);
    } catch {}
    return getSavedFixedDisplayIndex();
  })();

  useEffect(() => {
    try {
      document.title = `ASHOKA DISPLAY ${targetDisplayIndex} OUTPUT`;
    } catch {}
  }, [targetDisplayIndex]);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden select-none">
      <ExternalOutputWindow
        channel={initialChannel}
        targetDisplayIndex={targetDisplayIndex}
        onExitOutputMode={() => {
          try {
            window.close();
          } catch {}
        }}
      />
    </div>
  );
}

export default function App() {
  const isStandaloneOutput =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('output') === 'true';

  if (isStandaloneOutput) {
    return <StandaloneDisplayOutputApp />;
  }

  return <StudioPlayoutApp />;
}

function StudioPlayoutApp() {
  const [channels, setChannels] = useState<TVChannel[]>(() => {
    try {
      const saved = localStorage.getItem('ashoka_playlist_playout_v15');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 1) {
          return [normalizePersistedChannel(parsed[0], INITIAL_CHANNELS[0])];
        }
      }
    } catch {
      // Fallback to initial state
    }
    return INITIAL_CHANNELS;
  });

  const [activeLeftTab, setActiveLeftTab] = useState<LeftWorkspaceTab>('main');
  const [activeModal, setActiveModal] = useState<ActiveModalType>(null);
  const [licenseRecord, setLicenseRecord] = useState<StationLicenseRecord | null>(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('ashoka_playlist_meta_v15') || '{}');
      if (meta.licenseRecord && verifyLicenseSignature(meta.licenseRecord)) {
        return meta.licenseRecord as StationLicenseRecord;
      }
    } catch {}
    return null;
  });
  const [isLicensed, setIsLicensed] = useState<boolean>(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('ashoka_playlist_meta_v15') || '{}');
      if (meta.licenseRecord && verifyLicenseSignature(meta.licenseRecord)) {
        return evaluateLicenseStatus(meta.licenseRecord).isValidAndActive;
      }
      return false;
    } catch {
      return false;
    }
  });
  const [liveCameraActive, setLiveCameraActive] = useState<boolean>(false);
  const [everyNMinEnabled, setEveryNMinEnabled] = useState<boolean>(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('ashoka_playlist_meta_v15') || '{}');
      if (typeof meta.everyNMinEnabled === 'boolean') return meta.everyNMinEnabled;
    } catch {}
    return false;
  });
  const [everyNMinInterval, setEveryNMinInterval] = useState<EveryNMinIntervalOption>(() => {
    try {
      const meta = JSON.parse(localStorage.getItem('ashoka_playlist_meta_v15') || '{}');
      if (meta.everyNMinInterval) return meta.everyNMinInterval as EveryNMinIntervalOption;
    } catch {}
    return 15;
  });
  const [everyNMinCountdownSec, setEveryNMinCountdownSec] = useState<number>(0);
  const [isExternalOutputView, setIsExternalOutputView] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('output') === 'true';
    } catch {
      return false;
    }
  });
  const [channelOnAirSeconds, setChannelOnAirSeconds] = useState<number>(() => {
    try {
      return Math.max(0, Number(localStorage.getItem('ashoka_on_air_seconds_v15') || 0));
    } catch {
      return 0;
    }
  });
  const [fixedDisplayIndex, setFixedDisplayIndex] = useState<number>(() =>
    getSavedFixedDisplayIndex()
  );
  const [isAppMinimized, setIsAppMinimized] = useState<boolean>(false);

  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const programVideoRef = useRef<HTMLVideoElement | null>(null);
  const adVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const overlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const topOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const lShapeVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const monitorFullscreenRef = useRef<HTMLDivElement | null>(null);
  const fullscreenStageBoxRef = useRef<HTMLDivElement | null>(null);
  const studioVideoStageRef = useRef<HTMLDivElement | null>(null);
  const monitorBoxElementRef = useRef<HTMLDivElement | null>(null);
  const fullscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isMonitorFullscreen, setIsMonitorFullscreen] = useState<boolean>(false);
  const hasUserInteractedRef = useRef<boolean>(false);
  const pendingResumeSeekRef = useRef<number | null>(null);
  const pendingProgResumeSeekRef = useRef<number | null>(null);
  const activeSeekOnMetadataRef = useRef<number | null>(null);
  const activeProgSeekOnMetadataRef = useRef<number | null>(null);
  const hasHydratedFromServerRef = useRef<boolean>(false);
  const lastClipAdvanceAtRef = useRef<number>(0);
  const consecutiveDeckFailRef = useRef<number>(0);
  const swfWaitCountRef = useRef<Record<string, number>>({});
  const lastStateSaveAtRef = useRef<number>(0);
  const lastSavedStructSigRef = useRef<string>('');
  const lastCgSavedSigRef = useRef<string>('');
  const lastBroadcastVisualSigRef = useRef<string>('');

  const channel = channels[0];
  const channelRef = useRef<TVChannel>(channel);
  channelRef.current = channel;
  const everyNMinAds = channel.everyNMinAds || [];

  const getActiveDeckVideoElement = (ch: TVChannel = channel): HTMLVideoElement | null => {
    if (ch.activeEveryNMinAd) return adVideoRef.current;
    if (ch.activeProgramId) return programVideoRef.current;
    if (ch.liveInput?.active) return liveVideoRef.current;
    return videoElementRef.current;
  };

  const restoreDeckAudio = (el: HTMLVideoElement | null, targetCh?: TVChannel) => {
    if (!el) return;
    const ch = targetCh || channelRef.current;
    if (!ch) return;
    el.volume = Math.max(0.1, Math.min(1, ch.transmission.audio.masterVolume ?? 0.9));
    const shouldMute = isSoftwareAudioMuted(ch.transmission.audio);
    if (shouldMute) {
      el.muted = true;
    } else if (hasUserInteractedRef.current) {
      el.muted = false;
    }
  };

  const triggerLegacyBlobUploadIfNeeded = (
    el: HTMLVideoElement,
    clipBaseId: string,
    clip: any,
    clipUrl: string
  ) => {
    if (
      !clip?.file ||
      !clipUrl.startsWith('blob:') ||
      !needsBackendTranscodeFallback(clip.fileName || clip.title) ||
      el.dataset.uploadingForClip === clipBaseId
    ) {
      return;
    }
    el.dataset.uploadingForClip = clipBaseId;
    uploadMediaFileToBackend(clip.file)
      .then((res) => {
        if (!res?.url) return;
        const srvUrl = res.url;
        setChannels((prev) =>
          prev.map((c) => ({
            ...c,
            playlist: c.playlist.map((it) =>
              it.id === clip.id
                ? {
                    ...it,
                    serverUrl: srvUrl,
                    url: res.transcoded ? srvUrl : it.url,
                    videoUrl: res.transcoded ? srvUrl : it.videoUrl,
                    ...(typeof res.duration === 'number' && res.duration > 0
                      ? { duration: res.duration }
                      : {}),
                  }
                : it
            ),
            everyNMinAds: (c.everyNMinAds || []).map((ad) =>
              ad.id === clip.id
                ? {
                    ...ad,
                    serverUrl: srvUrl,
                    url: res.transcoded ? srvUrl : ad.url,
                    videoUrl: res.transcoded ? srvUrl : ad.videoUrl,
                  }
                : ad
            ),
            activeEveryNMinAd:
              c.activeEveryNMinAd && c.activeEveryNMinAd.id === clip.id
                ? {
                    ...c.activeEveryNMinAd,
                    serverUrl: srvUrl,
                    url: res.transcoded ? srvUrl : c.activeEveryNMinAd.url,
                    videoUrl: res.transcoded ? srvUrl : c.activeEveryNMinAd.videoUrl,
                  }
                : c.activeEveryNMinAd,
          }))
        );
      })
      .catch(() => {});
  };

  const handleDeckUnplayableFallback = async (
    vid: HTMLVideoElement,
    deckKind: 'main' | 'prog' | 'ad',
    clip: any
  ) => {
    const clipKeyNow = vid.dataset.clipKey || '';
    if (!clipKeyNow || vid.dataset.recoveringClipKey === clipKeyNow) return;
    vid.dataset.recoveringClipKey = clipKeyNow;

    const releaseGuard = () => {
      if (vid.dataset.recoveringClipKey === clipKeyNow) {
        delete vid.dataset.recoveringClipKey;
      }
    };

    try {
      const srvUrl = String(clip?.serverUrl || '').trim();
      if (srvUrl && !srvUrl.startsWith('blob:') && vid.dataset.triedServerFallback !== 'true') {
        vid.dataset.triedServerFallback = 'true';
        const needsVlc =
          needsBackendTranscodeFallback(clip?.fileName || clip?.title || srvUrl) &&
          !srvUrl.includes('_vlc.mp4');
        const nextUrl = needsVlc
          ? `/api/media/vlc-stream?url=${encodeURIComponent(srvUrl)}`
          : srvUrl;
        if (needsVlc) {
          vid.dataset.triedVlcStream = 'true';
        }
        vid.dataset.loadedUrl = nextUrl;
        vid.src = nextUrl;
        vid.load();
        vid.play().catch(() => {});
        releaseGuard();
        return;
      }

      if (clip?.file && vid.dataset.triedUploadFallback !== 'true') {
        vid.dataset.triedUploadFallback = 'true';
        const uploaded = await uploadMediaFileToBackend(clip.file);
        if (vid.dataset.clipKey !== clipKeyNow) {
          releaseGuard();
          return;
        }
        if (uploaded?.url) {
          const nextUrl =
            needsBackendTranscodeFallback(clip?.fileName || clip?.title || uploaded.url) &&
            !uploaded.url.includes('_vlc.mp4')
              ? `/api/media/vlc-stream?url=${encodeURIComponent(uploaded.url)}`
              : uploaded.url;
          vid.dataset.triedVlcStream = 'true';
          vid.dataset.loadedUrl = nextUrl;
          vid.src = nextUrl;
          vid.load();
          vid.play().catch(() => {});
          releaseGuard();
          return;
        }
      }

      try {
        const parsed = new URL(vid.src, window.location.origin);
        if (
          (parsed.pathname.startsWith('/uploads/') ||
            parsed.pathname.startsWith('/api/media/by-name/')) &&
          vid.dataset.triedVlcStream !== 'true'
        ) {
          vid.dataset.triedVlcStream = 'true';
          const vlcUrl = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
          vid.dataset.loadedUrl = vlcUrl;
          vid.src = vlcUrl;
          vid.load();
          vid.play().catch(() => {});
          releaseGuard();
          return;
        }
      } catch {}

      if (vid.dataset.triedVaultFallback !== 'true' && clip) {
        vid.dataset.triedVaultFallback = 'true';
        const blobUrl = await restoreMediaUrlFromVault(
          clip.vaultId,
          clip.fileName || clip.title
        );
        if (vid.dataset.clipKey !== clipKeyNow) {
          releaseGuard();
          return;
        }
        if (blobUrl && blobUrl !== vid.src) {
          vid.dataset.loadedUrl = blobUrl;
          vid.src = blobUrl;
          vid.load();
          vid.play().catch(() => {});
          setChannels((prev) =>
            prev.map((c) => ({
              ...c,
              playlist: c.playlist.map((it) =>
                it.id === clip.id ? { ...it, url: blobUrl, videoUrl: blobUrl } : it
              ),
            }))
          );
          releaseGuard();
          return;
        }
      }

      // All fallbacks exhausted — skip corrupt / unsupported file cleanly to the next enabled clip
      releaseGuard();
      const chNow = channelRef.current;
      if (!chNow || chNow.status !== 'PLAYING') return;

      const enabledCount =
        deckKind === 'ad'
          ? Math.max(1, (chNow.everyNMinAds || []).filter((a) => a.enabled !== false).length) + 1
          : deckKind === 'prog'
          ? Math.max(
              1,
              (
                (chNow.scheduledPrograms || []).find((p) => p.id === chNow.activeProgramId)
                  ?.playlist || []
              ).filter((cl) => cl.enabled !== false).length
            ) + 1
          : (chNow.playlist || []).filter((cl) => cl.enabled !== false).length;

      consecutiveDeckFailRef.current += 1;
      if (shouldSkipUnplayableClip(consecutiveDeckFailRef.current, enabledCount)) {
        const randSeed = Math.random();
        setChannels((prev) =>
          prev.map((c) => advanceMainPlaybackOnClipEndEngine(c, clipKeyNow, randSeed))
        );
      } else if (deckKind === 'main') {
        consecutiveDeckFailRef.current = 0;
        setChannels((prev) =>
          prev.map((c) => (c.id === chNow.id ? { ...c, status: 'STOPPED' } : c))
        );
      }
    } catch {
      releaseGuard();
    }
  };

  const activeStudioAdNow = channel.activeEveryNMinAd;
  const activeStudioProgNow = channel.activeProgramId
    ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
    : undefined;
  const activeStudioProgClipNow =
    activeStudioProgNow?.playlist[channel.activeProgramClipIndex || 0];
  const activeStudioMainClipNow = channel.playlist[channel.currentClipIndex];
  const activeStudioClipNow = activeStudioAdNow
    ? activeStudioAdNow
    : activeStudioProgNow
    ? activeStudioProgClipNow
    : activeStudioMainClipNow;
  const activeStudioUrl = activeStudioClipNow?.videoUrl || activeStudioClipNow?.url || '';
  const activeStudioName = activeStudioClipNow?.fileName || activeStudioClipNow?.title || '';
  const isStudioSwfOrImgClip =
    Boolean(activeStudioUrl) &&
    (swfEngine.isSwfUrl(activeStudioUrl, activeStudioName) ||
      isImageUrl(activeStudioUrl, activeStudioName) ||
      (activeStudioClipNow as any)?.mediaType === 'image');
  const isStudioChannelActiveNow = channel.status !== 'STOPPED';
  const studioHardwareDeck: 'ad' | 'prog' | 'live' | 'main' | 'none' =
    !isStudioChannelActiveNow || isYouTubeLiveStageActive(channel)
      ? 'none'
      : activeStudioAdNow
      ? isStudioSwfOrImgClip || activeStudioAdNow.isTranscoding
        ? 'none'
        : 'ad'
      : activeStudioProgNow
      ? isStudioSwfOrImgClip || activeStudioProgClipNow?.isTranscoding
        ? 'none'
        : 'prog'
      : channel.liveInput?.active
      ? 'live'
      : activeStudioMainClipNow && !isStudioSwfOrImgClip && !activeStudioMainClipNow.isTranscoding
      ? 'main'
      : 'none';
  const useStudioHardwareVideoLayer = studioHardwareDeck !== 'none';
  const studioProgViewportRect = useStudioHardwareVideoLayer
    ? videoGenerator.calculateProgramViewportRect(channel, false)
    : { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };

  const isStudioVideoOccluded = activeModal === 'logos_overlays';

  const syncStudioVideoStageRect = React.useCallback(() => {
    const stageEl = studioVideoStageRef.current;
    if (!stageEl) return;
    if (isAppMinimized || isExternalOutputView || isStudioVideoOccluded) {
      stageEl.style.position = 'fixed';
      stageEl.style.left = '';
      stageEl.style.top = '';
      stageEl.style.right = '0px';
      stageEl.style.bottom = '0px';
      stageEl.style.width = '160px';
      stageEl.style.height = '90px';
      stageEl.style.opacity = '0.02';
      stageEl.style.zIndex = '1';
      return;
    }
    const targetEl = isMonitorFullscreen
      ? fullscreenStageBoxRef.current
      : monitorBoxElementRef.current;
    if (!targetEl) {
      stageEl.style.position = 'fixed';
      stageEl.style.left = '';
      stageEl.style.top = '';
      stageEl.style.right = '0px';
      stageEl.style.bottom = '0px';
      stageEl.style.width = '160px';
      stageEl.style.height = '90px';
      stageEl.style.opacity = '0.02';
      stageEl.style.zIndex = '1';
      return;
    }
    const rect = targetEl.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    stageEl.style.position = 'fixed';
    stageEl.style.right = '';
    stageEl.style.bottom = '';
    stageEl.style.left = `${Math.round(rect.left)}px`;
    stageEl.style.top = `${Math.round(rect.top)}px`;
    stageEl.style.width = `${Math.round(rect.width)}px`;
    stageEl.style.height = `${Math.round(rect.height)}px`;
    stageEl.style.opacity = '1';
    stageEl.style.zIndex = isMonitorFullscreen ? '10' : '15';
  }, [isAppMinimized, isExternalOutputView, isMonitorFullscreen, isStudioVideoOccluded]);

  const handleMonitorBoxElement = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (monitorBoxElementRef.current !== el) {
        monitorBoxElementRef.current = el;
      }
      if (el) {
        requestAnimationFrame(() => syncStudioVideoStageRect());
      }
    },
    [syncStudioVideoStageRect]
  );

  React.useLayoutEffect(() => {
    syncStudioVideoStageRect();
    const onResize = () => syncStudioVideoStageRect();
    window.addEventListener('resize', onResize);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => syncStudioVideoStageRect());
      if (monitorBoxElementRef.current) ro.observe(monitorBoxElementRef.current);
      if (fullscreenStageBoxRef.current) ro.observe(fullscreenStageBoxRef.current);
    }
    const rafId = requestAnimationFrame(() => syncStudioVideoStageRect());
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [syncStudioVideoStageRect]);

  const getStudioDeckVideoStyle = (deck: 'ad' | 'prog' | 'live' | 'main'): React.CSSProperties => {
    if (studioHardwareDeck === deck) {
      return {
        position: 'absolute',
        left: `${studioProgViewportRect.xPct}%`,
        top: `${studioProgViewportRect.yPct}%`,
        width: `${studioProgViewportRect.wPct}%`,
        height: `${studioProgViewportRect.hPct}%`,
        objectFit: 'fill',
        opacity: 1,
        zIndex: 2,
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

  const fullscreenRenderArgsRef = useRef({
    channel,
    activeVideoElement: getActiveDeckVideoElement(channel),
    activeOverlayVideoElement: overlayVideoRef.current,
    activeTopOverlayVideoElement: topOverlayVideoRef.current,
    activeLShapeVideoElement: lShapeVideoRef.current,
    transparentVideoStage: useStudioHardwareVideoLayer,
  });
  fullscreenRenderArgsRef.current = {
    channel,
    activeVideoElement: getActiveDeckVideoElement(channel),
    activeOverlayVideoElement: overlayVideoRef.current,
    activeTopOverlayVideoElement: topOverlayVideoRef.current,
    activeLShapeVideoElement: lShapeVideoRef.current,
    transparentVideoStage: useStudioHardwareVideoLayer,
  };

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      const stage = monitorFullscreenRef.current;
      setIsMonitorFullscreen(Boolean(fsEl && stage && (fsEl === stage || stage.contains(fsEl))));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!isMonitorFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        setIsMonitorFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    let running = true;
    let rafId = 0;
    const renderFsLoop = (timestamp: number) => {
      if (!running) return;
      const fsCanvas = fullscreenCanvasRef.current;
      if (fsCanvas) {
        const args = fullscreenRenderArgsRef.current;
        videoGenerator.renderChannelFrame(
          fsCanvas,
          args.channel,
          timestamp,
          args.activeVideoElement,
          args.activeOverlayVideoElement,
          args.activeTopOverlayVideoElement,
          args.activeLShapeVideoElement,
          {
            transparentVideoStage: Boolean(args.transparentVideoStage),
            stateScope: 'fs-',
          }
        );
      }
      rafId = requestAnimationFrame(renderFsLoop);
    };
    rafId = requestAnimationFrame(renderFsLoop);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMonitorFullscreen]);

  const handleToggleMonitorFullscreen = () => {
    const stage = monitorFullscreenRef.current;
    if (!stage) return;
    if (document.fullscreenElement || isMonitorFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      setIsMonitorFullscreen(false);
    } else {
      setIsMonitorFullscreen(true);
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {});
      }
    }
  };

  // Start authoritative 1920x1080 Master Broadcast Bus (Compositor + WebAudio Mixer + WebRTC 2nd Display Host)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('output=true')) {
      return;
    }
    masterBroadcastBus.startHost();
    return () => {
      masterBroadcastBus.stopHost();
    };
  }, []);

  // Keep Master Broadcast Bus snapshot synced only when routing/media/audio fields change (never every 1s tick)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('output=true')) {
      return;
    }
    masterBroadcastBus.updateSnapshot({
      channel,
      activeVideoElement: getActiveDeckVideoElement(channel),
      mainVideoElement: videoElementRef.current,
      programVideoElement: programVideoRef.current,
      adVideoElement: adVideoRef.current,
      liveVideoElement: liveVideoRef.current,
      overlayVideoElement: overlayVideoRef.current,
      topOverlayVideoElement: topOverlayVideoRef.current,
      lShapeVideoElement: lShapeVideoRef.current,
      cameraStream: cameraStreamRef.current,
    });
  }, [
    channel.status,
    channel.currentClipIndex,
    channel.loopCycle,
    channel.activeProgramId,
    channel.activeProgramClipIndex,
    channel.activeEveryNMinAd,
    channel.liveInput,
    channel.transmission.audio,
    liveCameraActive,
  ]);

  // Load persisted state from Backend & Offline IndexedDB Vault on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [serverData, vaultData, cgData] = await Promise.all([
          fetch('/api/playout/state')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          loadPlayoutStateFromVault().catch(() => null),
          fetchCgBackendState().catch(() => null),
        ]);

        if (cancelled) return;

        const serverChRaw =
          serverData && Array.isArray(serverData.channels) && serverData.channels.length > 0
            ? serverData.channels[0]
            : null;
        const vaultChRaw =
          vaultData && Array.isArray(vaultData.channels) && vaultData.channels.length > 0
            ? vaultData.channels[0]
            : null;

        const serverCh = serverChRaw
          ? normalizePersistedChannel(serverChRaw, INITIAL_CHANNELS[0])
          : null;
        const vaultCh = vaultChRaw
          ? normalizePersistedChannel(vaultChRaw, INITIAL_CHANNELS[0])
          : null;
        const localCh = channels[0] || INITIAL_CHANNELS[0];

        const serverUpdatedAt = Number(serverData?.updatedAtMs || 0);
        const vaultUpdatedAt = Number(vaultData?.updatedAtMs || 0);
        const hasTimestampedState = serverUpdatedAt > 0 || vaultUpdatedAt > 0;
        const primaryCh =
          serverUpdatedAt >= vaultUpdatedAt ? serverCh || vaultCh : vaultCh || serverCh;

        const pickRichestList = <T,>(a?: T[], b?: T[], c?: T[]): T[] => {
          if (hasTimestampedState && a !== undefined) {
            return a;
          }
          const candidates = [a || [], b || [], c || []];
          candidates.sort((x, y) => y.length - x.length);
          return candidates[0];
        };

        const mergedPlaylist = pickRichestList(
          primaryCh?.playlist,
          vaultCh?.playlist,
          localCh.playlist
        );
        const rawMergedPrograms = pickRichestList(
          primaryCh?.scheduledPrograms,
          vaultCh?.scheduledPrograms,
          localCh.scheduledPrograms
        );
        // Preserve completed / lastTriggeredDate status from any persistence layer so a completed program never re-triggers
        const allKnownProgs = [
          ...(serverCh?.scheduledPrograms || []),
          ...(vaultCh?.scheduledPrograms || []),
          ...(localCh.scheduledPrograms || []),
        ];
        const mergedPrograms = rawMergedPrograms.map((prog) => {
          const matches = allKnownProgs.filter((p) => p.id === prog.id);
          const isCompletedAnywhere = matches.some(
            (p) => p.completed || p.status === 'completed'
          );
          const latestTriggeredDate =
            matches.map((p) => p.lastTriggeredDate).find(Boolean) || prog.lastTriggeredDate;
          return {
            ...prog,
            completed: isCompletedAnywhere ? true : Boolean(prog.completed),
            status: isCompletedAnywhere ? ('completed' as const) : prog.status,
            lastTriggeredDate: latestTriggeredDate,
          };
        });
        const mergedAds = pickRichestList(
          primaryCh?.everyNMinAds,
          Array.isArray(serverData?.everyNMinAds) ? serverData.everyNMinAds : vaultCh?.everyNMinAds,
          localCh.everyNMinAds
        );

        const pickOverlay = (
          a: OverlayBannerConfig | undefined,
          b: OverlayBannerConfig | undefined,
          c: OverlayBannerConfig | undefined,
          fallbackOv?: OverlayBannerConfig
        ) => {
          if (hasTimestampedState && a) return a;
          const countUserItems = (ov?: OverlayBannerConfig) =>
            (ov?.playlist || []).filter((it) => !String(it.url || '').startsWith('data:image/svg+xml'))
              .length;
          const candidates = [a, b, c].filter(Boolean) as OverlayBannerConfig[];
          candidates.sort((x, y) => countUserItems(y) - countUserItems(x));
          return candidates[0] || fallbackOv;
        };

        const cgUpdatedAt = Number(cgData?.updatedAtMs || 0);
        const useCgBackend = Boolean(
          cgData &&
            (cgUpdatedAt >= serverUpdatedAt || !serverCh) &&
            (cgData.bottomOverlay || cgData.topOverlay || cgData.lShape || cgData.graphics)
        );
        const cgNormalized = useCgBackend
          ? normalizePersistedChannel(
              {
                bottomOverlay: cgData?.bottomOverlay,
                topOverlay: cgData?.topOverlay,
                lShape: cgData?.lShape,
                graphics: cgData?.graphics,
              },
              INITIAL_CHANNELS[0]
            )
          : null;

        const mergedBot =
          (useCgBackend && cgData?.bottomOverlay ? cgNormalized?.bottomOverlay : null) ||
          pickOverlay(
            primaryCh?.bottomOverlay,
            vaultCh?.bottomOverlay,
            localCh.bottomOverlay,
            localCh.bottomOverlay
          );
        const mergedTop =
          (useCgBackend && cgData?.topOverlay ? cgNormalized?.topOverlay : null) ||
          pickOverlay(
            primaryCh?.topOverlay,
            vaultCh?.topOverlay,
            localCh.topOverlay,
            localCh.topOverlay
          );

        const pickLShape = (a?: LShapeConfig, b?: LShapeConfig, c?: LShapeConfig) => {
          if (hasTimestampedState && a) return a;
          const candidates = [a, b, c].filter(Boolean) as LShapeConfig[];
          candidates.sort((x, y) => (y.playlist?.length || 0) - (x.playlist?.length || 0));
          return candidates[0] || localCh.lShape;
        };

        const mergedLShape =
          (useCgBackend && cgData?.lShape ? cgNormalized?.lShape : null) ||
          pickLShape(primaryCh?.lShape, vaultCh?.lShape, localCh.lShape);

        const baseGraphics: any = {
          ...localCh.graphics,
          ...(vaultCh?.graphics || {}),
          ...(serverCh?.graphics || {}),
          ...(useCgBackend && cgNormalized?.graphics ? cgNormalized.graphics : {}),
        };
        const pickLogo = (key: string) => {
          const cgLogo = useCgBackend ? (cgNormalized?.graphics as any)?.[key] : null;
          if (cgLogo) return cgLogo;
          const pLogo = (primaryCh?.graphics as any)?.[key];
          if (hasTimestampedState && pLogo) return pLogo;
          const sLogo = (serverCh?.graphics as any)?.[key];
          const vLogo = (vaultCh?.graphics as any)?.[key];
          const lLogo = (localCh.graphics as any)?.[key];
          const candidates = [sLogo, vLogo, lLogo].filter(Boolean);
          candidates.sort((x, y) => (y.playlist?.length || 0) - (x.playlist?.length || 0));
          return candidates[0] || lLogo;
        };
        baseGraphics.channelLogo = pickLogo('channelLogo');
        baseGraphics.sponsorLogo1 = pickLogo('sponsorLogo1');
        baseGraphics.sponsorLogo2 = pickLogo('sponsorLogo2');
        baseGraphics.sponsorLogo3 = pickLogo('sponsorLogo3');
        baseGraphics.sponsorLogo4 = pickLogo('sponsorLogo4');

        const baseCh: TVChannel = {
          ...(vaultCh || localCh),
          ...(serverCh || {}),
          graphics: baseGraphics,
          playlist: mergedPlaylist,
          scheduledPrograms: mergedPrograms,
          everyNMinAds: mergedAds,
          bottomOverlay: mergedBot,
          topOverlay: mergedTop,
          lShape: mergedLShape,
          status:
            mergedPlaylist.length > 0 ||
            Boolean(serverCh?.liveInput?.active || localCh.liveInput?.active) ||
            Boolean(serverCh?.activeProgramId || localCh.activeProgramId)
              ? 'PLAYING'
              : 'STOPPED',
        };

        // Hydrate all media URLs from Offline Vault & Backend so every file & folder plays after any number of restarts
        const hydrated = await hydrateChannelsAndAdsFromVault([baseCh], mergedAds);
        if (cancelled) return;

        const hydratedCh = hydrated.channels[0] || baseCh;
        const hydratedAds =
          (hydrated.everyNMinAds && hydrated.everyNMinAds.length > 0
            ? hydrated.everyNMinAds
            : hydratedCh.everyNMinAds) || [];

        if (!hasUserInteractedRef.current && typeof hydratedCh.currentTime === 'number' && hydratedCh.currentTime > 0.05) {
          pendingResumeSeekRef.current = hydratedCh.currentTime;
        }

        setChannels((prev) => {
          const currentLive = prev[0] || hydratedCh;
          const useLive = hasUserInteractedRef.current;
          const useLivePlaylist =
            useLive || currentLive.playlist.length > hydratedCh.playlist.length;
          const finalPlaylist = useLivePlaylist
            ? currentLive.playlist
            : hydratedCh.playlist.map((hItem: PlaylistItem) => {
                const liveMatch = currentLive.playlist.find((l) => l.id === hItem.id);
                return liveMatch && liveMatch.url?.startsWith('blob:') ? liveMatch : hItem;
              });
          const targetIdx = useLive
            ? currentLive.currentClipIndex || 0
            : hydratedCh.currentClipIndex || 0;
          const safeIdx = Math.max(
            0,
            Math.min(Math.max(0, finalPlaylist.length - 1), targetIdx)
          );
          const restoredTime = useLive
            ? currentLive.currentTime || 0
            : hydratedCh.currentTime || 0;
          const restoredLiveInput = useLive ? currentLive.liveInput : hydratedCh.liveInput;
          const restoredSavedMain = useLive
            ? currentLive.savedMainPlaybackState
            : hydratedCh.savedMainPlaybackState;
          return [
            {
              ...hydratedCh,
              ...currentLive,
              loopMode: (useLive ? currentLive.loopMode : hydratedCh.loopMode) === 'off' ? 'off' : 'playlist',
              loopFolders: [],
              playlist: finalPlaylist,
              currentClipIndex: safeIdx,
              currentTime: restoredTime,
              savedMainPlaybackState: restoredSavedMain,
              liveInput: restoredLiveInput,
              scheduledPrograms:
                useLive ||
                (currentLive.scheduledPrograms &&
                  currentLive.scheduledPrograms.length >
                    (hydratedCh.scheduledPrograms?.length || 0))
                  ? currentLive.scheduledPrograms
                  : hydratedCh.scheduledPrograms,
              everyNMinAds: useLive ? currentLive.everyNMinAds : hydratedAds,
              bottomOverlay: useLive ? currentLive.bottomOverlay : hydratedCh.bottomOverlay,
              topOverlay: useLive ? currentLive.topOverlay : hydratedCh.topOverlay,
              lShape: useLive ? currentLive.lShape : hydratedCh.lShape,
              graphics: useLive ? currentLive.graphics : hydratedCh.graphics,
              status:
                !useLive && hydratedCh.status === 'PAUSED'
                  ? 'PAUSED'
                  : finalPlaylist.length > 0 ||
                    Boolean(restoredLiveInput?.active) ||
                    Boolean(currentLive.activeProgramId)
                  ? 'PLAYING'
                  : 'STOPPED',
            },
          ];
        });

        const sourceMeta = serverData || vaultData;
        if (sourceMeta) {
          if (typeof sourceMeta.everyNMinEnabled === 'boolean') {
            setEveryNMinEnabled(sourceMeta.everyNMinEnabled);
          } else if (hydratedAds.length > 0) {
            setEveryNMinEnabled(true);
          }
          if (sourceMeta.everyNMinInterval) {
            setEveryNMinInterval(sourceMeta.everyNMinInterval);
          }
          const loadedLicRecord =
            (serverData?.licenseRecord && verifyLicenseSignature(serverData.licenseRecord)
              ? serverData.licenseRecord
              : null) ||
            (vaultData?.licenseRecord && verifyLicenseSignature(vaultData.licenseRecord)
              ? vaultData.licenseRecord
              : null) ||
            licenseRecord;
          if (loadedLicRecord) {
            setLicenseRecord(loadedLicRecord);
            const liveEval = evaluateLicenseStatus(loadedLicRecord);
            setIsLicensed(liveEval.isValidAndActive);
            setChannels((prev) =>
              prev.map((c) => ({
                ...c,
                graphics: {
                  ...c.graphics,
                  demoWatermarkEnabled: !liveEval.isValidAndActive,
                  licenseRecord: loadedLicRecord,
                } as any,
              }))
            );
          } else {
            setIsLicensed(false);
            setChannels((prev) =>
              prev.map((c) => ({
                ...c,
                graphics: {
                  ...c.graphics,
                  demoWatermarkEnabled: true,
                } as any,
              }))
            );
          }
        }
      } catch {
        // Ignore hydration errors
      } finally {
        hasHydratedFromServerRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Real-time 1-second Expiry Date watchdog: immediately enables DEMO badge the moment Expiry Date is over!
  useEffect(() => {
    const checkExpiry = () => {
      const evaluated = evaluateLicenseStatus(licenseRecord, Date.now());
      const validNow = evaluated.isValidAndActive;
      setIsLicensed((prev) => (prev === validNow ? prev : validNow));
      setChannels((prev) =>
        prev.map((c) => {
          const gAny = c.graphics as any;
          const shouldShowDemo = !validNow;
          if (
            gAny.demoWatermarkEnabled === shouldShowDemo &&
            gAny.licenseRecord === licenseRecord
          ) {
            return c;
          }
          return {
            ...c,
            graphics: {
              ...c.graphics,
              demoWatermarkEnabled: shouldShowDemo,
              licenseRecord,
            } as any,
          };
        })
      );
    };
    checkExpiry();
    const timer = setInterval(checkExpiry, 1000);
    return () => clearInterval(timer);
  }, [licenseRecord]);

  // Keep DEMO watermark on Live Output 100% synced with Active License state
  useEffect(() => {
    setChannels((prev) =>
      prev.map((c) => {
        const shouldShowDemo = !isLicensed;
        if ((c.graphics as any).demoWatermarkEnabled === shouldShowDemo) return c;
        return {
          ...c,
          graphics: {
            ...c.graphics,
            demoWatermarkEnabled: shouldShowDemo,
            licenseRecord,
          } as any,
        };
      })
    );
  }, [isLicensed, licenseRecord]);

  // Helper to build clean serializable channels array for localStorage & Backend
  // Never drops uploaded files or folders even if background transcoding is still in progress!
  const buildSerializableChannels = (chs: TVChannel[]) =>
    chs.slice(0, 1).map((ch) => {
      const prepared = {
        ...ch,
        loopMode: ch.loopMode === 'off' ? 'off' : 'playlist',
        loopFolders: [],
        activeEveryNMinAd: null,
        everyNMinQueue: [],
        activeProgramId: null,
        playlist: (ch.playlist || [])
          .map(({ file, ...rest }) => {
            const resolved = resolvePersistedUrl(
              (rest as any).serverUrl || rest.url || rest.videoUrl,
              rest.fileName || rest.title
            );
            return {
              ...rest,
              url: resolved,
              isTranscoding: false,
            };
          })
          .filter((it) => Boolean(it.url)),
        scheduledPrograms: (ch.scheduledPrograms || []).map((p) => ({
          ...p,
          playlist: (p.playlist || [])
            .map(({ file, ...rest }) => {
              const resolved = resolvePersistedUrl(
                (rest as any).serverUrl || rest.url || rest.videoUrl,
                rest.fileName || rest.title
              );
              return {
                ...rest,
                url: resolved,
                isTranscoding: false,
              };
            })
            .filter((it) => Boolean(it.url)),
        })),
        everyNMinAds: (ch.everyNMinAds || [])
          .map(({ file, ...rest }) => {
            const resolved = resolvePersistedUrl(
              (rest as any).serverUrl || rest.url || rest.videoUrl,
              rest.fileName || rest.title
            );
            return {
              ...rest,
              url: resolved,
              isTranscoding: false,
            };
          })
          .filter((it) => Boolean(it.url)),
        bottomOverlay: ch.bottomOverlay
          ? {
              ...ch.bottomOverlay,
              playlist: (ch.bottomOverlay.playlist || [])
                .map(({ file, ...rest }) => ({
                  ...rest,
                  url: resolvePersistedUrl(rest.url, rest.fileName || rest.title),
                }))
                .filter((it) => Boolean(it.url)),
            }
          : ch.bottomOverlay,
        topOverlay: ch.topOverlay
          ? {
              ...ch.topOverlay,
              playlist: (ch.topOverlay.playlist || [])
                .map(({ file, ...rest }) => ({
                  ...rest,
                  url: resolvePersistedUrl(rest.url, rest.fileName || rest.title),
                }))
                .filter((it) => Boolean(it.url)),
            }
          : ch.topOverlay,
        lShape: ch.lShape
          ? {
              ...ch.lShape,
              playlist: (ch.lShape.playlist || [])
                .map(({ file, ...rest }) => ({
                  ...rest,
                  url: resolvePersistedUrl(rest.url, (rest as any).fileName || rest.title),
                }))
                .filter((it) => Boolean(it.url)),
            }
          : ch.lShape,
        graphics: (() => {
          const g: any = { ...ch.graphics };
          const cleanLogo = (logo: any) => {
            if (!logo) return logo;
            const next = { ...logo };
            if (next.url) {
              next.url = resolvePersistedUrl(next.url, next.fileName || next.label);
            }
            if (Array.isArray(next.playlist)) {
              next.playlist = next.playlist
                .map(({ file, ...rest }: any) => ({
                  ...rest,
                  url: resolvePersistedUrl(rest.url, rest.fileName || rest.title || rest.label),
                }))
                .filter((it: any) => Boolean(it.url));
            }
            return next;
          };
          g.channelLogo = cleanLogo(g.channelLogo);
          g.sponsorLogo1 = cleanLogo(g.sponsorLogo1 || g.sponsor1Logo);
          g.sponsorLogo2 = cleanLogo(g.sponsorLogo2 || g.sponsor2Logo);
          g.sponsorLogo3 = cleanLogo(g.sponsorLogo3);
          g.sponsorLogo4 = cleanLogo(g.sponsorLogo4);
          return g;
        })(),
      };
      return compactChannel(prepared, { keepActiveLiveState: false });
    });

  // Explicit Save Channel & CG to Backend, Offline IndexedDB Vault & localStorage
  const handleSaveChannel = () => {
    try {
      const sanitized = buildSerializableChannels(channels);
      const validLic = evaluateLicenseStatus(licenseRecord).isValidAndActive;
      const payload = compactPlayoutStateEnvelope({
        channels: sanitized,
        everyNMinEnabled,
        everyNMinInterval,
        licenseRecord,
        isLicensed: validLic,
        updatedAtMs: Date.now(),
      });
      localStorage.setItem('ashoka_playlist_playout_v15', JSON.stringify(sanitized));
      localStorage.setItem(
        'ashoka_playlist_meta_v15',
        JSON.stringify({
          everyNMinEnabled,
          everyNMinInterval,
          licenseRecord,
          isLicensed: validLic,
        })
      );
      savePlayoutStateToVault(payload).catch(() => {});
      fetch('/api/playout/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
      if (channels[0]) {
        saveCgBackendState(channels[0]).catch(() => {});
      }
    } catch {}
  };

  const stripVolatileLogoTimes = (g: any) => {
    if (!g || typeof g !== 'object') return g;
    const stripLogo = (lg: any) => (lg && typeof lg === 'object' ? { ...lg, currentTime: 0 } : lg);
    return {
      ...g,
      channelLogo: stripLogo(g.channelLogo),
      sponsorLogo1: stripLogo(g.sponsorLogo1),
      sponsorLogo2: stripLogo(g.sponsorLogo2),
      sponsorLogo3: stripLogo(g.sponsorLogo3),
      sponsorLogo4: stripLogo(g.sponsorLogo4),
    };
  };

  // Dedicated CG Backend Auto-Sync (debounced, ignores 1Hz logo/banner currentTime ticks)
  useEffect(() => {
    if (!hasHydratedFromServerRef.current) return;
    const ch = channels[0];
    if (!ch) return;
    const cgStructSig = JSON.stringify({
      bo: ch.bottomOverlay ? { ...ch.bottomOverlay, currentTime: 0 } : null,
      to: ch.topOverlay ? { ...ch.topOverlay, currentTime: 0 } : null,
      ls: ch.lShape ? { ...ch.lShape, currentTime: 0, periodicCounter: 0 } : null,
      gr: stripVolatileLogoTimes(ch.graphics),
    });
    if (cgStructSig === lastCgSavedSigRef.current) return;
    lastCgSavedSigRef.current = cgStructSig;

    const t = setTimeout(() => {
      const currentCh = syncStateRef.current.channels[0];
      if (currentCh) {
        saveCgBackendState(currentCh).catch(() => {});
      }
    }, 300);
    return () => clearTimeout(t);
  }, [channel.graphics, channel.bottomOverlay, channel.topOverlay, channel.lShape]);

  // Auto-persist state to localStorage & Backend ONLY on structural changes or every 15s checkpoint (avoids 1Hz JSON/disk stutter)
  useEffect(() => {
    const ch = channels[0];
    const structSig = ch
      ? JSON.stringify({
          st: ch.status,
          ci: ch.currentClipIndex,
          lc: ch.loopCycle,
          pl: computeFastPlaylistSignature(ch.playlist, ch.currentClipIndex),
          sp: (ch.scheduledPrograms || []).map(
            (p) =>
              `${p.id}:${p.enabled}:${p.status}:${p.completed}:${p.startDate}:${p.startTime}:${p.overlayMode}:${computeFastPlaylistSignature(p.playlist, 0)}`
          ),
          api: ch.activeProgramId,
          apci: ch.activeProgramClipIndex,
          ena: (ch.everyNMinAds || []).map(
            (a) => `${a.id}:${a.enabled}:${a.duration}:${Boolean((a as any).serverUrl)}`
          ),
          aena: ch.activeEveryNMinAd?.id || null,
          bo: ch.bottomOverlay
            ? { ...ch.bottomOverlay, currentTime: 0 }
            : null,
          to: ch.topOverlay ? { ...ch.topOverlay, currentTime: 0 } : null,
          ls: ch.lShape
            ? { ...ch.lShape, currentTime: 0, periodicCounter: 0 }
            : null,
          gr: stripVolatileLogoTimes(ch.graphics),
          tr: ch.transmission,
          li: ch.liveInput,
          ee: everyNMinEnabled,
          ei: everyNMinInterval,
          il: isLicensed,
          lr: licenseRecord,
        })
      : '';
    const now = Date.now();
    const isStructuralChange = structSig !== lastSavedStructSigRef.current;
    const isCheckpointDue = now - lastStateSaveAtRef.current >= 15000;
    if (!isStructuralChange && !isCheckpointDue) {
      return;
    }
    lastSavedStructSigRef.current = structSig;
    lastStateSaveAtRef.current = now;

    try {
      const sanitized = buildSerializableChannels(channels);
      const validLic = evaluateLicenseStatus(licenseRecord).isValidAndActive;
      localStorage.setItem('ashoka_playlist_playout_v15', JSON.stringify(sanitized));
      localStorage.setItem(
        'ashoka_playlist_meta_v15',
        JSON.stringify({
          everyNMinEnabled,
          everyNMinInterval,
          licenseRecord,
          isLicensed: validLic,
        })
      );
    } catch {}
    if (!hasHydratedFromServerRef.current) return;
    const t = setTimeout(() => {
      handleSaveChannel();
    }, 350);
    return () => clearTimeout(t);
  }, [channels, everyNMinEnabled, everyNMinInterval, isLicensed, licenseRecord]);

  // Automatically unlock and play broadcast audio & enter full screen on software launch/interaction
  useEffect(() => {
    let didAutoFs = false;
    // Attempt immediate fullscreen on mount (works in desktop/kiosk/app window contexts)
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    const unlock = (e?: Event) => {
      hasUserInteractedRef.current = true;
      broadcastAudio.init();
      masterBroadcastBus.unlockAudio();
      const targetEl = e?.target as HTMLElement | null;
      const isFileOrInputTrigger = Boolean(
        targetEl?.closest('input, select, textarea, a, [data-no-autofs]')
      );
      if (!didAutoFs && !document.fullscreenElement && !isFileOrInputTrigger) {
        didAutoFs = true;
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
      const vid = getActiveDeckVideoElement(channel);
      if (vid) {
        const shouldMuteSoft = isSoftwareAudioMuted(channel.transmission.audio);
        if (!shouldMuteSoft) {
          vid.muted = false;
          vid.volume = Math.max(0.1, Math.min(1, channel.transmission.audio.masterVolume ?? 0.9));
        } else {
          vid.muted = true;
        }
        if (channel.status === 'PLAYING' && vid.paused) {
          vid.play().catch(() => {});
        }
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('mousedown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('click', unlock);
    };
  }, [
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
    channel.status,
    channel.activeEveryNMinAd,
    channel.activeProgramId,
  ]);

  // Deck 1: Sync MAIN PLAYLIST video element (videoElementRef)
  // NEVER unloads when interrupted by Live Input, a Scheduled Program, or Every N Min Ad — pauses in-place at the exact frame for 0ms instant resume!
  useEffect(() => {
    const el = videoElementRef.current;
    if (!el) return;

    const activeAd = channel.activeEveryNMinAd;
    const activeProg = channel.activeProgramId
      ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
      : undefined;
    const live = channel.liveInput;

    // If a Scheduled Program, Every N Min Ad, or Live Input is active,
    // keep the Main Playlist video element paused in-place at its exact decoded frame (DO NOT unload or reset to Frame 1!)
    if (activeAd || activeProg || live?.active) {
      if (!el.paused) {
        el.pause();
      }
      el.muted = true;
      return;
    }

    // Clean up HLS or MediaStream when playing Main Playlist
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (el.srcObject) {
      el.srcObject = null;
    }

    const clip = channel.playlist[channel.currentClipIndex];
    if (!clip || clip.enabled === false) {
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      delete el.dataset.triedVlcStream;
      return;
    }
    const clipUrl = clip?.url || clip?.videoUrl || '';
    const isSwfOrImage =
      swfEngine.isSwfUrl(clipUrl, clip?.fileName || clip?.title) ||
      isImageUrl(clipUrl, clip?.fileName || clip?.title);

    const clipBaseId = `main:${clip?.id || ''}:${channel.currentClipIndex}`;
    const clipCycleKey = `${clipBaseId}:cycle:${channel.loopCycle || 0}`;

    if (!clipUrl || isSwfOrImage) {
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      delete el.dataset.triedVlcStream;
      return;
    }

    const isSameClipInstance = el.dataset.clipBaseId === clipBaseId;
    const isSameCycleKey = el.dataset.clipKey === clipCycleKey;
    const previousLoadedUrl = el.dataset.loadedUrl || '';

    const isAlreadyPlayingHealthy =
      isSameClipInstance &&
      !el.error &&
      el.readyState >= 2 &&
      el.videoWidth > 0 &&
      !el.paused &&
      !el.ended;

    const isTranscodedServerUpgrade =
      isSameClipInstance &&
      previousLoadedUrl !== clipUrl &&
      previousLoadedUrl.startsWith('blob:') &&
      !clipUrl.startsWith('blob:') &&
      (Boolean((clip as any)?.transcoded) || clipUrl.includes('_vlc.mp4'));

    const isVaultHydratedUpgrade =
      isTranscodedServerUpgrade ||
      (!isAlreadyPlayingHealthy &&
        previousLoadedUrl !== clipUrl &&
        (clipUrl.startsWith('blob:') ||
          previousLoadedUrl.startsWith('/api/media/by-name/') ||
          !previousLoadedUrl));

    const needsDecoderFallbackUpgrade =
      isSameClipInstance &&
      clipUrl.startsWith('/uploads/') &&
      !el.src.includes(clipUrl) &&
      (Boolean(el.error) || (el.readyState >= 2 && el.videoWidth === 0));

    el.loop = false;

    if (!isSameCycleKey || isVaultHydratedUpgrade || needsDecoderFallbackUpgrade) {
      const preserveCurrentSec =
        (needsDecoderFallbackUpgrade || (isVaultHydratedUpgrade && isSameClipInstance)) &&
        el.currentTime > 0
          ? el.currentTime
          : null;

      const resumeTarget = resolveDeckResumeTargetSec({
        preserveCurrentSec,
        pendingResumeSeekSec: pendingResumeSeekRef.current,
        channelTimeSec: channel.currentTime,
      });

      if (preserveCurrentSec === null) {
        pendingResumeSeekRef.current = null;
      }

      el.dataset.clipKey = clipCycleKey;
      el.dataset.clipBaseId = clipBaseId;
      el.dataset.loadedUrl = clipUrl;

      const alreadyHasSameValidSrc =
        isSameClipInstance &&
        !isVaultHydratedUpgrade &&
        !needsDecoderFallbackUpgrade &&
        !el.error &&
        el.readyState >= 1 &&
        Boolean(el.src);

      if (alreadyHasSameValidSrc) {
        // If already paused at the exact resume position after a Program or Every N Min Ad,
        // DO NOT reassign el.currentTime (which causes a keyframe seek / 1s stick) — just play immediately!
        if (
          shouldKeepExistingVideoFrameInPlace({
            alreadyHasSameValidSrc,
            currentVideoSec: el.currentTime,
            resumeTargetSec: resumeTarget,
            isVideoEnded: el.ended,
          })
        ) {
          delete el.dataset.isSeekingResume;
          delete el.dataset.targetResumeSec;
          activeSeekOnMetadataRef.current = null;
        } else {
          if (resumeTarget > 0.05) {
            el.dataset.isSeekingResume = 'true';
            el.dataset.targetResumeSec = String(resumeTarget);
          } else {
            delete el.dataset.isSeekingResume;
            delete el.dataset.targetResumeSec;
          }
          el.currentTime = resumeTarget;
          activeSeekOnMetadataRef.current = null;
        }
      } else {
        delete el.dataset.triedVlcStream;
        delete el.dataset.triedVaultFallback;
        delete el.dataset.triedServerFallback;
        delete el.dataset.triedUploadFallback;
        delete el.dataset.recoveringClipKey;
        if (resumeTarget > 0.05) {
          el.dataset.isSeekingResume = 'true';
          el.dataset.targetResumeSec = String(resumeTarget);
          activeSeekOnMetadataRef.current = resumeTarget;
        } else {
          delete el.dataset.isSeekingResume;
          delete el.dataset.targetResumeSec;
          activeSeekOnMetadataRef.current = null;
        }
        el.src = clipUrl;
        el.load();
        triggerLegacyBlobUploadIfNeeded(el, clipBaseId, clip, clipUrl);
      }
    }

    el.volume = Math.max(0.1, Math.min(1, channel.transmission.audio.masterVolume ?? 0.9));
    el.muted = isSoftwareAudioMuted(channel.transmission.audio);

    if (channel.status === 'PLAYING') {
      if (el.paused) {
        el.play().catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }
    } else {
      if (!el.paused) {
        el.pause();
      }
    }
  }, [
    channel.playlist,
    channel.currentClipIndex,
    channel.loopCycle,
    channel.status,
    channel.activeProgramId,
    channel.scheduledPrograms,
    channel.activeEveryNMinAd,
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
    channel.liveInput,
    liveCameraActive,
  ]);

  // Deck 2: Sync SCHEDULED PROGRAM PLAYLIST video element (programVideoRef)
  // Pauses in-place when interrupted by an Every N Min Ad so it resumes in 0ms without showing Frame 1!
  useEffect(() => {
    const el = programVideoRef.current;
    if (!el) return;

    const activeAd = channel.activeEveryNMinAd;
    const activeProg = channel.activeProgramId
      ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
      : undefined;

    if (!activeProg || activeProg.enabled === false) {
      el.pause();
      if (el.getAttribute('src')) {
        el.removeAttribute('src');
      }
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      delete el.dataset.loadedUrl;
      delete el.dataset.isSeekingResume;
      delete el.dataset.targetResumeSec;
      return;
    }

    // If an Every N Min Ad or Live Input interrupts the active Program Playlist, pause programVideoRef in-place at its exact frame!
    if (activeAd || channel.liveInput?.active) {
      if (!el.paused) {
        el.pause();
      }
      el.muted = true;
      return;
    }

    const pIdx = channel.activeProgramClipIndex || 0;
    const clip = activeProg.playlist[pIdx];
    if (!clip || clip.enabled === false) {
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      return;
    }
    const clipUrl = clip?.url || clip?.videoUrl || '';
    const isSwfOrImage =
      swfEngine.isSwfUrl(clipUrl, clip?.fileName || clip?.title) ||
      isImageUrl(clipUrl, clip?.fileName || clip?.title);

    const clipBaseId = `prog:${activeProg.id}:${pIdx}`;
    const clipCycleKey = `${clipBaseId}:cycle:${channel.loopCycle || 0}`;

    if (!clipUrl || isSwfOrImage) {
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      return;
    }

    const isSameClipInstance = el.dataset.clipBaseId === clipBaseId;
    const isSameCycleKey = el.dataset.clipKey === clipCycleKey;
    const previousLoadedUrl = el.dataset.loadedUrl || '';
    const isAlreadyPlayingHealthy =
      isSameClipInstance &&
      !el.error &&
      el.readyState >= 2 &&
      el.videoWidth > 0 &&
      !el.paused &&
      !el.ended;
    const isTranscodedServerUpgrade =
      isSameClipInstance &&
      previousLoadedUrl !== clipUrl &&
      previousLoadedUrl.startsWith('blob:') &&
      !clipUrl.startsWith('blob:') &&
      (Boolean((clip as any)?.transcoded) || clipUrl.includes('_vlc.mp4'));
    const isVaultHydratedUpgrade =
      isTranscodedServerUpgrade ||
      (!isAlreadyPlayingHealthy &&
        previousLoadedUrl !== clipUrl &&
        (clipUrl.startsWith('blob:') ||
          previousLoadedUrl.startsWith('/api/media/by-name/') ||
          !previousLoadedUrl));

    el.loop = false;

    if (!isSameCycleKey || isVaultHydratedUpgrade) {
      const preserveCurrentSec =
        isVaultHydratedUpgrade && isSameClipInstance && el.currentTime > 0 ? el.currentTime : null;
      const resumeTarget = resolveDeckResumeTargetSec({
        preserveCurrentSec,
        pendingResumeSeekSec: pendingProgResumeSeekRef.current,
        channelTimeSec: channel.activeProgramTime,
      });
      if (preserveCurrentSec === null) {
        pendingProgResumeSeekRef.current = null;
      }

      el.dataset.clipKey = clipCycleKey;
      el.dataset.clipBaseId = clipBaseId;
      el.dataset.loadedUrl = clipUrl;

      const alreadyHasSameValidSrc =
        isSameClipInstance &&
        !isVaultHydratedUpgrade &&
        !el.error &&
        el.readyState >= 1 &&
        Boolean(el.src);

      if (alreadyHasSameValidSrc) {
        if (
          shouldKeepExistingVideoFrameInPlace({
            alreadyHasSameValidSrc,
            currentVideoSec: el.currentTime,
            resumeTargetSec: resumeTarget,
            isVideoEnded: el.ended,
          })
        ) {
          delete el.dataset.isSeekingResume;
          delete el.dataset.targetResumeSec;
          activeProgSeekOnMetadataRef.current = null;
        } else {
          if (resumeTarget > 0.05) {
            el.dataset.isSeekingResume = 'true';
            el.dataset.targetResumeSec = String(resumeTarget);
          } else {
            delete el.dataset.isSeekingResume;
            delete el.dataset.targetResumeSec;
          }
          el.currentTime = resumeTarget;
          activeProgSeekOnMetadataRef.current = null;
        }
      } else {
        delete el.dataset.triedVlcStream;
        delete el.dataset.triedVaultFallback;
        delete el.dataset.triedServerFallback;
        delete el.dataset.triedUploadFallback;
        delete el.dataset.recoveringClipKey;
        if (resumeTarget > 0.05) {
          el.dataset.isSeekingResume = 'true';
          el.dataset.targetResumeSec = String(resumeTarget);
          activeProgSeekOnMetadataRef.current = resumeTarget;
        } else {
          delete el.dataset.isSeekingResume;
          delete el.dataset.targetResumeSec;
          activeProgSeekOnMetadataRef.current = null;
        }
        el.src = clipUrl;
        el.load();
        triggerLegacyBlobUploadIfNeeded(el, clipBaseId, clip, clipUrl);
      }
    }

    el.volume = Math.max(0.1, Math.min(1, channel.transmission.audio.masterVolume ?? 0.9));
    el.muted = isSoftwareAudioMuted(channel.transmission.audio);

    if (channel.status === 'PLAYING') {
      if (el.paused) {
        el.play().catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }
    } else if (!el.paused) {
      el.pause();
    }
  }, [
    channel.activeProgramId,
    channel.activeProgramClipIndex,
    channel.scheduledPrograms,
    channel.activeEveryNMinAd,
    channel.loopCycle,
    channel.status,
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
  ]);

  // Deck 3: Sync EVERY N MIN COMMERCIAL AD video element (adVideoRef)
  useEffect(() => {
    const el = adVideoRef.current;
    if (!el) return;

    const activeAd = channel.activeEveryNMinAd;
    if (!activeAd || activeAd.enabled === false) {
      el.pause();
      if (el.getAttribute('src')) {
        el.removeAttribute('src');
      }
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      delete el.dataset.loadedUrl;
      return;
    }

    const clipUrl = activeAd.url || activeAd.videoUrl || '';
    const isSwfOrImage =
      swfEngine.isSwfUrl(clipUrl, activeAd.fileName || activeAd.title) ||
      isImageUrl(clipUrl, activeAd.fileName || activeAd.title);
    const clipBaseId = `ad:${activeAd.id}`;
    const clipCycleKey = `${clipBaseId}:cycle:${channel.loopCycle || 0}`;

    if (!clipUrl || isSwfOrImage) {
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.clipBaseId;
      return;
    }

    const isSameClipInstance = el.dataset.clipBaseId === clipBaseId;
    const isSameCycleKey = el.dataset.clipKey === clipCycleKey;
    const previousLoadedUrl = el.dataset.loadedUrl || '';
    const isAlreadyPlayingHealthy =
      isSameClipInstance &&
      !el.error &&
      el.readyState >= 2 &&
      el.videoWidth > 0 &&
      !el.paused &&
      !el.ended;
    const isTranscodedServerUpgrade =
      isSameClipInstance &&
      previousLoadedUrl !== clipUrl &&
      previousLoadedUrl.startsWith('blob:') &&
      !clipUrl.startsWith('blob:') &&
      (Boolean((activeAd as any)?.transcoded) || clipUrl.includes('_vlc.mp4'));
    const isVaultHydratedUpgrade =
      isTranscodedServerUpgrade ||
      (!isAlreadyPlayingHealthy &&
        previousLoadedUrl !== clipUrl &&
        (clipUrl.startsWith('blob:') ||
          previousLoadedUrl.startsWith('/api/media/by-name/') ||
          !previousLoadedUrl));

    el.loop = false;

    if (!isSameCycleKey || isVaultHydratedUpgrade) {
      const preserveSec =
        isVaultHydratedUpgrade && isSameClipInstance && el.currentTime > 0.1 ? el.currentTime : 0;
      el.dataset.clipKey = clipCycleKey;
      el.dataset.clipBaseId = clipBaseId;
      el.dataset.loadedUrl = clipUrl;
      delete el.dataset.triedVlcStream;
      delete el.dataset.triedVaultFallback;
      delete el.dataset.triedServerFallback;
      delete el.dataset.triedUploadFallback;
      delete el.dataset.recoveringClipKey;
      if (preserveSec > 0.1) {
        el.dataset.targetResumeSec = String(preserveSec);
      } else {
        delete el.dataset.targetResumeSec;
      }
      el.src = clipUrl;
      el.load();
      triggerLegacyBlobUploadIfNeeded(el, clipBaseId, activeAd, clipUrl);
    }

    el.volume = Math.max(0.1, Math.min(1, channel.transmission.audio.masterVolume ?? 0.9));
    el.muted = isSoftwareAudioMuted(channel.transmission.audio);

    if (channel.status === 'PLAYING') {
      if (el.paused) {
        el.play().catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }
    } else if (!el.paused) {
      el.pause();
    }
  }, [
    channel.activeEveryNMinAd,
    channel.loopCycle,
    channel.status,
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
  ]);

  // Deck 4: Sync LIVE INPUT video element (liveVideoRef)
  // Plays USB Camera/HDMI Capture Card, M3U8/HLS, or RTMP/RTSP Stream while Main and Program Playlists stay cleanly paused
  useEffect(() => {
    const el = liveVideoRef.current;
    if (!el) return;

    const live = channel.liveInput;
    if (!live?.active || live.sourceType === 'youtube') {
      if (el.srcObject) {
        el.srcObject = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      el.pause();
      el.removeAttribute('src');
      delete el.dataset.clipKey;
      delete el.dataset.triedProxyFallback;
      return;
    }

    // If Every N Min Ad or Scheduled Program is interrupting Live Input, mute & pause liveVideoRef cleanly while keeping stream/HLS alive!
    if (channel.activeEveryNMinAd || channel.activeProgramId) {
      el.muted = true;
      if (!el.paused) {
        el.pause();
      }
      return;
    }

    // Live USB Camera / HDMI Capture Card
    if (live.sourceType === 'camera') {
      if (!cameraStreamRef.current) {
        cameraStreamRef.current = createLiveBroadcastCaptureStream(
          'camera',
          live.cameraDeviceId
        );
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      delete el.dataset.clipKey;
      if (el.srcObject !== cameraStreamRef.current) {
        el.pause();
        el.removeAttribute('src');
        el.srcObject = cameraStreamRef.current;
      }
      el.muted =
        Boolean(live.muted) || isSoftwareAudioMuted(channel.transmission.audio);
      el.volume = Math.max(0, Math.min(1, (live.volume ?? 100) / 100));
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
      return;
    }

    // Live M3U8 / HLS / Direct HTTP Stream
    if (live.sourceType === 'm3u8' || live.sourceType === 'stream') {
      if (el.srcObject) el.srcObject = null;
      const rawStreamUrl = (live.streamUrl || '')
        .trim()
        .replace(/^["']+|["']+$/g, '')
        .trim();
      if (!rawStreamUrl) return;
      const streamKey = `live_stream:${rawStreamUrl}`;

      if (el.dataset.clipKey !== streamKey) {
        el.dataset.clipKey = streamKey;
        delete el.dataset.triedProxyFallback;
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        const lowerUrl = rawStreamUrl.toLowerCase();
        const isM3u8 = lowerUrl.includes('.m3u8');

        if (isM3u8 && Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });
          hlsRef.current = hls;
          let retriedProxy = false;
          hls.loadSource(rawStreamUrl);
          hls.attachMedia(el);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            el.play().catch(() => {
              el.muted = true;
              el.play().catch(() => {});
            });
          });
          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (data.fatal && !retriedProxy) {
              retriedProxy = true;
              const proxiedUrl = `/api/live/m3u8-proxy?url=${encodeURIComponent(rawStreamUrl)}`;
              hls.loadSource(proxiedUrl);
              hls.startLoad();
            }
          });
        } else {
          el.src = rawStreamUrl;
          el.load();
          el.play().catch(() => {
            el.muted = true;
            el.play().catch(() => {});
          });
        }
      }

      if (live.muted) {
        el.muted = true;
      } else {
        restoreDeckAudio(el, channel);
      }
      if (typeof live.volume === 'number') {
        el.volume = Math.max(0, Math.min(1, live.volume / 100));
      }
      if (channel.status === 'PLAYING' && el.paused) {
        el.play().catch(() => {});
      }
      return;
    }
  }, [
    channel.liveInput,
    channel.activeEveryNMinAd,
    channel.activeProgramId,
    channel.status,
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
    liveCameraActive,
  ]);

  // Sync Bottom CG Overlay Video Element (overlayVideoRef) + Preload SWFs
  useEffect(() => {
    const el = overlayVideoRef.current;
    if (!el) return;
    const bot = channel.bottomOverlay;
    if (!bot || !bot.enabled || bot.keyEnabled === false) {
      el.pause();
      return;
    }
    const allItems = bot.playlist || [];
    const ticked = allItems.filter((it) => it && it.enabled !== false);
    if (ticked.length === 0) {
      el.pause();
      return;
    }
    for (const swfIt of ticked) {
      const u = (swfIt as any).serverUrl || swfIt.url || '';
      const hint = swfIt.fileName || swfIt.title || u;
      if (u && (swfIt.mediaType === 'swf' || swfEngine.isSwfUrl(u, hint))) {
        swfEngine.preloadSwf(u, swfIt.title || swfIt.fileName, undefined, 'banner');
      }
    }
    const idx = Math.max(0, Math.min(allItems.length - 1, bot.currentIndex || 0));
    let item = allItems[idx];
    if (!item || item.enabled === false) {
      item = ticked[0];
    }
    const itemUrl = (item as any)?.serverUrl && !String((item as any).serverUrl).startsWith('blob:')
      ? (item as any).serverUrl
      : item?.url || '';
    const itemHint = item?.fileName || item?.title || itemUrl;
    const isVideoBanner =
      Boolean(item) &&
      (item.mediaType === 'video' || isVideoFile(itemHint)) &&
      !swfEngine.isSwfUrl(itemUrl, itemHint) &&
      !isImageUrl(itemUrl, itemHint);
    if (!item || !isVideoBanner || !itemUrl) {
      el.pause();
      return;
    }
    const key = `bot:${item.id}:${itemUrl}`;
    const itemIdKey = `bot:${item.id}`;
    if (el.dataset.ovKey !== key) {
      const preserveSec =
        el.dataset.ovItemId === itemIdKey && el.currentTime > 0.1 && !el.error
          ? el.currentTime
          : 0;
      el.dataset.ovKey = key;
      el.dataset.ovItemId = itemIdKey;
      el.dataset.pendingSeek = preserveSec > 0.1 ? String(preserveSec) : '';
      delete el.dataset.triedVlcStream;
      el.src = itemUrl;
      el.muted = true;
      el.load();
    }
    el.loop = ticked.length <= 1;
    if (el.paused) {
      el.play().catch(() => {});
    }
  }, [
    channel.bottomOverlay?.enabled,
    channel.bottomOverlay?.keyEnabled,
    channel.bottomOverlay?.currentIndex,
    channel.bottomOverlay?.playlist,
  ]);

  // Sync Top CG Overlay Video Element (topOverlayVideoRef) + Preload SWFs
  useEffect(() => {
    const el = topOverlayVideoRef.current;
    if (!el) return;
    const top = channel.topOverlay;
    if (!top || !top.enabled || top.keyEnabled === false) {
      el.pause();
      return;
    }
    const allItems = top.playlist || [];
    const ticked = allItems.filter((it) => it && it.enabled !== false);
    if (ticked.length === 0) {
      el.pause();
      return;
    }
    for (const swfIt of ticked) {
      const u = (swfIt as any).serverUrl || swfIt.url || '';
      const hint = swfIt.fileName || swfIt.title || u;
      if (u && (swfIt.mediaType === 'swf' || swfEngine.isSwfUrl(u, hint))) {
        swfEngine.preloadSwf(u, swfIt.title || swfIt.fileName, undefined, 'banner');
      }
    }
    const idx = Math.max(0, Math.min(allItems.length - 1, top.currentIndex || 0));
    let item = allItems[idx];
    if (!item || item.enabled === false) {
      item = ticked[0];
    }
    const itemUrl = (item as any)?.serverUrl && !String((item as any).serverUrl).startsWith('blob:')
      ? (item as any).serverUrl
      : item?.url || '';
    const itemHint = item?.fileName || item?.title || itemUrl;
    const isVideoBanner =
      Boolean(item) &&
      (item.mediaType === 'video' || isVideoFile(itemHint)) &&
      !swfEngine.isSwfUrl(itemUrl, itemHint) &&
      !isImageUrl(itemUrl, itemHint);
    if (!item || !isVideoBanner || !itemUrl) {
      el.pause();
      return;
    }
    const key = `top:${item.id}:${itemUrl}`;
    const itemIdKey = `top:${item.id}`;
    if (el.dataset.ovKey !== key) {
      const preserveSec =
        el.dataset.ovItemId === itemIdKey && el.currentTime > 0.1 && !el.error
          ? el.currentTime
          : 0;
      el.dataset.ovKey = key;
      el.dataset.ovItemId = itemIdKey;
      el.dataset.pendingSeek = preserveSec > 0.1 ? String(preserveSec) : '';
      delete el.dataset.triedVlcStream;
      el.src = itemUrl;
      el.muted = true;
      el.load();
    }
    el.loop = ticked.length <= 1;
    if (el.paused) {
      el.play().catch(() => {});
    }
  }, [
    channel.topOverlay?.enabled,
    channel.topOverlay?.keyEnabled,
    channel.topOverlay?.currentIndex,
    channel.topOverlay?.playlist,
  ]);

  // Sync L-Shape CG Video Element (lShapeVideoRef)
  useEffect(() => {
    const el = lShapeVideoRef.current;
    if (!el) return;
    const lShape = channel.lShape;
    if (!lShape || !lShape.enabled) {
      el.pause();
      return;
    }
    const allItems = lShape.playlist || [];
    const ticked = allItems.filter((it) => it.enabled !== false);
    if (ticked.length === 0) {
      el.pause();
      return;
    }
    const idx = Math.max(0, Math.min(allItems.length - 1, lShape.currentIndex || 0));
    let item = allItems[idx];
    if (!item || item.enabled === false) {
      item = ticked[0];
    }
    const effectiveRepeatMin =
      (item?.repeatEveryMin !== undefined ? item.repeatEveryMin : lShape.repeatEveryMin) || 0;
    const isPeriodicWaitMode =
      lShape.playMode === 'periodic' || effectiveRepeatMin > 0;
    if (isPeriodicWaitMode && lShape.periodicActive === false) {
      el.pause();
      el.currentTime = 0;
      return;
    }
    if (
      !item ||
      item.mediaType !== 'video' ||
      swfEngine.isSwfUrl(item.url, item.title) ||
      !item.url
    ) {
      el.pause();
      return;
    }
    const key = `lshape:${item.id}:${item.url}`;
    if (el.dataset.ovKey !== key) {
      el.dataset.ovKey = key;
      el.src = item.url;
      el.muted = true;
      el.currentTime = 0;
      el.load();
    }
    el.loop = true;
    if (el.paused) {
      el.play().catch(() => {});
    }
  }, [
    channel.lShape?.enabled,
    channel.lShape?.periodicActive,
    channel.lShape?.playMode,
    channel.lShape?.repeatEveryMin,
    channel.lShape?.currentIndex,
    channel.lShape?.playlist,
  ]);

  // Pure helper to compute the exact cycle key for the currently active clip
  const getActivePlaybackCycleKey = (c: TVChannel): string => getActivePlaybackCycleKeyEngine(c);

  // Pure helper to advance main playback state when a clip finishes (100% StrictMode-safe & idempotent!)
  const advanceMainPlaybackOnClipEnd = (
    c: TVChannel,
    expectedCycleKey?: string,
    randSeed: number = 0.5
  ): TVChannel => advanceMainPlaybackOnClipEndEngine(c, expectedCycleKey, randSeed);


  // 1-Second Master Broadcast Scheduler:
  // - Checks Scheduled Programs (One Time & Daily) on exact Date, Day & Time and immediately plays
  // - Checks Every N Min Commercial Ads (5m..60m per ad) and queues due ads one-by-one
  // - Advances Bottom CG, Top CG, L-Shape CG, and SWF/Fallback Videos for their full duration
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mmMonth = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mmMonth}-${dd}`;
      const todayDayCode = DAY_CODES[now.getDay()];
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const currentHHMM = `${hh}:${mm}`;
      const currentHHMMSS = `${hh}:${mm}:${ss}`;

      const tickRandSeed = Math.random();
      setChannels((prev) =>
        prev.map((ch) => {
          const activeDeckVid = ch.activeEveryNMinAd
            ? adVideoRef.current
            : ch.activeProgramId
            ? programVideoRef.current
            : ch.liveInput?.active
            ? liveVideoRef.current
            : videoElementRef.current;
          const activeMediaItem = ch.activeEveryNMinAd
            ? ch.activeEveryNMinAd
            : ch.activeProgramId
            ? (ch.scheduledPrograms || []).find((p) => p.id === ch.activeProgramId)?.playlist[
                ch.activeProgramClipIndex || 0
              ]
            : ch.liveInput?.active
            ? null
            : ch.playlist[ch.currentClipIndex];
          const activeMediaUrl = activeMediaItem?.url || (activeMediaItem as any)?.videoUrl || '';
          const isActiveNonVideoDeck =
            Boolean(activeMediaItem) &&
            (swfEngine.isSwfUrl(activeMediaUrl, activeMediaItem?.fileName || activeMediaItem?.title) ||
              isImageUrl(activeMediaUrl, activeMediaItem?.fileName || activeMediaItem?.title));
          const isNativeVideoPlaying =
            !isActiveNonVideoDeck &&
            activeDeckVid &&
            !activeDeckVid.paused &&
            !activeDeckVid.ended &&
            !activeDeckVid.error &&
            !activeDeckVid.seeking &&
            activeDeckVid.dataset.isSeekingResume !== 'true' &&
            activeDeckVid.readyState >= 1;
          const realVideoSec = isNativeVideoPlaying ? Math.floor(activeDeckVid.currentTime) : null;
          const exactVideoSec = isNativeVideoPlaying ? activeDeckVid.currentTime : null;

          // 1. Check Scheduled Programs (One Time = 1 Day Only / Daily = Every Day from Start Date) on exact Fixed Date & Time (NO Day filter)
          const progs = ch.scheduledPrograms || [];
          const currentSecOfDay =
            now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

          if (!ch.liveInput?.active && !ch.activeEveryNMinAd && progs.length > 0) {
            const matchingProg = progs.find((p) => {
              if (!p.enabled || !p.playlist.some((cl) => cl.enabled !== false)) return false;
              if (ch.activeProgramId === p.id) return false;

              const isOneTime =
                p.scheduleType === 'one_time' || p.scheduleType === 'once' || !p.scheduleType;

              if (isOneTime) {
                // One Time: plays ONLY ONCE on the exact fixed date
                if (p.completed || p.status === 'completed') return false;
                if (p.lastTriggeredDate) return false;
                const fixedDate = (p.startDate || todayStr).trim();
                if (fixedDate !== todayStr) return false;
              } else {
                // Daily: plays EVERY DAY at the fixed time starting from startDate
                const startDate = (p.startDate || '').trim();
                if (startDate && todayStr < startDate) return false;
                if (p.lastTriggeredDate === todayStr) return false;
              }

              const targetTime = (p.startTime || '').trim();
              if (!targetTime) return false;
              const parts = targetTime.split(':').map((n) => parseInt(n, 10) || 0);
              const targetHH = parts[0] || 0;
              const targetMM = parts[1] || 0;
              const targetSS = parts.length >= 3 ? parts[2] || 0 : 0;
              const targetSecOfDay = targetHH * 3600 + targetMM * 60 + targetSS;

              const diffSec = currentSecOfDay - targetSecOfDay;
              if (diffSec < 0 || diffSec > 59) return false;

              return true;
            });

            if (matchingProg) {
              if (videoElementRef.current && !videoElementRef.current.paused) {
                videoElementRef.current.pause();
              }
              const pausedMainClip = ch.playlist[ch.currentClipIndex];
              if (
                pausedMainClip &&
                swfEngine.isSwfUrl(
                  pausedMainClip.url,
                  pausedMainClip.fileName || pausedMainClip.title
                )
              ) {
                swfEngine.pauseSwf(pausedMainClip.url);
              }
              const pausedMainSec = ch.activeProgramId
                ? ch.currentTime || 0
                : exactVideoSec ?? captureDeckPausedTimeSec(videoElementRef.current, ch.currentTime || 0);
              return startScheduledProgramOnChannel(
                ch,
                matchingProg.id,
                pausedMainSec,
                todayStr,
                false
              );
            }
          }

          // 2. Check Every N Min Ads Timer (Track 1–6 Full-Day Ad Tracking: 48 Slots/Day per Track)
          let updatedAds = ch.everyNMinAds || [];
          let nextActiveAd = ch.activeEveryNMinAd || null;
          let nextAdQueue = ch.everyNMinQueue || [];
          let savedMain = ch.savedMainPlaybackState;
          let savedProg = ch.savedProgramPlaybackState;

          const currentHHMM = getCurrentHHMM(now);
          const currentSlotTriggerKey = `${todayStr}_${currentHHMM}`;

          const allowAdsDuringLive =
            !ch.liveInput?.active || ch.liveInput.playEveryMinAdsOnLive !== false;
          const hasEnabledAds = updatedAds.some((ad) => ad.enabled !== false);

          if ((everyNMinEnabled || hasEnabledAds) && allowAdsDuringLive && updatedAds.length > 0) {
            const dueAds: EveryNMinAdItem[] = [];
            updatedAds = updatedAds.map((ad, adIdx) => {
              if (ad.enabled === false) return ad;
              const isDateMatch = isAdDateMatch(ad, now);
              const effectiveTracks =
                ad.selectedTracks && ad.selectedTracks.length > 0
                  ? ad.selectedTracks
                  : [((adIdx % 6) + 1)];
              const effectiveSlots = ensureDefaultTickedSlots(
                ad.tickedSlots,
                effectiveTracks,
                ad.track6Preset || 'text',
                ad.customTracks
              );
              const isSlotMatchNow =
                isDateMatch &&
                effectiveSlots.includes(currentHHMM) &&
                ad.lastTriggeredSlotKey !== currentSlotTriggerKey;

              if (isSlotMatchNow) {
                const triggeredAd: EveryNMinAdItem = {
                  ...ad,
                  elapsedSec: 0,
                  lastTriggeredSlotKey: currentSlotTriggerKey,
                };
                dueAds.push(triggeredAd);
                return triggeredAd;
              }
              return { ...ad, elapsedSec: (ad.elapsedSec || 0) + 1 };
            });

            const minRemaining = updatedAds.reduce((minVal, ad, adIdx) => {
              if (ad.enabled === false) return minVal;
              const effectiveTracks =
                ad.selectedTracks && ad.selectedTracks.length > 0
                  ? ad.selectedTracks
                  : [((adIdx % 6) + 1)];
              const effectiveSlots = ensureDefaultTickedSlots(
                ad.tickedSlots,
                effectiveTracks,
                ad.track6Preset || 'text',
                ad.customTracks
              );
              const rem = secondsUntilNextTickedSlot(effectiveSlots, now);
              return Math.min(minVal, rem);
            }, 1800);
            setEveryNMinCountdownSec(hasEnabledAds ? minRemaining : 0);

            if (dueAds.length > 0) {
              dueAds.sort((a, b) => (a.orderIndex || 1) - (b.orderIndex || 1));
              const existingQueueIds = new Set(nextAdQueue.map((q) => q.id));
              if (nextActiveAd) existingQueueIds.add(nextActiveAd.id);

              const newDueAds = dueAds.filter((d) => !existingQueueIds.has(d.id));

              if (!nextActiveAd && newDueAds.length > 0) {
                nextActiveAd = newDueAds[0];
                nextAdQueue = [...nextAdQueue, ...newDueAds.slice(1)];
                if (swfEngine.isSwfUrl(nextActiveAd.url, nextActiveAd.fileName || nextActiveAd.title)) {
                  swfEngine.restartSwf(nextActiveAd.url);
                }
                if (ch.activeProgramId) {
                  if (programVideoRef.current && !programVideoRef.current.paused) {
                    programVideoRef.current.pause();
                  }
                  const activeProgObj = progs.find((p) => p.id === ch.activeProgramId);
                  const activeProgClip = activeProgObj?.playlist[ch.activeProgramClipIndex || 0];
                  if (
                    activeProgClip &&
                    swfEngine.isSwfUrl(
                      activeProgClip.url,
                      activeProgClip.fileName || activeProgClip.title
                    )
                  ) {
                    swfEngine.pauseSwf(activeProgClip.url);
                  }
                  const pausedProgSec =
                    exactVideoSec ??
                    captureDeckPausedTimeSec(programVideoRef.current, ch.activeProgramTime || 0);
                  savedProg = {
                    programId: ch.activeProgramId,
                    clipIndex: ch.activeProgramClipIndex || 0,
                    currentTime: pausedProgSec,
                  };
                } else if (!ch.liveInput?.active) {
                  if (videoElementRef.current && !videoElementRef.current.paused) {
                    videoElementRef.current.pause();
                  }
                  const activeMainClip = ch.playlist[ch.currentClipIndex];
                  if (
                    activeMainClip &&
                    swfEngine.isSwfUrl(
                      activeMainClip.url,
                      activeMainClip.fileName || activeMainClip.title
                    )
                  ) {
                    swfEngine.pauseSwf(activeMainClip.url);
                  }
                  const pausedMainSec =
                    exactVideoSec ??
                    captureDeckPausedTimeSec(videoElementRef.current, ch.currentTime || 0);
                  savedMain = {
                    clipIndex: ch.currentClipIndex,
                    currentTime: pausedMainSec,
                  };
                } else {
                  if (liveVideoRef.current && !liveVideoRef.current.paused) {
                    liveVideoRef.current.pause();
                    liveVideoRef.current.muted = true;
                  }
                }
              } else if (nextActiveAd && newDueAds.length > 0) {
                // If an ad is already actively playing, queue all newly-due ads to play 1-by-1 sequentially!
                nextAdQueue = [...nextAdQueue, ...newDueAds];
              }

              // Hold L-Shape during Every N Min Ads and queue all due L-Shape items to play 1-by-1 immediately AFTER the ad finishes
              let heldLShape = ch.lShape;
              if (heldLShape && (heldLShape.playlist?.length || 0) > 0) {
                const dueLShapeIdxs: number[] = [];
                heldLShape.playlist.forEach((lit, lIdx) => {
                  if (lit.enabled === false) return;
                  if (!isAdDateMatch(lit, now)) return;
                  const lTracks =
                    lit.selectedTracks && lit.selectedTracks.length > 0
                      ? lit.selectedTracks
                      : heldLShape?.selectedTracks && heldLShape.selectedTracks.length > 0
                      ? heldLShape.selectedTracks
                      : [((lIdx % 6) + 1)];
                  const lSlots = ensureDefaultTickedSlots(
                    lit.tickedSlots || heldLShape?.tickedSlots,
                    lTracks,
                    lit.track6Preset || heldLShape?.track6Preset || 'text',
                    lit.customTracks || heldLShape?.customTracks
                  );
                  if (lSlots.includes(currentHHMM) && lit.lastTriggeredSlotKey !== currentSlotTriggerKey) {
                    dueLShapeIdxs.push(lIdx);
                  }
                });
                const isLShapeDueOrActive =
                  heldLShape.periodicActive !== false || dueLShapeIdxs.length > 0;
                const startLIdx =
                  dueLShapeIdxs.length > 0 ? dueLShapeIdxs[0] : heldLShape.currentIndex || 0;
                const nextLQueue =
                  dueLShapeIdxs.length > 1
                    ? dueLShapeIdxs.slice(1)
                    : heldLShape.dueQueueIndices || [];

                heldLShape = {
                  ...heldLShape,
                  currentIndex: startLIdx,
                  dueQueueIndices: nextLQueue,
                  periodicActive: false,
                  pendingAfterAd: isLShapeDueOrActive ? true : Boolean(heldLShape.pendingAfterAd),
                  currentTime: 0,
                  periodicCounter: 0,
                  lastTriggeredSlotKey: isLShapeDueOrActive
                    ? currentSlotTriggerKey
                    : heldLShape.lastTriggeredSlotKey,
                  playlist: heldLShape.playlist.map((lit, lIdx) =>
                    dueLShapeIdxs.includes(lIdx)
                      ? { ...lit, lastTriggeredSlotKey: currentSlotTriggerKey }
                      : lit
                  ),
                };
              }

              return {
                ...ch,
                status: 'PLAYING',
                loopCycle: (ch.loopCycle || 0) + 1,
                everyNMinAds: updatedAds,
                activeEveryNMinAd: nextActiveAd,
                everyNMinQueue: nextAdQueue,
                everyNMinTime: ch.activeEveryNMinAd ? ch.everyNMinTime || 0 : 0,
                savedMainPlaybackState: savedMain,
                savedProgramPlaybackState: savedProg,
                lShape: heldLShape,
              };
            }
          } else if (!everyNMinEnabled && !hasEnabledAds) {
            setEveryNMinCountdownSec(0);
          }

          // 3. Advance Bottom CG, Top CG, and L-Shape CG timers (SWF, Images, and fallback Videos)
          const advanceBanner = (
            banner: OverlayBannerConfig | undefined,
            ovVideoEl: HTMLVideoElement | null
          ): OverlayBannerConfig | undefined => {
            if (!banner || !banner.enabled || banner.keyEnabled === false || !banner.playlist || banner.playlist.length === 0) {
              return banner;
            }
            const allItems = banner.playlist;
            const tickedIndices = allItems
              .map((it, idx) => (it.enabled !== false ? idx : -1))
              .filter((idx) => idx >= 0);
            if (tickedIndices.length === 0) return banner;

            let curIdx = Math.max(0, Math.min(allItems.length - 1, banner.currentIndex || 0));
            if (allItems[curIdx]?.enabled === false) {
              curIdx = tickedIndices[0];
            }
            const curItem = allItems[curIdx];
            if (!curItem) return banner;

            const ovHint = curItem.fileName || curItem.title || curItem.url || '';
            const isSwf =
              curItem.mediaType === 'swf' || swfEngine.isSwfUrl(curItem.url, ovHint);
            const isVideo = curItem.mediaType === 'video' || isVideoFile(ovHint);
            const isNativeOvVideo =
              isVideo &&
              !isSwf &&
              !isImageUrl(curItem.url, ovHint) &&
              ovVideoEl &&
              !ovVideoEl.error;

            if (isNativeOvVideo) {
              if (ovVideoEl.ended) {
                if (tickedIndices.length > 1) {
                  const posInTicked = tickedIndices.indexOf(curIdx);
                  const nextTickedIdx =
                    tickedIndices[(posInTicked >= 0 ? posInTicked + 1 : 0) % tickedIndices.length];
                  return {
                    ...banner,
                    currentIndex: nextTickedIdx,
                    currentTime: 0,
                  };
                }
                try {
                  ovVideoEl.currentTime = 0;
                } catch {}
                ovVideoEl.play().catch(() => {});
              } else if (ovVideoEl.paused && ovVideoEl.readyState >= 2) {
                ovVideoEl.play().catch(() => {});
              }
              return {
                ...banner,
                currentIndex: curIdx,
                currentTime: Math.floor(ovVideoEl.currentTime || 0),
              };
            }

            // Wait up to 3s for SWF Frame 1 to render before counting elapsed seconds on launch/transition
            if (isSwf && (banner.currentTime || 0) === 0 && !swfEngine.hasRenderedFrame(curItem.url)) {
              const waitKey = `banner:${curItem.id || curItem.url}`;
              const waits = (swfWaitCountRef.current[waitKey] || 0) + 1;
              if (waits <= 3) {
                swfWaitCountRef.current[waitKey] = waits;
                return {
                  ...banner,
                  currentIndex: curIdx,
                  currentTime: 0,
                };
              }
              swfWaitCountRef.current[waitKey] = 0;
            }

            const nextT = (banner.currentTime || 0) + 1;
            const rawDur = curItem.duration || banner.imageFixedDurationSec || 10;
            const targetDur = Math.max(
              2,
              isSwf ? swfEngine.getRealSwfDurationSec(curItem.url, rawDur) : rawDur
            );
            if (nextT >= targetDur) {
              const posInTicked = tickedIndices.indexOf(curIdx);
              const nextTickedIdx =
                tickedIndices[(posInTicked >= 0 ? posInTicked + 1 : 0) % tickedIndices.length];
              const nextItem = allItems[nextTickedIdx];
              if (
                nextItem &&
                (nextItem.mediaType === 'swf' ||
                  swfEngine.isSwfUrl(nextItem.url, nextItem.fileName || nextItem.title))
              ) {
                swfEngine.restartSwf(nextItem.url);
              }
              return {
                ...banner,
                currentIndex: nextTickedIdx,
                currentTime: 0,
              };
            }
            return { ...banner, currentIndex: curIdx, currentTime: nextT };
          };

          const advanceLShape = (
            lShape: LShapeConfig | undefined,
            _lVideoEl: HTMLVideoElement | null,
            isAdCurrentlyPlaying: boolean
          ): LShapeConfig | undefined => {
            if (!lShape || !lShape.enabled || !lShape.playlist || lShape.playlist.length === 0) {
              return lShape;
            }
            const allItems = lShape.playlist;
            const tickedIndices = allItems
              .map((it, idx) => (it.enabled !== false ? idx : -1))
              .filter((idx) => idx >= 0);
            if (tickedIndices.length === 0) return lShape;

            let curIdx = Math.max(0, Math.min(allItems.length - 1, lShape.currentIndex || 0));
            if (allItems[curIdx]?.enabled === false) {
              curIdx = tickedIndices[0];
            }
            const curItem = allItems[curIdx];
            if (!curItem) return lShape;

            const curItemTracks =
              curItem.selectedTracks && curItem.selectedTracks.length > 0
                ? curItem.selectedTracks
                : lShape.selectedTracks && lShape.selectedTracks.length > 0
                ? lShape.selectedTracks
                : [((curIdx % 6) + 1)];
            const curItemSlots = ensureDefaultTickedSlots(
              curItem.tickedSlots || lShape.tickedSlots,
              curItemTracks,
              curItem.track6Preset || lShape.track6Preset || 'text'
            );

            // Collect ALL enabled L-Shape items that have a ticked Track 1–6 slot matching currentHHMM right now
            // so 10+ or 100+ L-Shape items play 1-by-1 for their full duration!
            const dueLShapeIndices = tickedIndices.filter((tIdx) => {
              const cand = allItems[tIdx];
              if (!cand || cand.enabled === false) return false;
              if (!isAdDateMatch(cand, now)) return false;
              const candTracks =
                cand.selectedTracks && cand.selectedTracks.length > 0
                  ? cand.selectedTracks
                  : lShape.selectedTracks && lShape.selectedTracks.length > 0
                  ? lShape.selectedTracks
                  : [((tIdx % 6) + 1)];
              const candSlots = ensureDefaultTickedSlots(
                cand.tickedSlots || lShape.tickedSlots,
                candTracks,
                cand.track6Preset || lShape.track6Preset || 'text',
                cand.customTracks || lShape.customTracks
              );
              return (
                candSlots.includes(currentHHMM) &&
                cand.lastTriggeredSlotKey !== currentSlotTriggerKey
              );
            });
            const matchingSlotItemIdx =
              dueLShapeIndices.length > 0 ? dueLShapeIndices[0] : undefined;

            const isPeriodicWaitMode = (lShape.playMode || 'periodic') === 'periodic';
            const waitSec = secondsUntilNextTickedSlot(curItemSlots, now);

            // NEVER play L-Shape during an Every N Min Ad!
            // If L-Shape was active or becomes due during the ad, queue all due items (pendingAfterAd = true)
            // so they play 1-by-1 immediately AFTER the Every N Min Ad finishes!
            if (isAdCurrentlyPlaying) {
              if (lShape.periodicActive !== false || matchingSlotItemIdx !== undefined) {
                const startIdx =
                  matchingSlotItemIdx !== undefined ? matchingSlotItemIdx : curIdx;
                const queuedRest =
                  dueLShapeIndices.length > 1
                    ? dueLShapeIndices.slice(1)
                    : lShape.dueQueueIndices || [];
                return {
                  ...lShape,
                  currentIndex: startIdx,
                  dueQueueIndices: queuedRest,
                  periodicActive: false,
                  pendingAfterAd: true,
                  currentTime: 0,
                  periodicCounter: 0,
                  lastTriggeredSlotKey:
                    matchingSlotItemIdx !== undefined
                      ? currentSlotTriggerKey
                      : lShape.lastTriggeredSlotKey,
                  playlist:
                    dueLShapeIndices.length > 0
                      ? allItems.map((it, idx) =>
                          dueLShapeIndices.includes(idx)
                            ? { ...it, lastTriggeredSlotKey: currentSlotTriggerKey }
                            : it
                        )
                      : allItems,
                };
              }
              return {
                ...lShape,
                periodicCounter: Math.max(0, 1800 - waitSec),
              };
            }

            // 1. If currently in 100% Full Screen Wait between L-Shape Track 1–6 slots:
            if (isPeriodicWaitMode && lShape.periodicActive === false) {
              if (lShape.pendingAfterAd) {
                return {
                  ...lShape,
                  periodicActive: true,
                  pendingAfterAd: false,
                  periodicCounter: 0,
                  currentTime: 0,
                };
              }
              if (matchingSlotItemIdx !== undefined) {
                const queuedRest = dueLShapeIndices.slice(1);
                return {
                  ...lShape,
                  currentIndex: matchingSlotItemIdx,
                  dueQueueIndices: queuedRest,
                  periodicActive: true,
                  periodicCounter: 0,
                  currentTime: 0,
                  lastTriggeredSlotKey: currentSlotTriggerKey,
                  playlist: allItems.map((it, idx) =>
                    dueLShapeIndices.includes(idx)
                      ? { ...it, lastTriggeredSlotKey: currentSlotTriggerKey }
                      : it
                  ),
                };
              }
              return {
                ...lShape,
                periodicCounter: Math.max(0, 1800 - waitSec),
              };
            }

            // 2. Currently showing L-Shape on Output Overlay for exact user-set seconds (targetDur):
            // If additional items become due at this time slot, append them so all items play 1-by-1 sequentially!
            let activeDueQueue = lShape.dueQueueIndices || [];
            let updatedLItems = allItems;
            if (dueLShapeIndices.length > 0) {
              const currentQueueSet = new Set([curIdx, ...activeDueQueue]);
              const newlyDue = dueLShapeIndices.filter((idx) => !currentQueueSet.has(idx));
              if (newlyDue.length > 0) {
                activeDueQueue = [...activeDueQueue, ...newlyDue];
                updatedLItems = allItems.map((it, idx) =>
                  newlyDue.includes(idx)
                    ? { ...it, lastTriggeredSlotKey: currentSlotTriggerKey }
                    : it
                );
              }
            }

            const nextT = (lShape.currentTime || 0) + 1;
            const isLShapeSwf =
              curItem.mediaType === 'swf' ||
              swfEngine.isSwfUrl(curItem.url, curItem.fileName || curItem.title);
            const rawDur = curItem.duration || lShape.intervalSeconds || 15;
            const targetDur = Math.max(
              2,
              isLShapeSwf && curItem.autoVideoDuration
                ? swfEngine.getRealSwfDurationSec(curItem.url, rawDur)
                : rawDur
            );
            if (nextT >= targetDur) {
              // Check if there are remaining L-Shape items in the batch queued for this time slot
              const validRemainingQueue = activeDueQueue.filter(
                (qIdx) => updatedLItems[qIdx] && updatedLItems[qIdx].enabled !== false
              );
              if (validRemainingQueue.length > 0) {
                const [nextQueuedIdx, ...restQueue] = validRemainingQueue;
                const nextQueuedItem = updatedLItems[nextQueuedIdx];
                if (
                  nextQueuedItem &&
                  (nextQueuedItem.mediaType === 'swf' ||
                    swfEngine.isSwfUrl(
                      nextQueuedItem.url,
                      nextQueuedItem.fileName || nextQueuedItem.title
                    ))
                ) {
                  swfEngine.restartSwf(nextQueuedItem.url);
                }
                return {
                  ...lShape,
                  playlist: updatedLItems,
                  currentIndex: nextQueuedIdx,
                  dueQueueIndices: restQueue,
                  currentTime: 0,
                  periodicActive: true,
                  periodicCounter: 0,
                };
              }

              const posInTicked = tickedIndices.indexOf(curIdx);
              const nextTickedIdx =
                tickedIndices[(posInTicked >= 0 ? posInTicked + 1 : 0) % tickedIndices.length];

              if (isPeriodicWaitMode) {
                // Finished showing all due L-Shape items 1-by-1 for this time slot -> Return to 100% Full Screen!
                return {
                  ...lShape,
                  playlist: updatedLItems,
                  currentIndex: nextTickedIdx,
                  dueQueueIndices: [],
                  currentTime: 0,
                  periodicActive: false,
                  periodicCounter: 0,
                };
              }

              return {
                ...lShape,
                playlist: updatedLItems,
                currentIndex: nextTickedIdx,
                dueQueueIndices: [],
                currentTime: 0,
                periodicActive: true,
                periodicCounter: 0,
              };
            }

            return {
              ...lShape,
              playlist: updatedLItems,
              dueQueueIndices: activeDueQueue,
              currentTime: nextT,
            };
          };

          const advanceLogo = (logo: any): any => {
            if (!logo || !logo.enabled) return logo;
            const allItems = Array.isArray(logo.playlist) ? logo.playlist : [];
            if (allItems.length === 0) {
              const isSingleSwf =
                Boolean(logo.isSwf) || swfEngine.isSwfUrl(logo.url, logo.fileName || logo.label);
              if (!isSingleSwf || !logo.url) return logo;
              if ((logo.currentTime || 0) === 0 && !swfEngine.hasRenderedFrame(logo.url)) {
                const waitKey = `slogo:${logo.url}`;
                const waits = (swfWaitCountRef.current[waitKey] || 0) + 1;
                if (waits <= 3) {
                  swfWaitCountRef.current[waitKey] = waits;
                  return { ...logo, currentTime: 0 };
                }
                swfWaitCountRef.current[waitKey] = 0;
              }
              const nextT = (logo.currentTime || 0) + 1;
              const targetDur = Math.max(
                2,
                swfEngine.getRealSwfDurationSec(logo.url, logo.duration || 10)
              );
              if (nextT >= targetDur) {
                swfEngine.restartSwf(logo.url);
                return { ...logo, currentTime: 0 };
              }
              return { ...logo, currentTime: nextT };
            }

            const tickedIndices = allItems
              .map((it: any, idx: number) => (it.enabled !== false ? idx : -1))
              .filter((idx: number) => idx >= 0);
            if (tickedIndices.length === 0) return logo;

            let curIdx = Math.max(0, Math.min(allItems.length - 1, logo.currentIndex || 0));
            if (allItems[curIdx]?.enabled === false) {
              curIdx = tickedIndices[0];
            }
            const curItem = allItems[curIdx];
            if (!curItem) return logo;

            const isSwf =
              Boolean(curItem.isSwf) ||
              swfEngine.isSwfUrl(curItem.url, curItem.fileName || curItem.title);
            if (isSwf && (logo.currentTime || 0) === 0 && !swfEngine.hasRenderedFrame(curItem.url)) {
              const waitKey = `logo:${curItem.id || curItem.url}`;
              const waits = (swfWaitCountRef.current[waitKey] || 0) + 1;
              if (waits <= 3) {
                swfWaitCountRef.current[waitKey] = waits;
                return {
                  ...logo,
                  currentIndex: curIdx,
                  currentTime: 0,
                  url: curItem.url || logo.url,
                  isSwf: true,
                };
              }
              swfWaitCountRef.current[waitKey] = 0;
            }

            const nextT = (logo.currentTime || 0) + 1;
            const rawDur = curItem.duration || logo.duration || 10;
            const targetDur = Math.max(
              2,
              isSwf ? swfEngine.getRealSwfDurationSec(curItem.url, rawDur) : rawDur
            );
            if (nextT >= targetDur) {
              const posInTicked = tickedIndices.indexOf(curIdx);
              const nextTickedIdx =
                tickedIndices[(posInTicked >= 0 ? posInTicked + 1 : 0) % tickedIndices.length];
              const nextItem = allItems[nextTickedIdx];
              const nextIsSwf =
                Boolean(nextItem?.isSwf) ||
                swfEngine.isSwfUrl(nextItem?.url, nextItem?.fileName || nextItem?.title);
              if (nextItem?.url && nextIsSwf) {
                swfEngine.restartSwf(nextItem.url);
              }
              return {
                ...logo,
                currentIndex: nextTickedIdx,
                currentTime: 0,
                url: nextItem?.url || logo.url,
                label: nextItem?.fileName || nextItem?.title || logo.label,
                fileName: nextItem?.fileName || logo.fileName,
                isSwf: nextIsSwf,
              };
            }
            return {
              ...logo,
              currentIndex: curIdx,
              currentTime: nextT,
              url: curItem.url || logo.url,
              isSwf,
            };
          };

          const nextBotOverlay = advanceBanner(ch.bottomOverlay, overlayVideoRef.current);
          const nextTopOverlay = advanceBanner(ch.topOverlay, topOverlayVideoRef.current);
          const nextLShape = advanceLShape(
            ch.lShape,
            lShapeVideoRef.current,
            Boolean(ch.activeEveryNMinAd)
          );
          const isLShapeOnAirNow = Boolean(
            nextLShape &&
              nextLShape.enabled &&
              Array.isArray(nextLShape.playlist) &&
              nextLShape.playlist.some((it) => it && it.enabled !== false) &&
              !ch.activeEveryNMinAd &&
              nextLShape.periodicActive !== false
          );
          const activeLItemNow = isLShapeOnAirNow
            ? nextLShape?.playlist?.[
                Math.max(
                  0,
                  Math.min((nextLShape.playlist?.length || 1) - 1, nextLShape.currentIndex || 0)
                )
              ]
            : undefined;
          const activeLShapeCgMode =
            activeLItemNow?.cgOverlayMode || nextLShape?.cgOverlayMode || 'lshape_and_logo';
          const pauseSponsorLogosDuringLShape =
            isLShapeOnAirNow && activeLShapeCgMode !== 'lshape_all_logos';

          const nowEpochMs = now.getTime();
          const botBarExpired = isTickerBarExpired((ch.graphics as any)?.tickerExpiresAt, nowEpochMs);
          const topBarExpired = isTickerBarExpired((ch.graphics as any)?.topTickerExpiresAt, nowEpochMs);
          const nextTickerItems = Array.isArray((ch.graphics as any)?.tickerItems)
            ? (ch.graphics as any).tickerItems.map((it: any) =>
                it && it.enabled !== false && it.expiresAt && nowEpochMs >= it.expiresAt
                  ? { ...it, enabled: false }
                  : it
              )
            : (ch.graphics as any)?.tickerItems;
          const nextTopTickerItems = Array.isArray((ch.graphics as any)?.topTickerItems)
            ? (ch.graphics as any).topTickerItems.map((it: any) =>
                it && it.enabled !== false && it.expiresAt && nowEpochMs >= it.expiresAt
                  ? { ...it, enabled: false }
                  : it
              )
            : (ch.graphics as any)?.topTickerItems;

          const nextGraphics = {
            ...ch.graphics,
            ...(botBarExpired ? { tickerEnabled: false, tickerExpiresAt: null } : {}),
            ...(topBarExpired ? { topTickerEnabled: false, topTickerExpiresAt: null } : {}),
            ...(nextTickerItems !== (ch.graphics as any)?.tickerItems
              ? { tickerItems: nextTickerItems }
              : {}),
            ...(nextTopTickerItems !== (ch.graphics as any)?.topTickerItems
              ? { topTickerItems: nextTopTickerItems }
              : {}),
            channelLogo:
              isLShapeOnAirNow && activeLShapeCgMode === 'lshape_only'
                ? (ch.graphics as any)?.channelLogo
                : advanceLogo((ch.graphics as any)?.channelLogo),
            sponsorLogo1: pauseSponsorLogosDuringLShape
              ? (ch.graphics as any)?.sponsorLogo1
              : advanceLogo((ch.graphics as any)?.sponsorLogo1),
            sponsorLogo2: pauseSponsorLogosDuringLShape
              ? (ch.graphics as any)?.sponsorLogo2
              : advanceLogo((ch.graphics as any)?.sponsorLogo2),
            sponsorLogo3: pauseSponsorLogosDuringLShape
              ? (ch.graphics as any)?.sponsorLogo3
              : advanceLogo((ch.graphics as any)?.sponsorLogo3),
            sponsorLogo4: pauseSponsorLogosDuringLShape
              ? (ch.graphics as any)?.sponsorLogo4
              : advanceLogo((ch.graphics as any)?.sponsorLogo4),
          };

          // Continuous playback watchdog: ensure active deck never stays paused or stuck muted when channel status is PLAYING
          if (
            ch.status === 'PLAYING' &&
            activeDeckVid &&
            !activeDeckVid.error &&
            activeDeckVid.readyState >= 2 &&
            (!ch.liveInput?.active || Boolean(ch.activeEveryNMinAd) || Boolean(ch.activeProgramId))
          ) {
            restoreDeckAudio(activeDeckVid, ch);
            if (activeDeckVid.paused && !activeDeckVid.ended) {
              activeDeckVid.play().catch(() => {
                activeDeckVid.muted = true;
                activeDeckVid.play().catch(() => {});
              });
            }
          }

          const withUpdatedOverlays: TVChannel = {
            ...ch,
            everyNMinAds: updatedAds,
            bottomOverlay: nextBotOverlay,
            topOverlay: nextTopOverlay,
            lShape: nextLShape,
            graphics: nextGraphics as any,
          };

          // 4. Update active playback timecodes & auto-advance SWF / Image / fallback videos when full duration is reached
          if (ch.status !== 'PLAYING') {
            return withUpdatedOverlays;
          }

          const expectedKey = getActivePlaybackCycleKey(withUpdatedOverlays);

          if (ch.activeEveryNMinAd) {
            const adClip = ch.activeEveryNMinAd;
            const adUrl = adClip.url || adClip.videoUrl || '';
            const isSwfOrImageAd =
              swfEngine.isSwfUrl(adUrl, adClip.fileName || adClip.title) ||
              isImageUrl(adUrl, adClip.fileName || adClip.title);
            const isWaitingForDecoder =
              !isSwfOrImageAd &&
              (Boolean(adClip.isTranscoding) ||
                Boolean(activeDeckVid && !activeDeckVid.error && activeDeckVid.readyState < 2));
            const nextAdTime =
              isSwfOrImageAd
                ? (ch.everyNMinTime || 0) + 1
                : realVideoSec !== null
                ? realVideoSec
                : isWaitingForDecoder
                ? ch.everyNMinTime || 0
                : (ch.everyNMinTime || 0) + 1;
            const adDur = Math.max(1, adClip.duration || (isImageUrl(adUrl, adClip.fileName || adClip.title) ? 15 : 30));
            const isDeckMatchAndNearEof =
              activeDeckVid !== null &&
              activeDeckVid.dataset.clipKey === expectedKey &&
              Number.isFinite(activeDeckVid.duration) &&
              activeDeckVid.duration > 1 &&
              !activeDeckVid.seeking &&
              activeDeckVid.currentTime >= activeDeckVid.duration - 0.12;
            const shouldAdvanceAd = isSwfOrImageAd
              ? nextAdTime >= adDur
              : Boolean(activeDeckVid?.ended) ||
                isDeckMatchAndNearEof ||
                (Boolean(activeDeckVid?.error) && !isWaitingForDecoder && nextAdTime >= adDur);
            if (shouldAdvanceAd) {
              return advanceMainPlaybackOnClipEnd(withUpdatedOverlays, expectedKey, tickRandSeed);
            }
            return {
              ...withUpdatedOverlays,
              everyNMinTime: nextAdTime,
            };
          }

          if (ch.activeProgramId) {
            const activeProg = (ch.scheduledPrograms || []).find(
              (p) => p.id === ch.activeProgramId
            );
            const progClip = activeProg?.playlist[ch.activeProgramClipIndex || 0];
            if (!activeProg || activeProg.enabled === false || !progClip || progClip.enabled === false) {
              return advanceMainPlaybackOnClipEnd(withUpdatedOverlays, expectedKey, tickRandSeed);
            }
            const progUrl = progClip?.url || progClip?.videoUrl || '';
            const isSwfOrImageProg =
              swfEngine.isSwfUrl(progUrl, progClip?.fileName || progClip?.title) ||
              isImageUrl(progUrl, progClip?.fileName || progClip?.title);
            const isWaitingForDecoder =
              !isSwfOrImageProg &&
              (Boolean(progClip?.isTranscoding) ||
                Boolean(activeDeckVid && !activeDeckVid.error && activeDeckVid.readyState < 2));
            const nextProgTime =
              isSwfOrImageProg
                ? (ch.activeProgramTime || 0) + 1
                : realVideoSec !== null
                ? realVideoSec
                : isWaitingForDecoder
                ? ch.activeProgramTime || 0
                : (ch.activeProgramTime || 0) + 1;
            const progClipDur = Math.max(1, progClip?.duration || 180);
            const isProgDeckNearEof =
              activeDeckVid !== null &&
              activeDeckVid.dataset.clipKey === expectedKey &&
              Number.isFinite(activeDeckVid.duration) &&
              activeDeckVid.duration > 1 &&
              !activeDeckVid.seeking &&
              activeDeckVid.currentTime >= activeDeckVid.duration - 0.12;
            const shouldAdvanceProg = isSwfOrImageProg
              ? nextProgTime >= progClipDur
              : Boolean(activeDeckVid?.ended) ||
                isProgDeckNearEof ||
                (Boolean(activeDeckVid?.error) && !isWaitingForDecoder && nextProgTime >= progClipDur);
            if (shouldAdvanceProg) {
              return advanceMainPlaybackOnClipEnd(withUpdatedOverlays, expectedKey, tickRandSeed);
            }
            return {
              ...withUpdatedOverlays,
              activeProgramTime: nextProgTime,
            };
          }

          if (ch.liveInput?.active) {
            if (videoElementRef.current && !videoElementRef.current.paused) {
              videoElementRef.current.pause();
            }
            if (programVideoRef.current && !programVideoRef.current.paused) {
              programVideoRef.current.pause();
            }
            return withUpdatedOverlays;
          }

          if (ch.playlist.length === 0) {
            return withUpdatedOverlays;
          }

          const activeMainClip = ch.playlist[ch.currentClipIndex];
          if (!activeMainClip || activeMainClip.enabled === false) {
            return advanceMainPlaybackOnClipEnd(withUpdatedOverlays, expectedKey, tickRandSeed);
          }
          const mainUrl = activeMainClip?.url || activeMainClip?.videoUrl || '';
          const isSwfOrImageMain =
            swfEngine.isSwfUrl(mainUrl, activeMainClip?.fileName || activeMainClip?.title) ||
            isImageUrl(mainUrl, activeMainClip?.fileName || activeMainClip?.title);
          const isWaitingForDecoder =
            !isSwfOrImageMain &&
            (Boolean(activeMainClip?.isTranscoding) ||
              Boolean(activeDeckVid && !activeDeckVid.error && activeDeckVid.readyState < 2));
          const nextMainTime =
            isSwfOrImageMain
              ? (ch.currentTime || 0) + 1
              : realVideoSec !== null
              ? realVideoSec
              : isWaitingForDecoder
              ? ch.currentTime || 0
              : ch.currentTime + 1;
          const mainClipDur = Math.max(1, activeMainClip?.duration || 180);
          const isMainDeckNearEof =
            activeDeckVid !== null &&
            activeDeckVid.dataset.clipKey === expectedKey &&
            Number.isFinite(activeDeckVid.duration) &&
            activeDeckVid.duration > 1 &&
            !activeDeckVid.seeking &&
            activeDeckVid.currentTime >= activeDeckVid.duration - 0.12;
          const shouldAdvanceMain = isSwfOrImageMain
            ? nextMainTime >= mainClipDur
            : Boolean(activeDeckVid?.ended) ||
              isMainDeckNearEof ||
              (Boolean(activeDeckVid?.error) && !isWaitingForDecoder && nextMainTime >= mainClipDur);
          if (shouldAdvanceMain) {
            return advanceMainPlaybackOnClipEnd(withUpdatedOverlays, expectedKey, tickRandSeed);
          }

          return {
            ...withUpdatedOverlays,
            currentTime: nextMainTime,
          };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [everyNMinEnabled, everyNMinInterval]);

  // Update Live Input Config (M3U8, RTMP/RTSP Stream, USB Camera, YouTube Video/Live/Playlist, Every N Min Ads toggle)
  const handleUpdateLiveInput = (partial: Partial<LiveInputConfig>) => {
    if (partial.active) {
      hasUserInteractedRef.current = true;
    }
    const pausedMainFromDeck = captureDeckPausedTimeSec(videoElementRef.current, 0);
    setChannels((prev) =>
      prev.map((c) => {
        const currentLive: LiveInputConfig = c.liveInput || {
          active: false,
          sourceType: 'm3u8',
          streamUrl: '',
          playEveryMinAdsOnLive: true,
          volume: 100,
          muted: false,
          youtubeQueue: [],
          youtubeQueueIndex: 0,
          youtubeLoop: true,
        };
        const nextLive = { ...currentLive, ...partial };
        const turningLiveOn = Boolean(partial.active) && !currentLive.active;
        const safeMainTime = pausedMainFromDeck > 0 ? pausedMainFromDeck : c.currentTime || 0;
        const nextSavedMain = turningLiveOn
          ? c.savedMainPlaybackState || {
              clipIndex: c.currentClipIndex,
              currentTime: safeMainTime,
            }
          : c.savedMainPlaybackState;
        return {
          ...c,
          status: nextLive.active ? 'PLAYING' : c.status,
          savedMainPlaybackState: nextSavedMain,
          ...(turningLiveOn ? { activeEveryNMinAd: null, everyNMinQueue: [], activeProgramId: null } : {}),
          liveInput: nextLive,
        };
      })
    );
  };

  // Auto-advance sequential YouTube Video / Playlist Queue when active item finishes
  const handleAdvanceYouTubeQueue = (expectedVideoId?: string, expectedCycle?: number) => {
    setChannels((prev) =>
      prev.map((c) => {
        const live = c.liveInput;
        if (!live?.active || live.sourceType !== 'youtube') return c;
        const queue = Array.isArray(live.youtubeQueue) ? live.youtubeQueue : [];
        const curIdx = live.youtubeQueueIndex || 0;
        const curItem = queue[curIdx];
        if (expectedVideoId && curItem?.videoId && curItem.videoId !== expectedVideoId) {
          return c;
        }
        if (
          typeof expectedCycle === 'number' &&
          typeof live.youtubeCycle === 'number' &&
          live.youtubeCycle !== expectedCycle
        ) {
          return c;
        }
        const loopPlaylist = live.youtubeLoop !== false;
        const step = advanceYouTubeQueueIndex(queue, curIdx, loopPlaylist);
        if (step.shouldStop) {
          return {
            ...c,
            liveInput: {
              ...live,
              active: false,
              youtubeQueueIndex: 0,
            },
            status: c.playlist.length > 0 || Boolean(c.activeProgramId) ? 'PLAYING' : 'STOPPED',
          };
        }
        return {
          ...c,
          status: 'PLAYING',
          liveInput: {
            ...live,
            youtubeQueueIndex: step.nextIndex,
            youtubeCycle: Date.now(),
          },
        };
      })
    );
  };

  // Helper to immediately bind a live MediaStream to the live broadcast video element
  const attachLiveStreamToVideoElement = (stream: MediaStream) => {
    const el = liveVideoRef.current || videoElementRef.current;
    if (!el) return;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    delete el.dataset.clipKey;
    delete el.dataset.targetResumeSec;
    delete el.dataset.isSeekingResume;
    el.pause();
    el.removeAttribute('src');
    el.srcObject = stream;
    el.muted = Boolean(
      channel.liveInput?.muted || isSoftwareAudioMuted(channel.transmission.audio)
    );
    const tryPlay = () => {
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
    };
    el.onloadedmetadata = tryPlay;
    tryPlay();
  };

  // Start Live Camera / USB HDMI Capture Card
  const handleStartCameraCapture = async (deviceId?: string) => {
    stopFallbackCaptureStream();
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());

    let stream: MediaStream | null = null;
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { deviceId: { ideal: deviceId } } : true,
            audio: false,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } catch {}
        }
      }
    }

    if (!stream) {
      stream = createLiveBroadcastCaptureStream('camera', deviceId);
    }

    cameraStreamRef.current = stream;
    setLiveCameraActive(true);
    attachLiveStreamToVideoElement(stream);

    handleUpdateLiveInput({
      active: true,
      sourceType: 'camera',
      cameraDeviceId: deviceId,
    });
  };

  // Stop any active Live Input
  const handleStopLiveInput = () => {
    stopFallbackCaptureStream();
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (liveVideoRef.current && liveVideoRef.current.srcObject) {
      liveVideoRef.current.srcObject = null;
    }
    if (videoElementRef.current && videoElementRef.current.srcObject) {
      videoElementRef.current.srcObject = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setLiveCameraActive(false);
    setChannels((prev) =>
      prev.map((c) => {
        const savedMain = c.savedMainPlaybackState;
        const restoredIdx =
          savedMain && c.playlist.length > 0
            ? Math.max(0, Math.min(c.playlist.length - 1, savedMain.clipIndex))
            : c.currentClipIndex;
        const restoredTime = savedMain ? savedMain.currentTime : c.currentTime;
        if (savedMain && restoredTime > 0.05) {
          pendingResumeSeekRef.current = restoredTime;
        }
        return {
          ...c,
          liveCameraActive: false,
          liveInput: c.liveInput ? { ...c.liveInput, active: false } : undefined,
          currentClipIndex: restoredIdx,
          currentTime: restoredTime,
          savedMainPlaybackState: null,
          status: c.playlist.length > 0 || Boolean(c.activeProgramId) ? 'PLAYING' : 'STOPPED',
        } as any;
      })
    );
  };

  // Toggle Live Camera Input
  const handleToggleLiveCamera = async () => {
    if (liveCameraActive || channel.liveInput?.active) {
      handleStopLiveInput();
    } else {
      await handleStartCameraCapture();
    }
  };

  // Import local videos, SWF files, or folders into Main Playlist (O(1) instant + coalesced background probes for 5,000+ videos)
  const handleImportVideos = (
    channelId: number,
    files: FileList | File[],
    folderName?: string
  ) => {
    hasUserInteractedRef.current = true;
    const fileArr = folderName
      ? filterFolderVideoAndSwfFiles(files)
      : Array.from(files || []);
    if (fileArr.length === 0) return;

    const batchTs = Date.now();
    const totalCount = fileArr.length;
    const newItems = buildFastPlaylistItems(fileArr, {
      batchTimestamp: batchTs,
      folderName,
      extractFolder: extractFolderName,
      computeVaultId: computeVaultIdForFile,
      registerBlobUrl: registerLiveMediaInVault,
    });

    fileArr.forEach((file, idx) => {
      if (shouldEagerVaultSaveOnImport(idx, totalCount)) {
        saveMediaToOfflineVault(file, newItems[idx].vaultId).catch(() => {});
      }
    });

    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const wasEmpty = c.playlist.length === 0;
        return {
          ...c,
          status: 'PLAYING',
          currentClipIndex: wasEmpty ? 0 : c.currentClipIndex,
          currentTime: wasEmpty ? 0 : c.currentTime,
          playlist: [...c.playlist, ...newItems],
        };
      })
    );

    const queue = createMediaBatchQueue<PlaylistItem>({
      concurrency: 2,
      flushIntervalMs: 350,
      getId: (it) => it.id,
      worker: async (item, idx) => {
        if (!item.file || !item.url) return null;
        const eagerUpload = shouldEagerUploadOnImport(item.fileName || item.title, idx, totalCount);
        const res = await probeMediaFileDuration(
          item.file,
          item.url,
          idx < 3
            ? (localDuration) => {
                setChannels((prev) =>
                  prev.map((c) =>
                    c.id === channelId
                      ? {
                          ...c,
                          playlist: c.playlist.map((it) =>
                            it.id === item.id
                              ? { ...it, duration: localDuration, isTranscoding: false }
                              : it
                          ),
                        }
                      : c
                  )
                );
              }
            : undefined,
          {
            skipBackendUpload: !eagerUpload,
            skipOfflineVault: true,
          }
        );
        return {
          duration: res.duration,
          ...(res.transcoded && res.serverUrl
            ? { url: res.serverUrl, videoUrl: res.serverUrl }
            : {}),
          ...(res.serverUrl ? { serverUrl: res.serverUrl } : {}),
          ...(res.vaultId ? { vaultId: res.vaultId } : {}),
          ...(res.folderName ? { folderName: res.folderName } : {}),
          isTranscoding: false,
        };
      },
      onFlush: (patches) => {
        if (patches.size === 0) return;
        setChannels((prev) =>
          prev.map((c) =>
            c.id === channelId
              ? {
                  ...c,
                  playlist: c.playlist.map((it) => {
                    const p = patches.get(it.id);
                    if (!p) return it;
                    return {
                      ...it,
                      duration: p.duration ?? it.duration,
                      url: p.url || (it.url?.startsWith('blob:') ? it.url : p.serverUrl || it.url),
                      videoUrl:
                        p.videoUrl ||
                        (it.videoUrl?.startsWith('blob:') ? it.videoUrl : p.serverUrl || it.videoUrl),
                      serverUrl: p.serverUrl || (it as any).serverUrl,
                      vaultId: p.vaultId || it.vaultId,
                      folderName: it.folderName || p.folderName,
                      isTranscoding: false,
                    } as PlaylistItem;
                  }),
                }
              : c
          )
        );
      },
    });
    queue.enqueue(newItems);
  };

  // Track live On-Air Played Hours counter while channel is PLAYING
  useEffect(() => {
    if (channel.status !== 'PLAYING') return;
    const timer = window.setInterval(() => {
      setChannelOnAirSeconds((prev) => {
        const next = prev + 1;
        try {
          localStorage.setItem('ashoka_on_air_seconds_v15', String(next));
        } catch {}
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [channel.status]);

  // Immediately START channel playout
  const handleStartChannel = (channelId: number) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, status: 'PLAYING' } : c))
    );
    const vid = getActiveDeckVideoElement(channel);
    if (vid && (vid.src || (vid as any).srcObject) && vid.paused) {
      vid.play().catch(() => {
        vid.muted = true;
        vid.play().catch(() => {});
      });
    }
  };

  // Immediately STOP / TURN OFF channel playout
  const handleStopChannel = (channelId: number) => {
    setChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? {
              ...c,
              status: 'STOPPED',
              activeEveryNMinAd: null,
              everyNMinQueue: [],
            }
          : c
      )
    );
    videoElementRef.current?.pause();
    programVideoRef.current?.pause();
    adVideoRef.current?.pause();
  };

  // Reset Software (only called after user clicks Confirm in top bar confirmation overlay)
  // Preserves active License while resetting channels, playlists, programs, ads, and overlays
  const handleResetSoftware = async () => {
    [videoElementRef.current, programVideoRef.current, adVideoRef.current].forEach((el) => {
      if (el) {
        el.pause();
        el.removeAttribute('src');
        delete el.dataset.clipKey;
        delete el.dataset.clipBaseId;
        delete el.dataset.loadedUrl;
        delete el.dataset.isSeekingResume;
        delete el.dataset.targetResumeSec;
      }
    });
    if (overlayVideoRef.current) {
      overlayVideoRef.current.pause();
      overlayVideoRef.current.removeAttribute('src');
      delete overlayVideoRef.current.dataset.ovKey;
    }
    if (topOverlayVideoRef.current) {
      topOverlayVideoRef.current.pause();
      topOverlayVideoRef.current.removeAttribute('src');
      delete topOverlayVideoRef.current.dataset.ovKey;
    }
    if (lShapeVideoRef.current) {
      lShapeVideoRef.current.pause();
      lShapeVideoRef.current.removeAttribute('src');
      delete lShapeVideoRef.current.dataset.ovKey;
    }

    stopFallbackCaptureStream();
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setLiveCameraActive(false);

    const freshChannel: TVChannel = {
      ...INITIAL_CHANNELS[0],
      status: 'STOPPED',
      playlist: [],
      scheduledPrograms: [],
      everyNMinAds: [],
      activeEveryNMinAd: null,
      everyNMinQueue: [],
      activeProgramId: null,
      currentClipIndex: 0,
      currentTime: 0,
      graphics: {
        ...INITIAL_CHANNELS[0].graphics,
        demoWatermarkEnabled: !isLicensed,
        licenseRecord,
      } as any,
    };

    setChannels([freshChannel]);
    setEveryNMinEnabled(false);
    setEveryNMinCountdownSec(0);
    setChannelOnAirSeconds(0);

    try {
      localStorage.setItem('ashoka_on_air_seconds_v15', '0');
      localStorage.setItem('ashoka_playlist_playout_v15', JSON.stringify([freshChannel]));
      localStorage.setItem(
        'ashoka_playlist_meta_v15',
        JSON.stringify({
          everyNMinEnabled: false,
          everyNMinInterval: 15,
          licenseRecord,
          isLicensed,
        })
      );
    } catch {}

    await clearOfflineVaultForReset().catch(() => {});
    await saveCgBackendState(freshChannel).catch(() => {});
    await fetch('/api/playout/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  };

  const handleTogglePlay = (channelId: number) => {
    broadcastAudio.init();
    masterBroadcastBus.unlockAudio();
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        if (c.playlist.length === 0 && !c.activeProgramId && !c.activeEveryNMinAd && !c.liveInput?.active) return c;
        if (c.status === 'PLAYING') {
          const deckVid = getActiveDeckVideoElement(c);
          if (c.activeEveryNMinAd) {
            return {
              ...c,
              status: 'PAUSED',
              everyNMinTime: captureDeckPausedTimeSec(deckVid, c.everyNMinTime || 0),
            };
          }
          if (c.activeProgramId) {
            return {
              ...c,
              status: 'PAUSED',
              activeProgramTime: captureDeckPausedTimeSec(deckVid, c.activeProgramTime || 0),
            };
          }
          if (!c.liveInput?.active) {
            return {
              ...c,
              status: 'PAUSED',
              currentTime: captureDeckPausedTimeSec(deckVid, c.currentTime || 0),
            };
          }
          return { ...c, status: 'PAUSED' };
        }
        return {
          ...c,
          status: 'PLAYING',
        };
      })
    );
  };

  const handleToggleMute = (channelId: number) => {
    broadcastAudio.init();
    masterBroadcastBus.unlockAudio();
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const nextMuted = !c.transmission.audio.muted;
        try {
          syncChannelBcRef.current?.postMessage({ type: 'TOGGLE_MUTE', muted: nextMuted });
        } catch {}
        return {
          ...c,
          transmission: {
            ...c.transmission,
            audio: {
              ...c.transmission.audio,
              muted: nextMuted,
            },
          },
        };
      })
    );
  };

  const handleToggleSoftwareAudio = (channelId: number) => {
    broadcastAudio.init();
    masterBroadcastBus.unlockAudio();
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const curAudio = c.transmission.audio;
        const curSoftOn =
          typeof curAudio.softwareAudioEnabled === 'boolean'
            ? curAudio.softwareAudioEnabled
            : curAudio.audioOutputTarget !== 'display2';
        const curD2On =
          typeof curAudio.display2AudioEnabled === 'boolean'
            ? curAudio.display2AudioEnabled
            : curAudio.audioOutputTarget !== 'software';
        const nextSoftOn = !curSoftOn;
        const nextTarget: 'both' | 'software' | 'display2' =
          nextSoftOn && curD2On ? 'both' : nextSoftOn ? 'software' : 'display2';
        return {
          ...c,
          transmission: {
            ...c.transmission,
            audio: {
              ...curAudio,
              muted: !nextSoftOn && !curD2On,
              softwareAudioEnabled: nextSoftOn,
              display2AudioEnabled: curD2On,
              audioOutputTarget: nextTarget,
            },
          },
        };
      })
    );
  };

  const handleToggleDisplay2Audio = (channelId: number) => {
    broadcastAudio.init();
    masterBroadcastBus.unlockAudio();
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const curAudio = c.transmission.audio;
        const curSoftOn =
          typeof curAudio.softwareAudioEnabled === 'boolean'
            ? curAudio.softwareAudioEnabled
            : curAudio.audioOutputTarget !== 'display2';
        const curD2On =
          typeof curAudio.display2AudioEnabled === 'boolean'
            ? curAudio.display2AudioEnabled
            : curAudio.audioOutputTarget !== 'software';
        const nextD2On = !curD2On;
        const nextTarget: 'both' | 'software' | 'display2' =
          curSoftOn && nextD2On ? 'both' : curSoftOn ? 'software' : 'display2';
        try {
          syncChannelBcRef.current?.postMessage({ type: 'TOGGLE_MUTE', muted: !nextD2On });
        } catch {}
        return {
          ...c,
          transmission: {
            ...c.transmission,
            audio: {
              ...curAudio,
              muted: !curSoftOn && !nextD2On,
              softwareAudioEnabled: curSoftOn,
              display2AudioEnabled: nextD2On,
              audioOutputTarget: nextTarget,
            },
          },
        };
      })
    );
  };

  const handleSetAudioOutputTarget = (
    channelId: number,
    target: 'both' | 'software' | 'display2'
  ) => {
    broadcastAudio.init();
    masterBroadcastBus.unlockAudio();
    const softOn = target === 'both' || target === 'software';
    const d2On = target === 'both' || target === 'display2';
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        return {
          ...c,
          transmission: {
            ...c.transmission,
            audio: {
              ...c.transmission.audio,
              muted: false,
              softwareAudioEnabled: softOn,
              display2AudioEnabled: d2On,
              audioOutputTarget: target,
            },
          },
        };
      })
    );
  };

  const handleSeekVideo = (seconds: number) => {
    const vid = getActiveDeckVideoElement(channel);
    if (vid && vid.readyState >= 1 && !vid.error) {
      vid.currentTime = seconds;
    }
    setChannels((prev) =>
      prev.map((c) => {
        if (c.activeEveryNMinAd) {
          return { ...c, everyNMinTime: seconds };
        }
        if (c.activeProgramId) {
          return { ...c, activeProgramTime: seconds };
        }
        return { ...c, currentTime: seconds };
      })
    );
  };

  const handleTakeClip = (channelId: number, clipIndex: number) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const nextPlaylist = c.playlist.map((it, idx) =>
          idx === clipIndex && it.enabled === false ? { ...it, enabled: true } : it
        );
        return {
          ...c,
          playlist: nextPlaylist,
          status: 'PLAYING',
          loopCycle: (c.loopCycle || 0) + 1,
          activeProgramId: null,
          activeEveryNMinAd: null,
          everyNMinQueue: [],
          currentClipIndex: clipIndex,
          currentTime: 0,
        };
      })
    );
  };

  // Toggle Enable / Disable for an individual file in Main Playlist (with instant backend sync)
  const handleToggleClipEnabled = (channelId: number, clipId: string, nextEnabled?: boolean) => {
    hasUserInteractedRef.current = true;
    let resolvedState = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const targetIdx = c.playlist.findIndex((it) => it.id === clipId);
        if (targetIdx === -1) return c;
        const targetClip = c.playlist[targetIdx];
        const newEnabled =
          typeof nextEnabled === 'boolean' ? nextEnabled : targetClip.enabled === false;
        resolvedState = newEnabled;

        const nextPlaylist = c.playlist.map((it, idx) =>
          idx === targetIdx ? { ...it, enabled: newEnabled } : it
        );
        const enabledIndices = nextPlaylist
          .map((it, idx) => (it && it.enabled !== false ? idx : -1))
          .filter((idx) => idx >= 0);

        const wasPlayingTarget =
          targetIdx === c.currentClipIndex && !c.activeProgramId && !c.activeEveryNMinAd;

        let nextClipIndex = c.currentClipIndex;
        let nextTime = c.currentTime;
        let nextCycle = c.loopCycle || 0;

        if (!newEnabled && wasPlayingTarget) {
          nextCycle += 1;
          nextTime = 0;
          if (enabledIndices.length > 0) {
            nextClipIndex =
              enabledIndices.find((idx) => idx > targetIdx) ?? enabledIndices[0];
          }
        } else if (newEnabled && enabledIndices.length === 1) {
          nextClipIndex = targetIdx;
          nextTime = 0;
          nextCycle += 1;
        }

        const hasAnyPlayable =
          enabledIndices.length > 0 ||
          Boolean(c.activeProgramId) ||
          Boolean(c.activeEveryNMinAd) ||
          Boolean(c.liveInput?.active);

        return {
          ...c,
          playlist: nextPlaylist,
          currentClipIndex: nextClipIndex,
          currentTime: nextTime,
          loopCycle: nextCycle,
          status: hasAnyPlayable ? 'PLAYING' : 'STOPPED',
        };
      })
    );
    fetch('/api/playout/toggle-enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId,
        scope: 'main',
        targetType: 'file',
        itemId: clipId,
        enabled: resolvedState,
      }),
    }).catch(() => {});
  };

  // Toggle Enable / Disable for an entire Folder in Main Playlist (with instant backend sync)
  const handleToggleFolderEnabled = (
    channelId: number,
    folderName: string,
    nextEnabled?: boolean
  ) => {
    hasUserInteractedRef.current = true;
    let resolvedState = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const folderClips = c.playlist.filter((it) => it.folderName === folderName);
        if (folderClips.length === 0) return c;
        const anyEnabled = folderClips.some((it) => it.enabled !== false);
        const newEnabled =
          typeof nextEnabled === 'boolean' ? nextEnabled : !anyEnabled;
        resolvedState = newEnabled;

        const nextPlaylist = c.playlist.map((it) =>
          it.folderName === folderName ? { ...it, enabled: newEnabled } : it
        );
        const enabledIndices = nextPlaylist
          .map((it, idx) => (it && it.enabled !== false ? idx : -1))
          .filter((idx) => idx >= 0);

        const currentClip = c.playlist[c.currentClipIndex];
        const wasPlayingInFolder =
          currentClip?.folderName === folderName &&
          !c.activeProgramId &&
          !c.activeEveryNMinAd;

        let nextClipIndex = c.currentClipIndex;
        let nextTime = c.currentTime;
        let nextCycle = c.loopCycle || 0;

        if (!newEnabled && wasPlayingInFolder) {
          nextCycle += 1;
          nextTime = 0;
          if (enabledIndices.length > 0) {
            nextClipIndex =
              enabledIndices.find((idx) => idx > c.currentClipIndex) ?? enabledIndices[0];
          }
        } else if (
          newEnabled &&
          (c.playlist[c.currentClipIndex]?.enabled === false || c.status === 'STOPPED')
        ) {
          const firstInFolder = nextPlaylist.findIndex(
            (it) => it.folderName === folderName && it.enabled !== false
          );
          if (firstInFolder >= 0) {
            nextClipIndex = firstInFolder;
            nextTime = 0;
            nextCycle += 1;
          }
        }

        const hasAnyPlayable =
          enabledIndices.length > 0 ||
          Boolean(c.activeProgramId) ||
          Boolean(c.activeEveryNMinAd) ||
          Boolean(c.liveInput?.active);

        return {
          ...c,
          playlist: nextPlaylist,
          currentClipIndex: nextClipIndex,
          currentTime: nextTime,
          loopCycle: nextCycle,
          status: hasAnyPlayable ? 'PLAYING' : 'STOPPED',
        };
      })
    );
    fetch('/api/playout/toggle-enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId,
        scope: 'main',
        targetType: 'folder',
        folderName,
        enabled: resolvedState,
      }),
    }).catch(() => {});
  };

  const handleSkipNext = (channelId: number) => {
    const randSeed = Math.random();
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId || c.playlist.length === 0) return c;
        return advanceMainPlaybackOnClipEnd(
          {
            ...c,
            activeEveryNMinAd: null,
            activeProgramId: null,
            loopMode: 'playlist',
          },
          undefined,
          randSeed
        );
      })
    );
  };

  const handleRemoveClip = (channelId: number, clipId: string) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const removedIndex = c.playlist.findIndex((it) => it.id === clipId);
        if (removedIndex === -1) return c;
        const filtered = c.playlist.filter((it) => it.id !== clipId);
        const wasPlayingRemoved =
          removedIndex === c.currentClipIndex && !c.activeProgramId && !c.activeEveryNMinAd;

        let nextClipIndex = c.currentClipIndex;
        if (filtered.length === 0) {
          nextClipIndex = 0;
        } else if (removedIndex < c.currentClipIndex) {
          nextClipIndex = Math.max(0, c.currentClipIndex - 1);
        } else if (removedIndex === c.currentClipIndex) {
          nextClipIndex = c.currentClipIndex % filtered.length;
        } else {
          nextClipIndex = Math.min(c.currentClipIndex, filtered.length - 1);
        }

        const nextSavedMain = c.savedMainPlaybackState
          ? filtered.length === 0
            ? null
            : removedIndex < c.savedMainPlaybackState.clipIndex
            ? {
                ...c.savedMainPlaybackState,
                clipIndex: Math.max(0, c.savedMainPlaybackState.clipIndex - 1),
              }
            : removedIndex === c.savedMainPlaybackState.clipIndex
            ? {
                clipIndex: c.savedMainPlaybackState.clipIndex % filtered.length,
                currentTime: 0,
              }
            : c.savedMainPlaybackState
          : null;

        return {
          ...c,
          playlist: filtered,
          playedClipIds: (c.playedClipIds || []).filter((id) => id !== clipId),
          savedMainPlaybackState: nextSavedMain,
          loopCycle: wasPlayingRemoved ? (c.loopCycle || 0) + 1 : c.loopCycle,
          status:
            filtered.length === 0 &&
            !c.activeProgramId &&
            !c.activeEveryNMinAd &&
            !c.liveInput?.active
              ? 'STOPPED'
              : c.status,
          currentClipIndex: nextClipIndex,
          currentTime: filtered.length === 0 || wasPlayingRemoved ? 0 : c.currentTime,
        };
      })
    );
  };

  const handleRemoveFolder = (channelId: number, folderName: string) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const currentClip = c.playlist[c.currentClipIndex];
        const wasInDeletedFolder = currentClip?.folderName === folderName;
        const removedBeforeCurrent = c.playlist
          .slice(0, c.currentClipIndex)
          .filter((it) => it.folderName === folderName).length;
        const removedIds = new Set(
          c.playlist.filter((it) => it.folderName === folderName).map((it) => it.id)
        );
        const filtered = c.playlist.filter((it) => it.folderName !== folderName);

        let nextClipIndex = 0;
        if (filtered.length > 0) {
          if (wasInDeletedFolder) {
            nextClipIndex = (c.currentClipIndex - removedBeforeCurrent) % filtered.length;
          } else {
            nextClipIndex = Math.max(
              0,
              Math.min(filtered.length - 1, c.currentClipIndex - removedBeforeCurrent)
            );
          }
        }

        return {
          ...c,
          playlist: filtered,
          playedClipIds: (c.playedClipIds || []).filter((id) => !removedIds.has(id)),
          savedMainPlaybackState: null,
          loopCycle: wasInDeletedFolder ? (c.loopCycle || 0) + 1 : c.loopCycle,
          status:
            filtered.length === 0 &&
            !c.activeProgramId &&
            !c.activeEveryNMinAd &&
            !c.liveInput?.active
              ? 'STOPPED'
              : c.status,
          currentClipIndex: nextClipIndex,
          currentTime: filtered.length === 0 || wasInDeletedFolder ? 0 : c.currentTime,
        };
      })
    );
  };

  const handleMoveClip = (channelId: number, index: number, direction: 'up' | 'down') => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= c.playlist.length) return c;
        const list = [...c.playlist];
        const [moved] = list.splice(index, 1);
        list.splice(target, 0, moved);
        return { ...c, playlist: list };
      })
    );
  };

  const handleSetLoopMode = (channelId: number, mode: 'off' | 'single' | 'playlist') => {
    const safeMode = mode === 'off' ? 'off' : 'playlist';
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, loopMode: safeMode, status: 'PLAYING' } : c))
    );
  };

  const handleToggleShuffle = (channelId: number) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== channelId) return c;
        const nextShuffle = !c.shuffle;
        const currentId = c.playlist[c.currentClipIndex]?.id;
        return {
          ...c,
          shuffle: nextShuffle,
          playedClipIds: nextShuffle && currentId ? [currentId] : [],
          status: c.playlist.length > 0 ? 'PLAYING' : c.status,
        };
      })
    );
  };

  const handleClearPlaylist = (channelId: number) => {
    setChannels((prev) =>
      prev.map((c) =>
        c.id === channelId
          ? { ...c, playlist: [], status: 'STOPPED', currentClipIndex: 0, currentTime: 0 }
          : c
      )
    );
  };

  const handleUpdateGraphics = (
    id: number,
    graphicsOrUpdater:
      | BottomScrollConfig
      | ((prev: BottomScrollConfig) => BottomScrollConfig)
  ) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const nextGraphics =
          typeof graphicsOrUpdater === 'function'
            ? graphicsOrUpdater(c.graphics)
            : graphicsOrUpdater;
        return { ...c, graphics: nextGraphics };
      })
    );
  };

  const handleUpdateBottomOverlay = (
    id: number,
    overlayOrUpdater:
      | OverlayBannerConfig
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const current = c.bottomOverlay || INITIAL_CHANNELS[0].bottomOverlay!;
        const nextOverlay =
          typeof overlayOrUpdater === 'function'
            ? overlayOrUpdater(current)
            : overlayOrUpdater;
        return { ...c, bottomOverlay: nextOverlay };
      })
    );
  };

  const handleUpdateTopOverlay = (
    id: number,
    overlayOrUpdater:
      | OverlayBannerConfig
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => {
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const current = c.topOverlay || INITIAL_CHANNELS[0].topOverlay!;
        const nextOverlay =
          typeof overlayOrUpdater === 'function'
            ? overlayOrUpdater(current)
            : overlayOrUpdater;
        return { ...c, topOverlay: nextOverlay };
      })
    );
  };

  const handleUpdateLShape = (
    id: number,
    lShapeOrUpdater: LShapeConfig | ((prev: LShapeConfig) => LShapeConfig)
  ) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const current = c.lShape || INITIAL_CHANNELS[0].lShape!;
        const nextLShape =
          typeof lShapeOrUpdater === 'function'
            ? lShapeOrUpdater(current)
            : lShapeOrUpdater;
        const shouldAutoPlayBackend =
          nextLShape.enabled && (c.playlist.length > 0 || c.liveInput?.active);
        return {
          ...c,
          lShape: nextLShape,
          status: shouldAutoPlayBackend ? 'PLAYING' : c.status,
        };
      })
    );
    if (videoElementRef.current && videoElementRef.current.paused) {
      videoElementRef.current.play().catch(() => {});
    }
  };

  const handleUpdateTransmission = (id: number, transmission: TransmissionConfig) => {
    setChannels((prev) => prev.map((c) => (c.id === id ? { ...c, transmission } : c)));
  };

  const handleUpdateScheduledPrograms = (
    id: number,
    programsOrUpdater:
      | ScheduledProgram[]
      | ((prev: ScheduledProgram[]) => ScheduledProgram[])
  ) => {
    hasUserInteractedRef.current = true;
    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const current = c.scheduledPrograms || [];
        const nextPrograms =
          typeof programsOrUpdater === 'function'
            ? programsOrUpdater(current)
            : programsOrUpdater;

        // If the currently playing program or its active clip was deleted or disabled, advance to next enabled clip or resume Main Playlist immediately
        if (c.activeProgramId) {
          const oldProg = current.find((p) => p.id === c.activeProgramId);
          const nextProg = nextPrograms.find((p) => p.id === c.activeProgramId);
          const enabledProgClips = nextProg
            ? nextProg.playlist
                .map((cl, idx) => (cl.enabled !== false ? idx : -1))
                .filter((idx) => idx >= 0)
            : [];
          if (!nextProg || nextProg.enabled === false || enabledProgClips.length === 0) {
            const saved = c.savedMainPlaybackState;
            const enabledMainIndices = c.playlist
              .map((cl, idx) => (cl.enabled !== false ? idx : -1))
              .filter((idx) => idx >= 0);
            let safeMainIdx =
              saved && c.playlist.length > 0
                ? Math.max(0, Math.min(c.playlist.length - 1, saved.clipIndex))
                : Math.max(0, Math.min(Math.max(0, c.playlist.length - 1), c.currentClipIndex));
            let resumeMainTime = saved ? saved.currentTime : c.currentTime;
            if (enabledMainIndices.length > 0 && c.playlist[safeMainIdx]?.enabled === false) {
              safeMainIdx =
                enabledMainIndices.find((idx) => idx > safeMainIdx) ?? enabledMainIndices[0];
              resumeMainTime = 0;
            }
            if (saved && resumeMainTime > 0) {
              pendingResumeSeekRef.current = resumeMainTime;
            }
            return {
              ...c,
              scheduledPrograms: nextPrograms,
              loopCycle: (c.loopCycle || 0) + 1,
              activeProgramId: null,
              activeProgramClipIndex: 0,
              activeProgramTime: 0,
              savedProgramPlaybackState: null,
              currentClipIndex: safeMainIdx,
              currentTime: resumeMainTime,
              savedMainPlaybackState: null,
              status: enabledMainIndices.length > 0 || c.liveInput?.active ? 'PLAYING' : 'STOPPED',
            };
          }

          const oldClipIdx = c.activeProgramClipIndex || 0;
          const oldClipId = oldProg?.playlist[oldClipIdx]?.id;
          const newClipIdx = oldClipId
            ? nextProg.playlist.findIndex((it) => it.id === oldClipId && it.enabled !== false)
            : -1;
          if (newClipIdx === -1) {
            const nextEnabledIdx =
              enabledProgClips.find((idx) => idx >= oldClipIdx) ?? enabledProgClips[0];
            if (nextEnabledIdx !== undefined) {
              return {
                ...c,
                scheduledPrograms: nextPrograms,
                loopCycle: (c.loopCycle || 0) + 1,
                activeProgramClipIndex: nextEnabledIdx,
                activeProgramTime: 0,
              };
            }
          } else if (newClipIdx !== oldClipIdx) {
            return {
              ...c,
              scheduledPrograms: nextPrograms,
              activeProgramClipIndex: newClipIdx,
            };
          }
        }

        return { ...c, scheduledPrograms: nextPrograms };
      })
    );
  };

  const handleStartScheduledProgramNow = (id: number, programId: string) => {
    const vid = videoElementRef.current;
    const adVid = adVideoRef.current;
    const pausedMainSec = captureDeckPausedTimeSec(vid, 0);
    if (vid && !vid.paused) {
      vid.pause();
    }
    if (adVid && !adVid.paused) {
      adVid.pause();
    }
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;

    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const mainClip = c.playlist[c.currentClipIndex];
        if (
          !c.activeProgramId &&
          !c.activeEveryNMinAd &&
          mainClip &&
          swfEngine.isSwfUrl(mainClip.url, mainClip.fileName || mainClip.title)
        ) {
          swfEngine.pauseSwf(mainClip.url);
        }
        return startScheduledProgramOnChannel(
          c,
          programId,
          pausedMainSec || c.currentTime || 0,
          todayStr,
          true
        );
      })
    );
  };

  const handleStopScheduledProgramNow = (id: number) => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;

    setChannels((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const stoppedProgId = c.activeProgramId;
        const saved = c.savedMainPlaybackState;
        const safeMainIdx =
          saved && c.playlist.length > 0
            ? Math.max(0, Math.min(c.playlist.length - 1, saved.clipIndex))
            : Math.max(0, Math.min(Math.max(0, c.playlist.length - 1), c.currentClipIndex));
        if (saved) {
          pendingResumeSeekRef.current = saved.currentTime;
        }
        return {
          ...c,
          loopCycle: (c.loopCycle || 0) + 1,
          activeProgramId: null,
          activeProgramClipIndex: 0,
          activeProgramTime: 0,
          savedProgramPlaybackState: null,
          currentClipIndex: safeMainIdx,
          currentTime: saved ? saved.currentTime : c.currentTime,
          savedMainPlaybackState: null,
          status: c.playlist.length > 0 || c.liveInput?.active ? 'PLAYING' : 'STOPPED',
          scheduledPrograms: (c.scheduledPrograms || []).map((p) => {
            if (p.id !== stoppedProgId) return p;
            const isOneTimeProg =
              p.scheduleType === 'one_time' || p.scheduleType === 'once' || !p.scheduleType;
            return {
              ...p,
              status: isOneTimeProg ? ('completed' as const) : ('scheduled' as const),
              completed: isOneTimeProg,
              lastTriggeredDate: todayStr,
            };
          }),
        };
      })
    );
  };

  // Update Every N Min Ads list (supports direct array OR functional updater), enabled state, and default interval
  const handleUpdateEveryNMinAds = (
    adsOrUpdater:
      | EveryNMinAdItem[]
      | ((prev: EveryNMinAdItem[]) => EveryNMinAdItem[]),
    enabled?: boolean,
    defaultInterval?: EveryNMinIntervalOption
  ) => {
    if (typeof enabled === 'boolean') {
      setEveryNMinEnabled(enabled);
    }
    if (defaultInterval) {
      setEveryNMinInterval(defaultInterval);
    }
    setChannels((prev) =>
      prev.map((c) => {
        const currentAds = c.everyNMinAds || [];
        const nextAds =
          typeof adsOrUpdater === 'function'
            ? adsOrUpdater(currentAds)
            : adsOrUpdater;
        const effEnabled = typeof enabled === 'boolean' ? enabled : everyNMinEnabled;
        const effInt = defaultInterval || everyNMinInterval;
        const enabledAds = nextAds.filter((a) => a && a.enabled !== false);
        if (effEnabled && enabledAds.length > 0) {
          const firstTarget = (enabledAds[0].intervalMin || effInt) * 60;
          setEveryNMinCountdownSec(firstTarget);
        } else if (!effEnabled || enabledAds.length === 0) {
          setEveryNMinCountdownSec(0);
        }
        const syncedQueue = (c.everyNMinQueue || [])
          .map((q) => nextAds.find((a) => a.id === q.id && a.enabled !== false))
          .filter((q): q is EveryNMinAdItem => Boolean(q));

        // If the currently playing Every N Min Ad was deleted or disabled, immediately advance to the next queued ad or resume Program / Main Playlist
        if (c.activeEveryNMinAd) {
          const stillExists = nextAds.find(
            (a) => a.id === c.activeEveryNMinAd?.id && a.enabled !== false
          );
          if (!stillExists) {
            if (syncedQueue.length > 0) {
              return {
                ...c,
                everyNMinAds: nextAds,
                loopCycle: (c.loopCycle || 0) + 1,
                activeEveryNMinAd: syncedQueue[0],
                everyNMinQueue: syncedQueue.slice(1),
                everyNMinTime: 0,
              };
            }
            const savedProg = c.savedProgramPlaybackState;
            const savedMain = c.savedMainPlaybackState;
            if (savedProg) {
              pendingProgResumeSeekRef.current = savedProg.currentTime;
              return {
                ...c,
                everyNMinAds: nextAds,
                loopCycle: (c.loopCycle || 0) + 1,
                activeEveryNMinAd: null,
                everyNMinQueue: [],
                everyNMinTime: 0,
                activeProgramId: savedProg.programId,
                activeProgramClipIndex: savedProg.clipIndex,
                activeProgramTime: savedProg.currentTime,
                savedProgramPlaybackState: null,
              };
            }
            const safeMainIdx =
              savedMain && c.playlist.length > 0
                ? Math.max(0, Math.min(c.playlist.length - 1, savedMain.clipIndex))
                : Math.max(0, Math.min(Math.max(0, c.playlist.length - 1), c.currentClipIndex));
            if (savedMain) {
              pendingResumeSeekRef.current = savedMain.currentTime;
            }
            return {
              ...c,
              everyNMinAds: nextAds,
              loopCycle: (c.loopCycle || 0) + 1,
              activeEveryNMinAd: null,
              everyNMinQueue: [],
              everyNMinTime: 0,
              currentClipIndex: safeMainIdx,
              currentTime: savedMain ? savedMain.currentTime : c.currentTime,
              savedMainPlaybackState: null,
            };
          }
          return {
            ...c,
            everyNMinAds: nextAds,
            activeEveryNMinAd: stillExists,
            everyNMinQueue: syncedQueue,
          };
        }

        return {
          ...c,
          everyNMinAds: nextAds,
          activeEveryNMinAd: null,
          everyNMinQueue: syncedQueue,
        };
      })
    );
  };

  // Trigger a single Every N Min Ad OR play all ads one-by-one in sequence (1st Ad -> 2nd Ad -> ...)
  const handleTriggerEveryNMinNow = (adId?: string, playAllOneByOne: boolean = false) => {
    const mainVid = videoElementRef.current;
    const progVid = programVideoRef.current;
    const pausedMainFromDeck = captureDeckPausedTimeSec(mainVid, 0);
    const pausedProgFromDeck = captureDeckPausedTimeSec(progVid, 0);
    if (mainVid && !mainVid.paused) mainVid.pause();
    if (progVid && !progVid.paused) progVid.pause();

    setChannels((prev) =>
      prev.map((c) => {
        const ads = [...(c.everyNMinAds || [])].sort(
          (a, b) => (a.orderIndex || 1) - (b.orderIndex || 1)
        );
        if (ads.length === 0) return c;

        let queueToPlay: EveryNMinAdItem[] = [];
        if (playAllOneByOne || !adId) {
          queueToPlay = ads.filter((a) => a && a.enabled !== false);
        } else {
          const target = ads.find((a) => a.id === adId);
          if (target && target.enabled !== false) queueToPlay = [target];
        }

        if (queueToPlay.length === 0) return c;

        if (!c.activeEveryNMinAd) {
          if (c.activeProgramId) {
            const prog = (c.scheduledPrograms || []).find((p) => p.id === c.activeProgramId);
            const progClip = prog?.playlist[c.activeProgramClipIndex || 0];
            if (progClip && swfEngine.isSwfUrl(progClip.url, progClip.fileName || progClip.title)) {
              swfEngine.pauseSwf(progClip.url);
            }
          } else {
            const mainClip = c.playlist[c.currentClipIndex];
            if (mainClip && swfEngine.isSwfUrl(mainClip.url, mainClip.fileName || mainClip.title)) {
              swfEngine.pauseSwf(mainClip.url);
            }
          }
        }

        const safeMainSec = pausedMainFromDeck > 0 ? pausedMainFromDeck : c.currentTime || 0;
        const safeProgSec = pausedProgFromDeck > 0 ? pausedProgFromDeck : c.activeProgramTime || 0;
        return triggerEveryNMinAdOnChannel(c, queueToPlay, safeMainSec, safeProgSec);
      })
    );
  };

  const handleStopEveryNMinNow = () => {
    setChannels((prev) =>
      prev.map((c) => {
        const shouldActivateLShapeAfterAd = Boolean(
          c.lShape?.enabled &&
            (c.lShape.playlist?.length || 0) > 0 &&
            c.lShape.pendingAfterAd
        );
        const resumedLShape = c.lShape
          ? {
              ...c.lShape,
              periodicActive: shouldActivateLShapeAfterAd ? true : c.lShape.periodicActive,
              pendingAfterAd: false,
              currentTime: shouldActivateLShapeAfterAd ? 0 : c.lShape.currentTime || 0,
              periodicCounter: shouldActivateLShapeAfterAd ? 0 : c.lShape.periodicCounter || 0,
            }
          : c.lShape;

        const savedProg = c.savedProgramPlaybackState;
        if (savedProg && (c.scheduledPrograms || []).some((p) => p.id === savedProg.programId)) {
          pendingProgResumeSeekRef.current = savedProg.currentTime;
          return {
            ...c,
            status: 'PLAYING',
            loopCycle: (c.loopCycle || 0) + 1,
            activeEveryNMinAd: null,
            everyNMinQueue: [],
            everyNMinTime: 0,
            activeProgramId: savedProg.programId,
            activeProgramClipIndex: savedProg.clipIndex,
            activeProgramTime: savedProg.currentTime,
            savedProgramPlaybackState: null,
            lShape: resumedLShape,
          };
        }

        const saved = c.savedMainPlaybackState;
        if (saved) {
          pendingResumeSeekRef.current = saved.currentTime;
        }
        return {
          ...c,
          loopCycle: (c.loopCycle || 0) + 1,
          activeEveryNMinAd: null,
          everyNMinQueue: [],
          everyNMinTime: 0,
          currentClipIndex: saved ? saved.clipIndex : c.currentClipIndex,
          currentTime: saved ? saved.currentTime : c.currentTime,
          savedMainPlaybackState: null,
          lShape: resumedLShape,
          status:
            c.playlist.length > 0 || Boolean(c.activeProgramId) || Boolean(c.liveInput?.active)
              ? 'PLAYING'
              : 'STOPPED',
        };
      })
    );
  };

  const handleChangeFixedDisplay = (displayIdx: number) => {
    const saved = saveFixedDisplayIndex(displayIdx);
    setFixedDisplayIndex(saved);
  };

  const handleLaunchDisplayOutput = async (
    overrideDisplayIdx?: number,
    cleanMode: boolean = false,
    fitMode: 'contain' | 'fill' = 'fill'
  ) => {
    const targetIdx =
      typeof overrideDisplayIdx === 'number' && overrideDisplayIdx >= 1
        ? saveFixedDisplayIndex(overrideDisplayIdx)
        : fixedDisplayIndex;
    if (targetIdx !== fixedDisplayIndex) {
      setFixedDisplayIndex(targetIdx);
    }

    // Push live state synchronously to BroadcastChannel & localStorage, and fire backend live-sync in parallel
    // WITHOUT blocking window.open so Chrome/Edge preserve transient user activation for Display 2 launch & fullscreen.
    try {
      const currentCh = channels[0];
      if (currentCh) {
        const vid = getActiveDeckVideoElement(currentCh);
        const clipTime =
          vid && vid.readyState >= 1 && !currentCh.liveInput?.active
            ? vid.currentTime
            : currentCh.activeEveryNMinAd
            ? currentCh.everyNMinTime || 0
            : currentCh.activeProgramId
            ? currentCh.activeProgramTime || 0
            : currentCh.currentTime || 0;
        const seq = ++syncSeqRef.current;
        const payload = buildBroadcastChannelPayload(currentCh);
        const cgSync = videoGenerator.getAuthoritativeCgSyncSnapshot(currentCh);
        const snapshotBody = {
          syncSeq: seq,
          updatedAtMs: Date.now(),
          time: clipTime,
          isLicensed,
          licenseRecord,
          cgSync,
          channel: payload,
        };
        try {
          localStorage.setItem('ashoka_live_sync_snapshot_v1', JSON.stringify(snapshotBody));
        } catch {}
        try {
          syncChannelBcRef.current?.postMessage({
            type: 'SYNC_CHANNEL',
            syncSeq: seq,
            updatedAtMs: snapshotBody.updatedAtMs,
            channel: payload,
            time: clipTime,
            isLicensed,
            licenseRecord,
            cgSync,
          });
        } catch {}
        enqueueHttpLiveSyncRef.current?.(snapshotBody);
      }
    } catch {}

    // Launch dedicated 2nd Display Window synchronously inside the click gesture
    let openedWin: Window | null = null;
    try {
      openedWin = await openDisplayOutputWindow(targetIdx, fitMode, cleanMode);
    } catch {}

    // If popup was blocked or window could not open, fallback to in-window fullscreen output
    if (!openedWin) {
      setIsExternalOutputView(true);
      requestFullscreenOnDisplay(document.documentElement, targetIdx).catch(() => {});
    }
  };

  const syncStateRef = useRef({ channels, isLicensed, licenseRecord });
  syncStateRef.current = { channels, isLicensed, licenseRecord };

  const syncChannelBcRef = useRef<BroadcastChannel | null>(null);
  const syncSeqRef = useRef<number>(0);
  const enqueueHttpLiveSyncRef = useRef<((snapshotBody: any, coalesceBurst?: boolean) => void) | null>(null);

  // Persistent BroadcastChannel connection + Adaptive Cross-Profile HTTP Live-Sync push
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.search.includes('output=true')) return;

    const bc =
      'BroadcastChannel' in window
        ? new BroadcastChannel('ashoka_playout_broadcast_sync')
        : null;
    syncChannelBcRef.current = bc;
    let httpSyncInFlight = false;
    let queuedHttpBody: any = null;
    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCoalescedBody: any = null;
    let lastImmediateSyncAt = 0;

    const sendHttpBodyNow = (snapshotBody: any) => {
      try {
        localStorage.setItem('ashoka_live_sync_snapshot_v1', JSON.stringify(snapshotBody));
      } catch {}
      if (httpSyncInFlight) {
        queuedHttpBody = snapshotBody;
        return;
      }
      httpSyncInFlight = true;
      fetch('/api/playout/live-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotBody),
      })
        .catch(() => {})
        .finally(() => {
          httpSyncInFlight = false;
          if (queuedHttpBody) {
            const nextBody = queuedHttpBody;
            queuedHttpBody = null;
            sendHttpBodyNow(nextBody);
          }
        });
    };

    const flushHttpLiveSync = (snapshotBody: any, coalesceBurst: boolean = false) => {
      const now = Date.now();
      if (!coalesceBurst || now - lastImmediateSyncAt >= 90) {
        if (coalesceTimer) {
          clearTimeout(coalesceTimer);
          coalesceTimer = null;
          pendingCoalescedBody = null;
        }
        lastImmediateSyncAt = now;
        sendHttpBodyNow(snapshotBody);
        return;
      }
      pendingCoalescedBody = snapshotBody;
      if (!coalesceTimer) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null;
          const bodyToFlush = pendingCoalescedBody;
          pendingCoalescedBody = null;
          if (bodyToFlush) {
            lastImmediateSyncAt = Date.now();
            sendHttpBodyNow(bodyToFlush);
          }
        }, 75);
      }
    };
    enqueueHttpLiveSyncRef.current = flushHttpLiveSync;

    const getDeckClipTime = (ch: TVChannel, forcedTime?: number) => {
      if (typeof forcedTime === 'number') return forcedTime;
      const vid = getActiveDeckVideoElement(ch);
      if (vid && vid.readyState >= 1 && !ch.liveInput?.active) {
        return vid.currentTime;
      }
      if (ch.activeEveryNMinAd) return ch.everyNMinTime || 0;
      if (ch.activeProgramId) return ch.activeProgramTime || 0;
      return ch.currentTime || 0;
    };

    const broadcastState = (forcedTime?: number) => {
      try {
        const { channels: chs, isLicensed: lic, licenseRecord: licRec } = syncStateRef.current;
        const ch = chs[0];
        if (!ch) return;
        const clipTime = getDeckClipTime(ch, forcedTime);
        const seq = ++syncSeqRef.current;
        const payload = buildBroadcastChannelPayload(ch);
        const cgSync = videoGenerator.getAuthoritativeCgSyncSnapshot(ch);
        const snapshotBody = {
          syncSeq: seq,
          updatedAtMs: Date.now(),
          time: clipTime,
          isLicensed: lic,
          licenseRecord: licRec,
          cgSync,
          channel: payload,
        };

        if (bc) {
          bc.postMessage({
            type: 'SYNC_CHANNEL',
            syncSeq: seq,
            updatedAtMs: snapshotBody.updatedAtMs,
            channel: payload,
            time: clipTime,
            isLicensed: lic,
            licenseRecord: licRec,
            cgSync,
          });
        }
        flushHttpLiveSync(snapshotBody, false);
      } catch (err) {
        console.warn('Broadcast sync error:', err);
      }
    };

    broadcastState();

    if (bc) {
      bc.onmessage = (event) => {
        const data = event.data;
        if (data?.type === 'REQUEST_INITIAL_STATE') {
          broadcastState();
        } else if (data?.type === 'CLIP_ENDED') {
          const randSeed = Math.random();
          const { isLicensed: lic, licenseRecord: licRec } = syncStateRef.current;
          setChannels((prev) => {
            const updated = prev.map((c) => advanceMainPlaybackOnClipEnd(c, data.clipKey, randSeed));
            try {
              const payload = buildBroadcastChannelPayload(updated[0]);
              const resumedTime = updated[0] ? getActiveChannelPlaybackTimeSec(updated[0]) : 0;
              const cgSync = updated[0] ? videoGenerator.getAuthoritativeCgSyncSnapshot(updated[0]) : undefined;
              const seq = ++syncSeqRef.current;
              const snapshotBody = {
                syncSeq: seq,
                updatedAtMs: Date.now(),
                time: resumedTime,
                isLicensed: lic,
                licenseRecord: licRec,
                cgSync,
                channel: payload,
              };
              bc.postMessage({
                type: 'SYNC_CHANNEL',
                syncSeq: seq,
                updatedAtMs: snapshotBody.updatedAtMs,
                channel: payload,
                time: resumedTime,
                isLicensed: lic,
                licenseRecord: licRec,
                cgSync,
              });
              flushHttpLiveSync(snapshotBody, false);
            } catch {}
            return updated;
          });
        }
      };
    }

    let syncTick = 0;
    const timeSyncInterval = setInterval(() => {
      syncTick += 1;
      const { channels: chs, isLicensed: lic, licenseRecord: licRec } = syncStateRef.current;
      const ch = chs[0];
      if (!ch) return;
      const vid = getActiveDeckVideoElement(ch);
      const clipTime = getDeckClipTime(ch);
      const cgSync = videoGenerator.getAuthoritativeCgSyncSnapshot(ch);
      if (ch.status === 'PLAYING' && bc) {
        bc.postMessage({
          type: 'SYNC_TIME',
          time: vid && !vid.paused ? vid.currentTime : clipTime,
          cgSync,
          updatedAtMs: Date.now(),
        });
      }
      if (ch.status === 'PLAYING' || syncTick % 3 === 0) {
        const seq = ++syncSeqRef.current;
        const snapshotBody = {
          syncSeq: seq,
          updatedAtMs: Date.now(),
          time: clipTime,
          isLicensed: lic,
          licenseRecord: licRec,
          cgSync,
          channel: buildBroadcastChannelPayload(ch),
        };
        flushHttpLiveSync(snapshotBody, false);
      }
    }, 1000);

    return () => {
      clearInterval(timeSyncInterval);
      if (coalesceTimer) clearTimeout(coalesceTimer);
      syncChannelBcRef.current = null;
      enqueueHttpLiveSyncRef.current = null;
      if (bc) bc.close();
    };
  }, []);

  // Broadcast SYNC_CHANNEL + HTTP Live-Sync ONLY on genuine visual/structural changes (never duplicate 1Hz logo/banner ticks)
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.search.includes('output=true')) return;
    const bc = syncChannelBcRef.current;
    try {
      const ch = channels[0];
      if (!ch) return;
      const visualSig = JSON.stringify({
        st: ch.status,
        ci: ch.currentClipIndex,
        lc: ch.loopCycle,
        lm: ch.loopMode,
        sh: ch.shuffle,
        pl: computeFastPlaylistSignature(ch.playlist, ch.currentClipIndex),
        sp: (ch.scheduledPrograms || []).map(
          (p) =>
            `${p.id}:${p.enabled}:${p.status}:${p.completed}:${p.startDate}:${p.startTime}:${p.overlayMode}:${computeFastPlaylistSignature(p.playlist, 0)}`
        ),
        api: ch.activeProgramId,
        apci: ch.activeProgramClipIndex,
        aa: ch.activeEveryNMinAd?.id || null,
        aq: (ch.everyNMinQueue || []).map((a) => a.id).join(','),
        li: ch.liveInput,
        bo: ch.bottomOverlay ? { ...ch.bottomOverlay, currentTime: 0 } : null,
        to: ch.topOverlay ? { ...ch.topOverlay, currentTime: 0 } : null,
        ls: ch.lShape ? { ...ch.lShape, currentTime: 0, periodicCounter: 0 } : null,
        gr: stripVolatileLogoTimes(ch.graphics),
        tr: ch.transmission,
        il: isLicensed,
        lr: licenseRecord,
      });
      if (visualSig === lastBroadcastVisualSigRef.current) return;
      lastBroadcastVisualSigRef.current = visualSig;

      const vid = getActiveDeckVideoElement(ch);
      const clipTime =
        vid && vid.readyState >= 1 && !ch.liveInput?.active
          ? vid.currentTime
          : ch.activeEveryNMinAd
          ? ch.everyNMinTime || 0
          : ch.activeProgramId
          ? ch.activeProgramTime || 0
          : ch.currentTime || 0;
      const seq = ++syncSeqRef.current;
      const payload = buildBroadcastChannelPayload(ch);
      const cgSync = videoGenerator.getAuthoritativeCgSyncSnapshot(ch);
      const snapshotBody = {
        syncSeq: seq,
        updatedAtMs: Date.now(),
        time: clipTime,
        isLicensed,
        licenseRecord,
        cgSync,
        channel: payload,
      };
      if (bc) {
        bc.postMessage({
          type: 'SYNC_CHANNEL',
          syncSeq: seq,
          updatedAtMs: snapshotBody.updatedAtMs,
          channel: payload,
          time: clipTime,
          isLicensed,
          licenseRecord,
          cgSync,
        });
      }
      enqueueHttpLiveSyncRef.current?.(snapshotBody, true);
    } catch {}
  }, [
    channel.status,
    channel.currentClipIndex,
    channel.loopCycle,
    channel.loopMode,
    channel.shuffle,
    channel.playlist,
    channel.scheduledPrograms,
    channel.activeProgramId,
    channel.activeProgramClipIndex,
    channel.activeEveryNMinAd,
    channel.everyNMinQueue,
    channel.liveInput,
    channel.bottomOverlay,
    channel.topOverlay,
    channel.lShape,
    channel.graphics,
    channel.transmission.audio.muted,
    channel.transmission.audio.audioOutputTarget,
    channel.transmission.audio.softwareAudioEnabled,
    channel.transmission.audio.display2AudioEnabled,
    channel.transmission.audio.masterVolume,
    isLicensed,
    licenseRecord,
  ]);

  const handleCloseSoftware = () => {
    handleSaveChannel();
    try {
      fetch('/api/app/exit', { method: 'POST', keepalive: true }).catch(() => {});
    } catch {}
    try {
      window.close();
    } catch {}
    setIsAppMinimized(true);
  };

  // Clean Standalone 2nd Display Output Window (opened via window.open / ?output=true)
  if (isExternalOutputView && typeof window !== 'undefined' && window.location.search.includes('output=true')) {
    return (
      <div className="w-screen h-screen bg-black overflow-hidden select-none">
        <ExternalOutputWindow
          channel={channel}
          targetDisplayIndex={fixedDisplayIndex}
          onExitOutputMode={() => {
            window.close();
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-black text-slate-100 flex flex-col font-sans select-none">
      {/* Fullscreen Stage + GPU Direct-Video Decoders (aligned over PGM OUT / Fullscreen so Chromium decodes at full 60FPS without 2D copy) */}
      <div
        ref={monitorFullscreenRef}
        className={
          isMonitorFullscreen
            ? 'fixed inset-0 z-[200] bg-black flex items-center justify-center w-screen h-screen overflow-hidden select-none'
            : 'w-0 h-0 overflow-visible pointer-events-none'
        }
      >
        {isMonitorFullscreen && (
          <div
            ref={fullscreenStageBoxRef}
            onDoubleClick={handleToggleMonitorFullscreen}
            style={{ width: 'min(100vw, 177.7778vh)', height: 'min(100vh, 56.25vw)' }}
            className="relative flex items-center justify-center bg-black overflow-hidden pointer-events-auto"
          >
            {shouldKeepYouTubeLayerMounted(channel) && (
              <YouTubeBroadcastLayer
                channel={channel}
                muted={isSoftwareAudioMuted(channel.transmission.audio) || Boolean(channel.liveInput?.muted)}
                volume={channel.liveInput?.volume ?? 100}
                paused={channel.status !== 'PLAYING' || !isYouTubeLiveStageActive(channel)}
                visible={isYouTubeLiveStageActive(channel)}
                isAuthoritative={true}
                onEnded={handleAdvanceYouTubeQueue}
              />
            )}
            <canvas
              ref={fullscreenCanvasRef}
              width={1920}
              height={1080}
              className="relative z-20 w-full h-full object-contain cursor-pointer pointer-events-none bg-transparent"
              title="Double-click or press ESC to exit Fullscreen"
            />
          </div>
        )}
        <div
          ref={studioVideoStageRef}
          style={{
            position: 'fixed',
            bottom: 0,
            right: 0,
            width: 160,
            height: 90,
            opacity: 0.02,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
        <video
          ref={videoElementRef}
          style={getStudioDeckVideoStyle('main')}
          playsInline
          autoPlay
          preload="auto"
          crossOrigin="anonymous"
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            restoreDeckAudio(vid);
            if (
              channel.status === 'PLAYING' &&
              !channel.activeEveryNMinAd &&
              !channel.activeProgramId &&
              !channel.liveInput?.active &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
          }}
          onPlaying={(e) => {
            consecutiveDeckFailRef.current = 0;
            restoreDeckAudio(e.currentTarget);
          }}
          onSeeked={(e) => {
            const vid = e.currentTarget;
            delete vid.dataset.isSeekingResume;
            delete vid.dataset.targetResumeSec;
          }}
          onTimeUpdate={(e) => {
            const vid = e.currentTarget;
            const targetSec = Number(vid.dataset.targetResumeSec || 0);
            if (targetSec > 0 && vid.currentTime >= targetSec - 0.4 && !vid.seeking) {
              delete vid.dataset.isSeekingResume;
              delete vid.dataset.targetResumeSec;
            }
          }}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            if (activeSeekOnMetadataRef.current !== null && activeSeekOnMetadataRef.current > 0.05) {
              const targetSeek = Number.isFinite(vid.duration)
                ? Math.min(Math.max(0, vid.duration - 0.25), activeSeekOnMetadataRef.current)
                : activeSeekOnMetadataRef.current;
              try {
                vid.currentTime = targetSeek;
              } catch {}
              activeSeekOnMetadataRef.current = null;
            }
            if (
              channel.status === 'PLAYING' &&
              !channel.activeEveryNMinAd &&
              !channel.activeProgramId &&
              !channel.liveInput?.active &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
            if (Number.isFinite(vid.duration) && vid.duration > 0.5 && vid.duration < 86400) {
              const realDur = Math.max(1, Math.ceil(vid.duration));
              setChannels((prev) =>
                prev.map((c) => {
                  const mIdx = c.currentClipIndex;
                  return {
                    ...c,
                    playlist: c.playlist.map((cl, idx) =>
                      idx === mIdx ? { ...cl, duration: realDur, isTranscoding: false } : cl
                    ),
                  };
                })
              );
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.videoHeight === 0) {
              const clip = channelRef.current.playlist[channelRef.current.currentClipIndex];
              handleDeckUnplayableFallback(vid, 'main', clip);
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            const clip = channelRef.current.playlist[channelRef.current.currentClipIndex];
            handleDeckUnplayableFallback(vid, 'main', clip);
          }}
          onEnded={(e) => {
            const endedKey = e.currentTarget.dataset.clipKey || undefined;
            const randSeed = Math.random();
            setChannels((prev) =>
              prev.map((c) => advanceMainPlaybackOnClipEnd(c, endedKey, randSeed))
            );
          }}
        />
        {/* Dedicated Scheduled Program Playlist Video Deck (never unloads Main Playlist deck) */}
        <video
          ref={programVideoRef}
          style={getStudioDeckVideoStyle('prog')}
          playsInline
          autoPlay
          preload="auto"
          crossOrigin="anonymous"
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            restoreDeckAudio(vid);
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.activeProgramId) &&
              !channel.activeEveryNMinAd &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
          }}
          onPlaying={(e) => {
            consecutiveDeckFailRef.current = 0;
            restoreDeckAudio(e.currentTarget);
          }}
          onSeeked={(e) => {
            const vid = e.currentTarget;
            delete vid.dataset.isSeekingResume;
            delete vid.dataset.targetResumeSec;
          }}
          onTimeUpdate={(e) => {
            const vid = e.currentTarget;
            const targetSec = Number(vid.dataset.targetResumeSec || 0);
            if (targetSec > 0 && vid.currentTime >= targetSec - 0.4 && !vid.seeking) {
              delete vid.dataset.isSeekingResume;
              delete vid.dataset.targetResumeSec;
            }
          }}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            if (
              activeProgSeekOnMetadataRef.current !== null &&
              activeProgSeekOnMetadataRef.current > 0.05
            ) {
              const targetSeek = Number.isFinite(vid.duration)
                ? Math.min(Math.max(0, vid.duration - 0.25), activeProgSeekOnMetadataRef.current)
                : activeProgSeekOnMetadataRef.current;
              try {
                vid.currentTime = targetSeek;
              } catch {}
              activeProgSeekOnMetadataRef.current = null;
            }
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.activeProgramId) &&
              !channel.activeEveryNMinAd &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
            if (Number.isFinite(vid.duration) && vid.duration > 0.5 && vid.duration < 86400) {
              const realDur = Math.max(1, Math.ceil(vid.duration));
              setChannels((prev) =>
                prev.map((c) => {
                  if (!c.activeProgramId) return c;
                  const pIdx = c.activeProgramClipIndex || 0;
                  return {
                    ...c,
                    scheduledPrograms: (c.scheduledPrograms || []).map((p) =>
                      p.id === c.activeProgramId
                        ? {
                            ...p,
                            playlist: p.playlist.map((cl, idx) =>
                              idx === pIdx ? { ...cl, duration: realDur, isTranscoding: false } : cl
                            ),
                          }
                        : p
                    ),
                  };
                })
              );
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.videoHeight === 0) {
              const chNow = channelRef.current;
              const activeProg = chNow.activeProgramId
                ? (chNow.scheduledPrograms || []).find((p) => p.id === chNow.activeProgramId)
                : undefined;
              const clip = activeProg?.playlist[chNow.activeProgramClipIndex || 0];
              handleDeckUnplayableFallback(vid, 'prog', clip);
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            const chNow = channelRef.current;
            const activeProg = chNow.activeProgramId
              ? (chNow.scheduledPrograms || []).find((p) => p.id === chNow.activeProgramId)
              : undefined;
            const clip = activeProg?.playlist[chNow.activeProgramClipIndex || 0];
            handleDeckUnplayableFallback(vid, 'prog', clip);
          }}
          onEnded={(e) => {
            const endedKey = e.currentTarget.dataset.clipKey || undefined;
            const randSeed = Math.random();
            setChannels((prev) =>
              prev.map((c) => advanceMainPlaybackOnClipEnd(c, endedKey, randSeed))
            );
          }}
        />
        {/* Dedicated Every N Min Commercial Ad Video Deck (never unloads Main or Program decks) */}
        <video
          ref={adVideoRef}
          style={getStudioDeckVideoStyle('ad')}
          playsInline
          autoPlay
          preload="auto"
          crossOrigin="anonymous"
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            restoreDeckAudio(vid);
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.activeEveryNMinAd) &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
          }}
          onPlaying={(e) => {
            consecutiveDeckFailRef.current = 0;
            restoreDeckAudio(e.currentTarget);
          }}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            const targetResume = Number(vid.dataset.targetResumeSec || 0);
            if (targetResume > 0.1) {
              delete vid.dataset.targetResumeSec;
              const clamped = Number.isFinite(vid.duration)
                ? Math.min(Math.max(0, vid.duration - 0.25), targetResume)
                : targetResume;
              try {
                vid.currentTime = clamped;
              } catch {}
            }
            restoreDeckAudio(vid);
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.activeEveryNMinAd) &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
            if (Number.isFinite(vid.duration) && vid.duration > 0.5 && vid.duration < 86400) {
              const realDur = Math.max(1, Math.ceil(vid.duration));
              setChannels((prev) =>
                prev.map((c) => {
                  if (!c.activeEveryNMinAd) return c;
                  const adId = c.activeEveryNMinAd.id;
                  return {
                    ...c,
                    activeEveryNMinAd: {
                      ...c.activeEveryNMinAd,
                      duration: realDur,
                      isTranscoding: false,
                    },
                    everyNMinAds: (c.everyNMinAds || []).map((a) =>
                      a.id === adId ? { ...a, duration: realDur, isTranscoding: false } : a
                    ),
                  };
                })
              );
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.videoHeight === 0) {
              handleDeckUnplayableFallback(vid, 'ad', channelRef.current.activeEveryNMinAd);
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            handleDeckUnplayableFallback(vid, 'ad', channelRef.current.activeEveryNMinAd);
          }}
          onEnded={(e) => {
            const endedKey = e.currentTarget.dataset.clipKey || undefined;
            const randSeed = Math.random();
            setChannels((prev) =>
              prev.map((c) => advanceMainPlaybackOnClipEnd(c, endedKey, randSeed))
            );
          }}
        />
        {/* Dedicated Live Input Video Deck (USB Camera/HDMI Card, M3U8, RTMP/RTSP) */}
        <video
          ref={liveVideoRef}
          style={getStudioDeckVideoStyle('live')}
          playsInline
          autoPlay
          preload="auto"
          crossOrigin="anonymous"
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.liveInput?.active) &&
              !channel.activeEveryNMinAd &&
              !channel.activeProgramId &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
          }}
          onPlaying={(e) => {
            const vid = e.currentTarget;
            if (channel.liveInput?.muted) {
              vid.muted = true;
            } else {
              restoreDeckAudio(vid);
            }
          }}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            if (channel.liveInput?.muted) {
              vid.muted = true;
            } else {
              restoreDeckAudio(vid);
            }
            if (
              channel.status === 'PLAYING' &&
              Boolean(channel.liveInput?.active) &&
              !channel.activeEveryNMinAd &&
              !channel.activeProgramId &&
              vid.paused
            ) {
              vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
              });
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            const rawUrl = (channel.liveInput?.streamUrl || '')
              .trim()
              .replace(/^["']+|["']+$/g, '')
              .trim();
            if (!rawUrl || !channel.liveInput?.active) return;
            const lower = rawUrl.toLowerCase();
            if (
              (lower.startsWith('http://') || lower.startsWith('https://')) &&
              vid.dataset.triedProxyFallback !== 'true'
            ) {
              vid.dataset.triedProxyFallback = 'true';
              vid.src = `/api/live/m3u8-proxy?url=${encodeURIComponent(rawUrl)}`;
              vid.load();
              vid.play().catch(() => {});
            }
          }}
        />
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
          ref={overlayVideoRef}
          style={{ width: 16, height: 16, objectFit: 'fill' }}
          playsInline
          autoPlay
          preload="auto"
          muted
          crossOrigin="anonymous"
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            const pending = Number(vid.dataset.pendingSeek || 0);
            if (pending > 0.1) {
              delete vid.dataset.pendingSeek;
              try {
                vid.currentTime = Number.isFinite(vid.duration)
                  ? Math.min(Math.max(0, vid.duration - 0.2), pending)
                  : pending;
              } catch {}
            }
            if (channel.bottomOverlay?.enabled && channel.bottomOverlay?.keyEnabled !== false && vid.paused) {
              vid.play().catch(() => {});
            }
          }}
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            if (channel.bottomOverlay?.enabled && channel.bottomOverlay?.keyEnabled !== false && vid.paused) {
              vid.play().catch(() => {});
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.dataset.triedVlcStream !== 'true') {
              try {
                const parsed = new URL(vid.src, window.location.origin);
                if (parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) {
                  vid.dataset.triedVlcStream = 'true';
                  vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  vid.load();
                  vid.play().catch(() => {});
                }
              } catch {}
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            try {
              const parsed = new URL(vid.src, window.location.origin);
              if (
                parsed.pathname.startsWith('/uploads/') &&
                vid.dataset.triedVlcStream !== 'true'
              ) {
                vid.dataset.triedVlcStream = 'true';
                vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                vid.load();
                vid.play().catch(() => {});
              }
            } catch {}
          }}
          onEnded={(e) => {
            const vid = e.currentTarget;
            const tickedCount = (channel.bottomOverlay?.playlist || []).filter((it) => it && it.enabled !== false).length;
            if (tickedCount <= 1) {
              try {
                vid.currentTime = 0;
              } catch {}
              vid.play().catch(() => {});
              return;
            }
            setChannels((prev) =>
              prev.map((c) => {
                const bot = c.bottomOverlay;
                if (!bot || !bot.playlist || bot.playlist.length <= 1) return c;
                const tickedIndices = bot.playlist
                  .map((it, idx) => (it && it.enabled !== false ? idx : -1))
                  .filter((idx) => idx >= 0);
                if (tickedIndices.length <= 1) return c;
                const curIdx = bot.currentIndex || 0;
                const pos = tickedIndices.indexOf(curIdx);
                const nextIdx =
                  tickedIndices[(pos >= 0 ? pos + 1 : 0) % tickedIndices.length];
                return {
                  ...c,
                  bottomOverlay: { ...bot, currentIndex: nextIdx, currentTime: 0 },
                };
              })
            );
          }}
        />
        <video
          ref={topOverlayVideoRef}
          style={{ width: 16, height: 16, objectFit: 'fill' }}
          playsInline
          autoPlay
          preload="auto"
          muted
          crossOrigin="anonymous"
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            const pending = Number(vid.dataset.pendingSeek || 0);
            if (pending > 0.1) {
              delete vid.dataset.pendingSeek;
              try {
                vid.currentTime = Number.isFinite(vid.duration)
                  ? Math.min(Math.max(0, vid.duration - 0.2), pending)
                  : pending;
              } catch {}
            }
            if (channel.topOverlay?.enabled && channel.topOverlay?.keyEnabled !== false && vid.paused) {
              vid.play().catch(() => {});
            }
          }}
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            if (channel.topOverlay?.enabled && channel.topOverlay?.keyEnabled !== false && vid.paused) {
              vid.play().catch(() => {});
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.dataset.triedVlcStream !== 'true') {
              try {
                const parsed = new URL(vid.src, window.location.origin);
                if (parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) {
                  vid.dataset.triedVlcStream = 'true';
                  vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  vid.load();
                  vid.play().catch(() => {});
                }
              } catch {}
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            try {
              const parsed = new URL(vid.src, window.location.origin);
              if (
                parsed.pathname.startsWith('/uploads/') &&
                vid.dataset.triedVlcStream !== 'true'
              ) {
                vid.dataset.triedVlcStream = 'true';
                vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                vid.load();
                vid.play().catch(() => {});
              }
            } catch {}
          }}
          onEnded={(e) => {
            const vid = e.currentTarget;
            const tickedCount = (channel.topOverlay?.playlist || []).filter((it) => it && it.enabled !== false).length;
            if (tickedCount <= 1) {
              try {
                vid.currentTime = 0;
              } catch {}
              vid.play().catch(() => {});
              return;
            }
            setChannels((prev) =>
              prev.map((c) => {
                const top = c.topOverlay;
                if (!top || !top.playlist || top.playlist.length <= 1) return c;
                const tickedIndices = top.playlist
                  .map((it, idx) => (it && it.enabled !== false ? idx : -1))
                  .filter((idx) => idx >= 0);
                if (tickedIndices.length <= 1) return c;
                const curIdx = top.currentIndex || 0;
                const pos = tickedIndices.indexOf(curIdx);
                const nextIdx =
                  tickedIndices[(pos >= 0 ? pos + 1 : 0) % tickedIndices.length];
                return {
                  ...c,
                  topOverlay: { ...top, currentIndex: nextIdx, currentTime: 0 },
                };
              })
            );
          }}
        />
        <video
          ref={lShapeVideoRef}
          style={{ width: 16, height: 16, objectFit: 'fill' }}
          playsInline
          autoPlay
          preload="auto"
          muted
          crossOrigin="anonymous"
          onCanPlay={(e) => {
            const vid = e.currentTarget;
            if (channel.lShape?.enabled && vid.paused) {
              vid.play().catch(() => {});
            }
          }}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            if (vid.videoWidth === 0 && vid.dataset.triedVlcStream !== 'true') {
              try {
                const parsed = new URL(vid.src, window.location.origin);
                if (parsed.pathname.startsWith('/uploads/') || parsed.pathname.startsWith('/api/media/by-name/')) {
                  vid.dataset.triedVlcStream = 'true';
                  vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                  vid.load();
                  vid.play().catch(() => {});
                }
              } catch {}
            }
          }}
          onError={(e) => {
            const vid = e.currentTarget;
            try {
              const parsed = new URL(vid.src, window.location.origin);
              if (
                parsed.pathname.startsWith('/uploads/') &&
                vid.dataset.triedVlcStream !== 'true'
              ) {
                vid.dataset.triedVlcStream = 'true';
                vid.src = `/api/media/vlc-stream?url=${encodeURIComponent(parsed.pathname)}`;
                vid.load();
                vid.play().catch(() => {});
              }
            } catch {}
          }}
          onEnded={() => {
            setChannels((prev) =>
              prev.map((c) => {
                const lShape = c.lShape;
                if (!lShape || !lShape.playlist || lShape.playlist.length <= 1) return c;
                const tickedIndices = lShape.playlist
                  .map((it, idx) => (it && it.enabled !== false ? idx : -1))
                  .filter((idx) => idx >= 0);
                if (tickedIndices.length === 0) return c;
                const curIdx = lShape.currentIndex || 0;
                const pos = tickedIndices.indexOf(curIdx);
                const nextIdx =
                  tickedIndices[(pos >= 0 ? pos + 1 : 0) % tickedIndices.length];
                return {
                  ...c,
                  lShape: { ...lShape, currentIndex: nextIdx, currentTime: 0 },
                };
              })
            );
          }}
        />
        </div>
        </div>
      </div>

      {/* 1. Top Broadcast Header */}
      <Header
        channel={channel}
        isLicensed={isLicensed}
        licenseRecord={licenseRecord}
        onOpenLicenseModal={() => setActiveModal('license')}
        onResetSoftware={handleResetSoftware}
        fixedDisplayIndex={fixedDisplayIndex}
        onChangeFixedDisplay={handleChangeFixedDisplay}
        onLaunchDisplayOutput={handleLaunchDisplayOutput}
        onMinimizeSoftware={() => setIsAppMinimized((prev) => !prev)}
        onCloseSoftware={handleCloseSoftware}
        isAppMinimized={isAppMinimized}
      />

      {/* 2. Main Studio Workspace or Minimized Compact Broadcast Bar */}
      {isAppMinimized ? (
        (() => {
          const isDockLive =
            channel.status === 'PLAYING' &&
            (channel.playlist.length > 0 ||
              Boolean(channel.activeProgramId) ||
              Boolean(channel.activeEveryNMinAd) ||
              Boolean(channel.liveInput?.active));
          return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#060a14] via-black to-[#050810] select-none">
          <div className="w-full max-w-2xl rounded-2xl bg-[#090f1d] border border-[#1e2a44] shadow-2xl p-6 font-mono space-y-4">
            <div className="flex items-center justify-between border-b border-[#1c273e] pb-3">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isDockLive ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                  }`}
                />
                <span className="text-xs font-black text-amber-400 tracking-wider uppercase">
                  ASHOKA MSO PLAYLIST — MINIMIZED BROADCAST DOCK
                </span>
              </div>
              <button
                onClick={() => setIsAppMinimized(false)}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-mono text-xs font-black flex items-center gap-1.5 shadow-lg shadow-amber-500/25 transition cursor-pointer"
                title="Restore Full Studio Workspace"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Restore Full Studio</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#060a14] border border-[#1b253b]">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Playout Status</div>
                <div
                  className={`text-xs font-black mt-1 flex items-center gap-1.5 ${
                    isDockLive ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isDockLive ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  <span>
                    {isDockLive
                      ? 'ON AIR (Broadcasting)'
                      : 'STANDBY (Stopped / Ready)'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#060a14] border border-[#1b253b]">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Now Playing</div>
                <div className="text-xs font-bold text-white truncate mt-1">
                  {channel.playlist[channel.currentClipIndex]?.title || 'Auto Playout Stream'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#060a14] border border-[#1b253b]">
                <div className="text-[10px] text-slate-400 uppercase font-bold">Quick Playout</div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => handleTogglePlay(channel.id)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>{channel.status === 'PLAYING' ? 'Pause' : 'Play'}</span>
                  </button>
                  <button
                    onClick={() => handleSkipNext(channel.id)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer"
                  >
                    Next &gt;
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center pt-2 border-t border-[#1c273e]/50">
              <span className="text-[11px] text-slate-400">
                Playout audio, video, graphics, and 2nd display outputs continue broadcasting. Click{' '}
                <button
                  onClick={() => setIsAppMinimized(false)}
                  className="text-amber-400 underline font-bold hover:text-amber-300 cursor-pointer"
                >
                  Restore Full Studio
                </button>{' '}
                to open the full workspace.
              </span>
            </div>
          </div>
        </div>
          );
        })()
      ) : (
        <main className="flex-1 min-h-0 grid grid-cols-12 gap-2.5 px-3 py-2 bg-black overflow-hidden">
          {/* Left Column: 4-Tab Playlist & Live Input Workspace (Only Playlist/Ads Scroll Internally) */}
          <div className="col-span-12 lg:col-span-7 flex flex-col min-h-0 h-full overflow-hidden">
            <LeftPlaylistWorkspace
              channel={channel}
              activeLeftTab={activeLeftTab}
              onChangeLeftTab={setActiveLeftTab}
              onImportVideos={handleImportVideos}
              onTakeClip={handleTakeClip}
              onRemoveClip={handleRemoveClip}
              onRemoveFolder={handleRemoveFolder}
              onToggleClipEnabled={handleToggleClipEnabled}
              onToggleFolderEnabled={handleToggleFolderEnabled}
              onMoveClip={handleMoveClip}
              onSetLoopMode={handleSetLoopMode}
              onToggleShuffle={handleToggleShuffle}
              onSkipNext={handleSkipNext}
              onClearPlaylist={handleClearPlaylist}
              onUpdateScheduledPrograms={handleUpdateScheduledPrograms}
              onStartScheduledProgramNow={handleStartScheduledProgramNow}
              onStopScheduledProgramNow={handleStopScheduledProgramNow}
              everyNMinAds={everyNMinAds}
              everyNMinEnabled={everyNMinEnabled}
              everyNMinInterval={everyNMinInterval}
              everyNMinCountdownSec={everyNMinCountdownSec}
              onUpdateEveryNMinAds={handleUpdateEveryNMinAds}
              onTriggerEveryNMinNow={handleTriggerEveryNMinNow}
              onStopEveryNMinNow={handleStopEveryNMinNow}
              onUpdateLiveInput={handleUpdateLiveInput}
              onStartCameraCapture={handleStartCameraCapture}
              onStopLiveInput={handleStopLiveInput}
              onSaveChannel={handleSaveChannel}
              activeLiveStream={cameraStreamRef.current}
              onOpenModal={setActiveModal}
            />
          </div>

          {/* Right Column: Live Monitor + Transport Bar + 8 Quick Action Buttons */}
          <div className="col-span-12 lg:col-span-5 flex flex-col min-h-0 h-full overflow-hidden">
            <RightMonitorDeck
              channel={channel}
              activeVideoElement={getActiveDeckVideoElement(channel)}
              activeOverlayVideoElement={overlayVideoRef.current}
              activeTopOverlayVideoElement={topOverlayVideoRef.current}
              activeLShapeVideoElement={lShapeVideoRef.current}
              onTogglePlay={handleTogglePlay}
              onStartChannel={handleStartChannel}
              onStopChannel={handleStopChannel}
              onOpenExternalDisplay={() => handleLaunchDisplayOutput()}
              channelOnAirSeconds={channelOnAirSeconds}
              onToggleMute={handleToggleMute}
              onToggleSoftwareAudio={handleToggleSoftwareAudio}
              onToggleDisplay2Audio={handleToggleDisplay2Audio}
              onSetAudioOutputTarget={handleSetAudioOutputTarget}
              onSeekVideo={handleSeekVideo}
              onImportVideos={handleImportVideos}
              onSelectLeftTab={setActiveLeftTab}
              onOpenModal={setActiveModal}
              fullscreenContainerRef={monitorFullscreenRef}
              onToggleMonitorFullscreen={handleToggleMonitorFullscreen}
              isExternalFullscreenActive={isMonitorFullscreen}
              everyNMinEnabled={everyNMinEnabled}
              everyNMinCountdownSec={everyNMinCountdownSec}
              onAdvanceYouTubeQueue={handleAdvanceYouTubeQueue}
              onMonitorBoxElement={handleMonitorBoxElement}
              transparentVideoStage={useStudioHardwareVideoLayer}
              isOccludedByModal={isStudioVideoOccluded}
            />
          </div>
        </main>
      )}

      {/* Clean 2nd / 3rd / 4th Fixed Display Output Fullscreen Broadcast Deck */}
      {isExternalOutputView && (
        <ExternalOutputWindow
          channel={channel}
          activeVideoElement={getActiveDeckVideoElement(channel)}
          activeOverlayVideoElement={overlayVideoRef.current}
          activeTopOverlayVideoElement={topOverlayVideoRef.current}
          activeLShapeVideoElement={lShapeVideoRef.current}
          targetDisplayIndex={fixedDisplayIndex}
          onExitOutputMode={() => {
            setIsExternalOutputView(false);
            try {
              if (new URLSearchParams(window.location.search).get('output') === 'true') {
                window.history.replaceState({}, '', window.location.pathname);
              }
            } catch {}
          }}
        />
      )}

      {/* 3. Unified Professional Broadcast Playout Bottom Console + Footer */}
      <BottomControlCards
        channel={channel}
        onOpenModal={setActiveModal}
        onLaunchDisplayOutput={() => handleLaunchDisplayOutput()}
        onImportVideos={handleImportVideos}
        onSelectLeftTab={setActiveLeftTab}
        everyNMinEnabled={everyNMinEnabled}
        everyNMinCountdownSec={everyNMinCountdownSec}
      />

      {/* 4. Interactive Feature & Studio Modals */}
      <StudioFeatureModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        channel={channel}
        onUpdateGraphics={handleUpdateGraphics}
        onUpdateBottomOverlay={handleUpdateBottomOverlay}
        onUpdateTopOverlay={handleUpdateTopOverlay}
        onUpdateLShape={handleUpdateLShape}
        onUpdateTransmission={handleUpdateTransmission}
        isLicensed={isLicensed}
        licenseRecord={licenseRecord}
        onActivateLicense={(active, updatedRecord) => {
          if (updatedRecord && verifyLicenseSignature(updatedRecord)) {
            setLicenseRecord(updatedRecord);
            const liveEval = evaluateLicenseStatus(updatedRecord);
            setIsLicensed(liveEval.isValidAndActive);
          } else if (licenseRecord) {
            const liveEval = evaluateLicenseStatus(licenseRecord);
            setIsLicensed(liveEval.isValidAndActive);
          } else {
            setIsLicensed(active);
          }
        }}
        liveCameraActive={liveCameraActive}
        onToggleLiveCamera={handleToggleLiveCamera}
        everyNMinEnabled={everyNMinEnabled}
        everyNMinInterval={everyNMinInterval}
        onChangeEveryNMin={(enabled, interval) => {
          handleUpdateEveryNMinAds(
            (prevAds) => prevAds,
            enabled,
            interval as EveryNMinIntervalOption
          );
        }}
        activeVideoElement={getActiveDeckVideoElement(channel)}
        activeOverlayVideoElement={overlayVideoRef.current}
        activeTopOverlayVideoElement={topOverlayVideoRef.current}
        activeLShapeVideoElement={lShapeVideoRef.current}
        onTogglePlay={handleTogglePlay}
        onSkipNext={handleSkipNext}
        onImportVideos={handleImportVideos}
        onUpdateLiveInput={handleUpdateLiveInput}
        onStartCameraCapture={handleStartCameraCapture}
        onStopLiveInput={handleStopLiveInput}
        onSaveChannel={handleSaveChannel}
        activeLiveStream={cameraStreamRef.current}
      />
    </div>
  );
}
