import React, { useState, useRef } from 'react';
import {
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  Pause,
  Clock,
  Film,
  Image as ImageIcon,
  Edit3,
  Check,
  X,
  Sparkles,
  Upload,
  CheckSquare,
  Square,
  Copy,
  Maximize2,
  Minimize2,
  Save,
  AlignLeft,
  AlignRight,
  Layers,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Calendar,
} from 'lucide-react';
import {
  TVChannel,
  LShapeConfig,
  LShapePlaylistItem,
  OverlayFitMode
} from '../types/playout';
import {
  ALL_CG_MEDIA_ACCEPT,
  filterFolderCgMediaFiles,
  isSwfFile,
  isVideoOrSwfFile,
  probeMediaFileDuration
} from '../services/swfEngine';
import { extractFolderName } from '../services/offlineMediaVault';
import { AdTrackingTimeGrid } from './AdTrackingTimeGrid';
import {
  ensureDefaultTickedSlots,
  getTrack48HHMMs,
  getNextTickedSlotCountdown,
  formatHHMMTo12HrWithSec,
  formatWaitingDuration,
  formatSlotPlayWindow,
  formatAdDateSummary,
  getDefaultAdDateRange,
} from '../utils/adTrackingTracks';

const LSHAPE_IMAGE_ACCEPT = ALL_CG_MEDIA_ACCEPT;

export const LSHAPE_TIME_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;

export const LSHAPE_SIZE_PRESETS = [
  { id: 'full_image', label: 'Full Image (100% L-Shape)', shortLabel: 'Full Image', w: 380, h: 180 },
  { id: 'too_small', label: 'Too Small (100×48)', shortLabel: 'Too Small', w: 100, h: 48 },
  { id: 'extra_small', label: 'Extra Small (140×68)', shortLabel: 'Extra Small', w: 140, h: 68 },
  { id: 'very_small', label: 'Very Small (180×88)', shortLabel: 'Very Small', w: 180, h: 88 },
  { id: 'small', label: 'Small (220×105)', shortLabel: 'Small', w: 220, h: 105 },
  { id: 'compact', label: 'Compact (280×130)', shortLabel: 'Compact', w: 280, h: 130 },
  { id: 'medium', label: 'Medium (360×170)', shortLabel: 'Medium', w: 360, h: 170 },
  { id: 'large', label: 'Big (460×220)', shortLabel: 'Big', w: 460, h: 220 },
] as const;

interface LShapeStudioPanelProps {
  channel: TVChannel;
  lShape: LShapeConfig;
  onUpdateLShape: (
    partialOrUpdater: Partial<LShapeConfig> | ((prev: LShapeConfig) => LShapeConfig)
  ) => void;
  onOpenCopyModal?: () => void;
  onSaveChannel?: () => void;
}

export const LShapeStudioPanel: React.FC<LShapeStudioPanelProps> = ({
  channel,
  lShape,
  onUpdateLShape,
  onOpenCopyModal,
  onSaveChannel,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [replacingItemId, setReplacingItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDuration, setEditDuration] = useState<number>(15);
  const [editAutoVideo, setEditAutoVideo] = useState<boolean>(true);
  const [editFitMode, setEditFitMode] = useState<OverlayFitMode>('fill');
  const [editSide, setEditSide] = useState<'left' | 'right'>(lShape.side || 'left');
  const [editRenderMode, setEditRenderMode] = useState<'squeeze' | 'overlay'>(
    lShape.renderMode || (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze')
  );
  const [editDisplayZone, setEditDisplayZone] = useState<
    'full_l_canvas' | 'chroma_key' | 'smart_l' | 'clean_l' | 'full_screen'
  >(lShape.displayZone || 'full_l_canvas');
  const [editCgOverlayMode, setEditCgOverlayMode] = useState<
    'all_overlays' | 'lshape_and_logo' | 'lshape_all_logos' | 'lshape_only'
  >(lShape.cgOverlayMode || 'lshape_and_logo');
  const [editRepeatMin, setEditRepeatMin] = useState<number>(lShape.repeatEveryMin || 0);
  const [editRepeatSec, setEditRepeatSec] = useState<number>(
    lShape.periodicIntervalSec || lShape.intervalSeconds || 15
  );
  const [savedToast, setSavedToast] = useState(false);
  const [expandedLShapeFolders, setExpandedLShapeFolders] = useState<Record<string, boolean>>({});
  const [expandedLShapeFolderTime, setExpandedLShapeFolderTime] = useState<Record<string, boolean>>({});
  const [expandedLShapeItemTime, setExpandedLShapeItemTime] = useState<Record<string, boolean>>({});

  const triggerSaveToast = () => {
    if (onSaveChannel) onSaveChannel();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  // Upload L-Shape PNG / WebP / GIF / JPG / SWF / Video files or folders
  const handleMediaFiles = (rawFiles: FileList | File[] | null) => {
    if (!rawFiles || rawFiles.length === 0) return;
    const files = filterFolderCgMediaFiles(rawFiles);
    if (files.length === 0) return;

    const batchTs = Date.now();
    const defaultSec = lShape.intervalSeconds || 15;
    const defaultSide = lShape.side || 'left';
    const defaultRenderMode =
      lShape.renderMode || (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze');
    const defaultRepeatMin = lShape.repeatEveryMin || 0;
    const defaultRepeatSec = lShape.periodicIntervalSec || lShape.intervalSeconds || 15;

    const activeMasterTracks =
      lShape.selectedTracks && lShape.selectedTracks.length > 0 ? lShape.selectedTracks : [1];
    const activeMasterPreset = lShape.track6Preset || 'text';
    const activeMasterSlots = ensureDefaultTickedSlots(
      lShape.tickedSlots,
      activeMasterTracks,
      1,
      activeMasterPreset,
      lShape.customTracks || []
    );

    const defaultDateRange = getDefaultAdDateRange();

    const uploadedItems: LShapePlaylistItem[] = files.map((file, i) => {
      const objUrl = URL.createObjectURL(file);
      const isSwf = isSwfFile(file);
      const isVid = !isSwf && isVideoOrSwfFile(file);
      const folderName = extractFolderName(file);
      return {
        id: `lshop-${batchTs}-${i}`,
        title: file.name.replace(/\.[^/.]+$/, '').toUpperCase(),
        fileName: file.name,
        folderName,
        enabled: true,
        mediaType: isSwf ? 'swf' : isVid ? 'video' : 'image',
        url: objUrl,
        file,
        duration: defaultSec,
        autoVideoDuration: isSwf || isVid,
        fitMode: lShape.fitMode || 'fill',
        side: defaultSide,
        renderMode: defaultRenderMode,
        presetSize: 'full_image',
        displayZone: 'full_l_canvas',
        cgOverlayMode: 'lshape_and_logo',
        repeatEveryMin: defaultRepeatMin,
        repeatEverySec: defaultRepeatSec,
        selectedTracks: [...activeMasterTracks],
        tickedSlots: [...activeMasterSlots],
        customTracks: [...(lShape.customTracks || [])],
        track6Preset: activeMasterPreset,
        dateMode: lShape.dateMode || 'date_range',
        startDate: lShape.startDate || defaultDateRange.startDate,
        endDate: lShape.endDate || defaultDateRange.endDate,
        opacity: 1,
        notes: `${file.name.split('.').pop()?.toUpperCase() || 'PNG'} • ${defaultSec}s • Track ${activeMasterTracks.join(',')}`,
      };
    });

    onUpdateLShape((prev) => {
      const base = prev || lShape;
      const existing = base.playlist || [];
      const combined = [...existing, ...uploadedItems];
      const allEnabledIndices = combined
        .map((it, idx) => (it.enabled !== false ? idx : -1))
        .filter((idx) => idx >= 0);
      const startIdx = existing.length < combined.length ? existing.length : 0;
      const remainingQueue = allEnabledIndices.filter((idx) => idx > startIdx);
      return {
        ...base,
        enabled: true,
        keyEnabled: true,
        isPlaying: true,
        opacity: 1,
        presetSize: 'full_image',
        sideWidth: base.sideWidth && base.sideWidth >= 50 ? base.sideWidth : 280,
        bottomHeight: base.bottomHeight && base.bottomHeight >= 28 ? base.bottomHeight : 130,
        renderMode: defaultRenderMode,
        squeezeProgramVideo: defaultRenderMode === 'squeeze',
        playMode: base.playMode || 'periodic',
        periodicActive: true,
        periodicCounter: 0,
        playlist: combined,
        currentIndex: startIdx,
        dueQueueIndices: remainingQueue,
        currentTime: 0,
      };
    });

    // Upload media to backend /uploads & offline vault so Save persists media URL
    uploadedItems.forEach((item) => {
      if (!item.file) return;
      probeMediaFileDuration(item.file, item.url).then(
        ({ duration, serverUrl, vaultId, folderName }) => {
          onUpdateLShape((prev) => {
            const base = prev || lShape;
            return {
              ...base,
              enabled: true,
              keyEnabled: true,
              isPlaying: true,
              opacity: 1,
              playlist: (base.playlist || []).map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      url: serverUrl || it.url,
                      vaultId: vaultId || it.vaultId,
                      folderName: folderName || it.folderName,
                      duration:
                        (it.mediaType === 'video' || it.mediaType === 'swf') && duration > 0
                          ? duration
                          : it.duration,
                    }
                  : it
              ),
            };
          });
        }
      );
    });
  };

  // Replace media file for an existing L-Shape item (Image Only)
  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !replacingItemId) return;
    if (isSwfFile(file) || isVideoOrSwfFile(file)) return;

    const targetId = replacingItemId;
    const objUrl = URL.createObjectURL(file);
    const res = await probeMediaFileDuration(file, objUrl);

    onUpdateLShape((prev) => {
      const base = prev || lShape;
      return {
        ...base,
        playlist: (base.playlist || []).map((item) =>
          item.id === targetId
            ? {
                ...item,
                title: file.name.replace(/\.[^/.]+$/, '').toUpperCase(),
                fileName: file.name,
                mediaType: 'image',
                url: res.serverUrl || objUrl,
                file,
                autoVideoDuration: false,
              }
            : item
        ),
      };
    });
    setReplacingItemId(null);
  };

  // Start editing an item
  const startEditing = (item: LShapePlaylistItem) => {
    setEditingItemId(item.id);
    setEditTitle(item.title || '');
    setEditDuration(item.duration || 15);
    setEditAutoVideo(false);
    setEditFitMode(item.fitMode || 'fill');
    setEditSide(item.side || lShape.side || 'left');
    setEditRenderMode(
      item.renderMode ||
        lShape.renderMode ||
        (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze')
    );
    setEditDisplayZone(item.displayZone || lShape.displayZone || 'full_l_canvas');
    setEditCgOverlayMode(item.cgOverlayMode || 'lshape_and_logo');
    setEditRepeatMin(item.repeatEveryMin ?? lShape.repeatEveryMin ?? 0);
    setEditRepeatSec(
      item.repeatEverySec || lShape.periodicIntervalSec || lShape.intervalSeconds || 15
    );
  };

  // Save edited item & apply to L-Shape
  const saveEditing = (item: LShapePlaylistItem) => {
    onUpdateLShape((prev) => {
      const base = prev || lShape;
      const updatedList = (base.playlist || []).map((it) =>
        it.id === item.id
          ? {
              ...it,
              title: editTitle.trim() || it.title,
              duration: editDuration,
              autoVideoDuration: it.mediaType === 'video' ? editAutoVideo : false,
              fitMode: editFitMode,
              side: editSide,
              renderMode: editRenderMode,
              displayZone: editDisplayZone,
              cgOverlayMode: editCgOverlayMode,
              repeatEveryMin: editRepeatMin,
              repeatEverySec: editRepeatSec,
            }
          : it
      );
      return {
        ...base,
        enabled: true,
        keyEnabled: true,
        isPlaying: true,
        opacity: 1,
        sideWidth: base.sideWidth && base.sideWidth >= 50 ? base.sideWidth : 280,
        bottomHeight: base.bottomHeight && base.bottomHeight >= 28 ? base.bottomHeight : 130,
        side: editSide,
        renderMode: editRenderMode,
        squeezeProgramVideo: editRenderMode === 'squeeze',
        intervalSeconds: editDuration,
        repeatEveryMin: editRepeatMin,
        periodicIntervalSec:
          editRepeatMin > 0 ? editRepeatMin * 60 : editRepeatSec,
        periodicActive: true,
        periodicCounter: 0,
        currentTime: 0,
        playlist: updatedList,
      };
    });
    setEditingItemId(null);
    triggerSaveToast();
  };

  // Toggle tick checkbox (enabled)
  const handleToggleItemTick = (idx: number) => {
    onUpdateLShape((prev) => {
      const base = prev || lShape;
      return {
        ...base,
        playlist: (base.playlist || []).map((it, i) =>
          i === idx ? { ...it, enabled: it.enabled === false ? true : false } : it
        ),
      };
    });
  };

  // Delete item
  const handleDeleteItem = (idx: number) => {
    onUpdateLShape((prev) => {
      const base = prev || lShape;
      const updated = (base.playlist || []).filter((_, i) => i !== idx);
      const nextIdx = Math.max(0, Math.min(updated.length - 1, base.currentIndex || 0));
      return {
        ...base,
        playlist: updated,
        currentIndex: nextIdx,
        currentTime: 0,
      };
    });
  };

  // Move item Up/Down
  const handleMoveItem = (idx: number, dir: 'up' | 'down') => {
    onUpdateLShape((prev) => {
      const base = prev || lShape;
      const list = [...(base.playlist || [])];
      if (dir === 'up' && idx === 0) return base;
      if (dir === 'down' && idx === list.length - 1) return base;
      const target = dir === 'up' ? idx - 1 : idx + 1;
      const temp = list[idx];
      list[idx] = list[target];
      list[target] = temp;
      return { ...base, playlist: list, currentIndex: target };
    });
  };

  const playlist = lShape.playlist || [];
  const tickedCount = playlist.filter((it) => it.enabled !== false).length;
  const activeItem = playlist[Math.max(0, Math.min(playlist.length - 1, lShape.currentIndex || 0))];
  const activeItemRepeatMin = activeItem?.repeatEveryMin ?? lShape.repeatEveryMin ?? 0;
  const activeItemRepeatSec =
    activeItem?.repeatEverySec !== undefined
      ? activeItem.repeatEverySec
      : lShape.periodicIntervalSec || lShape.intervalSeconds || 15;
  const isLShapeVisibleNow =
    lShape.enabled &&
    tickedCount > 0 &&
    (activeItemRepeatMin > 0 || activeItemRepeatSec > 0 || lShape.playMode === 'periodic'
      ? lShape.periodicActive !== false
      : true);
  const currentRenderMode =
    lShape.renderMode || (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze');
  const activeWaitTotalSec =
    activeItemRepeatMin > 0
      ? activeItemRepeatMin * 60
      : Math.max(5, activeItemRepeatSec || 15);
  const remainingWaitSec = Math.max(0, activeWaitTotalSec - (lShape.periodicCounter || 0));

  return (
    <div className="space-y-2.5 text-xs font-mono text-white">
      {/* Hidden File & Folder Inputs (Image Only — PNG / WebP / GIF / JPG) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={LSHAPE_IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleMediaFiles(files);
          e.target.value = '';
        }}
      />
      <input
        ref={(el) => {
          folderInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleMediaFiles(files);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceFileInputRef}
        type="file"
        accept={LSHAPE_IMAGE_ACCEPT}
        className="hidden"
        onChange={handleReplaceFile}
      />

      {/* 1. ADD L-SHAPE IMAGE / FOLDER + OVERLAY L-SHAPE ON BUTTON */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-black text-white uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>ADD L-SHAPE IMAGE / FOLDER (TRANSPARENT PNG • WEBP • GIF • IMAGE)</span>
            </span>
            <p className="text-[10px] text-emerald-400 font-bold font-sans">
              Default L-Shape Playing Time: 1st Logo Only + L-Shape (Sponsor Logos &amp; Top/Bottom Tickers Auto-Paused During L-Shape)
            </p>
          </div>

          {playlist.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateLShape((prev) => {
                    const base = prev || lShape;
                    return {
                      ...base,
                      enabled: !lShape.enabled,
                      keyEnabled: true,
                      isPlaying: true,
                      opacity: 1,
                      sideWidth: base.sideWidth && base.sideWidth >= 50 ? base.sideWidth : 280,
                      bottomHeight: base.bottomHeight && base.bottomHeight >= 28 ? base.bottomHeight : 130,
                      periodicActive: true,
                      periodicCounter: 0,
                      currentTime: 0,
                    };
                  })
                }
                className={`px-3 py-1 rounded text-[10px] font-black transition cursor-pointer ${
                  lShape.enabled
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-700'
                }`}
              >
                {lShape.enabled ? '● L-SHAPE ON AIR' : 'L-SHAPE OFF'}
              </button>

              <button
                type="button"
                onClick={triggerSaveToast}
                className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded text-[10px] font-black shadow cursor-pointer"
              >
                <Save className="w-3 h-3" />
                <span>{savedToast ? '✓ SAVED' : 'SAVE L-SHAPE'}</span>
              </button>

              {onOpenCopyModal && (
                <button
                  type="button"
                  onClick={onOpenCopyModal}
                  className="flex items-center gap-1 px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-amber-400 border border-zinc-700 rounded text-[10px] font-bold shrink-0"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Upload L-Shape PNG + Upload Folder + Overlay L-Shape ON + Show/End L-Shape Now */}
        <div className={`grid gap-1.5 ${playlist.length > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1 py-2 px-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-[10px] shadow transition cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>+ Add L-Shape Image (PNG)</span>
          </button>

          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center justify-center gap-1 py-2 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-[10px] shadow transition cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>+ Add Image Folder</span>
          </button>

          {playlist.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  onUpdateLShape((prev) => {
                    const base = prev || lShape;
                    return {
                      ...base,
                      enabled: true,
                      keyEnabled: true,
                      isPlaying: true,
                      opacity: 1,
                      presetSize: 'full_image',
                      renderMode: 'overlay',
                      squeezeProgramVideo: false,
                      periodicActive: true,
                      periodicCounter: 0,
                      currentTime: 0,
                      playlist: (base.playlist || []).map((it) => ({
                        ...it,
                        enabled: true,
                        presetSize: 'full_image',
                        renderMode: 'overlay',
                        cgOverlayMode: 'lshape_and_logo',
                      })),
                    };
                  })
                }
                className={`flex items-center justify-center gap-1 py-2 px-2 rounded font-black text-[10px] shadow transition border cursor-pointer ${
                  isLShapeVisibleNow && currentRenderMode === 'overlay'
                    ? 'bg-cyan-500 text-black border-cyan-300'
                    : 'bg-cyan-700 hover:bg-cyan-600 text-white border-cyan-500'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>● OVERLAY L-SHAPE ON</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isLShapeVisibleNow) {
                    onUpdateLShape((prev) => ({
                      ...(prev || lShape),
                      playMode: 'periodic',
                      periodicActive: false,
                      periodicCounter: 0,
                    }));
                  } else {
                    onUpdateLShape((prev) => {
                      const base = prev || lShape;
                      return {
                        ...base,
                        enabled: true,
                        keyEnabled: true,
                        isPlaying: true,
                        opacity: 1,
                        sideWidth: base.sideWidth && base.sideWidth >= 50 ? base.sideWidth : 280,
                        bottomHeight: base.bottomHeight && base.bottomHeight >= 28 ? base.bottomHeight : 130,
                        periodicActive: true,
                        periodicCounter: 0,
                        currentTime: 0,
                      };
                    });
                  }
                }}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded font-black text-[10px] shadow transition border cursor-pointer ${
                  isLShapeVisibleNow
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400'
                    : 'bg-amber-500 hover:bg-amber-400 text-black border-amber-400'
                }`}
              >
                {isLShapeVisibleNow ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>End L-Shape ➔ Full Screen</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Show L-Shape Now</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {playlist.length === 0 ? (
        <div className="bg-zinc-950 p-6 rounded-lg border border-zinc-800 text-center text-zinc-500 text-xs">
          No L-Shape files added yet. Click <strong className="text-zinc-300">+ Add L-Shape Image (PNG)</strong> or <strong className="text-zinc-300">+ Add Image Folder</strong> above to configure time slots and L-Shape play details.
        </div>
      ) : (
        <>
      {/* 2. LEFT OR RIGHT PLACEMENT & PROFESSIONAL TV OVERLAY L-SHAPE MODE */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-amber-400 font-black uppercase">
            LEFT OR RIGHT SIDE &amp; PROFESSIONAL TV L-SHAPE OVERLAY MODE
          </span>
          <span className="text-[10px] text-emerald-400 font-bold">
            Full Image + Transparency + Backend Video Playing
          </span>
        </div>

        {/* Left vs Right Side Selector */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() =>
              onUpdateLShape((prev) => {
                const base = prev || lShape;
                return {
                  ...base,
                  side: 'left',
                  playlist: (base.playlist || []).map((it) => ({
                    ...it,
                    side: 'left',
                  })),
                };
              })
            }
            className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
              (lShape.side || 'left') === 'left'
                ? 'bg-amber-500 text-black border-amber-300 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>◱ LEFT SIDE L-SHAPE (Video Right)</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateLShape((prev) => {
                const base = prev || lShape;
                return {
                  ...base,
                  side: 'right',
                  playlist: (base.playlist || []).map((it) => ({
                    ...it,
                    side: 'right',
                  })),
                };
              })
            }
            className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
              lShape.side === 'right'
                ? 'bg-amber-500 text-black border-amber-300 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <AlignRight className="w-3.5 h-3.5" />
            <span>◲ RIGHT SIDE L-SHAPE (Video Left)</span>
          </button>
        </div>

        {/* Overlay L-Shape vs TV L-Shape Window Fit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() =>
              onUpdateLShape((prev) => {
                const base = prev || lShape;
                return {
                  ...base,
                  enabled: true,
                  isPlaying: true,
                  periodicActive: true,
                  presetSize: 'full_image',
                  renderMode: 'overlay',
                  squeezeProgramVideo: false,
                  playlist: (base.playlist || []).map((it) => ({
                    ...it,
                    presetSize: 'full_image',
                    renderMode: 'overlay',
                  })),
                };
              })
            }
            className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
              currentRenderMode === 'overlay'
                ? 'bg-cyan-600 text-white border-cyan-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>● OVERLAY L-SHAPE (FULL IMAGE + TRANSPARENCY ON VIDEO)</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onUpdateLShape((prev) => {
                const base = prev || lShape;
                return {
                  ...base,
                  enabled: true,
                  isPlaying: true,
                  periodicActive: true,
                  renderMode: 'squeeze',
                  squeezeProgramVideo: true,
                  playlist: (base.playlist || []).map((it) => ({
                    ...it,
                    renderMode: 'squeeze',
                  })),
                };
              })
            }
            className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
              currentRenderMode === 'squeeze'
                ? 'bg-purple-600 text-white border-purple-400 shadow'
                : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>TV L-SHAPE WINDOW FIT + FULL IMAGE OVERLAY</span>
          </button>
        </div>

        {/* Logo Visibility Option During L-Shape Playing Time (Default: 1st Logo Only — Don't Play Sponsor Logos!) */}
        <div className="space-y-1.5 pt-1 border-t border-zinc-800/80">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-emerald-400 font-black uppercase">
              LOGO IN L-SHAPE PLAYING TIME (DEFAULT: PLAY 1ST LOGO ONLY • DON&apos;T PLAY SPONSOR LOGOS):
            </span>
            <span className="text-white font-bold">
              {(lShape.cgOverlayMode || activeItem?.cgOverlayMode || 'lshape_and_logo') ===
              'lshape_only'
                ? 'Active: Only L-Shape (No Logos)'
                : (lShape.cgOverlayMode || activeItem?.cgOverlayMode || 'lshape_and_logo') ===
                  'lshape_all_logos'
                ? 'Active: 1st Logo + Sponsor Logos'
                : 'Active: 1st Logo Only (Sponsor Logos Paused)'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[10px]">
            <button
              type="button"
              onClick={() =>
                onUpdateLShape((prev) => {
                  const base = prev || lShape;
                  return {
                    ...base,
                    cgOverlayMode: 'lshape_and_logo',
                    playlist: (base.playlist || []).map((it) => ({
                      ...it,
                      cgOverlayMode: 'lshape_and_logo',
                    })),
                  };
                })
              }
              className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                (lShape.cgOverlayMode || activeItem?.cgOverlayMode || 'lshape_and_logo') ===
                'lshape_and_logo'
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
              }`}
            >
              <span>✓ 1st Logo Only + L-Shape (No Sponsor Logos)</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateLShape((prev) => {
                  const base = prev || lShape;
                  return {
                    ...base,
                    cgOverlayMode: 'lshape_only',
                    playlist: (base.playlist || []).map((it) => ({
                      ...it,
                      cgOverlayMode: 'lshape_only',
                    })),
                  };
                })
              }
              className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                (lShape.cgOverlayMode || activeItem?.cgOverlayMode || 'lshape_and_logo') ===
                'lshape_only'
                  ? 'bg-amber-500 text-black border-amber-300 shadow'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
              }`}
            >
              <span>Only L-Shape (Hide All Logos)</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateLShape((prev) => {
                  const base = prev || lShape;
                  return {
                    ...base,
                    cgOverlayMode: 'lshape_all_logos',
                    playlist: (base.playlist || []).map((it) => ({
                      ...it,
                      cgOverlayMode: 'lshape_all_logos',
                    })),
                  };
                })
              }
              className={`py-2 px-2.5 rounded font-black border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                (lShape.cgOverlayMode || activeItem?.cgOverlayMode || 'lshape_and_logo') ===
                'lshape_all_logos'
                  ? 'bg-sky-600 text-white border-sky-400 shadow'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
              }`}
            >
              <span>1st Logo + Sponsor Logos + L-Shape</span>
            </button>
          </div>
        </div>

        {/* L-Shape Size Presets (Full Image / Too Small / Extra Small / Very Small / Small / Compact / Medium / Big + Custom Sliders) */}
        <div className="space-y-2 pt-1 border-t border-zinc-800/80">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-amber-300 font-black uppercase">
              L-SHAPE SIZE OPTIONS (FULL IMAGE • TOO SMALL • EXTRA SMALL • SMALL • MEDIUM • BIG):
            </span>
            <span className="text-cyan-300 font-bold">
              {lShape.presetSize === 'full_image'
                ? 'Active Size: 100% Full L-Shape Image'
                : `Active Size: ${lShape.sideWidth || 280}px × ${lShape.bottomHeight || 130}px`}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1 text-[9px]">
            {LSHAPE_SIZE_PRESETS.map((sz) => {
              const isSelected =
                sz.id === 'full_image'
                  ? lShape.presetSize === 'full_image'
                  : lShape.presetSize !== 'full_image' &&
                    (lShape.sideWidth || 280) === sz.w &&
                    (lShape.bottomHeight || 130) === sz.h;
              return (
                <button
                  key={sz.id}
                  type="button"
                  onClick={() =>
                    onUpdateLShape((prev) => {
                      const base = prev || lShape;
                      return {
                        ...base,
                        presetSize: sz.id as any,
                        sideWidth: sz.w,
                        bottomHeight: sz.h,
                        playlist: (base.playlist || []).map((it) => ({
                          ...it,
                          presetSize: sz.id as any,
                          sideWidth: sz.w,
                          bottomHeight: sz.h,
                        })),
                      };
                    })
                  }
                  className={`py-1.5 px-1.5 rounded font-black border transition cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-black border-amber-300 shadow'
                      : 'bg-black text-zinc-300 border-zinc-800 hover:border-amber-500/60 hover:text-white'
                  }`}
                >
                  {sz.label}
                </button>
              );
            })}
          </div>

          {/* Fine-Tune Width & Height Sliders (Down to Too Small 60×32px) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-black/60 p-2 rounded border border-zinc-800/80 text-[10px]">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-zinc-400 font-bold">SIDE BAR WIDTH (60px – 560px):</span>
                <span className="text-amber-400 font-black">{lShape.sideWidth || 280}px</span>
              </div>
              <input
                type="range"
                min={60}
                max={560}
                step={2}
                value={lShape.sideWidth || 280}
                onChange={(e) => {
                  const w = Number(e.target.value);
                  onUpdateLShape((prev) => {
                    const base = prev || lShape;
                    return {
                      ...base,
                      presetSize: 'custom',
                      sideWidth: w,
                      playlist: (base.playlist || []).map((it) => ({
                        ...it,
                        sideWidth: w,
                      })),
                    };
                  });
                }}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-zinc-400 font-bold">BOTTOM BAR HEIGHT (32px – 280px):</span>
                <span className="text-cyan-400 font-black">{lShape.bottomHeight || 130}px</span>
              </div>
              <input
                type="range"
                min={32}
                max={280}
                step={2}
                value={lShape.bottomHeight || 130}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  onUpdateLShape((prev) => {
                    const base = prev || lShape;
                    return {
                      ...base,
                      presetSize: 'custom',
                      bottomHeight: h,
                      playlist: (base.playlist || []).map((it) => ({
                        ...it,
                        bottomHeight: h,
                      })),
                    };
                  });
                }}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. L-SHAPE PLAYLIST ITEMS (EACH L-SHAPE HAS ITS OWN PLAY SECONDS, DATE & TIME SLOTS, LEFT/RIGHT & OVERLAY OPTIONS) */}
      <div className="bg-zinc-950 rounded-lg border border-zinc-800 shadow-md overflow-hidden">
        <div className="px-3 py-2 bg-black border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-white">
              L-SHAPE PLAYLIST ({tickedCount}/{playlist.length} ACTIVE FOR OUTPUT)
            </span>
            {playlist.length > 0 && (
              <span
                className={`px-2 py-0.5 rounded border text-[9px] font-black ${
                  isLShapeVisibleNow
                    ? 'bg-purple-950/80 border-purple-500 text-purple-200'
                    : 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                }`}
              >
                {isLShapeVisibleNow
                  ? `🔥 SHOWING IN OUTPUT (${lShape.currentTime || 0}s / ${
                      playlist[lShape.currentIndex || 0]?.duration || lShape.intervalSeconds || 15
                    }s)`
                  : `📺 FULL SCREEN • Next L-Shape in ${Math.floor(
                      remainingWaitSec / 60
                    )}m ${remainingWaitSec % 60}s`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {playlist.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const enabledIdxList = playlist
                    .map((it, idx) => (it.enabled !== false ? idx : -1))
                    .filter((idx) => idx >= 0);
                  if (enabledIdxList.length === 0) return;
                  onUpdateLShape({
                    enabled: true,
                    keyEnabled: true,
                    isPlaying: true,
                    opacity: 1,
                    periodicActive: true,
                    periodicCounter: 0,
                    currentIndex: enabledIdxList[0],
                    dueQueueIndices: enabledIdxList.slice(1),
                    currentTime: 0,
                  });
                }}
                className="px-2.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-black rounded text-[9px] font-black cursor-pointer"
              >
                ▶ Play All 1-by-1 ({tickedCount})
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onUpdateLShape({
                  playlist: playlist.map((it) => ({ ...it, enabled: true })),
                })
              }
              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 rounded border border-zinc-800 text-[9px] font-bold cursor-pointer"
            >
              ☑ Tick All
            </button>
            <button
              type="button"
              onClick={triggerSaveToast}
              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[9px] font-black cursor-pointer"
            >
              ✓ Save Playlist
            </button>
          </div>
        </div>

        <div className="divide-y divide-zinc-900 max-h-[560px] overflow-y-auto">
          {Array.from(
            new Set(
              playlist
                .map((it) => it.folderName)
                .filter((f): f is string => Boolean(f))
            )
          ).map((folderName) => {
            const folderItems = playlist.filter((it) => it.folderName === folderName);
            const folderCount = folderItems.length;
            const isFolderExpanded = Boolean(expandedLShapeFolders[folderName]);
            const isFolderTimeExpanded = Boolean(expandedLShapeFolderTime[folderName]);
            const sampleItem = folderItems[0];
            const folderTracks =
              sampleItem?.selectedTracks && sampleItem.selectedTracks.length > 0
                ? sampleItem.selectedTracks
                : lShape.selectedTracks && lShape.selectedTracks.length > 0
                ? lShape.selectedTracks
                : [1];
            const folderSlots = ensureDefaultTickedSlots(
              sampleItem?.tickedSlots || lShape.tickedSlots,
              folderTracks,
              sampleItem?.track6Preset || lShape.track6Preset || 'text'
            );
            const folderCountdown = getNextTickedSlotCountdown(folderSlots);
            return (
              <div
                key={`lshape-folder-${folderName}`}
                className="bg-purple-950/30 border-b border-purple-500/40"
              >
                <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedLShapeFolders((prev) => ({
                        ...prev,
                        [folderName]: !prev[folderName],
                      }))
                    }
                    className="flex items-center gap-2 text-left min-w-0 flex-1 cursor-pointer group"
                    title="Click folder to show/hide all L-Shape files inside (same like Main Playlist)"
                  >
                    {isFolderExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-purple-300 group-hover:text-amber-400 shrink-0" />
                    )}
                    {isFolderExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    )}
                    <span className="font-bold text-purple-100 group-hover:text-amber-300 truncate">
                      {folderName}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-200 text-[9px] font-bold">
                      {folderCount} L-Shape Ads
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-purple-950/90 border border-purple-500/40 text-purple-200 text-[9px] font-bold">
                      📅 Date: {formatAdDateSummary(sampleItem || lShape)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 text-[9px] font-bold">
                      {folderSlots.length} Times • Next: {folderCountdown.nextSlot12Hr}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/40 text-amber-300 text-[9px] font-bold">
                      ⏳ Full Waiting: {formatWaitingDuration(folderCountdown.secondsUntilNext)}
                    </span>
                    <span className="text-[9px] font-bold text-amber-300 underline">
                      {isFolderExpanded ? '▼ Hide Folder Files' : `▶ Click to Show All (${folderCount}) Files`}
                    </span>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedLShapeFolderTime((prev) => ({
                          ...prev,
                          [folderName]: !prev[folderName],
                        }))
                      }
                      className={`px-2 py-0.5 rounded border text-[9px] font-bold cursor-pointer ${
                        isFolderTimeExpanded
                          ? 'bg-amber-500 text-black border-amber-300'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      ⏰ {isFolderTimeExpanded ? 'Hide Folder Time' : 'Set Folder Time'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLShape((prev) => {
                          const base = prev || lShape;
                          const filtered = (base.playlist || []).filter(
                            (it) => it.folderName !== folderName
                          );
                          return {
                            ...base,
                            playlist: filtered,
                            currentIndex: 0,
                          };
                        })
                      }
                      className="px-2 py-0.5 rounded bg-red-950/80 hover:bg-red-800 text-red-200 border border-red-500/40 text-[9px] font-bold cursor-pointer"
                    >
                      Remove Folder
                    </button>
                  </div>
                </div>

                {isFolderTimeExpanded && (
                  <div className="px-3 pb-2.5 pt-1 border-t border-purple-500/20 bg-black/80">
                    <AdTrackingTimeGrid
                      compact
                      defaultGridExpanded={true}
                      title={`FOLDER DATE & TIME: ${folderName.toUpperCase()} (APPLIES TO ALL ${folderCount} L-SHAPE ADS IN FOLDER)`}
                      saveButtonLabel={`💾 SAVE DATE & TIME FOR FOLDER "${folderName}" (${folderCount} ADS)`}
                      applyToAllLabel={`💾 Apply Date & Time to ALL L-Shape Ads (${playlist.length})`}
                      selectedTracks={folderTracks}
                      tickedSlots={folderSlots}
                      customTracks={sampleItem?.customTracks || lShape.customTracks || []}
                      track6Preset={sampleItem?.track6Preset || lShape.track6Preset || 'text'}
                      dateMode={sampleItem?.dateMode || lShape.dateMode || 'every_day'}
                      scheduledDate={sampleItem?.scheduledDate || lShape.scheduledDate}
                      startDate={sampleItem?.startDate || lShape.startDate}
                      endDate={sampleItem?.endDate || lShape.endDate}
                      onUpdate={({
                        selectedTracks,
                        tickedSlots,
                        customTracks,
                        track6Preset,
                        dateMode,
                        scheduledDate,
                        startDate,
                        endDate,
                      }) => {
                        onUpdateLShape((prev) => {
                          const base = prev || lShape;
                          return {
                            ...base,
                            enabled: true,
                            keyEnabled: true,
                            isPlaying: true,
                            playMode: 'periodic',
                            lastTriggeredSlotKey: undefined,
                            playlist: (base.playlist || []).map((it) =>
                              it.folderName === folderName
                                ? {
                                    ...it,
                                    selectedTracks,
                                    tickedSlots,
                                    customTracks,
                                    track6Preset,
                                    dateMode,
                                    scheduledDate,
                                    startDate,
                                    endDate,
                                    lastTriggeredSlotKey: undefined,
                                  }
                                : it
                            ),
                          };
                        });
                      }}
                      onSave={({
                        selectedTracks,
                        tickedSlots,
                        customTracks,
                        track6Preset,
                        dateMode,
                        scheduledDate,
                        startDate,
                        endDate,
                      }) => {
                        onUpdateLShape((prev) => {
                          const base = prev || lShape;
                          return {
                            ...base,
                            enabled: true,
                            keyEnabled: true,
                            isPlaying: true,
                            playMode: 'periodic',
                            lastTriggeredSlotKey: undefined,
                            playlist: (base.playlist || []).map((it) =>
                              it.folderName === folderName
                                ? {
                                    ...it,
                                    selectedTracks,
                                    tickedSlots,
                                    customTracks,
                                    track6Preset,
                                    dateMode,
                                    scheduledDate,
                                    startDate,
                                    endDate,
                                    lastTriggeredSlotKey: undefined,
                                  }
                                : it
                            ),
                          };
                        });
                        triggerSaveToast();
                      }}
                      onApplyToAll={({
                        selectedTracks,
                        tickedSlots,
                        customTracks,
                        track6Preset,
                        dateMode,
                        scheduledDate,
                        startDate,
                        endDate,
                      }) => {
                        onUpdateLShape((prev) => {
                          const base = prev || lShape;
                          return {
                            ...base,
                            enabled: true,
                            keyEnabled: true,
                            isPlaying: true,
                            playMode: 'periodic',
                            selectedTracks,
                            tickedSlots,
                            customTracks,
                            track6Preset,
                            dateMode,
                            scheduledDate,
                            startDate,
                            endDate,
                            lastTriggeredSlotKey: undefined,
                            playlist: (base.playlist || []).map((it) => ({
                              ...it,
                              selectedTracks,
                              tickedSlots,
                              customTracks,
                              track6Preset,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                              lastTriggeredSlotKey: undefined,
                            })),
                          };
                        });
                        triggerSaveToast();
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {playlist.map((item, idx) => {
              if (item.folderName && !expandedLShapeFolders[item.folderName]) {
                return null;
              }
              const isTicked = item.enabled !== false;
              const isCurrent =
                idx === (lShape.currentIndex || 0) && isLShapeVisibleNow && isTicked;
              const isVideo = item.mediaType === 'video' || item.mediaType === 'swf';
              const isEditing = editingItemId === item.id;
              const itemSide = item.side || lShape.side || 'left';
              const itemRenderMode =
                item.renderMode ||
                lShape.renderMode ||
                (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze');
              const itemTracks =
                item.selectedTracks && item.selectedTracks.length > 0
                  ? item.selectedTracks
                  : lShape.selectedTracks && lShape.selectedTracks.length > 0
                  ? lShape.selectedTracks
                  : [((idx % 6) + 1)];
              const itemSlots = ensureDefaultTickedSlots(
                item.tickedSlots || lShape.tickedSlots,
                itemTracks,
                item.track6Preset || lShape.track6Preset || 'text'
              );
              const itemCountdown = getNextTickedSlotCountdown(itemSlots);
              const itemPlaySec = item.duration || 15;
              const isItemDetailsExpanded = Boolean(expandedLShapeItemTime[item.id]);

              return (
                <div
                  key={item.id}
                  className={`p-2.5 transition ${
                    isCurrent
                      ? 'bg-red-950/35 border-l-4 border-red-500'
                      : isTicked
                      ? 'bg-zinc-950 hover:bg-zinc-900/60'
                      : 'bg-black/40 opacity-60'
                  }`}
                >
                  {/* Top Row of Item */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      {/* Tick Checkbox */}
                      <button
                        type="button"
                        onClick={() => handleToggleItemTick(idx)}
                        className={`mt-0.5 p-1 rounded border transition shrink-0 cursor-pointer ${
                          isTicked
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-white'
                        }`}
                      >
                        {isTicked ? (
                          <CheckSquare className="w-3.5 h-3.5" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Thumbnail Preview */}
                      <div
                        onClick={() =>
                          onUpdateLShape({
                            enabled: true,
                            keyEnabled: true,
                            isPlaying: true,
                            opacity: 1,
                            side: itemSide,
                            renderMode: itemRenderMode,
                            squeezeProgramVideo: itemRenderMode === 'squeeze',
                            periodicActive: true,
                            periodicCounter: 0,
                            currentIndex: idx,
                            currentTime: 0,
                            playlist: playlist.map((it, i) =>
                              i === idx ? { ...it, enabled: true } : it
                            ),
                          })
                        }
                        className="w-14 h-10 bg-black rounded border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center cursor-pointer relative group"
                        title="Click to Play this L-Shape on screen now"
                      >
                        {isVideo ? (
                          <Film className="w-4 h-4 text-blue-400" />
                        ) : item.url ? (
                          <img
                            src={item.url}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-zinc-600" />
                        )}
                        <div className="absolute inset-0 bg-red-600/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Play className="w-3.5 h-3.5 text-white fill-current" />
                        </div>
                      </div>

                      {/* Title & Complete Playout Details */}
                      <div
                        onClick={() =>
                          setExpandedLShapeItemTime((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className="min-w-0 flex-1 cursor-pointer"
                        title="Click to open/close 48-Slot Time Box & L-Shape Play Options"
                      >
                        <div className="flex items-center gap-1 flex-wrap">
                          <span
                            className={`text-[9px] font-black px-1 py-0.2 rounded ${
                              isVideo
                                ? 'bg-blue-950 text-blue-300 border border-blue-800'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {item.mediaType.toUpperCase()}
                          </span>
                          <span className="text-[9px] bg-purple-950/90 text-purple-200 px-1.5 rounded border border-purple-700 font-bold">
                            HOW PLAYED: {itemRenderMode === 'overlay' ? 'L-SHAPE OVERLAY ON VIDEO' : 'L-SHAPE SHARP SQUEEZE'} ({itemSide === 'left' ? '◱ LEFT' : '◲ RIGHT'} • {item.sideWidth || lShape.sideWidth || 280}×{item.bottomHeight || lShape.bottomHeight || 130}px)
                          </span>
                          <span className="text-[9px] bg-cyan-950/90 text-cyan-300 px-1.5 rounded border border-cyan-800 font-bold">
                            Play {itemPlaySec}s •{' '}
                            {itemTracks.length >= 6
                              ? 'All 6 Tracks'
                              : `Track ${itemTracks.join(', ')}`}{' '}
                            ({itemSlots.length} Times)
                          </span>
                          <span className="text-[9px] bg-purple-950/90 text-purple-200 px-1.5 rounded border border-purple-700 font-bold">
                            📅 Date: {formatAdDateSummary(item)}
                          </span>
                          <span className="text-[9px] bg-emerald-950/90 text-emerald-300 px-1.5 rounded border border-emerald-700 font-bold">
                            ⏰ Play Window: {formatSlotPlayWindow(itemCountdown.nextSlotHHMM, itemPlaySec)}
                          </span>
                          <span className="text-[9px] bg-amber-950/90 text-amber-300 px-1.5 rounded border border-amber-700 font-bold">
                            ⏳ Full Waiting: {formatWaitingDuration(itemCountdown.secondsUntilNext)}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] bg-red-600 text-white px-1.5 rounded font-black animate-pulse">
                              ON AIR ({lShape.currentTime || 0}s/{itemPlaySec}s)
                            </span>
                          )}
                        </div>
                        <p className="font-bold text-white truncate text-[11px] mt-0.5 flex items-center gap-1.5">
                          <span>{idx + 1}. {item.fileName || item.title}</span>
                          {item.folderName && (
                            <span className="px-1.5 py-0.2 rounded bg-purple-900/80 border border-purple-500/40 text-purple-200 text-[9px] font-bold shrink-0">
                              📁 {item.folderName}
                            </span>
                          )}
                        </p>
                        <div className="mt-0.5 text-[9px] text-zinc-400 truncate">
                          <span className="text-zinc-500 font-bold">Selected Times ({itemSlots.length}): </span>
                          <span className="text-emerald-300 font-mono">
                            {itemSlots.length > 0
                              ? itemSlots.slice(0, 8).map((s) => formatHHMMTo12HrWithSec(s)).join(', ') +
                                (itemSlots.length > 8 ? ` ... +${itemSlots.length - 8} more` : '')
                              : 'None'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons: TIME & OPTIONS, PLAY, EDIT, UP, DOWN, DELETE */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLShapeItemTime((prev) => ({
                            ...prev,
                            [item.id]: !prev[item.id],
                          }))
                        }
                        className={`px-2 py-1 rounded border text-[10px] font-bold transition cursor-pointer ${
                          isItemDetailsExpanded
                            ? 'bg-amber-500 text-black border-amber-300'
                            : 'bg-zinc-900 text-amber-300 hover:text-white border-zinc-700'
                        }`}
                      >
                        ⏰ {isItemDetailsExpanded ? 'Hide Time' : 'Set Time'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateLShape({
                            enabled: true,
                            keyEnabled: true,
                            isPlaying: true,
                            opacity: 1,
                            side: itemSide,
                            renderMode: itemRenderMode,
                            squeezeProgramVideo: itemRenderMode === 'squeeze',
                            periodicActive: true,
                            periodicCounter: 0,
                            currentIndex: idx,
                            currentTime: 0,
                            playlist: playlist.map((it, i) =>
                              i === idx ? { ...it, enabled: true } : it
                            ),
                          })
                        }
                        className={`px-2 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                          isCurrent
                            ? 'bg-red-600 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        PLAY
                      </button>

                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditingItemId(null) : startEditing(item))}
                        className={`px-2 py-1 rounded border text-[10px] font-bold flex items-center gap-1 transition cursor-pointer ${
                          isEditing
                            ? 'bg-amber-500 text-black border-amber-400'
                            : 'bg-zinc-900 text-amber-300 hover:text-white border-zinc-700'
                        }`}
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>EDIT</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMoveItem(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveItem(idx, 'down')}
                        disabled={idx === playlist.length - 1}
                        className="p-1 text-zinc-400 hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteItem(idx)}
                        className="p-1 rounded bg-zinc-900 hover:bg-rose-950 text-zinc-400 hover:text-rose-400 border border-zinc-800 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Per-Item Time & L-Shape Options (Shown when user clicks file row or ⏰ Set Time) */}
                  {isItemDetailsExpanded && (
                  <div className="mt-2 pt-2 border-t border-zinc-900 space-y-2 text-[10px]">
                    {/* Row A: Play Duration Seconds on this L-Shape Item */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <span className="text-amber-300 font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>PLAY SECONDS (HOW LONG THIS L-SHAPE SHOWS IN OUTPUT):</span>
                        </span>
                        <span className="text-zinc-400 font-bold">
                          Active: <strong className="text-amber-400">{item.duration || 15}s</strong>
                        </span>
                      </div>
                      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                        {LSHAPE_TIME_OPTIONS.map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => {
                              const updated = playlist.map((it, i) =>
                                i === idx ? { ...it, duration: sec, autoVideoDuration: false } : it
                              );
                              onUpdateLShape({
                                enabled: true,
                                keyEnabled: true,
                                isPlaying: true,
                                opacity: 1,
                                intervalSeconds: sec,
                                periodicActive: true,
                                periodicCounter: 0,
                                currentTime: 0,
                                playlist: updated,
                              });
                            }}
                            className={`py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                              (item.duration || 15) === sec
                                ? 'bg-amber-500 text-black border-amber-300 shadow'
                                : 'bg-black text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:text-white'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Row B: Track 1–6 Full-Day Date & Time Tracking & 48 Time Slots Checkbox Grid on this L-Shape Item */}
                    <AdTrackingTimeGrid
                      compact
                      defaultGridExpanded={true}
                      saveButtonLabel="💾 SAVE L-SHAPE DATE & TIME"
                      applyToAllLabel={`💾 Apply Date & Time to ALL L-Shape Ads (${playlist.length})`}
                      title={`L-SHAPE #${idx + 1} DATE & TIME TRACKING (TRACK 1–6 • ALL 6 TRACKS • 48 SLOTS/DAY)`}
                      selectedTracks={
                        item.selectedTracks && item.selectedTracks.length > 0
                          ? item.selectedTracks
                          : lShape.selectedTracks && lShape.selectedTracks.length > 0
                          ? lShape.selectedTracks
                          : [((idx % 6) + 1)]
                      }
                      tickedSlots={ensureDefaultTickedSlots(
                        item.tickedSlots || lShape.tickedSlots,
                        item.selectedTracks && item.selectedTracks.length > 0
                          ? item.selectedTracks
                          : lShape.selectedTracks && lShape.selectedTracks.length > 0
                          ? lShape.selectedTracks
                          : [((idx % 6) + 1)],
                        item.track6Preset || lShape.track6Preset || 'text'
                      )}
                      customTracks={item.customTracks || lShape.customTracks || []}
                      track6Preset={item.track6Preset || lShape.track6Preset || 'text'}
                      dateMode={item.dateMode || lShape.dateMode || 'every_day'}
                      scheduledDate={item.scheduledDate || lShape.scheduledDate}
                      startDate={item.startDate || lShape.startDate}
                      endDate={item.endDate || lShape.endDate}
                      onUpdate={({
                        selectedTracks: nextTracks,
                        tickedSlots: nextSlots,
                        customTracks: nextCustom,
                        track6Preset: nextPreset,
                        dateMode: nextDateMode,
                        scheduledDate: nextScheduledDate,
                        startDate: nextStartDate,
                        endDate: nextEndDate,
                      }) => {
                        const updated = playlist.map((it, i) =>
                          i === idx
                            ? {
                                ...it,
                                selectedTracks: nextTracks,
                                tickedSlots: nextSlots,
                                customTracks: nextCustom,
                                track6Preset: nextPreset,
                                dateMode: nextDateMode,
                                scheduledDate: nextScheduledDate,
                                startDate: nextStartDate,
                                endDate: nextEndDate,
                                lastTriggeredSlotKey: undefined,
                              }
                            : nextCustom
                            ? { ...it, customTracks: nextCustom }
                            : it
                        );
                        onUpdateLShape({
                          enabled: true,
                          keyEnabled: true,
                          isPlaying: true,
                          playMode: 'periodic',
                          selectedTracks: nextTracks,
                          tickedSlots: nextSlots,
                          customTracks: nextCustom || lShape.customTracks,
                          track6Preset: nextPreset || lShape.track6Preset,
                          dateMode: nextDateMode,
                          scheduledDate: nextScheduledDate,
                          startDate: nextStartDate,
                          endDate: nextEndDate,
                          lastTriggeredSlotKey: undefined,
                          playlist: updated,
                        });
                      }}
                      onSave={({
                        selectedTracks: nextTracks,
                        tickedSlots: nextSlots,
                        customTracks: nextCustom,
                        track6Preset: nextPreset,
                        dateMode: nextDateMode,
                        scheduledDate: nextScheduledDate,
                        startDate: nextStartDate,
                        endDate: nextEndDate,
                      }) => {
                        const updated = playlist.map((it, i) =>
                          i === idx
                            ? {
                                ...it,
                                selectedTracks: nextTracks,
                                tickedSlots: nextSlots,
                                customTracks: nextCustom,
                                track6Preset: nextPreset,
                                dateMode: nextDateMode,
                                scheduledDate: nextScheduledDate,
                                startDate: nextStartDate,
                                endDate: nextEndDate,
                                lastTriggeredSlotKey: undefined,
                              }
                            : nextCustom
                            ? { ...it, customTracks: nextCustom }
                            : it
                        );
                        onUpdateLShape({
                          enabled: true,
                          keyEnabled: true,
                          isPlaying: true,
                          playMode: 'periodic',
                          selectedTracks: nextTracks,
                          tickedSlots: nextSlots,
                          customTracks: nextCustom || lShape.customTracks,
                          track6Preset: nextPreset || lShape.track6Preset,
                          dateMode: nextDateMode,
                          scheduledDate: nextScheduledDate,
                          startDate: nextStartDate,
                          endDate: nextEndDate,
                          lastTriggeredSlotKey: undefined,
                          playlist: updated,
                        });
                        triggerSaveToast();
                      }}
                      onApplyToAll={({
                        selectedTracks: nextTracks,
                        tickedSlots: nextSlots,
                        customTracks: nextCustom,
                        track6Preset: nextPreset,
                        dateMode: nextDateMode,
                        scheduledDate: nextScheduledDate,
                        startDate: nextStartDate,
                        endDate: nextEndDate,
                      }) => {
                        const updated = playlist.map((it) => ({
                          ...it,
                          selectedTracks: nextTracks,
                          tickedSlots: nextSlots,
                          customTracks: nextCustom,
                          track6Preset: nextPreset,
                          dateMode: nextDateMode,
                          scheduledDate: nextScheduledDate,
                          startDate: nextStartDate,
                          endDate: nextEndDate,
                          lastTriggeredSlotKey: undefined,
                        }));
                        onUpdateLShape({
                          enabled: true,
                          keyEnabled: true,
                          isPlaying: true,
                          playMode: 'periodic',
                          selectedTracks: nextTracks,
                          tickedSlots: nextSlots,
                          customTracks: nextCustom || lShape.customTracks,
                          track6Preset: nextPreset || lShape.track6Preset,
                          dateMode: nextDateMode,
                          scheduledDate: nextScheduledDate,
                          startDate: nextStartDate,
                          endDate: nextEndDate,
                          lastTriggeredSlotKey: undefined,
                          playlist: updated,
                        });
                        triggerSaveToast();
                      }}
                    />

                    {/* Row C: Per-Item Left/Right Side, Overlay vs Squeeze, Non-PNG Cutout & CG Overlay */}
                    <div className="flex items-center justify-between gap-1.5 flex-wrap pt-1 border-t border-zinc-900/80">
                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            const nextSide: 'left' | 'right' =
                              itemSide === 'left' ? 'right' : 'left';
                            const updated = playlist.map((it, i) =>
                              i === idx ? { ...it, side: nextSide } : it
                            );
                            onUpdateLShape({ side: nextSide, playlist: updated });
                          }}
                          className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-amber-300 border border-zinc-700 font-bold cursor-pointer"
                        >
                          {itemSide === 'left' ? '◱ Left Side' : '◲ Right Side'}
                        </button>

                        {/* Per-Item L-Shape Size Selector (Full Image / Too Small / Extra Small / Very Small / Small / Compact / Medium / Big) */}
                        <select
                          value={item.presetSize || lShape.presetSize || 'full_image'}
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            const matchedPreset = LSHAPE_SIZE_PRESETS.find(
                              (p) => p.id === selectedId
                            );
                            const nextW = matchedPreset ? matchedPreset.w : item.sideWidth || lShape.sideWidth || 280;
                            const nextH = matchedPreset ? matchedPreset.h : item.bottomHeight || lShape.bottomHeight || 130;
                            const updated = playlist.map((it, i) =>
                              i === idx
                                ? {
                                    ...it,
                                    presetSize: selectedId as any,
                                    sideWidth: nextW,
                                    bottomHeight: nextH,
                                  }
                                : it
                            );
                            onUpdateLShape({
                              presetSize: selectedId as any,
                              sideWidth: nextW,
                              bottomHeight: nextH,
                              playlist: updated,
                            });
                          }}
                          className="bg-black text-amber-300 border border-amber-700 rounded px-1.5 py-0.5 font-bold cursor-pointer"
                          title="Choose L-Shape Size (Full Image, Too Small, Extra Small, Very Small, Small, Compact, Medium, Big)"
                        >
                          {LSHAPE_SIZE_PRESETS.map((sz) => (
                            <option key={sz.id} value={sz.id}>
                              Size: {sz.label}
                            </option>
                          ))}
                          {(item.presetSize === 'custom' || lShape.presetSize === 'custom') && (
                            <option value="custom">
                              Custom ({item.sideWidth || lShape.sideWidth || 280}×
                              {item.bottomHeight || lShape.bottomHeight || 130})
                            </option>
                          )}
                        </select>

                        {/* Per-Item Mode Selector: Overlay Play vs Sharp Squeeze */}
                        <select
                          value={itemRenderMode}
                          onChange={(e) => {
                            const nextMode = e.target.value as 'squeeze' | 'overlay';
                            const updated = playlist.map((it, i) =>
                              i === idx ? { ...it, renderMode: nextMode } : it
                            );
                            onUpdateLShape({
                              renderMode: nextMode,
                              squeezeProgramVideo: nextMode === 'squeeze',
                              playlist: updated,
                            });
                          }}
                          className="bg-black text-purple-300 border border-purple-800 rounded px-1.5 py-0.5 font-bold cursor-pointer"
                          title="Choose Overlay Play on Top or Sharp Squeeze for this L-Shape"
                        >
                          <option value="overlay">Overlay On Video</option>
                          <option value="squeeze">Sharp Squeeze</option>
                        </select>

                        {/* Per-Item Non-PNG / PNG Cutout Option */}
                        <select
                          value={item.displayZone || lShape.displayZone || 'full_l_canvas'}
                          onChange={(e) => {
                            const nextZone = e.target.value as any;
                            const updated = playlist.map((it, i) =>
                              i === idx ? { ...it, displayZone: nextZone } : it
                            );
                            onUpdateLShape({
                              displayZone: nextZone,
                              playlist: updated,
                            });
                          }}
                          className="bg-black text-emerald-300 border border-emerald-800 rounded px-1.5 py-0.5 font-bold cursor-pointer"
                          title="How Non-PNG (Video/JPG/SWF) or PNG L-Shape cuts out the main video window"
                        >
                          <option value="full_l_canvas">Auto L-Cutout (PNG &amp; Non-PNG)</option>
                          <option value="chroma_key">Key Out Black/Green Window</option>
                          <option value="smart_l">Split Wings (Side + Bottom)</option>
                        </select>

                        {/* Per-Item CG Overlay Option (Default: 1st Logo Only + L-Shape, No Sponsor Logos & No Tickers) */}
                        <select
                          value={item.cgOverlayMode || lShape.cgOverlayMode || 'lshape_and_logo'}
                          onChange={(e) => {
                            const nextCg = e.target.value as any;
                            const updated = playlist.map((it, i) =>
                              i === idx ? { ...it, cgOverlayMode: nextCg } : it
                            );
                            onUpdateLShape({ cgOverlayMode: nextCg, playlist: updated });
                          }}
                          className="bg-black text-sky-300 border border-sky-800 rounded px-1.5 py-0.5 font-bold cursor-pointer"
                          title="Which Logos show when this L-Shape plays (Default: 1st Logo Only, No Sponsor Logos)"
                        >
                          <option value="lshape_and_logo">
                            1st Logo Only + L-Shape (No Sponsor Logos)
                          </option>
                          <option value="lshape_only">Only L-Shape (Hide All Logos)</option>
                          <option value="lshape_all_logos">
                            1st Logo + Sponsor Logos + L-Shape
                          </option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={triggerSaveToast}
                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[9px] cursor-pointer"
                      >
                        ✓ Save Item
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Full Edit & Save Drawer */}
                  {isEditing && (
                    <div className="mt-2.5 p-2.5 bg-black rounded-lg border border-amber-500/70 space-y-2.5">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
                        <span className="text-[10px] font-black text-amber-400 uppercase">
                          EDIT &amp; SAVE L-SHAPE ITEM #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          className="text-zinc-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <label className="text-[9px] text-zinc-400 block mb-0.5">
                            L-SHAPE CLIP NAME:
                          </label>
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-white font-bold text-xs"
                          />
                        </div>

                        {/* Edit Left/Right Side & Squeeze/Overlay Mode */}
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[9px] text-zinc-400 block mb-1">
                              L-SHAPE SIDE:
                            </label>
                            <div className="grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                onClick={() => setEditSide('left')}
                                className={`py-1 rounded text-[9px] font-bold border ${
                                  editSide === 'left'
                                    ? 'bg-amber-500 text-black border-amber-300'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                ◱ Left Side
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditSide('right')}
                                className={`py-1 rounded text-[9px] font-bold border ${
                                  editSide === 'right'
                                    ? 'bg-amber-500 text-black border-amber-300'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                ◲ Right Side
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-[9px] text-zinc-400 block mb-1">
                              PLAY MODE (SQUEEZE OR OVERLAY):
                            </label>
                            <div className="grid grid-cols-2 gap-1">
                              <button
                                type="button"
                                onClick={() => setEditRenderMode('squeeze')}
                                className={`py-1 rounded text-[9px] font-bold border ${
                                  editRenderMode === 'squeeze'
                                    ? 'bg-purple-600 text-white border-purple-400'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                Sharp Squeeze
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditRenderMode('overlay')}
                                className={`py-1 rounded text-[9px] font-bold border ${
                                  editRenderMode === 'overlay'
                                    ? 'bg-cyan-600 text-white border-cyan-400'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                Overlay Play
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Non-PNG Overlay Cutout Mode & CG Overlay Mode */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[9px] text-zinc-400 block mb-1">
                              NON-PNG / PNG OVERLAY CUTOUT MODE:
                            </label>
                            <select
                              value={editDisplayZone}
                              onChange={(e) => setEditDisplayZone(e.target.value as any)}
                              className="w-full bg-zinc-950 border border-emerald-700 rounded px-2 py-1 text-emerald-300 font-bold text-[10px]"
                            >
                              <option value="full_l_canvas">
                                Auto L-Cutout (PNG &amp; Non-PNG Video/JPG)
                              </option>
                              <option value="chroma_key">
                                Key Out Solid Black/Green Window (Non-PNG)
                              </option>
                              <option value="smart_l">
                                Split Wings (Place Media in Side + Bottom)
                              </option>
                            </select>
                          </div>

                          <div>
                            <label className="text-[9px] text-zinc-400 block mb-1">
                              LOGO VISIBILITY DURING THIS L-SHAPE (DEFAULT: 1ST LOGO ONLY):
                            </label>
                            <select
                              value={editCgOverlayMode}
                              onChange={(e) => setEditCgOverlayMode(e.target.value as any)}
                              className="w-full bg-zinc-950 border border-sky-700 rounded px-2 py-1 text-sky-300 font-bold text-[10px]"
                            >
                              <option value="lshape_and_logo">
                                1st Logo Only + L-Shape (Don&apos;t Play Sponsor Logos)
                              </option>
                              <option value="lshape_only">Only L-Shape (Hide All Logos)</option>
                              <option value="lshape_all_logos">
                                1st Logo + Sponsor Logos + L-Shape
                              </option>
                            </select>
                          </div>
                        </div>

                        {/* Play Seconds (5s-60s) */}
                        <div>
                          <label className="text-[9px] text-zinc-400 block mb-1">
                            PLAY DURATION IN SECONDS (5s TO 60s):
                          </label>
                          <div className="grid grid-cols-6 gap-1 mb-1">
                            {LSHAPE_TIME_OPTIONS.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setEditDuration(s);
                                  setEditAutoVideo(false);
                                }}
                                className={`py-0.5 rounded text-[9px] font-bold border ${
                                  editDuration === s && !editAutoVideo
                                    ? 'bg-amber-500 text-black border-amber-400'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                }`}
                              >
                                {s}s
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Start Date & End Date Editor */}
                        <div className="p-2 rounded bg-zinc-950 border border-purple-800/60 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-purple-300 flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-purple-400" />
                              <span>PLAY DATE SCHEDULE (START DATE TO END DATE):</span>
                            </span>
                            <span className="text-[9px] text-zinc-400">
                              Plays only between Start Date &amp; End Date
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                            <div>
                              <label className="text-[9px] text-zinc-400 block mb-0.5">Date Schedule Mode:</label>
                              <select
                                value={item.dateMode || 'date_range'}
                                onChange={(e) => {
                                  const nextMode = e.target.value as any;
                                  const updated = playlist.map((it, i) =>
                                    i === idx ? { ...it, dateMode: nextMode } : it
                                  );
                                  onUpdateLShape({ playlist: updated });
                                }}
                                className="w-full bg-black border border-purple-700 rounded px-2 py-1 text-white font-bold text-[10px]"
                              >
                                <option value="date_range">📅 Date Range (Start Date → End Date)</option>
                                <option value="every_day">🔁 Every Day (Continuous)</option>
                                <option value="specific_date">📆 Specific Single Date Only</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-zinc-400 block mb-0.5">Start Date (From):</label>
                              <input
                                type="date"
                                value={item.startDate || getDefaultAdDateRange().startDate}
                                onChange={(e) => {
                                  const nextVal = e.target.value;
                                  const updated = playlist.map((it, i) =>
                                    i === idx ? { ...it, startDate: nextVal, dateMode: 'date_range' as const } : it
                                  );
                                  onUpdateLShape({ playlist: updated });
                                }}
                                className="w-full bg-black border border-purple-700 rounded px-2 py-1 text-amber-300 font-mono font-bold text-[10px]"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] text-zinc-400 block mb-0.5">End Date (To):</label>
                              <input
                                type="date"
                                value={item.endDate || getDefaultAdDateRange().endDate}
                                onChange={(e) => {
                                  const nextVal = e.target.value;
                                  const updated = playlist.map((it, i) =>
                                    i === idx ? { ...it, endDate: nextVal, dateMode: 'date_range' as const } : it
                                  );
                                  onUpdateLShape({ playlist: updated });
                                }}
                                className="w-full bg-black border border-purple-700 rounded px-2 py-1 text-amber-300 font-mono font-bold text-[10px]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Track 1-6 Ad Tracking inside Edit Drawer */}
                        <AdTrackingTimeGrid
                          compact
                          title={`EDIT TRACK 1–6 TIME SLOTS & DATE FOR L-SHAPE #${idx + 1}`}
                          selectedTracks={
                            item.selectedTracks && item.selectedTracks.length > 0
                              ? item.selectedTracks
                              : [((idx % 6) + 1)]
                          }
                          tickedSlots={ensureDefaultTickedSlots(
                            item.tickedSlots,
                            item.selectedTracks && item.selectedTracks.length > 0
                              ? item.selectedTracks
                              : [((idx % 6) + 1)],
                            item.track6Preset || 'text'
                          )}
                          customTracks={item.customTracks || lShape.customTracks || []}
                          track6Preset={item.track6Preset || lShape.track6Preset || 'text'}
                          dateMode={item.dateMode || 'date_range'}
                          scheduledDate={item.scheduledDate}
                          startDate={item.startDate || getDefaultAdDateRange().startDate}
                          endDate={item.endDate || getDefaultAdDateRange().endDate}
                          onUpdate={({
                            selectedTracks: nextTracks,
                            tickedSlots: nextSlots,
                            customTracks: nextCustom,
                            track6Preset: nextPreset,
                            dateMode: nextDateMode,
                            scheduledDate: nextScheduledDate,
                            startDate: nextStartDate,
                            endDate: nextEndDate,
                          }) => {
                            const updated = playlist.map((it, i) =>
                              i === idx
                                ? {
                                    ...it,
                                    selectedTracks: nextTracks,
                                    tickedSlots: nextSlots,
                                    customTracks: nextCustom,
                                    track6Preset: nextPreset,
                                    dateMode: nextDateMode,
                                    scheduledDate: nextScheduledDate,
                                    startDate: nextStartDate,
                                    endDate: nextEndDate,
                                    lastTriggeredSlotKey: undefined,
                                  }
                                : it
                            );
                            onUpdateLShape({
                              playlist: updated,
                            });
                          }}
                        />

                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-zinc-800">
                          <button
                            type="button"
                            onClick={() => {
                              setReplacingItemId(item.id);
                              replaceFileInputRef.current?.click();
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 text-[10px] font-bold cursor-pointer"
                          >
                            <Upload className="w-3 h-3 text-cyan-400" />
                            <span>Replace Media File</span>
                          </button>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingItemId(null)}
                              className="px-2.5 py-1 bg-zinc-900 text-zinc-400 rounded text-[10px] font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEditing(item)}
                              className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-black shadow cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>Save &amp; Apply</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
        </>
      )}
    </div>
  );
};
