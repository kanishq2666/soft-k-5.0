import { decodeCompactSlots, encodeCompactSlots } from './adTrackingTracks';
import {
  buildDefaultLogos,
  createChannelLogoSvg,
  createSponsor1LogoSvg,
  createSponsor2LogoSvg,
} from './defaultLogos';

function round2(n: any): any {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}

export function isDefaultLogoSvgUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('data:image/svg+xml')) return false;
  // Detect generated default channel/sponsor SVGs from defaultLogos.ts
  return (
    (url.includes('LIVE%20ON%20AIR') && url.includes('1080p%20DVB')) ||
    url.includes('TITLE%20SPONSOR%201') ||
    url.includes('POWERED%20BY%20SPONSOR%202') ||
    url.includes('LIVE ON AIR') ||
    url.includes('TITLE SPONSOR 1') ||
    url.includes('POWERED BY SPONSOR 2')
  );
}

export function compactMediaItem(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const out: Record<string, any> = {};

  for (const [k, v] of Object.entries(item)) {
    if (k === 'file') continue;
    if (k === 'tickedSlots' || k === 'slotsMask' || k === 'extraSlots') continue;
    if (k === 'isTranscoding' && v === false) continue;
    if (v === undefined) continue;
    out[k] = v;
  }

  // Deduplicate identical url/videoUrl/imageUrl/serverUrl copies
  const primaryUrl = typeof out.url === 'string' ? out.url : '';
  if (primaryUrl) {
    if (out.videoUrl === primaryUrl) delete out.videoUrl;
    if (out.imageUrl === primaryUrl) delete out.imageUrl;
    if (out.serverUrl === primaryUrl) delete out.serverUrl;
  }

  if (typeof out.duration === 'number') out.duration = round2(out.duration);
  if (typeof out.elapsedSec === 'number') out.elapsedSec = round2(out.elapsedSec);

  if (Array.isArray(item.tickedSlots) || typeof item.slotsMask === 'string') {
    const slots = Array.isArray(item.tickedSlots)
      ? item.tickedSlots
      : decodeCompactSlots({
          slotsMask: item.slotsMask,
          extraSlots: item.extraSlots,
          selectedTracks: item.selectedTracks,
          track6Mode: item.track6Mode,
          track6Preset: item.track6Preset,
          customTracks: item.customTracks,
        });
    const encoded = encodeCompactSlots(
      slots,
      item.selectedTracks,
      item.track6Preset || item.track6Mode,
      item.customTracks
    );
    if (typeof encoded.slotsMask === 'string') out.slotsMask = encoded.slotsMask;
    if (Array.isArray(encoded.extraSlots) && encoded.extraSlots.length > 0) {
      out.extraSlots = encoded.extraSlots;
    }
  }

  return out;
}

export function compactOverlayConfig(overlay: any): any {
  if (!overlay || typeof overlay !== 'object') return overlay;
  const out: Record<string, any> = { ...overlay };
  if (typeof out.currentTime === 'number') out.currentTime = round2(out.currentTime);
  if (Array.isArray(out.playlist)) {
    out.playlist = out.playlist.map(compactMediaItem);
  }
  return out;
}

export function compactLShapeConfig(lShape: any): any {
  if (!lShape || typeof lShape !== 'object') return lShape;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(lShape)) {
    if (k === 'file' || k === 'tickedSlots' || k === 'slotsMask' || k === 'extraSlots') continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  if (typeof out.currentTime === 'number') out.currentTime = round2(out.currentTime);
  if (Array.isArray(out.playlist)) {
    out.playlist = out.playlist.map(compactMediaItem);
  }
  if (Array.isArray(lShape.tickedSlots) || typeof lShape.slotsMask === 'string') {
    const slots = Array.isArray(lShape.tickedSlots)
      ? lShape.tickedSlots
      : decodeCompactSlots({
          slotsMask: lShape.slotsMask,
          extraSlots: lShape.extraSlots,
          selectedTracks: lShape.selectedTracks,
          track6Mode: lShape.track6Mode,
          track6Preset: lShape.track6Preset,
          customTracks: lShape.customTracks,
        });
    const encoded = encodeCompactSlots(
      slots,
      lShape.selectedTracks,
      lShape.track6Preset || lShape.track6Mode,
      lShape.customTracks
    );
    if (typeof encoded.slotsMask === 'string') out.slotsMask = encoded.slotsMask;
    if (Array.isArray(encoded.extraSlots) && encoded.extraSlots.length > 0) {
      out.extraSlots = encoded.extraSlots;
    }
  }
  return out;
}

export function compactLogoConfig(logo: any): any {
  if (!logo || typeof logo !== 'object') return logo;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(logo)) {
    if (k === 'file' || v === undefined) continue;
    out[k] = v;
  }
  if (typeof out.customWidth === 'number') out.customWidth = round2(out.customWidth);
  if (typeof out.customHeight === 'number') out.customHeight = round2(out.customHeight);
  if (typeof out.currentTime === 'number') out.currentTime = round2(out.currentTime);

  if (typeof out.url === 'string' && isDefaultLogoSvgUrl(out.url)) {
    delete out.url;
  }
  if (typeof out.imageUrl === 'string') {
    if (isDefaultLogoSvgUrl(out.imageUrl) || (out.url && out.imageUrl === out.url)) {
      delete out.imageUrl;
    }
  }
  if (typeof out.serverUrl === 'string' && out.url && out.serverUrl === out.url) {
    delete out.serverUrl;
  }
  if (Array.isArray(out.playlist)) {
    out.playlist = out.playlist.map(compactMediaItem);
  }
  return out;
}

export function compactGraphicsConfig(graphics: any): any {
  if (!graphics || typeof graphics !== 'object') return graphics;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(graphics)) {
    // Eliminate duplicate legacy aliases on wire/disk; restored transparently in hydrateGraphicsConfig
    if (k === 'sponsor1Logo' || k === 'sponsor2Logo') continue;
    if (v === undefined) continue;
    out[k] = v;
  }

  const sp1 = graphics.sponsorLogo1 || graphics.sponsor1Logo;
  const sp2 = graphics.sponsorLogo2 || graphics.sponsor2Logo;

  if (graphics.channelLogo) out.channelLogo = compactLogoConfig(graphics.channelLogo);
  if (sp1) out.sponsorLogo1 = compactLogoConfig(sp1);
  if (sp2) out.sponsorLogo2 = compactLogoConfig(sp2);
  if (graphics.sponsorLogo3) out.sponsorLogo3 = compactLogoConfig(graphics.sponsorLogo3);
  if (graphics.sponsorLogo4) out.sponsorLogo4 = compactLogoConfig(graphics.sponsorLogo4);

  return out;
}

export function compactChannel(
  ch: any,
  opts: { keepActiveLiveState?: boolean } = {}
): any {
  if (!ch || typeof ch !== 'object') return ch;
  const keepActive = Boolean(opts.keepActiveLiveState);
  const out: Record<string, any> = { ...ch };

  if (typeof out.currentTime === 'number') out.currentTime = round2(out.currentTime);
  if (typeof out.activeProgramTime === 'number') out.activeProgramTime = round2(out.activeProgramTime);
  if (typeof out.everyNMinTime === 'number') out.everyNMinTime = round2(out.everyNMinTime);

  if (out.savedMainPlaybackState && typeof out.savedMainPlaybackState === 'object') {
    out.savedMainPlaybackState = {
      clipIndex: out.savedMainPlaybackState.clipIndex || 0,
      currentTime: round2(out.savedMainPlaybackState.currentTime || 0),
    };
  }
  if (out.savedProgramPlaybackState && typeof out.savedProgramPlaybackState === 'object') {
    out.savedProgramPlaybackState = {
      programId: out.savedProgramPlaybackState.programId,
      clipIndex: out.savedProgramPlaybackState.clipIndex || 0,
      currentTime: round2(out.savedProgramPlaybackState.currentTime || 0),
    };
  }

  if (Array.isArray(out.playlist)) {
    out.playlist = out.playlist.map(compactMediaItem);
  }
  if (Array.isArray(out.scheduledPrograms)) {
    out.scheduledPrograms = out.scheduledPrograms.map((p: any) => {
      if (!p || typeof p !== 'object') return p;
      const cp: Record<string, any> = { ...p };
      if (Array.isArray(cp.clips) && cp.clips.length === 0) delete cp.clips;
      if (Array.isArray(cp.playlist)) cp.playlist = cp.playlist.map(compactMediaItem);
      return cp;
    });
  }
  if (Array.isArray(out.everyNMinAds)) {
    out.everyNMinAds = out.everyNMinAds.map(compactMediaItem);
  }

  if (keepActive) {
    out.activeProgramId = out.activeProgramId ?? null;
    out.activeProgramClipIndex = out.activeProgramClipIndex ?? 0;
    out.activeProgramTime = typeof out.activeProgramTime === 'number' ? out.activeProgramTime : 0;
    out.everyNMinTime = typeof out.everyNMinTime === 'number' ? out.everyNMinTime : 0;
    out.activeEveryNMinAd = out.activeEveryNMinAd ? compactMediaItem(out.activeEveryNMinAd) : null;
    out.everyNMinQueue = Array.isArray(out.everyNMinQueue)
      ? out.everyNMinQueue.map(compactMediaItem)
      : [];
    out.liveInput = out.liveInput ?? null;
    out.savedMainPlaybackState = out.savedMainPlaybackState ?? null;
    out.savedProgramPlaybackState = out.savedProgramPlaybackState ?? null;
  } else {
    if (!out.activeEveryNMinAd) delete out.activeEveryNMinAd;
    else out.activeEveryNMinAd = compactMediaItem(out.activeEveryNMinAd);
    if (Array.isArray(out.everyNMinQueue) && out.everyNMinQueue.length === 0) {
      delete out.everyNMinQueue;
    } else if (Array.isArray(out.everyNMinQueue)) {
      out.everyNMinQueue = out.everyNMinQueue.map(compactMediaItem);
    }
    if (Array.isArray(out.loopFolders) && out.loopFolders.length === 0) delete out.loopFolders;
    if (Array.isArray(out.playedClipIds) && out.playedClipIds.length === 0) delete out.playedClipIds;
  }

  if (out.bottomOverlay) out.bottomOverlay = compactOverlayConfig(out.bottomOverlay);
  if (out.topOverlay) out.topOverlay = compactOverlayConfig(out.topOverlay);
  if (out.lShape) out.lShape = compactLShapeConfig(out.lShape);
  if (out.graphics) out.graphics = compactGraphicsConfig(out.graphics);

  return out;
}

export function compactCgStatePayload(cgPayload: any): any {
  if (!cgPayload || typeof cgPayload !== 'object') return cgPayload;
  const out: Record<string, any> = {
    updatedAtMs: typeof cgPayload.updatedAtMs === 'number' ? cgPayload.updatedAtMs : Date.now(),
    channelId: cgPayload.channelId || 1,
  };
  if (cgPayload.ok !== undefined) out.ok = cgPayload.ok;
  if (cgPayload.updatedAt) out.updatedAt = cgPayload.updatedAt;
  if (cgPayload.bottomOverlay !== undefined) {
    out.bottomOverlay = cgPayload.bottomOverlay ? compactOverlayConfig(cgPayload.bottomOverlay) : null;
  }
  if (cgPayload.topOverlay !== undefined) {
    out.topOverlay = cgPayload.topOverlay ? compactOverlayConfig(cgPayload.topOverlay) : null;
  }
  if (cgPayload.lShape !== undefined) {
    out.lShape = cgPayload.lShape ? compactLShapeConfig(cgPayload.lShape) : null;
  }
  if (cgPayload.graphics !== undefined) {
    out.graphics = cgPayload.graphics ? compactGraphicsConfig(cgPayload.graphics) : null;
  }
  return out;
}

export function compactPlayoutStateEnvelope(stateObj: any): any {
  if (!stateObj || typeof stateObj !== 'object') return stateObj;
  const channels = Array.isArray(stateObj.channels)
    ? stateObj.channels.slice(0, 1).map((ch: any) => compactChannel(ch, { keepActiveLiveState: false }))
    : [];
  const out: Record<string, any> = {
    appName: stateObj.appName || 'ASHOKA CABLE TV PLAYOUT',
    updatedAt: stateObj.updatedAt || new Date().toISOString(),
    updatedAtMs: typeof stateObj.updatedAtMs === 'number' ? stateObj.updatedAtMs : Date.now(),
    everyNMinEnabled: Boolean(stateObj.everyNMinEnabled),
    everyNMinInterval: stateObj.everyNMinInterval ?? 15,
    isLicensed: Boolean(stateObj.isLicensed),
    channels,
  };
  if (stateObj.licenseRecord) out.licenseRecord = stateObj.licenseRecord;
  // Deliberately omit redundant top-level everyNMinAds array because channels[0].everyNMinAds holds it.
  return out;
}

export function hydrateCompactClip(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const isScheduleItem =
    Array.isArray(item.tickedSlots) ||
    typeof item.slotsMask === 'string' ||
    Array.isArray(item.selectedTracks) ||
    item.intervalMin !== undefined ||
    item.overlayMode !== undefined;

  if (!isScheduleItem) {
    return item;
  }

  const tickedSlots = decodeCompactSlots({
    tickedSlots: item.tickedSlots,
    slotsMask: item.slotsMask,
    extraSlots: item.extraSlots,
    selectedTracks: item.selectedTracks,
    track6Mode: item.track6Mode,
    track6Preset: item.track6Preset,
    customTracks: item.customTracks,
  });

  const { slotsMask: _m, extraSlots: _e, ...rest } = item;
  return {
    ...rest,
    tickedSlots,
  };
}

export function hydrateLogoConfig(logo: any, fallbackUrl: string): any {
  if (!logo || typeof logo !== 'object') return logo;
  const next = { ...logo };
  if (!next.url && next.imageUrl && !String(next.imageUrl).startsWith('blob:')) {
    next.url = next.imageUrl;
  }
  if (!next.url) {
    next.url = fallbackUrl;
  }
  if (Array.isArray(next.playlist)) {
    next.playlist = next.playlist.map(hydrateCompactClip);
  }
  return next;
}

export function hydrateGraphicsConfig(
  graphics: any,
  channelId: number = 1,
  accentColor: string = '#EF4444'
): any {
  if (!graphics || typeof graphics !== 'object') return graphics;
  const def = buildDefaultLogos(channelId, accentColor);
  const channelLogo = graphics.channelLogo
    ? hydrateLogoConfig(graphics.channelLogo, createChannelLogoSvg(channelId, accentColor))
    : def.channelLogo;
  const rawSp1 = graphics.sponsorLogo1 || graphics.sponsor1Logo;
  const rawSp2 = graphics.sponsorLogo2 || graphics.sponsor2Logo;
  const sponsorLogo1 = rawSp1
    ? hydrateLogoConfig(rawSp1, createSponsor1LogoSvg(channelId))
    : def.sponsorLogo1;
  const sponsorLogo2 = rawSp2
    ? hydrateLogoConfig(rawSp2, createSponsor2LogoSvg(channelId))
    : def.sponsorLogo2;

  return {
    ...graphics,
    channelLogo,
    sponsorLogo1,
    sponsorLogo2,
    sponsor1Logo: sponsorLogo1,
    sponsor2Logo: sponsorLogo2,
    sponsorLogo3: graphics.sponsorLogo3 ? hydrateLogoConfig(graphics.sponsorLogo3, '') : graphics.sponsorLogo3,
    sponsorLogo4: graphics.sponsorLogo4 ? hydrateLogoConfig(graphics.sponsorLogo4, '') : graphics.sponsorLogo4,
  };
}

export function hydrateLShapeConfig(lShape: any): any {
  if (!lShape || typeof lShape !== 'object') return lShape;
  const next: any = { ...lShape };
  if (Array.isArray(next.playlist)) {
    next.playlist = next.playlist.map(hydrateCompactClip);
  }
  if (
    Array.isArray(next.tickedSlots) ||
    typeof next.slotsMask === 'string' ||
    Array.isArray(next.selectedTracks)
  ) {
    next.tickedSlots = decodeCompactSlots({
      tickedSlots: next.tickedSlots,
      slotsMask: next.slotsMask,
      extraSlots: next.extraSlots,
      selectedTracks: next.selectedTracks,
      track6Mode: next.track6Mode,
      track6Preset: next.track6Preset,
      customTracks: next.customTracks,
    });
    delete next.slotsMask;
    delete next.extraSlots;
  }
  return next;
}

export function hydrateCompactChannel(ch: any): any {
  if (!ch || typeof ch !== 'object') return ch;
  const channelId = ch.id || 1;
  const accentColor = ch.colorAccent || '#EF4444';
  return {
    ...ch,
    everyNMinAds: Array.isArray(ch.everyNMinAds)
      ? ch.everyNMinAds.map(hydrateCompactClip)
      : ch.everyNMinAds,
    activeEveryNMinAd: ch.activeEveryNMinAd
      ? hydrateCompactClip(ch.activeEveryNMinAd)
      : ch.activeEveryNMinAd,
    everyNMinQueue: Array.isArray(ch.everyNMinQueue)
      ? ch.everyNMinQueue.map(hydrateCompactClip)
      : ch.everyNMinQueue,
    lShape: ch.lShape ? hydrateLShapeConfig(ch.lShape) : ch.lShape,
    graphics: ch.graphics
      ? hydrateGraphicsConfig(ch.graphics, channelId, accentColor)
      : ch.graphics,
  };
}
