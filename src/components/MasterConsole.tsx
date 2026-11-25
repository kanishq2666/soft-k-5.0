import React, { useEffect, useRef, useState } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  SkipForward, 
  SkipBack, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Eye, 
  EyeOff, 
  RotateCw, 
  Radio, 
  Tv, 
  ArrowRightCircle, 
  Sliders, 
  Sparkles,
  RefreshCw,
  Plus,
  FileVideo,
  Upload,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon
} from 'lucide-react';
import { 
  TVChannel, 
  AspectRatioMode, 
  BottomScrollConfig, 
  LogoCornerPosition, 
  LogoDisplayMode, 
  LogoItemConfig,
  OverlayBannerConfig,
  OverlayPlaylistItem,
  LShapeConfig,
  TransmissionConfig,
  OutputResolution
} from '../types/playout';
import { videoGenerator } from '../services/videoGenerator';
import { broadcastAudio } from '../services/audioEngine';
import { createChannelLogoSvg, createSponsor1LogoSvg, createSponsor2LogoSvg } from '../utils/defaultLogos';
import { buildDefaultBottomOverlay, buildDefaultTopOverlay } from '../utils/defaultOverlays';

interface MasterConsoleProps {
  channel: TVChannel;
  onTogglePlay: (id: number) => void;
  onPause: (id: number) => void;
  onSkipNext: (id: number) => void;
  onSkipPrevious: (id: number) => void;
  onToggleMute: (id: number) => void;
  onChangeVolume: (id: number, vol: number) => void;
  onChangeAspectRatio: (id: number, mode: AspectRatioMode) => void;
  onToggleScroll: (id: number) => void;
  onTriggerEmergencyHold: (id: number) => void;
  onToggleAutoPlay?: (id: number) => void;
  onToggleLoop?: (id: number) => void;
  onTakeClip?: (id: number, clipIndex: number) => void;
  onOpenVlcModal?: () => void;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  onImportVideos?: (channelId: number, files: FileList | File[]) => void;
  onUpdateGraphics?: (id: number, graphics: BottomScrollConfig) => void;
  onUpdateBottomOverlay?: (id: number, overlay: OverlayBannerConfig) => void;
  onUpdateTopOverlay?: (id: number, overlay: OverlayBannerConfig) => void;
  onUpdateLShape?: (id: number, lShape: LShapeConfig) => void;
  onUpdateTransmission?: (id: number, transmission: TransmissionConfig) => void;
  onToggleStudioPreviewMute?: (id: number) => void;
}

export const MasterConsole: React.FC<MasterConsoleProps> = ({
  channel,
  onTogglePlay,
  onPause,
  onSkipNext,
  onSkipPrevious,
  onToggleMute,
  onChangeVolume,
  onChangeAspectRatio,
  onToggleScroll,
  onTriggerEmergencyHold,
  onToggleAutoPlay,
  onToggleLoop,
  onTakeClip,
  onOpenVlcModal,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  onImportVideos,
  onUpdateGraphics,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUpdateTransmission,
  onToggleStudioPreviewMute,
}) => {
  const pgmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pgmContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const overlayFileInputRef = useRef<HTMLInputElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [isFullscreenPgm, setIsFullscreenPgm] = useState(false);
  const [activeLogoTarget, setActiveLogoTarget] = useState<'channel' | 'sponsor1' | 'sponsor2'>('channel');
  const [quickDeckTab, setQuickDeckTab] = useState<'logos' | 'ticker' | 'overlays' | 'video_output'>('overlays');
  const [activeOverlayPosition, setActiveOverlayPosition] = useState<'bottom' | 'top'>('bottom');
  const [quickTickerText, setQuickTickerText] = useState('');

  const handleTriggerFile = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportVideos?.(channel.id, e.target.files);
    }
  };

  // Render loop for Master PGM Canvas (1920x1080 Full HD with Overlays & Video)
  useEffect(() => {
    const canvas = pgmCanvasRef.current;
    if (!canvas) return;

    let running = true;
    const render = (time: number) => {
      if (!running) return;
      videoGenerator.renderChannelFrame(
        canvas,
        channel,
        time,
        activeVideoElement,
        activeOverlayVideoElement,
        activeTopOverlayVideoElement,
        activeLShapeVideoElement
      );
      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [channel, activeVideoElement, activeOverlayVideoElement, activeTopOverlayVideoElement, activeLShapeVideoElement]);

  const toggleFullscreenPgm = () => {
    if (!document.fullscreenElement && pgmContainerRef.current) {
      pgmContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreenPgm(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreenPgm(false);
    }
  };

  const currentClipIndex = channel.currentClipIndex;
  const currentClip = channel.playlist[currentClipIndex];
  const nextClipIndex = (currentClipIndex + 1) % Math.max(1, channel.playlist.length);
  const nextClip = channel.playlist[nextClipIndex];
  const isPlaying = channel.status === 'PLAYING';
  const isWithScroll = channel.graphics.tickerEnabled;
  const isAutoPlay = channel.autoPlayNext ?? (channel.loopMode !== 'off');

  const g = channel.graphics;
  const bottomOverlay: OverlayBannerConfig =
    channel.bottomOverlay || buildDefaultBottomOverlay(channel.id, channel.colorAccent, channel.genre);
  const topOverlay: OverlayBannerConfig =
    channel.topOverlay || buildDefaultTopOverlay(channel.id, channel.colorAccent);
  const currentOverlayTarget = activeOverlayPosition === 'bottom' ? bottomOverlay : topOverlay;

  const updateGraphics = (partial: Partial<BottomScrollConfig>) => {
    if (onUpdateGraphics) {
      onUpdateGraphics(channel.id, { ...g, ...partial });
    }
  };

  const updateActiveOverlay = (partial: Partial<OverlayBannerConfig>) => {
    if (activeOverlayPosition === 'bottom') {
      onUpdateBottomOverlay?.(channel.id, { ...bottomOverlay, ...partial });
    } else {
      onUpdateTopOverlay?.(channel.id, { ...topOverlay, ...partial });
    }
  };

  const updateTransmission = (partial: Partial<TransmissionConfig>) => {
    onUpdateTransmission?.(channel.id, { ...channel.transmission, ...partial });
  };

  const getChannelLogo = (): LogoItemConfig => {
    return (
      g.channelLogo || {
        enabled: g.logoEnabled ?? true,
        url: g.customLogoUrl || createChannelLogoSvg(channel.id, channel.colorAccent),
        label: `CH 0${channel.id} Logo`,
        position: g.logoPosition || 'top-right',
        offsetX: 0,
        offsetY: 0,
        size: g.logoSize || 130,
        opacity: g.logoOpacity ?? 0.95,
        isGif: false,
      }
    );
  };

  const getSponsor1 = (): LogoItemConfig => {
    return (
      g.sponsorLogo1 ||
      g.sponsor1Logo || {
        enabled: true,
        url: createSponsor1LogoSvg(channel.id),
        label: 'Sponsor 1',
        position: 'top-left',
        offsetX: 0,
        offsetY: 0,
        size: 115,
        opacity: 0.9,
        isGif: false,
      }
    );
  };

  const getSponsor2 = (): LogoItemConfig => {
    return (
      g.sponsorLogo2 ||
      g.sponsor2Logo || {
        enabled: false,
        url: createSponsor2LogoSvg(channel.id),
        label: 'Sponsor 2',
        position: 'bottom-right',
        offsetX: 0,
        offsetY: 0,
        size: 105,
        opacity: 0.9,
        isGif: false,
      }
    );
  };

  const updateTargetLogo = (target: 'channel' | 'sponsor1' | 'sponsor2', partial: Partial<LogoItemConfig>) => {
    if (target === 'channel') {
      const current = getChannelLogo();
      const updated = { ...current, ...partial };
      updateGraphics({
        channelLogo: updated,
        logoEnabled: updated.enabled,
        logoPosition: updated.position,
        logoSize: updated.size,
        logoOpacity: updated.opacity,
      });
    } else if (target === 'sponsor1') {
      const current = getSponsor1();
      const updated = { ...current, ...partial };
      updateGraphics({ sponsorLogo1: updated, sponsor1Logo: updated });
    } else {
      const current = getSponsor2();
      const updated = { ...current, ...partial };
      updateGraphics({ sponsorLogo2: updated, sponsor2Logo: updated });
    }
  };

  const handleLogoUpload = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const isGif = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif';
    updateTargetLogo(activeLogoTarget, { url: objectUrl, label: file.name, isGif, enabled: true });
  };

  const handleQuickOverlayUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const targetOverlay = activeOverlayPosition === 'bottom' ? bottomOverlay : topOverlay;
    const fixedImageSec = targetOverlay.imageFixedDurationSec || 10;

    Array.from(files).forEach((file, idx) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isVid = file.type.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'].includes(ext);
      const url = URL.createObjectURL(file);
      const baseTitle = file.name.replace(/\.[^/.]+$/, '').toUpperCase();
      const itemId = `ov-quick-${activeOverlayPosition}-${Date.now()}-${idx}`;

      if (isVid) {
        const tempVid = document.createElement('video');
        tempVid.preload = 'metadata';
        tempVid.src = url;
        tempVid.onloadedmetadata = () => {
          const detectedDur =
            tempVid.duration && isFinite(tempVid.duration) && tempVid.duration > 0
              ? Math.max(1, Math.ceil(tempVid.duration))
              : 15;
          const newItem: OverlayPlaylistItem = {
            id: itemId,
            title: `${baseTitle} (FULL VIDEO)`,
            enabled: true,
            mediaType: 'video',
            url,
            file,
            duration: detectedDur,
            autoVideoDuration: true,
            fitMode: targetOverlay.fitMode || 'fill',
            opacity: 1,
          };
          const latestOverlay = activeOverlayPosition === 'bottom' ? bottomOverlay : topOverlay;
          updateActiveOverlay({
            enabled: true,
            isPlaying: true,
            playlist: [...(latestOverlay.playlist || []), newItem],
          });
        };
      } else {
        const newItem: OverlayPlaylistItem = {
          id: itemId,
          title: `${baseTitle} (IMAGE ${fixedImageSec}s)`,
          enabled: true,
          mediaType: 'image',
          url,
          file,
          duration: fixedImageSec,
          autoVideoDuration: false,
          fitMode: targetOverlay.fitMode || 'fill',
          opacity: 1,
        };
        updateActiveOverlay({
          enabled: true,
          isPlaying: true,
          playlist: [...(targetOverlay.playlist || []), newItem],
        });
      }
    });
  };

  const handleNudge = (dx: number, dy: number) => {
    const target = activeLogoTarget === 'channel' ? getChannelLogo() : activeLogoTarget === 'sponsor1' ? getSponsor1() : getSponsor2();
    updateTargetLogo(activeLogoTarget, {
      offsetX: Math.max(-250, Math.min(250, (target.offsetX || 0) + dx)),
      offsetY: Math.max(-250, Math.min(250, (target.offsetY || 0) + dy)),
    });
  };

  const handleSizeDelta = (delta: number) => {
    const target = activeLogoTarget === 'channel' ? getChannelLogo() : activeLogoTarget === 'sponsor1' ? getSponsor1() : getSponsor2();
    const newSize = Math.max(30, Math.min(260, (target.size || 110) + delta));
    updateTargetLogo(activeLogoTarget, { size: newSize });
  };

  const channelLogo = getChannelLogo();
  const sponsor1 = getSponsor1();
  const sponsor2 = getSponsor2();
  const displayMode = g.logoDisplayMode || 'all';
  const activeLogo = activeLogoTarget === 'channel' ? channelLogo : activeLogoTarget === 'sponsor1' ? sponsor1 : sponsor2;

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const clipDuration = currentClip?.duration || 180;
  const elapsed = channel.currentTime || 0;
  const progressPercent = Math.min(100, Math.max(0, (elapsed / Math.max(1, clipDuration)) * 100));

  return (
    <div className="p-2.5 bg-[#050508] text-zinc-100 h-[calc(100vh-130px)] min-h-[580px] flex flex-col gap-2 select-none overflow-hidden">
      {/* Top Header Bar: Channel Badge, Callsign, Format, Clean Toggle & VLC Stream Test */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0a0a0e] px-3 py-1.5 rounded-lg border border-zinc-800/80 shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="w-6 h-5 rounded text-[11px] font-black flex items-center justify-center text-white shrink-0 shadow"
            style={{ backgroundColor: channel.colorAccent }}
          >
            0{channel.id}
          </span>
          <div className="flex items-center gap-2">
            {channel.graphics.channelLogo?.url ? (
              <img
                src={channel.graphics.channelLogo.url}
                alt={`CH 0${channel.id}`}
                className="h-5 w-auto max-w-[65px] object-contain shrink-0"
              />
            ) : (
              <span className="font-mono text-xs text-white font-bold">
                CH 0{channel.id}
              </span>
            )}
            <span className="text-[10px] text-zinc-400 font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
              {channel.genre} • {channel.callSign}
            </span>
          </div>
        </div>

        {/* Action Controls in Header */}
        <div className="flex items-center gap-1.5">
          {/* Direct File Ingest */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={handleTriggerFile}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition shadow-sm font-mono"
            title="Load and immediately play video files on this channel"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Load Video</span>
          </button>

          {/* Clean Feed / Scroll Toggle */}
          <button
            onClick={() => onToggleScroll(channel.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono font-bold transition border ${
              isWithScroll
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
            }`}
            title="Toggle News Crawler on this channel"
          >
            {isWithScroll ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3 text-zinc-500" />}
            <span>{isWithScroll ? 'Scroll ON' : 'Clean'}</span>
          </button>

          {/* Emergency Color Bars */}
          <button
            onClick={() => onTriggerEmergencyHold(channel.id)}
            className="px-2 py-1 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs font-mono font-bold transition"
            title="Switch to SMPTE Color Bars"
          >
            SMPTE Bars
          </button>
        </div>
      </div>

      {/* Main Broadcast Layout: LEFT = PLAYER ON AIR, RIGHT = UP NEXT & BOTTOM RIGHT CONTROLS */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 min-h-0">
        
        {/* ========================================================= */}
        {/* LEFT SIDE: DEDICATED PLAYER ON AIR (PROGRAM PGM)          */}
        {/* ========================================================= */}
        <div
          ref={pgmContainerRef}
          className="lg:col-span-7 xl:col-span-8 flex flex-col justify-between bg-[#08080b] rounded-lg border border-zinc-800/90 p-2 min-h-0 relative shadow-lg"
        >
          {/* Video Player Header */}
          <div className="flex items-center justify-between px-1 mb-1.5 shrink-0 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800 font-mono font-bold text-[10px] tracking-wider">
                <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
                <span>{isPlaying ? 'ON-AIR PGM' : 'STANDBY'}</span>
              </span>

              <span className="font-bold text-white truncate max-w-[280px] text-xs">
                {currentClip?.title || 'Default Station Ident Loop'}
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
              <span className="bg-zinc-900 px-1.5 py-0.2 rounded border border-zinc-800 text-cyan-400">
                {channel.transmission.outputResolution}
              </span>
              <span>{channel.transmission.fps} FPS</span>
              <button
                onClick={toggleFullscreenPgm}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                title="Fullscreen Monitor"
              >
                <Maximize className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* 16:9 True Broadcast Video Screen (Canvas) */}
          <div className="relative flex-1 bg-black rounded overflow-hidden flex items-center justify-center min-h-0">
            <canvas
              ref={pgmCanvasRef}
              width={1920}
              height={1080}
              className="w-full h-full object-contain"
            />
          </div>

          {/* Player Bottom Bar: Timecode, Scrubber & Audio VU meters */}
          <div className="mt-2 pt-1.5 border-t border-zinc-800/80 shrink-0 space-y-1.5">
            {/* Scrubber Progress Bar */}
            <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
              <div
                className="bg-red-500 h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Timecode & Audio VU Meter Bar */}
            <div className="flex items-center justify-between text-xs font-mono px-1">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 text-[10px]">TIME:</span>
                  <span className="text-zinc-200 font-bold text-xs">{formatSec(elapsed)}</span>
                  <span className="text-zinc-600">/</span>
                  <span className="text-zinc-400 text-xs">{formatSec(clipDuration)}</span>
                </div>

                <div className="text-[10px] text-cyan-400">
                  REMAINING: -{formatSec(Math.max(0, clipDuration - elapsed))}
                </div>
              </div>

              {/* Stereo Audio VU Meters (L / R) */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-500">VU</span>
                <div className="flex flex-col gap-0.5">
                  {/* Left Channel */}
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-zinc-500 w-2">L</span>
                    <div className="w-24 bg-zinc-900 h-1.5 rounded-sm overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterL * 80 : 0}%` }}
                      />
                      <div
                        className="bg-amber-400 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterL * 15 : 0}%` }}
                      />
                      <div
                        className="bg-red-500 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterL * 5 : 0}%` }}
                      />
                    </div>
                  </div>
                  {/* Right Channel */}
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-zinc-500 w-2">R</span>
                    <div className="w-24 bg-zinc-900 h-1.5 rounded-sm overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterR * 80 : 0}%` }}
                      />
                      <div
                        className="bg-amber-400 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterR * 15 : 0}%` }}
                      />
                      <div
                        className="bg-red-500 h-full"
                        style={{ width: `${isPlaying ? channel.transmission.audio.meterR * 5 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick On-Air Graphics Deck: 1) LOGOS, 2) TOP/BOTTOM NEWS TICKER, 3) LEFT/RIGHT L-SHAPE TELESHOP */}
            <div className="mt-1.5 pt-1.5 border-t border-zinc-800/80 bg-zinc-950/95 p-2 rounded-lg text-xs space-y-1.5 shrink-0">
              {/* Hidden file input for quick logo upload */}
              <input
                ref={logoFileInputRef}
                type="file"
                accept="image/png,image/gif,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleLogoUpload(e.target.files[0]);
                  }
                }}
              />
              {/* Hidden file input for quick Top & Bottom Overlay upload (PNG, JPG, GIF, MP4, MOV, MKV) */}
              <input
                ref={overlayFileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.mkv,.webm"
                className="hidden"
                onChange={(e) => handleQuickOverlayUpload(e.target.files)}
              />

              {/* Top Mode Switcher Bar: 1) LOGOS | 2) NEWS TICKER | 3) TOP & BOTTOM OVERLAYS | 4) VIDEO OUTPUT & BITRATE */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1 border-b border-zinc-800/80 font-mono text-[10px]">
                <div className="flex flex-wrap items-center gap-1">
                  {/* Tab 1: Playout Logo Option */}
                  <button
                    onClick={() => setQuickDeckTab('logos')}
                    className={`px-2 py-1 rounded font-bold border transition flex items-center gap-1 ${
                      quickDeckTab === 'logos'
                        ? 'bg-blue-600 text-white border-blue-400 shadow-xs'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                    }`}
                  >
                    <span>1. LOGOS (8-SIDE &amp; 6 SIZES)</span>
                    <span className={channelLogo.enabled ? 'text-emerald-300' : 'text-zinc-500'}>
                      ({channelLogo.enabled ? 'ON' : 'OFF'})
                    </span>
                  </button>

                  {/* Tab 2: Top & Bottom News Ticker Option */}
                  <div className="flex items-center rounded border border-zinc-800 overflow-hidden">
                    <button
                      onClick={() => setQuickDeckTab('ticker')}
                      className={`px-2 py-1 font-bold transition flex items-center gap-1 ${
                        quickDeckTab === 'ticker'
                          ? 'bg-cyan-600 text-white'
                          : 'bg-zinc-900 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span>2. TICKER ({g.tickerPosition === 'top' ? 'TOP' : 'BOT'})</span>
                    </button>
                    <button
                      onClick={() => updateGraphics({ tickerEnabled: !g.tickerEnabled })}
                      className={`px-1.5 py-1 font-black border-l border-zinc-800 ${
                        g.tickerEnabled ? 'bg-emerald-600 text-white' : 'bg-zinc-950 text-zinc-500'
                      }`}
                      title="Toggle News Ticker ON/OFF"
                    >
                      {g.tickerEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Tab 3: Top & Bottom Overlays (Videos Full Duration + Images Fixed Sec) */}
                  <button
                    onClick={() => setQuickDeckTab('overlays')}
                    className={`px-2 py-1 rounded font-bold border transition flex items-center gap-1 ${
                      quickDeckTab === 'overlays'
                        ? 'bg-amber-500 text-black border-amber-300 shadow-xs'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
                    }`}
                  >
                    <span>3. TOP &amp; BOTTOM OVERLAYS</span>
                  </button>

                  {/* Tab 4: Video Output & MSO Bitrate (720x756 / 720p / 1080p / 4K • 500–6000 kbps) */}
                  <button
                    onClick={() => setQuickDeckTab('video_output')}
                    className={`px-2 py-1 rounded font-bold border transition flex items-center gap-1 ${
                      quickDeckTab === 'video_output'
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-xs'
                        : 'bg-zinc-900 text-emerald-400 border-emerald-800/80 hover:text-white'
                    }`}
                  >
                    <span>4. VIDEO OUTPUT ({channel.transmission.outputResolution} • {channel.transmission.videoBitrateKbps}k)</span>
                  </button>
                </div>

                {/* Quick Bottom 1920x200 & Top Banner Toggles */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      onUpdateBottomOverlay?.(channel.id, {
                        ...(channel.bottomOverlay as OverlayBannerConfig),
                        enabled: !channel.bottomOverlay?.enabled,
                      })
                    }
                    className={`px-2 py-0.5 rounded border font-bold ${
                      channel.bottomOverlay?.enabled
                        ? 'bg-red-950 text-red-300 border-red-700'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                    title="Toggle 1920x200 Bottom Banner Overlay"
                  >
                    ▾ 1920×200: {channel.bottomOverlay?.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() =>
                      onUpdateTopOverlay?.(channel.id, {
                        ...(channel.topOverlay as OverlayBannerConfig),
                        enabled: !channel.topOverlay?.enabled,
                      })
                    }
                    className={`px-2 py-0.5 rounded border font-bold ${
                      channel.topOverlay?.enabled
                        ? 'bg-amber-950 text-amber-300 border-amber-700'
                        : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                    }`}
                    title="Toggle Top Banner Overlay"
                  >
                    ▴ TOP: {channel.topOverlay?.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* ================================================================= */}
              {/* DECK 1: PLAYOUT LOGO OPTION (CH LOGO, SPONSOR 1, SPONSOR 2)       */}
              {/* ================================================================= */}
              {quickDeckTab === 'logos' && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[11px]">
                    {/* 3 Logo Target Selectors */}
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500 text-[10px] uppercase font-bold mr-1">LOGOS:</span>

                      {/* Channel Logo */}
                      <div className="flex items-center rounded border border-zinc-800 bg-zinc-900/90 overflow-hidden">
                        <button
                          onClick={() => setActiveLogoTarget('channel')}
                          className={`px-2 py-0.5 text-[10px] font-bold transition ${
                            activeLogoTarget === 'channel'
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          CH LOGO
                        </button>
                        <button
                          onClick={() => updateTargetLogo('channel', { enabled: !channelLogo.enabled })}
                          className={`px-1.5 py-0.5 text-[9px] font-bold border-l border-zinc-800 ${
                            channelLogo.enabled ? 'bg-blue-950 text-blue-300' : 'bg-zinc-950 text-zinc-600'
                          }`}
                        >
                          {channelLogo.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Sponsor 1 */}
                      <div className="flex items-center rounded border border-zinc-800 bg-zinc-900/90 overflow-hidden">
                        <button
                          onClick={() => setActiveLogoTarget('sponsor1')}
                          className={`px-2 py-0.5 text-[10px] font-bold transition ${
                            activeLogoTarget === 'sponsor1'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          SPONSOR 1
                        </button>
                        <button
                          onClick={() => updateTargetLogo('sponsor1', { enabled: !sponsor1.enabled })}
                          className={`px-1.5 py-0.5 text-[9px] font-bold border-l border-zinc-800 ${
                            sponsor1.enabled ? 'bg-indigo-950 text-indigo-300' : 'bg-zinc-950 text-zinc-600'
                          }`}
                        >
                          {sponsor1.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Sponsor 2 */}
                      <div className="flex items-center rounded border border-zinc-800 bg-zinc-900/90 overflow-hidden">
                        <button
                          onClick={() => setActiveLogoTarget('sponsor2')}
                          className={`px-2 py-0.5 text-[10px] font-bold transition ${
                            activeLogoTarget === 'sponsor2'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          SPONSOR 2
                        </button>
                        <button
                          onClick={() => updateTargetLogo('sponsor2', { enabled: !sponsor2.enabled })}
                          className={`px-1.5 py-0.5 text-[9px] font-bold border-l border-zinc-800 ${
                            sponsor2.enabled ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-950 text-zinc-600'
                          }`}
                        >
                          {sponsor2.enabled ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>

                    {/* Display Priority Mode Switcher */}
                    <div className="flex items-center gap-1 bg-zinc-900/90 p-0.5 rounded border border-zinc-800 text-[10px]">
                      <span className="text-zinc-500 px-1 font-bold">MODE:</span>
                      {(['all', 'channel_only', 'sponsor1_only', 'sponsor2_only', 'cycle'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => updateGraphics({ logoDisplayMode: mode })}
                          className={`px-1.5 py-0.5 rounded uppercase font-bold transition ${
                            displayMode === mode
                              ? 'bg-cyan-600 text-white shadow-xs'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {mode === 'all'
                            ? 'ALL'
                            : mode === 'channel_only'
                            ? 'CH'
                            : mode === 'sponsor1_only'
                            ? 'SP1'
                            : mode === 'sponsor2_only'
                            ? 'SP2'
                            : 'CYCLE'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Row 2: Active Logo's 8-Side Positioning, 6 Sizes, Directional Nudge, Upload PNG/GIF */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-zinc-800/60 font-mono text-[10px]">
                    <div className="flex items-center gap-0.5">
                      <span className="text-zinc-500 font-bold uppercase mr-0.5">8-SIDE:</span>
                      {(
                        [
                          { id: 'top-left', label: '↖ TL' },
                          { id: 'top-center', label: '⬆ TC' },
                          { id: 'top-right', label: '↗ TR' },
                          { id: 'middle-left', label: '⬅ ML' },
                          { id: 'middle-right', label: '➡ MR' },
                          { id: 'bottom-left', label: '↙ BL' },
                          { id: 'bottom-center', label: '⬇ BC' },
                          { id: 'bottom-right', label: '↘ BR' },
                        ] as { id: LogoCornerPosition; label: string }[]
                      ).map((pos) => (
                        <button
                          key={pos.id}
                          onClick={() => updateTargetLogo(activeLogoTarget, { position: pos.id, offsetX: 0, offsetY: 0 })}
                          className={`px-1 py-0.5 rounded border transition font-bold text-[9px] ${
                            activeLogo.position === pos.id
                              ? 'border-cyan-500 bg-cyan-950 text-cyan-300'
                              : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-0.5">
                      <span className="text-zinc-500 font-bold mr-0.5">6 SIZES:</span>
                      {[60, 90, 120, 150, 190, 240].map((sz, idx) => (
                        <button
                          key={sz}
                          onClick={() => updateTargetLogo(activeLogoTarget, { size: sz })}
                          className={`px-1 py-0.5 rounded border font-bold text-[9px] ${
                            Math.abs((activeLogo.size || 120) - sz) <= 8
                              ? 'bg-amber-500 text-black border-amber-400'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                          }`}
                        >
                          S{idx + 1}:{sz}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-0.5">
                      <span className="text-zinc-500 font-bold mr-0.5">MOVE:</span>
                      <button
                        onClick={() => handleNudge(-10, 0)}
                        className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                      >
                        ⬅
                      </button>
                      <button
                        onClick={() => handleNudge(0, -10)}
                        className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                      >
                        ⬆
                      </button>
                      <button
                        onClick={() => handleNudge(0, 10)}
                        className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                      >
                        ⬇
                      </button>
                      <button
                        onClick={() => handleNudge(10, 0)}
                        className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                      >
                        ➡
                      </button>
                    </div>

                    <button
                      onClick={() => logoFileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition"
                    >
                      <Upload className="w-3 h-3" />
                      <span>PNG/GIF</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* DECK 2: TOP & BOTTOM NEWS TICKER OPTION (SAME LIKE LOGO OPTION!)  */}
              {/* ================================================================= */}
              {quickDeckTab === 'ticker' && (
                <div className="space-y-1.5 font-mono text-[10px]">
                  {/* Row 1: Position (Top/Bottom), Size (Small/Med/Big), Mode (Continuous/1-by-1), Move & Speed */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    {/* Top / Bottom Fix */}
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500 font-bold">PLACE:</span>
                      <button
                        onClick={() =>
                          updateGraphics({
                            tickerEnabled: true,
                            tickerPosition: 'bottom',
                            tickerCustomY: undefined,
                            tickerCustomX: 0,
                            tickerCustomWidth: 1920,
                          })
                        }
                        className={`px-2 py-0.5 rounded border font-bold ${
                          (g.tickerPosition || 'bottom') === 'bottom'
                            ? 'bg-cyan-600 text-white border-cyan-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        ▾ BOTTOM TICKER
                      </button>
                      <button
                        onClick={() =>
                          updateGraphics({
                            tickerEnabled: true,
                            tickerPosition: 'top',
                            tickerCustomY: 0,
                            tickerCustomX: 0,
                            tickerCustomWidth: 1920,
                          })
                        }
                        className={`px-2 py-0.5 rounded border font-bold ${
                          g.tickerPosition === 'top'
                            ? 'bg-cyan-600 text-white border-cyan-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        ▴ TOP TICKER
                      </button>
                    </div>

                    {/* Small / Medium / Big Scroll Size */}
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500 font-bold">SIZE:</span>
                      <button
                        onClick={() =>
                          updateGraphics({
                            tickerHeight: 'compact',
                            tickerPresetSize: 'small',
                            tickerCustomHeight: 34,
                          })
                        }
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          g.tickerHeight === 'compact'
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        SMALL
                      </button>
                      <button
                        onClick={() =>
                          updateGraphics({
                            tickerHeight: 'normal',
                            tickerPresetSize: 'medium',
                            tickerCustomHeight: 48,
                          })
                        }
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          (g.tickerHeight || 'normal') === 'normal'
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        MED
                      </button>
                      <button
                        onClick={() =>
                          updateGraphics({
                            tickerHeight: 'large',
                            tickerPresetSize: 'large',
                            tickerCustomHeight: 68,
                          })
                        }
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          g.tickerHeight === 'large'
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        BIG TV
                      </button>
                    </div>

                    {/* Continuous vs 1-by-1 Mode */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateGraphics({ tickerMode: 'continuous' })}
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          (g.tickerMode || 'continuous') === 'continuous'
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        ⇄ Scroll
                      </button>
                      <button
                        onClick={() => updateGraphics({ tickerMode: 'one_by_one' })}
                        className={`px-1.5 py-0.5 rounded border font-bold ${
                          g.tickerMode === 'one_by_one'
                            ? 'bg-amber-600 text-black border-amber-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        1-by-1
                      </button>
                    </div>

                    {/* Speed Control */}
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500 font-bold">SPD:</span>
                      <button
                        onClick={() =>
                          updateGraphics({ tickerSpeed: Math.max(1, (g.tickerSpeed || 4) - 1) })
                        }
                        className="px-1.5 py-0.5 bg-zinc-900 rounded border border-zinc-800"
                      >
                        -
                      </button>
                      <span className="text-cyan-300 font-bold">{g.tickerSpeed || 4}</span>
                      <button
                        onClick={() =>
                          updateGraphics({ tickerSpeed: Math.min(10, (g.tickerSpeed || 4) + 1) })
                        }
                        className="px-1.5 py-0.5 bg-zinc-900 rounded border border-zinc-800"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Quick Add Breaking News Headline & Tickable Items */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-800/60">
                    <input
                      type="text"
                      value={quickTickerText}
                      onChange={(e) => setQuickTickerText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && quickTickerText.trim()) {
                          updateGraphics({
                            tickerEnabled: true,
                            tickerItems: [
                              ...g.tickerItems,
                              {
                                id: `tkr-${Date.now()}`,
                                text: quickTickerText.trim(),
                                enabled: true,
                                priority: 'breaking',
                              },
                            ],
                          });
                          setQuickTickerText('');
                        }
                      }}
                      placeholder="Add breaking news ticker text here..."
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-white focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      onClick={() => {
                        if (!quickTickerText.trim()) return;
                        updateGraphics({
                          tickerEnabled: true,
                          tickerItems: [
                            ...g.tickerItems,
                            {
                              id: `tkr-${Date.now()}`,
                              text: quickTickerText.trim(),
                              enabled: true,
                              priority: 'breaking',
                            },
                          ],
                        });
                        setQuickTickerText('');
                      }}
                      className="px-2.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold"
                    >
                      + Add News
                    </button>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* DECK 3: TOP & BOTTOM OVERLAYS (FULL VIDEO DURATION + FIXED IMAGE) */}
              {/* ================================================================= */}
              {quickDeckTab === 'overlays' && (
                <div className="space-y-1.5 font-mono text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    {/* Select Bottom vs Top Overlay */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setActiveOverlayPosition('bottom')}
                        className={`px-2 py-0.5 rounded border font-bold ${
                          activeOverlayPosition === 'bottom'
                            ? 'bg-red-600 text-white border-red-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        ▾ BOTTOM OVERLAY ({bottomOverlay.playlist.length} items)
                      </button>
                      <button
                        onClick={() => setActiveOverlayPosition('top')}
                        className={`px-2 py-0.5 rounded border font-bold ${
                          activeOverlayPosition === 'top'
                            ? 'bg-amber-500 text-black border-amber-300'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        ▴ TOP OVERLAY ({topOverlay.playlist.length} items)
                      </button>
                    </div>

                    {/* Enable & Squeeze Video Controls */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          updateActiveOverlay({ enabled: !currentOverlayTarget.enabled })
                        }
                        className={`px-2 py-0.5 rounded border font-bold ${
                          currentOverlayTarget.enabled
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        {activeOverlayPosition.toUpperCase()}: {currentOverlayTarget.enabled ? 'ON AIR' : 'OFF'}
                      </button>

                      <button
                        onClick={() =>
                          updateActiveOverlay({
                            enabled: true,
                            squeezeProgramVideo: !currentOverlayTarget.squeezeProgramVideo,
                          })
                        }
                        className={`px-2 py-0.5 rounded border font-bold ${
                          currentOverlayTarget.squeezeProgramVideo
                            ? 'bg-cyan-600 text-white border-cyan-400'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                        title="Squeeze main video so Top/Bottom banner never covers program video"
                      >
                        {currentOverlayTarget.squeezeProgramVideo ? '◱ SQUEEZE VIDEO: ON' : '⛶ SQUEEZE: OFF'}
                      </button>
                    </div>

                    {/* Upload Videos (Full Duration) & Images (Fixed Sec) */}
                    <button
                      onClick={() => overlayFileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition shadow-xs"
                      title="Upload Videos (Play Full Duration Automatically) or Images (Play Fixed Seconds)"
                    >
                      <Upload className="w-3 h-3" />
                      <span>+ ADD VIDEO (FULL DUR) / IMAGE</span>
                    </button>
                  </div>

                  {/* Row 2: Fixed Seconds for Images + Video Full Duration Status */}
                  <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-zinc-800/60">
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-400 font-bold text-[9px]">
                        ✓ VIDEOS: PLAY 100% FULL DURATION THEN NEXT
                      </span>
                      <span className="text-zinc-600">|</span>
                      <span className="text-amber-300 font-bold text-[9px]">
                        IMAGE FIXED SEC ({activeOverlayPosition.toUpperCase()}):
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5">
                      {[5, 8, 10, 15, 20, 30, 45, 60].map((sec) => (
                        <button
                          key={sec}
                          onClick={() =>
                            updateActiveOverlay({
                              imageFixedDurationSec: sec,
                              playlist: (currentOverlayTarget.playlist || []).map((it) =>
                                it.mediaType === 'image'
                                  ? { ...it, duration: sec, autoVideoDuration: false }
                                  : { ...it, autoVideoDuration: true }
                              ),
                            })
                          }
                          className={`px-1.5 py-0.5 rounded font-bold border text-[9px] ${
                            (currentOverlayTarget.imageFixedDurationSec || 10) === sec
                              ? 'bg-amber-500 text-black border-amber-300'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ================================================================= */}
              {/* DECK 4: VIDEO OUTPUT & MSO BITRATE (720x756 / 720p / 1080p / 4K)  */}
              {/* ================================================================= */}
              {quickDeckTab === 'video_output' && (
                <div className="space-y-1.5 font-mono text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-zinc-400 font-bold">OUTPUT RESOLUTION:</span>
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { res: '720x756', aspect: '720x756', label: '720×756 (MSO SPECIAL)' },
                          { res: '720x576', aspect: '720x576', label: '720×576 (MSO PAL)' },
                          { res: '720p', aspect: '16:9', label: '1280×720 (720p HD)' },
                          { res: '1080p', aspect: '16:9', label: '1920×1080 (1080p FHD)' },
                          { res: '4k', aspect: '16:9', label: '3840×2160 (4K UHD)' },
                        ] as { res: OutputResolution; aspect: AspectRatioMode; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.res}
                          onClick={() =>
                            updateTransmission({
                              outputResolution: opt.res,
                              aspectRatioMode: opt.aspect,
                            })
                          }
                          className={`px-2 py-0.5 rounded border font-bold transition ${
                            channel.transmission.outputResolution === opt.res
                              ? 'bg-emerald-600 text-white border-emerald-400 shadow-xs'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Row 2: Bitrate 500 to 6000 kbps */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/60">
                    <span className="text-amber-400 font-bold">
                      BITRATE ({channel.transmission.videoBitrateKbps} kbps):
                    </span>
                    <input
                      type="range"
                      min={500}
                      max={6000}
                      step={100}
                      value={Math.min(6000, Math.max(500, channel.transmission.videoBitrateKbps))}
                      onChange={(e) =>
                        updateTransmission({
                          videoBitrateKbps: Number(e.target.value),
                          outgoingBitrateKbps: Number(e.target.value),
                        })
                      }
                      className="w-28 accent-amber-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
                    />
                    <div className="flex flex-wrap items-center gap-0.5">
                      {[500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000].map((kbps) => (
                        <button
                          key={kbps}
                          onClick={() =>
                            updateTransmission({
                              videoBitrateKbps: kbps,
                              outgoingBitrateKbps: kbps,
                            })
                          }
                          className={`px-1.5 py-0.5 rounded font-bold border text-[9px] ${
                            channel.transmission.videoBitrateKbps === kbps
                              ? 'bg-amber-500 text-black border-amber-300'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                          }`}
                        >
                          {kbps}k
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT SIDE: UP NEXT (TOP) & PLAYOUT CONTROLS (BOTTOM)    */}
        {/* ========================================================= */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-2 min-h-0">
          
          {/* 1. UP NEXT / CUE PREVIEW CARD */}
          <div className="flex-1 min-h-0 bg-[#08080b] rounded-lg border border-zinc-800/90 p-2.5 flex flex-col justify-between shadow-lg">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <ArrowRightCircle className="w-4 h-4 text-amber-400" />
                  <span className="font-black text-xs text-white tracking-wider">
                    UP NEXT / CUE
                  </span>
                </div>
                <span className="text-[9px] bg-amber-950/80 text-amber-400 font-mono font-bold px-1.5 py-0.2 rounded border border-amber-800">
                  ARMED &amp; READY
                </span>
              </div>

              {/* Next Clip Details */}
              {nextClip ? (
                <div className="bg-black/60 rounded-md border border-zinc-800/80 p-2 mb-2">
                  <div className="flex items-center justify-between gap-1 mb-1 text-[11px]">
                    <span className="font-bold text-white truncate text-xs">
                      {nextClip.title}
                    </span>
                    <span className="text-[10px] bg-zinc-900 text-zinc-300 font-mono px-1 py-0.2 rounded shrink-0">
                      {nextClip.category}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                    <span>DURATION: {formatSec(nextClip.duration)}</span>
                    <span>{nextClip.resolution || '1080p'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 p-3 bg-black/40 rounded text-center mb-2">
                  No upcoming clip in playlist queue
                </div>
              )}

              {/* Action: TAKE NEXT NOW (Cut to next clip) */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (onTakeClip) {
                      onTakeClip(channel.id, nextClipIndex);
                    } else {
                      onSkipNext(channel.id);
                    }
                  }}
                  className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 text-black font-black rounded text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                  title="Cut to next clip immediately on air"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>TAKE NEXT NOW</span>
                </button>

                <button
                  onClick={() => onSkipNext(channel.id)}
                  className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded text-xs font-bold border border-zinc-800 transition"
                  title="Skip to clip after next"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Upcoming Queue Mini-List (Next 3 items) */}
            <div className="mt-2 pt-2 border-t border-zinc-800/80 text-xs">
              <span className="text-[10px] font-mono text-zinc-500 block mb-1">
                SUBSEQUENT QUEUE ({channel.playlist.length} TOTAL)
              </span>
              <div className="space-y-1 max-h-[80px] overflow-y-auto">
                {channel.playlist.slice(0, 3).map((clip, i) => (
                  <div
                    key={clip.id || i}
                    onClick={() => onTakeClip?.(channel.id, i)}
                    className="flex items-center justify-between px-1.5 py-0.5 rounded bg-black/40 hover:bg-zinc-900 text-[10px] cursor-pointer text-zinc-400 hover:text-white font-mono"
                  >
                    <span className="truncate max-w-[200px]">{i + 1}. {clip.title}</span>
                    <span className="text-zinc-500">{formatSec(clip.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. BOTTOM RIGHT: PLAYOUT AUTOMATION & TRANSPORT CONTROLS */}
          <div className="bg-[#08080b] rounded-lg border border-zinc-800/90 p-2.5 flex flex-col gap-2 shrink-0 shadow-lg">
            
            {/* Header / Transport Buttons */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-white tracking-wider font-mono">
                PLAYOUT CONTROLS
              </span>

              {/* Main Transport Row */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onSkipPrevious(channel.id)}
                  className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition"
                  title="Previous Clip"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onTogglePlay(channel.id)}
                  className={`px-3 py-1.5 rounded font-bold transition flex items-center gap-1 text-xs shadow-sm ${
                    isPlaying
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                  title={isPlaying ? 'Stop Channel' : 'Play Channel'}
                >
                  {isPlaying ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      <span>STOP</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>PLAY</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => onPause(channel.id)}
                  className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition"
                  title="Pause Playback"
                >
                  <Pause className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onSkipNext(channel.id)}
                  className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition"
                  title="Next Clip"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Automation Options: AUTO PLAY & LOOP */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-zinc-800/80 text-xs">
              {/* Auto Play Next */}
              <button
                onClick={() => onToggleAutoPlay?.(channel.id)}
                className={`flex items-center justify-center gap-1 py-1 rounded text-xs font-mono font-bold transition border ${
                  isAutoPlay
                    ? 'bg-sky-950/80 text-sky-300 border-sky-800'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
                }`}
                title="Automatically advance to next clip upon completion"
              >
                <RotateCw className="w-3 h-3" />
                <span>AUTO PLAY: {isAutoPlay ? 'ON' : 'OFF'}</span>
              </button>

              {/* Loop Playlist */}
              <button
                onClick={() => onToggleLoop?.(channel.id)}
                className={`flex items-center justify-center gap-1 py-1 rounded text-xs font-mono font-bold transition border ${
                  channel.loopMode === 'playlist'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
                }`}
                title="Loop whole playlist continuously"
              >
                <RefreshCw className="w-3 h-3" />
                <span>LOOP: {channel.loopMode === 'playlist' ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            {/* Audio Volume Fader, Mute & Test Chime */}
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/80 text-xs">
              <button
                onClick={() => {
                  broadcastAudio.resumeContext();
                  onToggleMute(channel.id);
                }}
                className={`p-1.5 rounded transition ${
                  channel.transmission.audio.muted
                    ? 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-700 hover:text-white'
                }`}
                title="Toggle Software & Output Audio Mute"
              >
                {channel.transmission.audio.muted ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </button>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={channel.transmission.audio.masterVolume}
                  onChange={(e) => {
                    broadcastAudio.resumeContext();
                    onChangeVolume(channel.id, parseFloat(e.target.value));
                  }}
                  className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
                <span className="font-mono text-[10px] text-emerald-400 font-bold w-8 text-right">
                  {Math.round(channel.transmission.audio.masterVolume * 100)}%
                </span>
              </div>

              <button
                onClick={() => broadcastAudio.playTestChime()}
                className="px-2 py-1 rounded bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700 font-mono text-[9px] font-bold"
                title="Play audible broadcast test chime to verify speaker & output audio"
              >
                🔊 TEST
              </button>
            </div>

            {/* Video Output Resolution & MSO 720x756 / 720p / 1080p / 4K + Bitrate 500–6000 kbps */}
            <div className="space-y-1.5 pt-1.5 border-t border-zinc-800/80 text-xs font-mono">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-zinc-400 font-bold">OUTPUT RES:</span>
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      { res: '720x756', aspect: '720x756', label: '720×756 MSO' },
                      { res: '720x576', aspect: '720x576', label: '720×576' },
                      { res: '720p', aspect: '16:9', label: '720p' },
                      { res: '1080p', aspect: '16:9', label: '1080p' },
                      { res: '4k', aspect: '16:9', label: '4K' },
                    ] as { res: OutputResolution; aspect: AspectRatioMode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.res}
                      onClick={() => {
                        onChangeAspectRatio(channel.id, item.aspect);
                        updateTransmission({
                          outputResolution: item.res,
                          aspectRatioMode: item.aspect,
                        });
                      }}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition border ${
                        channel.transmission.outputResolution === item.res
                          ? 'bg-emerald-600 text-white border-emerald-400'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bitrate 500 to 6000 kbps */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-amber-400 font-bold shrink-0">
                  BITRATE: {channel.transmission.videoBitrateKbps}k
                </span>
                <input
                  type="range"
                  min={500}
                  max={6000}
                  step={100}
                  value={Math.min(6000, Math.max(500, channel.transmission.videoBitrateKbps))}
                  onChange={(e) =>
                    updateTransmission({
                      videoBitrateKbps: Number(e.target.value),
                      outgoingBitrateKbps: Number(e.target.value),
                    })
                  }
                  className="flex-1 accent-amber-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
                />
                <span className="text-[9px] text-zinc-500 shrink-0">500–6000k</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
