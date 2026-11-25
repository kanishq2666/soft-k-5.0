import type { TVChannel, YouTubeQueueItem } from '../types/playout';

export const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
export const YOUTUBE_PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]{10,64}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export interface ParsedYouTubeToken {
  kind: 'video' | 'playlist' | 'channel_live';
  url: string;
  videoId?: string;
  playlistId?: string;
  isLiveHint?: boolean;
  title: string;
}

export function normalizeUrlProtocol(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?(youtube\.com|m\.youtube\.com|music\.youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function isAllowedYouTubeHost(hostname: string): boolean {
  return ALLOWED_YOUTUBE_HOSTS.has(String(hostname || '').toLowerCase());
}

export function extractYouTubeVideoId(rawInput: string): string | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;
  if (YOUTUBE_VIDEO_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(normalizeUrlProtocol(trimmed));
    if (!isAllowedYouTubeHost(parsed.hostname)) return null;

    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const candidate = parts[0] || '';
      return YOUTUBE_VIDEO_ID_REGEX.test(candidate) ? candidate : null;
    }

    const vParam = parsed.searchParams.get('v') || '';
    if (YOUTUBE_VIDEO_ID_REGEX.test(vParam)) {
      return vParam;
    }

    if (
      parts.length >= 2 &&
      (parts[0] === 'live' || parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'v')
    ) {
      const candidate = parts[1] || '';
      return YOUTUBE_VIDEO_ID_REGEX.test(candidate) ? candidate : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function extractYouTubePlaylistId(rawInput: string): string | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(normalizeUrlProtocol(trimmed));
    if (!isAllowedYouTubeHost(parsed.hostname)) return null;
    const listId = (parsed.searchParams.get('list') || '').trim();
    if (YOUTUBE_PLAYLIST_ID_REGEX.test(listId)) {
      return listId;
    }
  } catch {
    return null;
  }
  return null;
}

export function isYouTubeChannelLiveUrl(rawInput: string): boolean {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(normalizeUrlProtocol(trimmed));
    if (!isAllowedYouTubeHost(parsed.hostname)) return false;
    const pathLower = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (!pathLower.endsWith('/live')) return false;
    const parts = pathLower.split('/').filter(Boolean);
    if (parts.length === 2 && (parts[0].startsWith('@') || parts[0] === 'live')) {
      return parts[0].startsWith('@');
    }
    if (parts.length === 3 && (parts[0] === 'channel' || parts[0] === 'c' || parts[0] === 'user')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function parseYouTubeBatchInput(rawText: string): {
  tokens: ParsedYouTubeToken[];
  invalidTokens: string[];
} {
  const rawParts = String(rawText || '')
    .split(/[\r\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const tokens: ParsedYouTubeToken[] = [];
  const invalidTokens: string[] = [];
  const seenKeys = new Set<string>();

  for (const part of rawParts) {
    const normalized = normalizeUrlProtocol(part);
    const videoId = extractYouTubeVideoId(normalized);
    const playlistId = extractYouTubePlaylistId(normalized);
    const lower = normalized.toLowerCase();
    const isLiveHint = lower.includes('/live') || lower.includes('live_stream');

    if (videoId) {
      const key = `v:${videoId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        tokens.push({
          kind: 'video',
          videoId,
          playlistId: playlistId || undefined,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          isLiveHint,
          title: isLiveHint ? `YouTube Live (${videoId})` : `YouTube Video (${videoId})`,
        });
      }
      // If pasted link is a watch?v=...&list=PL... playlist URL, also note playlist if list isn't Watch Later/Mix-only short ID
      if (playlistId && !playlistId.startsWith('RD')) {
        const pKey = `p:${playlistId}`;
        if (!seenKeys.has(pKey)) {
          seenKeys.add(pKey);
          tokens.push({
            kind: 'playlist',
            playlistId,
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            title: `YouTube Playlist (${playlistId})`,
          });
        }
      }
      continue;
    }

    if (playlistId) {
      const pKey = `p:${playlistId}`;
      if (!seenKeys.has(pKey)) {
        seenKeys.add(pKey);
        tokens.push({
          kind: 'playlist',
          playlistId,
          url: `https://www.youtube.com/playlist?list=${playlistId}`,
          title: `YouTube Playlist (${playlistId})`,
        });
      }
      continue;
    }

    if (isYouTubeChannelLiveUrl(normalized)) {
      const cKey = `c:${normalized}`;
      if (!seenKeys.has(cKey)) {
        seenKeys.add(cKey);
        tokens.push({
          kind: 'channel_live',
          url: normalized,
          isLiveHint: true,
          title: 'YouTube Live Stream',
        });
      }
      continue;
    }

    invalidTokens.push(part);
  }

  return { tokens, invalidTokens };
}

export function buildImmediateYouTubeQueueFromText(rawText: string): YouTubeQueueItem[] {
  const { tokens } = parseYouTubeBatchInput(rawText);
  const items: YouTubeQueueItem[] = [];
  tokens.forEach((t, idx) => {
    if (t.kind === 'video' && t.videoId) {
      items.push({
        id: `yt-${t.videoId}-${idx}`,
        url: t.url,
        videoId: t.videoId,
        playlistId: t.playlistId,
        title: t.title,
        isLive: Boolean(t.isLiveHint),
        enabled: true,
      });
    }
  });
  return items;
}

export function getActiveYouTubeQueueItem(
  queue: YouTubeQueueItem[] | undefined | null,
  currentIndex: number = 0
): { item: YouTubeQueueItem | null; index: number } {
  const list = Array.isArray(queue) ? queue : [];
  if (list.length === 0) return { item: null, index: -1 };
  const safeIdx = Math.max(0, Math.min(list.length - 1, currentIndex || 0));
  if (list[safeIdx] && list[safeIdx].enabled !== false && list[safeIdx].videoId) {
    return { item: list[safeIdx], index: safeIdx };
  }
  const enabledAfter = list.findIndex((it, idx) => idx >= safeIdx && it && it.enabled !== false && Boolean(it.videoId));
  if (enabledAfter >= 0) {
    return { item: list[enabledAfter], index: enabledAfter };
  }
  const firstEnabled = list.findIndex((it) => it && it.enabled !== false && Boolean(it.videoId));
  if (firstEnabled >= 0) {
    return { item: list[firstEnabled], index: firstEnabled };
  }
  return { item: null, index: -1 };
}

export function advanceYouTubeQueueIndex(
  queue: YouTubeQueueItem[] | undefined | null,
  currentIndex: number = 0,
  loopPlaylist: boolean = true
): { nextIndex: number; wrapped: boolean; shouldStop: boolean } {
  const list = Array.isArray(queue) ? queue : [];
  const enabledIndices = list
    .map((it, idx) => (it && it.enabled !== false && Boolean(it.videoId) ? idx : -1))
    .filter((idx) => idx >= 0);

  if (enabledIndices.length === 0) {
    return { nextIndex: 0, wrapped: false, shouldStop: true };
  }

  const nextAfter = enabledIndices.find((idx) => idx > currentIndex);
  if (nextAfter !== undefined) {
    return { nextIndex: nextAfter, wrapped: false, shouldStop: false };
  }

  if (loopPlaylist) {
    return { nextIndex: enabledIndices[0], wrapped: true, shouldStop: false };
  }

  return { nextIndex: enabledIndices[0], wrapped: false, shouldStop: true };
}

export function shouldAutoSkipOnYouTubeError(
  consecutiveErrors: number,
  enabledCount: number
): boolean {
  if (enabledCount <= 1) return false;
  return consecutiveErrors < enabledCount;
}

export function toggleYouTubeQueueItemEnabled(
  queue: YouTubeQueueItem[],
  currentIndex: number,
  itemId: string,
  nextEnabled?: boolean
): {
  queue: YouTubeQueueItem[];
  nextIndex: number;
  hasEnabledItems: boolean;
} {
  const updated = queue.map((it) =>
    it.id === itemId
      ? { ...it, enabled: typeof nextEnabled === 'boolean' ? nextEnabled : it.enabled === false }
      : it
  );
  const { index } = getActiveYouTubeQueueItem(updated, currentIndex);
  return {
    queue: updated,
    nextIndex: index >= 0 ? index : 0,
    hasEnabledItems: index >= 0,
  };
}

export function buildYouTubeEmbedUrl(opts: {
  videoId: string;
  muted: boolean;
  origin?: string;
}): string {
  const videoId = YOUTUBE_VIDEO_ID_REGEX.test(opts.videoId) ? opts.videoId : '';
  if (!videoId) return '';
  const params = new URLSearchParams({
    autoplay: '1',
    controls: '0',
    enablejsapi: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    iv_load_policy: '3',
    cc_load_policy: '0',
    disablekb: '1',
    fs: '0',
    mute: opts.muted ? '1' : '0',
  });
  if (opts.origin && /^https?:\/\//i.test(opts.origin)) {
    params.set('origin', opts.origin);
    params.set('widget_referrer', opts.origin);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

/**
 * Keeps the YouTube iframe instance mounted (paused & muted in background) whenever YouTube
 * Live Input is active, even during Every N Min Ads or Scheduled Programs, so playback resumes
 * from the exact paused timestamp once the ad break ends instead of restarting from 0:00.
 */
export function shouldKeepYouTubeLayerMounted(channel: TVChannel | null | undefined): boolean {
  if (!channel) return false;
  if (channel.status === 'STOPPED') return false;
  if (!channel.liveInput?.active) return false;
  if (channel.liveInput.sourceType !== 'youtube') return false;
  const active = getActiveYouTubeQueueItem(
    channel.liveInput.youtubeQueue,
    channel.liveInput.youtubeQueueIndex || 0
  );
  return Boolean(active.item?.videoId);
}

/**
 * Validates Live Input stream URLs: allows M3U8/HLS/HTTP(S) links and explicitly rejects RTMP/RTSP.
 */
export function isSupportedM3u8LiveUrl(rawUrl: string): {
  valid: boolean;
  isRejectedRtmp: boolean;
  normalizedUrl: string;
} {
  const clean = String(rawUrl || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!clean) {
    return { valid: false, isRejectedRtmp: false, normalizedUrl: '' };
  }
  const lower = clean.toLowerCase();
  if (lower.startsWith('rtmp://') || lower.startsWith('rtmps://') || lower.startsWith('rtsp://')) {
    return { valid: false, isRejectedRtmp: true, normalizedUrl: clean };
  }
  if (lower.startsWith('http://') || lower.startsWith('https://') || clean.startsWith('/')) {
    return { valid: true, isRejectedRtmp: false, normalizedUrl: clean };
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(clean) && lower.includes('.m3u8')) {
    return { valid: true, isRejectedRtmp: false, normalizedUrl: `https://${clean}` };
  }
  return { valid: false, isRejectedRtmp: false, normalizedUrl: clean };
}

export function isYouTubeLiveStageActive(channel: TVChannel | null | undefined): boolean {
  if (!shouldKeepYouTubeLayerMounted(channel)) return false;
  if (channel?.activeEveryNMinAd) return false;
  if (channel?.activeProgramId) return false;
  return true;
}

/**
 * Computes percentage coordinates matching videoGenerator's 1920x1080 progX/progY/progW/progH box
 * so the YouTube player aligns cleanly inside L-Shape or Top/Bottom Overlay squeeze.
 */
export function computeYouTubeViewportBoxPct(channel: TVChannel): {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
} {
  let vx = 0;
  let vy = 0;
  let vw = 1920;
  let vh = 1080;

  const liveOverlayMode =
    channel.liveInput?.showOverlaysOnLive === false
      ? 'clean'
      : channel.liveInput?.liveOverlayMode || 'all';
  const allowBannersAndTicker = liveOverlayMode === 'all' || (liveOverlayMode as string) === 'all_overlays';
  const allowLShape = liveOverlayMode !== 'clean';

  const lShape = channel.lShape;
  const hasEnabledLShape = Boolean(
    allowLShape &&
      lShape?.enabled &&
      Array.isArray(lShape.playlist) &&
      lShape.playlist.some((it) => it && it.enabled !== false) &&
      lShape.periodicActive !== false
  );

  let lShapeActiveAndSqueeze = false;
  if (hasEnabledLShape && lShape) {
    const activeLItem = lShape.playlist[Math.max(0, Math.min(lShape.playlist.length - 1, lShape.currentIndex || 0))];
    const preset = activeLItem?.presetSize || lShape.presetSize || 'medium';
    const isSqueeze = lShape.renderMode === 'squeeze' || (lShape.squeezeProgramVideo !== false && preset !== 'full_image' && lShape.renderMode !== 'overlay');
    if (isSqueeze) {
      lShapeActiveAndSqueeze = true;
      const sideW =
        activeLItem?.sideWidth && activeLItem.sideWidth >= 50
          ? activeLItem.sideWidth
          : lShape.sideWidth && lShape.sideWidth >= 50
          ? lShape.sideWidth
          : 280;
      const bottomH =
        activeLItem?.bottomHeight && activeLItem.bottomHeight >= 28
          ? activeLItem.bottomHeight
          : lShape.bottomHeight && lShape.bottomHeight >= 28
          ? lShape.bottomHeight
          : 130;
      if ((lShape.side || 'left') === 'left') {
        vx += sideW;
        vw = Math.max(160, vw - sideW);
      } else {
        vw = Math.max(160, vw - sideW);
      }
      vh = Math.max(120, vh - bottomH);
    }
  }

  if (allowBannersAndTicker && !lShapeActiveAndSqueeze) {
    const hasEnabledTopOv = (channel.topOverlay?.playlist || []).some((it) => it && it.enabled !== false);
    const hasEnabledBotOv = (channel.bottomOverlay?.playlist || []).some((it) => it && it.enabled !== false);
    if (channel.topOverlay?.enabled && channel.topOverlay.squeezeProgramVideo && hasEnabledTopOv) {
      const topH = channel.topOverlay.height || 90;
      vy += topH;
      vh = Math.max(100, vh - topH);
    }
    if (channel.bottomOverlay?.enabled && channel.bottomOverlay.squeezeProgramVideo && hasEnabledBotOv) {
      const botH = channel.bottomOverlay.height || 200;
      vh = Math.max(100, vh - botH);
    }
  }

  return {
    leftPct: (vx / 1920) * 100,
    topPct: (vy / 1080) * 100,
    widthPct: (vw / 1920) * 100,
    heightPct: (vh / 1080) * 100,
  };
}
