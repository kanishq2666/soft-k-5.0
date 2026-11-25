import React, { useRef } from 'react';
import {
  FileVideo,
  FolderPlus,
  Layers,
  Timer,
  ScrollText,
  Radio,
  Monitor,
  Image as ImageIcon,
  Layout,
  Clock,
  Hourglass,
  Shield,
  Maximize2,
  Phone,
} from 'lucide-react';
import { TVChannel } from '../types/playout';
import { ActiveModalType } from './StudioFeatureModals';
import { LeftWorkspaceTab } from './LeftPlaylistWorkspace';
import {
  ALL_VIDEO_AND_SWF_ACCEPT,
  filterFolderVideoAndSwfFiles,
} from '../services/swfEngine';

interface BottomControlCardsProps {
  channel: TVChannel;
  onOpenModal: (modal: ActiveModalType) => void;
  onLaunchDisplayOutput: () => void;
  onImportVideos?: (id: number, files: FileList | File[], folderName?: string) => void;
  onSelectLeftTab?: (tab: LeftWorkspaceTab) => void;
  everyNMinEnabled?: boolean;
  everyNMinCountdownSec?: number;
}

function formatMiniTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export const BottomControlCards: React.FC<BottomControlCardsProps> = ({
  channel,
  onOpenModal,
  onLaunchDisplayOutput,
  onImportVideos,
  onSelectLeftTab,
  everyNMinEnabled = false,
  everyNMinCountdownSec = 0,
}) => {
  const quickVideoInputRef = useRef<HTMLInputElement | null>(null);
  const quickFolderInputRef = useRef<HTMLInputElement | null>(null);

  const g = channel.graphics as any;
  const topAdsCount = (g.topTickerItems || []).length;
  const bottomAdsCount = (g.tickerItems || []).length;
  const lShapeMediaCount = channel.lShape?.playlist?.length || 0;
  const lShapeActive = !!channel.lShape?.enabled;
  const scheduledProgCount = (channel.scheduledPrograms || []).length;
  const isProgActive = !!channel.activeProgramId;

  const activeLogosCount = [
    g.channelLogo,
    g.sponsorLogo1 || g.sponsor1Logo,
    g.sponsorLogo2 || g.sponsor2Logo,
    g.sponsorLogo3,
    g.sponsorLogo4,
  ].filter((l) => l && l.enabled).length;

  const clockOn = channel.graphics.clockEnabled !== false;
  const backInOn = !!g.backInTimer?.enabled;
  const backInSeconds = Math.max(0, Number(g.backInTimer?.seconds ?? 57));

  const handleToggleSoftwareFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="px-3 pb-1.5 space-y-1.5 shrink-0 select-none">
      {/* Hidden File & Folder Pickers for Add Video / Add Folder */}
      <input
        ref={quickVideoInputRef}
        type="file"
        accept={ALL_VIDEO_AND_SWF_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const selected = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = '';
          if (selected.length > 0 && onImportVideos) {
            onImportVideos(channel.id, selected);
          }
        }}
      />
      <input
        ref={(el) => {
          quickFolderInputRef.current = el;
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
          if (rawFiles.length > 0 && onImportVideos) {
            const files = filterFolderVideoAndSwfFiles(rawFiles);
            if (files.length > 0) {
              const firstRel = (files[0] as any).webkitRelativePath || '';
              const folderName = firstRel.split('/')[0] || 'Folder 1';
              onImportVideos(channel.id, files, folderName);
            }
          }
        }}
      />

      {/* Unified Pro Broadcast Playout Bottom Console (11 Sleek Hardware Keys) */}
      <div className="bg-[#080c14] border border-[#1c2638] rounded-lg p-1.5 grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-11 gap-1.5 shadow-lg">
        {/* 1. Add Video */}
        <button
          type="button"
          onClick={() => quickVideoInputRef.current?.click()}
          className="px-2 py-1.5 rounded bg-[#0d1320] hover:bg-[#152036] border border-[#24314a] hover:border-amber-400/60 transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden"
          title="Import Video or SWF files into Main Playlist"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <FileVideo className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold text-slate-100 truncate">Add Video</span>
          </div>
          <span className="text-[9px] font-mono text-slate-400 font-bold shrink-0">
            {channel.playlist.length}
          </span>
        </button>

        {/* 2. Add Folder */}
        <button
          type="button"
          onClick={() => quickFolderInputRef.current?.click()}
          className="px-2 py-1.5 rounded bg-[#0d1320] hover:bg-[#152036] border border-[#24314a] hover:border-amber-400/60 transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden"
          title="Import entire Video/SWF Folder as Playlist Group"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderPlus className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="text-[11px] font-bold text-slate-100 truncate">Add Folder</span>
          </div>
          <span className="text-[9px] font-mono text-slate-400 font-bold shrink-0">DIR</span>
        </button>

        {/* 3. Program */}
        <button
          type="button"
          onClick={() => onSelectLeftTab && onSelectLeftTab('program')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            isProgActive
              ? 'bg-[#12261e] border-emerald-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-sky-400/60 text-slate-100'
          }`}
          title="Open Scheduled Program Playlist Deck"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Program</span>
          </div>
          <span className="text-[9px] font-mono text-emerald-300 font-bold shrink-0">
            {isProgActive ? 'AIR' : scheduledProgCount}
          </span>
        </button>

        {/* 4. Every N Min Ads */}
        <button
          type="button"
          onClick={() => onSelectLeftTab && onSelectLeftTab('every_n_min')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            everyNMinEnabled
              ? 'bg-[#1f180b] border-amber-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-amber-400/60 text-slate-100'
          }`}
          title="Open Every N Min Commercial Break Scheduler"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Timer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Every N Min Ads</span>
          </div>
          <span className="text-[9px] font-mono text-amber-300 font-bold tabular-nums shrink-0">
            {everyNMinEnabled ? formatMiniTimer(everyNMinCountdownSec) : 'OFF'}
          </span>
        </button>

        {/* 5. Scrolling Ads */}
        <button
          type="button"
          onClick={() => onOpenModal('scrolling_ads')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            channel.topOverlay?.enabled || channel.bottomOverlay?.enabled
              ? 'bg-[#0d2033] border-sky-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-sky-400/60 text-slate-100'
          }`}
          title="Configure Top & Bottom Scrolling Ticker / SWF Ads"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <ScrollText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Scrolling Ads</span>
          </div>
          <span className="text-[9px] font-mono text-sky-300 font-bold tabular-nums shrink-0">
            {topAdsCount}:{bottomAdsCount}
          </span>
        </button>

        {/* 6. Live Input */}
        <button
          type="button"
          onClick={() => onOpenModal('live_input')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            channel.liveInput?.active
              ? 'bg-[#2a0f18] border-rose-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-blue-400/60 text-slate-100'
          }`}
          title="Live Input (M3U8 Stream / USB Capture / YouTube Video & Live)"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Radio className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Live Input</span>
          </div>
          <span className="text-[9px] font-mono text-rose-300 font-bold shrink-0">
            {channel.liveInput?.active
              ? 'AIR'
              : channel.liveInput?.sourceType === 'youtube'
              ? 'YT'
              : channel.liveInput?.sourceType === 'm3u8' || channel.liveInput?.sourceType === 'stream'
              ? 'HLS'
              : 'CAM'}
          </span>
        </button>

        {/* 7. Display Output */}
        <button
          type="button"
          onClick={onLaunchDisplayOutput}
          className="px-2 py-1.5 rounded bg-[#0d1320] hover:bg-[#152036] border border-[#24314a] hover:border-sky-400/70 transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden"
          title="Launch Fullscreen 2nd Display Playout Output"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Monitor className="w-3.5 h-3.5 text-sky-300 shrink-0" />
            <span className="text-[11px] font-bold text-slate-100 truncate">Display Output</span>
          </div>
          <span className="text-[9px] font-mono text-sky-300 font-bold shrink-0">2ND</span>
        </button>

        {/* 8. Logo */}
        <button
          type="button"
          onClick={() => onOpenModal('logos_overlays')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            activeLogosCount > 0
              ? 'bg-[#1b1233] border-purple-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-purple-400/60 text-slate-100'
          }`}
          title="Channel & Sponsor Logos / Overlays (1-5)"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Logo</span>
          </div>
          <span className="text-[9px] font-mono text-purple-300 font-bold tabular-nums shrink-0">
            {activeLogosCount}/5
          </span>
        </button>

        {/* 9. L-Shape */}
        <button
          type="button"
          onClick={() => onOpenModal('lshape_ad')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            lShapeActive
              ? 'bg-[#26160a] border-amber-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-amber-400/60 text-slate-100'
          }`}
          title="L-Shape Overlay Graphics / SWF Ad"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Layout className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">L-Shape</span>
          </div>
          <span className="text-[9px] font-mono text-amber-300 font-bold tabular-nums shrink-0">
            {lShapeActive ? 'ON' : lShapeMediaCount}
          </span>
        </button>

        {/* 10. Clock */}
        <button
          type="button"
          onClick={() => onOpenModal('clock')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            clockOn
              ? 'bg-[#0c2119] border-emerald-500/60 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-emerald-400/60 text-slate-100'
          }`}
          title="On-Air Digital / Analog Clock Bug Settings"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Clock</span>
          </div>
          <span
            className={`text-[9px] font-mono font-bold shrink-0 ${
              clockOn ? 'text-emerald-300' : 'text-slate-500'
            }`}
          >
            {clockOn ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* 11. Back In Sec */}
        <button
          type="button"
          onClick={() => onOpenModal('back_in_timer')}
          className={`px-2 py-1.5 rounded border transition flex items-center justify-between gap-1 cursor-pointer whitespace-nowrap overflow-hidden ${
            backInOn
              ? 'bg-[#2a0c10] border-rose-500/70 text-white'
              : 'bg-[#0d1320] hover:bg-[#152036] border-[#24314a] hover:border-rose-400/60 text-slate-100'
          }`}
          title="BACK IN Commercial & Program Countdown Badge"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Hourglass className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-[11px] font-bold truncate">Back In Sec</span>
          </div>
          <span className="text-[9px] font-mono text-amber-300 font-bold tabular-nums shrink-0">
            [{formatMiniTimer(backInSeconds)}]
          </span>
        </button>
      </div>

      {/* Single-Line Bottom Footer Bar */}
      <footer className="bg-[#080b12] border border-[#1a2232] rounded-lg px-2.5 py-1 flex items-center justify-between gap-2 whitespace-nowrap overflow-x-auto">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <img
            src="/assets/ashoka-icon.svg"
            alt="Ashoka Cable TV Playout"
            className="w-5 h-5 rounded shrink-0"
          />
          <span className="text-[11px] font-bold text-slate-100 truncate">
            Ashoka Cable TV Playout — Creator: N. N. Kanishq Kumar • Founder: Lakshmana Nagarajan (Ashoka Entertainment)
          </span>
          <span className="text-[10px] text-slate-400 truncate hidden 2xl:inline">
            • © 2026 Ashoka Media Technology
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenModal('developer')}
            className="px-2.5 py-1 rounded bg-[#141936] hover:bg-[#1d244d] border border-[#4f46e5]/70 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
          >
            <Shield className="w-3 h-3 text-amber-300 shrink-0" />
            <span>Meet the Developer</span>
          </button>

          <button
            onClick={handleToggleSoftwareFullscreen}
            className="px-2.5 py-1 rounded bg-[#0a2238] hover:bg-[#0f3354] border border-[#0284c7]/70 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
            title="Full Screen Software Mode (F11)"
          >
            <Maximize2 className="w-3 h-3 text-sky-300 shrink-0" />
            <span>Full Screen</span>
          </button>

          <a
            href="tel:+919842736137"
            className="px-2.5 py-1 rounded bg-[#062313] hover:bg-[#09361e] border border-[#16a34a]/70 text-[#4ade80] font-mono text-[11px] font-bold flex items-center gap-1 transition whitespace-nowrap tabular-nums"
          >
            <Phone className="w-3 h-3 shrink-0" />
            <span>98427 36137</span>
          </a>

          <a
            href="tel:+919600329596"
            className="px-2.5 py-1 rounded bg-[#062313] hover:bg-[#09361e] border border-[#16a34a]/70 text-[#4ade80] font-mono text-[11px] font-bold flex items-center gap-1 transition whitespace-nowrap tabular-nums"
          >
            <Phone className="w-3 h-3 shrink-0" />
            <span>96003 29596</span>
          </a>
        </div>
      </footer>
    </div>
  );
};
