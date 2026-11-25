import { CustomAdTrack } from '../types/playout';

export interface TimeSlotEntry {
  hhmm: string; // 24-hour 'HH:MM' e.g. '00:00', '00:30', '13:05'
  label: string; // '12:00:00 AM', '12:30:00 AM', '1:05:00 PM' (exact video format)
  shortLabel: string; // '12:00 AM'
  trackNumber: number; // 1..6 or custom track number
  colIndex: number; // 0..47 (48 columns per day)
}

export interface TrackDefinition {
  trackNumber: number;
  id: string;
  name: string;
  shortName: string;
  description: string;
  minA: number;
  minB: number;
  slots: TimeSlotEntry[];
  isCustom?: boolean;
}

/**
 * Formats 24-hour (hour 0..23, minute 0..59) into '12:00:00 AM' (exact format shown in video)
 */
export function formatTimeSlot12HrWithSec(hour24: number, minute: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mmStr = String(m).padStart(2, '0');
  return `${hour12}:${mmStr}:00 ${period}`;
}

export function formatTimeSlot12HrShort(hour24: number, minute: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mmStr = String(m).padStart(2, '0');
  return `${hour12}:${mmStr} ${period}`;
}

export function formatHHMMTo12HrWithSec(hhmm: string): string {
  const parts = (hhmm || '00:00').split(':');
  const h = parseInt(parts[0] || '0', 10) || 0;
  const m = parseInt(parts[1] || '0', 10) || 0;
  return formatTimeSlot12HrWithSec(h, m);
}

export function toHHMM(hour24: number, minute: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Builds 48 time slots across the 24-hour day for a given pair of minutes (minA, minB) in each hour.
 */
export function build48SlotsForMinutePair(
  trackNumber: number,
  minA: number,
  minB: number
): TimeSlotEntry[] {
  const slots: TimeSlotEntry[] = [];
  let col = 0;
  for (let hr = 0; hr < 24; hr++) {
    const hhmmA = toHHMM(hr, minA);
    slots.push({
      hhmm: hhmmA,
      label: formatTimeSlot12HrWithSec(hr, minA),
      shortLabel: formatTimeSlot12HrShort(hr, minA),
      trackNumber,
      colIndex: col++,
    });

    const hhmmB = toHHMM(hr, minB);
    slots.push({
      hhmm: hhmmB,
      label: formatTimeSlot12HrWithSec(hr, minB),
      shortLabel: formatTimeSlot12HrShort(hr, minB),
      trackNumber,
      colIndex: col++,
    });
  }
  return slots;
}

export type Track6ModeInput = '25_55' | '12_25' | 'text' | 'video';

export function normalizeTrack6Mode(mode?: Track6ModeInput): '25_55' | '12_25' {
  if (mode === '12_25' || mode === 'text') return '12_25';
  return '25_55';
}

export function getCurrentHHMM(now: Date = new Date()): string {
  return toHHMM(now.getHours(), now.getMinutes());
}

/**
 * Returns the 6 Standard Full-Day Ad Tracking Tracks (48 slots/day each = 288 slots total)
 * plus any user-added Custom Tracks.
 */
export function getAllTrackDefinitions(
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): TrackDefinition[] {
  const track6Mode = normalizeTrack6Mode(track6ModeInput);
  const baseTracks: TrackDefinition[] = [
    {
      trackNumber: 1,
      id: 'track_1',
      name: 'Track 1 — Full Day (:00 & :30)',
      shortName: 'Track 1',
      description: 'Every 30 mins at :00 and :30 (12:00 AM, 12:30 AM ... 11:30 PM) • 48 slots/day',
      minA: 0,
      minB: 30,
      slots: build48SlotsForMinutePair(1, 0, 30),
    },
    {
      trackNumber: 2,
      id: 'track_2',
      name: 'Track 2 — Full Day (:05 & :35)',
      shortName: 'Track 2',
      description: 'Every 30 mins at :05 and :35 (12:05 AM, 12:35 AM ... 11:35 PM) • 48 slots/day',
      minA: 5,
      minB: 35,
      slots: build48SlotsForMinutePair(2, 5, 35),
    },
    {
      trackNumber: 3,
      id: 'track_3',
      name: 'Track 3 — Full Day (:10 & :40)',
      shortName: 'Track 3',
      description: 'Every 30 mins at :10 and :40 (12:10 AM, 12:40 AM ... 11:40 PM) • 48 slots/day',
      minA: 10,
      minB: 40,
      slots: build48SlotsForMinutePair(3, 10, 40),
    },
    {
      trackNumber: 4,
      id: 'track_4',
      name: 'Track 4 — Full Day (:15 & :45)',
      shortName: 'Track 4',
      description: 'Every 30 mins at :15 and :45 (12:15 AM, 12:45 AM ... 11:45 PM) • 48 slots/day',
      minA: 15,
      minB: 45,
      slots: build48SlotsForMinutePair(4, 15, 45),
    },
    {
      trackNumber: 5,
      id: 'track_5',
      name: 'Track 5 — Full Day (:20 & :50)',
      shortName: 'Track 5',
      description: 'Every 30 mins at :20 and :50 (12:20 AM, 12:50 AM ... 11:50 PM) • 48 slots/day',
      minA: 20,
      minB: 50,
      slots: build48SlotsForMinutePair(5, 20, 50),
    },
    track6Mode === '12_25'
      ? {
          trackNumber: 6,
          id: 'track_6',
          name: 'Track 6 — Full Day (:12 & :25)',
          shortName: 'Track 6',
          description: 'Every hour at :12 and :25 (12:12 AM, 12:25 AM ... 11:25 PM) • 48 slots/day',
          minA: 12,
          minB: 25,
          slots: build48SlotsForMinutePair(6, 12, 25),
        }
      : {
          trackNumber: 6,
          id: 'track_6',
          name: 'Track 6 — Full Day (:25 & :55)',
          shortName: 'Track 6',
          description: 'Every 30 mins at :25 and :55 (12:25 AM, 12:55 AM ... 11:55 PM) • 48 slots/day',
          minA: 25,
          minB: 55,
          slots: build48SlotsForMinutePair(6, 25, 55),
        },
  ];

  const extraTracks: TrackDefinition[] = (customTracks || []).map((ct) => {
    const builtSlots =
      Array.isArray(ct.slots) && ct.slots.length === 48
        ? ct.slots.map((hhmm, idx) => ({
            hhmm,
            label: formatHHMMTo12HrWithSec(hhmm),
            shortLabel: hhmm,
            trackNumber: ct.trackNumber,
            colIndex: idx,
          }))
        : build48SlotsForMinutePair(ct.trackNumber, ct.minA ?? 12, ct.minB ?? 25);
    return {
      trackNumber: ct.trackNumber,
      id: ct.id,
      name: ct.name || `Track ${ct.trackNumber} (:${String(ct.minA).padStart(2, '0')} & :${String(ct.minB).padStart(2, '0')})`,
      shortName: `Track ${ct.trackNumber}`,
      description: `Custom Track ${ct.trackNumber} • 48 slots/day`,
      minA: ct.minA,
      minB: ct.minB,
      slots: builtSlots,
      isCustom: true,
    };
  });

  return [...baseTracks, ...extraTracks];
}

export function getTrack48HHMMs(
  trackNumber: number,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): string[] {
  const track6Mode = normalizeTrack6Mode(track6ModeInput);
  const all = getAllTrackDefinitions(track6Mode, customTracks);
  const found = all.find((t) => t.trackNumber === trackNumber);
  return found ? found.slots.map((s) => s.hhmm) : build48SlotsForMinutePair(1, 0, 30).map((s) => s.hhmm);
}

export function getAllTracksHHMMs(
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): string[] {
  const track6Mode = normalizeTrack6Mode(track6ModeInput);
  const all = getAllTrackDefinitions(track6Mode, customTracks);
  const set = new Set<string>();
  all.forEach((t) => t.slots.forEach((s) => set.add(s.hhmm)));
  return Array.from(set);
}

export function isTrackFullyTicked(
  tickedSlots: string[] | undefined,
  trackNumber: number,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): boolean {
  if (!tickedSlots || tickedSlots.length === 0) return false;
  const trackSlots = getTrack48HHMMs(trackNumber, track6ModeInput, customTracks);
  const tickedSet = new Set(tickedSlots);
  return trackSlots.length > 0 && trackSlots.every((s) => tickedSet.has(s));
}

export function getTrackTickedCount(
  tickedSlots: string[] | undefined,
  trackNumber: number,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): number {
  if (!tickedSlots || tickedSlots.length === 0) return 0;
  const trackSlots = getTrack48HHMMs(trackNumber, track6ModeInput, customTracks);
  const tickedSet = new Set(tickedSlots);
  return trackSlots.filter((s) => tickedSet.has(s)).length;
}

export function toggleEntireTrackSlots(
  currentTicked: string[] | undefined,
  trackNumber: number,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): { tickedSlots: string[]; selectedTracks: number[] } {
  const track6Mode = normalizeTrack6Mode(track6ModeInput);
  const existing = new Set(currentTicked || []);
  const trackSlots = getTrack48HHMMs(trackNumber, track6Mode, customTracks);
  const allPresent = trackSlots.every((s) => existing.has(s));

  if (allPresent) {
    trackSlots.forEach((s) => existing.delete(s));
  } else {
    trackSlots.forEach((s) => existing.add(s));
  }

  const nextTicked = Array.from(existing);
  const allDefs = getAllTrackDefinitions(track6Mode, customTracks);
  const nextSelectedTracks = allDefs
    .filter((t) => t.slots.some((s) => existing.has(s.hhmm)))
    .map((t) => t.trackNumber);

  return {
    tickedSlots: nextTicked,
    selectedTracks: nextSelectedTracks,
  };
}

export function selectOnlySingleTrackSlots(
  trackNumber: number,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): { tickedSlots: string[]; selectedTracks: number[] } {
  return {
    tickedSlots: getTrack48HHMMs(trackNumber, track6ModeInput, customTracks),
    selectedTracks: [trackNumber],
  };
}

export function toggleSingleSlotHHMM(
  currentTicked: string[] | undefined,
  hhmm: string,
  track6ModeInput: Track6ModeInput = '25_55',
  customTracks: CustomAdTrack[] = []
): { tickedSlots: string[]; selectedTracks: number[] } {
  const track6Mode = normalizeTrack6Mode(track6ModeInput);
  const existing = new Set(currentTicked || []);
  if (existing.has(hhmm)) {
    existing.delete(hhmm);
  } else {
    existing.add(hhmm);
  }
  const nextTicked = Array.from(existing);
  const allDefs = getAllTrackDefinitions(track6Mode, customTracks);
  const nextSelectedTracks = allDefs
    .filter((t) => t.slots.some((s) => existing.has(s.hhmm)))
    .map((t) => t.trackNumber);

  return {
    tickedSlots: nextTicked,
    selectedTracks: nextSelectedTracks,
  };
}

/**
 * Returns the default 48 ticked slots for an item (defaults to Track 1 if none set yet)
 */
export function ensureDefaultTickedSlots(
  tickedSlots?: string[],
  selectedTracks?: number[],
  arg3: number | Track6ModeInput = 1,
  arg4?: Track6ModeInput | CustomAdTrack[],
  customTracksArg?: CustomAdTrack[]
): string[] {
  const defaultTrackNumber = typeof arg3 === 'number' ? arg3 : 1;
  const track6Mode = normalizeTrack6Mode(typeof arg3 === 'string' ? arg3 : typeof arg4 === 'string' ? arg4 : undefined);
  const customTracks: CustomAdTrack[] = Array.isArray(arg4)
    ? arg4
    : Array.isArray(customTracksArg)
    ? customTracksArg
    : [];
  if (Array.isArray(tickedSlots)) {
    return tickedSlots;
  }
  if (Array.isArray(selectedTracks) && selectedTracks.length > 0) {
    const set = new Set<string>();
    selectedTracks.forEach((tNum) => {
      getTrack48HHMMs(tNum, track6Mode, customTracks).forEach((s) => set.add(s));
    });
    return Array.from(set);
  }
  return getTrack48HHMMs(defaultTrackNumber, track6Mode, customTracks);
}

/**
 * Computes the next upcoming ticked time slot from `now` and how many seconds remain until it triggers.
 */
export function getNextTickedSlotCountdown(
  tickedSlots: string[] | undefined,
  now: Date = new Date()
): { nextSlotHHMM: string | null; nextSlotLabel: string; nextSlot12Hr: string; secondsUntilNext: number } {
  if (!tickedSlots || tickedSlots.length === 0) {
    return {
      nextSlotHHMM: null,
      nextSlotLabel: 'No Time Slots Ticked',
      nextSlot12Hr: 'No Time Slots Ticked',
      secondsUntilNext: 0,
    };
  }

  const nowSecOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let bestDiffSec = Infinity;
  let bestHHMM: string | null = null;

  for (const hhmm of tickedSlots) {
    const parts = (hhmm || '').split(':');
    if (parts.length < 2) continue;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const slotSecOfDay = h * 3600 + m * 60;
    let diff = slotSecOfDay - nowSecOfDay;
    if (diff <= 0) {
      diff += 24 * 3600; // wraps to tomorrow
    }
    if (diff < bestDiffSec) {
      bestDiffSec = diff;
      bestHHMM = hhmm;
    }
  }

  if (!bestHHMM || !isFinite(bestDiffSec)) {
    return {
      nextSlotHHMM: null,
      nextSlotLabel: 'No Time Slots Ticked',
      nextSlot12Hr: 'No Time Slots Ticked',
      secondsUntilNext: 0,
    };
  }

  const label12 = formatHHMMTo12HrWithSec(bestHHMM);
  return {
    nextSlotHHMM: bestHHMM,
    nextSlotLabel: label12,
    nextSlot12Hr: label12,
    secondsUntilNext: bestDiffSec,
  };
}

export function getLocalTodayYMD(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Default Date Range for Every N Min Ads & L-Shape (LSHOP):
 * Start Date: Today (YYYY-MM-DD)
 * End Date: Same date next month (e.g. Oct 2 -> Nov 2)
 */
export function getDefaultAdDateRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const startDate = getLocalTodayYMD(now);
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const endDate = getLocalTodayYMD(nextMonthDate);
  return { startDate, endDate };
}

export function getNextMonthSameDateYMD(baseDate: Date | string = new Date(), monthsAhead: number = 1): string {
  const d = typeof baseDate === 'string' ? new Date(baseDate) : new Date(baseDate.getTime());
  if (isNaN(d.getTime())) return getLocalTodayYMD();
  const next = new Date(d.getFullYear(), d.getMonth() + monthsAhead, d.getDate());
  return getLocalTodayYMD(next);
}

export function getDateRangeStatus(startDate?: string, endDate?: string, now: Date = new Date()): {
  status: 'active' | 'pending' | 'expired';
  label: string;
} {
  const today = getLocalTodayYMD(now);
  if (startDate && today < startDate) {
    return { status: 'pending', label: `Pending (Starts ${startDate})` };
  }
  if (endDate && today > endDate) {
    return { status: 'expired', label: `Expired (${endDate})` };
  }
  return { status: 'active', label: 'Active on Air (Today in Range)' };
}

export interface AdDateScheduleConfig {
  dateMode?: 'every_day' | 'specific_date' | 'date_range';
  scheduledDate?: string;
  startDate?: string;
  endDate?: string;
}

export function isAdDateMatch(
  item: AdDateScheduleConfig | undefined,
  now: Date = new Date()
): boolean {
  if (!item || !item.dateMode || item.dateMode === 'every_day') {
    return true;
  }
  const today = getLocalTodayYMD(now);
  if (item.dateMode === 'specific_date') {
    if (!item.scheduledDate) return true;
    return item.scheduledDate === today;
  }
  if (item.dateMode === 'date_range') {
    const startOk = !item.startDate || today >= item.startDate;
    const endOk = !item.endDate || today <= item.endDate;
    return startOk && endOk;
  }
  return true;
}

export function formatAdDateSummary(
  item: AdDateScheduleConfig | undefined,
  now: Date = new Date()
): string {
  const today = getLocalTodayYMD(now);
  if (!item || !item.dateMode || item.dateMode === 'every_day') {
    return `Every Day (${today})`;
  }
  if (item.dateMode === 'specific_date') {
    return item.scheduledDate || today;
  }
  if (item.dateMode === 'date_range') {
    return `${item.startDate || today} → ${item.endDate || today}`;
  }
  return `Every Day (${today})`;
}

export function secondsUntilNextTickedSlot(
  tickedSlots: string[] | undefined,
  now: Date = new Date()
): number {
  const res = getNextTickedSlotCountdown(tickedSlots, now);
  return res.secondsUntilNext > 0 ? res.secondsUntilNext : 1800;
}

export function formatWaitingDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${remSec}s`;
  }
  return `${mins}m ${remSec}s`;
}

export function formatSlotPlayWindow(
  baseHHMM: string | null | undefined,
  offsetSec: number = 0,
  durationSec: number = 30
): string {
  if (!baseHHMM) return 'No Time Selected';
  const parts = baseHHMM.split(':');
  if (parts.length < 2) return 'No Time Selected';
  const baseH = parseInt(parts[0], 10) || 0;
  const baseM = parseInt(parts[1], 10) || 0;
  const startTotalSec = (baseH * 3600 + baseM * 60 + Math.max(0, Math.floor(offsetSec))) % 86400;
  const endTotalSec = (startTotalSec + Math.max(1, Math.floor(durationSec))) % 86400;

  const fmtSecOfDay = (sOfDay: number) => {
    const h24 = Math.floor(sOfDay / 3600);
    const m = Math.floor((sOfDay % 3600) / 60);
    const s = sOfDay % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`;
  };

  return `${fmtSecOfDay(startTotalSec)} – ${fmtSecOfDay(endTotalSec)}`;
}

// Canonical 13 minutes per hour across Tracks 1..6 (both 25_55 & 12_25): 24 * 13 = 312 bits = 52 Base64URL chars
const CANONICAL_SLOT_MINUTES = [0, 5, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const;
const CANONICAL_SLOTS_LIST: string[] = [];
const CANONICAL_SLOT_INDEX = new Map<string, number>();
for (let h = 0; h < 24; h++) {
  for (const m of CANONICAL_SLOT_MINUTES) {
    const key = toHHMM(h, m);
    CANONICAL_SLOT_INDEX.set(key, CANONICAL_SLOTS_LIST.length);
    CANONICAL_SLOTS_LIST.push(key);
  }
}
const B64_URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export interface CompactSlotsPayload {
  slotsMask?: string;
  extraSlots?: string[];
}

/**
 * Compresses tickedSlots (288+ strings, ~3.5 KB) into either:
 * - {} (0 bytes) when identical to the union of selectedTracks (with selectedTracks.length > 0)
 * - { slotsMask: '' } when empty []
 * - { slotsMask: 52-char base64 bitmask, extraSlots? } (~64 bytes) for custom subsets
 */
export function encodeCompactSlots(
  tickedSlots?: string[],
  selectedTracks?: number[],
  track6ModeInput?: Track6ModeInput,
  customTracks?: CustomAdTrack[]
): CompactSlotsPayload {
  if (!Array.isArray(tickedSlots)) {
    return {};
  }
  if (tickedSlots.length === 0) {
    return { slotsMask: '' };
  }

  // If tickedSlots matches the default tracks expansion 1:1, omit slotsMask completely (0 bytes)
  if (Array.isArray(selectedTracks) && selectedTracks.length > 0) {
    const expected = ensureDefaultTickedSlots(
      undefined,
      selectedTracks,
      track6ModeInput,
      customTracks
    );
    if (expected.length === tickedSlots.length) {
      const tickedSet = new Set(tickedSlots);
      if (tickedSet.size === expected.length && expected.every((s) => tickedSet.has(s))) {
        return {};
      }
    }
  }

  const bits = new Uint8Array(CANONICAL_SLOTS_LIST.length); // 312 bits
  const extraSlots: string[] = [];
  let hasCanonical = false;

  for (const rawSlot of tickedSlots) {
    const slot = String(rawSlot || '').trim();
    if (!slot) continue;
    const idx = CANONICAL_SLOT_INDEX.get(slot);
    if (idx !== undefined) {
      bits[idx] = 1;
      hasCanonical = true;
    } else if (!extraSlots.includes(slot)) {
      extraSlots.push(slot);
    }
  }

  let mask = '';
  if (hasCanonical) {
    const out: string[] = [];
    for (let i = 0; i < 312; i += 6) {
      const v =
        ((bits[i] || 0) << 5) |
        ((bits[i + 1] || 0) << 4) |
        ((bits[i + 2] || 0) << 3) |
        ((bits[i + 3] || 0) << 2) |
        ((bits[i + 4] || 0) << 1) |
        (bits[i + 5] || 0);
      out.push(B64_URL_CHARS[v]);
    }
    mask = out.join('');
  }

  const res: CompactSlotsPayload = { slotsMask: mask };
  if (extraSlots.length > 0) {
    res.extraSlots = extraSlots;
  }
  return res;
}

/**
 * Decodes legacy tickedSlots OR compact slotsMask/extraSlots back into string[].
 */
export function decodeCompactSlots(opts: {
  tickedSlots?: string[];
  slotsMask?: string;
  extraSlots?: string[];
  selectedTracks?: number[];
  track6Mode?: Track6ModeInput;
  track6Preset?: Track6ModeInput;
  customTracks?: CustomAdTrack[];
}): string[] {
  if (Array.isArray(opts.tickedSlots)) {
    return opts.tickedSlots;
  }
  if (typeof opts.slotsMask === 'string') {
    const result: string[] = [];
    if (opts.slotsMask.length > 0) {
      for (let c = 0; c < opts.slotsMask.length; c++) {
        const val = B64_URL_CHARS.indexOf(opts.slotsMask[c]);
        if (val <= 0) continue;
        const base = c * 6;
        for (let b = 0; b < 6; b++) {
          if (val & (1 << (5 - b))) {
            const slot = CANONICAL_SLOTS_LIST[base + b];
            if (slot) result.push(slot);
          }
        }
      }
    }
    if (Array.isArray(opts.extraSlots)) {
      for (const s of opts.extraSlots) {
        if (s && !result.includes(s)) result.push(s);
      }
    }
    return result;
  }
  return ensureDefaultTickedSlots(
    undefined,
    opts.selectedTracks,
    opts.track6Preset || opts.track6Mode,
    opts.customTracks
  );
}
