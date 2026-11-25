import React, { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Power,
  Volume2,
  VolumeX,
  Clock as ClockIcon,
  Monitor,
  Maximize2,
  Tv,
  SkipForward,
  Layers,
} from 'lucide-react';
import { TVChannel } from '../types/playout';
import { videoGenerator } from '../services/videoGenerator';
import { LeftWorkspaceTab } from './LeftPlaylistWorkspace';
import { ActiveModalType } from './StudioFeatureModals';
import { YouTubeBroadcastLayer } from './YouTubeBroadcastLayer';
import {
  advanceYouTubeQueueIndex,
  getActiveYouTubeQueueItem,
  isYouTubeLiveStageActive,
  shouldKeepYouTubeLayerMounted,
} from '../utils/youtubeLive';

interface RightMonitorDeckProps {
  channel: TVChannel;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  onTogglePlay: (id: number) => void;
  onStartChannel?: (id: number) => void;
  onStopChannel?: (id: number) => void;
  onOpenExternalDisplay?: (id: number) => void;
  channelOnAirSeconds?: number;
  onToggleMute: (id: number) => void;
  onSetAudioOutputTarget?: (id: number, target: 'both' | 'software' | 'display2') => void;
  onToggleSoftwareAudio?: (id: number) => void;
  onToggleDisplay2Audio?: (id: number) => void;
  onSeekVideo: (seconds: number) => void;
  onImportVideos?: (id: number, files: FileList | File[], folderName?: string) => void;
  onSelectLeftTab?: (tab: LeftWorkspaceTab) => void;
  onOpenModal?: (modal: ActiveModalType) => void;
  fullscreenContainerRef?: React.RefObject<HTMLDivElement | null>;
  onToggleMonitorFullscreen?: () => void;
  isExternalFullscreenActive?: boolean;
  everyNMinEnabled?: boolean;
  everyNMinCountdownSec?: number;
  onAdvanceYouTubeQueue?: (expectedVideoId?: string, expectedCycle?: number) => void;
  onMonitorBoxElement?: (el: HTMLDivElement | null) => void;
  transparentVideoStage?: boolean;
  isOccludedByModal?: boolean;
}

function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatHoursVerbose(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

export const RightMonitorDeck: React.FC<RightMonitorDeckProps> = ({
  channel,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  onTogglePlay,
  onStartChannel,
  onStopChannel,
  onOpenExternalDisplay,
  channelOnAirSeconds = 0,
  onToggleMute,
  onSetAudioOutputTarget,
  onToggleSoftwareAudio,
  onToggleDisplay2Audio,
  onSeekVideo,
  fullscreenContainerRef,
  onToggleMonitorFullscreen,
  isExternalFullscreenActive = false,
  everyNMinEnabled = false,
  everyNMinCountdownSec = 0,
  onAdvanceYouTubeQueue,
  onMonitorBoxElement,
  transparentVideoStage = false,
  isOccludedByModal = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const localMonitorBoxRef = useRef<HTMLDivElement | null>(null);

  const latestFrameArgsRef = useRef({
    channel,
    activeVideoElement,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
    transparentVideoStage,
  });

  latestFrameArgsRef.current = {
    channel,
    activeVideoElement,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
    transparentVideoStage,
  };

  useEffect(() => {
    if (isExternalFullscreenActive || isOccludedByModal) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;
    let rafId = 0;

    const renderLoop = (timestamp: number) => {
      if (!running) return;
      const args = latestFrameArgsRef.current;
      videoGenerator.renderChannelFrame(
        canvas,
        args.channel,
        timestamp,
        args.activeVideoElement,
        args.activeOverlayVideoElement,
        args.activeTopOverlayVideoElement,
        args.activeLShapeVideoElement,
        {
          transparentVideoStage: Boolean(args.transparentVideoStage),
        }
      );
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, [isExternalFullscreenActive, isOccludedByModal]);

  const activeAd = channel.activeEveryNMinAd;
  const activeProg = channel.activeProgramId
    ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
    : undefined;
  const activeClip = activeAd
    ? activeAd
    : activeProg
    ? activeProg.playlist[channel.activeProgramClipIndex || 0]
    : channel.playlist[channel.currentClipIndex];

  const currentSec = activeAd
    ? channel.everyNMinTime || 0
    : activeProg
    ? channel.activeProgramTime || 0
    : channel.currentTime || 0;
  const totalSec = activeClip?.duration || 0;
  const isLiveInputActive = !!channel.liveInput?.active && !activeAd && !activeProg;
  const isChannelRunning = channel.status === 'PLAYING';
  const isPlaying =
    isChannelRunning &&
    (channel.playlist.length > 0 || !!activeProg || !!activeAd || !!channel.liveInput?.active);
  const isMuted = channel.transmission.audio.muted;
  const audioTarget = channel.transmission.audio.audioOutputTarget || 'display2';
  const isSoftwareAudioOn =
    !isMuted &&
    (typeof channel.transmission.audio.softwareAudioEnabled === 'boolean'
      ? channel.transmission.audio.softwareAudioEnabled
      : audioTarget === 'software' || audioTarget === 'both');
  const isDisplay2AudioOn =
    !isMuted &&
    (typeof channel.transmission.audio.display2AudioEnabled === 'boolean'
      ? channel.transmission.audio.display2AudioEnabled
      : audioTarget !== 'software');

  const isYouTubeStageNow = !isExternalFullscreenActive && isYouTubeLiveStageActive(channel);
  const activeYouTubeRes = getActiveYouTubeQueueItem(
    channel.liveInput?.youtubeQueue,
    channel.liveInput?.youtubeQueueIndex || 0
  );

  // Next Up clip resolution
  let nextCueTitle = 'Playlist Queue Empty';
  if (isLiveInputActive && channel.liveInput?.sourceType === 'youtube') {
    const ytQueue = channel.liveInput.youtubeQueue || [];
    const nextYt = advanceYouTubeQueueIndex(
      ytQueue,
      activeYouTubeRes.index >= 0 ? activeYouTubeRes.index : 0,
      channel.liveInput.youtubeLoop !== false
    );
    const nextYtItem = !nextYt.shouldStop ? ytQueue[nextYt.nextIndex] : undefined;
    nextCueTitle = nextYtItem
      ? `YT: ${nextYtItem.title || nextYtItem.videoId}`
      : 'YouTube Queue End';
  } else if (activeProg && activeProg.playlist.length > 0) {
    const nextPIdx = ((channel.activeProgramClipIndex || 0) + 1) % activeProg.playlist.length;
    nextCueTitle = `PROG: ${activeProg.playlist[nextPIdx]?.title || activeProg.name}`;
  } else if (channel.playlist.length > 0) {
    const enabledItems = channel.playlist.filter((c) => c.enabled !== false);
    if (enabledItems.length > 0) {
      const curPos = enabledItems.findIndex((c) => c.id === activeClip?.id);
      const nextItem = enabledItems[(curPos >= 0 ? curPos + 1 : 0) % enabledItems.length];
      nextCueTitle = nextItem?.title || 'Looping Playlist';
    }
  }

  // Calculate Total Hours Channel Needs to Play & Remaining Hours in Current Cycle
  const totalPlaylistSec = channel.playlist.reduce(
    (sum, item) => sum + Math.max(0, Number(item.duration) || 0),
    0
  );
  const playedBeforeCurrentClipSec = channel.playlist
    .slice(0, Math.max(0, channel.currentClipIndex || 0))
    .reduce((sum, item) => sum + Math.max(0, Number(item.duration) || 0), 0);
  const currentMainClipElapsedSec = Math.min(
    channel.currentTime || 0,
    channel.playlist[channel.currentClipIndex]?.duration || 0
  );
  const remainingPlaylistSec = Math.max(
    0,
    totalPlaylistSec - (playedBeforeCurrentClipSec + currentMainClipElapsedSec)
  );

  const activeProgTotalSec = activeProg
    ? activeProg.playlist.reduce((s, c) => s + Math.max(0, Number(c.duration) || 0), 0)
    : 0;
  const activeProgPlayedBeforeSec = activeProg
    ? activeProg.playlist
        .slice(0, Math.max(0, channel.activeProgramClipIndex || 0))
        .reduce((s, c) => s + Math.max(0, Number(c.duration) || 0), 0)
    : 0;
  const activeProgRemainingSec = activeProg
    ? Math.max(0, activeProgTotalSec - (activeProgPlayedBeforeSec + (channel.activeProgramTime || 0)))
    : 0;

  const displayNeedToPlaySec = activeProg
    ? activeProgRemainingSec
    : remainingPlaylistSec > 0
    ? remainingPlaylistSec
    : totalPlaylistSec;

  const displayTotalHoursSec = activeProg ? activeProgTotalSec : totalPlaylistSec;

  // Active CG layers telemetry
  const g = channel.graphics as any;
  const hasTopScroll = !!channel.topOverlay?.enabled || (g.topTickerItems || []).length > 0;
  const hasBotScroll = !!channel.bottomOverlay?.enabled || (g.tickerItems || []).length > 0;
  const hasLShape = !!channel.lShape?.enabled;
  const activeLogos = [
    g.channelLogo,
    g.sponsorLogo1 || g.sponsor1Logo,
    g.sponsorLogo2 || g.sponsor2Logo,
    g.sponsorLogo3,
    g.sponsorLogo4,
  ].filter((l) => l && l.enabled).length;
  const clockOn = channel.graphics.clockEnabled !== false;
  const backInOn = !!g.backInTimer?.enabled;

  const handleTriggerFullscreen = () => {
    if (onToggleMonitorFullscreen) {
      onToggleMonitorFullscreen();
      return;
    }
    const target = fullscreenContainerRef?.current || localMonitorBoxRef.current;
    if (!document.fullscreenElement && target) {
      target.requestFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleStartChannelNow = () => {
    if (onStartChannel) {
      onStartChannel(channel.id);
    } else if (channel.status !== 'PLAYING') {
      onTogglePlay(channel.id);
    }
  };

  const handleStopChannelNow = () => {
    if (onStopChannel) {
      onStopChannel(channel.id);
    } else if (channel.status === 'PLAYING') {
      onTogglePlay(channel.id);
    }
  };

  const progressPct = totalSec > 0 ? Math.min(100, Math.max(0, (currentSec / totalSec) * 100)) : 0;

  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5 overflow-hidden">
      {/* Unified Pro Broadcast Program Monitor & Master Control Chassis */}
      <div className="bg-[#070b12] border border-[#1b2436] rounded-lg p-2 flex-1 min-h-0 flex flex-col justify-between gap-2 overflow-hidden shadow-xl">
        {/* Compact Program Monitor Section (Snug 16:9 HD Bezel — Zero Dead Black Space) */}
        <div className="flex flex-col gap-1 min-h-0 shrink-0">
          {/* Micro Broadcast Tally Header */}
          <div className="flex items-center justify-between px-1.5 py-0.5 bg-[#0b101b] border border-[#1d273b] rounded text-[10px] font-mono">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isChannelRunning ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'
                }`}
              />
              <span className="font-bold text-slate-200 tracking-wider uppercase flex items-center gap-1">
                <Tv className="w-3 h-3 text-amber-400" />
                PGM OUT
              </span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400 truncate">1920×1080 50p HD</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                  isChannelRunning
                    ? 'bg-rose-950/80 border-rose-500/60 text-rose-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {isChannelRunning ? 'ON AIR' : 'STANDBY'}
              </span>
              <button
                type="button"
                onClick={handleTriggerFullscreen}
                className="px-1.5 py-0.2 rounded bg-[#111928] hover:bg-[#1a263c] border border-[#2b3954] text-slate-300 hover:text-white text-[9px] font-bold flex items-center gap-1 cursor-pointer transition"
                title="Fullscreen 16:9 Broadcast Preview (Double-click monitor)"
              >
                <Maximize2 className="w-2.5 h-2.5" />
                <span>FULL</span>
              </button>
            </div>
          </div>

          {/* Exact 16:9 Fixed-HD Broadcast Canvas Container (never overwrites App fullscreenContainerRef) */}
          <div
            ref={(el) => {
              localMonitorBoxRef.current = el;
              if (onMonitorBoxElement) onMonitorBoxElement(el);
            }}
            onDoubleClick={handleTriggerFullscreen}
            className="relative w-full aspect-video max-h-[45vh] mx-auto bg-black rounded overflow-hidden border border-[#24314a] cursor-pointer flex items-center justify-center shadow-2xl"
            title="Double-click for Fullscreen 16:9 HD Broadcast Output"
          >
            {shouldKeepYouTubeLayerMounted(channel) && (
              <YouTubeBroadcastLayer
                channel={channel}
                visible={isYouTubeStageNow}
                muted={!isSoftwareAudioOn || Boolean(channel.liveInput?.muted) || !isYouTubeStageNow}
                volume={channel.liveInput?.volume ?? 100}
                paused={channel.status !== 'PLAYING' || !isYouTubeStageNow}
                isAuthoritative={true}
                onEnded={onAdvanceYouTubeQueue}
              />
            )}
            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              className="relative z-20 w-full h-full object-contain block pointer-events-none bg-transparent"
            />
          </div>
        </div>

        {/* 1. Broadcast Transport & Audio Settings Bar */}
        <div className="bg-[#0a0f18] border border-[#202a3d] rounded-md px-2.5 py-1.5 flex items-center gap-2 shrink-0">
          <button
            onClick={() => onTogglePlay(channel.id)}
            className="w-7 h-7 rounded bg-[#101726] hover:bg-[#1a253b] border border-[#2d3b55] flex items-center justify-center text-white transition shrink-0 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => {
              if (onToggleSoftwareAudio) {
                onToggleSoftwareAudio(channel.id);
              } else if (onSetAudioOutputTarget) {
                const nextSoft = !isSoftwareAudioOn;
                const nextTarget =
                  nextSoft && isDisplay2AudioOn
                    ? 'both'
                    : nextSoft
                    ? 'software'
                    : 'display2';
                onSetAudioOutputTarget(channel.id, nextTarget);
              } else {
                onToggleMute(channel.id);
              }
            }}
            className={`px-1.5 h-7 rounded border text-[9px] font-mono font-black uppercase tracking-tight transition shrink-0 cursor-pointer flex items-center gap-1 ${
              isSoftwareAudioOn
                ? 'bg-emerald-950/80 hover:bg-emerald-900/80 border-emerald-500/70 text-emerald-300'
                : 'bg-[#130d16] hover:bg-[#1e1322] border-rose-500/50 text-rose-300'
            }`}
            title="PGM Player Audio ON/OFF (Default OFF so sound plays cleanly only on 2nd Display)"
          >
            {isSoftwareAudioOn ? (
              <Volume2 className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <VolumeX className="w-3 h-3 text-rose-400 shrink-0" />
            )}
            <span>{isSoftwareAudioOn ? 'PGM AUD: ON' : 'PGM AUD: OFF'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onToggleDisplay2Audio) {
                onToggleDisplay2Audio(channel.id);
              } else if (onSetAudioOutputTarget) {
                const nextD2 = !isDisplay2AudioOn;
                const nextTarget =
                  isSoftwareAudioOn && nextD2
                    ? 'both'
                    : isSoftwareAudioOn
                    ? 'software'
                    : 'display2';
                onSetAudioOutputTarget(channel.id, nextTarget);
              } else {
                onToggleMute(channel.id);
              }
            }}
            className={`px-1.5 h-7 rounded border text-[9px] font-mono font-black uppercase tracking-tight transition shrink-0 cursor-pointer flex items-center gap-1 ${
              isDisplay2AudioOn
                ? 'bg-sky-950/80 hover:bg-sky-900/80 border-sky-500/70 text-sky-300'
                : 'bg-[#130d16] hover:bg-[#1e1322] border-rose-500/50 text-rose-300'
            }`}
            title="2nd Display Audio ON/OFF (Default ON so 2nd Display plays audio + video)"
          >
            {isDisplay2AudioOn ? (
              <Volume2 className="w-3 h-3 text-sky-400 shrink-0" />
            ) : (
              <VolumeX className="w-3 h-3 text-rose-400 shrink-0" />
            )}
            <span>{isDisplay2AudioOn ? '2ND AUD: ON' : '2ND AUD: OFF'}</span>
          </button>

          <span className="px-2 py-0.5 rounded bg-[#05080f] border border-[#2c384f] text-amber-300 text-[10px] font-bold font-mono tracking-wide shrink-0">
            {!isChannelRunning
              ? 'OFF'
              : activeAd
              ? 'AD'
              : activeProg
              ? 'PROG'
              : isLiveInputActive
              ? 'LIVE'
              : 'MAIN'}
          </span>

          <span className="text-[11px] font-mono text-slate-100 tabular-nums whitespace-nowrap shrink-0">
            {formatTimecode(currentSec)} / {formatTimecode(totalSec)}
          </span>

          <input
            type="range"
            min={0}
            max={Math.max(1, totalSec)}
            value={Math.min(currentSec, Math.max(1, totalSec))}
            onChange={(e) => onSeekVideo(Number(e.target.value))}
            className="flex-1 h-1 bg-[#1e293d] rounded-lg cursor-pointer accent-amber-400 min-w-[60px]"
          />

          <div className="flex flex-col gap-1 w-9 shrink-0" title="Master Audio VU">
            <div className="h-1 w-full bg-[#161f30] rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all ${
                  isChannelRunning && !isMuted ? 'w-4/5 bg-emerald-400' : 'w-0'
                }`}
              />
            </div>
            <div className="h-1 w-4/5 bg-[#161f30] rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all ${
                  isChannelRunning && !isMuted ? 'w-3/4 bg-amber-400' : 'w-0'
                }`}
              />
            </div>
          </div>

          <div className="bg-[#05080f] border border-[#28344b] rounded px-2 py-0.5 flex items-center gap-1.5 shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isChannelRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-[11px] font-mono font-bold text-white tabular-nums leading-none">
              {formatTimecode(currentSec)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleTriggerFullscreen}
            className="w-7 h-7 rounded bg-[#101726] hover:bg-[#1a253b] border border-[#2d3b55] flex items-center justify-center text-slate-200 hover:text-white transition shrink-0 cursor-pointer"
            title="Fullscreen Broadcast Output (Double-click monitor or ESC to exit)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 2. Master Playout Control Deck: START CHANNEL, STOP OF CHANNEL, 2ND SCREEN SYNC & Telemetry */}
        <div className="bg-[#090e18] border border-[#1d273a] rounded-md p-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleStartChannelNow}
              className={`px-2.5 py-1.5 rounded text-[11px] font-black font-mono uppercase tracking-wider flex items-center gap-1.5 border transition cursor-pointer ${
                isChannelRunning
                  ? 'bg-[#064e3b] hover:bg-[#047857] border-emerald-400 text-white shadow'
                  : 'bg-[#0b291d] hover:bg-[#064e3b] text-emerald-300 border-emerald-500/70'
              }`}
              title="Immediately Start Channel On-Air Playout"
            >
              {isChannelRunning ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              ) : (
                <Play className="w-3 h-3 text-emerald-400 fill-current shrink-0" />
              )}
              <span>START CHANNEL</span>
            </button>

            <button
              type="button"
              onClick={handleStopChannelNow}
              className={`px-2.5 py-1.5 rounded text-[11px] font-black font-mono uppercase tracking-wider flex items-center gap-1.5 border transition cursor-pointer ${
                isChannelRunning
                  ? 'bg-[#7f1d1d] hover:bg-[#991b1b] border-rose-500 text-white shadow'
                  : 'bg-[#170e13] hover:bg-[#24131b] text-slate-300 border-rose-900/60'
              }`}
              title="Immediately Stop & Turn Off Channel Output"
            >
              <Power className="w-3 h-3 text-rose-400 shrink-0" />
              <span>STOP OF CHANNEL</span>
            </button>

            {onOpenExternalDisplay && (
              <button
                type="button"
                onClick={() => onOpenExternalDisplay(channel.id)}
                className="px-2.5 py-1.5 rounded text-[11px] font-black font-mono uppercase tracking-wider bg-[#0c1a30] hover:bg-[#132746] text-sky-200 border border-sky-500/70 flex items-center gap-1.5 transition cursor-pointer"
                title="Synchronize & Launch Clean 2nd Monitor Fullscreen Playout Output"
              >
                <Monitor className="w-3 h-3 text-sky-300 shrink-0" />
                <span>2ND SCREEN SYNC</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <div
              className="px-2 py-1 rounded bg-[#060a13] border border-[#1e2a44] flex items-center gap-1.5"
              title="Total duration queued and ready to play on this channel"
            >
              <ClockIcon className="w-3 h-3 text-amber-400 shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-[8px] font-mono uppercase tracking-wider text-amber-300 font-bold">
                  READY TO PLAY
                </span>
                <span className="text-[11px] font-mono font-bold text-amber-100 tabular-nums">
                  {formatHoursVerbose(displayNeedToPlaySec)}{' '}
                  <span className="text-[9px] text-slate-400 font-normal">
                    / {formatHoursVerbose(displayTotalHoursSec)}
                  </span>
                </span>
              </div>
            </div>

            <div
              className="px-2 py-1 rounded bg-[#0b0915] border border-[#261f38] flex items-center gap-1.5"
              title="Continuous on-air broadcast duration played"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isChannelRunning ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'
                }`}
              />
              <div className="flex flex-col leading-tight">
                <span className="text-[8px] font-mono uppercase tracking-wider text-rose-300 font-bold">
                  ON AIR PLAYED
                </span>
                <span className="text-[11px] font-mono font-bold text-emerald-300 tabular-nums">
                  {formatHoursVerbose(channelOnAirSeconds)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Compact Now On-Air, Next Cue & Active CG Status Strip (Eliminates Dead Space cleanly) */}
        <div className="bg-[#090d16] border border-[#1a2335] rounded-md px-2.5 py-2 flex flex-col justify-between gap-1.5 flex-1 min-h-[76px] overflow-hidden">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[9px] font-mono font-bold uppercase shrink-0">
                NOW
              </span>
              <span className="text-xs font-semibold text-white truncate">
                {isLiveInputActive
                  ? channel.liveInput?.sourceType === 'camera'
                    ? 'LIVE: USB Capture / Camera Input'
                    : channel.liveInput?.sourceType === 'youtube'
                    ? `LIVE YOUTUBE: ${activeYouTubeRes.item?.title || activeYouTubeRes.item?.videoId || 'YouTube Stream'}`
                    : channel.liveInput?.streamUrl || 'LIVE: M3U8 / Stream Input'
                  : activeClip?.title || 'No Active Video — Add Video or Folder below'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-slate-400">
              {everyNMinEnabled && (
                <span className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 font-bold tabular-nums">
                  AD IN {formatTimecode(everyNMinCountdownSec)}
                </span>
              )}
              <span className="tabular-nums text-slate-300 font-bold">
                {Math.round(progressPct)}%
              </span>
            </div>
          </div>

          <div className="w-full h-1 bg-[#141c2c] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] font-mono min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 text-slate-400 truncate">
              <SkipForward className="w-3 h-3 text-sky-400 shrink-0" />
              <span className="text-slate-500 uppercase font-bold shrink-0">NEXT:</span>
              <span className="text-slate-200 truncate">{nextCueTitle}</span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Layers className="w-3 h-3 text-slate-500 mr-0.5" />
              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                  hasTopScroll || hasBotScroll
                    ? 'bg-sky-950/70 border-sky-500/50 text-sky-300'
                    : 'bg-[#0d121d] border-[#1f293d] text-slate-500'
                }`}
              >
                SCR
              </span>
              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                  hasLShape
                    ? 'bg-amber-950/70 border-amber-500/50 text-amber-300'
                    : 'bg-[#0d121d] border-[#1f293d] text-slate-500'
                }`}
              >
                L-SHP
              </span>
              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                  activeLogos > 0
                    ? 'bg-purple-950/70 border-purple-500/50 text-purple-300'
                    : 'bg-[#0d121d] border-[#1f293d] text-slate-500'
                }`}
              >
                LOGO {activeLogos}/5
              </span>
              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                  clockOn
                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#0d121d] border-[#1f293d] text-slate-500'
                }`}
              >
                CLK
              </span>
              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold ${
                  backInOn
                    ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                    : 'bg-[#0d121d] border-[#1f293d] text-slate-500'
                }`}
              >
                BK-IN
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
