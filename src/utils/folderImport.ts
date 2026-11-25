import type { PlaylistItem } from '../types/playout';
import { needsBackendTranscodeFallback } from './playoutPlaybackEngine';

export interface MinimalFileLike {
  name: string;
  size: number;
  type?: string;
  webkitRelativePath?: string;
}

/**
 * Estimates a safe initial duration in seconds in O(1) without spawning 5,000 <video> elements.
 * Real exact durations are filled progressively in background batches.
 */
export function estimateMediaDurationSec(fileSizeBytes: number, fileName: string = ''): number {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.swf')) return 15;
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return 30;
  // Assume ~240 KB/s average compressed broadcast stream rate as initial placeholder
  const est = Math.round(fileSizeBytes / (240 * 1024));
  return Math.max(15, Math.min(3600, est));
}

/**
 * For large folder imports (> 25 files), avoid uploading 5,000 raw binaries at once so the
 * server & browser never stall. Eagerly upload only the immediate first 3 clips or legacy formats
 * (.mpeg, .mpg, .avi, .mkv, etc.) that require server transcoding.
 */
export function shouldEagerUploadOnImport(
  fileName: string,
  indexInBatch: number,
  totalBatchCount: number
): boolean {
  if (totalBatchCount <= 25) return true;
  if (indexInBatch < 3) return true;
  if (needsBackendTranscodeFallback(fileName)) return true;
  return false;
}

/**
 * Returns whether a batch should eagerly write all binaries into IndexedDB immediately.
 * When importing 500–5,000+ videos, writing gigabytes synchronously into IDB freezes tabs.
 */
export function shouldEagerVaultSaveOnImport(
  indexInBatch: number,
  totalBatchCount: number
): boolean {
  if (totalBatchCount <= 30) return true;
  return indexInBatch < 5;
}

/**
 * Synchronously constructs PlaylistItems in O(N) for 5,000+ file imports with zero async blocking.
 */
export function buildFastPlaylistItems<T extends MinimalFileLike>(
  files: T[],
  opts: {
    batchTimestamp?: number;
    folderName?: string;
    extractFolder?: (file: T) => string | undefined;
    computeVaultId: (file: T) => string;
    registerBlobUrl: (file: T, vaultId: string) => { blobUrl: string };
  }
): PlaylistItem[] {
  const batchTs = opts.batchTimestamp ?? Date.now();
  return files.map((file, idx) => {
    const cleanTitle = String(file.name || 'Untitled').replace(/\.[^/.]+$/, '');
    const resolvedFolder = opts.folderName || opts.extractFolder?.(file);
    const syncVaultId = opts.computeVaultId(file);
    const { blobUrl } = opts.registerBlobUrl(file, syncVaultId);
    return {
      id: `vid-${batchTs}-${idx}`,
      title: cleanTitle,
      category: 'PROGRAM',
      duration: estimateMediaDurationSec(file.size, file.name),
      url: blobUrl,
      videoUrl: blobUrl,
      vaultId: syncVaultId,
      sourceType: 'local',
      fileName: file.name,
      fileSize: file.size,
      file: file as unknown as File,
      isTranscoding: false,
      enabled: true,
      folderName: resolvedFolder,
    };
  });
}

/**
 * Slices an expanded folder's items into responsive DOM pages (e.g. 100 items per page)
 * so expanding a 5,000-video folder never mounts 5,000 simultaneous React rows.
 */
export function paginateFolderItems<T>(
  items: T[],
  pageIndex: number = 0,
  pageSize: number = 100
): {
  slice: T[];
  startOffset: number;
  totalPages: number;
  safePageIndex: number;
} {
  const safeSize = Math.max(10, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safeSize));
  const safePageIndex = Math.max(0, Math.min(totalPages - 1, Math.floor(pageIndex || 0)));
  const startOffset = safePageIndex * safeSize;
  return {
    slice: items.slice(startOffset, startOffset + safeSize),
    startOffset,
    totalPages,
    safePageIndex,
  };
}

export interface MediaBatchProbePatch {
  duration?: number;
  url?: string;
  videoUrl?: string;
  serverUrl?: string;
  vaultId?: string;
  folderName?: string;
  isTranscoding?: boolean;
  enabled?: boolean;
}

/**
 * Coalesced concurrency-limited background probe/upload queue for multi-thousand file imports.
 * Ensures first few items resolve immediately and merges React state updates every ~350ms
 * instead of triggering N * 2 full playlist array clones.
 */
export function createMediaBatchQueue<TItem>(opts: {
  concurrency?: number;
  flushIntervalMs?: number;
  worker: (item: TItem, index: number, total: number) => Promise<MediaBatchProbePatch | null>;
  onFlush: (patches: Map<string, MediaBatchProbePatch>) => void;
  getId: (item: TItem) => string;
}): {
  enqueue: (items: TItem[]) => void;
  cancel: () => void;
} {
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 2));
  const flushIntervalMs = Math.max(80, opts.flushIntervalMs ?? 350);
  const pendingPatches = new Map<string, MediaBatchProbePatch>();
  let queue: Array<{ item: TItem; index: number; total: number }> = [];
  let cursor = 0;
  let active = 0;
  let cancelled = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = (immediate: boolean = false) => {
    if (pendingPatches.size === 0) return;
    if (immediate) {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const copy = new Map(pendingPatches);
      pendingPatches.clear();
      opts.onFlush(copy);
      return;
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (pendingPatches.size > 0) {
          const copy = new Map(pendingPatches);
          pendingPatches.clear();
          opts.onFlush(copy);
        }
      }, flushIntervalMs);
    }
  };

  const pump = () => {
    if (cancelled) return;
    while (active < concurrency && cursor < queue.length) {
      const entry = queue[cursor++];
      active++;
      opts
        .worker(entry.item, entry.index, entry.total)
        .then((patch) => {
          if (!cancelled && patch) {
            const id = opts.getId(entry.item);
            const prev = pendingPatches.get(id) || {};
            pendingPatches.set(id, { ...prev, ...patch });
            // Flush first 3 items immediately so active playback gets exact metadata at once
            scheduleFlush(entry.index < 3 || cursor >= queue.length);
          }
        })
        .catch(() => {})
        .finally(() => {
          active--;
          if (cursor < queue.length && !cancelled) {
            pump();
          } else if (active === 0) {
            scheduleFlush(true);
          }
        });
    }
  };

  return {
    enqueue: (items: TItem[]) => {
      if (cancelled || !items.length) return;
      const total = items.length;
      const start = queue.length;
      for (let i = 0; i < total; i++) {
        queue.push({ item: items[i], index: start + i, total });
      }
      pump();
    },
    cancel: () => {
      cancelled = true;
      queue = [];
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
  };
}
