import React, { useState, useRef, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  Sparkles,
  FileVideo,
  CheckCircle2,
  Play,
  Square,
  Repeat,
  Shuffle,
  Clock,
  Film,
  Tv,
  AlertCircle,
  Edit3,
  Check,
  X,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Calendar,
  Layers,
  Eye,
  EyeOff,
  RotateCcw,
  PauseCircle,
  PlayCircle,
  Search,
} from 'lucide-react';
import {
  TVChannel,
  PlaylistItem,
  ScheduledProgram,
  ProgramOverlayMode,
  ProgramScheduleType,
} from '../types/playout';

interface PlaylistManagerProps {
  channel: TVChannel;
  onAddClip: (channelId: number, clip: Omit<PlaylistItem, 'id'>) => void;
  onRemoveClip: (channelId: number, clipId: string) => void;
  onMoveClip: (channelId: number, index: number, direction: 'up' | 'down') => void;
  onUpdateClipDuration?: (channelId: number, clipId: string, newDuration: number) => void;
  onTakeClip?: (channelId: number, index: number) => void;
  onStopChannel?: (channelId: number) => void;
  onSetLoopMode?: (channelId: number, mode: 'off' | 'single' | 'playlist') => void;
  onToggleShuffle?: (channelId: number) => void;
  onClearPlaylist?: (channelId: number) => void;
  onImportLocalFiles?: (channelId: number, files: FileList | File[]) => void;
  onReplacePlaylist?: (channelId: number, newPlaylist: PlaylistItem[]) => void;
  onUpdateScheduledPrograms?: (
    channelId: number,
    programs: ScheduledProgram[],
    activeProgramId?: string | null,
    activeProgramClipIndex?: number,
    activeProgramTime?: number,
    savedDefaultIndex?: number,
    savedDefaultTime?: number
  ) => void;
  onStartScheduledProgramNow?: (channelId: number, programId: string) => void;
  onStopScheduledProgramNow?: (channelId: number) => void;
}

const DEMO_SAMPLE_VIDEOS = [
  {
    title: 'Big Buck Bunny (1080p HD Broadcast Test)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 596,
    category: 'PROGRAM' as const,
  },
  {
    title: 'Sintel (Cinema Anamorphic Master)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    duration: 888,
    category: 'PROGRAM' as const,
  },
  {
    title: 'Tears of Steel (Sci-Fi VFX Playout)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    duration: 734,
    category: 'PROGRAM' as const,
  },
  {
    title: 'For Bigger Blazes (Commercial Promo HD)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: 15,
    category: 'COMMERCIAL' as const,
  },
  {
    title: 'Elephants Dream (Station Ident Stream)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    duration: 653,
    category: 'IDENT' as const,
  },
];

const OVERLAY_MODE_LABELS: Record<
  ProgramOverlayMode,
  { label: string; short: string; desc: string; badgeClass: string }
> = {
  all_overlays: {
    label: 'Show All Overlays (Logo + Top/Bottom Overlays + Ticker)',
    short: 'ALL OVERLAYS',
    desc: 'Displays Channel/Sponsor Logos, Top & Bottom Overlays, and News Ticker',
    badgeClass: 'bg-emerald-950/90 text-emerald-300 border-emerald-700',
  },
  logo_only: {
    label: 'Show Only Channel Logo (Hide Top/Bottom Banners & Ticker)',
    short: 'LOGO ONLY',
    desc: 'Shows only the station/sponsor logo; hides Ticker and Top/Bottom Banners',
    badgeClass: 'bg-blue-950/90 text-blue-300 border-blue-700',
  },
  banners_only: {
    label: 'Show Only Top & Bottom Overlays (Hide Channel Logo)',
    short: 'TOP/BOTTOM ONLY',
    desc: 'Shows Top & Bottom Overlays and Ticker; hides Channel Logo',
    badgeClass: 'bg-purple-950/90 text-purple-300 border-purple-700',
  },
  lshape_only: {
    label: 'Show Only Top & Bottom Overlays (Hide Channel Logo)',
    short: 'TOP/BOTTOM ONLY',
    desc: 'Shows Top & Bottom Overlays and Ticker; hides Channel Logo',
    badgeClass: 'bg-purple-950/90 text-purple-300 border-purple-700',
  },
  clean_none: {
    label: "Don't Show Anything (Clean Video Only)",
    short: 'CLEAN (NO OVERLAYS)',
    desc: '100% clean raw program video with all graphics, logos, and banners turned off',
    badgeClass: 'bg-amber-950/90 text-amber-300 border-amber-700',
  },
};

type GroupedEntry =
  | {
      type: 'file';
      item: PlaylistItem;
      playlistIndex: number;
    }
  | {
      type: 'folder';
      folderId: string;
      folderName: string;
      items: { item: PlaylistItem; playlistIndex: number }[];
      totalDuration: number;
      firstPlaylistIndex: number;
    };

export const PlaylistManager: React.FC<PlaylistManagerProps> = ({
  channel,
  onAddClip,
  onRemoveClip,
  onMoveClip,
  onUpdateClipDuration,
  onTakeClip,
  onStopChannel,
  onSetLoopMode,
  onToggleShuffle,
  onClearPlaylist,
  onImportLocalFiles,
  onReplacePlaylist,
  onUpdateScheduledPrograms,
  onStartScheduledProgramNow,
  onStopScheduledProgramNow,
}) => {
  const [activeTab, setActiveTab] = useState<'default_playlist' | 'scheduled_programs'>('default_playlist');

  // Expanded folders state (by folderId) — collapsed by default so 10,000-file folders never clutter the UI!
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  // Per-folder visible item limit (pagination inside expanded folder for 10,000+ files)
  const [folderVisibleCount, setFolderVisibleCount] = useState<Record<string, number>>({});
  const [folderSearchQuery, setFolderSearchQuery] = useState<Record<string, string>>({});

  // Editing clip duration state
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState<number>(0);
  const [editSeconds, setEditSeconds] = useState<number>(15);

  // Manual URL form
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PlaylistItem['category']>('PROGRAM');
  const [duration, setDuration] = useState(300);
  const [videoUrl, setVideoUrl] = useState('');

  // Scheduled Program Editor state
  const todayStr = new Date().toISOString().slice(0, 10);
  const nextMonthStr = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const defaultStartTime = () => {
    const d = new Date(Date.now() + 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
  };

  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [progName, setProgName] = useState('PRIME TIME SPECIAL PROGRAM');
  const [progScheduleType, setProgScheduleType] = useState<ProgramScheduleType>('daily');
  const [progStartDate, setProgStartDate] = useState(todayStr);
  const [progEndDate, setProgEndDate] = useState(nextMonthStr);
  const [progStartTime, setProgStartTime] = useState(defaultStartTime);
  const [progOverlayMode, setProgOverlayMode] = useState<ProgramOverlayMode>('all_overlays');
  const [progItems, setProgItems] = useState<PlaylistItem[]>([]);
  const [expandedProgFolders, setExpandedProgFolders] = useState<Record<string, boolean>>({});
  const [expandedSavedProgramId, setExpandedSavedProgramId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const progFileInputRef = useRef<HTMLInputElement | null>(null);
  const progFolderInputRef = useRef<HTMLInputElement | null>(null);

  const formatDuration = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleStartEditDuration = (item: PlaylistItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClipId(item.id);
    setEditMinutes(Math.floor(item.duration / 60));
    setEditSeconds(Math.floor(item.duration % 60));
  };

  const handleSaveDuration = (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const totalSec = Math.max(1, editMinutes * 60 + editSeconds);
    onUpdateClipDuration?.(channel.id, clipId, totalSec);
    setEditingClipId(null);
  };

  // Group channel.playlist into top-level standalone files and collapsible folders
  const groupedPlaylist = useMemo<GroupedEntry[]>(() => {
    const entries: GroupedEntry[] = [];
    const folderMap = new Map<string, GroupedEntry & { type: 'folder' }>();

    channel.playlist.forEach((item, index) => {
      if (item.folderName || item.folderId) {
        const fId = item.folderId || `folder-${item.folderName}`;
        const fName = item.folderName || 'MEDIA FOLDER';
        let existing = folderMap.get(fId);
        if (!existing) {
          existing = {
            type: 'folder',
            folderId: fId,
            folderName: fName,
            items: [],
            totalDuration: 0,
            firstPlaylistIndex: index,
          };
          folderMap.set(fId, existing);
          entries.push(existing);
        }
        existing.items.push({ item, playlistIndex: index });
        existing.totalDuration += item.duration || 0;
      } else {
        entries.push({
          type: 'file',
          item,
          playlistIndex: index,
        });
      }
    });

    return entries;
  }, [channel.playlist]);

  const totalFolderCount = useMemo(
    () => groupedPlaylist.filter((e) => e.type === 'folder').length,
    [groupedPlaylist]
  );

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
    if (!folderVisibleCount[folderId]) {
      setFolderVisibleCount((prev) => ({ ...prev, [folderId]: 100 }));
    }
  };

  const handleRemoveEntireFolder = (folderId: string, folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = channel.playlist.filter(
      (it) => (it.folderId || `folder-${it.folderName}`) !== folderId && it.folderName !== folderName
    );
    if (onReplacePlaylist) {
      onReplacePlaylist(channel.id, filtered);
    } else {
      channel.playlist
        .filter((it) => (it.folderId || `folder-${it.folderName}`) === folderId)
        .forEach((it) => onRemoveClip(channel.id, it.id));
    }
  };

  // Simulate or import a massive folder (e.g. 10,000 files) without freezing the UI
  const handleAddLargeVirtualFolder = (fileCount: number) => {
    const folderId = `folder-batch-${Date.now()}`;
    const folderName = `MEGA ARCHIVE FOLDER (${fileCount.toLocaleString()} FILES)`;
    const newItems: PlaylistItem[] = [];
    for (let i = 1; i <= fileCount; i++) {
      const sample = DEMO_SAMPLE_VIDEOS[(i - 1) % DEMO_SAMPLE_VIDEOS.length];
      newItems.push({
        id: `${folderId}-item-${i}`,
        title: `${ folderName } - EPISODE #${String(i).padStart(4, '0')}`,
        category: sample.category,
        duration: sample.duration,
        sourceType: 'url',
        videoUrl: sample.url,
        resolution: '1080p',
        folderId,
        folderName,
      });
    }
    if (onReplacePlaylist) {
      onReplacePlaylist(channel.id, [...channel.playlist, ...newItems]);
    }
  };

  // Helper to convert selected local files or folders into PlaylistItem[]
  const buildPlaylistItemsFromFiles = (
    files: FileList | File[],
    forceAsFolderName?: string
  ): PlaylistItem[] => {
    const arr = Array.from(files).filter(
      (f) =>
        f.type.startsWith('video/') ||
        /\.(mp4|webm|ogg|mov|mkv|m4v|avi|ts|mpg|mpeg)$/i.test(f.name)
    );
    const batchTs = Date.now();
    return arr.map((file, idx) => {
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const pathParts = relPath.split('/').filter(Boolean);
      const detectedFolderName =
        forceAsFolderName || (pathParts.length > 1 ? pathParts[0] : undefined);
      const folderId = detectedFolderName
        ? `folder-${detectedFolderName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : undefined;
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const blobUrl = URL.createObjectURL(file);

      return {
        id: `local-${channel.id}-${batchTs}-${idx}`,
        title: cleanName,
        category: 'LOCAL' as const,
        duration: 180,
        sourceType: 'local' as const,
        videoUrl: blobUrl,
        fileName: file.name,
        fileSize: file.size,
        resolution: '1080p',
        folderId,
        folderName: detectedFolderName,
      };
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (onImportLocalFiles) {
        onImportLocalFiles(channel.id, e.target.files);
      }
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (onImportLocalFiles) {
        onImportLocalFiles(channel.id, e.target.files);
      }
    }
  };

  // Scheduled Program File / Folder handlers
  const handleProgAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const added = buildPlaylistItemsFromFiles(e.target.files);
    setProgItems((prev) => [...prev, ...added]);
  };

  const handleProgAddFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const firstRel =
      (e.target.files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const defaultFolder = firstRel.split('/')[0] || `PROGRAM FOLDER ${Date.now().toString().slice(-3)}`;
    const added = buildPlaylistItemsFromFiles(e.target.files, defaultFolder);
    setProgItems((prev) => [...prev, ...added]);
  };

  const handleProgAddSampleFolder = () => {
    const fId = `prog-folder-${Date.now()}`;
    const fName = `MOVIE & SHOWS FOLDER (${DEMO_SAMPLE_VIDEOS.length} FILES)`;
    const sampleItems: PlaylistItem[] = DEMO_SAMPLE_VIDEOS.map((sv, i) => ({
      id: `${fId}-${i}`,
      title: sv.title,
      category: sv.category,
      duration: sv.duration,
      sourceType: 'url',
      videoUrl: sv.url,
      resolution: '1080p',
      folderId: fId,
      folderName: fName,
    }));
    setProgItems((prev) => [...prev, ...sampleItems]);
  };

  const handleSaveScheduledProgram = (e: React.FormEvent) => {
    e.preventDefault();
    if (!progName.trim()) return;

    const existingList = channel.scheduledPrograms || [];
    const itemsToSave: PlaylistItem[] =
      progItems.length > 0
        ? progItems
        : [
            {
              id: `prog-default-${Date.now()}`,
              title: DEMO_SAMPLE_VIDEOS[0].title,
              category: 'PROGRAM',
              duration: DEMO_SAMPLE_VIDEOS[0].duration,
              sourceType: 'url',
              videoUrl: DEMO_SAMPLE_VIDEOS[0].url,
              resolution: '1080p',
            },
          ];

    const normalizedTime =
      progStartTime.split(':').length === 2 ? `${progStartTime}:00` : progStartTime;

    if (editingProgramId) {
      const updated = existingList.map((p) =>
        p.id === editingProgramId
          ? {
              ...p,
              name: progName.trim(),
              scheduleType: progScheduleType,
              startDate: progStartDate,
              endDate: progScheduleType === 'daily' ? progEndDate : progStartDate,
              startTime: normalizedTime,
              overlayMode: progOverlayMode,
              playlist: itemsToSave,
              status: p.status === 'playing' ? ('playing' as const) : ('scheduled' as const),
            }
          : p
      );
      onUpdateScheduledPrograms?.(channel.id, updated);
      setEditingProgramId(null);
    } else {
      const newProg: ScheduledProgram = {
        id: `sched-prog-${Date.now()}`,
        name: progName.trim(),
        enabled: true,
        scheduleType: progScheduleType,
        startDate: progStartDate,
        endDate: progScheduleType === 'daily' ? progEndDate : progStartDate,
        startTime: normalizedTime,
        overlayMode: progOverlayMode,
        playlist: itemsToSave,
        status: 'scheduled',
      };
      onUpdateScheduledPrograms?.(channel.id, [...existingList, newProg]);
    }

    // Reset form for next program
    setProgName(`SCHEDULED PROGRAM #${existingList.length + 2}`);
    setProgItems([]);
  };

  const handleLoadProgramForEdit = (prog: ScheduledProgram) => {
    setEditingProgramId(prog.id);
    setProgName(prog.name);
    setProgScheduleType(prog.scheduleType);
    setProgStartDate(prog.startDate);
    setProgEndDate(prog.endDate || prog.startDate);
    setProgStartTime(prog.startTime);
    setProgOverlayMode(prog.overlayMode);
    setProgItems(prog.playlist || []);
    setActiveTab('scheduled_programs');
  };

  const handleDeleteProgram = (progId: string) => {
    const existingList = channel.scheduledPrograms || [];
    const updated = existingList.filter((p) => p.id !== progId);
    if (channel.activeProgramId === progId) {
      onStopScheduledProgramNow?.(channel.id);
    }
    onUpdateScheduledPrograms?.(channel.id, updated);
    if (editingProgramId === progId) {
      setEditingProgramId(null);
    }
  };

  const handleToggleProgramEnabled = (progId: string) => {
    const existingList = channel.scheduledPrograms || [];
    const updated = existingList.map((p) =>
      p.id === progId ? { ...p, enabled: !p.enabled } : p
    );
    onUpdateScheduledPrograms?.(channel.id, updated);
  };

  // Group items inside the Program Builder into files & folders
  const groupedProgBuilderItems = useMemo<GroupedEntry[]>(() => {
    const entries: GroupedEntry[] = [];
    const folderMap = new Map<string, GroupedEntry & { type: 'folder' }>();
    progItems.forEach((item, index) => {
      if (item.folderName || item.folderId) {
        const fId = item.folderId || `folder-${item.folderName}`;
        const fName = item.folderName || 'PROGRAM FOLDER';
        let existing = folderMap.get(fId);
        if (!existing) {
          existing = {
            type: 'folder',
            folderId: fId,
            folderName: fName,
            items: [],
            totalDuration: 0,
            firstPlaylistIndex: index,
          };
          folderMap.set(fId, existing);
          entries.push(existing);
        }
        existing.items.push({ item, playlistIndex: index });
        existing.totalDuration += item.duration || 0;
      } else {
        entries.push({ type: 'file', item, playlistIndex: index });
      }
    });
    return entries;
  }, [progItems]);

  const handleAddManualUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !videoUrl.trim()) return;
    onAddClip(channel.id, {
      title: title.trim(),
      category,
      duration: Number(duration) || 180,
      sourceType: 'url',
      videoUrl: videoUrl.trim(),
      resolution: '1080p',
    });
    setTitle('');
    setVideoUrl('');
    setShowUrlForm(false);
  };

  const totalDuration = channel.playlist.reduce((acc, item) => acc + item.duration, 0);
  const isPlaying = channel.status === 'PLAYING';
  const currentClip = channel.playlist[channel.currentClipIndex];
  const scheduledPrograms = channel.scheduledPrograms || [];
  const activeProgram = channel.activeProgramId
    ? scheduledPrograms.find((p) => p.id === channel.activeProgramId)
    : undefined;

  return (
    <div className="p-3 bg-[#07070a] text-zinc-100 space-y-3 select-none">
      {/* Hidden File & Folder Inputs for Default Playlist */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.ts"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.ts"
        multiple
        // @ts-expect-error webkitdirectory is standard for folder selection
        webkitdirectory="true"
        directory="true"
        className="hidden"
        onChange={handleFolderChange}
      />

      {/* Hidden File & Folder Inputs for Scheduled Program */}
      <input
        ref={progFileInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.ts"
        multiple
        className="hidden"
        onChange={handleProgAddFiles}
      />
      <input
        ref={progFolderInputRef}
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.ts"
        multiple
        // @ts-expect-error webkitdirectory is standard for folder selection
        webkitdirectory="true"
        directory="true"
        className="hidden"
        onChange={handleProgAddFolder}
      />

      {/* ===================================================================== */}
      {/* ACTIVE SCHEDULED PROGRAM STATUS BANNER (PAUSE & EXACT RESUME ENGINE)  */}
      {/* ===================================================================== */}
      {activeProgram && (
        <div className="bg-gradient-to-r from-amber-950/90 via-red-950/90 to-zinc-900 border-2 border-amber-500 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500 text-black flex items-center justify-center font-black shrink-0 animate-pulse">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-black rounded font-mono uppercase">
                  ● SCHEDULED PROGRAM ON AIR
                </span>
                <span className="text-sm font-black text-white">{activeProgram.name}</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border ${
                    OVERLAY_MODE_LABELS[activeProgram.overlayMode].badgeClass
                  }`}
                >
                  {OVERLAY_MODE_LABELS[activeProgram.overlayMode].short}
                </span>
              </div>
              <p className="text-xs text-amber-200/90 font-mono mt-1">
                Clip {(channel.activeProgramClipIndex || 0) + 1} of {activeProgram.playlist.length} •{' '}
                <span className="text-cyan-300 font-bold">
                  Default Main Playlist PAUSED at Clip #{(channel.savedDefaultIndex || 0) + 1} (
                  {formatDuration(channel.savedDefaultTime || 0)}) — Auto-Resumes exact frame after
                  program finishes!
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={() => onStopScheduledProgramNow?.(channel.id)}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-black font-mono flex items-center gap-1.5 shadow"
          >
            <RotateCcw className="w-4 h-4" />
            <span>END PROGRAM &amp; RESUME DEFAULT PLAYLIST NOW</span>
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TOP MODE SWITCHER: DEFAULT MAIN PLAYLIST vs SCHEDULED PROGRAMS        */}
      {/* ===================================================================== */}
      <div className="bg-[#0d0d12] p-2 rounded-xl border border-zinc-800/90 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('default_playlist')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black font-mono transition border ${
              activeTab === 'default_playlist'
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-md'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>1. DEFAULT MAIN PLAYLIST ({channel.playlist.length} FILES / {totalFolderCount} FOLDERS)</span>
          </button>

          <button
            onClick={() => setActiveTab('scheduled_programs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black font-mono transition border ${
              activeTab === 'scheduled_programs'
                ? 'bg-amber-500 text-black border-amber-300 shadow-md'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>
              2. NEXT PROGRAM / SCHEDULED PROGRAMS ({scheduledPrograms.length})
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            CH 0{channel.id}: <strong className="text-white">{channel.name}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-cyan-400">
            TOTAL DURATION: <strong>{formatDuration(totalDuration)}</strong>
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: DEFAULT MAIN PLAYLIST (WITH COLLAPSIBLE FOLDER GROUPING)       */}
      {/* ===================================================================== */}
      {activeTab === 'default_playlist' && (
        <>
          {/* Top Action Bar */}
          <div className="bg-[#0d0d12] p-3 rounded-xl border border-zinc-800/90 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div>
              <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Film className="w-4 h-4 text-emerald-400" />
                <span>DEFAULT 24/7 MASTER PLAYLIST (FOLDER-GROUPED FOR 10,000+ FILES)</span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Standalone files show at top level. Folders show as a single Folder Row — click any
                Folder to expand &amp; view its files inside.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                    fileInputRef.current.click();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow-md cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Video Files</span>
              </button>

              <button
                onClick={() => {
                  if (folderInputRef.current) {
                    folderInputRef.current.value = '';
                    folderInputRef.current.click();
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition shadow-md cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>+ Add Video Folder</span>
              </button>

              <button
                onClick={() => handleAddLargeVirtualFolder(10000)}
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition shadow-md cursor-pointer"
                title="Add a grouped folder containing 10,000 broadcast items to verify zero-scroll folder grouping"
              >
                <Layers className="w-4 h-4" />
                <span>+ Add 10,000-File Folder</span>
              </button>

              <button
                onClick={() => setShowUrlForm(!showUrlForm)}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-bold border border-zinc-700 transition cursor-pointer"
              >
                <FileVideo className="w-3.5 h-3.5 text-cyan-400" />
                <span>+ Stream URL</span>
              </button>

              {channel.playlist.length > 0 && (
                <button
                  onClick={() => onClearPlaylist?.(channel.id)}
                  className="flex items-center gap-1 px-2.5 py-2 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/80 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          {/* Optional Manual Stream URL Form */}
          {showUrlForm && (
            <form
              onSubmit={handleAddManualUrl}
              className="bg-[#0d0d12] p-3 rounded-xl border border-cyan-800/60 grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end"
            >
              <div className="md:col-span-4">
                <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                  Clip Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Evening Headlines"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white"
                  required
                />
              </div>
              <div className="md:col-span-4">
                <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                  Direct Video URL (.mp4 / .m3u8)
                </label>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white font-mono"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">
                  Duration (Sec)
                </label>
                <input
                  type="number"
                  min={5}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div className="md:col-span-2 flex gap-1.5">
                <button
                  type="submit"
                  className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-1.5 px-3 rounded text-xs"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowUrlForm(false)}
                  className="bg-zinc-800 text-zinc-400 py-1.5 px-2.5 rounded text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Transport & Loop Mode Bar */}
          <div className="bg-[#0d0d12] px-3.5 py-2.5 rounded-xl border border-zinc-800/90 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold border ${
                  isPlaying
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-zinc-500'
                  }`}
                />
                <span>{isPlaying ? 'ON-AIR PLAYING' : 'STOPPED'}</span>
              </div>

              {currentClip && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500 font-mono">NOW:</span>
                  <span className="font-bold text-white truncate max-w-[260px]">
                    {currentClip.title}
                  </span>
                  {currentClip.folderName && (
                    <span className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-700 text-blue-300 text-[10px] font-mono">
                      📁 {currentClip.folderName}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onSetLoopMode && (
                <button
                  type="button"
                  onClick={() =>
                    onSetLoopMode(
                      channel.id,
                      channel.loopMode !== 'off' ? 'off' : 'playlist'
                    )
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-bold border transition cursor-pointer ${
                    channel.loopMode !== 'off'
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>LOOP PLAYLIST: {channel.loopMode !== 'off' ? 'ON' : 'OFF'}</span>
                </button>
              )}
              {onToggleShuffle && (
                <button
                  type="button"
                  onClick={() => onToggleShuffle(channel.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-bold border transition cursor-pointer ${
                    channel.shuffle
                      ? 'bg-amber-950/90 text-amber-300 border-amber-500'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>SHUFFLE: {channel.shuffle ? 'ON' : 'OFF'}</span>
                </button>
              )}
              <span className="px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono font-bold">
                CONTINUOUS 24/7 SEQUENTIAL PLAYOUT
              </span>
            </div>
          </div>

          {/* ================================================================= */}
          {/* FOLDER-GROUPED & TOP-LEVEL FILE PLAYLIST TABLE                    */}
          {/* ================================================================= */}
          <div className="bg-[#0d0d12] rounded-xl border border-zinc-800/90 overflow-hidden shadow-lg">
            <div className="px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span>
                PLAYLIST STRUCTURE: {groupedPlaylist.filter((g) => g.type === 'file').length} TOP
                FILES • {totalFolderCount} FOLDERS ({channel.playlist.length.toLocaleString()}{' '}
                TOTAL ITEMS)
              </span>
              <span className="text-cyan-400 font-bold">
                Click any 📁 Folder row to open/close its files • Double-click any file to Play Now
              </span>
            </div>

            {groupedPlaylist.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto" />
                <div className="text-sm font-bold text-zinc-300">Playlist is Empty</div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  Click &ldquo;+ Add Video Files&rdquo; for individual files or &ldquo;+ Add Video
                  Folder&rdquo; to group folders cleanly.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60">
                {groupedPlaylist.map((entry) => {
                  if (entry.type === 'file') {
                    const { item, playlistIndex } = entry;
                    const isCurrent =
                      !channel.activeProgramId && playlistIndex === channel.currentClipIndex;
                    const isEditing = editingClipId === item.id;

                    return (
                      <div
                        key={item.id}
                        onDoubleClick={() => onTakeClip?.(channel.id, playlistIndex)}
                        className={`px-4 py-2.5 flex items-center justify-between gap-3 transition cursor-pointer ${
                          isCurrent
                            ? 'bg-emerald-950/30 border-l-4 border-l-emerald-500'
                            : 'hover:bg-zinc-900/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-xs text-zinc-500 w-8">
                            #{String(playlistIndex + 1).padStart(2, '0')}
                          </span>
                          <FileVideo
                            className={`w-4 h-4 shrink-0 ${
                              isCurrent ? 'text-emerald-400' : 'text-zinc-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-bold truncate ${
                                  isCurrent ? 'text-emerald-300' : 'text-zinc-100'
                                }`}
                              >
                                {item.title}
                              </span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-mono font-black">
                                  ON AIR
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Standalone File • {item.category}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {isEditing ? (
                            <div
                              className="flex items-center gap-1 bg-zinc-950 p-1 rounded border border-amber-500/60"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="number"
                                min={0}
                                value={editMinutes}
                                onChange={(e) =>
                                  setEditMinutes(Math.max(0, parseInt(e.target.value) || 0))
                                }
                                className="w-11 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs text-center font-mono text-white"
                              />
                              <span className="text-xs text-zinc-500">:</span>
                              <input
                                type="number"
                                min={0}
                                max={59}
                                value={editSeconds}
                                onChange={(e) =>
                                  setEditSeconds(
                                    Math.min(59, Math.max(0, parseInt(e.target.value) || 0))
                                  )
                                }
                                className="w-11 bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs text-center font-mono text-white"
                              />
                              <button
                                onClick={(e) => handleSaveDuration(item.id, e)}
                                className="p-1 bg-emerald-600 text-white rounded"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingClipId(null);
                                }}
                                className="p-1 bg-zinc-800 text-zinc-400 rounded"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div
                              onClick={(e) => handleStartEditDuration(item, e)}
                              className="flex items-center gap-1 font-mono text-xs text-zinc-300 hover:text-amber-400 px-2 py-1 rounded hover:bg-zinc-800/60"
                            >
                              <Clock className="w-3 h-3 text-zinc-500" />
                              <span>{formatDuration(item.duration)}</span>
                              <Edit3 className="w-3 h-3 opacity-60" />
                            </div>
                          )}

                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => onTakeClip?.(channel.id, playlistIndex)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Play</span>
                            </button>
                            <button
                              onClick={() => onMoveClip(channel.id, playlistIndex, 'up')}
                              disabled={playlistIndex === 0}
                              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onMoveClip(channel.id, playlistIndex, 'down')}
                              disabled={playlistIndex === channel.playlist.length - 1}
                              className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onRemoveClip(channel.id, item.id)}
                              className="p-1 rounded bg-zinc-900 hover:bg-rose-950 text-zinc-400 hover:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // =============================================================
                  // FOLDER GROUP ROW (Collapsed by default, click to show files)
                  // =============================================================
                  const isExpanded = !!expandedFolders[entry.folderId];
                  const activeInFolderIdx = entry.items.findIndex(
                    (x) => !channel.activeProgramId && x.playlistIndex === channel.currentClipIndex
                  );
                  const isFolderPlaying = activeInFolderIdx !== -1;
                  const searchQ = (folderSearchQuery[entry.folderId] || '').toLowerCase().trim();
                  const filteredFolderItems = searchQ
                    ? entry.items.filter((x) => x.item.title.toLowerCase().includes(searchQ))
                    : entry.items;
                  const limit = folderVisibleCount[entry.folderId] || 100;
                  const visibleSlice = filteredFolderItems.slice(0, limit);

                  return (
                    <div key={entry.folderId} className="bg-[#0b0b12]">
                      {/* Folder Header Bar */}
                      <div
                        onClick={() => toggleFolderExpand(entry.folderId)}
                        className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition border-l-4 ${
                          isFolderPlaying
                            ? 'bg-blue-950/40 border-l-emerald-400'
                            : isExpanded
                            ? 'bg-blue-950/25 border-l-blue-500'
                            : 'hover:bg-zinc-900/80 border-l-blue-600/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-blue-400 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-blue-400 shrink-0" />
                          )}
                          {isExpanded ? (
                            <FolderOpen className="w-5 h-5 text-amber-400 shrink-0" />
                          ) : (
                            <Folder className="w-5 h-5 text-amber-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-black text-white uppercase tracking-wide">
                                📁 {entry.folderName}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-blue-600/30 border border-blue-500/60 text-blue-200 text-[10px] font-mono font-black">
                                {entry.items.length.toLocaleString()} FILES IN FOLDER
                              </span>
                              {isFolderPlaying && (
                                <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-mono font-black">
                                  ● PLAYING FILE #{activeInFolderIdx + 1} /{' '}
                                  {entry.items.length.toLocaleString()}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                              {isExpanded
                                ? 'Click folder row to collapse files'
                                : `Click folder to view all ${entry.items.length.toLocaleString()} files inside`}
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-2 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs font-mono text-cyan-300 bg-zinc-900 px-2.5 py-1 rounded border border-zinc-800">
                            ⏱ {formatDuration(entry.totalDuration)}
                          </span>

                          <button
                            onClick={() => onTakeClip?.(channel.id, entry.firstPlaylistIndex)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Play Folder</span>
                          </button>

                          <button
                            onClick={() => toggleFolderExpand(entry.folderId)}
                            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono font-bold"
                          >
                            {isExpanded ? 'Hide Files ▲' : 'Show Files ▼'}
                          </button>

                          <button
                            onClick={(e) =>
                              handleRemoveEntireFolder(entry.folderId, entry.folderName, e)
                            }
                            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950 text-zinc-400 hover:text-rose-400 border border-zinc-800"
                            title="Delete entire folder and all its files"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Folder Files View (Windowed for 10,000+ files) */}
                      {isExpanded && (
                        <div className="bg-black/60 border-t border-zinc-800/80 pl-6 pr-3 py-2 space-y-2">
                          {/* Search / Filter bar inside large folders */}
                          {entry.items.length > 10 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/90 px-3 py-1.5 rounded-lg border border-zinc-800">
                              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                <Search className="w-3.5 h-3.5 text-zinc-400" />
                                <input
                                  type="text"
                                  value={folderSearchQuery[entry.folderId] || ''}
                                  onChange={(e) =>
                                    setFolderSearchQuery((prev) => ({
                                      ...prev,
                                      [entry.folderId]: e.target.value,
                                    }))
                                  }
                                  placeholder={`Search inside ${entry.folderName} (${entry.items.length.toLocaleString()} files)...`}
                                  className="w-full bg-transparent text-xs text-white focus:outline-none font-mono"
                                />
                              </div>
                              <span className="text-[10px] font-mono text-zinc-400">
                                Showing {visibleSlice.length.toLocaleString()} of{' '}
                                {filteredFolderItems.length.toLocaleString()} files
                              </span>
                            </div>
                          )}

                          <div className="max-h-[360px] overflow-y-auto divide-y divide-zinc-900 border border-zinc-800/70 rounded-lg">
                            {visibleSlice.map(({ item, playlistIndex }, idxInFolder) => {
                              const isCurrent =
                                !channel.activeProgramId &&
                                playlistIndex === channel.currentClipIndex;
                              return (
                                <div
                                  key={item.id}
                                  onDoubleClick={() => onTakeClip?.(channel.id, playlistIndex)}
                                  className={`px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-mono cursor-pointer ${
                                    isCurrent
                                      ? 'bg-emerald-950/50 text-emerald-300 font-bold'
                                      : 'hover:bg-zinc-900/80 text-zinc-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="text-[10px] text-zinc-500 w-12">
                                      #{idxInFolder + 1}
                                    </span>
                                    <FileVideo className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                    <span className="truncate">{item.title}</span>
                                    {isCurrent && (
                                      <span className="px-1.5 py-0.2 rounded bg-emerald-600 text-white text-[9px] font-black">
                                        PLAYING
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-zinc-400 text-[11px]">
                                      {formatDuration(item.duration)}
                                    </span>
                                    <button
                                      onClick={() => onTakeClip?.(channel.id, playlistIndex)}
                                      className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-bold"
                                    >
                                      Play
                                    </button>
                                    <button
                                      onClick={() => onRemoveClip(channel.id, item.id)}
                                      className="p-1 text-zinc-500 hover:text-rose-400"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Load more button if folder has > 100 files */}
                          {filteredFolderItems.length > limit && (
                            <div className="flex items-center justify-center pt-1">
                              <button
                                onClick={() =>
                                  setFolderVisibleCount((prev) => ({
                                    ...prev,
                                    [entry.folderId]: limit + 250,
                                  }))
                                }
                                className="px-4 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500 text-blue-200 text-xs font-mono font-bold"
                              >
                                + Show Next 250 Files ({filteredFolderItems.length - limit} remaining)
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: NEXT PROGRAM / SCHEDULED PROGRAM PLAYLIST AUTOMATION           */}
      {/* ===================================================================== */}
      {activeTab === 'scheduled_programs' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* LEFT 5 COLS: CREATE / EDIT SCHEDULED PROGRAM BUILDER */}
          <form
            onSubmit={handleSaveScheduledProgram}
            className="lg:col-span-5 bg-[#0d0d12] rounded-xl border border-amber-500/40 p-3.5 space-y-3 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-black text-white uppercase tracking-wider font-mono">
                  {editingProgramId ? '✏️ EDIT SCHEDULED PROGRAM' : '+ CREATE NEW SCHEDULED PROGRAM'}
                </h3>
              </div>
              {editingProgramId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingProgramId(null);
                    setProgName('NEW SCHEDULED PROGRAM');
                    setProgItems([]);
                  }}
                  className="text-[10px] font-mono text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-zinc-800"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            {/* 1. Program Name */}
            <div>
              <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1">
                1. Program Name / Title
              </label>
              <input
                type="text"
                value={progName}
                onChange={(e) => setProgName(e.target.value)}
                placeholder="e.g. Morning Devotional / Evening Cinema / News Bulletin"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white font-bold focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            {/* 2. Schedule Mode: Daily vs One-Time */}
            <div>
              <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1">
                2. Schedule Play Mode (Daily Same Time vs One-Time Only)
              </label>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setProgScheduleType('daily')}
                  className={`py-2 px-2.5 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition ${
                    progScheduleType === 'daily'
                      ? 'bg-amber-500 text-black border-amber-300 shadow'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>DAILY (Every Day)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProgScheduleType('once')}
                  className={`py-2 px-2.5 rounded-lg border font-bold flex items-center justify-center gap-1.5 transition ${
                    progScheduleType === 'once'
                      ? 'bg-cyan-600 text-white border-cyan-400 shadow'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>ONE-TIME (That Day Only)</span>
                </button>
              </div>
            </div>

            {/* 3. Date & Time Pickers (Start Date, End Date, Start Time) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={progStartDate}
                  onChange={(e) => setProgStartDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1">
                  {progScheduleType === 'daily' ? 'End Date (Daily Until)' : 'End Date (Same Day)'}
                </label>
                <input
                  type="date"
                  value={progScheduleType === 'daily' ? progEndDate : progStartDate}
                  disabled={progScheduleType === 'once'}
                  onChange={(e) => setProgEndDate(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white disabled:opacity-50"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-amber-400 uppercase">
                    Play Time (24h)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nowPlus10Sec = new Date(Date.now() + 15000);
                      setProgStartTime(
                        `${String(nowPlus10Sec.getHours()).padStart(2, '0')}:${String(
                          nowPlus10Sec.getMinutes()
                        ).padStart(2, '0')}:${String(nowPlus10Sec.getSeconds()).padStart(2, '0')}`
                      );
                    }}
                    className="text-[9px] text-cyan-400 hover:underline"
                    title="Set start time to 15 seconds from now for instant auto-trigger testing"
                  >
                    +15s Test
                  </button>
                </div>
                <input
                  type="time"
                  step="1"
                  value={progStartTime}
                  onChange={(e) => setProgStartTime(e.target.value)}
                  className="w-full bg-zinc-900 border border-amber-500/70 rounded-lg px-2 py-1.5 text-xs text-amber-300 font-bold"
                  required
                />
              </div>
            </div>

            {/* 4. Per-Program Overlay Visibility Option */}
            <div>
              <label className="block text-[10px] font-mono font-bold text-zinc-400 uppercase mb-1">
                4. Program Graphics &amp; Overlay Mode (During This Program)
              </label>
              <div className="grid grid-cols-1 gap-1.5 font-mono">
                {(
                  ['all_overlays', 'logo_only', 'banners_only', 'clean_none'] as ProgramOverlayMode[]
                ).map((mode) => {
                  const info = OVERLAY_MODE_LABELS[mode];
                  const selected = progOverlayMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setProgOverlayMode(mode)}
                      className={`p-2 rounded-lg border text-left transition flex items-center justify-between ${
                        selected
                          ? 'bg-zinc-800 border-amber-400 text-white shadow'
                          : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{info.label}</div>
                        <div className="text-[10px] text-zinc-400">{info.desc}</div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold border shrink-0 ${info.badgeClass}`}
                      >
                        {selected ? '✓ SELECTED' : info.short}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Add Files & Folders to this Program */}
            <div className="space-y-2 pt-1 border-t border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <label className="text-[10px] font-mono font-bold text-zinc-300 uppercase">
                  5. Program Files &amp; Folders ({progItems.length} Clips)
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (progFileInputRef.current) {
                        progFileInputRef.current.value = '';
                        progFileInputRef.current.click();
                      }
                    }}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (progFolderInputRef.current) {
                        progFolderInputRef.current.value = '';
                        progFolderInputRef.current.click();
                      }
                    }}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-bold flex items-center gap-1"
                  >
                    <FolderPlus className="w-3 h-3" />
                    <span>+ Add Folder</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleProgAddSampleFolder}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 rounded text-[10px] font-mono font-bold border border-zinc-700"
                  >
                    + Demo Folder
                  </button>
                </div>
              </div>

              {/* Grouped list of files & folders inside Program Builder */}
              <div className="bg-black/60 rounded-lg border border-zinc-800 max-h-44 overflow-y-auto divide-y divide-zinc-800/70">
                {groupedProgBuilderItems.length === 0 ? (
                  <div className="p-3 text-center text-[11px] text-zinc-500 font-mono">
                    Add video files or folders to play one-by-one during this scheduled program.
                  </div>
                ) : (
                  groupedProgBuilderItems.map((entry) => {
                    if (entry.type === 'file') {
                      return (
                        <div
                          key={entry.item.id}
                          className="px-2.5 py-1.5 flex items-center justify-between text-xs font-mono"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <FileVideo className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="truncate text-zinc-200">{entry.item.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-zinc-400">
                              {formatDuration(entry.item.duration)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setProgItems((prev) =>
                                  prev.filter((x) => x.id !== entry.item.id)
                                )
                              }
                              className="text-zinc-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const isExp = !!expandedProgFolders[entry.folderId];
                    return (
                      <div key={entry.folderId} className="bg-zinc-950/80">
                        <div
                          onClick={() =>
                            setExpandedProgFolders((prev) => ({
                              ...prev,
                              [entry.folderId]: !prev[entry.folderId],
                            }))
                          }
                          className="px-2.5 py-1.5 flex items-center justify-between text-xs font-mono cursor-pointer hover:bg-zinc-900"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {isExp ? (
                              <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            ) : (
                              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                            <span className="font-bold text-amber-300 truncate">
                              📁 {entry.folderName}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 text-[10px]">
                              {entry.items.length} files
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-cyan-400">
                              {formatDuration(entry.totalDuration)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProgItems((prev) =>
                                  prev.filter(
                                    (x) =>
                                      (x.folderId || `folder-${x.folderName}`) !== entry.folderId
                                  )
                                );
                              }}
                              className="text-zinc-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {isExp && (
                          <div className="pl-6 pr-2 py-1 bg-black/80 divide-y divide-zinc-900 max-h-28 overflow-y-auto">
                            {entry.items.map(({ item }, i) => (
                              <div
                                key={item.id}
                                className="py-1 flex items-center justify-between text-[10px] font-mono text-zinc-400"
                              >
                                <span className="truncate">
                                  {i + 1}. {item.title}
                                </span>
                                <span>{formatDuration(item.duration)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-lg text-xs font-mono uppercase tracking-wider shadow-md transition"
            >
              {editingProgramId
                ? '💾 SAVE CHANGES TO SCHEDULED PROGRAM'
                : '+ SAVE & ARM SCHEDULED PROGRAM'}
            </button>
          </form>

          {/* RIGHT 7 COLS: SCHEDULED PROGRAMS QUEUE & SEQUENTIAL AUTOMATION LIST */}
          <div className="lg:col-span-7 bg-[#0d0d12] rounded-xl border border-zinc-800/90 p-3.5 flex flex-col justify-between space-y-3 shadow-lg">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
                <div>
                  <h3 className="text-xs font-black text-white uppercase tracking-wider font-mono flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>
                      ARMED SCHEDULED PROGRAMS QUEUE ({scheduledPrograms.length} PROGRAMS)
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    When a program starts, the Default Main Playlist pauses at its exact second. If
                    multiple programs are queued, they play sequentially one after another, then
                    Default Playlist resumes where it paused!
                  </p>
                </div>
              </div>

              {scheduledPrograms.length === 0 ? (
                <div className="p-8 text-center bg-black/40 rounded-xl border border-zinc-800/80 space-y-2">
                  <Calendar className="w-8 h-8 text-amber-400/60 mx-auto" />
                  <div className="text-sm font-bold text-zinc-200">
                    No Scheduled Programs Created Yet
                  </div>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    Use the form on the left to add a Scheduled Program with Files/Folders, Start
                    Date &amp; Time, Daily or One-Time mode, and Overlay Visibility.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  {scheduledPrograms.map((prog, idx) => {
                    const isCurrentlyPlaying = channel.activeProgramId === prog.id;
                    const totalProgDuration = (prog.playlist || []).reduce(
                      (acc, it) => acc + (it.duration || 0),
                      0
                    );
                    const folderNames = Array.from(
                      new Set(
                        (prog.playlist || [])
                          .map((it) => it.folderName)
                          .filter((x): x is string => !!x)
                      )
                    );
                    const isSavedExp = expandedSavedProgramId === prog.id;
                    const ovInfo = OVERLAY_MODE_LABELS[prog.overlayMode || 'all_overlays'];

                    return (
                      <div
                        key={prog.id}
                        className={`rounded-xl border p-3 transition ${
                          isCurrentlyPlaying
                            ? 'bg-amber-950/30 border-amber-400 shadow-lg'
                            : prog.enabled
                            ? 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                            : 'bg-zinc-950/60 border-zinc-900 opacity-60'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] font-bold">
                                PROG #{idx + 1}
                              </span>
                              <span className="text-sm font-black text-white">{prog.name}</span>
                              {isCurrentlyPlaying && (
                                <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-mono font-black animate-pulse">
                                  ● PLAYING ON AIR NOW
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${ovInfo.badgeClass}`}
                              >
                                {ovInfo.short}
                              </span>
                            </div>

                            {/* Date, Time & Recurrence Badges */}
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-300 pt-0.5">
                              <span className="px-2 py-0.5 rounded bg-black/60 border border-zinc-800 text-amber-300 font-bold">
                                🕒 TIME: {prog.startTime}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-black/60 border border-zinc-800 text-cyan-300">
                                {prog.scheduleType === 'daily'
                                  ? `↻ DAILY (${prog.startDate} → ${prog.endDate || 'Ongoing'})`
                                  : `📅 ONE-TIME (${prog.startDate})`}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-black/60 border border-zinc-800 text-zinc-300">
                                🎬 {prog.playlist.length} Files ({formatDuration(totalProgDuration)})
                              </span>
                              {folderNames.length > 0 && (
                                <span className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-700 text-blue-300">
                                  📁 {folderNames.length} Folder(s): {folderNames.join(', ')}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons: Play Now, Edit, Expand Files, Delete */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isCurrentlyPlaying ? (
                              <button
                                type="button"
                                onClick={() => onStopScheduledProgramNow?.(channel.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold flex items-center gap-1"
                              >
                                <PauseCircle className="w-3.5 h-3.5" />
                                <span>Stop &amp; Resume Default</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onStartScheduledProgramNow?.(channel.id, prog.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center gap-1 shadow"
                                title="Pause Default Main Playlist right now and play this Scheduled Program"
                              >
                                <PlayCircle className="w-3.5 h-3.5" />
                                <span>Play Program Now</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleLoadProgramForEdit(prog)}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-amber-300 text-xs font-mono font-bold flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSavedProgramId(isSavedExp ? null : prog.id)
                              }
                              className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono"
                            >
                              {isSavedExp ? 'Hide Files ▲' : 'Files ▼'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleProgramEnabled(prog.id)}
                              className={`px-2 py-1.5 rounded-lg text-xs font-mono font-bold border ${
                                prog.enabled
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                                  : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                              }`}
                            >
                              {prog.enabled ? 'ARMED' : 'OFF'}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteProgram(prog.id)}
                              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950 text-zinc-400 hover:text-rose-400 border border-zinc-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Expandable Program Files & Folders Preview */}
                        {isSavedExp && (
                          <div className="mt-2.5 pt-2 border-t border-zinc-800/80 bg-black/50 rounded-lg p-2 max-h-40 overflow-y-auto divide-y divide-zinc-900 font-mono text-[11px]">
                            {prog.playlist.map((it, i) => {
                              const isCurrentProgClip =
                                isCurrentlyPlaying &&
                                (channel.activeProgramClipIndex || 0) === i;
                              return (
                                <div
                                  key={it.id}
                                  className={`py-1 px-2 flex items-center justify-between ${
                                    isCurrentProgClip
                                      ? 'bg-amber-500/20 text-amber-300 font-bold'
                                      : 'text-zinc-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="text-zinc-500">#{i + 1}</span>
                                    {it.folderName && (
                                      <span className="px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 text-[10px]">
                                        📁 {it.folderName}
                                      </span>
                                    )}
                                    <span className="truncate">{it.title}</span>
                                  </div>
                                  <span className="text-zinc-400 shrink-0">
                                    {formatDuration(it.duration)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pause & Exact Resume Automation Explanation Footer */}
            <div className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-2.5 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
              <span>
                ✅ <strong className="text-emerald-400">AUTO-PAUSE &amp; RESUME:</strong> Default
                Playlist pauses at exact frame when Program starts &amp; resumes automatically
                after completion.
              </span>
              {channel.savedDefaultIndex !== undefined && (
                <span className="text-amber-300 font-bold">
                  Saved Resume Point: Clip #{(channel.savedDefaultIndex || 0) + 1} @{' '}
                  {formatDuration(channel.savedDefaultTime || 0)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
