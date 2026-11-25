import { TVChannel, LShapeConfig, EveryNMinAdItem } from '../types/playout';
import { swfEngine } from '../services/swfEngine';
import { compactChannel } from './stateCompactor';

export interface VideoDeckSnapshot {
  readyState: number;
  currentTime: number;
}

/**
 * Reads an accurate paused timestamp from a HTMLVideoElement when loaded, falling back cleanly
 * to the tracked channel state timestamp when metadata is not yet ready or video is SWF/stream.
 */
export function captureDeckPausedTimeSec(
  videoEl: VideoDeckSnapshot | null | undefined,
  fallbackSec: number = 0
): number {
  const safeFallback =
    typeof fallbackSec === 'number' && Number.isFinite(fallbackSec) && fallbackSec > 0
      ? fallbackSec
      : 0;
  if (
    videoEl &&
    videoEl.readyState >= 1 &&
    typeof videoEl.currentTime === 'number' &&
    Number.isFinite(videoEl.currentTime) &&
    videoEl.currentTime >= 0
  ) {
    return videoEl.currentTime > 0 ? videoEl.currentTime : safeFallback;
  }
  return safeFallback;
}

/**
 * Resolves the target playback seek offset when loading or resuming a deck:
 * 1. Explicit in-place preservation (URL hydration / decoder upgrade)
 * 2. Pending one-shot resume seek ref
 * 3. Persisted channel timestamp (e.g. currentTime or activeProgramTime set on Ad/Program exit)
 */
export function resolveDeckResumeTargetSec(opts: {
  preserveCurrentSec?: number | null;
  pendingResumeSeekSec?: number | null;
  channelTimeSec?: number | null;
}): number {
  const { preserveCurrentSec, pendingResumeSeekSec, channelTimeSec } = opts;
  if (
    typeof preserveCurrentSec === 'number' &&
    Number.isFinite(preserveCurrentSec) &&
    preserveCurrentSec > 0
  ) {
    return preserveCurrentSec;
  }
  if (
    typeof pendingResumeSeekSec === 'number' &&
    Number.isFinite(pendingResumeSeekSec) &&
    pendingResumeSeekSec > 0
  ) {
    return pendingResumeSeekSec;
  }
  if (
    typeof channelTimeSec === 'number' &&
    Number.isFinite(channelTimeSec) &&
    channelTimeSec > 0
  ) {
    return channelTimeSec;
  }
  return 0;
}

/**
 * Determines whether an already-loaded HTMLVideoElement sitting paused at the interrupted frame
 * should stay in-place instead of seeking or reloading (preventing 00:00 restarts or keyframe stalls).
 */
export function shouldKeepExistingVideoFrameInPlace(opts: {
  alreadyHasSameValidSrc: boolean;
  currentVideoSec: number;
  resumeTargetSec: number;
  isVideoEnded?: boolean;
}): boolean {
  const { alreadyHasSameValidSrc, currentVideoSec, resumeTargetSec, isVideoEnded } = opts;
  if (!alreadyHasSameValidSrc || isVideoEnded) return false;
  if (!(typeof resumeTargetSec === 'number' && Number.isFinite(resumeTargetSec) && resumeTargetSec > 0.05)) {
    return false;
  }
  if (!(typeof currentVideoSec === 'number' && Number.isFinite(currentVideoSec) && currentVideoSec > 0.05)) {
    return false;
  }
  return Math.abs(currentVideoSec - resumeTargetSec) < 2.5;
}

/**
 * Returns the real-time active deck playback time in seconds across Ad, Program, and Main Playlist.
 */
export function getActiveChannelPlaybackTimeSec(
  ch: TVChannel,
  activeVideoEl?: VideoDeckSnapshot | null
): number {
  if (ch.activeEveryNMinAd) {
    return captureDeckPausedTimeSec(activeVideoEl, ch.everyNMinTime || 0);
  }
  if (ch.activeProgramId) {
    return captureDeckPausedTimeSec(activeVideoEl, ch.activeProgramTime || 0);
  }
  return captureDeckPausedTimeSec(activeVideoEl, ch.currentTime || 0);
}

/**
 * Transitions a channel into a Scheduled Program while preserving the paused Main Playlist position.
 * Clears any active Every N Min Ad overlay without losing an already-saved Main Playlist checkpoint.
 */
export function startScheduledProgramOnChannel(
  ch: TVChannel,
  programId: string,
  pausedMainSec: number,
  todayStr: string,
  forceEnableFirstClip: boolean = false
): TVChannel {
  const targetProg = (ch.scheduledPrograms || []).find((p) => p.id === programId);
  if (!targetProg) return ch;

  let firstEnabledClipIdx = targetProg.playlist.findIndex((cl) => cl.enabled !== false);
  const needForceEnableFirst =
    forceEnableFirstClip && firstEnabledClipIdx === -1 && targetProg.playlist.length > 0;
  if (needForceEnableFirst) {
    firstEnabledClipIdx = 0;
  }
  if (firstEnabledClipIdx === -1) return ch;

  const firstClip = targetProg.playlist[firstEnabledClipIdx];
  if (
    firstClip &&
    swfEngine.isSwfUrl(firstClip.url, firstClip.fileName || firstClip.title)
  ) {
    swfEngine.restartSwf(firstClip.url);
  }

  // If Main Playlist was active (neither Program, Ad, nor Live Input already active), pause-save its exact timestamp
  const preservedMainState =
    ch.activeProgramId || ch.activeEveryNMinAd || ch.liveInput?.active
      ? ch.savedMainPlaybackState ||
        (ch.liveInput?.active
          ? undefined
          : {
              clipIndex: ch.currentClipIndex,
              currentTime: pausedMainSec > 0 ? pausedMainSec : ch.currentTime || 0,
            })
      : {
          clipIndex: ch.currentClipIndex,
          currentTime: pausedMainSec,
        };

  return {
    ...ch,
    status: 'PLAYING',
    loopCycle: (ch.loopCycle || 0) + 1,
    activeEveryNMinAd: null,
    everyNMinQueue: [],
    everyNMinTime: 0,
    activeProgramId: programId,
    activeProgramClipIndex: firstEnabledClipIdx,
    activeProgramTime: 0,
    savedProgramPlaybackState: null,
    savedMainPlaybackState: preservedMainState,
    scheduledPrograms: (ch.scheduledPrograms || []).map((p) =>
      p.id === programId
        ? {
            ...p,
            enabled: true,
            playlist: needForceEnableFirst
              ? p.playlist.map((cl, idx) => (idx === 0 ? { ...cl, enabled: true } : cl))
              : p.playlist,
            status: 'playing',
            lastTriggeredDate: todayStr,
          }
        : p
    ),
  };
}

/**
 * Transitions a channel into an Every N Min Commercial Ad break while preserving the exact paused
 * clip & timestamp of either an active Scheduled Program OR the Main Playlist.
 */
export function triggerEveryNMinAdOnChannel(
  ch: TVChannel,
  queueToPlay: EveryNMinAdItem[],
  pausedMainSec: number,
  pausedProgSec: number
): TVChannel {
  if (!queueToPlay || queueToPlay.length === 0) return ch;
  const [firstAd, ...restQueue] = queueToPlay;
  if (swfEngine.isSwfUrl(firstAd.url, firstAd.fileName || firstAd.title)) {
    swfEngine.restartSwf(firstAd.url);
  }

  const heldLShape =
    ch.lShape && ch.lShape.enabled
      ? {
          ...ch.lShape,
          periodicActive: false,
          pendingAfterAd:
            ch.lShape.periodicActive !== false ? true : Boolean(ch.lShape.pendingAfterAd),
          currentTime: 0,
        }
      : ch.lShape;

  return {
    ...ch,
    status: 'PLAYING',
    loopCycle: (ch.loopCycle || 0) + 1,
    activeEveryNMinAd: firstAd,
    everyNMinQueue: restQueue,
    everyNMinTime: 0,
    lShape: heldLShape,
    savedProgramPlaybackState:
      !ch.activeEveryNMinAd && ch.activeProgramId
        ? {
            programId: ch.activeProgramId,
            clipIndex: ch.activeProgramClipIndex || 0,
            currentTime: pausedProgSec,
          }
        : ch.savedProgramPlaybackState,
    savedMainPlaybackState:
      ch.activeEveryNMinAd || ch.activeProgramId || ch.liveInput?.active
        ? ch.savedMainPlaybackState
        : {
            clipIndex: ch.currentClipIndex,
            currentTime: pausedMainSec,
          },
  };
}

// Computes unique cycle key for active playing clip across Main Playlist, Scheduled Program, or Every N Min Ad
export function getActivePlaybackCycleKey(c: TVChannel): string {
  const activeAd = c.activeEveryNMinAd;
  const activeProg = c.activeProgramId
    ? (c.scheduledPrograms || []).find((p) => p.id === c.activeProgramId)
    : undefined;
  const clip = c.playlist[c.currentClipIndex];
  const clipBaseId = activeAd
    ? `ad:${activeAd.id}`
    : activeProg
    ? `prog:${activeProg.id}:${c.activeProgramClipIndex || 0}`
    : `main:${clip?.id || ''}:${c.currentClipIndex}`;
  return `${clipBaseId}:cycle:${c.loopCycle || 0}`;
}

// Pure, idempotent state updater to transition to the next video when a clip finishes
export function advanceMainPlaybackOnClipEnd(
  c: TVChannel,
  expectedCycleKey?: string,
  randSeed: number = 0.5
): TVChannel {
  const currentCycleKey = getActivePlaybackCycleKey(c);
  const activeAd = c.activeEveryNMinAd;
  const activeProg = c.activeProgramId
    ? (c.scheduledPrograms || []).find((p) => p.id === c.activeProgramId)
    : undefined;
  const activeClip = activeAd
    ? activeAd
    : activeProg
    ? activeProg.playlist[c.activeProgramClipIndex || 0]
    : c.playlist[c.currentClipIndex];

  // Flexible cycle key matching: when both expected & current carry explicit ':cycle:N' suffixes, require exact cycle match
  if (expectedCycleKey) {
    const hasExpectedCycle = expectedCycleKey.includes(':cycle:');
    const basePrefix = currentCycleKey.split(':cycle:')[0];
    const isMatch =
      expectedCycleKey === currentCycleKey ||
      (!hasExpectedCycle && expectedCycleKey.startsWith(basePrefix)) ||
      (activeClip?.id && expectedCycleKey === activeClip.id) ||
      (activeClip?.title && expectedCycleKey === activeClip.title);
    if (!isMatch) {
      return c;
    }
  }

  const nextCycle = (c.loopCycle || 0) + 1;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;

  // 1. If an Every N Min Commercial Ad just finished playing:
  if (c.activeEveryNMinAd) {
    const queue = (c.everyNMinQueue || []).filter((q) => q && q.enabled !== false);
    if (queue.length > 0) {
      const [nextAd, ...remainingQueue] = queue;
      if (swfEngine.isSwfUrl(nextAd.url, nextAd.fileName || nextAd.title)) {
        swfEngine.restartSwf(nextAd.url);
      }
      return {
        ...c,
        status: 'PLAYING',
        loopCycle: nextCycle,
        activeEveryNMinAd: nextAd,
        everyNMinQueue: remainingQueue,
        everyNMinTime: 0,
      };
    }

    // Ad break finished! Resume L-Shape if queued
    const shouldActivateLShapeAfterAd = Boolean(
      c.lShape?.enabled &&
        (c.lShape.playlist?.length || 0) > 0 &&
        c.lShape.pendingAfterAd
    );
    const resumedLShape: LShapeConfig | undefined = c.lShape
      ? {
          ...c.lShape,
          periodicActive: shouldActivateLShapeAfterAd ? true : c.lShape.periodicActive,
          pendingAfterAd: false,
          currentTime: shouldActivateLShapeAfterAd ? 0 : c.lShape.currentTime || 0,
          periodicCounter: shouldActivateLShapeAfterAd ? 0 : c.lShape.periodicCounter || 0,
        }
      : c.lShape;

    // If Every N Min Ad interrupted an active Program Playlist, resume the Program Playlist from its paused timestamp:
    const savedProg = c.savedProgramPlaybackState;
    const targetSavedProg = savedProg
      ? (c.scheduledPrograms || []).find(
          (p) => p.id === savedProg.programId && p.enabled !== false
        )
      : undefined;
    if (savedProg && targetSavedProg) {
      const enabledProgIndices = targetSavedProg.playlist
        .map((cl, idx) => (cl.enabled !== false ? idx : -1))
        .filter((idx) => idx >= 0);
      if (enabledProgIndices.length > 0) {
        const safeProgClipIdx =
          targetSavedProg.playlist[savedProg.clipIndex]?.enabled !== false
            ? savedProg.clipIndex
            : enabledProgIndices.find((idx) => idx >= savedProg.clipIndex) ??
              enabledProgIndices[0];
        const resumeProgTime =
          safeProgClipIdx === savedProg.clipIndex ? savedProg.currentTime : 0;
        const resumedProgClip = targetSavedProg.playlist[safeProgClipIdx];
        if (
          resumedProgClip &&
          swfEngine.isSwfUrl(
            resumedProgClip.url,
            resumedProgClip.fileName || resumedProgClip.title
          )
        ) {
          swfEngine.resumeSwfAt(resumedProgClip.url, resumeProgTime);
        }
        return {
          ...c,
          status: 'PLAYING',
          loopCycle: nextCycle,
          activeEveryNMinAd: null,
          everyNMinQueue: [],
          everyNMinTime: 0,
          activeProgramId: savedProg.programId,
          activeProgramClipIndex: safeProgClipIdx,
          activeProgramTime: resumeProgTime,
          savedProgramPlaybackState: null,
          lShape: resumedLShape,
        };
      }
    }

    // Resume Main Playlist from saved paused position:
    const saved = c.savedMainPlaybackState;
    const enabledMainIndices = c.playlist
      .map((cl, idx) => (cl.enabled !== false ? idx : -1))
      .filter((idx) => idx >= 0);
    let safeSavedIdx =
      saved && c.playlist.length > 0
        ? Math.max(0, Math.min(c.playlist.length - 1, saved.clipIndex))
        : c.currentClipIndex;
    let resumeMainTime = saved ? saved.currentTime : c.currentTime;
    if (enabledMainIndices.length > 0 && c.playlist[safeSavedIdx]?.enabled === false) {
      safeSavedIdx =
        enabledMainIndices.find((idx) => idx > safeSavedIdx) ?? enabledMainIndices[0];
      resumeMainTime = 0;
    }
    const resumedMainClip = c.playlist[safeSavedIdx];
    if (
      resumedMainClip &&
      swfEngine.isSwfUrl(
        resumedMainClip.url,
        resumedMainClip.fileName || resumedMainClip.title
      )
    ) {
      swfEngine.resumeSwfAt(resumedMainClip.url, resumeMainTime);
    }
    const hasAnyPlayable =
      enabledMainIndices.length > 0 ||
      Boolean(c.activeProgramId) ||
      Boolean(c.liveInput?.active) ||
      (c.scheduledPrograms || []).some(
        (p) => p.enabled !== false && p.playlist.some((cl) => cl.enabled !== false)
      );

    return {
      ...c,
      loopCycle: nextCycle,
      activeEveryNMinAd: null,
      everyNMinQueue: [],
      everyNMinTime: 0,
      currentClipIndex: safeSavedIdx,
      currentTime: resumeMainTime,
      savedMainPlaybackState: null,
      lShape: resumedLShape,
      status: hasAnyPlayable ? 'PLAYING' : 'STOPPED',
    };
  }

  // 2. If a Scheduled Program clip just finished playing its FULL duration:
  if (c.activeProgramId) {
    const progs = c.scheduledPrograms || [];
    const activeProgIdx = progs.findIndex((p) => p.id === c.activeProgramId);
    const activeProg = activeProgIdx >= 0 ? progs[activeProgIdx] : undefined;
    const curProgClipIdx = c.activeProgramClipIndex || 0;

    let nextEnabledProgClipIdx = -1;
    if (activeProg && activeProg.enabled !== false && activeProg.playlist.length > 0) {
      for (let i = curProgClipIdx + 1; i < activeProg.playlist.length; i++) {
        if (activeProg.playlist[i]?.enabled !== false) {
          nextEnabledProgClipIdx = i;
          break;
        }
      }
    }

    if (activeProg && nextEnabledProgClipIdx >= 0) {
      const nextProgClip = activeProg.playlist[nextEnabledProgClipIdx];
      if (nextProgClip && swfEngine.isSwfUrl(nextProgClip.url, nextProgClip.fileName || nextProgClip.title)) {
        swfEngine.restartSwf(nextProgClip.url);
      }
      return {
        ...c,
        status: 'PLAYING',
        loopCycle: nextCycle,
        activeProgramClipIndex: nextEnabledProgClipIdx,
        activeProgramTime: 0,
      };
    }

    // Program finished all its enabled clips! Mark completed/triggered today & resume Main Playlist at exact paused position:
    const updatedProgs = progs.map((p) => {
      if (p.id !== c.activeProgramId) return p;
      const isOneTimeProg =
        p.scheduleType === 'one_time' || p.scheduleType === 'once' || !p.scheduleType;
      return {
        ...p,
        status: isOneTimeProg ? ('completed' as const) : ('scheduled' as const),
        completed: isOneTimeProg,
        lastTriggeredDate: todayStr,
      };
    });

    const saved = c.savedMainPlaybackState;
    const enabledMainIndices = c.playlist
      .map((cl, idx) => (cl.enabled !== false ? idx : -1))
      .filter((idx) => idx >= 0);
    let safeMainIdx =
      saved && c.playlist.length > 0
        ? Math.max(0, Math.min(c.playlist.length - 1, saved.clipIndex))
        : Math.max(0, Math.min(Math.max(0, c.playlist.length - 1), c.currentClipIndex));
    let resumeMainTime = saved ? saved.currentTime : 0;
    if (enabledMainIndices.length > 0 && c.playlist[safeMainIdx]?.enabled === false) {
      safeMainIdx =
        enabledMainIndices.find((idx) => idx > safeMainIdx) ?? enabledMainIndices[0];
      resumeMainTime = 0;
    }
    const resumedMainClip = c.playlist[safeMainIdx];
    if (resumedMainClip && swfEngine.isSwfUrl(resumedMainClip.url, resumedMainClip.fileName || resumedMainClip.title)) {
      swfEngine.resumeSwfAt(resumedMainClip.url, resumeMainTime);
    }

    return {
      ...c,
      loopCycle: nextCycle,
      activeProgramId: null,
      activeProgramClipIndex: 0,
      activeProgramTime: 0,
      savedProgramPlaybackState: null,
      currentClipIndex: safeMainIdx,
      currentTime: resumeMainTime,
      savedMainPlaybackState: null,
      status: enabledMainIndices.length > 0 || c.liveInput?.active ? 'PLAYING' : 'STOPPED',
      scheduledPrograms: updatedProgs,
    };
  }

  // 3. Standard Main Channel Playlist clip ended:
  const candidateIndices = c.playlist
    .map((it, idx) => (it && it.enabled !== false ? idx : -1))
    .filter((idx) => idx >= 0);

  if (candidateIndices.length === 0) {
    return { ...c, status: 'STOPPED', currentTime: 0 };
  }

  const currentItem = c.playlist[c.currentClipIndex];
  let nextIdx = candidateIndices[0];
  let nextPlayedIds = [...(c.playedClipIds || [])];
  if (currentItem?.id && currentItem.enabled !== false && !nextPlayedIds.includes(currentItem.id)) {
    nextPlayedIds.push(currentItem.id);
  }

  if (c.shuffle && candidateIndices.length > 1) {
    let unplayedIndices = candidateIndices.filter((idx) => {
      const id = c.playlist[idx]?.id;
      return id && !nextPlayedIds.includes(id) && idx !== c.currentClipIndex;
    });
    if (unplayedIndices.length === 0) {
      if (c.loopMode === 'off') {
        return {
          ...c,
          status: 'STOPPED',
          loopCycle: nextCycle,
          currentClipIndex: candidateIndices[0],
          currentTime: 0,
          playedClipIds: [],
        };
      }
      nextPlayedIds = [];
      unplayedIndices = candidateIndices.filter((idx) => idx !== c.currentClipIndex);
    }
    const pickPos = Math.min(
      unplayedIndices.length - 1,
      Math.floor(Math.max(0, Math.min(0.999999, randSeed)) * unplayedIndices.length)
    );
    const pickedIdx = unplayedIndices[pickPos] ?? candidateIndices[0];
    nextIdx = pickedIdx;
    const pickedId = c.playlist[nextIdx]?.id;
    if (pickedId && !nextPlayedIds.includes(pickedId)) {
      nextPlayedIds.push(pickedId);
    }
  } else {
    // Sequential playback across enabled items: 1st Enabled Video -> 2nd Enabled Video -> ...
    const nextAfterCurrent = candidateIndices.find((idx) => idx > c.currentClipIndex);
    if (nextAfterCurrent !== undefined) {
      nextIdx = nextAfterCurrent;
    } else {
      // Reached end of Main Playlist enabled items
      if (c.loopMode === 'off') {
        return {
          ...c,
          status: 'STOPPED',
          loopCycle: nextCycle,
          currentClipIndex: candidateIndices[0],
          currentTime: 0,
          playedClipIds: [],
        };
      }
      nextIdx = candidateIndices[0];
      nextPlayedIds = [];
    }
  }

  const nextMainClip = c.playlist[nextIdx];
  if (nextMainClip && swfEngine.isSwfUrl(nextMainClip.url, nextMainClip.fileName || nextMainClip.title)) {
    swfEngine.restartSwf(nextMainClip.url);
  }

  return {
    ...c,
    status: 'PLAYING',
    loopCycle: nextCycle,
    currentClipIndex: nextIdx,
    currentTime: 0,
    playedClipIds: nextPlayedIds,
  };
}

// Builds a safe cloneable payload for BroadcastChannel & /api/playout/live-sync synchronization across windows
export function buildBroadcastChannelPayload(ch: TVChannel): any {
  if (!ch) return ch;
  const sanitizeClip = (cl: any) => {
    if (!cl) return cl;
    const { file, ...rest } = cl;
    const rawUrl = String(rest.serverUrl || rest.videoUrl || rest.url || '');
    const nameHint = String(rest.fileName || rest.title || rest.label || '').trim();
    const fallbackByName = nameHint ? `/api/media/by-name/${encodeURIComponent(nameHint)}` : '';
    const safeServerUrl =
      rest.serverUrl ||
      (!rawUrl.startsWith('blob:') && !rawUrl.startsWith('data:') && rawUrl
        ? rawUrl
        : fallbackByName);
    return {
      ...rest,
      serverUrl: safeServerUrl || rest.serverUrl,
    };
  };

  const prepared = {
    ...ch,
    status: ch.status || 'STOPPED',
    currentClipIndex: ch.currentClipIndex || 0,
    currentTime: ch.currentTime || 0,
    loopCycle: ch.loopCycle || 0,
    activeProgramId: ch.activeProgramId ?? null,
    activeProgramClipIndex: ch.activeProgramClipIndex ?? 0,
    activeProgramTime: ch.activeProgramTime ?? 0,
    everyNMinTime: ch.everyNMinTime ?? 0,
    everyNMinQueue: Array.isArray(ch.everyNMinQueue) ? ch.everyNMinQueue.map(sanitizeClip) : [],
    liveInput: ch.liveInput ? { ...ch.liveInput } : null,
    playbackContext:
      ch.playbackContext ??
      (ch.activeEveryNMinAd
        ? 'everyNMinAd'
        : ch.activeProgramId
        ? 'program'
        : ch.liveInput?.active
        ? 'live'
        : 'main'),
    playlist: (ch.playlist || []).map(sanitizeClip),
    scheduledPrograms: (ch.scheduledPrograms || []).map((p) => ({
      ...p,
      playlist: (p.playlist || []).map(sanitizeClip),
    })),
    everyNMinAds: (ch.everyNMinAds || []).map(sanitizeClip),
    activeEveryNMinAd: ch.activeEveryNMinAd ? sanitizeClip(ch.activeEveryNMinAd) : null,
    savedMainPlaybackState: ch.savedMainPlaybackState
      ? {
          clipIndex: ch.savedMainPlaybackState.clipIndex,
          currentTime: ch.savedMainPlaybackState.currentTime,
        }
      : null,
    savedProgramPlaybackState: ch.savedProgramPlaybackState
      ? {
          programId: ch.savedProgramPlaybackState.programId,
          clipIndex: ch.savedProgramPlaybackState.clipIndex,
          currentTime: ch.savedProgramPlaybackState.currentTime,
        }
      : null,
    bottomOverlay: ch.bottomOverlay
      ? {
          ...ch.bottomOverlay,
          playlist: (ch.bottomOverlay.playlist || []).map(sanitizeClip),
        }
      : ch.bottomOverlay,
    topOverlay: ch.topOverlay
      ? {
          ...ch.topOverlay,
          playlist: (ch.topOverlay.playlist || []).map(sanitizeClip),
        }
      : ch.topOverlay,
    lShape: ch.lShape
      ? {
          ...ch.lShape,
          playlist: (ch.lShape.playlist || []).map(sanitizeClip),
        }
      : ch.lShape,
    graphics: (() => {
      const g: any = { ...ch.graphics };
      const cleanLogo = (logo: any) => {
        if (!logo) return logo;
        const { file, ...rest } = logo;
        const rawUrl = String(rest.serverUrl || rest.url || '');
        const nameHint = String(rest.fileName || rest.label || '').trim();
        if (rawUrl.startsWith('blob:') && !rest.serverUrl && nameHint) {
          rest.serverUrl = `/api/media/by-name/${encodeURIComponent(nameHint)}`;
        }
        if (Array.isArray(rest.playlist)) {
          rest.playlist = rest.playlist.map(sanitizeClip);
        }
        return rest;
      };
      g.channelLogo = cleanLogo(g.channelLogo);
      g.sponsorLogo1 = cleanLogo(g.sponsorLogo1);
      g.sponsorLogo2 = cleanLogo(g.sponsorLogo2);
      g.sponsorLogo3 = cleanLogo(g.sponsorLogo3);
      g.sponsorLogo4 = cleanLogo(g.sponsorLogo4);
      return g;
    })(),
  };

  return compactChannel(prepared, { keepActiveLiveState: true });
}

const LEGACY_TRANSCODE_EXTS = new Set([
  'mpeg',
  'mpg',
  'm2v',
  'mpv',
  'vob',
  'ts',
  'm2ts',
  'mts',
  'avi',
  'mkv',
  'wmv',
  'flv',
  'f4v',
  'asf',
  'divx',
  'xvid',
  'rm',
  'rmvb',
  'mxf',
  '3gp',
  '3g2',
  'dat',
  'dv',
  'ogv',
  'hdv',
  'tod',
  'mod',
  'trp',
  'tp',
  'evo',
  'wtv',
]);

/**
 * Returns true for legacy/container video extensions (.mpeg, .mpg, .vob, .avi, .mkv, etc.)
 * that browsers rarely decode natively and should be routed through server FFmpeg H.264/AAC transcoding.
 */
export function needsBackendTranscodeFallback(fileNameOrUrl?: string): boolean {
  const clean = String(fileNameOrUrl || '').trim().toLowerCase().split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = clean.slice(dot + 1);
  return LEGACY_TRANSCODE_EXTS.has(ext);
}

/**
 * Guards against infinite ping-pong auto-skip loops when all enabled clips in a playlist are corrupt.
 */
export function shouldSkipUnplayableClip(
  failedCountInSequence: number,
  enabledClipCount: number
): boolean {
  if (enabledClipCount <= 1) return false;
  return failedCountInSequence < enabledClipCount;
}

/**
 * Computes an O(1) structural fingerprint for huge playlists (5,000+ items) so 1Hz effects
 * never freeze the UI thread calling JSON.stringify(playlist).
 */
export function computeFastPlaylistSignature(
  playlist: Array<{ id?: string; url?: string; enabled?: boolean; duration?: number; serverUrl?: string }> | undefined | null,
  activeIndex: number = 0
): string {
  const list = Array.isArray(playlist) ? playlist : [];
  const len = list.length;
  if (len === 0) return '0';
  const first = list[0];
  const mid = list[Math.floor(len / 2)];
  const last = list[len - 1];
  const active = list[Math.max(0, Math.min(len - 1, activeIndex || 0))];
  const itemSig = (it: any) =>
    `${it?.id || ''}:${it?.enabled !== false ? 1 : 0}:${Math.round(it?.duration || 0)}:${Boolean(it?.serverUrl)}`;
  return `${len}|${activeIndex}|${itemSig(first)}|${itemSig(active)}|${itemSig(mid)}|${itemSig(last)}`;
}

