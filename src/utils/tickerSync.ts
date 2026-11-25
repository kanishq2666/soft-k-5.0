import type { TickerScrollItem } from '../types/playout';

export interface ActiveTickerItem extends TickerScrollItem {
  durationSec?: number;
  expiresAt?: number | null;
}

export interface TickerSyncTrackState {
  itemIndex: number;
  itemId: string;
  posX: number;
  contentWidth: number;
  textWidth: number;
  elapsedSec: number;
  updatedAtMs: number;
}

export interface CgLiveSyncSnapshot {
  epochMs: number;
  bottomOverlay?: {
    currentIndex: number;
    currentTime: number;
  };
  topOverlay?: {
    currentIndex: number;
    currentTime: number;
  };
  lShape?: {
    currentIndex: number;
    currentTime: number;
    periodicActive?: boolean;
  };
  bottomTicker?: TickerSyncTrackState;
  topTicker?: TickerSyncTrackState;
}

/**
 * Returns only enabled ticker items that have non-empty text and have not expired at `nowMs`.
 */
export function filterActiveTickerItems<T extends ActiveTickerItem>(
  items: T[] | undefined | null,
  nowMs: number = Date.now()
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.filter((item) => {
    if (!item || item.enabled === false) return false;
    if (!String(item.text || '').trim()) return false;
    if (typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) && item.expiresAt > 0) {
      if (nowMs >= item.expiresAt) return false;
    }
    return true;
  });
}

/**
 * Checks whether a ticker bar (Bottom or Top) has passed its scheduled expiry epoch timestamp.
 */
export function isTickerBarExpired(
  expiresAt: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return false;
  }
  return nowMs >= expiresAt;
}

/**
 * Returns integer seconds remaining until `expiresAt`, or null if no expiry is configured.
 */
export function computeRemainingSeconds(
  expiresAt: number | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }
  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}

/**
 * Computes an epoch-synchronized cycle logo index so PGM OUT and 2nd Display
 * always display the exact same logo slot at the exact same wall-clock instant.
 */
export function pickSyncedCycleLogoIndex(
  durationsSec: number[],
  defaultIntervalSec: number = 10,
  epochMs: number = Date.now()
): number {
  if (!Array.isArray(durationsSec) || durationsSec.length === 0) return 0;
  const fallback = Math.max(2, Number(defaultIntervalSec) || 10);
  const durationsMs = durationsSec.map((d) => Math.max(2, Number(d) || fallback) * 1000);
  const totalCycleMs = durationsMs.reduce((acc, ms) => acc + ms, 0) || fallback * 1000;
  let rem = ((epochMs % totalCycleMs) + totalCycleMs) % totalCycleMs;
  for (let i = 0; i < durationsMs.length; i++) {
    if (rem < durationsMs[i]) {
      return i;
    }
    rem -= durationsMs[i];
  }
  return 0;
}

/**
 * Resolves effective minimum play duration (in seconds) for a ticker item.
 * Returns 0 if single natural scroll pass should determine transition.
 */
export function resolveTickerItemDurationSec(
  itemDurationSec?: number,
  barDurationSec?: number
): number {
  if (typeof itemDurationSec === 'number' && Number.isFinite(itemDurationSec) && itemDurationSec > 0) {
    return itemDurationSec;
  }
  if (typeof barDurationSec === 'number' && Number.isFinite(barDurationSec) && barDurationSec > 0) {
    return barDurationSec;
  }
  return 0;
}

/**
 * Advances a ticker item scroll pass while honoring extended hold/repeat duration (`durationSec`).
 * If a single full scroll pass completes before `minDurationSec` seconds have elapsed,
 * `repeatCurrentItem` is true so the scroll loops seamlessly until `minDurationSec` expires.
 */
export function evaluateTickerPassCompletion(opts: {
  isLtr: boolean;
  posX: number;
  contentWidth: number;
  textWidth: number;
  elapsedItemSec: number;
  minDurationSec: number;
}): {
  passFinished: boolean;
  advanceToNextItem: boolean;
  repeatCurrentItem: boolean;
} {
  const { isLtr, posX, contentWidth, textWidth, elapsedItemSec, minDurationSec } = opts;
  const passFinished = isLtr ? posX > contentWidth + 12 : posX + textWidth < -12;
  if (!passFinished) {
    return { passFinished: false, advanceToNextItem: false, repeatCurrentItem: false };
  }
  if (minDurationSec > 0 && elapsedItemSec + 0.05 < minDurationSec) {
    return { passFinished: true, advanceToNextItem: false, repeatCurrentItem: true };
  }
  return { passFinished: true, advanceToNextItem: true, repeatCurrentItem: false };
}

/**
 * Synchronizes a slave/2nd Display ticker position with the authoritative PGM OUT snapshot,
 * extrapolating smooth motion over small network/BroadcastChannel age deltas (< 2500ms).
 */
export function reconcileSyncedTickerState(opts: {
  authoritative: TickerSyncTrackState | undefined;
  activeItems: ActiveTickerItem[];
  direction: 'rtl' | 'ltr';
  speedVal: number;
  nowEpochMs: number;
  currentLocalItemId?: string;
  currentLocalPosX?: number;
}): {
  matchedIndex: number;
  syncedPosX: number;
  elapsedSec: number;
  shouldSnap: boolean;
} | null {
  const {
    authoritative,
    activeItems,
    direction,
    speedVal,
    nowEpochMs,
    currentLocalItemId,
    currentLocalPosX,
  } = opts;
  if (!authoritative || !activeItems.length) return null;

  const ageMs = nowEpochMs - authoritative.updatedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < -500 || ageMs > 4000) return null;

  let matchedIndex = activeItems.findIndex((it) => it.id === authoritative.itemId);
  if (matchedIndex < 0) {
    if (authoritative.itemIndex >= 0 && authoritative.itemIndex < activeItems.length) {
      matchedIndex = authoritative.itemIndex;
    } else {
      return null;
    }
  }

  const clampedAgeMs = Math.max(0, Math.min(2500, ageMs));
  const stepPerFrame = Math.max(0.6, speedVal * 0.9);
  const deltaPx = stepPerFrame * (clampedAgeMs / 16.6667);
  const projectedPosX =
    direction === 'ltr' ? authoritative.posX + deltaPx : authoritative.posX - deltaPx;

  const itemChanged = currentLocalItemId !== activeItems[matchedIndex].id;
  const driftPx =
    typeof currentLocalPosX === 'number' && Number.isFinite(currentLocalPosX)
      ? Math.abs(currentLocalPosX - projectedPosX)
      : Infinity;

  // Snap when active item changed or drift exceeds 24px so both displays scroll identically
  const shouldSnap = itemChanged || driftPx > 24;

  return {
    matchedIndex,
    syncedPosX: projectedPosX,
    elapsedSec: authoritative.elapsedSec + clampedAgeMs / 1000,
    shouldSnap,
  };
}
