import React, { useState, useRef } from 'react';
import {
  FileVideo,
  FolderPlus,
  Layers,
  Radio,
  Play,
  Square as StopIcon,
  Trash2,
  ArrowUp,
  ArrowDown,
  Edit3,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Clock,
  Calendar,
  ShieldCheck,
  Tv,
  Save,
  Repeat,
  Shuffle,
  SkipForward
} from 'lucide-react';
import {
  TVChannel,
  PlaylistItem,
  ScheduledProgram,
  ProgramOverlayMode,
  EveryNMinAdItem,
  EveryNMinIntervalOption,
  AdOverlayMode,
  LiveInputConfig
} from '../types/playout';
import { LiveInputStudioPanel } from './LiveInputStudioPanel';
import {
  ALL_VIDEO_AND_SWF_ACCEPT,
  ALL_CG_MEDIA_ACCEPT,
  filterFolderVideoAndSwfFiles,
  filterFolderCgMediaFiles,
  getFileExtension,
  isImageFile,
  isSwfFile,
  probeMediaFileDuration
} from '../services/swfEngine';
import {
  computeVaultIdForFile,
  extractFolderName,
  registerLiveMediaInVault,
  saveMediaToOfflineVault
} from '../services/offlineMediaVault';
import { AdTrackingTimeGrid } from './AdTrackingTimeGrid';
import {
  ensureDefaultTickedSlots,
  getTrack48HHMMs,
  getNextTickedSlotCountdown,
  formatAdDateSummary,
  getDefaultAdDateRange,
} from '../utils/adTrackingTracks';
import {
  buildFastPlaylistItems,
  createMediaBatchQueue,
  estimateMediaDurationSec,
  paginateFolderItems,
  shouldEagerUploadOnImport,
  shouldEagerVaultSaveOnImport,
} from '../utils/folderImport';

export type LeftWorkspaceTab = 'main' | 'program' | 'every_n_min' | 'live_input';

const DAYS_OF_WEEK = [
  { value: 'ALL', label: 'Every Day' },
  { value: 'SUN', label: 'Sunday' },
  { value: 'MON', label: 'Monday' },
  { value: 'TUE', label: 'Tuesday' },
  { value: 'WED', label: 'Wednesday' },
  { value: 'THU', label: 'Thursday' },
  { value: 'FRI', label: 'Friday' },
  { value: 'SAT', label: 'Saturday' },
];

interface LeftPlaylistWorkspaceProps {
  channel: TVChannel;
  activeLeftTab: LeftWorkspaceTab;
  onChangeLeftTab: (tab: LeftWorkspaceTab) => void;
  onImportVideos: (channelId: number, files: FileList | File[], folderName?: string) => void;
  onTakeClip: (channelId: number, index: number) => void;
  onRemoveClip: (channelId: number, clipId: string) => void;
  onRemoveFolder?: (channelId: number, folderName: string) => void;
  onToggleClipEnabled?: (channelId: number, clipId: string, enabled?: boolean) => void;
  onToggleFolderEnabled?: (channelId: number, folderName: string, enabled?: boolean) => void;
  onMoveClip: (channelId: number, index: number, dir: 'up' | 'down') => void;
  onSetLoopMode: (channelId: number, mode: 'off' | 'single' | 'playlist') => void;
  onToggleShuffle: (channelId: number) => void;
  onSkipNext?: (channelId: number) => void;
  onClearPlaylist: (channelId: number) => void;
  onUpdateScheduledPrograms: (
    channelId: number,
    programsOrUpdater:
      | ScheduledProgram[]
      | ((prev: ScheduledProgram[]) => ScheduledProgram[])
  ) => void;
  onStartScheduledProgramNow: (channelId: number, programId: string) => void;
  onStopScheduledProgramNow: (channelId: number) => void;
  everyNMinAds: EveryNMinAdItem[];
  everyNMinEnabled: boolean;
  everyNMinInterval: EveryNMinIntervalOption;
  everyNMinCountdownSec: number;
  onUpdateEveryNMinAds: (
    adsOrUpdater:
      | EveryNMinAdItem[]
      | ((prev: EveryNMinAdItem[]) => EveryNMinAdItem[]),
    enabled?: boolean,
    defaultInterval?: EveryNMinIntervalOption
  ) => void;
  onTriggerEveryNMinNow: (adId?: string, playAllOneByOne?: boolean) => void;
  onStopEveryNMinNow: () => void;
  onUpdateLiveInput?: (partial: Partial<LiveInputConfig>) => void;
  onStartCameraCapture?: (deviceId?: string) => void;
  onStopLiveInput?: () => void;
  onSaveChannel?: () => void;
  activeLiveStream?: MediaStream | null;
  onOpenModal?: (modal: any) => void;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getLocalTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalCurrentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getDefaultFutureProgramSchedule(minutesAhead: number = 10): {
  dateStr: string;
  timeStr: string;
} {
  const future = new Date(Date.now() + minutesAhead * 60 * 1000);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  const hh = String(future.getHours()).padStart(2, '0');
  const mm = String(future.getMinutes()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${d}`,
    timeStr: `${hh}:${mm}:00`,
  };
}

function formatOrdinalAd(num: number): string {
  if (num === 1) return '1st Ad';
  if (num === 2) return '2nd Ad';
  if (num === 3) return '3rd Ad';
  return `${num}th Ad`;
}

export const LeftPlaylistWorkspace: React.FC<LeftPlaylistWorkspaceProps> = ({
  channel,
  activeLeftTab,
  onChangeLeftTab,
  onImportVideos,
  onTakeClip,
  onRemoveClip,
  onRemoveFolder,
  onToggleClipEnabled,
  onToggleFolderEnabled,
  onMoveClip,
  onSetLoopMode,
  onToggleShuffle,
  onSkipNext,
  onClearPlaylist,
  onUpdateScheduledPrograms,
  onStartScheduledProgramNow,
  onStopScheduledProgramNow,
  everyNMinAds,
  everyNMinEnabled,
  everyNMinInterval,
  everyNMinCountdownSec,
  onUpdateEveryNMinAds,
  onTriggerEveryNMinNow,
  onStopEveryNMinNow,
  onUpdateLiveInput,
  onStartCameraCapture,
  onStopLiveInput,
  onSaveChannel,
  activeLiveStream,
  onOpenModal,
}) => {
  const [savedToast, setSavedToast] = useState(false);
  const [masterAdTracking, setMasterAdTracking] = useState<{
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode: '25_55' | '12_25';
    customTracks: any[];
  }>(() => {
    try {
      const saved = localStorage.getItem('ashoka_master_ad_tracking_v15');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.tickedSlots)) {
          return {
            tickedSlots: parsed.tickedSlots,
            selectedTracks: Array.isArray(parsed.selectedTracks) ? parsed.selectedTracks : [1],
            track6Mode: parsed.track6Mode === '12_25' ? '12_25' : '25_55',
            customTracks: Array.isArray(parsed.customTracks) ? parsed.customTracks : [],
          };
        }
      }
    } catch {}
    return {
      tickedSlots: getTrack48HHMMs(1, '25_55'),
      selectedTracks: [1],
      track6Mode: '25_55',
      customTracks: [],
    };
  });

  const triggerAdSaveToast = () => {
    if (onSaveChannel) onSaveChannel();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };
  // File & Folder Input Refs for Main Playlist
  const videoInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // File & Folder Input Refs for Program Playlist
  const progNewVideoInputRef = useRef<HTMLInputElement>(null);
  const progNewFolderInputRef = useRef<HTMLInputElement>(null);
  const progAppendVideoInputRef = useRef<HTMLInputElement>(null);

  // File & Folder Input Refs for Every N Min Ads
  const everyNMinInputRef = useRef<HTMLInputElement>(null);
  const everyNMinFolderInputRef = useRef<HTMLInputElement>(null);
  const replaceAdVideoInputRef = useRef<HTMLInputElement>(null);

  // Collapsible Folder States (Main Playlist & Program Playlist)
  // By default, folders are collapsed so only the folder row shows until clicked!
  const [expandedMainFolders, setExpandedMainFolders] = useState<Record<string, boolean>>({});
  const [expandedProgFolders, setExpandedProgFolders] = useState<Record<string, boolean>>({});
  const [folderPageByKey, setFolderPageByKey] = useState<Record<string, number>>({});

  // Program Playlist state
  const [selectedProgIdForAppend, setSelectedProgIdForAppend] = useState<string | null>(null);
  const [editingProgId, setEditingProgId] = useState<string | null>(null);

  // Every N Min Ads state
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [replaceVideoTargetAdId, setReplaceVideoTargetAdId] = useState<string | null>(null);

  const programs = channel.scheduledPrograms || [];

  // Count distinct folders in main playlist
  const folderSet = new Set(
    channel.playlist.map((it) => it.folderName).filter((f): f is string => !!f)
  );
  const folderCount = folderSet.size;
  const isLoop247 = channel.loopMode !== 'off';

  // Helper to normalize ad order indices (1, 2, 3...)
  const normalizeAdsOrder = (list: EveryNMinAdItem[]): EveryNMinAdItem[] =>
    list.map((ad, idx) => ({
      ...ad,
      orderIndex: idx + 1,
    }));

  // Update a single Program's fields directly when the user changes Date, Time, One Time/Daily, or Overlay Mode
  const handleUpdateSingleProgram = (progId: string, partial: Partial<ScheduledProgram>) => {
    const isScheduleChange =
      partial.startDate !== undefined ||
      partial.startTime !== undefined ||
      partial.scheduleType !== undefined;

    if (
      isScheduleChange &&
      channel.activeProgramId === progId &&
      (partial.startDate !== undefined || partial.startTime !== undefined)
    ) {
      onStopScheduledProgramNow(channel.id);
    }

    onUpdateScheduledPrograms(channel.id, (prevProgs) =>
      prevProgs.map((p) =>
        p.id === progId
          ? {
              ...p,
              ...partial,
              completed: isScheduleChange ? false : (partial.completed ?? p.completed),
              status: isScheduleChange ? ('scheduled' as const) : (partial.status ?? p.status),
              lastTriggeredDate: isScheduleChange ? undefined : p.lastTriggeredDate,
            }
          : p
      )
    );
  };

  // Update a single Every N Min Ad directly when the user changes Interval, Overlay Mode, or Title
  const handleUpdateSingleAd = (adId: string, partial: Partial<EveryNMinAdItem>) => {
    const nextDefaultInterval = partial.intervalMin || everyNMinInterval;
    onUpdateEveryNMinAds(
      (prevAds) =>
        normalizeAdsOrder(
          prevAds.map((ad) =>
            ad.id === adId ? { ...ad, ...partial, elapsedSec: 0 } : ad
          )
        ),
      everyNMinEnabled,
      nextDefaultInterval
    );
  };

  // Move ad to specific 1-based position (1st Ad, 2nd Ad...)
  const handleChangeAdPosition = (adId: string, newOrderOneBased: number) => {
    onUpdateEveryNMinAds(
      (prevAds) => {
        const currentIdx = prevAds.findIndex((a) => a.id === adId);
        if (currentIdx === -1) return prevAds;
        const targetIdx = Math.max(0, Math.min(prevAds.length - 1, newOrderOneBased - 1));
        const copy = [...prevAds];
        const [moved] = copy.splice(currentIdx, 1);
        copy.splice(targetIdx, 0, moved);
        return normalizeAdsOrder(copy);
      },
      everyNMinEnabled,
      everyNMinInterval
    );
  };

  // Build grouped Main Playlist items so folders appear as a single collapsible Folder Row
  type MainDisplayGroup =
    | { type: 'single'; clip: PlaylistItem; playlistIndex: number }
    | {
        type: 'folder';
        folderName: string;
        items: Array<{ clip: PlaylistItem; playlistIndex: number }>;
      };

  const mainDisplayGroups: MainDisplayGroup[] = [];
  const folderGroupsMap = new Map<
    string,
    Array<{ clip: PlaylistItem; playlistIndex: number }>
  >();

  channel.playlist.forEach((clip, idx) => {
    if (clip.folderName) {
      let existing = folderGroupsMap.get(clip.folderName);
      if (!existing) {
        existing = [];
        folderGroupsMap.set(clip.folderName, existing);
        mainDisplayGroups.push({
          type: 'folder',
          folderName: clip.folderName,
          items: existing,
        });
      }
      existing.push({ clip, playlistIndex: idx });
    } else {
      mainDisplayGroups.push({
        type: 'single',
        clip,
        playlistIndex: idx,
      });
    }
  });

  // Helper to add files (from + Add Video or + Add Folder) into Program Playlist
  const handleAddFilesToProgramPlaylist = (files: File[], folderName?: string) => {
    const validFiles = folderName ? filterFolderVideoAndSwfFiles(files) : files;
    if (validFiles.length === 0) return;

    const batchTs = Date.now();
    const totalCount = validFiles.length;

    if (folderName) {
      const progId = `prog-folder-${batchTs}`;
      const clips: PlaylistItem[] = buildFastPlaylistItems(validFiles, {
        batchTimestamp: batchTs,
        folderName,
        extractFolder: extractFolderName,
        computeVaultId: computeVaultIdForFile,
        registerBlobUrl: (f, vid) => registerLiveMediaInVault(f, vid),
      }).map((item, i) => ({
        ...item,
        id: `pclip-${batchTs}-${i}`,
      }));

      clips.forEach((c, idx) => {
        if (c.file && c.vaultId && shouldEagerVaultSaveOnImport(idx, totalCount)) {
          saveMediaToOfflineVault(c.file, c.vaultId).catch(() => {});
        }
      });

      const defaultSched = getDefaultFutureProgramSchedule(10);
      const newProg: ScheduledProgram = {
        id: progId,
        name: folderName,
        title: folderName,
        enabled: true,
        scheduleType: 'one_time',
        startDate: defaultSched.dateStr,
        dayOfWeek: 'ALL',
        startTime: defaultSched.timeStr,
        overlayMode: 'all_overlays',
        playlist: clips,
        status: 'scheduled',
        completed: false,
      };

      onUpdateScheduledPrograms(channel.id, (prevProgs) => [...prevProgs, newProg]);

      const queue = createMediaBatchQueue<PlaylistItem>({
        concurrency: 2,
        flushIntervalMs: 350,
        getId: (c) => c.id,
        worker: async (clip, idx, total) => {
          if (!clip.file || !clip.url) return null;
          const eagerUpload = shouldEagerUploadOnImport(clip.fileName || clip.title, idx, total);
          const res = await probeMediaFileDuration(clip.file, clip.url, undefined, {
            skipBackendUpload: !eagerUpload,
            skipOfflineVault: true,
          });
          return {
            duration: res.duration,
            url:
              res.transcoded && res.serverUrl
                ? res.serverUrl
                : clip.url.startsWith('blob:')
                ? clip.url
                : res.serverUrl || clip.url,
            videoUrl:
              res.transcoded && res.serverUrl
                ? res.serverUrl
                : (clip.videoUrl || '').startsWith('blob:')
                ? clip.videoUrl
                : res.serverUrl || clip.videoUrl,
            serverUrl: res.serverUrl,
            vaultId: res.vaultId || clip.vaultId,
            isTranscoding: false,
          };
        },
        onFlush: (patches) => {
          onUpdateScheduledPrograms(channel.id, (prevProgs) =>
            prevProgs.map((p) =>
              p.id === progId
                ? {
                    ...p,
                    playlist: p.playlist.map((c) => {
                      const patch = patches.get(c.id);
                      if (!patch) return c;
                      return {
                        ...c,
                        ...patch,
                        serverUrl: patch.serverUrl || (c as any).serverUrl,
                      } as PlaylistItem;
                    }),
                  }
                : p
            )
          );
        },
      });
      queue.enqueue(clips);
    } else {
      const defaultSched = getDefaultFutureProgramSchedule(10);
      const createdProgs: ScheduledProgram[] = validFiles.map((f, i) => {
        const syncVaultId = computeVaultIdForFile(f);
        const { blobUrl: u } = registerLiveMediaInVault(f, syncVaultId);
        if (shouldEagerVaultSaveOnImport(i, totalCount)) {
          saveMediaToOfflineVault(f, syncVaultId).catch(() => {});
        }
        const cleanTitle = f.name.replace(/\.[^/.]+$/, '');
        const clipId = `pclip-${batchTs}-${i}`;
        const progId = `prog-${batchTs}-${i}`;
        return {
          id: progId,
          name: cleanTitle,
          title: cleanTitle,
          enabled: true,
          scheduleType: 'one_time',
          startDate: defaultSched.dateStr,
          dayOfWeek: 'ALL',
          startTime: defaultSched.timeStr,
          overlayMode: 'all_overlays',
          playlist: [
            {
              id: clipId,
              title: cleanTitle,
              category: 'PROGRAM',
              duration: estimateMediaDurationSec(f.size, f.name),
              enabled: true,
              url: u,
              videoUrl: u,
              vaultId: syncVaultId,
              sourceType: 'local',
              fileName: f.name,
              fileSize: f.size,
              file: f,
              isTranscoding: false,
            },
          ],
          status: 'scheduled',
          completed: false,
        };
      });

      onUpdateScheduledPrograms(channel.id, (prevProgs) => [
        ...prevProgs,
        ...createdProgs,
      ]);

      const queue = createMediaBatchQueue<ScheduledProgram>({
        concurrency: 2,
        flushIntervalMs: 350,
        getId: (p) => p.id,
        worker: async (prog, idx, total) => {
          const clip = prog.playlist[0];
          if (!clip?.file || !clip?.url) return null;
          const eagerUpload = shouldEagerUploadOnImport(clip.fileName || clip.title, idx, total);
          const res = await probeMediaFileDuration(clip.file, clip.url, undefined, {
            skipBackendUpload: !eagerUpload,
            skipOfflineVault: true,
          });
          return {
            duration: res.duration,
            url:
              res.transcoded && res.serverUrl
                ? res.serverUrl
                : clip.url.startsWith('blob:')
                ? clip.url
                : res.serverUrl || clip.url,
            videoUrl:
              res.transcoded && res.serverUrl
                ? res.serverUrl
                : (clip.videoUrl || '').startsWith('blob:')
                ? clip.videoUrl
                : res.serverUrl || clip.videoUrl,
            serverUrl: res.serverUrl,
            vaultId: res.vaultId || clip.vaultId,
            isTranscoding: false,
          };
        },
        onFlush: (patches) => {
          onUpdateScheduledPrograms(channel.id, (prevProgs) =>
            prevProgs.map((p) => {
              const patch = patches.get(p.id);
              if (!patch || !p.playlist[0]) return p;
              return {
                ...p,
                playlist: p.playlist.map((c, cIdx) =>
                  cIdx === 0
                    ? ({
                        ...c,
                        ...patch,
                        serverUrl: patch.serverUrl || (c as any).serverUrl,
                      } as PlaylistItem)
                    : c
                ),
              };
            })
          );
        },
      });
      queue.enqueue(createdProgs);
    }
  };

  // Helper to add files into Every N Min Ads list (Supports Video, SWF & PNG/Image Ads playing 1-by-1 full duration on the same scheduled time slots)
  const handleAddFilesToEveryNMin = (files: File[], folderName?: string) => {
    const validFiles = folderName ? filterFolderCgMediaFiles(files) : files;
    if (validFiles.length === 0) return;

    const batchTs = Date.now();
    const totalCount = validFiles.length;
    const defaultInt = everyNMinInterval || 15;
    const activeMasterSlots =
      Array.isArray(masterAdTracking.tickedSlots) && masterAdTracking.tickedSlots.length > 0
        ? masterAdTracking.tickedSlots
        : getTrack48HHMMs(1, masterAdTracking.track6Mode || '25_55');
    const activeMasterTracks =
      Array.isArray(masterAdTracking.selectedTracks) && masterAdTracking.selectedTracks.length > 0
        ? masterAdTracking.selectedTracks
        : [1];

    const defaultDateRange = getDefaultAdDateRange();

    const added: EveryNMinAdItem[] = validFiles.map((f, i) => {
      const syncVaultId = computeVaultIdForFile(f);
      const { blobUrl: u } = registerLiveMediaInVault(f, syncVaultId);
      if (shouldEagerVaultSaveOnImport(i, totalCount)) {
        saveMediaToOfflineVault(f, syncVaultId).catch(() => {});
      }
      const isImg = isImageFile(f);
      return {
        id: `nmin-${batchTs}-${i}`,
        title: f.name.replace(/\.[^/.]+$/, ''),
        category: 'COMMERCIAL',
        duration: isImg ? 15 : estimateMediaDurationSec(f.size, f.name),
        url: u,
        videoUrl: u,
        vaultId: syncVaultId,
        sourceType: 'local',
        fileName: f.name,
        fileSize: f.size,
        file: f,
        isTranscoding: false,
        folderName,
        intervalMin: defaultInt,
        selectedTracks: [...activeMasterTracks],
        tickedSlots: [...activeMasterSlots],
        track6Mode: masterAdTracking.track6Mode || '25_55',
        customTracks: [...(masterAdTracking.customTracks || [])],
        dateMode: (masterAdTracking as any)?.dateMode || 'date_range',
        startDate: (masterAdTracking as any)?.startDate || defaultDateRange.startDate,
        endDate: (masterAdTracking as any)?.endDate || defaultDateRange.endDate,
        overlayMode: 'logo_only',
        orderIndex: everyNMinAds.length + i + 1,
        enabled: true,
      };
    });

    onUpdateEveryNMinAds(
      (prevAds) => normalizeAdsOrder([...prevAds, ...added]),
      true,
      defaultInt
    );

    const adQueue = createMediaBatchQueue<EveryNMinAdItem>({
      concurrency: 2,
      flushIntervalMs: 350,
      getId: (a) => a.id,
      worker: async (adItem, idx, total) => {
        if (!adItem.file || !adItem.url) return null;
        const eagerUpload = shouldEagerUploadOnImport(adItem.fileName || adItem.title, idx, total);
        const res = await probeMediaFileDuration(adItem.file, adItem.url, undefined, {
          skipBackendUpload: !eagerUpload,
          skipOfflineVault: true,
        });
        return {
          duration: res.duration,
          url:
            res.transcoded && res.serverUrl
              ? res.serverUrl
              : adItem.url.startsWith('blob:')
              ? adItem.url
              : res.serverUrl || adItem.url,
          videoUrl:
            res.transcoded && res.serverUrl
              ? res.serverUrl
              : (adItem.videoUrl || '').startsWith('blob:')
              ? adItem.videoUrl
              : res.serverUrl || adItem.videoUrl,
          serverUrl: res.serverUrl,
          vaultId: res.vaultId || adItem.vaultId,
          folderName: adItem.folderName || res.folderName,
          isTranscoding: false,
        };
      },
      onFlush: (patches) => {
        onUpdateEveryNMinAds((prevAds) =>
          prevAds.map((a) => {
            const patch = patches.get(a.id);
            if (!patch) return a;
            return {
              ...a,
              ...patch,
              serverUrl: patch.serverUrl || (a as any).serverUrl,
            } as EveryNMinAdItem;
          })
        );
      },
    });
    adQueue.enqueue(added);
  };

  return (
    <div className="flex flex-col h-full bg-black border border-[#1a202c] rounded-lg overflow-hidden shadow-2xl">
      {/* Hidden File Inputs for Main Playlist */}
      <input
        ref={videoInputRef}
        type="file"
        accept={ALL_VIDEO_AND_SWF_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const selected = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (selected.length > 0) {
            onImportVideos(channel.id, selected);
          }
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
          const rawFiles = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (rawFiles.length > 0) {
            const files = filterFolderVideoAndSwfFiles(rawFiles);
            if (files.length > 0) {
              const firstRel = (files[0] as any).webkitRelativePath || '';
              const folderName = firstRel.split('/')[0] || `Folder ${folderCount + 1}`;
              onImportVideos(channel.id, files, folderName);
            }
          }
        }}
      />

      {/* Top 4 Sub-Tabs Bar (Corporate Black & White Theme) */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-black border-b border-[#242a36]">
        <button
          onClick={() => onChangeLeftTab('main')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition border whitespace-nowrap cursor-pointer ${
            activeLeftTab === 'main'
              ? 'bg-black border-white text-white shadow-sm'
              : 'bg-[#0a0c10] border-[#2c3340] text-white/75 hover:text-white'
          }`}
        >
          <FileVideo className="w-3.5 h-3.5 text-white" />
          <span>Main Playlist</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums ${
              activeLeftTab === 'main'
                ? 'bg-white text-black'
                : 'bg-[#161a22] text-white'
            }`}
          >
            {channel.playlist.length}
          </span>
        </button>

        <button
          onClick={() => onChangeLeftTab('program')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition border whitespace-nowrap cursor-pointer ${
            activeLeftTab === 'program'
              ? 'bg-black border-white text-white shadow-sm'
              : 'bg-[#0a0c10] border-[#2c3340] text-white/75 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-white" />
          <span>Program Playlist</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums ${
              activeLeftTab === 'program'
                ? 'bg-white text-black'
                : 'bg-[#161a22] text-white'
            }`}
          >
            {programs.length}
          </span>
        </button>

        <button
          onClick={() => onChangeLeftTab('every_n_min')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition border whitespace-nowrap cursor-pointer ${
            activeLeftTab === 'every_n_min'
              ? 'bg-black border-white text-white shadow-sm'
              : 'bg-[#0a0c10] border-[#2c3340] text-white/75 hover:text-white'
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-white" />
          <span>Every N Min (Ads)</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold tabular-nums ${
              activeLeftTab === 'every_n_min'
                ? 'bg-white text-black'
                : 'bg-[#161a22] text-white'
            }`}
          >
            {everyNMinAds.length}
          </span>
        </button>

        <button
          onClick={() => onChangeLeftTab('live_input')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition border whitespace-nowrap cursor-pointer ${
            activeLeftTab === 'live_input'
              ? 'bg-black border-white text-white shadow-sm'
              : 'bg-[#0a0c10] border-[#2c3340] text-white/75 hover:text-white'
          }`}
        >
          <Tv className="w-3.5 h-3.5 text-white" />
          <span>Live Input</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
              channel.liveInput?.active
                ? 'bg-white text-black'
                : 'bg-[#161a22] text-white'
            }`}
          >
            {channel.liveInput?.active ? 'LIVE' : 'OFF'}
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0a0c10] border border-[#2c3340] text-white text-[10px] font-mono font-bold whitespace-nowrap">
          <span>● AUTO-SAVE VAULT</span>
        </div>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: MAIN CHANNEL PLAYLIST (Folders Collapsed Until Clicked)      */}
      {/* =================================================================== */}
      {activeLeftTab === 'main' && (
        <div className="flex flex-col flex-1 min-h-0 bg-black">
          <div className="flex items-center justify-between px-3.5 py-2 bg-[#05070b] border-b border-[#242a36]">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <FileVideo className="w-3.5 h-3.5 text-white" />
              <span>Main Channel Playlist</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/80 font-mono tabular-nums">
              <span>
                {channel.playlist.filter((it) => it.enabled !== false).length}/{channel.playlist.length} enabled • {folderCount} {folderCount === 1 ? 'folder' : 'folders'}
              </span>
              <span className="px-2 py-0.5 rounded bg-black border border-[#2c3340] text-white font-bold">
                Total Play: {formatDuration(channel.playlist.filter((it) => it.enabled !== false).reduce((s, it) => s + (it.duration || 0), 0))}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-[#030508] border-b border-[#182030]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1d63dc] hover:bg-[#2563eb] text-white text-xs font-semibold shadow transition cursor-pointer whitespace-nowrap"
              >
                <FileVideo className="w-3.5 h-3.5" />
                <span>Add Video</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#6d28d9] hover:bg-[#7c3aed] text-white text-xs font-semibold shadow transition cursor-pointer whitespace-nowrap"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Add Folder</span>
              </button>

              <button
                type="button"
                onClick={() => onSetLoopMode(channel.id, isLoop247 ? 'off' : 'playlist')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                  isLoop247
                    ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300 shadow-sm'
                    : 'bg-[#0a0c10] border-[#2c3340] text-slate-400 hover:text-white'
                }`}
                title="Toggle 24/7 Playlist Loop (Plays 1 -> 2 -> 3 -> ... and loops whole playlist)"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Loop Playlist: {isLoop247 ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleShuffle(channel.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition cursor-pointer whitespace-nowrap ${
                  channel.shuffle
                    ? 'bg-amber-950/90 border-amber-400 text-amber-300 shadow-sm'
                    : 'bg-[#0a0c10] border-[#2c3340] text-slate-400 hover:text-white'
                }`}
                title="Toggle Shuffle Play (Picks a different video next — never repeats the same video back-to-back)"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle: {channel.shuffle ? 'ON' : 'OFF'}</span>
              </button>

              {channel.playlist.length > 1 && onSkipNext && (
                <button
                  type="button"
                  onClick={() => onSkipNext(channel.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#0f172a] hover:bg-[#1e293b] border border-[#334155] text-white text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                  title="Skip to Next Video in Playlist Now"
                >
                  <SkipForward className="w-3.5 h-3.5 text-sky-400" />
                  <span>Next Video</span>
                </button>
              )}
            </div>

            {channel.playlist.length > 0 && (
              <button
                type="button"
                onClick={() => onClearPlaylist(channel.id)}
                className="px-2.5 py-1 rounded bg-[#140c10] hover:bg-rose-950 border border-rose-900/60 text-rose-400 text-[11px] font-semibold transition cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 bg-black">
            {mainDisplayGroups.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center">
                <p className="text-xs text-slate-500">
                  No videos. Click <strong className="text-slate-300 font-semibold">Add Video</strong> or <strong className="text-slate-300 font-semibold">Add Folder</strong>.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {mainDisplayGroups.map((group) => {
                  if (group.type === 'folder') {
                    const isExpanded = expandedMainFolders[group.folderName] === true;
                    const enabledItemsInFolder = group.items.filter(
                      (it) => it.clip.enabled !== false
                    );
                    const isFolderEnabled = enabledItemsInFolder.length > 0;
                    const totalFolderSec = enabledItemsInFolder.reduce(
                      (acc, it) => acc + (it.clip.duration || 0),
                      0
                    );
                    const isFolderPlaying =
                      isFolderEnabled &&
                      !channel.activeProgramId &&
                      !channel.activeEveryNMinAd &&
                      group.items.some((it) => it.playlistIndex === channel.currentClipIndex);

                    const mainPageKey = `main:${group.folderName}`;
                    const paginatedMain = paginateFolderItems(
                      group.items,
                      folderPageByKey[mainPageKey] || 0,
                      100
                    );
                    const playingLocalIdx = group.items.findIndex(
                      (it) => it.playlistIndex === channel.currentClipIndex
                    );

                    return (
                      <div
                        key={`folder-${group.folderName}`}
                        className={`rounded-md border overflow-hidden transition ${
                          !isFolderEnabled
                            ? 'border-rose-900/50 bg-[#0b0609] opacity-75'
                            : isFolderPlaying
                            ? 'border-purple-500 bg-[#120d24]'
                            : 'border-[#241c3d] bg-[#090712]'
                        }`}
                      >
                        {/* Folder Row: Click Folder to Show/Hide All Files Inside */}
                        <div
                          onClick={() =>
                            setExpandedMainFolders((prev) => ({
                              ...prev,
                              [group.folderName]: prev[group.folderName] !== true,
                            }))
                          }
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#16112b] transition"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-purple-400 shrink-0" />
                            )}
                            {isExpanded ? (
                              <FolderOpen className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <Folder className="w-4 h-4 text-purple-400 shrink-0" />
                            )}
                            <span
                              className={`text-xs font-bold truncate ${
                                isFolderEnabled ? 'text-white' : 'text-slate-500 line-through'
                              }`}
                            >
                              {group.folderName}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-mono font-bold shrink-0">
                              {enabledItemsInFolder.length}/{group.items.length} files
                            </span>
                            {!isFolderEnabled && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-950 border border-rose-500/50 text-rose-300 text-[9px] font-bold uppercase shrink-0">
                                Folder Disabled
                              </span>
                            )}
                          </div>

                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Folder Enable / Disable Buttons */}
                            <div className="flex rounded overflow-hidden border border-[#2c3548]">
                              <button
                                type="button"
                                onClick={() =>
                                  onToggleFolderEnabled &&
                                  onToggleFolderEnabled(channel.id, group.folderName, true)
                                }
                                className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                  isFolderEnabled
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                                }`}
                                title="Enable this Folder so all its files play in Main Playlist"
                              >
                                Enable
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onToggleFolderEnabled &&
                                  onToggleFolderEnabled(channel.id, group.folderName, false)
                                }
                                className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                  !isFolderEnabled
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                                }`}
                                title="Disable this Folder so none of its files play"
                              >
                                Disable
                              </button>
                            </div>

                            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                              {formatDuration(totalFolderSec)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (group.items.length > 0) {
                                  if (!isFolderEnabled && onToggleFolderEnabled) {
                                    onToggleFolderEnabled(channel.id, group.folderName, true);
                                  }
                                  const firstTarget =
                                    enabledItemsInFolder[0] || group.items[0];
                                  onTakeClip(channel.id, firstTarget.playlistIndex);
                                }
                              }}
                              className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-white" /> Play Folder
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (onRemoveFolder) {
                                  onRemoveFolder(channel.id, group.folderName);
                                } else {
                                  group.items.forEach((it) =>
                                    onRemoveClip(channel.id, it.clip.id)
                                  );
                                }
                              }}
                              className="p-1 rounded hover:bg-rose-900/50 text-slate-400 hover:text-rose-400 cursor-pointer"
                              title="Remove Entire Folder"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expanded Folder Files List (Paginated 100 items/page so 5,000+ folders never lag DOM) */}
                        {isExpanded && (
                          <div className="border-t border-[#241c3d] bg-black p-2 space-y-1">
                            {paginatedMain.totalPages > 1 && (
                              <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 mb-1 rounded bg-[#0c0a17] border border-purple-500/30 text-[10px]">
                                <span className="font-mono text-purple-300 font-bold">
                                  Showing {paginatedMain.startOffset + 1}–
                                  {Math.min(
                                    group.items.length,
                                    paginatedMain.startOffset + paginatedMain.slice.length
                                  )}{' '}
                                  of {group.items.length} files (Page {paginatedMain.safePageIndex + 1}/
                                  {paginatedMain.totalPages})
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {isFolderPlaying && playingLocalIdx >= 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setFolderPageByKey((prev) => ({
                                          ...prev,
                                          [mainPageKey]: Math.floor(playingLocalIdx / 100),
                                        }))
                                      }
                                      className="px-2 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white font-bold cursor-pointer"
                                    >
                                      Jump to Playing (#{playingLocalIdx + 1})
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={paginatedMain.safePageIndex <= 0}
                                    onClick={() =>
                                      setFolderPageByKey((prev) => ({
                                        ...prev,
                                        [mainPageKey]: Math.max(0, paginatedMain.safePageIndex - 1),
                                      }))
                                    }
                                    className="px-2 py-0.5 rounded bg-[#161229] hover:bg-[#231d42] border border-purple-500/40 text-white disabled:opacity-40 cursor-pointer"
                                  >
                                    Prev 100
                                  </button>
                                  <button
                                    type="button"
                                    disabled={paginatedMain.safePageIndex >= paginatedMain.totalPages - 1}
                                    onClick={() =>
                                      setFolderPageByKey((prev) => ({
                                        ...prev,
                                        [mainPageKey]: Math.min(
                                          paginatedMain.totalPages - 1,
                                          paginatedMain.safePageIndex + 1
                                        ),
                                      }))
                                    }
                                    className="px-2 py-0.5 rounded bg-[#161229] hover:bg-[#231d42] border border-purple-500/40 text-white disabled:opacity-40 cursor-pointer"
                                  >
                                    Next 100
                                  </button>
                                </div>
                              </div>
                            )}
                            {paginatedMain.slice.map(({ clip, playlistIndex }, fIdx) => {
                              const absNum = paginatedMain.startOffset + fIdx + 1;
                              const isClipEnabled = clip.enabled !== false;
                              const isCurrent =
                                isClipEnabled &&
                                channel.currentClipIndex === playlistIndex &&
                                !channel.activeProgramId &&
                                !channel.activeEveryNMinAd;
                              return (
                                <div
                                  key={clip.id}
                                  onClick={() => {
                                    if (isClipEnabled) {
                                      onTakeClip(channel.id, playlistIndex);
                                    }
                                  }}
                                  className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded border transition ${
                                    !isClipEnabled
                                      ? 'bg-[#080507] border-rose-950/60 text-slate-500 opacity-75 cursor-default'
                                      : isCurrent
                                      ? 'bg-[#0c213d] border-[#2563eb] text-white cursor-pointer'
                                      : 'bg-[#070a0f] hover:bg-[#0d131f] border-[#161e2e] text-slate-300 cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="text-[10px] font-mono text-purple-400 min-w-[28px] tabular-nums">
                                      {absNum}.
                                    </span>
                                    <Play
                                      className={`w-3 h-3 shrink-0 ${
                                        !isClipEnabled
                                          ? 'text-rose-500/50'
                                          : isCurrent
                                          ? 'text-emerald-400 fill-emerald-400'
                                          : 'text-slate-500'
                                      }`}
                                    />
                                    <span
                                      className={`text-xs truncate ${
                                        !isClipEnabled ? 'line-through text-slate-500' : ''
                                      }`}
                                    >
                                      {clip.title}
                                    </span>
                                  </div>
                                  <div
                                    className="flex items-center gap-1.5 shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {/* Per-File Enable / Disable Buttons inside Folder */}
                                    <div className="flex rounded overflow-hidden border border-[#242c3d]">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onToggleClipEnabled &&
                                          onToggleClipEnabled(channel.id, clip.id, true)
                                        }
                                        className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                          isClipEnabled
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                                        }`}
                                        title="Enable this file to play"
                                      >
                                        Enable
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onToggleClipEnabled &&
                                          onToggleClipEnabled(channel.id, clip.id, false)
                                        }
                                        className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                          !isClipEnabled
                                            ? 'bg-rose-600 text-white'
                                            : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                                        }`}
                                        title="Disable this file (do not play)"
                                      >
                                        Disable
                                      </button>
                                    </div>

                                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                                      {formatDuration(clip.duration)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onMoveClip(channel.id, playlistIndex, 'up')}
                                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onMoveClip(channel.id, playlistIndex, 'down')}
                                      className="p-1 text-slate-400 hover:text-white cursor-pointer"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onRemoveClip(channel.id, clip.id)}
                                      className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Standalone Video / SWF File Row
                  const { clip, playlistIndex } = group;
                  const isClipEnabled = clip.enabled !== false;
                  const isCurrent =
                    isClipEnabled &&
                    channel.currentClipIndex === playlistIndex &&
                    !channel.activeProgramId &&
                    !channel.activeEveryNMinAd;

                  return (
                    <div
                      key={clip.id}
                      onClick={() => {
                        if (isClipEnabled) {
                          onTakeClip(channel.id, playlistIndex);
                        }
                      }}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border transition ${
                        !isClipEnabled
                          ? 'bg-[#080507] border-rose-950/60 text-slate-500 opacity-75 cursor-default'
                          : isCurrent
                          ? 'bg-[#0c213d] border-[#2563eb] text-white cursor-pointer'
                          : 'bg-[#070a0f] hover:bg-[#0d131f] border-[#182030] text-slate-200 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="text-[11px] font-mono text-slate-500 w-5 tabular-nums">
                          {String(playlistIndex + 1).padStart(2, '0')}
                        </span>
                        <Play
                          className={`w-3.5 h-3.5 shrink-0 ${
                            !isClipEnabled
                              ? 'text-rose-500/50'
                              : isCurrent
                              ? 'text-emerald-400 fill-emerald-400'
                              : 'text-slate-500'
                          }`}
                        />
                        <span
                          className={`text-xs font-medium truncate ${
                            !isClipEnabled ? 'line-through text-slate-500' : ''
                          }`}
                        >
                          {clip.title}
                        </span>
                        {!isClipEnabled && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-950 border border-rose-500/50 text-rose-300 text-[9px] font-bold uppercase shrink-0">
                            Disabled
                          </span>
                        )}
                      </div>

                      <div
                        className="flex items-center gap-2 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Standalone File Enable / Disable Buttons */}
                        <div className="flex rounded overflow-hidden border border-[#242c3d]">
                          <button
                            type="button"
                            onClick={() =>
                              onToggleClipEnabled &&
                              onToggleClipEnabled(channel.id, clip.id, true)
                            }
                            className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                              isClipEnabled
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                            }`}
                            title="Enable this file to play"
                          >
                            Enable
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onToggleClipEnabled &&
                              onToggleClipEnabled(channel.id, clip.id, false)
                            }
                            className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                              !isClipEnabled
                                ? 'bg-rose-600 text-white'
                                : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                            }`}
                            title="Disable this file (do not play)"
                          >
                            Disable
                          </button>
                        </div>

                        <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {formatDuration(clip.duration)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onMoveClip(channel.id, playlistIndex, 'up')}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveClip(channel.id, playlistIndex, 'down')}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveClip(channel.id, clip.id)}
                          className="p-1 rounded hover:bg-rose-900/50 text-slate-400 hover:text-rose-400"
                          title="Remove Video"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: PROGRAM PLAYLIST                                             */}
      {/* Add Video / Add Folder First -> Show File/Folder Name & Set Details */}
      {/* =================================================================== */}
      {activeLeftTab === 'program' && (
        <div className="flex flex-col flex-1 min-h-0 bg-black">
          <div className="flex items-center justify-between px-3.5 py-2 bg-[#05070b] border-b border-[#182030]">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-sky-400" /> Program Playlist (Add Video / Folder First • Set One-Time or Daily Details on Each Item)
            </span>
            <span className="text-[11px] text-slate-400 font-mono tabular-nums">
              {programs.length} {programs.length === 1 ? 'program' : 'programs'}
            </span>
          </div>

          {/* Hidden Inputs for Program Playlist: + Add Video, + Add Folder, and Append Video */}
          <input
            ref={progNewVideoInputRef}
            type="file"
            accept={ALL_VIDEO_AND_SWF_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (selected.length > 0) {
                handleAddFilesToProgramPlaylist(selected);
              }
            }}
          />
          <input
            ref={(el) => {
              progNewFolderInputRef.current = el;
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const rawFiles = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (rawFiles.length > 0) {
                const files = filterFolderVideoAndSwfFiles(rawFiles);
                if (files.length > 0) {
                  const firstRel = (files[0] as any).webkitRelativePath || '';
                  const folderName =
                    firstRel.split('/')[0] || `Program Folder ${programs.length + 1}`;
                  handleAddFilesToProgramPlaylist(files, folderName);
                }
              }
            }}
          />
          <input
            ref={progAppendVideoInputRef}
            type="file"
            accept={ALL_VIDEO_AND_SWF_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (selected.length === 0 || !selectedProgIdForAppend) return;
              const targetProgId = selectedProgIdForAppend;
              const batchTs = Date.now();
              const newClips: PlaylistItem[] = selected.map((f, i) => {
                const { vaultId: syncVaultId, blobUrl: u } = registerLiveMediaInVault(f);
                saveMediaToOfflineVault(f, syncVaultId).catch(() => {});
                return {
                  id: `pclip-${batchTs}-${i}`,
                  title: f.name.replace(/\.[^/.]+$/, ''),
                  category: 'PROGRAM',
                  duration: 300,
                  enabled: true,
                  url: u,
                  videoUrl: u,
                  vaultId: syncVaultId,
                  sourceType: 'local',
                  fileName: f.name,
                  fileSize: f.size,
                  file: f,
                  isTranscoding: false,
                };
              });

              onUpdateScheduledPrograms(channel.id, (prevProgs) =>
                prevProgs.map((p) =>
                  p.id === targetProgId
                    ? {
                        ...p,
                        completed: false,
                        status: 'scheduled' as const,
                        playlist: [...p.playlist, ...newClips],
                      }
                    : p
                )
              );

              newClips.forEach((clip) => {
                if (!clip.file || !clip.url) return;
                probeMediaFileDuration(clip.file, clip.url, (localDuration) => {
                  onUpdateScheduledPrograms(channel.id, (prevProgs) =>
                    prevProgs.map((p) =>
                      p.id === targetProgId
                        ? {
                            ...p,
                            playlist: p.playlist.map((c) =>
                              c.id === clip.id ? { ...c, duration: localDuration, isTranscoding: false } : c
                            ),
                          }
                        : p
                    )
                  );
                }).then(({ duration, serverUrl, vaultId, transcoded }) => {
                  onUpdateScheduledPrograms(channel.id, (prevProgs) =>
                    prevProgs.map((p) =>
                      p.id === targetProgId
                        ? {
                            ...p,
                            playlist: p.playlist.map((c) =>
                              c.id === clip.id
                                ? ({
                                    ...c,
                                    duration,
                                    url:
                                      transcoded && serverUrl
                                        ? serverUrl
                                        : c.url?.startsWith('blob:')
                                        ? c.url
                                        : serverUrl || c.url,
                                    videoUrl:
                                      transcoded && serverUrl
                                        ? serverUrl
                                        : c.videoUrl?.startsWith('blob:')
                                        ? c.videoUrl
                                        : serverUrl || c.videoUrl,
                                    serverUrl: serverUrl || (c as any).serverUrl,
                                    vaultId: vaultId || c.vaultId,
                                    isTranscoding: false,
                                  } as PlaylistItem)
                                : c
                            ),
                          }
                        : p
                    )
                  );
                });
              });
            }}
          />

          {/* Top Action Bar: Add Video & Add Folder First */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-[#030508] border-b border-[#182030]">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => progNewVideoInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#1d63dc] hover:bg-[#2563eb] text-white text-xs font-bold shadow transition cursor-pointer"
              >
                <FileVideo className="w-3.5 h-3.5" />
                <span>+ Add Video</span>
              </button>

              <button
                type="button"
                onClick={() => progNewFolderInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#6d28d9] hover:bg-[#7c3aed] text-white text-xs font-bold shadow transition cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>+ Add Folder</span>
              </button>

              <span className="text-[11px] text-slate-400">
                Add video or folder first, then fix <strong className="text-amber-400">One Time (1 Day Only) / Daily (Every Day)</strong> &amp; <strong className="text-sky-400">Fixed Date &amp; Time</strong>. Plays automatically on the exact fixed Date &amp; Time!
              </span>
            </div>

            {programs.length > 0 && (
              <button
                type="button"
                onClick={() => onUpdateScheduledPrograms(channel.id, [])}
                className="px-2.5 py-1 rounded bg-[#140c10] hover:bg-rose-950 border border-rose-900/60 text-rose-400 text-[11px] font-semibold cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Program Items List: Each item shows File/Folder Name + Direct Schedule & Overlay Controls */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 bg-black">
            {programs.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center text-xs text-slate-500">
                <p>
                  No scheduled programs. Click <strong className="text-white">+ Add Video</strong> or <strong className="text-purple-400">+ Add Folder</strong> above.
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  After adding a file or folder, set One Time (1 Day Only) or Daily (Every Day), Fixed Date, Fixed Time, and Overlay mode directly on the item.
                </p>
              </div>
            ) : (
              programs.map((prog, pIdx) => {
                const isActive = channel.activeProgramId === prog.id;
                const isOneTime = prog.scheduleType === 'one_time' || prog.scheduleType === 'once';
                const isFolderProg = prog.playlist.length > 1 || !!prog.playlist[0]?.folderName;
                const isFolderExpanded = expandedProgFolders[prog.id] === true;
                const isEditingName = editingProgId === prog.id;
                const enabledProgClips = prog.playlist.filter((c) => c.enabled !== false);
                const isProgEnabled = prog.enabled !== false && enabledProgClips.length > 0;
                const totalDur = enabledProgClips.reduce((acc, c) => acc + (c.duration || 0), 0);

                return (
                  <div
                    key={prog.id}
                    className={`p-3 rounded-lg border space-y-2.5 transition ${
                      !isProgEnabled
                        ? 'bg-[#080507] border-rose-950/60 opacity-75'
                        : isActive
                        ? 'bg-[#091d36] border-[#2563eb] shadow-lg'
                        : 'bg-[#06090f] border-[#1a2232]'
                    }`}
                  >
                    {/* Top Row: File/Folder Name, Total Duration, Enable/Disable, Play Now / Add More / Delete */}
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
                        <span className="px-2 py-0.5 rounded bg-[#121928] border border-[#2a3956] text-sky-400 text-[10px] font-mono font-bold shrink-0">
                          #{pIdx + 1}
                        </span>

                        {isFolderProg ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedProgFolders((prev) => ({
                                ...prev,
                                [prog.id]: prev[prog.id] !== true,
                              }))
                            }
                            className="flex items-center gap-1.5 text-left min-w-[140px] max-w-full cursor-pointer group"
                          >
                            {isFolderExpanded ? (
                              <ChevronDown className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-purple-400 shrink-0" />
                            )}
                            <Folder className="w-4 h-4 text-purple-400 shrink-0" />
                            <span
                              className={`text-xs font-bold group-hover:text-purple-300 truncate ${
                                isProgEnabled ? 'text-white' : 'text-slate-500 line-through'
                              }`}
                            >
                              {prog.name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-mono font-bold shrink-0">
                              {enabledProgClips.length}/{prog.playlist.length} files
                            </span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 min-w-[140px] max-w-full">
                            <FileVideo className="w-4 h-4 text-sky-400 shrink-0" />
                            {isEditingName ? (
                              <input
                                type="text"
                                value={prog.name}
                                onChange={(e) =>
                                  handleUpdateSingleProgram(prog.id, {
                                    name: e.target.value,
                                    title: e.target.value,
                                  })
                                }
                                onBlur={() => setEditingProgId(null)}
                                autoFocus
                                className="bg-black border border-sky-500 rounded px-2 py-0.5 text-xs text-white"
                              />
                            ) : (
                              <span
                                className={`text-xs font-bold truncate ${
                                  isProgEnabled ? 'text-white' : 'text-slate-500 line-through'
                                }`}
                              >
                                {prog.name}
                              </span>
                            )}
                          </div>
                        )}

                        <span className="px-2 py-0.5 rounded bg-black border border-[#1f293d] text-[11px] font-mono text-slate-300 shrink-0">
                          {formatDuration(totalDur)}
                        </span>

                        {!isProgEnabled ? (
                          <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-500/50 text-rose-300 text-[10px] font-bold uppercase shrink-0">
                            DISABLED (DO NOT PLAY)
                          </span>
                        ) : isActive ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold animate-pulse shrink-0">
                            PLAYING ON AIR (Clip {(channel.activeProgramClipIndex || 0) + 1}/{prog.playlist.length})
                          </span>
                        ) : isOneTime && prog.completed ? (
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-300 text-[10px] font-bold shrink-0">
                            COMPLETED • RESUMED MAIN PLAYLIST ({prog.startDate})
                          </span>
                        ) : !isOneTime && prog.lastTriggeredDate === getLocalTodayStr() ? (
                          <span className="px-2 py-0.5 rounded bg-slate-800 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold shrink-0">
                            PLAYED TODAY • RESUMED MAIN PLAYLIST (Next: Tomorrow @ {prog.startTime})
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                              isOneTime
                                ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
                                : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                            }`}
                          >
                            {isOneTime
                              ? `WAITING • ONE TIME (${prog.startDate} @ ${prog.startTime})`
                              : `WAITING • DAILY (From ${prog.startDate} @ ${prog.startTime})`}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-1.5 w-full pt-1 border-t border-white/5">
                        {/* Program / Folder Enable & Disable Buttons */}
                        <div className="flex rounded overflow-hidden border border-[#2a3956]">
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateSingleProgram(prog.id, {
                                enabled: true,
                                playlist: prog.playlist.map((cl) => ({ ...cl, enabled: true })),
                              });
                              fetch('/api/playout/toggle-enable', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  channelId: channel.id,
                                  scope: 'program',
                                  targetType: 'folder',
                                  programId: prog.id,
                                  enabled: true,
                                }),
                              }).catch(() => {});
                            }}
                            className={`px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                              isProgEnabled
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                            }`}
                            title="Enable this Program / Folder to play"
                          >
                            Enable
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleUpdateSingleProgram(prog.id, {
                                enabled: false,
                                playlist: prog.playlist.map((cl) => ({ ...cl, enabled: false })),
                              });
                              fetch('/api/playout/toggle-enable', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  channelId: channel.id,
                                  scope: 'program',
                                  targetType: 'folder',
                                  programId: prog.id,
                                  enabled: false,
                                }),
                              }).catch(() => {});
                            }}
                            className={`px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                              !isProgEnabled
                                ? 'bg-rose-600 text-white'
                                : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                            }`}
                            title="Disable this Program / Folder (do not play)"
                          >
                            Disable
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProgIdForAppend(prog.id);
                            setTimeout(() => {
                              progAppendVideoInputRef.current?.click();
                            }, 20);
                          }}
                          className="px-2 py-1 bg-[#141d2e] hover:bg-[#1e2c46] border border-[#2a3956] text-sky-300 rounded text-[11px] font-semibold cursor-pointer"
                        >
                          + Add More Files
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditingProgId(isEditingName ? null : prog.id)
                          }
                          className="px-2 py-1 bg-[#161f30] hover:bg-[#223049] border border-[#2a3956] text-slate-200 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" /> Rename
                        </button>

                        {isActive ? (
                          <button
                            type="button"
                            onClick={() => onStopScheduledProgramNow(channel.id)}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-bold cursor-pointer"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onStartScheduledProgramNow(channel.id, prog.id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold cursor-pointer"
                          >
                            Play Now
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onUpdateScheduledPrograms(channel.id, (prevProgs) =>
                              prevProgs.filter((p) => p.id !== prog.id)
                            )
                          }
                          className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Delete Program"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Direct Per-Item Settings Bar: One Time / Daily, Fixed Date, Fixed Time, Overlay Mode (NO Day Option) */}
                    <div className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-black border border-[#192233]">
                      {/* One Time vs Daily Toggle */}
                      <div className="flex rounded overflow-hidden border border-[#25324a]">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSingleProgram(prog.id, { scheduleType: 'one_time', dayOfWeek: 'ALL' })
                          }
                          className={`px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                            isOneTime
                              ? 'bg-amber-500 text-black'
                              : 'bg-[#080b12] text-slate-400 hover:text-white'
                          }`}
                          title="Play only ONE TIME on the fixed Date & Time"
                        >
                          One Time (1 Day Only)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateSingleProgram(prog.id, { scheduleType: 'daily', dayOfWeek: 'ALL' })
                          }
                          className={`px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                            !isOneTime
                              ? 'bg-emerald-600 text-white'
                              : 'bg-[#080b12] text-slate-400 hover:text-white'
                          }`}
                          title="Play EVERY DAY at the fixed Time starting from the fixed Date"
                        >
                          Daily (Every Day)
                        </button>
                      </div>

                      {/* Fixed Date Picker */}
                      <div className="flex items-center gap-1 bg-[#080b12] border border-[#243047] rounded px-2 py-1">
                        <Calendar className="w-3 h-3 text-sky-400" />
                        <span className="text-[10px] text-slate-400 font-bold">
                          {isOneTime ? 'Fixed Date:' : 'Start Date:'}
                        </span>
                        <input
                          type="date"
                          value={prog.startDate || getLocalTodayStr()}
                          onChange={(e) =>
                            handleUpdateSingleProgram(prog.id, { startDate: e.target.value })
                          }
                          className="bg-transparent text-[11px] font-mono text-white outline-none"
                        />
                      </div>

                      {/* Exact Fixed Time Picker */}
                      <div className="flex items-center gap-1 bg-[#080b12] border border-[#243047] rounded px-2 py-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] text-slate-400 font-bold">Fixed Time:</span>
                        <input
                          type="time"
                          step="1"
                          value={prog.startTime || '20:00:00'}
                          onChange={(e) =>
                            handleUpdateSingleProgram(prog.id, { startTime: e.target.value })
                          }
                          className="bg-transparent text-[11px] font-mono font-bold text-amber-400 outline-none"
                        />
                        {(prog.completed || prog.lastTriggeredDate === getLocalTodayStr()) && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateSingleProgram(prog.id, {
                                completed: false,
                                status: 'scheduled',
                                lastTriggeredDate: undefined,
                              })
                            }
                            className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] text-amber-300 font-bold cursor-pointer"
                            title="Re-arm this program to allow scheduled auto-triggering again"
                          >
                            Re-Arm
                          </button>
                        )}
                      </div>

                      {/* Overlay Mode Selector */}
                      <div className="flex items-center gap-1 bg-[#080b12] border border-[#243047] rounded px-2 py-1 ml-auto">
                        <ShieldCheck className="w-3 h-3 text-sky-400" />
                        <select
                          value={prog.overlayMode || 'all_overlays'}
                          onChange={(e) =>
                            handleUpdateSingleProgram(prog.id, {
                              overlayMode: e.target.value as ProgramOverlayMode,
                            })
                          }
                          className="bg-[#080b12] text-[11px] font-bold text-sky-300 outline-none cursor-pointer"
                        >
                          <option value="all_overlays">Show All Overlays</option>
                          <option value="logo_only">Show Only 1st Logo</option>
                          <option value="clean_none">Clean Video (No Overlay)</option>
                        </select>
                      </div>
                    </div>

                    {/* Collapsible Folder Files inside Program (paginated 100 items/page) */}
                    {isFolderProg && isFolderExpanded && (() => {
                      const progPageKey = `prog:${prog.id}`;
                      const paginatedProg = paginateFolderItems(
                        prog.playlist,
                        folderPageByKey[progPageKey] || 0,
                        100
                      );
                      return (
                      <div className="space-y-1 pt-1 border-t border-[#141c2b]">
                        {paginatedProg.totalPages > 1 && (
                          <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#0c0a17] border border-purple-500/30 text-[10px]">
                            <span className="font-mono text-purple-300 font-bold">
                              Showing {paginatedProg.startOffset + 1}–
                              {Math.min(
                                prog.playlist.length,
                                paginatedProg.startOffset + paginatedProg.slice.length
                              )}{' '}
                              of {prog.playlist.length} files
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={paginatedProg.safePageIndex <= 0}
                                onClick={() =>
                                  setFolderPageByKey((prev) => ({
                                    ...prev,
                                    [progPageKey]: Math.max(0, paginatedProg.safePageIndex - 1),
                                  }))
                                }
                                className="px-2 py-0.5 rounded bg-[#161229] border border-purple-500/40 text-white disabled:opacity-40 cursor-pointer"
                              >
                                Prev 100
                              </button>
                              <button
                                type="button"
                                disabled={paginatedProg.safePageIndex >= paginatedProg.totalPages - 1}
                                onClick={() =>
                                  setFolderPageByKey((prev) => ({
                                    ...prev,
                                    [progPageKey]: Math.min(
                                      paginatedProg.totalPages - 1,
                                      paginatedProg.safePageIndex + 1
                                    ),
                                  }))
                                }
                                className="px-2 py-0.5 rounded bg-[#161229] border border-purple-500/40 text-white disabled:opacity-40 cursor-pointer"
                              >
                                Next 100
                              </button>
                            </div>
                          </div>
                        )}
                        {paginatedProg.slice.map((clip, relIdx) => {
                          const cIdx = paginatedProg.startOffset + relIdx;
                          const isClipEnabled = clip.enabled !== false && prog.enabled !== false;
                          const isPlayingClip =
                            isClipEnabled &&
                            isActive &&
                            (channel.activeProgramClipIndex || 0) === cIdx;
                          return (
                            <div
                              key={clip.id}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                                !isClipEnabled
                                  ? 'bg-[#080507] border border-rose-950/60 text-slate-500 opacity-75'
                                  : isPlayingClip
                                  ? 'bg-[#123059] text-white font-semibold'
                                  : 'bg-black/80 text-slate-300 border border-[#141c2b]'
                              }`}
                            >
                              <span
                                className={`truncate ${
                                  !isClipEnabled ? 'line-through text-slate-500' : ''
                                }`}
                              >
                                {cIdx + 1}. {clip.title}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Per-File Enable / Disable inside Program Folder */}
                                <div className="flex rounded overflow-hidden border border-[#242c3d]">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextList = prog.playlist.map((cl, i) =>
                                        i === cIdx ? { ...cl, enabled: true } : cl
                                      );
                                      handleUpdateSingleProgram(prog.id, {
                                        enabled: true,
                                        playlist: nextList,
                                      });
                                      fetch('/api/playout/toggle-enable', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          channelId: channel.id,
                                          scope: 'program',
                                          targetType: 'file',
                                          programId: prog.id,
                                          itemId: clip.id,
                                          enabled: true,
                                        }),
                                      }).catch(() => {});
                                    }}
                                    className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                      isClipEnabled
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                                    }`}
                                    title="Enable this file inside Program"
                                  >
                                    Enable
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextList = prog.playlist.map((cl, i) =>
                                        i === cIdx ? { ...cl, enabled: false } : cl
                                      );
                                      const anyStillEnabled = nextList.some(
                                        (cl) => cl.enabled !== false
                                      );
                                      handleUpdateSingleProgram(prog.id, {
                                        enabled: anyStillEnabled,
                                        playlist: nextList,
                                      });
                                      fetch('/api/playout/toggle-enable', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          channelId: channel.id,
                                          scope: 'program',
                                          targetType: 'file',
                                          programId: prog.id,
                                          itemId: clip.id,
                                          enabled: false,
                                        }),
                                      }).catch(() => {});
                                    }}
                                    className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                      !isClipEnabled
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                                    }`}
                                    title="Disable this file inside Program"
                                  >
                                    Disable
                                  </button>
                                </div>

                                <span className="font-mono text-[11px] text-slate-400">
                                  {formatDuration(clip.duration)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const list = [...prog.playlist];
                                    if (cIdx <= 0) return;
                                    const [m] = list.splice(cIdx, 1);
                                    list.splice(cIdx - 1, 0, m);
                                    handleUpdateSingleProgram(prog.id, { playlist: list });
                                  }}
                                  className="text-slate-400 hover:text-white cursor-pointer"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const list = [...prog.playlist];
                                    if (cIdx >= list.length - 1) return;
                                    const [m] = list.splice(cIdx, 1);
                                    list.splice(cIdx + 1, 0, m);
                                    handleUpdateSingleProgram(prog.id, { playlist: list });
                                  }}
                                  className="text-slate-400 hover:text-white cursor-pointer"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextList = prog.playlist.filter((_, i) => i !== cIdx);
                                    handleUpdateSingleProgram(prog.id, { playlist: nextList });
                                  }}
                                  className="text-slate-400 hover:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: EVERY N MIN COMMERCIAL ADS                                   */}
      {/* Add Video / Folder First -> Show File Name & Set All Details on Row */}
      {/* =================================================================== */}
      {activeLeftTab === 'every_n_min' && (
        <div className="flex flex-col flex-1 min-h-0 bg-black">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[#05070b] border-b border-[#182030]">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Radio className="w-3.5 h-3.5 text-amber-400" />
              <span>Full-Day Ad Tracking (Track 1–6 • All 6 Tracks • 48 Time Slots/Day per Track • Tick Each Time)</span>
            </div>
            <div className="flex items-center gap-2">
              {channel.activeEveryNMinAd && (
                <span className="px-2 py-0.5 rounded bg-amber-500 text-black text-[10px] font-bold animate-pulse">
                  PLAYING AD: {channel.activeEveryNMinAd.title}
                </span>
              )}
              <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                {everyNMinEnabled && everyNMinAds.length > 0
                  ? `Next Ad Break: ${Math.floor(everyNMinCountdownSec / 60)}m ${everyNMinCountdownSec % 60}s`
                  : `${everyNMinAds.length} Ads Configured`}
              </span>
            </div>
          </div>

          {/* Hidden File Inputs for Every N Min (Supports Video, SWF & PNG/Image Ads) */}
          <input
            ref={everyNMinInputRef}
            type="file"
            accept={ALL_CG_MEDIA_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (selected.length > 0) {
                handleAddFilesToEveryNMin(selected);
              }
            }}
          />
          <input
            ref={(el) => {
              everyNMinFolderInputRef.current = el;
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const rawFiles = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (rawFiles.length > 0) {
                const files = filterFolderCgMediaFiles(rawFiles);
                if (files.length > 0) {
                  const firstRel = (files[0] as any).webkitRelativePath || '';
                  const folderName = firstRel.split('/')[0] || 'Ad Folder';
                  handleAddFilesToEveryNMin(files, folderName);
                }
              }
            }}
          />
          <input
            ref={replaceAdVideoInputRef}
            type="file"
            accept={ALL_CG_MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file || !replaceVideoTargetAdId) return;
              const { vaultId: syncVaultId, blobUrl: u } = registerLiveMediaInVault(file);
              saveMediaToOfflineVault(file, syncVaultId).catch(() => {});
              const targetId = replaceVideoTargetAdId;
              const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
              const isImg = isImageFile(file);

              onUpdateEveryNMinAds((prevAds) =>
                prevAds.map((a) =>
                  a.id === targetId
                    ? {
                        ...a,
                        title: cleanTitle,
                        fileName: file.name,
                        fileSize: file.size,
                        vaultId: syncVaultId,
                        duration: isImg ? 15 : a.duration,
                        url: u,
                        videoUrl: u,
                        isTranscoding: false,
                      }
                    : a
                )
              );

              probeMediaFileDuration(file, u).then(({ duration, serverUrl, vaultId }) => {
                onUpdateEveryNMinAds((prevAds) =>
                  prevAds.map((a) =>
                    a.id === targetId
                      ? {
                          ...a,
                          duration,
                          vaultId: vaultId || a.vaultId,
                          url: a.url?.startsWith('blob:') ? a.url : serverUrl || a.url,
                          videoUrl: a.videoUrl?.startsWith('blob:') ? a.videoUrl : serverUrl || a.videoUrl,
                          isTranscoding: false,
                        }
                      : a
                  )
                );
              });
            }}
          />

          {/* Top Action Bar: Add Ad Video / Add Ad Folder First */}
          <div className="p-3 bg-[#030508] border-b border-[#182030] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => everyNMinInputRef.current?.click()}
                className="px-3.5 py-1.5 bg-[#1d63dc] hover:bg-[#2563eb] text-white rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow"
              >
                <FileVideo className="w-3.5 h-3.5" /> + Add Ad Video
              </button>

              <button
                type="button"
                onClick={() => everyNMinFolderInputRef.current?.click()}
                className="px-3.5 py-1.5 bg-[#6d28d9] hover:bg-[#7c3aed] text-white rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow"
              >
                <FolderPlus className="w-3.5 h-3.5" /> + Add Ad Folder
              </button>

              <button
                type="button"
                onClick={() => onOpenModal?.('back_in_timer')}
                className="px-3 py-1.5 bg-gradient-to-r from-[#3b0707] to-[#1c0202] hover:from-[#500a0a] hover:to-[#2b0404] border border-[#ef4444]/70 text-white rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow"
                title="BACK IN Commercial Break & Program Countdown Badge Setup (Fonts, Colors, 3 Designs)"
              >
                <Clock className="w-3.5 h-3.5 text-red-400" />
                <span>Back In Sec Badge</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-red-600 text-white font-mono font-bold">
                  [00:57]
                </span>
              </button>

              {everyNMinAds.length > 0 && (
                <span className="text-[11px] text-slate-400">
                  Click any <strong className="text-purple-300">Ad Folder</strong> or <strong className="text-amber-400">Ad File</strong> to view all files, selected times, full waiting time &amp; play details.
                </span>
              )}
            </div>

            {everyNMinAds.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onTriggerEveryNMinNow(undefined, true)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black rounded-md text-xs font-bold cursor-pointer"
                >
                  Play All 1-by-1
                </button>

                {channel.activeEveryNMinAd && (
                  <button
                    type="button"
                    onClick={onStopEveryNMinNow}
                    className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-md text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <StopIcon className="w-3 h-3" /> Stop Ad
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onUpdateEveryNMinAds(
                      (prevAds) => prevAds,
                      !everyNMinEnabled,
                      everyNMinInterval
                    )
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer ${
                    everyNMinEnabled
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#141b29] border border-[#243047] text-slate-400'
                  }`}
                >
                  {everyNMinEnabled ? 'Auto Timer: ON' : 'Auto Timer: OFF'}
                </button>
              </div>
            )}
          </div>

          {/* Every N Min Ads List: No Options Shown Until File/Folder Added • Same Like Main Playlist */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-black">
            {everyNMinAds.length === 0 ? (
              <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center text-xs text-slate-500">
                <p>
                  No videos. Click <strong className="text-slate-300 font-semibold">+ Add Ad Video</strong> or <strong className="text-slate-300 font-semibold">+ Add Ad Folder</strong>.
                </p>
              </div>
            ) : (
              <>
                {/* Ad Folders (Click Folder Row to Show/Hide All Ad Files Inside — Same Like Main Playlist!) */}
                {Array.from(
                  new Set(
                    everyNMinAds
                      .map((ad) => ad.folderName)
                      .filter((f): f is string => Boolean(f))
                  )
                ).map((folderName) => {
                  const folderKey = `ad_folder_${folderName}`;
                  const folderTimeKey = `ad_folder_time_${folderName}`;
                  const isFolderExpanded = Boolean(expandedProgFolders[folderKey]);
                  const isFolderTimeOpen = Boolean(expandedProgFolders[folderTimeKey]);
                  const folderAds = everyNMinAds
                    .map((ad, idx) => ({ ad, idx }))
                    .filter(({ ad }) => ad.folderName === folderName);
                  const enabledInFolder = folderAds.filter(({ ad }) => ad.enabled !== false);
                  const isAdFolderEnabled = enabledInFolder.length > 0;
                  const totalFolderDur = enabledInFolder.reduce(
                    (acc, { ad }) => acc + (ad.duration || 30),
                    0
                  );
                  const firstFolderAd = folderAds[0]?.ad;
                  const folderSlots = ensureDefaultTickedSlots(
                    firstFolderAd?.tickedSlots,
                    firstFolderAd?.selectedTracks,
                    1,
                    firstFolderAd?.track6Mode || '25_55',
                    firstFolderAd?.customTracks || []
                  );
                  const folderNext = getNextTickedSlotCountdown(folderSlots);
                  const folderWaitMins = Math.floor(folderNext.secondsUntilNext / 60);
                  const folderWaitSecs = folderNext.secondsUntilNext % 60;

                  return (
                    <div
                      key={folderKey}
                      className={`rounded-md border overflow-hidden transition ${
                        isAdFolderEnabled
                          ? 'border-[#241c3d] bg-[#090712]'
                          : 'border-rose-900/60 bg-[#0b0609] opacity-75'
                      }`}
                    >
                      <div
                        onClick={() =>
                          setExpandedProgFolders((prev) => ({
                            ...prev,
                            [folderKey]: !prev[folderKey],
                          }))
                        }
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#16112b] transition text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                          {isFolderExpanded ? (
                            <ChevronDown className="w-4 h-4 text-purple-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-purple-400 shrink-0" />
                          )}
                          {isFolderExpanded ? (
                            <FolderOpen className="w-4 h-4 text-purple-400 shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-purple-400 shrink-0" />
                          )}
                          <span
                            className={`font-bold truncate ${
                              isAdFolderEnabled ? 'text-white' : 'text-slate-500 line-through'
                            }`}
                          >
                            {folderName}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-mono font-bold">
                            {enabledInFolder.length}/{folderAds.length} ads
                          </span>
                          <span className="px-2 py-0.5 rounded bg-black border border-[#1f293d] text-emerald-300 text-[10px] font-mono font-bold">
                            Full Play: {formatDuration(totalFolderDur)}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/40 text-purple-200 text-[10px] font-mono font-bold">
                            📅 Date: {formatAdDateSummary(firstFolderAd)}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-bold">
                            ⏳ Waiting:{' '}
                            {folderNext.nextSlotHHMM
                              ? `${folderWaitMins}m ${folderWaitSecs}s (Next @ ${folderNext.nextSlotLabel})`
                              : 'No Time Selected'}
                          </span>
                        </div>
                        <div
                          className="flex items-center gap-2 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedProgFolders((prev) => ({
                                ...prev,
                                [folderTimeKey]: !prev[folderTimeKey],
                              }))
                            }
                            className="px-2 py-0.5 rounded bg-[#111a2e] hover:bg-[#1a2947] border border-amber-500/50 text-amber-300 text-[10px] font-bold cursor-pointer"
                          >
                            ⏰ {isFolderTimeOpen ? 'Hide Date & Time' : 'Fix Date & Time'}
                          </button>
                          <div className="flex rounded overflow-hidden border border-[#2c3548]">
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateEveryNMinAds((prevAds) =>
                                  normalizeAdsOrder(
                                    prevAds.map((a) =>
                                      a.folderName === folderName ? { ...a, enabled: true } : a
                                    )
                                  )
                                )
                              }
                              className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                isAdFolderEnabled
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                              }`}
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateEveryNMinAds((prevAds) =>
                                  normalizeAdsOrder(
                                    prevAds.map((a) =>
                                      a.folderName === folderName ? { ...a, enabled: false } : a
                                    )
                                  )
                                )
                              }
                              className={`px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                !isAdFolderEnabled
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                              }`}
                            >
                              Disable
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const firstTarget = enabledInFolder[0] || folderAds[0];
                              if (firstTarget) {
                                onTriggerEveryNMinNow(firstTarget.ad.id, true);
                              }
                            }}
                            className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Play className="w-3 h-3 fill-white" /> Play Folder
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateEveryNMinAds((prevAds) =>
                                normalizeAdsOrder(
                                  prevAds.filter((a) => a.folderName !== folderName)
                                )
                              )
                            }
                            className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isFolderTimeOpen && (
                        <div className="p-2.5 border-t border-purple-500/30 bg-black">
                          <AdTrackingTimeGrid
                            compact
                            defaultGridExpanded={true}
                            title={`FOLDER DATE & TIME: "${folderName.toUpperCase()}" (${folderAds.length} ADS PLAY 1-BY-1)`}
                            saveButtonLabel={`💾 SAVE DATE & TIME FOR FOLDER (${folderAds.length} ADS)`}
                            applyToAllLabel={`💾 Apply Date & Time to ALL Ads (${everyNMinAds.length})`}
                            tickedSlots={folderSlots}
                            selectedTracks={firstFolderAd?.selectedTracks || [1]}
                            track6Mode={firstFolderAd?.track6Mode || '25_55'}
                            customTracks={firstFolderAd?.customTracks || []}
                            dateMode={firstFolderAd?.dateMode || 'every_day'}
                            scheduledDate={firstFolderAd?.scheduledDate}
                            startDate={firstFolderAd?.startDate}
                            endDate={firstFolderAd?.endDate}
                            onChange={({
                              tickedSlots,
                              selectedTracks,
                              track6Mode,
                              customTracks,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                            }) => {
                              onUpdateEveryNMinAds(
                                (prevAds) =>
                                  normalizeAdsOrder(
                                    prevAds.map((a) =>
                                      a.folderName === folderName
                                        ? {
                                            ...a,
                                            tickedSlots,
                                            selectedTracks,
                                            track6Mode: track6Mode || '25_55',
                                            customTracks: customTracks || [],
                                            dateMode,
                                            scheduledDate,
                                            startDate,
                                            endDate,
                                            lastTriggeredSlotKey: undefined,
                                          }
                                        : a
                                    )
                                  ),
                                true,
                                everyNMinInterval
                              );
                            }}
                            onSave={({
                              tickedSlots,
                              selectedTracks,
                              track6Mode,
                              customTracks,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                            }) => {
                              onUpdateEveryNMinAds(
                                (prevAds) =>
                                  normalizeAdsOrder(
                                    prevAds.map((a) =>
                                      a.folderName === folderName
                                        ? {
                                            ...a,
                                            tickedSlots,
                                            selectedTracks,
                                            track6Mode: track6Mode || '25_55',
                                            customTracks: customTracks || [],
                                            dateMode,
                                            scheduledDate,
                                            startDate,
                                            endDate,
                                            lastTriggeredSlotKey: undefined,
                                          }
                                        : a
                                    )
                                  ),
                                true,
                                everyNMinInterval
                              );
                              triggerAdSaveToast();
                            }}
                            onApplyToAll={({
                              tickedSlots,
                              selectedTracks,
                              track6Mode,
                              customTracks,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                            }) => {
                              onUpdateEveryNMinAds(
                                (prevAds) =>
                                  normalizeAdsOrder(
                                    prevAds.map((a) => ({
                                      ...a,
                                      tickedSlots,
                                      selectedTracks,
                                      track6Mode: track6Mode || '25_55',
                                      customTracks: customTracks || [],
                                      dateMode,
                                      scheduledDate,
                                      startDate,
                                      endDate,
                                      lastTriggeredSlotKey: undefined,
                                    }))
                                  ),
                                true,
                                everyNMinInterval
                              );
                              triggerAdSaveToast();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {everyNMinAds.map((ad, idx) => {
                  if (
                    ad.folderName &&
                    !expandedProgFolders[`ad_folder_${ad.folderName}`]
                  ) {
                    return null;
                  }
                  const isAdEnabled = ad.enabled !== false;
                  const isPlayingThisAd = isAdEnabled && channel.activeEveryNMinAd?.id === ad.id;
                  const isEditingThisAd = editingAdId === ad.id;
                  const adItemTimeKey = `ad_item_${ad.id}`;
                  const isAdTimeOpen = Boolean(expandedProgFolders[adItemTimeKey]);
                  const adTracks = ad.selectedTracks && ad.selectedTracks.length > 0 ? ad.selectedTracks : [1];
                  const adSlots = ensureDefaultTickedSlots(
                    ad.tickedSlots,
                    adTracks,
                    1,
                    ad.track6Mode || '25_55',
                    ad.customTracks || []
                  );
                  const adNext = getNextTickedSlotCountdown(adSlots);
                  const waitM = Math.floor(adNext.secondsUntilNext / 60);
                  const waitS = adNext.secondsUntilNext % 60;
                  const isSwf = isSwfFile(ad.fileName || ad.title);
                  const overlayModeLabel =
                    ad.overlayMode === 'all_overlays'
                      ? 'All CG Overlays'
                      : ad.overlayMode === 'clean_none'
                      ? 'Clean Ad (No CG)'
                      : '1st Logo Only';

                  return (
                    <div
                      key={ad.id}
                      className={`p-2.5 rounded-md border transition space-y-2 ${
                        !isAdEnabled
                          ? 'bg-[#080507] border-rose-950/60 opacity-75'
                          : isPlayingThisAd
                          ? 'bg-[#1c1605] border-amber-400 shadow-lg'
                          : 'bg-[#070a0f] hover:bg-[#0d131f] border-[#182030]'
                      }`}
                    >
                      {/* Clickable Ad Row (Same Like Main Playlist: Shows Ad & File Name + Full Waiting Time + How Ad Plays) */}
                      <div
                        onClick={() =>
                          setExpandedProgFolders((prev) => ({
                            ...prev,
                            [adItemTimeKey]: !prev[adItemTimeKey],
                          }))
                        }
                        className="flex flex-col gap-2 cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
                          {isAdTimeOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}

                          {/* 1st Ad / 2nd Ad Sequence Selector */}
                          <select
                            value={idx + 1}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleChangeAdPosition(ad.id, Number(e.target.value))
                            }
                            className="bg-[#121928] border border-[#2a3956] text-amber-400 rounded px-2 py-0.5 text-[11px] font-mono font-bold cursor-pointer"
                            title="Set Ad Order (1st Ad, 2nd Ad...)"
                          >
                            {everyNMinAds.map((_, posIdx) => (
                              <option key={posIdx + 1} value={posIdx + 1}>
                                {formatOrdinalAd(posIdx + 1)}
                              </option>
                            ))}
                          </select>

                          <FileVideo className="w-4 h-4 text-amber-400 shrink-0" />

                          {isEditingThisAd ? (
                            <input
                              type="text"
                              value={ad.title}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                handleUpdateSingleAd(ad.id, { title: e.target.value })
                              }
                              className="bg-black border border-amber-400 rounded px-2 py-0.5 text-xs text-white font-bold"
                            />
                          ) : (
                            <span
                              className={`text-xs font-bold truncate ${
                                isAdEnabled ? 'text-white' : 'text-slate-500 line-through'
                              }`}
                            >
                              {ad.fileName || ad.title}
                            </span>
                          )}

                          {ad.folderName && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-mono">
                              📁 {ad.folderName}
                            </span>
                          )}

                          <span className="px-1.5 py-0.5 rounded bg-blue-950/80 border border-blue-500/40 text-blue-300 text-[10px] font-mono font-bold shrink-0">
                            {isSwf ? 'SWF FLASH' : 'VIDEO'}
                          </span>

                          <span className="px-2 py-0.5 rounded bg-black border border-[#1f293d] text-[10px] font-mono text-emerald-300 font-bold shrink-0">
                            {formatDuration(ad.duration)} (Full Play)
                          </span>

                          <span className="px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/40 text-purple-200 text-[10px] font-mono font-bold max-w-full">
                            📅 Date: {formatAdDateSummary(ad)}
                          </span>

                          <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 text-[10px] font-mono font-bold max-w-full">
                            ⏳ Waiting:{' '}
                            {adNext.nextSlotHHMM
                              ? `${waitM}m ${waitS}s • Next Play @ ${adNext.nextSlotLabel}`
                              : 'No Time Selected'}
                          </span>

                          <span className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-sky-300 text-[10px] font-mono font-bold max-w-full">
                            {overlayModeLabel} • Track {adTracks.join(',')} ({adSlots.length} Times)
                          </span>
                        </div>

                        <div
                          className="flex flex-wrap items-center justify-end gap-1.5 w-full pt-1 border-t border-white/5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Per-Ad File Enable / Disable Buttons */}
                          <div className="flex rounded overflow-hidden border border-[#2a3956]">
                            <button
                              type="button"
                              onClick={() => {
                                handleUpdateSingleAd(ad.id, { enabled: true });
                                fetch('/api/playout/toggle-enable', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    channelId: channel.id,
                                    scope: 'every_n_min',
                                    targetType: 'file',
                                    itemId: ad.id,
                                    enabled: true,
                                  }),
                                }).catch(() => {});
                              }}
                              className={`px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                                isAdEnabled
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-[#0a0d14] text-slate-400 hover:text-emerald-300'
                              }`}
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleUpdateSingleAd(ad.id, { enabled: false });
                                fetch('/api/playout/toggle-enable', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    channelId: channel.id,
                                    scope: 'every_n_min',
                                    targetType: 'file',
                                    itemId: ad.id,
                                    enabled: false,
                                  }),
                                }).catch(() => {});
                              }}
                              className={`px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                                !isAdEnabled
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-[#0a0d14] text-slate-400 hover:text-rose-300'
                              }`}
                            >
                              Disable
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedProgFolders((prev) => ({
                                ...prev,
                                [adItemTimeKey]: !prev[adItemTimeKey],
                              }))
                            }
                            className="px-2 py-1 bg-[#111a2e] hover:bg-[#1a2947] border border-amber-500/40 text-amber-300 rounded text-[10px] font-bold cursor-pointer"
                          >
                            ⏰ {isAdTimeOpen ? 'Hide Time' : `Time (${adSlots.length})`}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setEditingAdId(isEditingThisAd ? null : ad.id)
                            }
                            className="px-2.5 py-1 bg-[#161f30] hover:bg-[#223049] border border-[#2a3956] text-slate-200 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" /> {isEditingThisAd ? 'Done' : 'Edit'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setReplaceVideoTargetAdId(ad.id);
                              setTimeout(() => {
                                replaceAdVideoInputRef.current?.click();
                              }, 20);
                            }}
                            className="px-2 py-1 bg-[#141d2e] hover:bg-[#1e2c46] border border-[#2a3956] text-sky-300 rounded text-[11px] font-semibold cursor-pointer"
                          >
                            Change File
                          </button>

                          <button
                            type="button"
                            onClick={() => onTriggerEveryNMinNow(ad.id, false)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold cursor-pointer"
                          >
                            Play Now
                          </button>

                          <button
                            type="button"
                            onClick={() => handleChangeAdPosition(ad.id, idx)}
                            disabled={idx === 0}
                            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleChangeAdPosition(ad.id, idx + 2)}
                            disabled={idx === everyNMinAds.length - 1}
                            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onUpdateEveryNMinAds((prevAds) =>
                                normalizeAdsOrder(prevAds.filter((a) => a.id !== ad.id))
                              );
                            }}
                            className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                            title="Delete Ad"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Per-Ad Date, Time & Overlay Details (Shown when Ad Row or Time Button is clicked) */}
                      {isAdTimeOpen && (
                        <AdTrackingTimeGrid
                          compact
                          defaultGridExpanded={true}
                          saveButtonLabel="💾 SAVE DATE & TIME"
                          applyToAllLabel={`💾 Apply Date & Time to ALL Ads (${everyNMinAds.length})`}
                          title={`#${idx + 1} DATE & TIME TRACKING FOR "${ad.title.toUpperCase()}"`}
                          tickedSlots={adSlots}
                          selectedTracks={adTracks}
                          track6Mode={ad.track6Mode || '25_55'}
                          customTracks={ad.customTracks || []}
                          dateMode={ad.dateMode || 'every_day'}
                          scheduledDate={ad.scheduledDate}
                          startDate={ad.startDate}
                          endDate={ad.endDate}
                          onChange={({
                            tickedSlots,
                            selectedTracks,
                            track6Mode,
                            customTracks,
                            dateMode,
                            scheduledDate,
                            startDate,
                            endDate,
                          }) => {
                            handleUpdateSingleAd(ad.id, {
                              tickedSlots,
                              selectedTracks,
                              track6Mode,
                              customTracks,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                              lastTriggeredSlotKey: undefined,
                            });
                          }}
                          onSave={({
                            tickedSlots,
                            selectedTracks,
                            track6Mode,
                            customTracks,
                            dateMode,
                            scheduledDate,
                            startDate,
                            endDate,
                          }) => {
                            handleUpdateSingleAd(ad.id, {
                              tickedSlots,
                              selectedTracks,
                              track6Mode,
                              customTracks,
                              dateMode,
                              scheduledDate,
                              startDate,
                              endDate,
                              lastTriggeredSlotKey: undefined,
                            });
                            triggerAdSaveToast();
                          }}
                          onApplyToAll={({
                            tickedSlots,
                            selectedTracks,
                            track6Mode,
                            customTracks,
                            dateMode,
                            scheduledDate,
                            startDate,
                            endDate,
                          }) => {
                            onUpdateEveryNMinAds(
                              (prevAds) =>
                                normalizeAdsOrder(
                                  prevAds.map((a) => ({
                                    ...a,
                                    tickedSlots,
                                    selectedTracks,
                                    track6Mode: track6Mode || '25_55',
                                    customTracks: customTracks || [],
                                    dateMode,
                                    scheduledDate,
                                    startDate,
                                    endDate,
                                    lastTriggeredSlotKey: undefined,
                                  }))
                                ),
                              true,
                              everyNMinInterval
                            );
                            triggerAdSaveToast();
                          }}
                          extraRightControls={
                            <div className="flex items-center gap-1">
                              {(
                                [
                                  ['logo_only', 'Show Only 1st Logo'],
                                  ['all_overlays', 'Show All Overlays'],
                                  ['clean_none', 'Clean Ad (No Overlay)'],
                                ] as [AdOverlayMode, string][]
                              ).map(([modeVal, modeLabel]) => (
                                <button
                                  key={modeVal}
                                  type="button"
                                  onClick={() =>
                                    handleUpdateSingleAd(ad.id, { overlayMode: modeVal })
                                  }
                                  className={`px-2 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                                    (ad.overlayMode || 'logo_only') === modeVal
                                      ? 'bg-[#0f2952] border-[#2563eb] text-sky-300'
                                      : 'bg-[#080b12] border-[#1f293d] text-slate-400 hover:text-white'
                                  }`}
                                >
                                  {modeLabel}
                                </button>
                              ))}
                            </div>
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: LIVE INPUT STUDIO (M3U8 / RTMP STREAM • USB CAMERA / HDMI)    */}
      {/* =================================================================== */}
      {activeLeftTab === 'live_input' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-black">
          <LiveInputStudioPanel
            channel={channel}
            onUpdateLiveInput={(partial) => {
              if (onUpdateLiveInput) onUpdateLiveInput(partial);
            }}
            onStartCameraCapture={(deviceId) => {
              if (onStartCameraCapture) onStartCameraCapture(deviceId);
            }}
            onStopLiveInput={() => {
              if (onStopLiveInput) onStopLiveInput();
            }}
            everyNMinEnabled={everyNMinEnabled}
            everyNMinInterval={everyNMinInterval}
            onChangeEveryNMin={(enabled, interval) => {
              onUpdateEveryNMinAds(
                (prev) => prev,
                enabled,
                interval as EveryNMinIntervalOption
              );
            }}
            onSaveChannel={onSaveChannel}
            activeStream={activeLiveStream}
          />
        </div>
      )}
    </div>
  );
};
