import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceMainPlaybackOnClipEnd,
  buildBroadcastChannelPayload,
  captureDeckPausedTimeSec,
  getActiveChannelPlaybackTimeSec,
  resolveDeckResumeTargetSec,
  shouldKeepExistingVideoFrameInPlace,
  startScheduledProgramOnChannel,
  triggerEveryNMinAdOnChannel,
} from './playoutPlaybackEngine';
import {
  decodeCompactSlots,
  encodeCompactSlots,
  ensureDefaultTickedSlots,
  getAllTracksHHMMs,
} from './adTrackingTracks';
import {
  compactCgStatePayload,
  compactPlayoutStateEnvelope,
  hydrateCompactChannel,
} from './stateCompactor';
import { buildDefaultLogos } from './defaultLogos';
import type { EveryNMinAdItem, TVChannel } from '../types/playout';

function createBaseChannel(overrides: Partial<TVChannel> = {}): TVChannel {
  return {
    id: 1,
    name: 'ASHOKA TV',
    callSign: 'ASHOKA',
    frequency: 'CH 1',
    genre: 'Cinema',
    colorAccent: '#f59e0b',
    status: 'PLAYING',
    currentClipIndex: 0,
    currentTime: 0,
    totalDuration: 120,
    loopMode: 'playlist',
    defaultFillerMedia: { title: 'Default', type: 'bars' },
    playlist: [
      { id: 'main-1', title: 'Main Clip 1', category: 'PROGRAM', duration: 60, url: '/videos/ch1.mp4', enabled: true },
      { id: 'main-2', title: 'Main Clip 2', category: 'PROGRAM', duration: 60, url: '/videos/ch2.mp4', enabled: true },
    ],
    scheduledPrograms: [
      {
        id: 'prog-1',
        name: 'Evening Movie',
        enabled: true,
        scheduleType: 'daily',
        startDate: '2026-01-01',
        startTime: '18:00',
        overlayMode: 'all_overlays',
        playlist: [
          { id: 'pclip-1', title: 'Program Clip 1', category: 'PROGRAM', duration: 90, url: '/videos/ch3.mp4', enabled: true },
          { id: 'pclip-2', title: 'Program Clip 2', category: 'PROGRAM', duration: 45, url: '/videos/ch4.mp4', enabled: true },
        ],
      },
    ],
    everyNMinAds: [
      {
        id: 'ad-1',
        title: 'Ad Spot 1',
        category: 'COMMERCIAL',
        duration: 15,
        url: '/videos/ch5.mp4',
        overlayMode: 'all_overlays',
        orderIndex: 1,
        enabled: true,
      },
      {
        id: 'ad-2',
        title: 'Ad Spot 2',
        category: 'COMMERCIAL',
        duration: 20,
        url: '/videos/ch6.mp4',
        overlayMode: 'all_overlays',
        orderIndex: 2,
        enabled: true,
      },
    ],
    activeEveryNMinAd: null,
    everyNMinQueue: [],
    everyNMinTime: 0,
    activeProgramId: null,
    activeProgramClipIndex: 0,
    activeProgramTime: 0,
    loopCycle: 0,
    graphics: {} as any,
    transmission: {} as any,
    ...overrides,
  };
}

test('Main Playlist -> Every N Min Ad -> Main Playlist resumes at exact paused clip & timestamp', () => {
  const chStart = createBaseChannel({ currentClipIndex: 1, currentTime: 24.75 });
  const ads = chStart.everyNMinAds as EveryNMinAdItem[];
  const duringAd = triggerEveryNMinAdOnChannel(chStart, [ads[0]], 24.75, 0);

  assert.equal(duringAd.activeEveryNMinAd?.id, 'ad-1');
  assert.deepEqual(duringAd.savedMainPlaybackState, { clipIndex: 1, currentTime: 24.75 });

  const afterAd = advanceMainPlaybackOnClipEnd(duringAd, 'ad:ad-1:cycle:1');
  assert.equal(afterAd.activeEveryNMinAd, null);
  assert.equal(afterAd.currentClipIndex, 1);
  assert.equal(afterAd.currentTime, 24.75);
  assert.equal(afterAd.savedMainPlaybackState, null);
  assert.equal(afterAd.status, 'PLAYING');
});

test('Main Playlist -> Multi-Ad Queue -> Main Playlist resumes at exact paused timestamp', () => {
  const chStart = createBaseChannel({ currentClipIndex: 0, currentTime: 18.4 });
  const ads = chStart.everyNMinAds as EveryNMinAdItem[];
  const duringAd1 = triggerEveryNMinAdOnChannel(chStart, ads, 18.4, 0);
  assert.equal(duringAd1.activeEveryNMinAd?.id, 'ad-1');
  assert.equal(duringAd1.everyNMinQueue?.length, 1);

  const duringAd2 = advanceMainPlaybackOnClipEnd(duringAd1, 'ad:ad-1:cycle:1');
  assert.equal(duringAd2.activeEveryNMinAd?.id, 'ad-2');
  assert.deepEqual(duringAd2.savedMainPlaybackState, { clipIndex: 0, currentTime: 18.4 });

  const afterAd2 = advanceMainPlaybackOnClipEnd(duringAd2, 'ad:ad-2:cycle:2');
  assert.equal(afterAd2.activeEveryNMinAd, null);
  assert.equal(afterAd2.currentClipIndex, 0);
  assert.equal(afterAd2.currentTime, 18.4);
});

test('Main -> Scheduled Program -> Every N Min Ad -> Program resumes at paused spot -> Main resumes at paused spot', () => {
  const chStart = createBaseChannel({ currentClipIndex: 0, currentTime: 31.2 });
  const duringProg = startScheduledProgramOnChannel(chStart, 'prog-1', 31.2, '2026-11-21');
  assert.equal(duringProg.activeProgramId, 'prog-1');
  assert.deepEqual(duringProg.savedMainPlaybackState, { clipIndex: 0, currentTime: 31.2 });

  // Advance to 2nd clip inside Program at 12.6s, then interrupt with Ad!
  const progClip2Mid = { ...duringProg, activeProgramClipIndex: 1, activeProgramTime: 12.6 };
  const ads = progClip2Mid.everyNMinAds as EveryNMinAdItem[];
  const duringAd = triggerEveryNMinAdOnChannel(progClip2Mid, [ads[0]], 31.2, 12.6);

  assert.equal(duringAd.activeEveryNMinAd?.id, 'ad-1');
  assert.deepEqual(duringAd.savedProgramPlaybackState, {
    programId: 'prog-1',
    clipIndex: 1,
    currentTime: 12.6,
  });
  // Main checkpoint MUST remain untouched!
  assert.deepEqual(duringAd.savedMainPlaybackState, { clipIndex: 0, currentTime: 31.2 });

  // Ad finishes -> Program clip 1 resumes at 12.6s!
  const resumedProg = advanceMainPlaybackOnClipEnd(duringAd, 'ad:ad-1:cycle:2');
  assert.equal(resumedProg.activeEveryNMinAd, null);
  assert.equal(resumedProg.activeProgramId, 'prog-1');
  assert.equal(resumedProg.activeProgramClipIndex, 1);
  assert.equal(resumedProg.activeProgramTime, 12.6);
  assert.deepEqual(resumedProg.savedMainPlaybackState, { clipIndex: 0, currentTime: 31.2 });

  // Program finishes -> Main Playlist clip 0 resumes at 31.2s!
  const resumedMain = advanceMainPlaybackOnClipEnd(resumedProg, 'prog:prog-1:1:cycle:3');
  assert.equal(resumedMain.activeProgramId, null);
  assert.equal(resumedMain.currentClipIndex, 0);
  assert.equal(resumedMain.currentTime, 31.2);
  assert.equal(resumedMain.savedMainPlaybackState, null);
});

test('Starting a Scheduled Program manually while Every N Min Ad is active clears Ad and keeps saved Main checkpoint', () => {
  const chStart = createBaseChannel({ currentClipIndex: 1, currentTime: 42.5 });
  const ads = chStart.everyNMinAds as EveryNMinAdItem[];
  const duringAd = triggerEveryNMinAdOnChannel(chStart, [ads[0]], 42.5, 0);

  // Start Scheduled Program manually while Ad is playing (main video is paused at 42.5 or 0 if not ready)
  const duringProg = startScheduledProgramOnChannel(duringAd, 'prog-1', 0, '2026-11-21');
  assert.equal(duringProg.activeEveryNMinAd, null);
  assert.equal(duringProg.activeProgramId, 'prog-1');
  // Kept the original savedMainPlaybackState!
  assert.deepEqual(duringProg.savedMainPlaybackState, { clipIndex: 1, currentTime: 42.5 });
});

test('Live Input -> PNG/Video Every N Min Ad -> preserves savedMainPlaybackState & returns cleanly to Live Input', () => {
  const chLive = createBaseChannel({
    currentClipIndex: 1,
    currentTime: 37.5,
    savedMainPlaybackState: { clipIndex: 1, currentTime: 37.5 },
    liveInput: {
      active: true,
      sourceType: 'm3u8',
      streamUrl: 'https://example.com/live.m3u8',
      playEveryMinAdsOnLive: true,
    },
    everyNMinAds: [
      {
        id: 'png-ad-1',
        title: 'Festival Offer Banner',
        fileName: 'offer_banner.png',
        category: 'COMMERCIAL',
        duration: 15,
        url: '/uploads/offer_banner.png',
        overlayMode: 'logo_only',
        orderIndex: 1,
        enabled: true,
      },
    ],
  });

  // Trigger Ad during Live Input (even if 0 is passed for main, savedMainPlaybackState MUST NOT be overwritten!)
  const duringAd = triggerEveryNMinAdOnChannel(
    chLive,
    chLive.everyNMinAds as EveryNMinAdItem[],
    0,
    0
  );
  assert.equal(duringAd.activeEveryNMinAd?.id, 'png-ad-1');
  assert.equal(duringAd.liveInput?.active, true);
  assert.deepEqual(duringAd.savedMainPlaybackState, { clipIndex: 1, currentTime: 37.5 });

  const afterAd = advanceMainPlaybackOnClipEnd(duringAd, 'ad:png-ad-1:cycle:1');
  assert.equal(afterAd.activeEveryNMinAd, null);
  assert.equal(afterAd.liveInput?.active, true);
  assert.equal(afterAd.status, 'PLAYING');
});

test('resolveDeckResumeTargetSec prioritizes in-place preservation > pendingRef > channel time', () => {
  assert.equal(
    resolveDeckResumeTargetSec({
      preserveCurrentSec: 15.2,
      pendingResumeSeekSec: 10,
      channelTimeSec: 5,
    }),
    15.2
  );
  // Natural Ad/Program end sets channel.currentTime without pendingRef -> resolves channelTimeSec!
  assert.equal(
    resolveDeckResumeTargetSec({
      preserveCurrentSec: null,
      pendingResumeSeekSec: null,
      channelTimeSec: 27.4,
    }),
    27.4
  );
  // Natural clip advance resets channelTimeSec to 0 -> resolves 0!
  assert.equal(
    resolveDeckResumeTargetSec({
      preserveCurrentSec: null,
      pendingResumeSeekSec: null,
      channelTimeSec: 0,
    }),
    0
  );
});

test('shouldKeepExistingVideoFrameInPlace keeps paused interrupted frame but resets ended single-clip loop', () => {
  // Paused at 24.75 after Ad finishes on Main Playlist -> keep in place!
  assert.equal(
    shouldKeepExistingVideoFrameInPlace({
      alreadyHasSameValidSrc: true,
      currentVideoSec: 24.75,
      resumeTargetSec: 24.75,
      isVideoEnded: false,
    }),
    true
  );

  // Single-clip natural end -> must NOT stay at end, must seek to 0!
  assert.equal(
    shouldKeepExistingVideoFrameInPlace({
      alreadyHasSameValidSrc: true,
      currentVideoSec: 60,
      resumeTargetSec: 0,
      isVideoEnded: true,
    }),
    false
  );
});

test('captureDeckPausedTimeSec reads live currentTime and falls back cleanly when unloaded', () => {
  assert.equal(captureDeckPausedTimeSec({ readyState: 4, currentTime: 19.3 }, 5), 19.3);
  assert.equal(captureDeckPausedTimeSec({ readyState: 0, currentTime: 0 }, 11.2), 11.2);
  assert.equal(captureDeckPausedTimeSec(null, 8.5), 8.5);
});

test('getActiveChannelPlaybackTimeSec returns time of active Ad, Program, or Main deck', () => {
  const chMain = createBaseChannel({ currentTime: 22.1 });
  assert.equal(getActiveChannelPlaybackTimeSec(chMain, { readyState: 4, currentTime: 22.8 }), 22.8);

  const chProg = createBaseChannel({
    currentTime: 22.1,
    activeProgramId: 'prog-1',
    activeProgramTime: 9.5,
  });
  assert.equal(getActiveChannelPlaybackTimeSec(chProg, { readyState: 0, currentTime: 0 }), 9.5);
});

test('encodeCompactSlots / decodeCompactSlots round-trips full tracks, empty, custom partial, and non-canonical minutes', () => {
  // 1. Exact track selection -> 0 bytes (empty payload object)
  const fullTracks = ensureDefaultTickedSlots(undefined, [1, 2, 3, 4, 5, 6], '25_55');
  const fullEnc = encodeCompactSlots(fullTracks, [1, 2, 3, 4, 5, 6], '25_55');
  assert.deepEqual(fullEnc, {});
  const fullDec = decodeCompactSlots({ ...fullEnc, selectedTracks: [1, 2, 3, 4, 5, 6], track6Mode: '25_55' });
  assert.deepEqual(new Set(fullDec), new Set(fullTracks));

  // 2. Empty array -> { slotsMask: '' }
  const emptyEnc = encodeCompactSlots([], [1], '25_55');
  assert.deepEqual(emptyEnc, { slotsMask: '' });
  assert.deepEqual(decodeCompactSlots({ ...emptyEnc, selectedTracks: [1] }), []);

  // 3. Partial custom subset + 12_25 mode + non-canonical custom track minute (:07)
  const partialSlots = ['00:00', '05:12', '14:25', '23:55', '09:07'];
  const partEnc = encodeCompactSlots(partialSlots, [1], '12_25');
  assert.equal(typeof partEnc.slotsMask, 'string');
  assert.equal(partEnc.slotsMask?.length, 52);
  assert.deepEqual(partEnc.extraSlots, ['09:07']);
  const partDec = decodeCompactSlots({ ...partEnc, selectedTracks: [1], track6Preset: 'text' });
  assert.deepEqual(new Set(partDec), new Set(partialSlots));
});

test('Backend playout & CG state compaction keeps payloads well below 15 KB while hydrating losslessly', () => {
  const all288 = getAllTracksHHMMs('25_55');
  const defLogos = buildDefaultLogos(1, '#EF4444');
  const heavyChannel = createBaseChannel({
    currentClipIndex: 1,
    currentTime: 44.12345,
    graphics: {
      ...defLogos,
      dskKeyActive: true,
      tickerEnabled: false,
      tickerSpeed: 4,
      tickerTextColor: '#FFFFFF',
      tickerBgColor: '#06080e',
      tickerFontFamily: 'Inter',
      tickerIs3DText: true,
      tickerIsAnimatedBg: true,
      tickerDirection: 'rtl',
      tickerHeight: 'normal',
      tickerItems: [],
      logoEnabled: true,
      logoText: 'ASHOKA HD',
      logoPosition: 'top-right',
      logoOpacity: 0.95,
      logoScale: 1,
      clockEnabled: true,
    },
    everyNMinAds: [1, 2, 3, 4].map((idx) => ({
      id: `ad-heavy-${idx}`,
      title: `Sponsor Spot ${idx}`,
      fileName: `sponsor_${idx}.png`,
      category: 'COMMERCIAL' as const,
      duration: 15,
      url: `/uploads/sponsor_${idx}.png`,
      videoUrl: `/uploads/sponsor_${idx}.png`,
      isTranscoding: false,
      overlayMode: 'logo_only' as const,
      orderIndex: idx,
      enabled: true,
      selectedTracks: [1, 2, 3, 4, 5, 6],
      tickedSlots: idx === 1 ? all288.slice(0, 120) : all288,
    })),
  });

  const compactedEnvelope = compactPlayoutStateEnvelope({
    channels: [heavyChannel],
    everyNMinAds: heavyChannel.everyNMinAds,
    everyNMinEnabled: true,
    everyNMinInterval: 5,
    isLicensed: true,
    updatedAtMs: 1795331655686,
  });

  const envelopeBytes = Buffer.byteLength(JSON.stringify(compactedEnvelope), 'utf-8');
  assert.ok(envelopeBytes < 6000, `Expected compact playout envelope < 6 KB, got ${envelopeBytes} bytes`);
  assert.equal((compactedEnvelope as any).everyNMinAds, undefined);

  const hydrated = hydrateCompactChannel(compactedEnvelope.channels[0]);
  assert.equal(hydrated.everyNMinAds.length, 4);
  assert.deepEqual(new Set(hydrated.everyNMinAds[0].tickedSlots), new Set(all288.slice(0, 120)));
  assert.deepEqual(new Set(hydrated.everyNMinAds[1].tickedSlots), new Set(all288));
  assert.ok(hydrated.graphics.channelLogo.url.startsWith('data:image/svg+xml'));
  assert.equal(hydrated.graphics.sponsor1Logo.id, hydrated.graphics.sponsorLogo1.id);

  const compactedCg = compactCgStatePayload({
    updatedAtMs: 1795331661223,
    channelId: 1,
    graphics: heavyChannel.graphics,
  });
  const cgBytes = Buffer.byteLength(JSON.stringify(compactedCg), 'utf-8');
  assert.ok(cgBytes < 3000, `Expected compact CG state < 3 KB, got ${cgBytes} bytes`);
});

test('buildBroadcastChannelPayload explicitly emits null/empty mode fields through JSON.stringify + hydrateCompactChannel', () => {
  const chMainOnly = createBaseChannel({
    status: 'PLAYING',
    currentClipIndex: 1,
    currentTime: 14.5,
    activeProgramId: null,
    activeProgramClipIndex: 0,
    activeProgramTime: 0,
    activeEveryNMinAd: null,
    everyNMinQueue: [],
    everyNMinTime: 0,
    liveInput: undefined,
  });

  const wirePayload = buildBroadcastChannelPayload(chMainOnly);
  const parsed = JSON.parse(JSON.stringify(wirePayload));

  assert.equal('activeProgramId' in parsed, true);
  assert.equal(parsed.activeProgramId, null);
  assert.equal('activeEveryNMinAd' in parsed, true);
  assert.equal(parsed.activeEveryNMinAd, null);
  assert.equal('liveInput' in parsed, true);
  assert.equal(parsed.liveInput, null);
  assert.deepEqual(parsed.everyNMinQueue, []);

  const hydrated = hydrateCompactChannel(parsed);
  assert.equal(hydrated.activeProgramId, null);
  assert.equal(hydrated.activeEveryNMinAd, null);
  assert.equal(hydrated.liveInput, null);
  assert.deepEqual(hydrated.everyNMinQueue, []);
});

test('advanceMainPlaybackOnClipEnd ignores stale :cycle: key even when clip id matches active ad', () => {
  const chBase = createBaseChannel({ currentClipIndex: 0, currentTime: 10, loopCycle: 4 });
  const ads = chBase.everyNMinAds as EveryNMinAdItem[];
  const duringAdCycle5 = triggerEveryNMinAdOnChannel(chBase, [ads[0]], 10, 0);
  // Expect loopCycle === 5 for active cycle key `ad:ad-1:cycle:5`
  assert.equal(duringAdCycle5.loopCycle, 5);
  assert.equal(duringAdCycle5.activeEveryNMinAd?.id, 'ad-1');

  // Delayed clip-end event from an earlier cycle (same clip id `ad-1`, old cycle 2) MUST be ignored!
  const ignoredStale = advanceMainPlaybackOnClipEnd(duringAdCycle5, 'ad:ad-1:cycle:2');
  assert.equal(ignoredStale.activeEveryNMinAd?.id, 'ad-1');
  assert.equal(ignoredStale.loopCycle, 5);

  // Matching cycle key advances and exits ad cleanly!
  const acceptedCurrent = advanceMainPlaybackOnClipEnd(duringAdCycle5, 'ad:ad-1:cycle:5');
  assert.equal(acceptedCurrent.activeEveryNMinAd, null);
  assert.equal(acceptedCurrent.currentTime, 10);
});

import {
  needsBackendTranscodeFallback,
  shouldSkipUnplayableClip,
  computeFastPlaylistSignature,
} from './playoutPlaybackEngine';

test('needsBackendTranscodeFallback identifies .mpeg and legacy formats, while leaving standard .mp4 native until error', () => {
  assert.equal(needsBackendTranscodeFallback('old_news.mpeg'), true);
  assert.equal(needsBackendTranscodeFallback('/uploads/movie.MPG?v=1'), true);
  assert.equal(needsBackendTranscodeFallback('cam_tape.avi'), true);
  assert.equal(needsBackendTranscodeFallback('broadcast.vob'), true);
  assert.equal(needsBackendTranscodeFallback('modern_hd.mp4'), false);
  assert.equal(needsBackendTranscodeFallback('overlay.swf'), false);
});

test('shouldSkipUnplayableClip stops safely when all enabled clips fail consecutively', () => {
  assert.equal(shouldSkipUnplayableClip(1, 1), false);
  assert.equal(shouldSkipUnplayableClip(1, 3), true);
  assert.equal(shouldSkipUnplayableClip(2, 3), true);
  assert.equal(shouldSkipUnplayableClip(3, 3), false);
});

test('computeFastPlaylistSignature hashes 5000+ clips in O(1) under 2ms', () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({
    id: `v-${i}`,
    enabled: true,
    duration: 120,
    serverUrl: i === 0 ? '/uploads/v0.mp4' : undefined,
  }));
  const t0 = Date.now();
  const sig1 = computeFastPlaylistSignature(big, 0);
  big[2500].duration = 999;
  const sig2 = computeFastPlaylistSignature(big, 0);
  const sig3 = computeFastPlaylistSignature(big, 1);
  const dt = Date.now() - t0;
  assert.notEqual(sig1, sig2);
  assert.notEqual(sig2, sig3);
  assert.ok(dt < 20, `Expected <20ms, got ${dt}ms`);
});



