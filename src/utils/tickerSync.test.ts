import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterActiveTickerItems,
  isTickerBarExpired,
  computeRemainingSeconds,
  pickSyncedCycleLogoIndex,
  resolveTickerItemDurationSec,
  evaluateTickerPassCompletion,
  reconcileSyncedTickerState,
} from './tickerSync';

test('filterActiveTickerItems excludes disabled, blank, and expired items', () => {
  const now = 1_700_000_000_000;
  const items = [
    { id: '1', text: 'Active Future', enabled: true, expiresAt: now + 60_000 },
    { id: '2', text: 'Expired Past', enabled: true, expiresAt: now - 1_000 },
    { id: '3', text: 'Disabled', enabled: false, expiresAt: now + 60_000 },
    { id: '4', text: '   ', enabled: true },
    { id: '5', text: 'Permanent News', enabled: true, expiresAt: null },
  ];
  const res = filterActiveTickerItems(items, now);
  assert.deepEqual(
    res.map((r) => r.id),
    ['1', '5']
  );
});

test('isTickerBarExpired and computeRemainingSeconds track wall-clock expiry', () => {
  const now = 100_000;
  assert.equal(isTickerBarExpired(null, now), false);
  assert.equal(isTickerBarExpired(now + 5_000, now), false);
  assert.equal(isTickerBarExpired(now, now), true);
  assert.equal(isTickerBarExpired(now - 500, now), true);
  assert.equal(computeRemainingSeconds(now + 12_300, now), 13);
  assert.equal(computeRemainingSeconds(now - 100, now), 0);
  assert.equal(computeRemainingSeconds(undefined, now), null);
});

test('pickSyncedCycleLogoIndex chooses identical logo index across windows for same epochMs', () => {
  const durations = [5, 10, 5]; // total = 20s
  assert.equal(pickSyncedCycleLogoIndex(durations, 10, 2_000), 0);
  assert.equal(pickSyncedCycleLogoIndex(durations, 10, 7_500), 1);
  assert.equal(pickSyncedCycleLogoIndex(durations, 10, 17_000), 2);
  assert.equal(pickSyncedCycleLogoIndex(durations, 10, 22_000), 0);
});

test('evaluateTickerPassCompletion repeats item until minDurationSec expires', () => {
  assert.equal(resolveTickerItemDurationSec(0, 45), 45);
  assert.equal(resolveTickerItemDurationSec(90, 45), 90);

  // Mid-scroll
  const mid = evaluateTickerPassCompletion({
    isLtr: false,
    posX: 100,
    contentWidth: 1000,
    textWidth: 400,
    elapsedItemSec: 5,
    minDurationSec: 30,
  });
  assert.deepEqual(mid, {
    passFinished: false,
    advanceToNextItem: false,
    repeatCurrentItem: false,
  });

  // Pass finished early at 12s while minDurationSec is 30s -> repeat same scroll
  const early = evaluateTickerPassCompletion({
    isLtr: false,
    posX: -420,
    contentWidth: 1000,
    textWidth: 400,
    elapsedItemSec: 12,
    minDurationSec: 30,
  });
  assert.deepEqual(early, {
    passFinished: true,
    advanceToNextItem: false,
    repeatCurrentItem: true,
  });

  // Elapsed reached >= 30s -> advance to next scroll item
  const done = evaluateTickerPassCompletion({
    isLtr: false,
    posX: -420,
    contentWidth: 1000,
    textWidth: 400,
    elapsedItemSec: 30.2,
    minDurationSec: 30,
  });
  assert.deepEqual(done, {
    passFinished: true,
    advanceToNextItem: true,
    repeatCurrentItem: false,
  });
});

test('reconcileSyncedTickerState aligns 2nd Display to PGM item and extrapolated posX', () => {
  const items = [
    { id: 't1', text: 'First Breaking News', enabled: true },
    { id: 't2', text: 'Second Breaking News', enabled: true },
  ];
  const synced = reconcileSyncedTickerState({
    authoritative: {
      itemIndex: 1,
      itemId: 't2',
      posX: 500,
      contentWidth: 1800,
      textWidth: 400,
      elapsedSec: 6,
      updatedAtMs: 1_000_000,
    },
    activeItems: items,
    direction: 'rtl',
    speedVal: 4,
    nowEpochMs: 1_000_167, // ~10 frames later => ~36px advance
    currentLocalItemId: 't1',
    currentLocalPosX: 900,
  });

  assert.ok(synced);
  assert.equal(synced!.matchedIndex, 1);
  assert.equal(synced!.shouldSnap, true);
  assert.ok(synced!.syncedPosX < 500 && synced!.syncedPosX > 450);
});
