import React, { useEffect, useMemo, useRef } from 'react';
import { TVChannel } from '../types/playout';
import {
  buildYouTubeEmbedUrl,
  computeYouTubeViewportBoxPct,
  getActiveYouTubeQueueItem,
  isYouTubeLiveStageActive,
  shouldAutoSkipOnYouTubeError,
  shouldKeepYouTubeLayerMounted,
} from '../utils/youtubeLive';

interface YouTubeBroadcastLayerProps {
  channel: TVChannel;
  muted: boolean;
  volume?: number;
  paused?: boolean;
  visible?: boolean;
  isAuthoritative?: boolean;
  fitMode?: 'fill' | 'contain';
  audioUnlockTick?: number;
  onEnded?: (videoId: string, cycle: number) => void;
}

export const YouTubeBroadcastLayer: React.FC<YouTubeBroadcastLayerProps> = ({
  channel,
  muted,
  volume = 100,
  paused = false,
  visible,
  isAuthoritative = false,
  fitMode = 'contain',
  audioUnlockTick = 0,
  onEnded,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeLoadedRef = useRef<boolean>(false);
  const hasStartedPlayingRef = useRef<boolean>(false);
  const autoplayFallbackTimerRef = useRef<number | null>(null);
  const endedTriggeredKeyRef = useRef<string>('');
  const consecutiveErrorCountRef = useRef<number>(0);
  const advancingFromErrorRef = useRef<boolean>(false);

  const isStageActive = isYouTubeLiveStageActive(channel);
  const keepMounted = shouldKeepYouTubeLayerMounted(channel);
  const isLayerVisible = visible !== undefined ? visible : isStageActive;
  const effectivePaused = paused || !isLayerVisible;
  const effectiveMuted = muted || !isLayerVisible;

  const lastPropsRef = useRef({
    muted: effectiveMuted,
    volume,
    paused: effectivePaused,
    visible: isLayerVisible,
    isAuthoritative,
    onEnded,
    videoId: '',
    cycle: 0,
    enabledCount: 0,
  });

  const ytQueue = Array.isArray(channel.liveInput?.youtubeQueue)
    ? channel.liveInput!.youtubeQueue!
    : [];
  const enabledCount = ytQueue.filter((q) => q && q.enabled !== false && Boolean(q.videoId)).length;
  const queueSignature = ytQueue
    .map((q) => `${q.id}:${q.videoId || ''}:${q.enabled !== false ? 1 : 0}`)
    .join('|');
  const { item: activeItem } = getActiveYouTubeQueueItem(
    ytQueue,
    channel.liveInput?.youtubeQueueIndex || 0
  );
  const videoId = activeItem?.videoId || '';
  const youtubeCycle = channel.liveInput?.youtubeCycle || 0;

  lastPropsRef.current = {
    muted: effectiveMuted,
    volume,
    paused: effectivePaused,
    visible: isLayerVisible,
    isAuthoritative,
    onEnded,
    videoId,
    cycle: youtubeCycle,
    enabledCount,
  };

  useEffect(() => {
    consecutiveErrorCountRef.current = 0;
    advancingFromErrorRef.current = false;
  }, [keepMounted, queueSignature]);

  useEffect(() => {
    iframeLoadedRef.current = false;
    hasStartedPlayingRef.current = false;
    if (autoplayFallbackTimerRef.current !== null) {
      window.clearTimeout(autoplayFallbackTimerRef.current);
      autoplayFallbackTimerRef.current = null;
    }
    if (advancingFromErrorRef.current) {
      advancingFromErrorRef.current = false;
    } else {
      consecutiveErrorCountRef.current = 0;
    }
  }, [videoId, youtubeCycle]);

  const box = useMemo(() => computeYouTubeViewportBoxPct(channel), [
    channel.lShape?.enabled,
    channel.lShape?.side,
    channel.lShape?.sideWidth,
    channel.lShape?.bottomHeight,
    channel.lShape?.renderMode,
    channel.lShape?.squeezeProgramVideo,
    channel.lShape?.periodicActive,
    channel.lShape?.currentIndex,
    channel.topOverlay?.enabled,
    channel.topOverlay?.squeezeProgramVideo,
    channel.topOverlay?.height,
    channel.bottomOverlay?.enabled,
    channel.bottomOverlay?.squeezeProgramVideo,
    channel.bottomOverlay?.height,
    channel.liveInput?.showOverlaysOnLive,
    channel.liveInput?.liveOverlayMode,
  ]);

  const origin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';

  // Keep embed URL stable for active clip (volume/mute/pause/resume flow via postMessage without reloading iframe)
  const embedUrl = useMemo(() => {
    if (!videoId) return '';
    return buildYouTubeEmbedUrl({
      videoId,
      muted: effectiveMuted,
      origin,
    });
  }, [videoId, youtubeCycle, origin]);

  const sendCommand = (func: string, args: any[] = []) => {
    if (!iframeLoadedRef.current) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({
          event: 'command',
          func,
          args,
        }),
        'https://www.youtube.com'
      );
    } catch {}
  };

  const disableCaptions = () => {
    sendCommand('unloadModule', ['captions']);
    sendCommand('unloadModule', ['cc']);
    sendCommand('setOption', ['captions', 'track', {}]);
    sendCommand('setOption', ['cc', 'track', {}]);
  };

  const syncAudioAndTransport = () => {
    if (!iframeLoadedRef.current) return;
    const { muted: curMuted, volume: curVol, paused: curPaused } = lastPropsRef.current;
    const clampedVol = Math.max(0, Math.min(100, Math.round(curVol ?? 100)));
    if (curMuted) {
      sendCommand('mute');
    } else {
      sendCommand('unMute');
      sendCommand('setVolume', [clampedVol]);
    }
    disableCaptions();
    if (curPaused) {
      sendCommand('pauseVideo');
    } else {
      sendCommand('playVideo');
    }
  };

  useEffect(() => {
    if (!keepMounted || !videoId) return;
    syncAudioAndTransport();
  }, [keepMounted, isLayerVisible, videoId, youtubeCycle, effectiveMuted, volume, effectivePaused, audioUnlockTick]);

  // Autoplay unlock fallback if browser blocks unmuted autoplay on initial visible mount
  useEffect(() => {
    if (!keepMounted || !isLayerVisible || !videoId || effectivePaused || effectiveMuted) return;
    const timer = window.setTimeout(() => {
      if (!hasStartedPlayingRef.current && !lastPropsRef.current.paused && lastPropsRef.current.visible) {
        sendCommand('mute');
        sendCommand('playVideo');
      }
    }, 1050);
    autoplayFallbackTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autoplayFallbackTimerRef.current === timer) {
        autoplayFallbackTimerRef.current = null;
      }
    };
  }, [keepMounted, isLayerVisible, videoId, youtubeCycle, effectivePaused, effectiveMuted]);

  useEffect(() => {
    if (!keepMounted || !videoId) return;
    const onMessage = (event: MessageEvent) => {
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeWin || event.source !== iframeWin) return;
      if (typeof event.data !== 'string') return;
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload?.event === 'onReady') {
        iframeLoadedRef.current = true;
        disableCaptions();
        syncAudioAndTransport();
        return;
      }

      if (payload?.event === 'onApiChange') {
        disableCaptions();
        return;
      }

      if (payload?.event === 'onError') {
        const props = lastPropsRef.current;
        if (props.visible && props.isAuthoritative && props.onEnded && props.videoId) {
          const triggerKey = `err:${props.videoId}:${props.cycle}`;
          if (endedTriggeredKeyRef.current !== triggerKey) {
            endedTriggeredKeyRef.current = triggerKey;
            consecutiveErrorCountRef.current += 1;
            if (shouldAutoSkipOnYouTubeError(consecutiveErrorCountRef.current, props.enabledCount)) {
              advancingFromErrorRef.current = true;
              props.onEnded(props.videoId, props.cycle);
            }
          }
        }
        return;
      }

      const playerState =
        payload?.event === 'onStateChange'
          ? payload?.info
          : payload?.event === 'infoDelivery' && typeof payload?.info?.playerState === 'number'
          ? payload.info.playerState
          : null;

      if (playerState === 1) {
        hasStartedPlayingRef.current = true;
        consecutiveErrorCountRef.current = 0;
        advancingFromErrorRef.current = false;
        disableCaptions();
        const { muted: curMuted, volume: curVol, paused: curPaused } = lastPropsRef.current;
        if (curPaused) {
          sendCommand('mute');
          sendCommand('pauseVideo');
          return;
        }
        if (curMuted) {
          sendCommand('mute');
        } else {
          sendCommand('unMute');
          sendCommand('setVolume', [Math.max(0, Math.min(100, Math.round(curVol ?? 100)))]);
        }
      } else if (playerState === 0) {
        const props = lastPropsRef.current;
        if (props.visible && props.isAuthoritative && props.onEnded && props.videoId) {
          const triggerKey = `${props.videoId}:${props.cycle}`;
          if (endedTriggeredKeyRef.current !== triggerKey) {
            endedTriggeredKeyRef.current = triggerKey;
            props.onEnded(props.videoId, props.cycle);
          }
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [keepMounted, videoId, youtubeCycle]);

  const registerListenerHandshake = () => {
    iframeLoadedRef.current = true;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        'https://www.youtube.com'
      );
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }),
        'https://www.youtube.com'
      );
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onReady'] }),
        'https://www.youtube.com'
      );
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onApiChange'] }),
        'https://www.youtube.com'
      );
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onError'] }),
        'https://www.youtube.com'
      );
    } catch {}
    syncAudioAndTransport();
  };

  if (!keepMounted || !embedUrl) return null;

  return (
    <div
      data-testid="youtube-broadcast-layer"
      data-youtube-video-id={videoId}
      data-youtube-state={isLayerVisible ? (effectivePaused ? 'paused' : 'playing') : 'background-paused'}
      aria-hidden={!isLayerVisible}
      style={{
        opacity: isLayerVisible ? 1 : 0,
        visibility: isLayerVisible ? 'visible' : 'hidden',
        pointerEvents: 'none',
      }}
      className="absolute inset-0 bg-black overflow-hidden pointer-events-none z-0"
    >
      <div
        style={{
          position: 'absolute',
          left: `${box.leftPct}%`,
          top: `${box.topPct}%`,
          width: `${box.widthPct}%`,
          height: `${box.heightPct}%`,
          overflow: 'hidden',
          ...(fitMode === 'fill' ? { containerType: 'size' as const } : {}),
        }}
      >
        <iframe
          ref={iframeRef}
          key={`${videoId}:${youtubeCycle}`}
          src={embedUrl}
          title={activeItem?.title || `YouTube Live ${videoId}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            registerListenerHandshake();
            setTimeout(registerListenerHandshake, 350);
            setTimeout(registerListenerHandshake, 1000);
          }}
          style={
            fitMode === 'fill'
              ? {
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 'max(100cqw, calc(100cqh * 16 / 9))',
                  height: 'max(100cqh, calc(100cqw * 9 / 16))',
                }
              : undefined
          }
          className={
            fitMode === 'fill'
              ? 'border-0 block pointer-events-none'
              : 'w-full h-full border-0 block pointer-events-none'
          }
        />
      </div>
    </div>
  );
};
