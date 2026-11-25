import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  Eye,
  EyeOff,
  Tag,
  Image as ImageIcon,
  RotateCcw,
  Layers,
  Sparkles,
  Upload,
  Copy,
  Clock,
  Film,
  Play,
  Pause,
  Edit3,
  Check,
  X,
  CheckSquare,
  Square,
  Layout,
  Tv,
  Maximize2,
  Save
} from 'lucide-react';
import { CGStudioPositionMap } from './CGStudioPositionMap';
import { CGLeftControlPanel, StudioActiveLayer } from './CGLeftControlPanel';
import { LShapeStudioPanel } from './LShapeStudioPanel';
import { TickerTopBottomStudio } from './TickerTopBottomStudio';
import { ClockStudioPanel } from './ClockStudioPanel';
import {
  TVChannel,
  BottomScrollConfig,
  TickerScrollItem,
  LogoItemConfig,
  LogoPlaylistItem,
  LogoCornerPosition,
  OverlayBannerConfig,
  OverlayPlaylistItem,
  OverlayFitMode,
  LShapeConfig
} from '../types/playout';
import { createChannelLogoSvg, createSponsor1LogoSvg, createSponsor2LogoSvg } from '../utils/defaultLogos';
import { create1920x200BannerSvg, buildDefaultLShape } from '../utils/defaultOverlays';
import {
  ALL_CG_MEDIA_ACCEPT,
  filterFolderCgMediaFiles,
  isSwfFile,
  isVideoFile,
  isVideoOrSwfFile,
  probeMediaFileDuration,
  swfEngine
} from '../services/swfEngine';
import { extractFolderName } from '../services/offlineMediaVault';

const SwfLogoTransparentPreview: React.FC<{ url: string; label?: string }> = ({ url, label }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    let active = true;
    let raf = 0;
    let lastDrawMs = 0;

    const tick = (t: number) => {
      if (!active) return;
      if (t - lastDrawMs >= 66) {
        lastDrawMs = t;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const swfCanvas = swfEngine.renderSwfToCanvas(url, label || '', t, 360, 220, 'logo');
          if (swfCanvas && swfCanvas.width > 0 && swfCanvas.height > 0) {
            ctx.drawImage(swfCanvas, 0, 0, canvas.width, canvas.height);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [url, label]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={120}
      className="w-full h-full object-contain block"
    />
  );
};

interface CGGraphicsEditorProps {
  channel: TVChannel;
  onUpdateGraphics: (
    id: number,
    graphicsOrUpdater:
      | BottomScrollConfig
      | ((prev: BottomScrollConfig) => BottomScrollConfig)
  ) => void;
  onUpdateBottomOverlay?: (
    id: number,
    overlayOrUpdater:
      | OverlayBannerConfig
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => void;
  onUpdateTopOverlay?: (
    id: number,
    overlayOrUpdater:
      | OverlayBannerConfig
      | ((prev: OverlayBannerConfig) => OverlayBannerConfig)
  ) => void;
  onUpdateLShape?: (
    id: number,
    lShapeOrUpdater: LShapeConfig | ((prev: LShapeConfig) => LShapeConfig)
  ) => void;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  onTogglePlay?: (id: number) => void;
  onSkipNext?: (id: number) => void;
  onImportVideos?: (channelId: number, files: FileList | File[]) => void;
  onToggleStudioPreviewMute?: (id: number) => void;
  onSaveChannel?: () => void;
  initialLayer?: StudioActiveLayer;
  onDraftDirtyChange?: (dirty: boolean) => void;
  commitSaveRef?: React.MutableRefObject<(() => void) | null>;
}

const TIME_PRESETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

const getInitialBottomOverlay = (ch: TVChannel): OverlayBannerConfig =>
  ch.bottomOverlay || {
    enabled: true,
    keyEnabled: true,
    position: 'bottom',
    x: 0,
    y: 880,
    width: 1920,
    height: 200,
    opacity: 1,
    fitMode: 'fill',
    backgroundColor: '#06080e',
    backgroundStyle: 'dark_glass',
    loopMode: 'playlist',
    autoPlayNext: true,
    transition: 'fade',
    showTickerInside: false,
    playlist: [],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
    borderGlow: true,
  };

const getInitialTopOverlay = (ch: TVChannel): OverlayBannerConfig =>
  ch.topOverlay || {
    enabled: false,
    keyEnabled: true,
    position: 'top',
    x: 0,
    y: 0,
    width: 1920,
    height: 90,
    opacity: 1,
    fitMode: 'fill',
    backgroundColor: '#05070d',
    backgroundStyle: 'dark_glass',
    loopMode: 'playlist',
    autoPlayNext: true,
    transition: 'fade',
    showTickerInside: false,
    playlist: [],
    currentIndex: 0,
    currentTime: 0,
    isPlaying: true,
    borderGlow: true,
  };

const getInitialLShape = (ch: TVChannel): LShapeConfig =>
  ch.lShape || buildDefaultLShape(ch.id, ch.colorAccent, 'left');

export const CGGraphicsEditor: React.FC<CGGraphicsEditorProps> = ({
  channel,
  onUpdateGraphics,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUpdateLShape,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  onTogglePlay,
  onSkipNext,
  onImportVideos,
  onToggleStudioPreviewMute,
  onSaveChannel,
  initialLayer,
  onDraftDirtyChange,
  commitSaveRef,
}) => {
  // Staged Draft Mode: All CG edits, drags, resizes, toggles & reorders stay inside CG Studio
  // and ONLY affect live Studio PGM OUT / 2nd Display after the user clicks "Save CG".
  const [draftGraphics, setDraftGraphics] = useState<BottomScrollConfig>(() => channel.graphics);
  const [draftBottomOverlay, setDraftBottomOverlay] = useState<OverlayBannerConfig>(() =>
    getInitialBottomOverlay(channel)
  );
  const [draftTopOverlay, setDraftTopOverlay] = useState<OverlayBannerConfig>(() =>
    getInitialTopOverlay(channel)
  );
  const [draftLShape, setDraftLShape] = useState<LShapeConfig>(() => getInitialLShape(channel));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDraftGraphics(channel.graphics);
    setDraftBottomOverlay(getInitialBottomOverlay(channel));
    setDraftTopOverlay(getInitialTopOverlay(channel));
    setDraftLShape(getInitialLShape(channel));
    setHasUnsavedChanges(false);
    onDraftDirtyChange?.(false);
  }, [channel.id]);

  const markDirty = () => {
    setHasUnsavedChanges(true);
    onDraftDirtyChange?.(true);
  };

  const g = draftGraphics;
  const bottomOverlay = draftBottomOverlay;
  const topOverlay = draftTopOverlay;
  const lShape = draftLShape;

  const draftChannel: TVChannel = {
    ...channel,
    graphics: draftGraphics,
    bottomOverlay: draftBottomOverlay,
    topOverlay: draftTopOverlay,
    lShape: draftLShape,
  };

  const [activeLayer, setActiveLayer] = useState<StudioActiveLayer>(initialLayer || 'logos');
  const [tickerMapLayer, setTickerMapLayer] = useState<'bottom_scroll' | 'top_ticker'>('bottom_scroll');
  const [selectedLogoTab, setSelectedLogoTab] = useState<'channel' | 'sponsor1' | 'sponsor2'>('channel');
  const [nudgeDelta, setNudgeDelta] = useState<1 | 10 | 50>(10);
  const [centerExpanded, setCenterExpanded] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  // Overlay file & folder input refs
  const overlayFileInputRef = useRef<HTMLInputElement>(null);
  const overlayFolderInputRef = useRef<HTMLInputElement>(null);
  const tickerFileInputRef = useRef<HTMLInputElement>(null);
  const tickerFolderInputRef = useRef<HTMLInputElement>(null);
  const logoFolderInputRef = useRef<HTMLInputElement>(null);

  // New crawler item state
  const [newScrollText, setNewScrollText] = useState('');
  const [newScrollPriority, setNewScrollPriority] = useState<'normal' | 'flash' | 'breaking'>('normal');
  const [editingTickerIdx, setEditingTickerIdx] = useState<number | null>(null);
  const [editTickerText, setEditTickerText] = useState('');
  const [editTickerPriority, setEditTickerPriority] = useState<'normal' | 'flash' | 'breaking'>('normal');

  // Overlay inline edit state
  const [editingOverlayItemId, setEditingOverlayItemId] = useState<string | null>(null);
  const [editOverlayTitle, setEditOverlayTitle] = useState('');
  const [editOverlayDuration, setEditOverlayDuration] = useState(10);
  const [editOverlayFit, setEditOverlayFit] = useState<OverlayFitMode>('fill');

  // File upload refs for Logos
  const channelFileInputRef = useRef<HTMLInputElement>(null);
  const sponsor1FileInputRef = useRef<HTMLInputElement>(null);
  const sponsor2FileInputRef = useRef<HTMLInputElement>(null);

  const updateBottomOverlay = (partial: Partial<OverlayBannerConfig>) => {
    markDirty();
    setDraftBottomOverlay((prev) => ({
      ...prev,
      ...partial,
    }));
  };

  const updateTopOverlay = (partial: Partial<OverlayBannerConfig>) => {
    markDirty();
    setDraftTopOverlay((prev) => ({
      ...prev,
      ...partial,
    }));
  };

  const updateLShape = (
    partialOrUpdater: Partial<LShapeConfig> | ((prev: LShapeConfig) => LShapeConfig)
  ) => {
    markDirty();
    setDraftLShape((prev) =>
      typeof partialOrUpdater === 'function'
        ? partialOrUpdater(prev)
        : { ...prev, ...partialOrUpdater }
    );
  };

  const update = (partial: Partial<BottomScrollConfig>) => {
    markDirty();
    setDraftGraphics((prev) => ({
      ...prev,
      ...partial,
    }));
  };

  const handleCommitSaveCg = () => {
    onUpdateGraphics(channel.id, draftGraphics);
    if (onUpdateBottomOverlay) {
      onUpdateBottomOverlay(channel.id, draftBottomOverlay);
    }
    if (onUpdateTopOverlay) {
      onUpdateTopOverlay(channel.id, draftTopOverlay);
    }
    if (onUpdateLShape) {
      onUpdateLShape(channel.id, draftLShape);
    }
    setHasUnsavedChanges(false);
    onDraftDirtyChange?.(false);
    setSavedToast(true);
    setTimeout(() => {
      if (isMountedRef.current) setSavedToast(false);
    }, 2500);
    setTimeout(() => {
      if (onSaveChannel) onSaveChannel();
    }, 60);
  };

  if (commitSaveRef) {
    commitSaveRef.current = handleCommitSaveCg;
  }

  // Upload image/video/SWF (PNG, JPG, GIF, SWF, MP4, MOV, MKV, MPG, VOB, AVI, TS, FLV, WMV) to Overlay Playlist with Auto Video/SWF Duration
  const handleOverlayMediaUpload = (files: FileList | File[] | null, target: 'bottom' | 'top') => {
    if (!files || files.length === 0) return;
    const fileArr = filterFolderCgMediaFiles(files);
    if (fileArr.length === 0) return;

    const targetConfig = target === 'bottom' ? bottomOverlay : topOverlay;
    const batchTs = Date.now();

    const createdItems: OverlayPlaylistItem[] = fileArr.map((file, idx) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isSwf = isSwfFile(file);
      const isVid = !isSwf && isVideoOrSwfFile(file);
      const url = URL.createObjectURL(file);
      const baseTitle = file.name.replace(/\.[^/.]+$/, '').toUpperCase();
      const itemId = `${target}-ov-${batchTs}-${idx}`;
      const fixedSec = targetConfig.imageFixedDurationSec || 10;
      const folderName = extractFolderName(file);

      return {
        id: itemId,
        title: baseTitle,
        fileName: file.name,
        folderName,
        enabled: true,
        mediaType: isSwf ? 'swf' : isVid ? 'video' : 'image',
        url,
        file,
        duration: isSwf || isVid ? 30 : fixedSec,
        autoVideoDuration: isSwf || isVid,
        fitMode: 'fill',
        badgeText: isSwf
          ? 'FLASH SWF HD'
          : isVid
          ? 'VIDEO HD'
          : ext === 'gif'
          ? 'ANIMATED GIF'
          : 'GRAPHIC HD',
      };
    });

    markDirty();
    if (target === 'bottom') {
      setDraftBottomOverlay((prev) => {
        const existing = (prev.playlist || []).filter(
          (it) => it.id !== 'bot-1' && it.id !== 'bot-2' && !String(it.url || '').startsWith('data:image/svg+xml')
        );
        return {
          ...prev,
          enabled: true,
          keyEnabled: true,
          isPlaying: true,
          currentIndex: existing.length,
          currentTime: 0,
          playlist: [...existing, ...createdItems],
        };
      });
    } else {
      setDraftTopOverlay((prev) => {
        const existing = (prev.playlist || []).filter(
          (it) => !String(it.url || '').startsWith('data:image/svg+xml')
        );
        return {
          ...prev,
          enabled: true,
          keyEnabled: true,
          isPlaying: true,
          currentIndex: existing.length,
          currentTime: 0,
          playlist: [...existing, ...createdItems],
        };
      });
    }

    // Probe real video & SWF durations and upload all files (including PNG/JPG/GIF) to backend & offline vault
    createdItems.forEach((item) => {
      if (!item.file) return;
      probeMediaFileDuration(item.file, item.url).then(({ duration, isSwf, serverUrl, vaultId, folderName, transcoded }) => {
        if (isSwf && (serverUrl || item.url)) {
          swfEngine.preloadSwf(serverUrl || item.url, item.fileName || item.title);
        }
        if (!isMountedRef.current) return;
        const applyPatch = (prev: OverlayBannerConfig): OverlayBannerConfig => ({
          ...prev,
          enabled: true,
          keyEnabled: true,
          isPlaying: true,
          playlist: (prev.playlist || []).map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  duration:
                    it.mediaType === 'video' || it.mediaType === 'swf'
                      ? duration
                      : it.duration,
                  url: serverUrl || it.url,
                  serverUrl: serverUrl || (it as any).serverUrl,
                  transcoded: Boolean(transcoded),
                  vaultId: vaultId || it.vaultId,
                  folderName: folderName || it.folderName,
                }
              : it
          ),
        });
        if (target === 'bottom') {
          setDraftBottomOverlay(applyPatch);
        } else {
          setDraftTopOverlay(applyPatch);
        }
      });
    });
  };

  const handleAddGeneratedBanner = (target: 'bottom' | 'top') => {
    const targetConfig = target === 'bottom' ? bottomOverlay : topOverlay;
    const updater = target === 'bottom' ? updateBottomOverlay : updateTopOverlay;
    const count = (targetConfig.playlist?.length || 0) + 1;

    const newItem: OverlayPlaylistItem = {
      id: `${target}-gen-${Date.now()}`,
      title: `PROMO BANNER #${count}`,
      enabled: true,
      mediaType: 'image',
      url: create1920x200BannerSvg(
        channel.id,
        channel.colorAccent,
        `CH 0${channel.id} SPECIAL BROADCAST GRAPHIC #${count}`,
        '1920x200 FULL HD ANAMORPHIC GRAPHIC OVERLAY • LIVE SATELLITE PLAYOUT',
        'ON AIR PROMO'
      ),
      duration: 10,
      fitMode: 'fill',
      headline: `CH 0${channel.id} SPECIAL BROADCAST GRAPHIC #${count}`,
      subline: '1920x200 FULL HD ANAMORPHIC GRAPHIC OVERLAY • LIVE SATELLITE PLAYOUT',
      badgeText: 'ON AIR PROMO',
    };

    updater({
      enabled: true,
      keyEnabled: true,
      isPlaying: true,
      playlist: [...(targetConfig.playlist || []), newItem],
    });
  };

  // Ensure logo objects always exist
  const getChannelLogo = (): LogoItemConfig =>
    g.channelLogo || {
      enabled: g.logoEnabled ?? true,
      url: g.customLogoUrl || createChannelLogoSvg(channel.id, channel.colorAccent),
      label: `CH 0${channel.id} Main Logo`,
      position: g.logoPosition || 'top-right',
      offsetX: 0,
      offsetY: 0,
      size: g.logoSize || 130,
      opacity: g.logoOpacity ?? 0.95,
      isGif: false,
    };

  const getSponsor1 = (): LogoItemConfig =>
    g.sponsorLogo1 ||
    g.sponsor1Logo || {
      enabled: true,
      url: createSponsor1LogoSvg(channel.id),
      label: 'Sponsor 1 Logo',
      position: 'top-left',
      offsetX: 0,
      offsetY: 0,
      size: 115,
      opacity: 0.92,
      isGif: false,
    };

  const getSponsor2 = (): LogoItemConfig =>
    g.sponsorLogo2 ||
    g.sponsor2Logo || {
      enabled: false,
      url: createSponsor2LogoSvg(channel.id),
      label: 'Sponsor 2 Logo',
      position: 'bottom-right',
      offsetX: 0,
      offsetY: 0,
      size: 105,
      opacity: 0.9,
      isGif: false,
    };

  const updateLogo = (
    type: 'channel' | 'sponsor1' | 'sponsor2',
    partialOrUpdater: Partial<LogoItemConfig> | ((prevLogo: LogoItemConfig) => LogoItemConfig)
  ) => {
    markDirty();
    setDraftGraphics((prevG) => {
      const baseG = prevG;
      if (type === 'channel') {
        const baseLogo: LogoItemConfig = baseG.channelLogo || getChannelLogo();
        const updated =
          typeof partialOrUpdater === 'function'
            ? partialOrUpdater(baseLogo)
            : { ...baseLogo, ...partialOrUpdater };
        return {
          ...baseG,
          channelLogo: updated,
          logoEnabled: updated.enabled,
          logoPosition: updated.position,
          logoSize: updated.size,
          logoOpacity: updated.opacity,
        };
      } else if (type === 'sponsor1') {
        const baseLogo: LogoItemConfig =
          baseG.sponsorLogo1 || baseG.sponsor1Logo || getSponsor1();
        const updated =
          typeof partialOrUpdater === 'function'
            ? partialOrUpdater(baseLogo)
            : { ...baseLogo, ...partialOrUpdater };
        return {
          ...baseG,
          sponsorLogo1: updated,
          sponsor1Logo: updated,
        };
      } else {
        const baseLogo: LogoItemConfig =
          baseG.sponsorLogo2 || baseG.sponsor2Logo || getSponsor2();
        const updated =
          typeof partialOrUpdater === 'function'
            ? partialOrUpdater(baseLogo)
            : { ...baseLogo, ...partialOrUpdater };
        return {
          ...baseG,
          sponsorLogo2: updated,
          sponsor2Logo: updated,
        };
      }
    });
  };

  // Handle Multi-File & Folder Upload for Channel Logo, Sponsor 1, and Sponsor 2
  const handleAddLogoMediaFiles = (
    type: 'channel' | 'sponsor1' | 'sponsor2',
    files: FileList | File[] | null
  ) => {
    if (!files || files.length === 0) return;
    const validFiles = filterFolderCgMediaFiles(files);
    if (validFiles.length === 0) return;

    const batchTs = Date.now();
    const createdItems: Array<{ item: LogoPlaylistItem; file: File }> = validFiles.map(
      (file, idx) => {
        const isGif = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif';
        const isSwf = isSwfFile(file);
        const isVid = !isSwf && isVideoFile(file);
        const objectUrl = URL.createObjectURL(file);
        const folderName = extractFolderName(file);
        const item: LogoPlaylistItem = {
          id: `logo-${type}-${batchTs}-${idx}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          fileName: file.name,
          folderName,
          url: objectUrl,
          isSwf,
          isGif,
          isVideo: isVid,
          duration: isSwf || isVid ? 15 : 10,
          enabled: true,
        };
        return { item, file };
      }
    );

    const first = createdItems[0].item;
    updateLogo(type, (prevLogo) => {
      const existingList = (prevLogo.playlist || []).filter(
        (it) => !String(it.url || '').startsWith('data:image/svg+xml')
      );
      const nextList = [...existingList, ...createdItems.map((c) => c.item)];
      return {
        ...prevLogo,
        url: first.url,
        label: first.fileName || first.title,
        fileName: first.fileName,
        folderName: first.folderName,
        isGif: first.isGif,
        isSwf: first.isSwf,
        duration: first.duration,
        enabled: true,
        currentIndex: existingList.length,
        playlist: nextList,
      };
    });

    // Persist every logo file to Backend (/uploads/...) AND Offline IndexedDB Vault
    createdItems.forEach(({ item, file }) => {
      probeMediaFileDuration(file, item.url).then(
        ({ duration, serverUrl, vaultId, folderName }) => {
          const finalUrl = serverUrl || item.url;
          const finalDur = item.isSwf || item.isVideo ? duration : 10;
          updateLogo(type, (prevLogo) => {
            const updatedList = (prevLogo.playlist || []).map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    url: finalUrl,
                    vaultId: vaultId || it.vaultId,
                    folderName: folderName || it.folderName,
                    duration: finalDur,
                  }
                : it
            );
            const isPrimary =
              prevLogo.url === item.url || prevLogo.label === item.fileName;
            return {
              ...prevLogo,
              url: isPrimary ? finalUrl : prevLogo.url,
              vaultId: isPrimary ? vaultId || prevLogo.vaultId : prevLogo.vaultId,
              folderName: isPrimary
                ? folderName || prevLogo.folderName
                : prevLogo.folderName,
              duration: isPrimary ? finalDur : prevLogo.duration,
              playlist: updatedList,
            };
          });
        }
      );
    });
  };

  // News Ticker Actions
  const handleAddTickerItem = () => {
    if (!newScrollText.trim()) return;
    const newItem: TickerScrollItem = {
      id: `scroll-${Date.now()}`,
      text: newScrollText.trim(),
      enabled: true,
      priority: newScrollPriority,
    };
    update({ tickerItems: [...g.tickerItems, newItem] });
    setNewScrollText('');
  };

  const handleToggleTickerItem = (idx: number) => {
    const updated = [...g.tickerItems];
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
    update({ tickerItems: updated });
  };

  const handleDeleteTickerItem = (idx: number) => {
    const updated = g.tickerItems.filter((_, i) => i !== idx);
    update({ tickerItems: updated });
  };

  const handleMoveTicker = (idx: number, dir: 'up' | 'down') => {
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === g.tickerItems.length - 1) return;
    const target = dir === 'up' ? idx - 1 : idx + 1;
    const updated = [...g.tickerItems];
    const temp = updated[idx];
    updated[idx] = updated[target];
    updated[target] = temp;
    update({ tickerItems: updated });
  };

  const startEditTicker = (idx: number) => {
    const item = g.tickerItems[idx];
    setEditingTickerIdx(idx);
    setEditTickerText(item.text);
    setEditTickerPriority(item.priority || 'normal');
  };

  const saveEditTicker = (idx: number) => {
    if (!editTickerText.trim()) return;
    const updated = [...g.tickerItems];
    updated[idx] = {
      ...updated[idx],
      text: editTickerText.trim(),
      priority: editTickerPriority,
    };
    update({ tickerItems: updated });
    setEditingTickerIdx(null);
  };

  const channelLogo = getChannelLogo();
  const sponsor1 = getSponsor1();
  const sponsor2 = getSponsor2();

  const activeOverlayConfig = activeLayer === 'top_overlay' ? topOverlay : bottomOverlay;
  const activeOverlayUpdater = activeLayer === 'top_overlay' ? updateTopOverlay : updateBottomOverlay;
  const activeOverlayTarget: 'bottom' | 'top' = activeLayer === 'top_overlay' ? 'top' : 'bottom';

  return (
    <div className="p-2.5 bg-[#050608] text-white min-h-[calc(100vh-130px)] select-none font-mono">
      {/* Top Studio Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 bg-zinc-950 px-3 py-2 rounded-lg border border-zinc-800 shadow-md">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs text-white shadow"
            style={{ backgroundColor: channel.colorAccent }}
          >
            0{channel.id}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-black tracking-wider text-white uppercase">
                ASHOKA MSO PLAYLIST • TOP &amp; BOTTOM CG GRAPHICS STUDIO
              </h2>
              <span className="text-[10px] bg-red-950/90 text-red-300 px-2 py-0.5 rounded border border-red-800 font-bold">
                VIDEOS: FULL DURATION • IMAGES: FIXED SECONDS
              </span>
            </div>
            <p className="text-[10px] text-zinc-400">
              Fix 8-side logo place &amp; 6 sizes on Left • Watch &amp; drag Live Player in Center • Manage Top &amp; Bottom Overlays, Logos &amp; Ticker on Right
            </p>
          </div>
        </div>

        {/* Quick Mode Switcher Pills + Expand Center Player */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            onClick={() => setActiveLayer('bottom_overlay')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'bottom_overlay'
                ? 'bg-red-600 text-white border-red-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>▾ Bottom Overlay (1920×200)</span>
          </button>

          <button
            onClick={() => setActiveLayer('top_overlay')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'top_overlay'
                ? 'bg-amber-600 text-white border-amber-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>▴ Top Overlay Banner</span>
          </button>

          <button
            onClick={() => setActiveLayer('logos')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'logos'
                ? 'bg-blue-600 text-white border-blue-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Logos (8-Side &amp; 6 Sizes)</span>
          </button>

          <button
            onClick={() => setActiveLayer('crawler')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'crawler'
                ? 'bg-cyan-600 text-white border-cyan-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Ticker Top &amp; Bottom</span>
          </button>

          <button
            onClick={() => setActiveLayer('lshape')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'lshape'
                ? 'bg-purple-600 text-white border-purple-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Layout className="w-3.5 h-3.5" />
            <span>◱ L-Shape CG</span>
          </button>

          <button
            onClick={() => setActiveLayer('clock')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              activeLayer === 'clock'
                ? 'bg-amber-500 text-black border-amber-300 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>🕒 Clock CG</span>
          </button>

          <button
            onClick={() => setCenterExpanded(!centerExpanded)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border transition ${
              centerExpanded
                ? 'bg-emerald-600 text-white border-emerald-400'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
            }`}
            title="Toggle Larger Center HD Player"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>{centerExpanded ? 'Standard 3-Col' : 'Wide HD Center'}</span>
          </button>

          {hasUnsavedChanges && (
            <span className="px-2.5 py-1 rounded bg-amber-500/20 border border-amber-400 text-amber-300 text-[10px] font-black uppercase animate-pulse">
              UNSAVED DRAFT • PREVIEW ONLY
            </span>
          )}

          <button
            onClick={handleCommitSaveCg}
            className={`flex items-center gap-1 px-3 py-1.5 rounded font-black border shadow cursor-pointer transition ${
              hasUnsavedChanges
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-200 ring-2 ring-emerald-400/50'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savedToast ? '✓ Saved & Applied Live!' : 'Save CG (Apply Live)'}</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 3-COLUMN BROADCAST GRAPHICS WORKSTATION:                              */}
      {/* COL 1 (LEFT): Placement, Size, Fit, Left/Right Side & Corner Controls */}
      {/* COL 2 (CENTER): Live 1080p HD Broadcast Player + Interactive Map      */}
      {/* COL 3 (RIGHT): Playlist, Media Upload, Tick, Edit, Delete & 5s-60s    */}
      {/* ===================================================================== */}
      <div
        className={`grid grid-cols-1 gap-3 items-start ${
          centerExpanded
            ? 'xl:grid-cols-12'
            : 'xl:grid-cols-12'
        }`}
      >
        {/* ===================================================== */}
        {/* LEFT COLUMN: ALL POSITION, SIZE, SIDE & LAYER OPTIONS */}
        {/* ===================================================== */}
        <div className={`${centerExpanded ? 'xl:col-span-3' : 'xl:col-span-3'} w-full`}>
          <CGLeftControlPanel
            channel={draftChannel}
            activeLayer={activeLayer}
            onSelectLayer={setActiveLayer}
            selectedLogoTab={selectedLogoTab}
            onSelectLogoTab={setSelectedLogoTab}
            bottomOverlay={bottomOverlay}
            topOverlay={topOverlay}
            lShape={lShape}
            channelLogo={channelLogo}
            sponsor1={sponsor1}
            sponsor2={sponsor2}
            nudgeDelta={nudgeDelta}
            onChangeNudgeDelta={setNudgeDelta}
            onUpdateGraphics={update}
            onUpdateBottomOverlay={updateBottomOverlay}
            onUpdateTopOverlay={updateTopOverlay}
            onUpdateLShape={updateLShape}
            onUpdateLogo={updateLogo}
          />
        </div>

        {/* ===================================================== */}
        {/* CENTER COLUMN: LIVE 1080p HD BROADCAST PLAYER & MAP   */}
        {/* ===================================================== */}
        <div className={`${centerExpanded ? 'xl:col-span-6' : 'xl:col-span-5'} w-full xl:sticky xl:top-2`}>
          <CGStudioPositionMap
            channel={draftChannel}
            bottomOverlay={bottomOverlay}
            topOverlay={topOverlay}
            lShape={lShape}
            channelLogo={channelLogo}
            sponsor1={sponsor1}
            sponsor2={sponsor2}
            activeLayer={activeLayer === 'crawler' ? tickerMapLayer : activeLayer}
            onSelectLayer={(layer) => {
              if (layer === 'bottom_scroll' || layer === 'ticker') {
                setTickerMapLayer('bottom_scroll');
                setActiveLayer('crawler');
              } else if (layer === 'top_ticker') {
                setTickerMapLayer('top_ticker');
                setActiveLayer('crawler');
              } else {
                setActiveLayer(layer);
              }
            }}
            onUpdateGraphics={update}
            onUpdateBottomOverlay={updateBottomOverlay}
            onUpdateTopOverlay={updateTopOverlay}
            onUpdateLShape={updateLShape}
            onUpdateLogo={updateLogo}
            activeVideoElement={activeVideoElement}
            activeOverlayVideoElement={activeOverlayVideoElement}
            activeTopOverlayVideoElement={activeTopOverlayVideoElement}
            activeLShapeVideoElement={activeLShapeVideoElement}
            onTogglePlay={onTogglePlay}
            onSkipNext={onSkipNext}
            onImportVideos={onImportVideos}
            onToggleStudioPreviewMute={onToggleStudioPreviewMute}
          />
        </div>

        {/* ===================================================== */}
        {/* RIGHT COLUMN: PLAYLISTS, MEDIA UPLOAD, TICK, EDIT/DEL */}
        {/* ===================================================== */}
        <div className={`${centerExpanded ? 'xl:col-span-3' : 'xl:col-span-4'} w-full`}>
          {/* 2. TICKER TOP & BOTTOM STUDIO PANEL */}
          {activeLayer === 'crawler' && (
            <TickerTopBottomStudio
              channel={draftChannel}
              onUpdateGraphics={update}
              onSaveChannel={handleCommitSaveCg}
              onSelectTickerLayer={(tLayer) => {
                setTickerMapLayer(tLayer);
                setActiveLayer('crawler');
              }}
              bottomOverlay={bottomOverlay}
              topOverlay={topOverlay}
              onUpdateBottomOverlay={updateBottomOverlay}
              onUpdateTopOverlay={updateTopOverlay}
              onUploadOverlayMedia={handleOverlayMediaUpload}
            />
          )}

          {/* 3. STATION & SPONSOR LOGOS RIGHT STUDIO PANEL */}
          {activeLayer === 'logos' && (
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-lg space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-black text-white uppercase">
                    STATION & SPONSOR LOGOS (PNG / JPG / GIF)
                  </h3>
                </div>
              </div>

              {/* Logo Slot Switcher */}
              <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                <button
                  onClick={() => setSelectedLogoTab('channel')}
                  className={`py-2 rounded font-bold border transition ${
                    selectedLogoTab === 'channel'
                      ? 'bg-blue-600 text-white border-blue-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  Station Logo {channelLogo.enabled ? '●' : '○'}
                </button>
                <button
                  onClick={() => setSelectedLogoTab('sponsor1')}
                  className={`py-2 rounded font-bold border transition ${
                    selectedLogoTab === 'sponsor1'
                      ? 'bg-indigo-600 text-white border-indigo-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  Sponsor 1 {sponsor1.enabled ? '●' : '○'}
                </button>
                <button
                  onClick={() => setSelectedLogoTab('sponsor2')}
                  className={`py-2 rounded font-bold border transition ${
                    selectedLogoTab === 'sponsor2'
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                  }`}
                >
                  Sponsor 2 {sponsor2.enabled ? '●' : '○'}
                </button>
              </div>

              {/* Active Logo Upload & Preview Card */}
              {(() => {
                const activeLogo =
                  selectedLogoTab === 'channel'
                    ? channelLogo
                    : selectedLogoTab === 'sponsor1'
                    ? sponsor1
                    : sponsor2;
                const inputRef =
                  selectedLogoTab === 'channel'
                    ? channelFileInputRef
                    : selectedLogoTab === 'sponsor1'
                    ? sponsor1FileInputRef
                    : sponsor2FileInputRef;

                return (
                  <div className="bg-black/60 p-3 rounded-lg border border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-white uppercase">
                        {activeLogo.label || selectedLogoTab.toUpperCase()}
                      </span>
                      <button
                        onClick={() =>
                          updateLogo(selectedLogoTab, { enabled: !activeLogo.enabled })
                        }
                        className={`px-3 py-1 rounded text-[10px] font-black transition ${
                          activeLogo.enabled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-900 text-zinc-500 border border-zinc-700'
                        }`}
                      >
                        {activeLogo.enabled ? '● ON AIR' : 'DISABLED'}
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-20 h-20 rounded-lg bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:8px_8px] bg-zinc-950 border border-zinc-700 flex flex-col items-center justify-center p-1 shrink-0 text-center overflow-hidden relative">
                        {activeLogo.isSwf || swfEngine.isSwfUrl(activeLogo.url, activeLogo.label) ? (
                          <>
                            <SwfLogoTransparentPreview
                              url={activeLogo.url}
                              label={activeLogo.label}
                            />
                            <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded bg-emerald-600/90 text-white text-[8px] font-black">
                              SWF ALPHA
                            </span>
                          </>
                        ) : isVideoFile(activeLogo.label || '') ? (
                          <div className="flex flex-col items-center justify-center">
                            <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-black">
                              VIDEO LOGO
                            </span>
                            <span className="text-[9px] text-emerald-300 font-mono mt-1 font-bold">
                              {activeLogo.duration || 15}s Full
                            </span>
                          </div>
                        ) : activeLogo.url && activeLogo.url.trim() !== '' ? (
                          <img
                            src={activeLogo.url}
                            alt={activeLogo.label}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-[10px] text-zinc-500">NO LOGO</span>
                        )}
                      </div>

                      <div className="flex-1 space-y-1.5">
                        <input
                          ref={inputRef}
                          type="file"
                          multiple
                          accept={ALL_CG_MEDIA_ACCEPT}
                          className="hidden"
                          onChange={(e) => {
                            const selected = e.target.files ? Array.from(e.target.files) : [];
                            e.target.value = '';
                            handleAddLogoMediaFiles(selectedLogoTab, selected);
                          }}
                        />
                        <input
                          ref={(el) => {
                            logoFolderInputRef.current = el;
                            if (el) {
                              el.setAttribute('webkitdirectory', '');
                              el.setAttribute('directory', '');
                            }
                          }}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const selected = e.target.files ? Array.from(e.target.files) : [];
                            e.target.value = '';
                            handleAddLogoMediaFiles(selectedLogoTab, selected);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => inputRef.current?.click()}
                          className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-bold flex items-center justify-center gap-1.5 shadow cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>+ Add Logo File(s) (SWF / Video / PNG / GIF)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => logoFolderInputRef.current?.click()}
                          className="w-full py-1.5 px-3 bg-purple-600 hover:bg-purple-500 text-white rounded text-[11px] font-bold flex items-center justify-center gap-1.5 shadow cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>+ Add Logo Folder (SWF / Video / PNG)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLogo(selectedLogoTab, {
                              isSwf: false,
                              isGif: false,
                              playlist: [],
                              label:
                                selectedLogoTab === 'channel'
                                  ? `CH 0${channel.id} Main Logo`
                                  : selectedLogoTab === 'sponsor1'
                                  ? 'Sponsor 1 Logo'
                                  : 'Sponsor 2 Logo',
                              url:
                                selectedLogoTab === 'channel'
                                  ? createChannelLogoSvg(channel.id, channel.colorAccent)
                                  : selectedLogoTab === 'sponsor1'
                                  ? createSponsor1LogoSvg(channel.id)
                                  : createSponsor2LogoSvg(channel.id),
                            })
                          }
                          className="w-full py-1 px-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-700 text-[10px] font-bold flex items-center justify-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset Default Broadcast Bug</span>
                        </button>
                      </div>
                    </div>

                    {/* Logo Files & Folders Playlist for Selected Logo Slot */}
                    {Array.isArray(activeLogo.playlist) && activeLogo.playlist.length > 0 && (
                      <div className="bg-black/60 border border-zinc-800 rounded-lg p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-emerald-400 uppercase">
                            Loaded Files &amp; Folders ({activeLogo.playlist.length})
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateLogo(selectedLogoTab, {
                                playlist: [],
                              })
                            }
                            className="text-[9px] text-red-400 hover:text-red-300 font-bold cursor-pointer"
                          >
                            Clear All
                          </button>
                        </div>
                        <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                          {Array.from(
                            new Set(
                              activeLogo.playlist
                                .map((it) => it.folderName)
                                .filter((f): f is string => Boolean(f))
                            )
                          ).map((folderName) => {
                            const folderCount = (activeLogo.playlist || []).filter(
                              (it) => it.folderName === folderName
                            ).length;
                            return (
                              <div
                                key={`folder-${folderName}`}
                                className="flex items-center justify-between px-2 py-1 rounded bg-purple-950/50 border border-purple-500/40 text-[10px]"
                              >
                                <span className="font-bold text-purple-200 truncate">
                                  📁 {folderName} ({folderCount} files)
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateLogo(selectedLogoTab, (prev) => {
                                      const rem = (prev.playlist || []).filter(
                                        (it) => it.folderName !== folderName
                                      );
                                      const nextActive = rem[0];
                                      return {
                                        ...prev,
                                        playlist: rem,
                                        url: nextActive ? nextActive.url : prev.url,
                                        label: nextActive
                                          ? nextActive.fileName || nextActive.title
                                          : prev.label,
                                        isSwf: nextActive ? Boolean(nextActive.isSwf) : prev.isSwf,
                                      };
                                    })
                                  }
                                  className="text-red-300 hover:text-red-200 text-[9px] font-bold ml-2 shrink-0 cursor-pointer"
                                >
                                  Remove Folder
                                </button>
                              </div>
                            );
                          })}

                          {activeLogo.playlist.map((item, idx) => {
                            const isActiveItem = activeLogo.url === item.url;
                            const isTicked = item.enabled !== false;
                            return (
                              <div
                                key={item.id}
                                className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded border text-[10px] ${
                                  isActiveItem
                                    ? 'bg-blue-950/50 border-blue-500 text-white'
                                    : 'bg-zinc-900/80 border-zinc-800 text-zinc-300'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateLogo(selectedLogoTab, (prev) => ({
                                      ...prev,
                                      playlist: (prev.playlist || []).map((it, i) =>
                                        i === idx ? { ...it, enabled: !isTicked } : it
                                      ),
                                    }))
                                  }
                                  className={isTicked ? 'text-emerald-400' : 'text-zinc-600'}
                                >
                                  {isTicked ? (
                                    <CheckSquare className="w-3.5 h-3.5" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <div
                                  onClick={() =>
                                    updateLogo(selectedLogoTab, {
                                      url: item.url,
                                      label: item.fileName || item.title,
                                      fileName: item.fileName,
                                      folderName: item.folderName,
                                      isSwf: Boolean(item.isSwf),
                                      isGif: Boolean(item.isGif),
                                      duration: item.duration || 10,
                                      enabled: true,
                                      currentIndex: idx,
                                    })
                                  }
                                  className="flex-1 min-w-0 cursor-pointer truncate"
                                >
                                  <span className="font-bold">{idx + 1}. {item.fileName || item.title}</span>
                                  {item.folderName && (
                                    <span className="ml-1.5 px-1 py-0.2 rounded bg-purple-900/70 text-purple-200 text-[8px]">
                                      📁 {item.folderName}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-zinc-800 text-amber-300 shrink-0">
                                  {item.isSwf ? 'SWF' : item.isVideo ? 'VIDEO' : 'IMG'} • {item.duration || 10}s
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateLogo(selectedLogoTab, (prev) => {
                                      const rem = (prev.playlist || []).filter((_, i) => i !== idx);
                                      const nextActive = rem[0];
                                      return {
                                        ...prev,
                                        playlist: rem,
                                        url: nextActive ? nextActive.url : prev.url,
                                        label: nextActive
                                          ? nextActive.fileName || nextActive.title
                                          : prev.label,
                                        isSwf: nextActive ? Boolean(nextActive.isSwf) : prev.isSwf,
                                      };
                                    })
                                  }
                                  className="text-zinc-400 hover:text-red-400 p-0.5 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 8-Side Quick Fix & 6 Logo Sizes */}
                    <div>
                      <span className="text-[10px] text-zinc-400 font-bold block mb-1 uppercase">
                        8-SIDE PLACEMENT FIX:
                      </span>
                      <div className="grid grid-cols-4 gap-1 text-[9px] mb-2">
                        {(
                          [
                            ['top-left', '↖ Top-L'],
                            ['top-center', '↑ Top-C'],
                            ['top-right', '↗ Top-R'],
                            ['middle-left', '← Mid-L'],
                            ['middle-right', '→ Mid-R'],
                            ['bottom-left', '↙ Bot-L'],
                            ['bottom-center', '↓ Bot-C'],
                            ['bottom-right', '↘ Bot-R'],
                          ] as [LogoCornerPosition, string][]
                        ).map(([pos, label]) => (
                          <button
                            key={pos}
                            onClick={() =>
                              updateLogo(selectedLogoTab, {
                                position: pos,
                                offsetX: 0,
                                offsetY: 0,
                              })
                            }
                            className={`py-1.5 rounded font-bold border transition ${
                              activeLogo.position === pos
                                ? 'bg-blue-600 text-white border-blue-400'
                                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-zinc-300 font-bold uppercase">
                          RESIZE LOGO / SPONSOR (UP TO FULL SCREEN 1920×1080):
                        </span>
                        <span className="text-[10px] font-black text-emerald-400">
                          {activeLogo.fullScreen
                            ? 'FULL SCREEN (1920×1080)'
                            : `${activeLogo.customWidth || activeLogo.size || 120}×${activeLogo.customHeight || 'Auto'}px`}
                        </span>
                      </div>
                      <div className="grid grid-cols-6 gap-1 text-[9px] mb-2">
                        {[
                          { label: '65px', w: 65, h: 0, fs: false },
                          { label: '115px', w: 115, h: 0, fs: false },
                          { label: '180px', w: 180, h: 0, fs: false },
                          { label: '320px', w: 320, h: 0, fs: false },
                          { label: '960px', w: 960, h: 540, fs: false },
                          { label: 'FULL SCR', w: 1920, h: 1080, fs: true },
                        ].map((s) => {
                          const isSelected = s.fs
                            ? Boolean(activeLogo.fullScreen)
                            : !activeLogo.fullScreen &&
                              (activeLogo.customWidth || activeLogo.size) === s.w;
                          return (
                            <button
                              key={s.label}
                              onClick={() =>
                                updateLogo(selectedLogoTab, {
                                  enabled: true,
                                  size: s.w,
                                  customWidth: s.w,
                                  customHeight: s.h > 0 ? s.h : undefined,
                                  fullScreen: s.fs,
                                  fitMode: s.fs ? 'fill' : activeLogo.fitMode || 'contain',
                                  offsetX: s.fs ? 0 : activeLogo.offsetX || 0,
                                  offsetY: s.fs ? 0 : activeLogo.offsetY || 0,
                                })
                              }
                              className={`py-1.5 rounded font-bold border transition cursor-pointer ${
                                isSelected
                                  ? s.fs
                                    ? 'bg-emerald-600 text-white border-emerald-400'
                                    : 'bg-blue-600 text-white border-blue-400'
                                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
                              }`}
                            >
                              {s.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Width & Height Resize Sliders */}
                      <div className="grid grid-cols-2 gap-2 bg-zinc-900/80 p-2 rounded border border-zinc-800">
                        <div>
                          <div className="flex items-center justify-between text-[9px] mb-1">
                            <span className="text-zinc-400 font-bold">WIDTH:</span>
                            <span className="text-blue-400 font-black">
                              {activeLogo.fullScreen
                                ? 1920
                                : activeLogo.customWidth || activeLogo.size || 120}
                              px
                            </span>
                          </div>
                          <input
                            type="range"
                            min={30}
                            max={1920}
                            value={
                              activeLogo.fullScreen
                                ? 1920
                                : activeLogo.customWidth || activeLogo.size || 120
                            }
                            onChange={(e) => {
                              const w = Number(e.target.value);
                              updateLogo(selectedLogoTab, {
                                enabled: true,
                                size: w,
                                customWidth: w,
                                fullScreen:
                                  w >= 1900 && (activeLogo.customHeight || 0) >= 1060,
                              });
                            }}
                            className="w-full accent-blue-500"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[9px] mb-1">
                            <span className="text-zinc-400 font-bold">HEIGHT:</span>
                            <span className="text-emerald-400 font-black">
                              {activeLogo.fullScreen
                                ? '1080px'
                                : activeLogo.customHeight
                                ? `${activeLogo.customHeight}px`
                                : 'Auto'}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1080}
                            value={
                              activeLogo.fullScreen ? 1080 : activeLogo.customHeight || 0
                            }
                            onChange={(e) => {
                              const h = Number(e.target.value);
                              updateLogo(selectedLogoTab, {
                                enabled: true,
                                customHeight: h > 0 ? h : undefined,
                                fullScreen:
                                  (activeLogo.customWidth || activeLogo.size || 120) >=
                                    1900 && h >= 1060,
                              });
                            }}
                            className="w-full accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Auto-Cycle 5s-60s Interval Matrix */}
                    <div className="pt-2 border-t border-zinc-800">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-amber-400 font-bold uppercase">
                          LOGO DISPLAY MODE & 5s–60s CYCLE TIMER:
                        </span>
                        <span className="text-[10px] text-white font-bold">
                          {g.logoDisplayMode || 'all'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                        {[
                          { id: 'all', label: 'All Split' },
                          { id: 'channel_only', label: 'CH Only' },
                          { id: 'cycle', label: 'Auto-Cycle' },
                        ].map((m) => (
                          <button
                            key={m.id}
                            onClick={() => update({ logoDisplayMode: m.id as any })}
                            className={`py-1 rounded font-bold border ${
                              (g.logoDisplayMode || 'all') === m.id
                                ? 'bg-amber-600 text-white border-amber-400'
                                : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-6 gap-1 text-[9px]">
                        {TIME_PRESETS.map((sec) => (
                          <button
                            key={sec}
                            onClick={() =>
                              update({
                                logoDisplayMode: 'cycle',
                                logoCycleIntervalSec: sec,
                              })
                            }
                            className={`py-1 rounded font-bold border ${
                              g.logoDisplayMode === 'cycle' &&
                              (g.logoCycleIntervalSec || 10) === sec
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
                );
              })()}
            </div>
          )}

          {/* 4. BOTTOM (1920x200) OR TOP OVERLAY BANNER PLAYLIST RIGHT PANEL */}
          {(activeLayer === 'bottom_overlay' || activeLayer === 'top_overlay') && (
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-lg space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div>
                  <h3 className="text-xs font-black text-white uppercase">
                    {activeLayer === 'bottom_overlay'
                      ? 'BOTTOM OVERLAY BANNER (1920×200)'
                      : 'TOP OVERLAY BANNER (1920×90)'}
                  </h3>
                  <span className="text-[10px] text-zinc-400">
                    PNG, JPG, GIF, MP4, MOV, MKV • Tick items & set 5s–60s time
                  </span>
                </div>
                <button
                  onClick={() =>
                    activeOverlayUpdater({ enabled: !activeOverlayConfig.enabled })
                  }
                  className={`px-3 py-1 rounded text-[10px] font-black ${
                    activeOverlayConfig.enabled
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  }`}
                >
                  {activeOverlayConfig.enabled ? '● ON AIR' : 'OFF'}
                </button>
              </div>

              {/* Upload Media File & Folder Bar */}
              <div className="grid grid-cols-3 gap-1.5">
                <input
                  key={`ov-file-${activeOverlayTarget}`}
                  ref={overlayFileInputRef}
                  type="file"
                  multiple
                  accept={ALL_CG_MEDIA_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    handleOverlayMediaUpload(selected, activeOverlayTarget);
                  }}
                />
                <input
                  key={`ov-folder-${activeOverlayTarget}`}
                  ref={(el) => {
                    overlayFolderInputRef.current = el;
                    if (el) {
                      el.setAttribute('webkitdirectory', '');
                      el.setAttribute('directory', '');
                    }
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    handleOverlayMediaUpload(selected, activeOverlayTarget);
                  }}
                />
                <button
                  onClick={() => overlayFileInputRef.current?.click()}
                  className="py-2 px-2 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 shadow cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>+ Add File (Video/SWF/PNG)</span>
                </button>
                <button
                  onClick={() => overlayFolderInputRef.current?.click()}
                  className="py-2 px-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 shadow cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>+ Add Folder</span>
                </button>
                <button
                  onClick={() => handleAddGeneratedBanner(activeOverlayTarget)}
                  className="py-2 px-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>+ Generate Graphic</span>
                </button>
              </div>

               {/* RESIZE TOP / BOTTOM BANNER (UP TO FULL SCREEN 1920×1080) */}
              <div className="bg-black/80 p-2.5 rounded-lg border border-amber-500/40 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-black text-amber-300 uppercase">
                    RESIZE {activeLayer === 'bottom_overlay' ? 'BOTTOM' : 'TOP'} BANNER (UP TO FULL SCREEN 1920×1080):
                  </span>
                  <span className="text-[10px] font-black text-emerald-400">
                    {activeOverlayConfig.width || 1920}W ×{' '}
                    {activeOverlayConfig.height || (activeLayer === 'bottom_overlay' ? 200 : 90)}H px
                  </span>
                </div>

                {/* Quick Size Presets including Full Screen 1920x1080 */}
                <div className="grid grid-cols-5 gap-1 text-[9px] font-black">
                  {[
                    {
                      label: 'Small (90H)',
                      w: 1920,
                      h: 90,
                      x: 0,
                      y: activeLayer === 'bottom_overlay' ? 990 : 0,
                    },
                    {
                      label: 'Std (200H)',
                      w: 1920,
                      h: 200,
                      x: 0,
                      y: activeLayer === 'bottom_overlay' ? 880 : 0,
                    },
                    {
                      label: 'Big (340H)',
                      w: 1920,
                      h: 340,
                      x: 0,
                      y: activeLayer === 'bottom_overlay' ? 740 : 0,
                    },
                    {
                      label: 'Half (540H)',
                      w: 1920,
                      h: 540,
                      x: 0,
                      y: activeLayer === 'bottom_overlay' ? 540 : 0,
                    },
                    {
                      label: '⛶ FULL 1080P',
                      w: 1920,
                      h: 1080,
                      x: 0,
                      y: 0,
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        activeOverlayUpdater({
                          enabled: true,
                          width: preset.w,
                          height: preset.h,
                          x: preset.x,
                          y: preset.y,
                        })
                      }
                      className={`py-1 rounded border cursor-pointer ${
                        (activeOverlayConfig.width || 1920) === preset.w &&
                        (activeOverlayConfig.height || (activeLayer === 'bottom_overlay' ? 200 : 90)) === preset.h
                          ? 'bg-amber-500 text-black border-amber-300'
                          : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Width & Height Sliders */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex justify-between text-[9px] text-zinc-400 font-bold mb-0.5">
                      <span>BANNER WIDTH:</span>
                      <span className="text-amber-300">{activeOverlayConfig.width || 1920}px</span>
                    </div>
                    <input
                      type="range"
                      min={200}
                      max={1920}
                      step={10}
                      value={activeOverlayConfig.width || 1920}
                      onChange={(e) => activeOverlayUpdater({ width: Number(e.target.value) })}
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] text-zinc-400 font-bold mb-0.5">
                      <span>BANNER HEIGHT:</span>
                      <span className="text-amber-300">
                        {activeOverlayConfig.height || (activeLayer === 'bottom_overlay' ? 200 : 90)}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={1080}
                      step={5}
                      value={activeOverlayConfig.height || (activeLayer === 'bottom_overlay' ? 200 : 90)}
                      onChange={(e) => {
                        const nextH = Number(e.target.value);
                        activeOverlayUpdater({
                          height: nextH,
                          ...(activeLayer === 'bottom_overlay' ? { y: Math.max(0, 1080 - nextH) } : {}),
                        });
                      }}
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                {/* X & Y Position Sliders */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex justify-between text-[9px] text-zinc-400 font-bold mb-0.5">
                      <span>POS X:</span>
                      <span className="text-cyan-300">{activeOverlayConfig.x || 0}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1800}
                      step={5}
                      value={activeOverlayConfig.x || 0}
                      onChange={(e) => activeOverlayUpdater({ x: Number(e.target.value) })}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] text-zinc-400 font-bold mb-0.5">
                      <span>POS Y:</span>
                      <span className="text-cyan-300">
                        {activeOverlayConfig.y ??
                          (activeLayer === 'bottom_overlay'
                            ? Math.max(0, 1080 - (activeOverlayConfig.height || 200))
                            : 0)}
                        px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1050}
                      step={5}
                      value={
                        activeOverlayConfig.y ??
                        (activeLayer === 'bottom_overlay'
                          ? Math.max(0, 1080 - (activeOverlayConfig.height || 200))
                          : 0)
                      }
                      onChange={(e) => activeOverlayUpdater({ y: Number(e.target.value) })}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Global Fixed Image Seconds & Auto Full Video Duration Rule */}
              <div className="bg-black/60 p-2.5 rounded-lg border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-emerald-400 font-bold uppercase">
                    ✓ VIDEOS: PLAY 100% FULL VIDEO DURATION &amp; NEXT AUTOMATICALLY
                  </span>
                  <button
                    onClick={() =>
                      activeOverlayUpdater({
                        squeezeProgramVideo: !activeOverlayConfig.squeezeProgramVideo,
                      })
                    }
                    className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                      activeOverlayConfig.squeezeProgramVideo
                        ? 'bg-cyan-600 text-white border-cyan-400'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                    }`}
                  >
                    {activeOverlayConfig.squeezeProgramVideo ? '◱ Squeeze Video: ON' : '⛶ Squeeze: OFF'}
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-amber-300 font-bold uppercase">
                      FIXED SECONDS FOR IMAGES ONLY (TOP / BOTTOM):
                    </span>
                    <span className="text-[10px] font-black text-amber-400">
                      {activeOverlayConfig.imageFixedDurationSec || 10}s per Image
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-1 text-[9px]">
                    {TIME_PRESETS.map((sec) => (
                      <button
                        key={sec}
                        onClick={() => {
                          const updated = (activeOverlayConfig.playlist || []).map((it) =>
                            it.mediaType === 'video' || it.mediaType === 'swf'
                              ? { ...it, autoVideoDuration: true }
                              : { ...it, duration: sec, autoVideoDuration: false }
                          );
                          activeOverlayUpdater({
                            imageFixedDurationSec: sec,
                            playlist: updated,
                          });
                        }}
                        className={`py-1 rounded border font-bold transition ${
                          (activeOverlayConfig.imageFixedDurationSec || 10) === sec
                            ? 'bg-amber-500 text-black border-amber-300'
                            : 'bg-zinc-900 hover:bg-red-600 text-zinc-300 hover:text-white border-zinc-800'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Playlist Items with Enable/Disable per Folder & File, Take On-Air, Edit & Delete */}
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {Array.from(
                  new Set(
                    (activeOverlayConfig.playlist || [])
                      .map((it) => it.folderName)
                      .filter((f): f is string => Boolean(f))
                  )
                ).map((folderName) => {
                  const folderItems = (activeOverlayConfig.playlist || []).filter(
                    (it) => it.folderName === folderName
                  );
                  const enabledInFolder = folderItems.filter((it) => it.enabled !== false);
                  const isFolderEnabled = enabledInFolder.length > 0;
                  return (
                    <div
                      key={`ov-folder-${folderName}`}
                      className={`flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-[10px] ${
                        isFolderEnabled
                          ? 'bg-purple-950/60 border-purple-500/40'
                          : 'bg-zinc-950/80 border-rose-900/60 opacity-75'
                      }`}
                    >
                      <span
                        className={`font-bold truncate ${
                          isFolderEnabled ? 'text-purple-200' : 'text-zinc-500 line-through'
                        }`}
                      >
                        📁 {folderName} ({enabledInFolder.length}/{folderItems.length} files enabled)
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex rounded overflow-hidden border border-zinc-700">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (activeOverlayConfig.playlist || []).map((it) =>
                                it.folderName === folderName ? { ...it, enabled: true } : it
                              );
                              activeOverlayUpdater({
                                enabled: true,
                                playlist: updated,
                              });
                            }}
                            className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                              isFolderEnabled
                                ? 'bg-emerald-600 text-white'
                                : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                            }`}
                          >
                            Enable Folder
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (activeOverlayConfig.playlist || []).map((it) =>
                                it.folderName === folderName ? { ...it, enabled: false } : it
                              );
                              activeOverlayUpdater({
                                playlist: updated,
                              });
                            }}
                            className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                              !isFolderEnabled
                                ? 'bg-rose-600 text-white'
                                : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                            }`}
                          >
                            Disable Folder
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const oldList = activeOverlayConfig.playlist || [];
                            const curIdx = activeOverlayConfig.currentIndex || 0;
                            const wasPlayingInFolder = oldList[curIdx]?.folderName === folderName;
                            const removedBefore = oldList
                              .slice(0, curIdx)
                              .filter((it) => it.folderName === folderName).length;
                            const updated = oldList.filter((it) => it.folderName !== folderName);
                            const nextIdx =
                              updated.length === 0
                                ? 0
                                : wasPlayingInFolder
                                ? (curIdx - removedBefore) % updated.length
                                : Math.max(0, Math.min(updated.length - 1, curIdx - removedBefore));
                            const nextItem = updated[nextIdx];
                            if (wasPlayingInFolder && nextItem?.url) {
                              swfEngine.restartSwf(nextItem.url);
                            }
                            activeOverlayUpdater({
                              playlist: updated,
                              currentIndex: nextIdx,
                              currentTime: wasPlayingInFolder ? 0 : activeOverlayConfig.currentTime || 0,
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 text-rose-200 border border-rose-500/40 text-[9px] font-bold cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
                {(activeOverlayConfig.playlist || []).map((item, idx) => {
                  const isTicked = item.enabled !== false;
                  const isCurrent = isTicked && activeOverlayConfig.currentIndex === idx;
                  const isEditing = editingOverlayItemId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`p-2 rounded-lg border transition ${
                        !isTicked
                          ? 'bg-zinc-950/60 border-rose-950/60 opacity-65'
                          : isCurrent
                          ? 'bg-red-950/30 border-red-500'
                          : 'bg-zinc-900/90 border-zinc-800'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editOverlayTitle}
                            onChange={(e) => setEditOverlayTitle(e.target.value)}
                            className="w-full bg-black border border-red-500 rounded px-2 py-1 text-xs text-white"
                            placeholder="Item Title"
                          />
                          <div className="grid grid-cols-6 gap-1 text-[9px]">
                            {TIME_PRESETS.map((sec) => (
                              <button
                                key={sec}
                                onClick={() => setEditOverlayDuration(sec)}
                                className={`py-1 rounded font-bold border ${
                                  editOverlayDuration === sec
                                    ? 'bg-red-600 text-white border-red-400'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => setEditingOverlayItemId(null)}
                              className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-[10px] font-bold"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                const updated = [...activeOverlayConfig.playlist];
                                updated[idx] = {
                                  ...updated[idx],
                                  title: editOverlayTitle,
                                  duration: editOverlayDuration,
                                  fitMode: editOverlayFit,
                                };
                                activeOverlayUpdater({ playlist: updated });
                                setEditingOverlayItemId(null);
                              }}
                              className="px-2.5 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div
                              onClick={() => {
                                if (!isTicked) return;
                                if (item.url) {
                                  swfEngine.restartSwf(item.url);
                                }
                                activeOverlayUpdater({
                                  currentIndex: idx,
                                  currentTime: 0,
                                  enabled: true,
                                  isPlaying: true,
                                });
                              }}
                              className="min-w-0 flex-1 cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`text-[10px] font-bold truncate ${
                                    isTicked ? 'text-white' : 'text-zinc-500 line-through'
                                  }`}
                                >
                                  {idx + 1}. {item.fileName || item.title}
                                </span>
                                {item.folderName && (
                                  <span className="text-[8px] bg-purple-900/80 border border-purple-500/40 text-purple-200 px-1.5 py-0.2 rounded font-bold">
                                    📁 {item.folderName}
                                  </span>
                                )}
                                {!isTicked && (
                                  <span className="text-[8px] bg-rose-950 border border-rose-500/40 text-rose-300 px-1 rounded font-bold uppercase">
                                    Disabled
                                  </span>
                                )}
                                {isCurrent && (
                                  <span className="text-[8px] bg-red-600 text-white px-1 rounded font-black">
                                    ON AIR
                                  </span>
                                )}
                              </div>
                              <div className="text-[9px] text-zinc-400 flex items-center gap-2">
                                <span
                                  className={
                                    item.mediaType === 'video' || item.mediaType === 'swf'
                                      ? 'text-emerald-400 font-bold'
                                      : 'text-amber-300 font-bold'
                                  }
                                >
                                  {item.mediaType === 'swf'
                                    ? `⚡ SWF FLASH • FULL DURATION (${item.duration}s) → AUTO NEXT`
                                    : item.mediaType === 'video'
                                    ? `🎬 VIDEO • FULL DURATION (${item.duration}s) → AUTO NEXT`
                                    : `🖼 IMAGE • FIXED ${item.duration}s`}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Move First / Up / Down Reorder Buttons */}
                            <button
                              type="button"
                              onClick={() => {
                                if (idx === 0) return;
                                const updated = [...activeOverlayConfig.playlist];
                                const [moved] = updated.splice(idx, 1);
                                updated.unshift(moved);
                                const curIdx = activeOverlayConfig.currentIndex || 0;
                                const nextIdx =
                                  curIdx === idx ? 0 : curIdx < idx ? curIdx + 1 : curIdx;
                                activeOverlayUpdater({
                                  playlist: updated,
                                  currentIndex: nextIdx,
                                });
                              }}
                              disabled={idx === 0}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-black flex items-center gap-0.5 border ${
                                idx === 0
                                  ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed'
                                  : 'bg-amber-600/90 hover:bg-amber-500 text-white border-amber-400 cursor-pointer'
                              }`}
                              title="Move to 1st position"
                            >
                              <ArrowUpToLine className="w-2.5 h-2.5" />
                              <span>1st</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (idx === 0) return;
                                const updated = [...activeOverlayConfig.playlist];
                                const tmp = updated[idx - 1];
                                updated[idx - 1] = updated[idx];
                                updated[idx] = tmp;
                                const curIdx = activeOverlayConfig.currentIndex || 0;
                                const nextIdx =
                                  curIdx === idx ? idx - 1 : curIdx === idx - 1 ? idx : curIdx;
                                activeOverlayUpdater({
                                  playlist: updated,
                                  currentIndex: nextIdx,
                                });
                              }}
                              disabled={idx === 0}
                              className={`p-1 rounded ${
                                idx === 0
                                  ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer'
                              }`}
                              title="Move Up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (idx >= activeOverlayConfig.playlist.length - 1) return;
                                const updated = [...activeOverlayConfig.playlist];
                                const tmp = updated[idx + 1];
                                updated[idx + 1] = updated[idx];
                                updated[idx] = tmp;
                                const curIdx = activeOverlayConfig.currentIndex || 0;
                                const nextIdx =
                                  curIdx === idx ? idx + 1 : curIdx === idx + 1 ? idx : curIdx;
                                activeOverlayUpdater({
                                  playlist: updated,
                                  currentIndex: nextIdx,
                                });
                              }}
                              disabled={idx >= activeOverlayConfig.playlist.length - 1}
                              className={`p-1 rounded ${
                                idx >= activeOverlayConfig.playlist.length - 1
                                  ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer'
                              }`}
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            {/* Per-File Enable / Disable Buttons */}
                            <div className="flex rounded overflow-hidden border border-zinc-700 mr-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...activeOverlayConfig.playlist];
                                  updated[idx] = {
                                    ...updated[idx],
                                    enabled: true,
                                  };
                                  activeOverlayUpdater({ enabled: true, playlist: updated });
                                }}
                                className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                                  isTicked
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                                }`}
                              >
                                Enable
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...activeOverlayConfig.playlist];
                                  updated[idx] = {
                                    ...updated[idx],
                                    enabled: false,
                                  };
                                  activeOverlayUpdater({ playlist: updated });
                                }}
                                className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                                  !isTicked
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                                }`}
                              >
                                Disable
                              </button>
                            </div>
                            <button
                              onClick={() => {
                                setEditingOverlayItemId(item.id);
                                setEditOverlayTitle(item.title);
                                setEditOverlayDuration(item.duration);
                                setEditOverlayFit(item.fitMode || 'fill');
                              }}
                              className="p-1 bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white rounded cursor-pointer"
                              title="Edit Item"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => {
                                const curIdx = activeOverlayConfig.currentIndex || 0;
                                const updated = activeOverlayConfig.playlist.filter(
                                  (_, i) => i !== idx
                                );
                                const nextIdx =
                                  updated.length === 0
                                    ? 0
                                    : idx < curIdx
                                    ? curIdx - 1
                                    : curIdx % updated.length;
                                const nextItem = updated[nextIdx];
                                if (idx === curIdx && nextItem?.url) {
                                  swfEngine.restartSwf(nextItem.url);
                                }
                                activeOverlayUpdater({
                                  playlist: updated,
                                  currentIndex: nextIdx,
                                  currentTime: idx === curIdx ? 0 : activeOverlayConfig.currentTime || 0,
                                });
                              }}
                              className="p-1 bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white rounded"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* L-Shape Studio Panel when activeLayer === 'lshape' */}
            </div>
          )}

          {activeLayer === 'lshape' && (
            <LShapeStudioPanel
              channel={draftChannel}
              lShape={lShape}
              onUpdateLShape={updateLShape}
              onSaveChannel={handleCommitSaveCg}
            />
          )}

          {activeLayer === 'clock' && (
            <ClockStudioPanel
              channel={draftChannel}
              onUpdateGraphics={update}
              onSaveChannel={handleCommitSaveCg}
            />
          )}
        </div>
      </div>
    </div>
  );
};
