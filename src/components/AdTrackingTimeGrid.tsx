import React, { useState, useRef, useEffect } from 'react';
import {
  CheckSquare,
  Square,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CustomAdTrack } from '../types/playout';
import {
  getAllTrackDefinitions,
  getAllTracksHHMMs,
  getTrack48HHMMs,
  getTrackTickedCount,
  isTrackFullyTicked,
  toggleEntireTrackSlots,
  toggleSingleSlotHHMM,
  build48SlotsForMinutePair,
  formatHHMMTo12HrWithSec,
  getNextTickedSlotCountdown,
  getLocalTodayYMD,
  getNextMonthSameDateYMD,
  getDateRangeStatus,
  formatAdDateSummary,
  normalizeTrack6Mode,
  Track6ModeInput,
} from '../utils/adTrackingTracks';

interface AdTrackingTimeGridProps {
  title?: string;
  tickedSlots: string[];
  selectedTracks?: number[];
  track6Mode?: Track6ModeInput;
  track6Preset?: 'text' | 'video';
  customTracks?: CustomAdTrack[];
  dateMode?: 'every_day' | 'specific_date' | 'date_range';
  scheduledDate?: string;
  startDate?: string;
  endDate?: string;
  onChange?: (next: {
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode?: '25_55' | '12_25';
    track6Preset?: 'text' | 'video';
    customTracks?: CustomAdTrack[];
    dateMode?: 'every_day' | 'specific_date' | 'date_range';
    scheduledDate?: string;
    startDate?: string;
    endDate?: string;
  }) => void;
  onUpdate?: (next: {
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode?: '25_55' | '12_25';
    track6Preset?: 'text' | 'video';
    customTracks?: CustomAdTrack[];
    dateMode?: 'every_day' | 'specific_date' | 'date_range';
    scheduledDate?: string;
    startDate?: string;
    endDate?: string;
  }) => void;
  onSave?: (saved: {
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode: '25_55' | '12_25';
    track6Preset: 'text' | 'video';
    customTracks: CustomAdTrack[];
    dateMode: 'every_day' | 'specific_date' | 'date_range';
    scheduledDate: string;
    startDate: string;
    endDate: string;
  }) => void;
  onApplyToAll?: (saved: {
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode: '25_55' | '12_25';
    track6Preset: 'text' | 'video';
    customTracks: CustomAdTrack[];
    dateMode: 'every_day' | 'specific_date' | 'date_range';
    scheduledDate: string;
    startDate: string;
    endDate: string;
  }) => void;
  applyToAllLabel?: string;
  saveButtonLabel?: string;
  compact?: boolean;
  defaultGridExpanded?: boolean;
  extraRightControls?: React.ReactNode;
}

export const AdTrackingTimeGrid: React.FC<AdTrackingTimeGridProps> = ({
  title = 'FULL DAY AD TRACKING (TRACK 1–6 • 48 SLOTS/DAY PER TRACK)',
  tickedSlots: propTickedSlots,
  track6Mode: rawTrack6Mode,
  track6Preset,
  customTracks: propCustomTracks = [],
  dateMode: propDateMode = 'every_day',
  scheduledDate: propScheduledDate,
  startDate: propStartDate,
  endDate: propEndDate,
  onChange: rawOnChange,
  onUpdate,
  onSave,
  onApplyToAll,
  applyToAllLabel,
  saveButtonLabel = 'SAVE DATE & TIME',
  compact = false,
  defaultGridExpanded = true,
  extraRightControls,
}) => {
  const resolvedPropMode = normalizeTrack6Mode(rawTrack6Mode || track6Preset || '25_55');
  const todayYMD = getLocalTodayYMD();
  const defaultNextMonthYMD = getNextMonthSameDateYMD();

  // Instant optimistic local state so clicking any checkbox or track button responds in 0ms
  const [localTickedSlots, setLocalTickedSlots] = useState<string[]>(() =>
    Array.isArray(propTickedSlots) ? propTickedSlots : []
  );
  const [localTrack6Mode, setLocalTrack6Mode] = useState<'25_55' | '12_25'>(resolvedPropMode);
  const [localCustomTracks, setLocalCustomTracks] = useState<CustomAdTrack[]>(
    propCustomTracks || []
  );
  const [localDateMode, setLocalDateMode] = useState<'every_day' | 'specific_date' | 'date_range'>(
    propDateMode || 'every_day'
  );
  const [localScheduledDate, setLocalScheduledDate] = useState<string>(
    propScheduledDate || todayYMD
  );
  const [localStartDate, setLocalStartDate] = useState<string>(propStartDate || todayYMD);
  const [localEndDate, setLocalEndDate] = useState<string>(propEndDate || defaultNextMonthYMD);
  const [isGridExpanded, setIsGridExpanded] = useState<boolean>(defaultGridExpanded);
  const [savedBanner, setSavedBanner] = useState<boolean>(false);
  const [appliedAllBanner, setAppliedAllBanner] = useState<boolean>(false);
  const [showAllSelectedTimes, setShowAllSelectedTimes] = useState<boolean>(false);
  const [, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep local state in sync when parent props change externally
  const propSlotsKey = Array.isArray(propTickedSlots) ? propTickedSlots.join(',') : '';
  useEffect(() => {
    if (Array.isArray(propTickedSlots)) {
      setLocalTickedSlots(propTickedSlots);
    }
  }, [propSlotsKey]);

  useEffect(() => {
    setLocalTrack6Mode(resolvedPropMode);
  }, [resolvedPropMode]);

  const customTracksKey = JSON.stringify(propCustomTracks || []);
  useEffect(() => {
    setLocalCustomTracks(propCustomTracks || []);
  }, [customTracksKey]);

  useEffect(() => {
    if (propDateMode) setLocalDateMode(propDateMode);
  }, [propDateMode]);
  useEffect(() => {
    if (propScheduledDate) setLocalScheduledDate(propScheduledDate);
  }, [propScheduledDate]);
  useEffect(() => {
    if (propStartDate) setLocalStartDate(propStartDate);
  }, [propStartDate]);
  useEffect(() => {
    if (propEndDate) setLocalEndDate(propEndDate);
  }, [propEndDate]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [focusedTrackFilter, setFocusedTrackFilter] = useState<'all' | number>('all');
  const [showAddTrackForm, setShowAddTrackForm] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [newTrackMinA, setNewTrackMinA] = useState<number>(12);
  const [newTrackMinB, setNewTrackMinB] = useState<number>(25);
  const [customSingleTime, setCustomSingleTime] = useState<string>('12:15');

  const emitChange = (next: {
    tickedSlots: string[];
    selectedTracks: number[];
    track6Mode?: '25_55' | '12_25';
    customTracks?: CustomAdTrack[];
    dateMode?: 'every_day' | 'specific_date' | 'date_range';
    scheduledDate?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const modeToUse = next.track6Mode || localTrack6Mode;
    const customToUse = next.customTracks !== undefined ? next.customTracks : localCustomTracks;
    const dModeToUse = next.dateMode !== undefined ? next.dateMode : localDateMode;
    const schedDateToUse =
      next.scheduledDate !== undefined ? next.scheduledDate : localScheduledDate;
    const sDateToUse = next.startDate !== undefined ? next.startDate : localStartDate;
    const eDateToUse = next.endDate !== undefined ? next.endDate : localEndDate;

    setLocalTickedSlots(next.tickedSlots);
    setLocalTrack6Mode(modeToUse);
    setLocalCustomTracks(customToUse);
    setLocalDateMode(dModeToUse);
    setLocalScheduledDate(schedDateToUse);
    setLocalStartDate(sDateToUse);
    setLocalEndDate(eDateToUse);

    const preset: 'text' | 'video' = modeToUse === '12_25' ? 'text' : 'video';
    const payload = {
      tickedSlots: next.tickedSlots,
      selectedTracks: next.selectedTracks,
      track6Mode: modeToUse,
      track6Preset: preset,
      customTracks: customToUse,
      dateMode: dModeToUse,
      scheduledDate: schedDateToUse,
      startDate: sDateToUse,
      endDate: eDateToUse,
    };
    if (rawOnChange) rawOnChange(payload);
    if (onUpdate) onUpdate(payload);
  };

  const handleExplicitSave = () => {
    const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
    const tickedSetNow = new Set(localTickedSlots);
    const computedSelectedTracks = defs
      .filter((t) => t.slots.some((s) => tickedSetNow.has(s.hhmm)))
      .map((t) => t.trackNumber);
    const preset: 'text' | 'video' = localTrack6Mode === '12_25' ? 'text' : 'video';

    const payload = {
      tickedSlots: localTickedSlots,
      selectedTracks: computedSelectedTracks.length > 0 ? computedSelectedTracks : [1],
      track6Mode: localTrack6Mode,
      track6Preset: preset,
      customTracks: localCustomTracks,
      dateMode: localDateMode,
      scheduledDate: localScheduledDate,
      startDate: localStartDate,
      endDate: localEndDate,
    };
    if (rawOnChange) rawOnChange(payload);
    if (onUpdate) onUpdate(payload);
    if (onSave) onSave(payload);

    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2200);
  };

  const handleExplicitApplyToAll = () => {
    if (!onApplyToAll) return;
    const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
    const tickedSetNow = new Set(localTickedSlots);
    const computedSelectedTracks = defs
      .filter((t) => t.slots.some((s) => tickedSetNow.has(s.hhmm)))
      .map((t) => t.trackNumber);
    const preset: 'text' | 'video' = localTrack6Mode === '12_25' ? 'text' : 'video';

    const payload = {
      tickedSlots: localTickedSlots,
      selectedTracks: computedSelectedTracks.length > 0 ? computedSelectedTracks : [1],
      track6Mode: localTrack6Mode,
      track6Preset: preset,
      customTracks: localCustomTracks,
      dateMode: localDateMode,
      scheduledDate: localScheduledDate,
      startDate: localStartDate,
      endDate: localEndDate,
    };
    onApplyToAll(payload);
    setAppliedAllBanner(true);
    setTimeout(() => setAppliedAllBanner(false), 2200);
  };

  const trackDefs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
  const tickedSet = new Set(localTickedSlots || []);
  const allPossibleSlots = getAllTracksHHMMs(localTrack6Mode, localCustomTracks);
  const isAll6Ticked =
    allPossibleSlots.length > 0 && allPossibleSlots.every((s) => tickedSet.has(s));

  const nextCountdown = getNextTickedSlotCountdown(localTickedSlots);

  const handleScrollBy = (deltaPx: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: deltaPx, behavior: 'smooth' });
    }
  };

  const handleJumpToHour = (hour24: number) => {
    if (!scrollContainerRef.current) return;
    const colIndex = hour24 * 2; // 2 columns per hour (0..47)
    const maxScroll =
      scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth;
    const targetScroll = Math.min(
      maxScroll,
      Math.max(0, (colIndex / 48) * scrollContainerRef.current.scrollWidth)
    );
    scrollContainerRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' });
  };

  const handleToggleTrack = (trackNum: number) => {
    const res = toggleEntireTrackSlots(
      localTickedSlots,
      trackNum,
      localTrack6Mode,
      localCustomTracks
    );
    emitChange({
      tickedSlots: res.tickedSlots,
      selectedTracks: res.selectedTracks,
      track6Mode: localTrack6Mode,
      customTracks: localCustomTracks,
    });
  };

  const handleSelectOnlyTrack = (trackNum: number) => {
    const slots = getTrack48HHMMs(trackNum, localTrack6Mode, localCustomTracks);
    emitChange({
      tickedSlots: slots,
      selectedTracks: [trackNum],
      track6Mode: localTrack6Mode,
      customTracks: localCustomTracks,
    });
  };

  const handleToggleAll6Tracks = () => {
    if (isAll6Ticked) {
      emitChange({
        tickedSlots: [],
        selectedTracks: [],
        track6Mode: localTrack6Mode,
        customTracks: localCustomTracks,
      });
    } else {
      emitChange({
        tickedSlots: allPossibleSlots,
        selectedTracks: trackDefs.map((t) => t.trackNumber),
        track6Mode: localTrack6Mode,
        customTracks: localCustomTracks,
      });
    }
  };

  const handleToggleSingleTime = (hhmm: string) => {
    const res = toggleSingleSlotHHMM(
      localTickedSlots,
      hhmm,
      localTrack6Mode,
      localCustomTracks
    );
    emitChange({
      tickedSlots: res.tickedSlots,
      selectedTracks: res.selectedTracks,
      track6Mode: localTrack6Mode,
      customTracks: localCustomTracks,
    });
  };

  const handleSwitchTrack6Mode = (nextMode: '25_55' | '12_25') => {
    const oldTrack6Slots = new Set(getTrack48HHMMs(6, localTrack6Mode, localCustomTracks));
    const wasTrack6Active = Array.from(oldTrack6Slots).some((s) => tickedSet.has(s));
    const remaining = (localTickedSlots || []).filter((s) => !oldTrack6Slots.has(s));
    const nextTrack6Slots = wasTrack6Active
      ? getTrack48HHMMs(6, nextMode, localCustomTracks)
      : [];
    const combined = Array.from(new Set([...remaining, ...nextTrack6Slots]));
    const nextDefs = getAllTrackDefinitions(nextMode, localCustomTracks);
    const nextSelected = nextDefs
      .filter((t) => t.slots.some((s) => combined.includes(s.hhmm)))
      .map((t) => t.trackNumber);

    emitChange({
      tickedSlots: combined,
      selectedTracks: nextSelected,
      track6Mode: nextMode,
      customTracks: localCustomTracks,
    });
  };

  const handleAddCustomTrack = () => {
    const nextTrackNum =
      trackDefs.reduce((maxN, t) => Math.max(maxN, t.trackNumber), 6) + 1;
    const cleanMinA = Math.max(0, Math.min(59, Number(newTrackMinA) || 0));
    const cleanMinB = Math.max(0, Math.min(59, Number(newTrackMinB) || 30));
    const builtSlots = build48SlotsForMinutePair(nextTrackNum, cleanMinA, cleanMinB).map(
      (s) => s.hhmm
    );
    const customLabel =
      newTrackName.trim() ||
      `Track ${nextTrackNum} (:${String(cleanMinA).padStart(2, '0')} & :${String(
        cleanMinB
      ).padStart(2, '0')})`;

    const newCustom: CustomAdTrack = {
      id: `track_${nextTrackNum}_${Date.now()}`,
      trackNumber: nextTrackNum,
      name: customLabel,
      minA: cleanMinA,
      minB: cleanMinB,
      slots: builtSlots,
    };

    const nextCustomList = [...localCustomTracks, newCustom];
    const nextTicked = Array.from(new Set([...(localTickedSlots || []), ...builtSlots]));
    const nextDefs = getAllTrackDefinitions(localTrack6Mode, nextCustomList);
    const nextSelected = nextDefs
      .filter((t) => t.slots.some((s) => nextTicked.includes(s.hhmm)))
      .map((t) => t.trackNumber);

    emitChange({
      tickedSlots: nextTicked,
      selectedTracks: nextSelected,
      track6Mode: localTrack6Mode,
      customTracks: nextCustomList,
    });
    setNewTrackName('');
    setShowAddTrackForm(false);
  };

  const handleAddSingleCustomTime = () => {
    if (!customSingleTime) return;
    const parts = customSingleTime.split(':');
    if (parts.length < 2) return;
    const hhmm = `${String(parseInt(parts[0], 10) || 0).padStart(2, '0')}:${String(
      parseInt(parts[1], 10) || 0
    ).padStart(2, '0')}`;
    if (!tickedSet.has(hhmm)) {
      handleToggleSingleTime(hhmm);
    }
  };

  const handleDeleteCustomTrack = (trackNum: number) => {
    const target = localCustomTracks.find((c) => c.trackNumber === trackNum);
    if (!target) return;
    const removeSet = new Set(target.slots || []);
    const nextCustomList = localCustomTracks.filter((c) => c.trackNumber !== trackNum);
    const nextTicked = (localTickedSlots || []).filter((s) => !removeSet.has(s));
    const nextDefs = getAllTrackDefinitions(localTrack6Mode, nextCustomList);
    const nextSelected = nextDefs
      .filter((t) => t.slots.some((s) => nextTicked.includes(s.hhmm)))
      .map((t) => t.trackNumber);

    if (focusedTrackFilter === trackNum) {
      setFocusedTrackFilter('all');
    }
    emitChange({
      tickedSlots: nextTicked,
      selectedTracks: nextSelected,
      track6Mode: localTrack6Mode,
      customTracks: nextCustomList,
    });
  };

  const visibleTracks =
    focusedTrackFilter === 'all'
      ? trackDefs
      : trackDefs.filter((t) => t.trackNumber === focusedTrackFilter);

  const sortedTickedSlots = [...(localTickedSlots || [])].sort();
  const displayedTickedSlots = showAllSelectedTimes
    ? sortedTickedSlots
    : sortedTickedSlots.slice(0, 12);
  const waitHours = Math.floor(nextCountdown.secondsUntilNext / 3600);
  const waitMins = Math.floor((nextCountdown.secondsUntilNext % 3600) / 60);
  const waitSecs = nextCountdown.secondsUntilNext % 60;
  const formattedWaitStr =
    waitHours > 0
      ? `${waitHours}h ${waitMins}m ${waitSecs}s`
      : `${waitMins}m ${waitSecs}s`;

  return (
    <div className="rounded-lg bg-[#060911] border border-[#1e293b] p-2.5 space-y-2 text-xs font-mono">
      {/* Header Row: Title + Next Scheduled Time + SAVE Button + Extra Right Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-black text-amber-400 flex items-center gap-1.5 uppercase">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{title}</span>
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold">
            {localTickedSlots.length} Slots Ticked
            {nextCountdown.nextSlotHHMM
              ? ` • ⏳ Full Time Waiting: ${formattedWaitStr} (Next Play @ ${nextCountdown.nextSlotLabel})`
              : ' • No Time Selected'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {extraRightControls}

          {compact && (
            <button
              type="button"
              onClick={() => setIsGridExpanded((prev) => !prev)}
              className="px-2 py-1 rounded bg-[#111a2e] hover:bg-[#1a2947] border border-sky-500/50 text-sky-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
            >
              {isGridExpanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>Hide 48 Time Box</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>⏰ Open 48 Time Box</span>
                </>
              )}
            </button>
          )}

          {/* Prominent SAVE DATE & TIME Button */}
          <button
            type="button"
            onClick={handleExplicitSave}
            className={`px-3 py-1 rounded text-[10px] font-black flex items-center gap-1.5 shadow transition cursor-pointer border ${
              savedBanner
                ? 'bg-emerald-500 text-black border-emerald-200'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400'
            }`}
            title="Save Fixed Date & Ticked Time Slots"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savedBanner ? '✓ SAVED DATE & TIME!' : saveButtonLabel}</span>
          </button>

          {onApplyToAll && (
            <button
              type="button"
              onClick={handleExplicitApplyToAll}
              className={`px-2.5 py-1 rounded text-[10px] font-black flex items-center gap-1 shadow transition cursor-pointer border ${
                appliedAllBanner
                  ? 'bg-amber-400 text-black border-amber-200'
                  : 'bg-amber-500 hover:bg-amber-400 text-black border-amber-300'
              }`}
              title="Apply this Date & Time to all ads in playlist"
            >
              <Save className="w-3 h-3" />
              <span>{appliedAllBanner ? '✓ APPLIED TO ALL!' : applyToAllLabel || 'Apply Date & Time to All Ads'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 📅 FIX / SELECT PLAYOUT DATE & EXACT TIME BAR */}
      <div className="rounded bg-[#090e19] border border-amber-500/40 p-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-black text-amber-300 uppercase">📅 FIX PLAYOUT DATE:</span>
          {(
            [
              ['every_day', 'Every Day (All Dates)'],
              ['specific_date', 'Specific Date'],
              ['date_range', 'Date Range (From → To)'],
            ] as const
          ).map(([modeKey, modeLabel]) => (
            <button
              key={modeKey}
              type="button"
              onClick={() => {
                const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                const tSet = new Set(localTickedSlots);
                const selTracks = defs
                  .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                  .map((t) => t.trackNumber);
                emitChange({
                  tickedSlots: localTickedSlots,
                  selectedTracks: selTracks.length > 0 ? selTracks : [1],
                  dateMode: modeKey,
                  scheduledDate: localScheduledDate || todayYMD,
                  startDate: localStartDate || todayYMD,
                  endDate: localEndDate || todayYMD,
                });
              }}
              className={`px-2 py-0.5 rounded font-bold border transition cursor-pointer ${
                localDateMode === modeKey
                  ? 'bg-amber-500 text-black border-amber-300 shadow'
                  : 'bg-[#05080f] text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              {modeLabel}
            </button>
          ))}

          {localDateMode === 'specific_date' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={localScheduledDate || todayYMD}
                onChange={(e) => {
                  const nextD = e.target.value || todayYMD;
                  const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                  const tSet = new Set(localTickedSlots);
                  const selTracks = defs
                    .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                    .map((t) => t.trackNumber);
                  emitChange({
                    tickedSlots: localTickedSlots,
                    selectedTracks: selTracks.length > 0 ? selTracks : [1],
                    dateMode: 'specific_date',
                    scheduledDate: nextD,
                  });
                }}
                className="bg-black border border-amber-500/60 rounded px-2 py-0.5 text-amber-300 font-bold text-[10px]"
              />
              <button
                type="button"
                onClick={() => {
                  const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                  const tSet = new Set(localTickedSlots);
                  const selTracks = defs
                    .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                    .map((t) => t.trackNumber);
                  emitChange({
                    tickedSlots: localTickedSlots,
                    selectedTracks: selTracks.length > 0 ? selTracks : [1],
                    dateMode: 'specific_date',
                    scheduledDate: todayYMD,
                  });
                }}
                className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 font-bold cursor-pointer"
              >
                Today ({todayYMD})
              </button>
            </div>
          )}

          {localDateMode === 'date_range' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-slate-400">From:</span>
                <input
                  type="date"
                  value={localStartDate || todayYMD}
                  onChange={(e) => {
                    const nextStart = e.target.value || todayYMD;
                    const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                    const tSet = new Set(localTickedSlots);
                    const selTracks = defs
                      .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                      .map((t) => t.trackNumber);
                    emitChange({
                      tickedSlots: localTickedSlots,
                      selectedTracks: selTracks.length > 0 ? selTracks : [1],
                      dateMode: 'date_range',
                      startDate: nextStart,
                      endDate: localEndDate || defaultNextMonthYMD,
                    });
                  }}
                  className="bg-black border border-amber-500/60 rounded px-2 py-0.5 text-amber-300 font-bold text-[10px]"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-400">To:</span>
                <input
                  type="date"
                  value={localEndDate || defaultNextMonthYMD}
                  onChange={(e) => {
                    const nextEnd = e.target.value || defaultNextMonthYMD;
                    const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                    const tSet = new Set(localTickedSlots);
                    const selTracks = defs
                      .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                      .map((t) => t.trackNumber);
                    emitChange({
                      tickedSlots: localTickedSlots,
                      selectedTracks: selTracks.length > 0 ? selTracks : [1],
                      dateMode: 'date_range',
                      startDate: localStartDate || todayYMD,
                      endDate: nextEnd,
                    });
                  }}
                  className="bg-black border border-amber-500/60 rounded px-2 py-0.5 text-amber-300 font-bold text-[10px]"
                />
              </div>

              {/* Quick Helper Buttons for Month selection */}
              <div className="flex items-center gap-1">
                {[
                  { label: '+1 Month', months: 1 },
                  { label: '+3 Months', months: 3 },
                  { label: '+6 Months', months: 6 },
                  { label: '+1 Year', months: 12 },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => {
                      const baseDate = new Date(localStartDate || todayYMD);
                      const targetEnd = getNextMonthSameDateYMD(baseDate, btn.months);
                      const defs = getAllTrackDefinitions(localTrack6Mode, localCustomTracks);
                      const tSet = new Set(localTickedSlots);
                      const selTracks = defs
                        .filter((t) => t.slots.some((s) => tSet.has(s.hhmm)))
                        .map((t) => t.trackNumber);
                      emitChange({
                        tickedSlots: localTickedSlots,
                        selectedTracks: selTracks.length > 0 ? selTracks : [1],
                        dateMode: 'date_range',
                        startDate: localStartDate || todayYMD,
                        endDate: targetEnd,
                      });
                    }}
                    className="px-1.5 py-0.5 rounded bg-[#111a2e] hover:bg-[#1c2a4a] border border-amber-500/40 text-amber-200 text-[9px] font-bold cursor-pointer"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Live Active/Pending/Expired badge */}
              {(() => {
                const rangeStatus = getDateRangeStatus(localStartDate, localEndDate);
                return (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      rangeStatus.status === 'active'
                        ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
                        : rangeStatus.status === 'pending'
                        ? 'bg-amber-950/90 border-amber-500/60 text-amber-300'
                        : 'bg-rose-950/90 border-rose-500/60 text-rose-300'
                    }`}
                  >
                    {rangeStatus.label}
                  </span>
                );
              })()}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/50 text-purple-200 font-bold">
            Active Date: {formatAdDateSummary({
              dateMode: localDateMode,
              scheduledDate: localScheduledDate,
              startDate: localStartDate,
              endDate: localEndDate,
            })}
          </span>
        </div>
      </div>

      {/* Track 1..6 + All 6 Tracks + Add Track Selector Buttons */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {trackDefs.map((t) => {
          const tickedCount = getTrackTickedCount(
            localTickedSlots,
            t.trackNumber,
            localTrack6Mode,
            localCustomTracks
          );
          const fullyTicked = isTrackFullyTicked(
            localTickedSlots,
            t.trackNumber,
            localTrack6Mode,
            localCustomTracks
          );
          const partiallyTicked = tickedCount > 0 && !fullyTicked;
          const minAStr = `:${String(t.minA).padStart(2, '0')}`;
          const minBStr = `:${String(t.minB).padStart(2, '0')}`;

          return (
            <div
              key={t.id}
              className={`flex items-center rounded overflow-hidden border transition ${
                fullyTicked
                  ? 'bg-amber-500 border-amber-300 text-black shadow'
                  : partiallyTicked
                  ? 'bg-amber-950/80 border-amber-500/70 text-amber-200'
                  : 'bg-[#0b101b] border-[#243047] text-slate-300 hover:border-slate-500'
              }`}
            >
              {/* Tick/Untick Entire Track Checkbox Button */}
              <button
                type="button"
                onClick={() => handleToggleTrack(t.trackNumber)}
                className="px-2 py-1 flex items-center gap-1 text-[10px] font-black cursor-pointer"
                title={`Click to Tick / Untick all 48 slots in ${t.name}`}
              >
                {fullyTicked ? (
                  <CheckSquare className="w-3 h-3 shrink-0" />
                ) : (
                  <Square className="w-3 h-3 shrink-0" />
                )}
                <span>
                  {t.shortName} ({minAStr}/{minBStr})
                </span>
                <span
                  className={`px-1 rounded text-[9px] ${
                    fullyTicked
                      ? 'bg-black/20 text-black'
                      : 'bg-black/50 text-amber-300'
                  }`}
                >
                  {tickedCount}/48
                </span>
              </button>

              {/* "Only" button to select exclusively this track */}
              <button
                type="button"
                onClick={() => handleSelectOnlyTrack(t.trackNumber)}
                className={`px-1.5 py-1 text-[9px] font-bold border-l cursor-pointer ${
                  fullyTicked
                    ? 'border-black/20 bg-amber-600/40 text-black hover:bg-amber-600/70'
                    : 'border-[#243047] bg-[#111827] text-sky-300 hover:text-white'
                }`}
                title={`Select ONLY ${t.shortName} (48 slots/day)`}
              >
                Only
              </button>

              {t.isCustom && (
                <button
                  type="button"
                  onClick={() => handleDeleteCustomTrack(t.trackNumber)}
                  className="px-1.5 py-1 text-rose-400 hover:text-rose-200 border-l border-[#243047] cursor-pointer"
                  title={`Delete Custom ${t.shortName}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* All 6 Tracks Button */}
        <button
          type="button"
          onClick={handleToggleAll6Tracks}
          className={`px-2.5 py-1 rounded text-[10px] font-black border flex items-center gap-1 transition cursor-pointer ${
            isAll6Ticked
              ? 'bg-emerald-500 border-emerald-300 text-black shadow'
              : 'bg-emerald-950/60 hover:bg-emerald-900/70 border-emerald-500/50 text-emerald-300'
          }`}
          title="Tick or Untick ALL 6 Tracks (All 288 slots across 24 hours)"
        >
          {isAll6Ticked ? (
            <CheckSquare className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
          <span>All 6 Tracks ({allPossibleSlots.length})</span>
        </button>

        {/* Clear All Button */}
        {localTickedSlots.length > 0 && (
          <button
            type="button"
            onClick={() =>
              emitChange({
                tickedSlots: [],
                selectedTracks: [],
                track6Mode: localTrack6Mode,
                customTracks: localCustomTracks,
              })
            }
            className="px-2 py-1 rounded bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-200 text-[10px] font-bold cursor-pointer"
          >
            Untick All
          </button>
        )}

        {/* + Add Track Button */}
        <button
          type="button"
          onClick={() => setShowAddTrackForm(!showAddTrackForm)}
          className={`px-2.5 py-1 rounded text-[10px] font-black border flex items-center gap-1 transition cursor-pointer ${
            showAddTrackForm
              ? 'bg-sky-500 text-black border-sky-300'
              : 'bg-[#132038] hover:bg-[#1c2f52] border-sky-500/50 text-sky-300'
          }`}
        >
          <Plus className="w-3 h-3" />
          <span>+ Add Track</span>
        </button>
      </div>

      {/* Selected / Ticked Times Shown Out + Full Time Waiting Strip */}
      <div className="p-2 rounded bg-[#03060c] border border-[#1a263d] space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-black text-amber-300 uppercase">
              ⏰ SELECTED PLAYOUT TIMES ({sortedTickedSlots.length} SLOTS):
            </span>
            {nextCountdown.nextSlotHHMM ? (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 font-black">
                ⏳ FULL WAITING TIME: {formattedWaitStr} ➔ NEXT PLAY AT {nextCountdown.nextSlotLabel}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-500/50 text-rose-300 font-bold">
                No time slots ticked — click Track 1–6 or tick times below
              </span>
            )}
          </div>
          {sortedTickedSlots.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAllSelectedTimes((prev) => !prev)}
              className="px-2 py-0.5 rounded bg-[#111c30] hover:bg-[#1b2c4b] border border-sky-500/40 text-sky-300 text-[10px] font-bold cursor-pointer"
            >
              {showAllSelectedTimes
                ? '▲ Show Compact Times'
                : `▼ Show All ${sortedTickedSlots.length} Selected Times`}
            </button>
          )}
        </div>
        {sortedTickedSlots.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 max-h-28 overflow-y-auto pt-0.5">
            {displayedTickedSlots.map((hhmm) => {
              const isNextUp = hhmm === nextCountdown.nextSlotHHMM;
              return (
                <button
                  key={`sel-pill-${hhmm}`}
                  type="button"
                  onClick={() => handleToggleSingleTime(hhmm)}
                  title="Click to untick this time slot"
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition cursor-pointer ${
                    isNextUp
                      ? 'bg-emerald-500 text-black border-emerald-200 shadow'
                      : 'bg-[#0b1528] hover:bg-rose-950 text-sky-200 hover:text-rose-200 border-[#24385c]'
                  }`}
                >
                  {isNextUp ? `▶ NEXT: ${formatHHMMTo12HrWithSec(hhmm)}` : formatHHMMTo12HrWithSec(hhmm)}
                </button>
              );
            })}
            {!showAllSelectedTimes && sortedTickedSlots.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllSelectedTimes(true)}
                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer"
              >
                +{sortedTickedSlots.length - 12} more times (Click to view all)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add Track & Custom Time Drawer */}
      {showAddTrackForm && (
        <div className="p-2.5 rounded-lg bg-[#0b1220] border border-sky-500/50 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-black text-sky-300 uppercase">
              + ADD NEW FULL-DAY TRACK (48 SLOTS/DAY) OR ADD SINGLE CUSTOM TIME:
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Track 6 Preset:</span>
              <button
                type="button"
                onClick={() => handleSwitchTrack6Mode('25_55')}
                className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                  localTrack6Mode === '25_55'
                    ? 'bg-amber-500 text-black border-amber-300'
                    : 'bg-black text-slate-400 border-slate-700'
                }`}
              >
                Track 6 = :25 &amp; :55 (Video Grid)
              </button>
              <button
                type="button"
                onClick={() => handleSwitchTrack6Mode('12_25')}
                className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                  localTrack6Mode === '12_25'
                    ? 'bg-amber-500 text-black border-amber-300'
                    : 'bg-black text-slate-400 border-slate-700'
                }`}
              >
                Track 6 = :12 &amp; :25 (12:12 / 12:25)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newTrackName}
              onChange={(e) => setNewTrackName(e.target.value)}
              placeholder={`Track ${trackDefs.length + 1} Name (optional)`}
              className="bg-black border border-[#2a3956] rounded px-2 py-1 text-[11px] text-white w-44"
            />
            <div className="flex items-center gap-1 bg-black border border-[#2a3956] rounded px-2 py-1">
              <span className="text-[10px] text-slate-400">1st Min (:00–:59):</span>
              <input
                type="number"
                min={0}
                max={59}
                value={newTrackMinA}
                onChange={(e) => setNewTrackMinA(Number(e.target.value))}
                className="w-12 bg-transparent text-amber-400 font-bold text-[11px] outline-none"
              />
            </div>
            <div className="flex items-center gap-1 bg-black border border-[#2a3956] rounded px-2 py-1">
              <span className="text-[10px] text-slate-400">2nd Min (:00–:59):</span>
              <input
                type="number"
                min={0}
                max={59}
                value={newTrackMinB}
                onChange={(e) => setNewTrackMinB(Number(e.target.value))}
                className="w-12 bg-transparent text-amber-400 font-bold text-[11px] outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleAddCustomTrack}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] flex items-center gap-1 cursor-pointer"
            >
              <Check className="w-3 h-3" />
              <span>Create 48-Slot Track</span>
            </button>

            <div className="flex items-center gap-1 ml-auto bg-black border border-[#2a3956] rounded px-2 py-1">
              <span className="text-[10px] text-slate-400">Add Single Time:</span>
              <input
                type="time"
                value={customSingleTime}
                onChange={(e) => setCustomSingleTime(e.target.value)}
                className="bg-transparent text-sky-300 font-bold text-[11px] outline-none"
              />
              <button
                type="button"
                onClick={handleAddSingleCustomTime}
                className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold cursor-pointer"
              >
                + Tick Time
              </button>
            </div>
          </div>
        </div>
      )}

      {isGridExpanded && (
        <>
          {/* Filter & Scroll Navigation Bar for the 48-Column Video Time Box */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#04070d] px-2 py-1 rounded border border-[#192336]">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-400 font-bold mr-1">View Grid:</span>
              <button
                type="button"
                onClick={() => setFocusedTrackFilter('all')}
                className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                  focusedTrackFilter === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'bg-[#0e1525] text-slate-400 hover:text-white'
                }`}
              >
                All 6 Tracks Grid (6×48 Video Box)
              </button>
              {trackDefs.map((t) => (
                <button
                  key={`filter-${t.id}`}
                  type="button"
                  onClick={() => setFocusedTrackFilter(t.trackNumber)}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer ${
                    focusedTrackFilter === t.trackNumber
                      ? 'bg-amber-500 text-black'
                      : 'bg-[#0e1525] text-slate-400 hover:text-white'
                  }`}
                >
                  {t.shortName} (48)
                </button>
              ))}
            </div>

            {/* Quick Time Jump & Left/Right Scroll Arrows */}
            <div className="flex items-center gap-1">
              {[
                { label: '12 AM', hr: 0 },
                { label: '6 AM', hr: 6 },
                { label: '12 PM', hr: 12 },
                { label: '6 PM', hr: 18 },
              ].map((jmp) => (
                <button
                  key={jmp.label}
                  type="button"
                  onClick={() => handleJumpToHour(jmp.hr)}
                  className="px-1.5 py-0.5 rounded bg-[#0e1525] hover:bg-[#1a2742] text-slate-300 border border-[#24324d] text-[9px] font-bold cursor-pointer"
                >
                  {jmp.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleScrollBy(-420)}
                className="px-1.5 py-0.5 rounded bg-[#162238] hover:bg-[#223456] text-white border border-[#2d426b] text-[10px] font-bold flex items-center cursor-pointer"
                title="Scroll Left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleScrollBy(420)}
                className="px-1.5 py-0.5 rounded bg-[#162238] hover:bg-[#223456] text-white border border-[#2d426b] text-[10px] font-bold flex items-center cursor-pointer"
                title="Scroll Right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ================================================================= */}
          {/* THE 48-COLUMN × 6-ROW HORIZONTALLY SCROLLABLE TIME CHECKBOX GRID */}
          {/* Uses <button type="button"> so every click ticks immediately!     */}
          {/* ================================================================= */}
          {focusedTrackFilter === 'all' ? (
            <div
              ref={scrollContainerRef}
              className="overflow-x-auto overflow-y-hidden border-2 border-slate-400 rounded bg-white text-black shadow-inner select-none"
              style={{ scrollbarWidth: 'auto' }}
            >
              <div className="inline-flex min-w-max">
                {/* Sticky Left Track Row Header Column */}
                <div className="sticky left-0 z-10 bg-slate-100 border-r-2 border-slate-300 flex flex-col justify-between py-1 px-1.5 shrink-0">
                  {trackDefs.map((t) => {
                    const fully = isTrackFullyTicked(
                      localTickedSlots,
                      t.trackNumber,
                      localTrack6Mode,
                      localCustomTracks
                    );
                    return (
                      <button
                        key={`row-hdr-${t.id}`}
                        type="button"
                        onClick={() => handleToggleTrack(t.trackNumber)}
                        className={`flex items-center gap-1 px-1.5 py-[2px] rounded text-[10px] font-bold text-left cursor-pointer ${
                          fully
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-800 hover:bg-slate-200'
                        }`}
                        title={`Click to Tick/Untick all 48 times in ${t.name}`}
                      >
                        <span
                          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[2px] border text-[9px] font-black shrink-0 ${
                            fully
                              ? 'bg-white text-blue-700 border-white'
                              : 'bg-white text-transparent border-slate-400'
                          }`}
                        >
                          ✓
                        </span>
                        <span>{t.shortName}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 48 Half-Hour Columns (12:00:00 AM .. 11:55:00 PM) */}
                {Array.from({ length: 48 }).map((_, colIdx) => (
                  <div
                    key={`col-${colIdx}`}
                    className="flex flex-col justify-between py-1 px-2 border-r border-slate-200 min-w-[120px]"
                  >
                    {trackDefs.map((t) => {
                      const slot = t.slots[colIdx];
                      if (!slot) return null;
                      const isChecked = tickedSet.has(slot.hhmm);
                      return (
                        <button
                          key={`${t.id}-${slot.hhmm}`}
                          type="button"
                          onClick={() => handleToggleSingleTime(slot.hhmm)}
                          className={`flex items-center gap-1.5 px-1.5 py-[2px] rounded cursor-pointer text-[11px] font-sans leading-tight transition text-left w-full ${
                            isChecked
                              ? 'bg-[#0078d7] text-white font-semibold'
                              : 'text-black hover:bg-slate-100'
                          }`}
                        >
                          <span
                            className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[2px] border text-[10px] font-black shrink-0 ${
                              isChecked
                                ? 'bg-white text-[#0078d7] border-white'
                                : 'bg-white text-transparent border-slate-500'
                            }`}
                          >
                            ✓
                          </span>
                          <span className="whitespace-nowrap">{slot.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Single Focused Track View (Shows all 48 slots of the selected Track in 8 columns × 6 rows) */
            <div
              ref={scrollContainerRef}
              className="overflow-x-auto border-2 border-slate-400 rounded bg-white text-black p-1.5 shadow-inner select-none"
            >
              {visibleTracks.map((t) => (
                <div key={`single-${t.id}`} className="space-y-1">
                  <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-300 text-[11px] font-bold text-slate-800">
                    <span>
                      {t.name} — {t.description}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleTrack(t.trackNumber)}
                      className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold cursor-pointer"
                    >
                      {isTrackFullyTicked(
                        localTickedSlots,
                        t.trackNumber,
                        localTrack6Mode,
                        localCustomTracks
                      )
                        ? `Untick All 48 Slots in ${t.shortName}`
                        : `Tick All 48 Slots in ${t.shortName}`}
                    </button>
                  </div>
                  <div className="inline-flex min-w-max">
                    {Array.from({ length: 8 }).map((_, groupColIdx) => {
                      const slice6 = t.slots.slice(groupColIdx * 6, groupColIdx * 6 + 6);
                      return (
                        <div
                          key={`tcol-${groupColIdx}`}
                          className="flex flex-col justify-between py-0.5 px-2.5 border-r border-slate-200 min-w-[126px]"
                        >
                          {slice6.map((slot) => {
                            const isChecked = tickedSet.has(slot.hhmm);
                            return (
                              <button
                                key={slot.hhmm}
                                type="button"
                                onClick={() => handleToggleSingleTime(slot.hhmm)}
                                className={`flex items-center gap-1.5 px-1.5 py-[2px] rounded cursor-pointer text-[11px] font-sans leading-tight transition text-left w-full ${
                                  isChecked
                                    ? 'bg-[#0078d7] text-white font-semibold'
                                    : 'text-black hover:bg-slate-100'
                                }`}
                              >
                                <span
                                  className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[2px] border text-[10px] font-black shrink-0 ${
                                    isChecked
                                      ? 'bg-white text-[#0078d7] border-white'
                                      : 'bg-white text-transparent border-slate-500'
                                  }`}
                                >
                                  ✓
                                </span>
                                <span className="whitespace-nowrap">{slot.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
