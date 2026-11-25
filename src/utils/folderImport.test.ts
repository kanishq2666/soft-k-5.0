import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateMediaDurationSec,
  shouldEagerUploadOnImport,
  shouldEagerVaultSaveOnImport,
  buildFastPlaylistItems,
  paginateFolderItems,
  createMediaBatchQueue,
} from './folderImport';

test('estimateMediaDurationSec returns bounded fast estimates and 15s for SWF', () => {
  assert.equal(estimateMediaDurationSec(500_000, 'banner.swf'), 15);
  assert.equal(estimateMediaDurationSec(1024, 'tiny.mp4'), 15);
  assert.equal(estimateMediaDurationSec(240 * 1024 * 60, 'minute.mp4'), 60);
  assert.equal(estimateMediaDurationSec(10_000_000_000, 'huge.mp4'), 3600);
});

test('shouldEagerUploadOnImport limits massive batches to immediate clips and legacy formats', () => {
  assert.equal(shouldEagerUploadOnImport('movie.mp4', 10, 20), true);
  assert.equal(shouldEagerUploadOnImport('movie.mp4', 0, 5000), true);
  assert.equal(shouldEagerUploadOnImport('movie.mp4', 2, 5000), true);
  assert.equal(shouldEagerUploadOnImport('movie.mp4', 100, 5000), false);
  assert.equal(shouldEagerUploadOnImport('old_clip.mpeg', 4500, 5000), true);
  assert.equal(shouldEagerVaultSaveOnImport(4, 5000), true);
  assert.equal(shouldEagerVaultSaveOnImport(50, 5000), false);
});

test('buildFastPlaylistItems processes 5000+ files synchronously in O(N)', () => {
  const mockFiles = Array.from({ length: 5000 }, (_, i) => ({
    name: `clip_${i}.mp4`,
    size: 12_000_000,
    webkitRelativePath: 'MegaFolder/clip_' + i + '.mp4',
  }));
  const t0 = Date.now();
  const items = buildFastPlaylistItems(mockFiles, {
    batchTimestamp: 1000,
    folderName: 'MegaFolder',
    computeVaultId: (f) => `v-${f.name}`,
    registerBlobUrl: (f) => ({ blobUrl: `blob:mock/${f.name}` }),
  });
  const elapsed = Date.now() - t0;
  assert.equal(items.length, 5000);
  assert.equal(items[0].id, 'vid-1000-0');
  assert.equal(items[4999].folderName, 'MegaFolder');
  assert.ok(elapsed < 1000, `Expected fast O(N) build, got ${elapsed}ms`);
});

test('paginateFolderItems slices safely for huge expanded folders', () => {
  const arr = Array.from({ length: 5000 }, (_, i) => i);
  const page0 = paginateFolderItems(arr, 0, 100);
  assert.equal(page0.totalPages, 50);
  assert.equal(page0.slice.length, 100);
  assert.equal(page0.slice[0], 0);
  assert.equal(page0.startOffset, 0);

  const page49 = paginateFolderItems(arr, 99, 100);
  assert.equal(page49.safePageIndex, 49);
  assert.equal(page49.slice[0], 4900);
  assert.equal(page49.slice.length, 100);
});

test('createMediaBatchQueue coalesces updates across concurrent workers', async () => {
  const flushed: Array<Map<string, any>> = [];
  const queue = createMediaBatchQueue<{ id: string }>({
    concurrency: 2,
    flushIntervalMs: 80,
    getId: (x) => x.id,
    worker: async (x) => ({ duration: Number(x.id.split('-')[1]) * 10 }),
    onFlush: (map) => flushed.push(map),
  });

  queue.enqueue([
    { id: 'c-1' },
    { id: 'c-2' },
    { id: 'c-3' },
    { id: 'c-4' },
    { id: 'c-5' },
  ]);

  await new Promise((r) => setTimeout(r, 150));
  const merged = new Map<string, any>();
  for (const m of flushed) {
    m.forEach((v, k) => merged.set(k, v));
  }
  assert.equal(merged.size, 5);
  assert.equal(merged.get('c-5').duration, 50);
});
