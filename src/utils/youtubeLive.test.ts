import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  extractYouTubePlaylistId,
  isYouTubeChannelLiveUrl,
  parseYouTubeBatchInput,
  buildImmediateYouTubeQueueFromText,
  getActiveYouTubeQueueItem,
  advanceYouTubeQueueIndex,
  toggleYouTubeQueueItemEnabled,
  buildYouTubeEmbedUrl,
  isYouTubeLiveStageActive,
  shouldKeepYouTubeLayerMounted,
  isSupportedM3u8LiveUrl,
  computeYouTubeViewportBoxPct,
  shouldAutoSkipOnYouTubeError,
} from './youtubeLive';
import type { TVChannel, YouTubeQueueItem } from '../types/playout';

function makeMinimalChannel(overrides: Partial<TVChannel> = {}): TVChannel {
  return {
    id: 1,
    name: 'Test CH',
    callSign: 'TEST',
    frequency: 'CH-1',
    genre: 'Cinema',
    colorAccent: '#ef4444',
    status: 'PLAYING',
    currentClipIndex: 0,
    currentTime: 0,
    totalDuration: 0,
    loopMode: 'playlist',
    defaultFillerMedia: { title: 'Filler', type: 'bars' },
    playlist: [],
    graphics: {
      channelLogo: { enabled: false, url: '', label: '', position: 'top-right', width: 100, height: 60, opacity: 1, marginX: 20, marginY: 20 },
      sponsor1Logo: { enabled: false, url: '', label: '', position: 'top-left', width: 100, height: 60, opacity: 1, marginX: 20, marginY: 20 },
      sponsor2Logo: { enabled: false, url: '', label: '', position: 'bottom-left', width: 100, height: 60, opacity: 1, marginX: 20, marginY: 20 },
      clockEnabled: true,
      clockPosition: 'top-right',
      tickerEnabled: true,
      tickerText: 'Test',
      tickerSpeed: 100,
      tickerBackgroundColor: '#000',
      tickerTextColor: '#fff',
      tickerItems: [],
    } as any,
    transmission: {
      outputResolution: '1080p',
      aspectRatioMode: 'STRETCH',
      videoBitrateKbps: 4000,
      fps: 30,
      outgoingBitrateKbps: 4000,
      outgoingFps: 30,
      droppedFrames: 0,
      jitterMs: 0,
      uptimeSeconds: 0,
    } as any,
    ...overrides,
  };
}

test('extractYouTubeVideoId handles standard, short, live, shorts, embed, and bare IDs safely', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/M7lc1UVf-VE?si=abc'), 'M7lc1UVf-VE');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/live/jfKfPfyJRdk?feature=share'), 'jfKfPfyJRdk');
  assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.equal(extractYouTubeVideoId('m.youtube.com/embed/jNQXAC9IVRw'), 'jNQXAC9IVRw');
  assert.equal(extractYouTubeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  // Reject non-YouTube domains and invalid IDs
  assert.equal(extractYouTubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractYouTubeVideoId('javascript:alert(1)'), null);
});

test('extractYouTubePlaylistId and isYouTubeChannelLiveUrl identify playlists and channel live feeds', () => {
  assert.equal(
    extractYouTubePlaylistId('https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'),
    'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'
  );
  assert.equal(
    extractYouTubePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'),
    'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'
  );
  assert.equal(extractYouTubePlaylistId('https://notyoutube.org/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj'), null);
  assert.equal(isYouTubeChannelLiveUrl('https://www.youtube.com/@News24/live'), true);
  assert.equal(isYouTubeChannelLiveUrl('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/live'), true);
  assert.equal(isYouTubeChannelLiveUrl('https://www.youtube.com/@News24/videos'), false);
});

test('parseYouTubeBatchInput parses pasted multi-line videos, lives, playlists, and rejects junk tokens', () => {
  const pasted = `
    https://www.youtube.com/watch?v=dQw4w9WgXcQ
    https://youtu.be/M7lc1UVf-VE
    https://www.youtube.com/live/jfKfPfyJRdk
    https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj
    https://www.youtube.com/@TestLive/live
    https://youtu.be/M7lc1UVf-VE
    not-a-valid-link
  `;
  const parsed = parseYouTubeBatchInput(pasted);
  assert.equal(parsed.tokens.length, 5);
  assert.equal(parsed.tokens[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(parsed.tokens[1].videoId, 'M7lc1UVf-VE');
  assert.equal(parsed.tokens[2].videoId, 'jfKfPfyJRdk');
  assert.equal(parsed.tokens[2].isLiveHint, true);
  assert.equal(parsed.tokens[3].kind, 'playlist');
  assert.equal(parsed.tokens[3].playlistId, 'PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj');
  assert.equal(parsed.tokens[4].kind, 'channel_live');
  assert.deepEqual(parsed.invalidTokens, ['not-a-valid-link']);
});

test('advanceYouTubeQueueIndex skips disabled items, loops sequentially, or stops when loop=false', () => {
  const queue: YouTubeQueueItem[] = [
    { id: '1', url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', title: 'Clip 1', enabled: true },
    { id: '2', url: 'https://youtu.be/M7lc1UVf-VE', videoId: 'M7lc1UVf-VE', title: 'Clip 2 (Disabled)', enabled: false },
    { id: '3', url: 'https://youtu.be/jfKfPfyJRdk', videoId: 'jfKfPfyJRdk', title: 'Clip 3', enabled: true },
  ];

  const step1 = advanceYouTubeQueueIndex(queue, 0, true);
  assert.deepEqual(step1, { nextIndex: 2, wrapped: false, shouldStop: false });

  const step2Loop = advanceYouTubeQueueIndex(queue, 2, true);
  assert.deepEqual(step2Loop, { nextIndex: 0, wrapped: true, shouldStop: false });

  const step2Stop = advanceYouTubeQueueIndex(queue, 2, false);
  assert.deepEqual(step2Stop, { nextIndex: 0, wrapped: false, shouldStop: true });

  const toggled = toggleYouTubeQueueItemEnabled(queue, 0, '1', false);
  assert.equal(toggled.hasEnabledItems, true);
  assert.equal(toggled.nextIndex, 2);
});

test('getActiveYouTubeQueueItem, buildImmediateYouTubeQueueFromText, and buildYouTubeEmbedUrl behave cleanly without captions/controls', () => {
  const q = buildImmediateYouTubeQueueFromText('https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/live/jfKfPfyJRdk');
  assert.equal(q.length, 2);
  assert.equal(q[1].isLive, true);

  const active = getActiveYouTubeQueueItem(q, 1);
  assert.equal(active.index, 1);
  assert.equal(active.item?.videoId, 'jfKfPfyJRdk');

  const embedUrl = buildYouTubeEmbedUrl({ videoId: 'jfKfPfyJRdk', muted: false, origin: 'http://localhost:3000' });
  assert.ok(embedUrl.startsWith('https://www.youtube.com/embed/jfKfPfyJRdk?'));
  assert.ok(embedUrl.includes('autoplay=1'));
  assert.ok(embedUrl.includes('controls=0'));
  assert.ok(embedUrl.includes('cc_load_policy=0'));
  assert.ok(embedUrl.includes('iv_load_policy=3'));
  assert.ok(embedUrl.includes('enablejsapi=1'));
  assert.ok(embedUrl.includes('mute=0'));
});

test('shouldKeepYouTubeLayerMounted keeps YouTube paused in background during Every N Min Ads while stage yields', () => {
  const queue = buildImmediateYouTubeQueueFromText('https://youtu.be/dQw4w9WgXcQ');
  const ch = makeMinimalChannel({
    liveInput: {
      active: true,
      sourceType: 'youtube',
      youtubeQueue: queue,
      youtubeQueueIndex: 0,
    },
    lShape: {
      enabled: true,
      side: 'left',
      sideWidth: 384,
      bottomHeight: 162,
      renderMode: 'squeeze',
      squeezeProgramVideo: true,
      periodicActive: true,
      intervalSeconds: 15,
      playlist: [{ id: 'ls1', title: 'L', url: '/assets/l.png', mediaType: 'image', fitMode: 'stretch', duration: 15, enabled: true }],
      currentIndex: 0,
      currentTime: 0,
      isPlaying: true,
      backgroundColor: '#000',
      backgroundStyle: 'solid_black',
      opacity: 1,
      presetSize: 'medium',
    },
  });

  assert.equal(isYouTubeLiveStageActive(ch), true);
  assert.equal(shouldKeepYouTubeLayerMounted(ch), true);
  const box = computeYouTubeViewportBoxPct(ch);
  assert.equal(box.leftPct, 20);
  assert.equal(box.topPct, 0);
  assert.equal(box.widthPct, 80);
  assert.equal(box.heightPct, 85);

  // Interrupted by Every N Min Ad -> stage yields visibly, but iframe stays mounted & paused in background!
  const chDuringAd = { ...ch, activeEveryNMinAd: { id: 'ad1', title: 'Ad', url: '/ad.mp4', duration: 15, fileName: 'ad.mp4' } as any };
  assert.equal(isYouTubeLiveStageActive(chDuringAd), false);
  assert.equal(shouldKeepYouTubeLayerMounted(chDuringAd), true);
});

test('isSupportedM3u8LiveUrl allows M3U8/HLS HTTP(S) streams and rejects RTMP/RTSP links', () => {
  assert.deepEqual(isSupportedM3u8LiveUrl('https://cdn.example.com/live/stream.m3u8'), {
    valid: true,
    isRejectedRtmp: false,
    normalizedUrl: 'https://cdn.example.com/live/stream.m3u8',
  });
  assert.deepEqual(isSupportedM3u8LiveUrl('rtmp://live.example.com/app/stream'), {
    valid: false,
    isRejectedRtmp: true,
    normalizedUrl: 'rtmp://live.example.com/app/stream',
  });
  assert.deepEqual(isSupportedM3u8LiveUrl('rtsp://192.168.1.50/cam'), {
    valid: false,
    isRejectedRtmp: true,
    normalizedUrl: 'rtsp://192.168.1.50/cam',
  });
});

test('shouldAutoSkipOnYouTubeError tries each enabled clip at most once without ping-pong looping', () => {
  assert.equal(shouldAutoSkipOnYouTubeError(1, 1), false);
  assert.equal(shouldAutoSkipOnYouTubeError(1, 2), true);
  assert.equal(shouldAutoSkipOnYouTubeError(2, 2), false);
  assert.equal(shouldAutoSkipOnYouTubeError(1, 3), true);
  assert.equal(shouldAutoSkipOnYouTubeError(2, 3), true);
  assert.equal(shouldAutoSkipOnYouTubeError(3, 3), false);
});


