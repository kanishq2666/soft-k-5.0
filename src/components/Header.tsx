import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Maximize2,
  Minimize2,
  Square,
  Minus,
  Cpu,
  Calendar,
  Sparkles,
  Lock,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  Monitor,
  RefreshCw,
  Tv,
  ChevronDown,
  ExternalLink,
  EyeOff,
} from 'lucide-react';
import { TVChannel } from '../types/playout';
import {
  StationLicenseRecord,
  evaluateLicenseStatus,
  formatLicenseDateDisplay,
} from '../utils/licenseCrypto';
import {
  SystemDisplayInfo,
  scanSystemDisplays,
  openDisplayOutputWindow,
  requestFullscreenOnDisplay,
} from '../utils/displayManager';

interface HeaderProps {
  channel: TVChannel;
  isLicensed: boolean;
  licenseRecord?: StationLicenseRecord | null;
  onOpenLicenseModal: () => void;
  onResetSoftware?: () => void;
  fixedDisplayIndex?: number;
  onChangeFixedDisplay?: (displayIndex: number) => void;
  onLaunchDisplayOutput?: (
    displayIndex?: number,
    cleanMode?: boolean,
    fitMode?: 'contain' | 'fill'
  ) => void;
  onMinimizeSoftware?: () => void;
  onCloseSoftware?: () => void;
  isAppMinimized?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  channel,
  isLicensed,
  licenseRecord,
  onOpenLicenseModal,
  onResetSoftware,
  fixedDisplayIndex = 2,
  onChangeFixedDisplay,
  onLaunchDisplayOutput,
  onMinimizeSoftware,
  onCloseSoftware,
  isAppMinimized = false,
}) => {
  const [now, setNow] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [realCpuPercent, setRealCpuPercent] = useState<number>(12);
  const [realRamPercent, setRealRamPercent] = useState<number | null>(null);
  const [softwareVersion, setSoftwareVersion] = useState<string>('v5.0 MSO PRO');
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [resetSuccessToast, setResetSuccessToast] = useState(false);

  // Multi-Display (1 / 2 / 3 / 4 Displays) State
  const [showFixDisplayModal, setShowFixDisplayModal] = useState(false);
  const [showDisplayDropdown, setShowDisplayDropdown] = useState(false);
  const [detectedDisplayCount, setDetectedDisplayCount] = useState<number>(1);
  const [systemDisplays, setSystemDisplays] = useState<SystemDisplayInfo[]>([]);
  const [pendingDisplayIndex, setPendingDisplayIndex] = useState<number>(fixedDisplayIndex);
  const [isRefreshingDisplays, setIsRefreshingDisplays] = useState(false);
  const [refreshSuccessToast, setRefreshSuccessToast] = useState(false);
  const [fixSuccessToast, setFixSuccessToast] = useState(false);

  const displayDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPendingDisplayIndex(fixedDisplayIndex);
  }, [fixedDisplayIndex]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  // Close display dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        displayDropdownRef.current &&
        !displayDropdownRef.current.contains(e.target as Node)
      ) {
        setShowDisplayDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initial & hotplug scan for connected displays
  useEffect(() => {
    let mounted = true;
    const loadDisplays = async () => {
      const res = await scanSystemDisplays(false);
      if (!mounted) return;
      setDetectedDisplayCount(res.detectedCount);
      setSystemDisplays(res.displays);
    };
    loadDisplays();

    const onScreenChange = () => {
      loadDisplays();
    };
    window.addEventListener('resize', onScreenChange);
    return () => {
      mounted = false;
      window.removeEventListener('resize', onScreenChange);
    };
  }, []);

  const handleRefreshDisplays = async () => {
    setIsRefreshingDisplays(true);
    try {
      const res = await scanSystemDisplays(true);
      setDetectedDisplayCount(res.detectedCount);
      setSystemDisplays(res.displays);
      setRefreshSuccessToast(true);
      setTimeout(() => setRefreshSuccessToast(false), 2200);
    } finally {
      setIsRefreshingDisplays(false);
    }
  };

  // Poll real system CPU percentage & RAM telemetry from backend
  useEffect(() => {
    let active = true;
    const fetchSystemStats = async () => {
      try {
        const res = await fetch('/api/system/stats');
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        if (typeof data.cpuPercent === 'number') {
          setRealCpuPercent(Math.max(1, Math.min(100, Math.round(data.cpuPercent))));
        }
        if (typeof data.ramPercent === 'number') {
          setRealRamPercent(Math.max(1, Math.min(100, Math.round(data.ramPercent))));
        }
        if (typeof data.version === 'string' && data.version) {
          setSoftwareVersion(data.version);
        }
      } catch {}
    };

    fetchSystemStats();
    const poll = setInterval(fetchSystemStats, 2000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, []);

  const isLive =
    channel.status === 'PLAYING' &&
    (channel.playlist.length > 0 ||
      !!channel.activeProgramId ||
      !!channel.activeEveryNMinAd ||
      !!channel.liveInput?.active ||
      !!(channel as any).liveCameraActive);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const monthsShort = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];

  const dayStr = days[now.getDay()];
  const dateNum = String(now.getDate()).padStart(2, '0');
  const monthShort = monthsShort[now.getMonth()];
  const year = now.getFullYear();
  const fullDateDisplay = `${dayStr}, ${dateNum} ${monthShort} ${year}`;

  const licenseEval = evaluateLicenseStatus(licenseRecord, now.getTime());
  const effectiveLicensed = licenseEval.isConfigured
    ? licenseEval.isValidAndActive
    : isLicensed;

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleMinimizeSoftware = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (onMinimizeSoftware) {
      onMinimizeSoftware();
    }
  };

  const handleCloseClick = () => {
    setShowCloseModal(true);
  };

  const handleSendTo2ndDisplayWindow = async (
    cleanMode: boolean = false,
    fitMode: 'contain' | 'fill' = 'fill',
    overrideIdx?: number
  ) => {
    setShowDisplayDropdown(false);
    const tgtIdx = overrideIdx || fixedDisplayIndex;
    if (onLaunchDisplayOutput) {
      await onLaunchDisplayOutput(tgtIdx, cleanMode, fitMode);
    } else {
      await openDisplayOutputWindow(tgtIdx, fitMode, cleanMode);
    }
  };

  return (
    <>
      <header className="w-full bg-[#060a14] border-b border-[#1b253b] px-3 py-1 flex items-center justify-between gap-2 select-none shrink-0 whitespace-nowrap overflow-x-auto shadow-xl">
        {/* Zone 1: Ashoka Broadcast Studio Title in Clean Single Line (Top Logo Removed) */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-xs font-black text-amber-400 tracking-wider uppercase font-mono">
              ASHOKA MSO PLAYLIST
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-mono text-[9px] font-black tracking-wider uppercase">
              5.0 PRO
            </span>
          </div>

          {/* ON AIR Beacon Badge */}
          <div
            className={`px-2 py-0.5 rounded-lg border font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow ${
              isLive
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300 shadow-emerald-900/30'
                : 'bg-slate-900/80 border-slate-700 text-slate-400'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
              }`}
            />
            <span>{isLive ? 'ON AIR' : 'STANDBY'}</span>
          </div>

          {/* MSO Resolution Pill */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#0b1222] border border-[#1e2a44] text-[10px] font-mono text-cyan-300 font-bold">
            <Tv className="w-3 h-3 text-cyan-400" />
            <span>1080p • 50fps MSO</span>
          </div>
        </div>

        {/* Zone 2: Telemetry, License & 3 Window Controls in Same UI Tone */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Real System CPU & RAM telemetry */}
          <div className="hidden xl:flex items-center gap-2 px-2 py-0.5 rounded-lg bg-[#0b1222] border border-[#1e2a44] font-mono text-[10px] text-slate-300 font-semibold tabular-nums">
            <div className="flex items-center gap-1 text-slate-200">
              <Cpu className="w-3 h-3 text-sky-400" />
              <span>CPU {realCpuPercent}%</span>
            </div>
            {realRamPercent !== null && (
              <span className="text-slate-400 border-l border-[#1e2a44] pl-2">
                RAM {realRamPercent}%
              </span>
            )}
          </div>

          {/* Station License Status */}
          {effectiveLicensed && (
            <div
              onClick={onOpenLicenseModal}
              className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/80 text-emerald-300 font-mono text-[11px] font-black flex items-center gap-1.5 cursor-pointer hover:bg-emerald-900/90 transition shadow shadow-emerald-900/20"
              title="Click to view license & expiry details"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>License Active</span>
            </div>
          )}

          {/* Dedicated 2nd Display Fullscreen Output Button & Dropdown */}
          <div className="relative" ref={displayDropdownRef}>
            <div className="flex items-center rounded-lg bg-[#0b1222] border border-cyan-500/60 shadow-md shadow-cyan-950/20 overflow-hidden">
              <button
                type="button"
                onClick={() => handleSendTo2ndDisplayWindow(false, 'fill')}
                className="px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-mono text-[11px] font-black flex items-center gap-1.5 transition cursor-pointer"
                title={`Open Fullscreen Broadcast Output on Display ${fixedDisplayIndex} (Monitor 2)`}
              >
                <Monitor className="w-3.5 h-3.5 text-cyan-200" />
                <span>2nd Display</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDisplayDropdown(!showDisplayDropdown)}
                className="px-1 py-1 bg-[#0b1222] hover:bg-[#162138] text-cyan-300 border-l border-cyan-500/40 transition cursor-pointer"
                title="Display Target & Clean Feed Settings"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            {/* Display Output Dropdown Menu */}
            {showDisplayDropdown && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl bg-[#090f1d] border border-cyan-500/40 shadow-2xl p-2 font-mono text-xs text-slate-200 space-y-1">
                <div className="text-[10px] font-bold text-cyan-400 px-2 py-1 uppercase tracking-wider border-b border-[#1c273e] flex items-center justify-between">
                  <span>Display {fixedDisplayIndex} Fullscreen Out</span>
                  <span className="text-[9px] text-slate-400">Screen {fixedDisplayIndex}</span>
                </div>

                <button
                  onClick={() => handleSendTo2ndDisplayWindow(false, 'fill')}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-cyan-950/60 hover:text-cyan-300 flex items-center gap-2.5 transition"
                >
                  <Maximize2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-bold text-white text-xs">
                      Display {fixedDisplayIndex} Fullscreen (Full CG)
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Edge-to-edge Fullscreen with Logos, SWF & Overlays
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleSendTo2ndDisplayWindow(true, 'fill')}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-amber-950/60 hover:text-amber-300 flex items-center gap-2.5 transition"
                >
                  <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="font-bold text-white text-xs">
                      Clean Fullscreen Feed (No Overlays)
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Pure Fullscreen Video Playout with Zero Overlays
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowDisplayDropdown(false);
                    setShowFixDisplayModal(true);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-[11px] text-slate-300 flex items-center gap-2 border-t border-[#1c273e] mt-1 pt-1.5"
                >
                  <Monitor className="w-3.5 h-3.5 text-amber-400" />
                  <span>Configure Displays ({detectedDisplayCount} Connected)...</span>
                </button>
              </div>
            )}
          </div>

          {/* Kanishq Master Key / Station License status */}
          <button
            type="button"
            onClick={onOpenLicenseModal}
            className="px-2 py-1 rounded-lg bg-[#0b1222] hover:bg-[#162138] border border-[#1e2a44] text-slate-300 hover:text-white font-mono text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer"
            title="Click for Kanishq Login & Master Key Management"
          >
            {licenseEval.isConfigured && licenseEval.isValidAndActive ? (
              <>
                <Lock className="w-3 h-3 text-emerald-400" />
                <span className="max-w-[90px] truncate">{licenseEval.clientName}</span>
              </>
            ) : (
              <>
                <Shield className="w-3 h-3 text-amber-400" />
                <span>{effectiveLicensed ? 'Active' : 'Key'}</span>
              </>
            )}
          </button>

          {/* Reset Software Button */}
          <button
            type="button"
            onClick={() => setShowResetConfirmModal(true)}
            className="p-1.5 rounded-lg bg-[#0b1222] hover:bg-rose-950/60 border border-[#1e2a44] hover:border-rose-500/50 text-slate-400 hover:text-rose-300 transition cursor-pointer"
            title="Reset Software to Factory Default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Master Playout LED Digital Clock */}
          <div className="bg-[#0b1222] border border-[#1e2a44] rounded-lg px-2 py-0.5 text-right leading-none shrink-0 shadow-inner">
            <div className="text-xs font-mono font-black text-amber-300 tracking-wider tabular-nums">
              {hh}:{mm}:{ss}
            </div>
            <div className="text-[8px] font-mono text-slate-400 mt-0.5 tabular-nums">
              {dayStr}, {dateNum} {monthShort}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3 SOFTWARE WINDOW CONTROL OPTIONS IN SAME UI TONE (Minimize, Maximize, Close) */}
          {/* ========================================================================= */}
          <div className="flex items-center rounded-lg bg-[#0b1222] border border-[#1e2a44] overflow-hidden divide-x divide-[#1e2a44] shadow-md ml-0.5">
            {/* 1. Minimize Button */}
            <button
              type="button"
              onClick={handleMinimizeSoftware}
              className="px-2 py-1.5 hover:bg-[#162138] text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer group"
              title={isAppMinimized ? 'Restore Playout Studio' : 'Minimize Software (Compact Broadcast Dock)'}
            >
              <Minus className="w-3.5 h-3.5 stroke-[2.5] group-hover:text-amber-400 transition-colors" />
            </button>

            {/* 2. Maximize / Restore Button */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="px-2 py-1.5 hover:bg-[#162138] text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer group"
              title={isFullscreen ? 'Restore Down (Exit Full Screen)' : 'Maximize Software (Full Screen)'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5 stroke-[2] group-hover:text-amber-400 transition-colors" />
              ) : (
                <Square className="w-3.5 h-3.5 stroke-[2] group-hover:text-amber-400 transition-colors" />
              )}
            </button>

            {/* 3. Close Button */}
            <button
              type="button"
              onClick={handleCloseClick}
              className="px-2 py-1.5 hover:bg-rose-600 text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer group"
              title="Close Playout Software"
            >
              <X className="w-3.5 h-3.5 stroke-[2.5] group-hover:text-white transition-colors" />
            </button>
          </div>
        </div>
      </header>

      {/* Reset Confirmation Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none">
          <div className="w-full max-w-md rounded-2xl bg-[#090f1d] border border-rose-500/40 shadow-2xl p-5 text-white font-mono space-y-4">
            <div className="flex items-center gap-3 border-b border-[#1c273e] pb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-500/50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-black text-rose-400 uppercase">
                  Reset Software Configuration
                </h3>
                <p className="text-[11px] text-slate-400">
                  Restore factory playout channel state
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to reset the playout studio? This will reload the default
              single-channel layout while keeping your uploaded media vault intact.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1c273e]">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirmModal(false);
                  if (onResetSoftware) onResetSoftware();
                  setResetSuccessToast(true);
                  setTimeout(() => setResetSuccessToast(false), 2500);
                }}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black shadow transition"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Software Close / Exit Modal (Same Broadcast UI Tone) */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none">
          <div className="w-full max-w-md rounded-2xl bg-[#090f1d] border border-rose-500/40 shadow-2xl p-5 text-white font-mono space-y-4">
            <div className="flex items-center justify-between border-b border-[#1c273e] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-500/50 flex items-center justify-center shrink-0">
                  <X className="w-5 h-5 text-rose-400 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-rose-400 uppercase tracking-wider">
                    Exit Playout Studio
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Ashoka Cable TV Broadcast System 5.0 PRO
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCloseModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Playout channel is currently active. Would you like to minimize to the background dock, reset the playlist state, or exit the software?
            </p>

            <div className="grid grid-cols-1 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowCloseModal(false);
                  handleMinimizeSoftware();
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0b1222] hover:bg-[#162138] border border-[#1e2a44] hover:border-cyan-500 text-slate-200 text-xs font-bold flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Minus className="w-4 h-4 text-cyan-400" />
                  <span>Minimize to Background Dock</span>
                </div>
                <span className="text-[10px] text-slate-400">Keep on air</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCloseModal(false);
                  if (onResetSoftware) onResetSoftware();
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0b1222] hover:bg-amber-950/60 border border-[#1e2a44] hover:border-amber-500 text-amber-200 text-xs font-bold flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-4 h-4 text-amber-400" />
                  <span>Stop Playout &amp; Reset to Factory</span>
                </div>
                <span className="text-[10px] text-amber-400/80">Reset state</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCloseModal(false);
                  if (onCloseSoftware) {
                    onCloseSoftware();
                  } else {
                    try { window.close(); } catch {}
                    window.location.reload();
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 border border-rose-500/50 hover:border-rose-400 text-rose-300 hover:text-white text-xs font-black flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <X className="w-4 h-4 text-rose-400" />
                  <span>Exit Software Playout</span>
                </div>
                <span className="text-[10px] text-rose-300 font-bold">Close</span>
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#1c273e]">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Display Configuration Modal */}
      {showFixDisplayModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFixDisplayModal(false);
          }}
        >
          <div className="w-full max-w-xl rounded-2xl bg-[#090f1d] border border-cyan-500/40 shadow-2xl p-5 text-white font-mono space-y-4">
            <div className="flex items-center justify-between border-b border-[#1c273e] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center shrink-0">
                  <Monitor className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-cyan-400 uppercase">
                    Multi-Display Output Router
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Route clean on-air playout to any connected monitor (Screen 1, 2, 3, 4)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowFixDisplayModal(false)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Display list */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {systemDisplays.map((disp) => {
                const isSelected = disp.index === pendingDisplayIndex;
                return (
                  <div
                    key={disp.id}
                    onClick={() => {
                      setPendingDisplayIndex(disp.index);
                      if (onChangeFixedDisplay) onChangeFixedDisplay(disp.index);
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                      isSelected
                        ? 'bg-cyan-950/60 border-cyan-400 text-white shadow'
                        : 'bg-[#0d1424] border-[#1e2a44] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${
                          isSelected
                            ? 'bg-cyan-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {disp.index}
                      </div>
                      <div>
                        <div className="font-black text-xs text-white">
                          {disp.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {disp.resolution} • {disp.isPrimary ? 'Primary Operator Monitor' : 'Secondary Monitor Output'}
                        </div>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-400/40">
                        Selected
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-[#1c273e]">
              <button
                type="button"
                onClick={handleRefreshDisplays}
                disabled={isRefreshingDisplays}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingDisplays ? 'animate-spin' : ''}`} />
                <span>{refreshSuccessToast ? '✓ Refreshed!' : 'Scan Monitors'}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setShowFixDisplayModal(false);
                    await handleSendTo2ndDisplayWindow(false, 'fill', pendingDisplayIndex);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black shadow flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Screen {pendingDisplayIndex} Window</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
