/**
 * Universal SWF (Adobe Flash) & Broadcast Media Engine
 * - Parses real binary .SWF headers (FWS / CWS) for exact frameRate, frameCount, width, height & duration in seconds.
 * - Mounts Ruffle WebAssembly SWF players in-viewport with WebGL2 preserveDrawingBuffer (preserving Ruffle's
 *   native antialias:false so WebGL2 MSAA blitFramebuffer never fails) + automatic 2D Canvas renderer fallback.
 * - Includes a direct binary SWF bitmap-sequence decoder (DefineBitsLossless / DefineBitsLossless2 / DefineBitsJPEG2 / 3)
 *   so bitmap-exported SWF logos and animations render with 100% native 32-bit ARGB transparency from frame 1.
 * - Supports seamless back-to-back SWF playlist looping and clip switching (restarting from frame 1 when a clip goes on air).
 */

import {
  extractFolderName,
  saveFileToOfflineVault,
  updateVaultRecordServerUrl,
  getMediaFromOfflineVault,
} from './offlineMediaVault';

export interface SwfMetadata {
  isSwf: boolean;
  version: number;
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
  durationSec: number;
  backgroundColor?: string | null;
  rawBytes?: Uint8Array;
}

export const ALL_VIDEO_AND_SWF_ACCEPT =
  'video/*,audio/*,.mp4,.mov,.mkv,.webm,.avi,.m4v,.mpg,.mpeg,.vob,.ts,.m2ts,.mts,.flv,.f4v,.wmv,.asf,.3gp,.3g2,.dat,.divx,.xvid,.rm,.rmvb,.mxf,.ogv,.ogg,.dv,.hdv,.tod,.mod,.trp,.tp,.evo,.wtv,.amv,.mp2,.m2v,.mpv,.264,.265,.hevc,.h264,.swf';

export const ALL_CG_MEDIA_ACCEPT =
  'image/*,video/*,audio/*,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.mp4,.mov,.mkv,.webm,.avi,.m4v,.mpg,.mpeg,.vob,.ts,.m2ts,.mts,.flv,.f4v,.wmv,.asf,.3gp,.3g2,.dat,.divx,.xvid,.rm,.rmvb,.mxf,.ogv,.ogg,.dv,.hdv,.tod,.mod,.trp,.tp,.evo,.wtv,.amv,.mp2,.m2v,.mpv,.264,.265,.hevc,.h264,.swf';

const IGNORED_SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'm4v',
  'mpg',
  'mpeg',
  'vob',
  'ts',
  'm2ts',
  'mts',
  'flv',
  'f4v',
  'wmv',
  'asf',
  '3gp',
  '3g2',
  'dat',
  'divx',
  'xvid',
  'rm',
  'rmvb',
  'mxf',
  'ogv',
  'ogg',
  'mp2',
  'm2v',
  'mpv',
  'dv',
  'hdv',
  'tod',
  'mod',
  'trp',
  'tp',
  'evo',
  'wtv',
  'dvr-ms',
  'amv',
  '264',
  '265',
  'hevc',
  'h264',
  'avchd',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'apng']);

export function getFileExtension(fileName: string): string {
  const parts = (fileName || '').toLowerCase().trim().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isSwfFile(fileOrName: File | string): boolean {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName.name;
  return getFileExtension(name) === 'swf';
}

export function isImageFile(fileOrName: File | string): boolean {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName.name;
  const cleanName = (name || '').split('?')[0].split('#')[0];
  const ext = getFileExtension(cleanName);
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  if (typeof fileOrName !== 'string' && fileOrName.type && fileOrName.type.startsWith('image/')) {
    return true;
  }
  return false;
}

export function isImageUrl(url?: string, titleOrFileName?: string): boolean {
  const candidates = [url || '', titleOrFileName || ''];
  for (const raw of candidates) {
    const u = String(raw || '').trim();
    if (!u) continue;
    const lower = u.toLowerCase();
    if (lower.startsWith('data:image/')) return true;
    const clean = lower.split('?')[0].split('#')[0];
    const ext = getFileExtension(clean);
    if (IMAGE_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export function isVideoFile(fileOrName: File | string): boolean {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName.name;
  const ext = getFileExtension(name);
  if (VIDEO_EXTENSIONS.has(ext)) return true;
  if (typeof fileOrName !== 'string' && fileOrName.type && fileOrName.type.startsWith('video/')) {
    return true;
  }
  return false;
}

export function isVideoOrSwfFile(file: File): boolean {
  const nameLower = (file.name || '').toLowerCase();
  if (IGNORED_SYSTEM_FILES.has(nameLower) || nameLower.startsWith('.')) return false;
  const ext = getFileExtension(nameLower);
  if (ext === 'swf' || VIDEO_EXTENSIONS.has(ext)) return true;
  if (file.type && file.type.startsWith('video/')) return true;
  if (file.type === 'application/x-shockwave-flash') return true;
  if (
    !IMAGE_EXTENSIONS.has(ext) &&
    ext !== 'txt' &&
    ext !== 'json' &&
    ext !== 'ini' &&
    ext !== 'db' &&
    file.size > 0
  ) {
    return true;
  }
  return false;
}

export function isCgMediaFile(file: File): boolean {
  const nameLower = (file.name || '').toLowerCase();
  if (IGNORED_SYSTEM_FILES.has(nameLower) || nameLower.startsWith('.')) return false;
  const ext = getFileExtension(nameLower);
  if (ext === 'swf' || VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) return true;
  if (file.type && (file.type.startsWith('video/') || file.type.startsWith('image/'))) return true;
  return file.size > 0 && ext !== 'txt' && ext !== 'ini' && ext !== 'db';
}

export function filterFolderVideoAndSwfFiles(fileList: FileList | File[]): File[] {
  const arr = Array.from(fileList || []);
  const filtered = arr.filter(isVideoOrSwfFile);
  return filtered.length > 0
    ? filtered
    : arr.filter((f) => f.size > 0 && !IGNORED_SYSTEM_FILES.has((f.name || '').toLowerCase()));
}

export function filterFolderCgMediaFiles(fileList: FileList | File[]): File[] {
  const arr = Array.from(fileList || []);
  const filtered = arr.filter(isCgMediaFile);
  return filtered.length > 0
    ? filtered
    : arr.filter((f) => f.size > 0 && !IGNORED_SYSTEM_FILES.has((f.name || '').toLowerCase()));
}

/**
 * Strictly validates that a byte buffer is a genuine binary Adobe Flash SWF file (FWS, CWS, or ZWS).
 * Prevents non-SWF files (e.g. XML/SVG/HTML 404 or truncated slices) from causing Ruffle 'Invalid SWF' errors.
 */
export function isValidSwfBinary(bytes?: Uint8Array | null): boolean {
  if (!bytes || bytes.byteLength < 12) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const ver = bytes[3];
  if ((b0 !== 0x46 && b0 !== 0x43 && b0 !== 0x5a) || b1 !== 0x57 || b2 !== 0x53) {
    return false;
  }
  if (ver < 1 || ver > 55) return false;
  const declaredLen =
    (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  if (declaredLen < 12) return false;
  if (b0 === 0x46 && bytes.byteLength < Math.min(declaredLen, 64)) {
    return false;
  }
  return true;
}

/**
 * Fast header-only zlib decompressor: slices only the first 8 KB of the CWS body
 * so even 28 MB SWF files decompress their header (RECT, fps, frameCount, SetBackgroundColor) in < 0.2ms.
 */
async function decompressZlibHeader(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;

  // Only feed the first 8192 bytes so DecompressionStream flushes immediately without buffering 28MB
  const headerSlice = compressed.subarray(0, Math.min(compressed.length, 8192));

  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const rawSlice =
        format === 'deflate-raw' && headerSlice.length > 2
          ? headerSlice.subarray(2)
          : headerSlice;
      const inputCopy = new Uint8Array(rawSlice);
      writer.write(inputCopy as unknown as BufferSource).catch(() => {});
      writer.close().catch(() => {});
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;

      const readPromise = (async () => {
        while (total < 256) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          total += value.length;
        }
      })();

      await Promise.race([
        readPromise,
        new Promise((resolve) => setTimeout(resolve, 180)),
      ]);

      reader.cancel().catch(() => {});

      if (total >= 12) {
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        return merged;
      }
    } catch {
      // Try next format
    }
  }
  return null;
}

/**
 * Full-buffer zlib decompressor for extracting embedded DefineBitsLossless2 / DefineBitsLossless bitmaps.
 */
async function decompressZlibFull(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const rawSlice =
        format === 'deflate-raw' && compressed.length > 2
          ? compressed.subarray(2)
          : compressed;
      const inputCopy = new Uint8Array(rawSlice);
      writer.write(inputCopy as unknown as BufferSource).catch(() => {});
      writer.close().catch(() => {});

      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
      if (total > 0) {
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          out.set(c, offset);
          offset += c.length;
        }
        return out;
      }
    } catch {
      // Try next format
    }
  }
  return null;
}

/**
 * Parses raw SWF binary bytes (FWS uncompressed or CWS zlib-compressed) to extract
 * exact frameRate, frameCount, native stage dimensions, background color, and real duration in seconds.
 */
export async function parseSwfBytes(bytes: Uint8Array): Promise<SwfMetadata> {
  const fallback: SwfMetadata = {
    isSwf: true,
    version: 10,
    width: 550,
    height: 400,
    frameRate: 25,
    frameCount: 375,
    durationSec: 15,
    rawBytes: bytes,
  };

  try {
    if (!isValidSwfBinary(bytes)) return fallback;

    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const version = bytes[3];
    let bodyBytes: Uint8Array | null = null;

    if (sig === 'FWS') {
      bodyBytes = bytes.subarray(8);
    } else if (sig === 'CWS') {
      bodyBytes =
        (await decompressZlibFull(bytes.subarray(8))) ||
        (await decompressZlibHeader(bytes.subarray(8)));
    }

    if (!bodyBytes || bodyBytes.length < 12) {
      return fallback;
    }

    // Parse SWF RECT bitfield
    const nBits = bodyBytes[0] >> 3;
    const totalRectBits = 5 + nBits * 4;
    const rectBytes = Math.ceil(totalRectBits / 8);

    const readBits = (startBit: number, count: number): number => {
      let val = 0;
      for (let i = 0; i < count; i++) {
        const bitIndex = startBit + i;
        const byteIdx = Math.floor(bitIndex / 8);
        const bitOffset = 7 - (bitIndex % 8);
        const bit = (bodyBytes![byteIdx] >> bitOffset) & 1;
        val = (val << 1) | bit;
      }
      if (count > 0 && val & (1 << (count - 1))) {
        val -= 1 << count;
      }
      return val;
    };

    const xMin = readBits(5, nBits);
    const xMax = readBits(5 + nBits, nBits);
    const yMin = readBits(5 + nBits * 2, nBits);
    const yMax = readBits(5 + nBits * 3, nBits);

    const widthPx = Math.max(32, Math.round((xMax - xMin) / 20));
    const heightPx = Math.max(24, Math.round((yMax - yMin) / 20));

    if (bodyBytes.length < rectBytes + 4) {
      return { ...fallback, version, width: widthPx, height: heightPx, rawBytes: bytes };
    }

    // Frame rate is 8.8 fixed point little-endian
    const fpsInt = bodyBytes[rectBytes + 1];
    const fpsFrac = bodyBytes[rectBytes] / 256;
    const frameRate = Math.max(1, Math.min(120, Math.round((fpsInt + fpsFrac) * 10) / 10 || 25));

    // Frame count is uint16 little-endian
    const frameCount = Math.max(1, bodyBytes[rectBytes + 2] | (bodyBytes[rectBytes + 3] << 8));

    // Scan SWF tags for SetBackgroundColor (Tag ID = 9) and embedded DefineSprite timelines (Tag ID = 39)
    let bgHex: string | null = null;
    let maxSpriteFrames = 0;
    try {
      let pos = rectBytes + 4;
      let tagsChecked = 0;
      while (pos + 2 <= bodyBytes.length && tagsChecked < 4000) {
        const tagCodeAndLen = bodyBytes[pos] | (bodyBytes[pos + 1] << 8);
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        pos += 2;
        if (tagLen === 0x3f) {
          if (pos + 4 > bodyBytes.length) break;
          tagLen =
            (bodyBytes[pos] |
              (bodyBytes[pos + 1] << 8) |
              (bodyBytes[pos + 2] << 16) |
              (bodyBytes[pos + 3] << 24)) >>>
            0;
          pos += 4;
        }
        if (tagType === 0) break;
        if (tagType === 9 && !bgHex && pos + 3 <= bodyBytes.length) {
          const r = bodyBytes[pos].toString(16).padStart(2, '0');
          const g = bodyBytes[pos + 1].toString(16).padStart(2, '0');
          const b = bodyBytes[pos + 2].toString(16).padStart(2, '0');
          bgHex = `#${r}${g}${b}`;
        } else if (tagType === 39 && tagLen >= 4 && pos + 4 <= bodyBytes.length) {
          // DefineSprite tag: bytes 0..1 = SpriteID, bytes 2..3 = FrameCount of MovieClip
          const spriteFrames = bodyBytes[pos + 2] | (bodyBytes[pos + 3] << 8);
          if (spriteFrames > maxSpriteFrames) {
            maxSpriteFrames = spriteFrames;
          }
        }
        if (tagLen < 0 || pos + tagLen > bodyBytes.length) break;
        pos += tagLen;
        tagsChecked++;
      }
    } catch {
      // Ignore tag scan errors
    }

    const effectiveFrameCount = Math.max(frameCount, maxSpriteFrames);
    const computedSec =
      effectiveFrameCount <= 2 ? 15 : Math.max(2, Math.ceil(effectiveFrameCount / frameRate));

    return {
      isSwf: true,
      version,
      width: widthPx,
      height: heightPx,
      frameRate,
      frameCount: effectiveFrameCount,
      durationSec: computedSec,
      backgroundColor: bgHex,
      rawBytes: bytes,
    };
  } catch {
    return fallback;
  }
}

/**
 * Parses binary SWF file (FWS uncompressed or CWS zlib-compressed) to extract
 * exact frameRate, frameCount, native stage dimensions, and real duration in seconds.
 */
export async function parseSwfMetadata(file: File): Promise<SwfMetadata> {
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    return await parseSwfBytes(bytes);
  } catch {
    return {
      isSwf: true,
      version: 10,
      width: 550,
      height: 400,
      frameRate: 25,
      frameCount: 375,
      durationSec: 15,
    };
  }
}

export const parseSwfHeaderMetadata = parseSwfMetadata;

let uploadQueueChain: Promise<any> = Promise.resolve();

const CHUNK_UPLOAD_THRESHOLD_BYTES = 12 * 1024 * 1024; // 12 MB
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB per chunk (safely under 32MB cloud proxy limit)

export async function uploadMediaFileToBackend(
  file: File
): Promise<{ url: string | null; duration?: number; transcoded?: boolean }> {
  if (!file || file.size === 0 || file.size > 4000 * 1024 * 1024) {
    return { url: null };
  }

  const runTask = async (): Promise<{ url: string | null; duration?: number; transcoded?: boolean }> => {
    try {
      // For files larger than 12MB (e.g. 50MB, 100MB, 500MB HD/4K videos), upload in 8MB chunks
      // so reverse proxies with a 32MB per-request limit never reject the upload!
      if (file.size > CHUNK_UPLOAD_THRESHOLD_BYTES) {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
        const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        for (let idx = 0; idx < totalChunks; idx++) {
          const start = idx * CHUNK_SIZE_BYTES;
          const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
          const chunkBlob = file.slice(start, end);

          const chunkResp = await fetch(
            `/api/media/upload-chunk?uploadId=${encodeURIComponent(uploadId)}&index=${idx}&total=${totalChunks}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name),
              },
              body: chunkBlob,
            }
          );
          if (!chunkResp.ok) {
            throw new Error(`Chunk ${idx} failed`);
          }
        }

        const finalizeResp = await fetch('/api/media/upload-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            fileName: file.name,
          }),
        });

        if (finalizeResp.ok) {
          const data = await finalizeResp.json();
          if (data && data.url) {
            return {
              url: data.url as string,
              duration:
                typeof data.duration === 'number' && data.duration > 0
                  ? Math.ceil(data.duration)
                  : undefined,
              transcoded: Boolean(data.transcoded),
            };
          }
        }
      }

      // Standard single-POST upload for files <= 12MB
      const resp = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.url) {
          return {
            url: data.url as string,
            duration:
              typeof data.duration === 'number' && data.duration > 0
                ? Math.ceil(data.duration)
                : undefined,
            transcoded: Boolean(data.transcoded),
          };
        }
      }
    } catch {
      // Ignore upload error if offline
    }
    return { url: null };
  };

  const nextTask = uploadQueueChain.then(() => runTask(), () => runTask());
  uploadQueueChain = nextTask.catch(() => {});
  return nextTask;
}

/**
 * Universal prober for any Video (including 4K UHD & old formats) or SWF file.
 * Always resolves with accurate full duration and server-side URL when needed.
 */
export async function probeMediaFileDuration(
  file: File,
  objectUrl: string,
  onLocalDurationReady?: (localDuration: number) => void,
  options?: {
    skipBackendUpload?: boolean;
    skipOfflineVault?: boolean;
  }
): Promise<{
  duration: number;
  isSwf: boolean;
  metadata?: SwfMetadata;
  serverUrl?: string;
  vaultId?: string;
  folderName?: string;
  transcoded?: boolean;
}> {
  const folderName = extractFolderName(file);
  const skipUpload = Boolean(options?.skipBackendUpload);
  const skipVault = Boolean(options?.skipOfflineVault);
  const vaultPromise = skipVault
    ? Promise.resolve(null)
    : saveFileToOfflineVault(file).catch(() => null);

  if (isSwfFile(file)) {
    const meta = await parseSwfMetadata(file);
    swfEngine.registerSwfMetadata(objectUrl, file.name, meta);
    if (onLocalDurationReady) onLocalDurationReady(meta.durationSec);
    const [upRes, vaultRes] = await Promise.all([
      skipUpload ? Promise.resolve({ url: null } as { url: string | null; duration?: number; transcoded?: boolean }) : uploadMediaFileToBackend(file),
      vaultPromise,
    ]);
    const finalDur = upRes.duration && upRes.duration > 0 ? upRes.duration : meta.durationSec;
    meta.durationSec = finalDur;
    if (upRes.url) {
      swfEngine.aliasSwfUrl(objectUrl, upRes.url, file.name, meta);
      if (vaultRes?.vaultId) {
        updateVaultRecordServerUrl(vaultRes.vaultId, upRes.url).catch(() => {});
      }
    }
    return {
      duration: finalDur,
      isSwf: true,
      metadata: meta,
      serverUrl: upRes.url || undefined,
      vaultId: vaultRes?.vaultId,
      folderName,
    };
  }

  if (isImageFile(file)) {
    const defaultImageDur = 15;
    if (onLocalDurationReady) onLocalDurationReady(defaultImageDur);
    const [upRes, vaultRes] = await Promise.all([
      skipUpload ? Promise.resolve({ url: null } as { url: string | null; duration?: number; transcoded?: boolean }) : uploadMediaFileToBackend(file),
      vaultPromise,
    ]);
    if (upRes.url && vaultRes?.vaultId) {
      updateVaultRecordServerUrl(vaultRes.vaultId, upRes.url).catch(() => {});
    }
    return {
      duration: defaultImageDur,
      isSwf: false,
      serverUrl: upRes.url || undefined,
      vaultId: vaultRes?.vaultId,
      folderName,
      transcoded: false,
    };
  }

  const uploadPromise = skipUpload
    ? Promise.resolve({ url: null } as { url: string | null; duration?: number; transcoded?: boolean })
    : uploadMediaFileToBackend(file);

  const durResult = await new Promise<{
    duration: number;
    isSwf: boolean;
    nativeOk: boolean;
    hasValidVideoTrack: boolean;
  }>((resolve) => {
    let settled = false;
    const finish = (dur: number, nativeOk: boolean, hasValidVideoTrack: boolean) => {
      if (settled) return;
      settled = true;
      const cleanDur = Math.max(1, Math.ceil(dur));
      if (nativeOk && onLocalDurationReady) {
        onLocalDurationReady(cleanDur);
      }
      resolve({ duration: cleanDur, isSwf: false, nativeOk, hasValidVideoTrack });
    };

    const timeoutId = setTimeout(() => {
      const estimated = Math.max(30, Math.min(3600, Math.round(file.size / (220 * 1024))));
      finish(estimated, false, false);
    }, 2500);

    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    tempVid.muted = true;
    tempVid.src = objectUrl;
    tempVid.onloadedmetadata = () => {
      clearTimeout(timeoutId);
      const hasValidVideo = tempVid.videoWidth > 0 && tempVid.videoHeight > 0;
      if (tempVid.duration && isFinite(tempVid.duration) && tempVid.duration > 0) {
        finish(tempVid.duration, true, hasValidVideo);
      } else {
        const estimated = Math.max(30, Math.min(3600, Math.round(file.size / (220 * 1024))));
        finish(estimated, false, false);
      }
      tempVid.removeAttribute('src');
      tempVid.load();
    };
    tempVid.onerror = () => {
      clearTimeout(timeoutId);
      const estimated = Math.max(30, Math.min(3600, Math.round(file.size / (220 * 1024))));
      finish(estimated, false, false);
      tempVid.removeAttribute('src');
    };
  });

  const [upRes, vaultRes] = await Promise.all([uploadPromise, vaultPromise]);
  if (upRes.url && vaultRes?.vaultId) {
    updateVaultRecordServerUrl(vaultRes.vaultId, upRes.url).catch(() => {});
  }
  const finalDuration =
    upRes.duration && upRes.duration > 0 ? upRes.duration : durResult.duration;

  return {
    duration: finalDuration,
    isSwf: false,
    serverUrl: upRes.url || undefined,
    vaultId: vaultRes?.vaultId,
    folderName,
    transcoded: Boolean(upRes.transcoded),
  };
}

interface SwfInstance {
  url: string;
  title: string;
  meta: SwfMetadata;
  canvas: HTMLCanvasElement;
  rufflePlayer?: any;
  ruffleReady?: boolean;
  isLoadingRuffle?: boolean;
  hasLoadedRuffleOnce?: boolean;
  isPausedRuffle?: boolean;
  hasRenderedValidFrame: boolean;
  ruffleVerifiedPixels: boolean;
  triedCanvasRendererFallback?: boolean;
  startTimeMs: number;
  lastRenderedAt?: number;
  pendingRestart?: boolean;
  isFetchingBytes?: boolean;
  failedFetchUntil?: number;
  fetchRetries?: number;
  backgroundColor?: string | null;
  variant?: 'banner' | 'logo' | 'fullscreen' | 'lshape';
  // Direct decoded bitmap frames for pure frame-by-frame bitmap-sequence SWFs
  decodedFrames?: ImageBitmap[];
  decodingFrames?: boolean;
  lastCompositeAt?: number;
  lastDecodedFrameIdx?: number;
  chromaKeyMode?: 'pending' | 'none' | 'keyed';
  chromaKeyRgb?: [number, number, number];
  chromaProbeAttempts?: number;
}

let webglContextPatched = false;
function ensureWebGLPreserveDrawingBuffer() {
  if (webglContextPatched || typeof HTMLCanvasElement === 'undefined') return;
  webglContextPatched = true;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (
    type: string,
    attributes?: any
  ) {
    // CRITICAL: Only set preserveDrawingBuffer: true and alpha: true on WebGL/WebGL2.
    // Do NOT override `antialias` (Ruffle passes antialias: false on WebGL2 because it uses
    // offscreen MSAA renderbuffers + gl.blitFramebuffer, and WebGL2 forbids blitFramebuffer
    // into a default framebuffer that has antialias: true!).
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      attributes = {
        ...(attributes || {}),
        preserveDrawingBuffer: true,
        alpha: true,
      };
    }
    return origGetContext.call(this, type as any, attributes);
  };
}

/**
 * Computes a deterministic HD render resolution purely from the SWF's native stage dimensions (stageW × stageH)
 * so different callers never resize `inst.canvas` or trigger Ruffle's ResizeObserver on every frame.
 */
function computeStageHdDimensions(
  stageW: number,
  stageH: number
): { width: number; height: number } {
  const safeW = Math.max(48, stageW || 550);
  const safeH = Math.max(36, stageH || 400);
  const scale = Math.max(1, Math.min(2.5, 1280 / safeW));
  return {
    width: Math.round(safeW * scale),
    height: Math.round(safeH * scale),
  };
}

function parseHexToRgb(hex?: string | null): [number, number, number] | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 6) {
    const num = parseInt(clean, 16);
    if (!Number.isNaN(num)) {
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }
  }
  return null;
}

/**
 * Decodes embedded DefineBitsLossless2 (Tag 36) and DefineBitsLossless (Tag 20) ARGB bitmaps
 * directly from the SWF binary stream into hardware-accelerated ImageBitmaps.
 * Used for bitmap-sequence SWF logos and animations (e.g. 1ashoka English Colors logo.swf)
 * so they render with 100% native 32-bit ARGB alpha transparency immediately!
 */
async function decodeSwfBitmapSequence(bytes: Uint8Array, inst: SwfInstance): Promise<void> {
  if (inst.decodingFrames || (inst.decodedFrames && inst.decodedFrames.length > 0)) return;
  if (!isValidSwfBinary(bytes) || typeof createImageBitmap === 'undefined') return;
  inst.decodingFrames = true;

  try {
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    let body: Uint8Array | null = null;
    if (sig === 'FWS') {
      body = bytes.subarray(8);
    } else if (sig === 'CWS') {
      body = await decompressZlibFull(bytes.subarray(8));
    }
    if (!body || body.length < 16) return;

    const nBits = body[0] >> 3;
    const rectBytes = Math.ceil((5 + nBits * 4) / 8);
    let pos = rectBytes + 4;

    // First scan tags to verify if this SWF is a pure bitmap-sequence animation
    // (where nearly every frame is a DefineBitsLossless2 / DefineBitsLossless bitmap and there are no vector text / morph shape timelines)
    let losslessCount = 0;
    let textOrMorphCount = 0;
    let scanPos = pos;
    while (scanPos + 2 <= body.length) {
      const th = body[scanPos] | (body[scanPos + 1] << 8);
      const tt = th >> 6;
      let tl = th & 0x3f;
      scanPos += 2;
      if (tl === 0x3f) {
        if (scanPos + 4 > body.length) break;
        tl =
          body[scanPos] |
          (body[scanPos + 1] << 8) |
          (body[scanPos + 2] << 16) |
          (body[scanPos + 3] << 24);
        scanPos += 4;
      }
      if (tt === 36 || tt === 20) losslessCount++;
      if (tt === 11 || tt === 33 || tt === 37 || tt === 46) {
        textOrMorphCount++;
      }
      if (tl < 0 || scanPos + tl > body.length || tt === 0) break;
      scanPos += tl;
    }

    // Only use direct bitmap-sequence playback if the SWF is a pure frame-by-frame bitmap sequence (no vector text/morphs)
    const minExpectedBitmaps = Math.max(10, Math.floor((inst.meta.frameCount || 25) * 0.7));
    if (losslessCount < minExpectedBitmaps || textOrMorphCount > 0) {
      return;
    }

    const minFrameW = Math.max(24, Math.floor((inst.meta.width || 100) * 0.65));
    const minFrameH = Math.max(18, Math.floor((inst.meta.height || 60) * 0.65));
    const decoded: ImageBitmap[] = [];
    while (pos + 2 <= body.length) {
      const th = body[pos] | (body[pos + 1] << 8);
      const tt = th >> 6;
      let tl = th & 0x3f;
      pos += 2;
      if (tl === 0x3f) {
        if (pos + 4 > body.length) break;
        tl =
          body[pos] |
          (body[pos + 1] << 8) |
          (body[pos + 2] << 16) |
          (body[pos + 3] << 24);
        pos += 4;
      }
      if (tl < 0 || pos + tl > body.length || tt === 0) break;

      // Tag 36 = DefineBitsLossless2 (32-bit premultiplied ARGB), Tag 20 = DefineBitsLossless (24-bit RGB)
      if ((tt === 36 || tt === 20) && tl > 7) {
        const fmt = body[pos + 2];
        const bw = body[pos + 3] | (body[pos + 4] << 8);
        const bh = body[pos + 5] | (body[pos + 6] << 8);
        if (fmt === 5 && bw >= minFrameW && bh >= minFrameH && bw <= 2048 && bh <= 2048) {
          const zSlice = body.subarray(pos + 7, pos + tl);
          const rawArgb = await decompressZlibFull(zSlice);
          if (rawArgb && rawArgb.length >= bw * bh * 4) {
            const rgba = new Uint8ClampedArray(bw * bh * 4);
            const hasAlpha = tt === 36;
            for (let i = 0, n = bw * bh * 4; i < n; i += 4) {
              const a = hasAlpha ? rawArgb[i] : 255;
              if (a === 0) {
                rgba[i] = 0;
                rgba[i + 1] = 0;
                rgba[i + 2] = 0;
                rgba[i + 3] = 0;
              } else if (a === 255 || !hasAlpha) {
                rgba[i] = rawArgb[i + 1];
                rgba[i + 1] = rawArgb[i + 2];
                rgba[i + 2] = rawArgb[i + 3];
                rgba[i + 3] = 255;
              } else {
                // Un-premultiply ARGB -> straight RGBA for ImageData
                rgba[i] = Math.min(255, Math.round((rawArgb[i + 1] * 255) / a));
                rgba[i + 1] = Math.min(255, Math.round((rawArgb[i + 2] * 255) / a));
                rgba[i + 2] = Math.min(255, Math.round((rawArgb[i + 3] * 255) / a));
                rgba[i + 3] = a;
              }
            }
            const imgData = new ImageData(rgba, bw, bh);
            const bmp = await createImageBitmap(imgData);
            decoded.push(bmp);
            if (!inst.decodedFrames) {
              inst.decodedFrames = decoded;
              inst.hasRenderedValidFrame = true;
              inst.ruffleVerifiedPixels = true;
            }
          }
        }
      }
      pos += tl;
    }

    if (decoded.length > 0) {
      inst.decodedFrames = decoded;
      inst.hasRenderedValidFrame = true;
      inst.ruffleVerifiedPixels = true;
    }
  } catch {
    // Ignore bitmap decode errors and let Ruffle render
  }
}

class SwfBroadcastEngine {
  private instances: Map<string, SwfInstance> = new Map();
  private metaByUrl: Map<string, { title: string; meta: SwfMetadata }> = new Map();
  private ruffleLoaded: boolean = false;
  private ruffleLoading: boolean = false;
  private hiddenContainer: HTMLDivElement | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      ensureWebGLPreserveDrawingBuffer();
      this.ensureRuffleScript();
    }
  }

  private syncInstanceDimensions(inst: SwfInstance, stageW: number, stageH: number) {
    if (stageW <= 0 || stageH <= 0) return;
    inst.meta.width = stageW;
    inst.meta.height = stageH;
    const hd = computeStageHdDimensions(stageW, stageH);
    if (
      Math.abs(inst.canvas.width - hd.width) > 4 ||
      Math.abs(inst.canvas.height - hd.height) > 4
    ) {
      inst.canvas.width = hd.width;
      inst.canvas.height = hd.height;
      if (inst.rufflePlayer) {
        inst.rufflePlayer.style.width = `${hd.width}px`;
        inst.rufflePlayer.style.height = `${hd.height}px`;
      }
    }
  }

  public registerSwfMetadata(url: string, fileName: string, meta: SwfMetadata) {
    const cleanTitle = (fileName || 'SWF BROADCAST').replace(/\.[^/.]+$/, '').toUpperCase();
    this.metaByUrl.set(url, { title: cleanTitle, meta });

    const existing = this.instances.get(url);
    if (existing) {
      existing.meta = meta;
      existing.title = cleanTitle;
      if (meta.backgroundColor && !existing.backgroundColor) {
        existing.backgroundColor = meta.backgroundColor;
      }
      this.syncInstanceDimensions(existing, meta.width, meta.height);
      if (meta.rawBytes && isValidSwfBinary(meta.rawBytes)) {
        decodeSwfBitmapSequence(meta.rawBytes, existing);
      }
    } else {
      this.preloadSwf(url, cleanTitle, meta);
    }
  }

  public aliasSwfUrl(sourceUrl: string, aliasUrl: string, fileName: string, meta: SwfMetadata) {
    const cleanTitle = (fileName || 'SWF BROADCAST').replace(/\.[^/.]+$/, '').toUpperCase();
    this.metaByUrl.set(aliasUrl, { title: cleanTitle, meta });
    const existing = this.instances.get(sourceUrl);
    if (existing) {
      this.instances.set(aliasUrl, existing);
      this.syncInstanceDimensions(existing, meta.width, meta.height);
    } else {
      this.registerSwfMetadata(aliasUrl, fileName, meta);
    }
  }

  /**
   * Pauses an SWF animation in-place without losing elapsed playback progress.
   */
  public pauseSwf(url?: string) {
    if (!url) return;
    const inst = this.instances.get(url);
    if (!inst) return;
    try {
      if (inst.rufflePlayer && typeof inst.rufflePlayer.pause === 'function') {
        inst.rufflePlayer.pause();
        inst.isPausedRuffle = true;
      }
    } catch {
      // Ignore pause errors
    }
  }

  /**
   * Resumes an SWF animation at a specific elapsed second offset (used when returning from Every N Min Ads or Scheduled Programs).
   */
  public resumeSwfAt(url?: string, elapsedSec: number = 0) {
    if (!url) return;
    const safeElapsed = Number.isFinite(elapsedSec) && elapsedSec > 0 ? elapsedSec : 0;
    if (safeElapsed <= 0.05) {
      this.restartSwf(url);
      return;
    }
    const inst = this.instances.get(url);
    if (!inst) {
      this.preloadSwf(url);
      const created = this.instances.get(url);
      if (created) {
        created.startTimeMs = performance.now() - safeElapsed * 1000;
        created.pendingRestart = false;
      }
      return;
    }
    inst.startTimeMs = performance.now() - safeElapsed * 1000;
    inst.pendingRestart = false;
    try {
      if (!inst.rufflePlayer) {
        this.tryAttachRuffle(inst);
        return;
      }
      if (!inst.isLoadingRuffle && inst.isPausedRuffle && typeof inst.rufflePlayer.play === 'function') {
        inst.isPausedRuffle = false;
        inst.rufflePlayer.play();
      }
    } catch {
      // Ignore play resume errors
    }
  }

  /**
   * Rewinds/restarts an SWF animation from Frame 1 when its turn in a back-to-back playlist starts
   * or when it finishes a full cycle from Frame 1 to End.
   */
  public restartSwf(url?: string) {
    if (!url) return;
    const inst = this.instances.get(url);
    if (!inst) {
      this.preloadSwf(url);
      const created = this.instances.get(url);
      if (created) {
        created.pendingRestart = true;
      }
      return;
    }
    inst.startTimeMs = performance.now();
    inst.pendingRestart = false;
    this.reloadRuffleFromFrame1(inst);
  }

  private reloadRuffleFromFrame1(inst: SwfInstance) {
    inst.startTimeMs = performance.now();
    inst.pendingRestart = false;
    if (!inst.rufflePlayer) {
      this.tryAttachRuffle(inst);
      return;
    }
    if (inst.isLoadingRuffle) {
      return;
    }
    try {
      if (inst.isPausedRuffle && typeof inst.rufflePlayer.play === 'function') {
        inst.isPausedRuffle = false;
        inst.rufflePlayer.play();
      }
    } catch {
      // Ignore play resume errors
    }
  }

  private recycleIdleRufflePlayers(activeInst: SwfInstance, now: number) {
    const visited = new Set<SwfInstance>();
    visited.add(activeInst);
    const activePlayers: Array<{ inst: SwfInstance; idleMs: number }> = [];
    this.instances.forEach((other) => {
      if (visited.has(other) || !other.rufflePlayer || other.isLoadingRuffle) return;
      visited.add(other);
      const idleMs = other.lastRenderedAt ? now - other.lastRenderedAt : now - other.startTimeMs;
      activePlayers.push({ inst: other, idleMs });
      // Pause idle Ruffle WebGL instances after 15s of off-air inactivity to save CPU
      if (idleMs > 15000 && !other.isPausedRuffle) {
        try {
          if (typeof other.rufflePlayer.pause === 'function') {
            other.rufflePlayer.pause();
            other.isPausedRuffle = true;
          }
        } catch {
          // Ignore pause errors
        }
      }
      // Fully detach dormant Ruffle WebGL contexts idle for >45s (bytes + decodedFrames remain cached for instant restart)
      if (idleMs > 45000) {
        try {
          other.rufflePlayer.remove?.();
        } catch {}
        other.rufflePlayer = undefined;
        other.isPausedRuffle = false;
      }
    });

    // Enforce hard WebGL player cap (max 4 simultaneous Ruffle contexts per window) to prevent high GPU/RAM usage
    if (activePlayers.length > 4) {
      activePlayers
        .filter((e) => e.inst.rufflePlayer && e.idleMs > 2500)
        .sort((a, b) => b.idleMs - a.idleMs)
        .slice(0, activePlayers.length - 3)
        .forEach(({ inst }) => {
          try {
            inst.rufflePlayer?.pause?.();
            inst.rufflePlayer?.remove?.();
          } catch {}
          inst.rufflePlayer = undefined;
          inst.isPausedRuffle = false;
        });
    }
  }

  /**
   * Returns the real parsed duration (in seconds) of an SWF if available, or fallbackDur.
   */
  public getRealSwfDurationSec(url?: string, fallbackDur: number = 15): number {
    if (!url) return fallbackDur;
    const saved = this.metaByUrl.get(url);
    if (saved?.meta?.durationSec && saved.meta.durationSec > 2) {
      return saved.meta.durationSec;
    }
    const inst = this.instances.get(url);
    if (inst?.meta?.durationSec && inst.meta.durationSec > 2 && inst.meta.frameCount !== 375) {
      return inst.meta.durationSec;
    }
    return fallbackDur;
  }

  /**
   * Preloads & caches the SWF binary bytes and exact frame count / duration metadata in memory
   * without spawning background WebGL contexts before the SWF goes on air.
   */
  public preloadSwf(
    url: string,
    title: string = '',
    meta?: SwfMetadata,
    variant?: 'banner' | 'logo' | 'fullscreen' | 'lshape'
  ) {
    if (!url) return;
    if (url.startsWith('data:image/') || url.startsWith('data:video/')) return;
    ensureWebGLPreserveDrawingBuffer();
    this.ensureRuffleScript();

    const saved = this.metaByUrl.get(url);
    const cleanTitle = (title || saved?.title || 'SWF BROADCAST').replace(/\.[^/.]+$/, '').toUpperCase();

    if (meta) {
      this.metaByUrl.set(url, { title: cleanTitle, meta });
    }

    let inst = this.instances.get(url);
    if (!inst) {
      const resolvedMeta: SwfMetadata = meta ||
        saved?.meta || {
          isSwf: true,
          version: 10,
          width: 550,
          height: 400,
          frameRate: 25,
          frameCount: 375,
          durationSec: 15,
        };
      const hd = computeStageHdDimensions(resolvedMeta.width, resolvedMeta.height);
      const canvas = document.createElement('canvas');
      canvas.width = hd.width;
      canvas.height = hd.height;

      inst = {
        url,
        title: cleanTitle,
        meta: resolvedMeta,
        canvas,
        hasRenderedValidFrame: false,
        ruffleVerifiedPixels: false,
        startTimeMs: performance.now(),
        backgroundColor: resolvedMeta.backgroundColor || null,
        variant,
      };
      this.instances.set(url, inst);
    } else if (variant && !inst.variant) {
      inst.variant = variant;
    }

    if (
      (!inst.meta.rawBytes || !isValidSwfBinary(inst.meta.rawBytes)) &&
      !inst.isFetchingBytes &&
      (!inst.failedFetchUntil || Date.now() >= inst.failedFetchUntil)
    ) {
      inst.isFetchingBytes = true;
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('fetch failed'))))
        .catch(async () => {
          const fallbackName = cleanTitle && !cleanTitle.startsWith('http') ? cleanTitle : '';
          if (fallbackName && !url.includes('/api/media/by-name/')) {
            try {
              const r2 = await fetch(`/api/media/by-name/${encodeURIComponent(fallbackName)}`);
              if (r2.ok) return await r2.arrayBuffer();
            } catch {}
          }
          const rec = await getMediaFromOfflineVault(undefined, cleanTitle || url);
          if (rec?.file) {
            return rec.file.arrayBuffer();
          }
          throw new Error('SWF binary not found in offline vault');
        })
        .then(async (buf) => {
          const bytes = new Uint8Array(buf);
          if (!isValidSwfBinary(bytes)) return;
          inst!.failedFetchUntil = undefined;
          inst!.fetchRetries = 0;
          const parsed = await parseSwfBytes(bytes);
          inst!.meta = parsed;
          this.metaByUrl.set(url, { title: inst!.title, meta: parsed });
          if (parsed.backgroundColor && !inst!.backgroundColor) {
            inst!.backgroundColor = parsed.backgroundColor;
          }
          this.syncInstanceDimensions(inst!, parsed.width, parsed.height);
          decodeSwfBitmapSequence(bytes, inst!);
        })
        .catch(() => {
          if (inst) {
            const tries = (inst.fetchRetries || 0) + 1;
            inst.fetchRetries = tries;
            const backoffMs = Math.min(15000, tries <= 1 ? 1000 : tries === 2 ? 2000 : tries === 3 ? 4000 : 8000);
            inst.failedFetchUntil = Date.now() + backoffMs;
          }
        })
        .finally(() => {
          if (inst) inst.isFetchingBytes = false;
        });
    }
  }

  /**
   * Pre-warms the SWF binary bytes & active Ruffle WASM player cleanly without spawning redundant WebGL contexts.
   */
  public warmSwfPlayer(
    url: string,
    title: string = '',
    targetW: number = 1920,
    targetH: number = 200,
    variant: 'banner' | 'logo' | 'fullscreen' | 'lshape' = 'banner'
  ) {
    if (!url || typeof window === 'undefined') return;
    const safeW = Math.min(1920, Math.max(32, Math.round(targetW || 1920)));
    const safeH = Math.min(1080, Math.max(32, Math.round(targetH || 200)));
    this.preloadSwf(url, title, undefined, variant);
    const inst = this.instances.get(url);
    if (!inst) return;
    inst.variant = variant;
    if (variant === 'banner' || variant === 'fullscreen') {
      inst.chromaKeyMode = 'none';
    }
    if (inst.canvas.width === 0 || inst.canvas.height === 0) {
      const hd = computeStageHdDimensions(safeW, safeH);
      inst.canvas.width = hd.width;
      inst.canvas.height = hd.height;
    }
    if (inst.decodedFrames && inst.decodedFrames.length > 0) {
      // Pure bitmap-sequence SWF decoded directly to GPU ImageBitmaps: zero Ruffle WebGL overhead needed!
      return;
    }
    if (!inst.rufflePlayer && this.ruffleLoaded && !inst.isLoadingRuffle) {
      this.tryAttachRuffle(inst, variant);
    }
  }

  public isSwfUrl(url?: string, title?: string): boolean {
    if (!url && !title) return false;
    if (url) {
      const uLower = url.toLowerCase().trim();
      if (uLower.startsWith('data:image/') || uLower.startsWith('data:video/')) {
        return false;
      }
      const cleanPath = uLower.split('?')[0];
      const urlExt = getFileExtension(cleanPath);
      if (
        urlExt &&
        urlExt !== 'swf' &&
        (IMAGE_EXTENSIONS.has(urlExt) || VIDEO_EXTENSIONS.has(urlExt))
      ) {
        return false;
      }
      if (this.metaByUrl.has(url)) return true;
      if (this.instances.has(url)) return true;
      if (cleanPath.endsWith('.swf') || uLower.includes('.swf')) return true;
    }
    if (title && title.toLowerCase().trim().endsWith('.swf')) return true;
    return false;
  }

  public getSwfMetadata(url: string): { title: string; meta: SwfMetadata } | undefined {
    return this.metaByUrl.get(url);
  }

  public hasRenderedFrame(url: string): boolean {
    if (!url) return false;
    const inst = this.instances.get(url);
    if (!inst) return false;
    return Boolean(
      inst.hasRenderedValidFrame ||
        inst.ruffleVerifiedPixels ||
        (inst.decodedFrames && inst.decodedFrames.length > 0)
    );
  }

  private ensureRuffleScript() {
    if (this.ruffleLoaded || this.ruffleLoading || typeof document === 'undefined') return;
    ensureWebGLPreserveDrawingBuffer();
    if ((window as any).RufflePlayer && typeof (window as any).RufflePlayer.newest === 'function') {
      this.ruffleLoaded = true;
      return;
    }
    this.ruffleLoading = true;
    (window as any).RufflePlayer = (window as any).RufflePlayer || {};
    (window as any).RufflePlayer.config = {
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      splashScreen: false,
      contextMenu: 'off',
      preferredRenderer: 'webgl',
      quality: 'best',
      letterbox: 'off',
      scale: 'exactFit',
      forceScale: true,
      salign: '',
      wmode: 'transparent',
      backgroundColor: null,
      backgroundExecutionMode: 'mainThread',
      publicPath: '/ruffle/',
    };
    const onRuffleReady = () => {
      this.ruffleLoaded = true;
      this.ruffleLoading = false;
      this.instances.forEach((inst) => {
        if (!inst.rufflePlayer && inst.lastRenderedAt) {
          this.tryAttachRuffle(inst, inst.variant);
        }
      });
    };
    const script = document.createElement('script');
    script.src = '/ruffle/ruffle.js';
    script.async = true;
    script.onload = onRuffleReady;
    script.onerror = () => {
      delete (window as any).RufflePlayer.config.publicPath;
      const cdnScript = document.createElement('script');
      cdnScript.src = 'https://unpkg.com/@ruffle-rs/ruffle';
      cdnScript.async = true;
      cdnScript.onload = onRuffleReady;
      cdnScript.onerror = () => {
        this.ruffleLoading = false;
      };
      document.head.appendChild(cdnScript);
    };
    document.head.appendChild(script);
  }

  private getContainer(): HTMLDivElement {
    if (!this.hiddenContainer) {
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.bottom = '0px';
      div.style.right = '0px';
      div.style.width = '1280px';
      div.style.height = '720px';
      div.style.overflow = 'hidden';
      div.style.opacity = '0.015';
      div.style.pointerEvents = 'none';
      div.style.zIndex = '999999';
      div.style.background = 'transparent';
      document.body.appendChild(div);
      this.hiddenContainer = div;
    }
    return this.hiddenContainer;
  }

  /**
   * Returns a live-rendered Full-HD HTMLCanvasElement for an SWF file.
   */
  public renderSwfToCanvas(
    url: string,
    fallbackTitle: string,
    timestamp: number,
    targetW: number = 1920,
    targetH: number = 200,
    variant: 'banner' | 'logo' | 'fullscreen' | 'lshape' = 'banner'
  ): HTMLCanvasElement {
    this.ensureRuffleScript();

    let inst = this.instances.get(url);
    const saved = this.metaByUrl.get(url);
    const meta: SwfMetadata = saved?.meta || {
      isSwf: true,
      version: 10,
      width: targetW,
      height: targetH,
      frameRate: 25,
      frameCount: 375,
      durationSec: 15,
    };
    const title = (saved?.title || fallbackTitle || 'SWF BROADCAST')
      .replace(/\.[^/.]+$/, '')
      .toUpperCase();

    if (!inst) {
      const hd = computeStageHdDimensions(meta.width || targetW, meta.height || targetH);
      const canvas = document.createElement('canvas');
      canvas.width = hd.width;
      canvas.height = hd.height;

      inst = {
        url,
        title,
        meta,
        canvas,
        hasRenderedValidFrame: false,
        ruffleVerifiedPixels: false,
        startTimeMs: performance.now(),
        backgroundColor: meta.backgroundColor || null,
        variant,
      };
      this.instances.set(url, inst);
      if (meta.rawBytes && isValidSwfBinary(meta.rawBytes)) {
        decodeSwfBitmapSequence(meta.rawBytes, inst);
      }
      this.tryAttachRuffle(inst, variant);
    } else if (variant && inst.variant !== variant) {
      inst.variant = variant;
      if (variant === 'banner' || variant === 'fullscreen') {
        inst.chromaKeyMode = 'none';
      }
    }

    const now = performance.now();
    inst.lastRenderedAt = now;

    // Keep off-air Ruffle instances warm across ads; pause only long-unused ones
    this.recycleIdleRufflePlayers(inst, now);

    if (!inst.rufflePlayer && this.ruffleLoaded) {
      this.tryAttachRuffle(inst, variant);
    } else if (inst.rufflePlayer) {
      const targetDurMs = Math.max(2, inst.meta.durationSec || 15) * 1000;
      if (inst.pendingRestart) {
        this.reloadRuffleFromFrame1(inst);
      } else if (inst.isPausedRuffle) {
        // Resume cleanly from pause (e.g. after long ad) without reloading or stalling
        inst.isPausedRuffle = false;
        try {
          if (!inst.isLoadingRuffle && typeof inst.rufflePlayer.play === 'function') {
            inst.rufflePlayer.play();
          }
        } catch {}
      } else if (inst.ruffleReady && now - inst.startTimeMs >= targetDurMs) {
        this.reloadRuffleFromFrame1(inst);
      }
    }

    const canvas = inst.canvas;
    const isOpaqueStage = variant === 'fullscreen' || variant === 'banner';
    const targetFps = Math.max(12, Math.min(30, inst.meta.frameRate || 25));
    const minFrameGapMs = 1000 / targetFps;

    // 1. For pure 32-bit ARGB bitmap-sequence SWFs,
    // render directly from decoded lossless ImageBitmaps ONLY when the frame index actually changes!
    if (inst.decodedFrames && inst.decodedFrames.length > 0) {
      const fps = inst.meta.frameRate || 25;
      const elapsedSec = Math.max(0, ((timestamp || now) - inst.startTimeMs) / 1000);
      const frameIdx = Math.floor(elapsedSec * fps) % inst.decodedFrames.length;
      if (inst.hasRenderedValidFrame && inst.lastDecodedFrameIdx === frameIdx) {
        return canvas;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;
      const frameBmp = inst.decodedFrames[frameIdx];
      if (frameBmp) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (isOpaqueStage) {
          ctx.fillStyle = inst.backgroundColor || '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(frameBmp, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        if (variant === 'logo' || variant === 'lshape') {
          this.applyCachedChromaKey(inst, ctx, canvas.width, canvas.height, variant);
        }
        inst.lastDecodedFrameIdx = frameIdx;
        inst.lastCompositeAt = now;
        inst.ruffleVerifiedPixels = true;
        inst.hasRenderedValidFrame = true;
        return canvas;
      }
    }

    // Throttle WebGL -> 2D canvas readback to the SWF's native framerate (max 30fps) so video playback stays silky smooth at 60fps
    if (
      inst.hasRenderedValidFrame &&
      inst.lastCompositeAt &&
      now - inst.lastCompositeAt < minFrameGapMs
    ) {
      return canvas;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // 2. Copy from Ruffle's live internal canvas (opaque stage for banners/fullscreen, transparent wmode only for logos/lshape)
    if (inst.rufflePlayer && inst.rufflePlayer.shadowRoot) {
      const ruffleCanvas = inst.rufflePlayer.shadowRoot.querySelector(
        'canvas'
      ) as HTMLCanvasElement | null;
      if (ruffleCanvas && ruffleCanvas.width > 0 && ruffleCanvas.height > 0) {
        try {
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // Paint solid stage background for banners & fullscreen SWFs so they play opaque without unwanted transparency
          if (isOpaqueStage) {
            ctx.fillStyle = inst.backgroundColor || '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(
            ruffleCanvas,
            0,
            0,
            ruffleCanvas.width,
            ruffleCanvas.height,
            0,
            0,
            canvas.width,
            canvas.height
          );
          ctx.restore();

          if (variant === 'logo' || variant === 'lshape') {
            const hasVisible = this.applyCachedChromaKey(
              inst,
              ctx,
              canvas.width,
              canvas.height,
              variant
            );
            if (hasVisible) {
              inst.ruffleReady = true;
              inst.ruffleVerifiedPixels = true;
              inst.hasRenderedValidFrame = true;
              inst.lastCompositeAt = now;
            }
          } else {
            inst.ruffleReady = true;
            inst.ruffleVerifiedPixels = true;
            inst.hasRenderedValidFrame = true;
            inst.lastCompositeAt = now;
          }
          return canvas;
        } catch {
          // Ignore transient drawImage error
        }
      }
    }

    // While Ruffle is warming up its very first frame, keep previous valid frame or clean canvas
    if (!inst.hasRenderedValidFrame) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return canvas;
  }

  /**
   * Probes edge transparency ONCE when an SWF renders its first visible frame:
   * - Never runs on banners or fullscreen SWFs (they render 100% solid/opaque as authored).
   * - If corners already have native PNG-like alpha (wmode: 'transparent' / DefineBitsLossless2), marks
   *   `inst.chromaKeyMode = 'none'` so ZERO getImageData/putImageData calls run on subsequent frames!
   * - Only if opaque solid stage corners are detected on logos/lshape does it record `inst.chromaKeyRgb` and key that color out.
   */
  private applyCachedChromaKey(
    inst: SwfInstance,
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    variant: 'banner' | 'logo' | 'fullscreen' | 'lshape'
  ): boolean {
    if (variant === 'banner' || variant === 'fullscreen') return true;
    if (w <= 4 || h <= 4) return false;
    if (inst.chromaKeyMode === 'none') {
      return true;
    }

    try {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      if (inst.chromaKeyMode !== 'keyed') {
        let hasVisiblePixel = false;
        const step = Math.max(16, Math.floor((w * h) / 400) * 4);
        for (let i = 3; i < data.length; i += step) {
          if (data[i] > 15) {
            hasVisiblePixel = true;
            break;
          }
        }
        if (!hasVisiblePixel) {
          return false;
        }

        const getPx = (x: number, y: number): [number, number, number, number] => {
          const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
          const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
          const idx = (cy * w + cx) * 4;
          return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
        };

        const cornerSamples = [
          getPx(2, 2),
          getPx(w - 3, 2),
          getPx(2, h - 3),
          getPx(w - 3, h - 3),
          getPx(w / 2, 2),
          getPx(w / 2, h - 3),
          getPx(2, h / 2),
          getPx(w - 3, h / 2),
        ];
        const opaqueCorners = cornerSamples.filter((c) => c[3] > 200);

        if (opaqueCorners.length < 3) {
          inst.chromaKeyMode = 'none';
          return true;
        }

        const stageRgb = parseHexToRgb(inst.backgroundColor);
        let keyColor: [number, number, number] | null = null;

        if (variant === 'lshape') {
          const nearBlackCorners = opaqueCorners.filter(
            (c) => c[0] <= 36 && c[1] <= 36 && c[2] <= 36
          );
          if (nearBlackCorners.length >= 3) {
            keyColor = [nearBlackCorners[0][0], nearBlackCorners[0][1], nearBlackCorners[0][2]];
          }
          if (!keyColor && stageRgb) {
            const matchingStage = opaqueCorners.filter(
              (c) =>
                Math.abs(c[0] - stageRgb[0]) +
                  Math.abs(c[1] - stageRgb[1]) +
                  Math.abs(c[2] - stageRgb[2]) <
                48
            );
            if (matchingStage.length >= 3) keyColor = stageRgb;
          }
          if (!keyColor) {
            const whiteCorners = opaqueCorners.filter(
              (c) => c[0] >= 236 && c[1] >= 236 && c[2] >= 236
            );
            if (whiteCorners.length >= 3) keyColor = [255, 255, 255];
          }
        } else {
          if (stageRgb) {
            const matchingStage = opaqueCorners.filter(
              (c) =>
                Math.abs(c[0] - stageRgb[0]) +
                  Math.abs(c[1] - stageRgb[1]) +
                  Math.abs(c[2] - stageRgb[2]) <
                48
            );
            if (matchingStage.length >= 2) keyColor = stageRgb;
          }
          if (!keyColor) {
            for (const candidate of opaqueCorners) {
              const matches = opaqueCorners.filter(
                (c) =>
                  Math.abs(c[0] - candidate[0]) +
                    Math.abs(c[1] - candidate[1]) +
                    Math.abs(c[2] - candidate[2]) <
                  42
              );
              if (matches.length >= 3) {
                keyColor = [candidate[0], candidate[1], candidate[2]];
                break;
              }
            }
          }
          if (!keyColor && stageRgb) keyColor = stageRgb;
        }

        if (!keyColor) {
          inst.chromaKeyMode = 'none';
          return true;
        }

        inst.chromaKeyMode = 'keyed';
        inst.chromaKeyRgb = keyColor;
      }

      const [kr, kg, kb] = inst.chromaKeyRgb!;
      const innerTol = 26;
      const outerTol = 62;
      let nonBgPixels = 0;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) continue;
        const dist =
          Math.abs(data[i] - kr) + Math.abs(data[i + 1] - kg) + Math.abs(data[i + 2] - kb);
        if (dist <= innerTol) {
          data[i + 3] = 0;
        } else if (dist < outerTol) {
          const factor = (dist - innerTol) / (outerTol - innerTol);
          data[i + 3] = Math.round(a * factor);
          nonBgPixels++;
        } else {
          nonBgPixels++;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      return nonBgPixels > 8;
    } catch {
      return true;
    }
  }

  private tryAttachRuffle(
    inst: SwfInstance,
    variant?: 'banner' | 'logo' | 'fullscreen' | 'lshape'
  ) {
    try {
      const RufflePlayer = (window as any).RufflePlayer;
      if (
        !RufflePlayer ||
        typeof RufflePlayer.newest !== 'function' ||
        inst.rufflePlayer ||
        inst.isLoadingRuffle
      ) {
        return;
      }
      inst.isLoadingRuffle = true;
      const effectiveVariant = variant || inst.variant || 'banner';
      if (!inst.variant) inst.variant = effectiveVariant;
      const useTransparentStage = effectiveVariant === 'logo' || effectiveVariant === 'lshape';

      const ruffle = RufflePlayer.newest();
      const player = ruffle.createPlayer();
      player.style.position = 'absolute';
      player.style.top = '0px';
      player.style.left = '0px';
      player.style.display = 'block';
      player.style.background = useTransparentStage ? 'transparent' : inst.backgroundColor || '#000000';
      player.style.backgroundColor = useTransparentStage ? 'transparent' : inst.backgroundColor || '#000000';
      player.style.width = `${inst.canvas.width}px`;
      player.style.height = `${inst.canvas.height}px`;
      this.getContainer().appendChild(player);
      inst.rufflePlayer = player;

      if (typeof player.load === 'function') {
        const baseConfig = {
          autoplay: 'on',
          unmuteOverlay: 'hidden',
          splashScreen: false,
          contextMenu: 'off',
          quality: 'best',
          letterbox: 'off',
          scale: 'exactFit',
          forceScale: true,
          salign: '',
          backgroundColor: useTransparentStage ? null : inst.backgroundColor || '#000000',
          wmode: useTransparentStage ? 'transparent' : 'opaque',
          backgroundExecutionMode: 'mainThread',
        };

        if (inst.meta?.rawBytes && isValidSwfBinary(inst.meta.rawBytes)) {
          decodeSwfBitmapSequence(inst.meta.rawBytes, inst);
          inst.startTimeMs = performance.now();
          // Pass a fresh Uint8Array copy so Ruffle never detaches inst.meta.rawBytes
          player
            .load({
              ...baseConfig,
              data: new Uint8Array(inst.meta.rawBytes),
            })
            .then(() => {
              inst.startTimeMs = performance.now();
              inst.ruffleReady = true;
              inst.hasLoadedRuffleOnce = true;
            })
            .catch(() => {})
            .finally(() => {
              inst.isLoadingRuffle = false;
            });
        } else if (
          inst.url &&
          !inst.url.startsWith('data:image/') &&
          (!inst.failedFetchUntil || Date.now() >= inst.failedFetchUntil)
        ) {
          fetch(inst.url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('fetch failed'))))
            .catch(async () => {
              const fallbackName = inst.title && !inst.title.startsWith('http') ? inst.title : '';
              if (fallbackName && !inst.url.includes('/api/media/by-name/')) {
                try {
                  const r2 = await fetch(`/api/media/by-name/${encodeURIComponent(fallbackName)}`);
                  if (r2.ok) return await r2.arrayBuffer();
                } catch {}
              }
              const rec = await getMediaFromOfflineVault(undefined, inst.title || inst.url);
              if (rec?.file) {
                return rec.file.arrayBuffer();
              }
              throw new Error('SWF binary not found in offline vault');
            })
            .then(async (buf) => {
              if (!buf) return;
              const bytes = new Uint8Array(buf);
              if (!isValidSwfBinary(bytes)) {
                return;
              }
              inst.failedFetchUntil = undefined;
              inst.fetchRetries = 0;
              const parsed = await parseSwfBytes(bytes);
              inst.meta = parsed;
              this.metaByUrl.set(inst.url, { title: inst.title, meta: parsed });
              if (parsed.backgroundColor && !inst.backgroundColor) {
                inst.backgroundColor = parsed.backgroundColor;
              }
              this.syncInstanceDimensions(inst, parsed.width, parsed.height);
              decodeSwfBitmapSequence(bytes, inst);
              inst.startTimeMs = performance.now();
              return player
                .load({
                  ...baseConfig,
                  width: inst.canvas.width,
                  height: inst.canvas.height,
                  backgroundColor: useTransparentStage ? null : inst.backgroundColor || '#000000',
                  wmode: useTransparentStage ? 'transparent' : 'opaque',
                  data: new Uint8Array(bytes),
                })
                .then(() => {
                  inst.startTimeMs = performance.now();
                  inst.ruffleReady = true;
                  inst.hasLoadedRuffleOnce = true;
                });
            })
            .catch(() => {
              const tries = (inst.fetchRetries || 0) + 1;
              inst.fetchRetries = tries;
              const backoffMs = Math.min(15000, tries <= 1 ? 1000 : tries === 2 ? 2000 : tries === 3 ? 4000 : 8000);
              inst.failedFetchUntil = Date.now() + backoffMs;
            })
            .finally(() => {
              inst.isLoadingRuffle = false;
            });
        } else {
          inst.isLoadingRuffle = false;
        }
      } else {
        inst.isLoadingRuffle = false;
      }
    } catch {
      inst.isLoadingRuffle = false;
    }
  }
}

export const swfEngine = new SwfBroadcastEngine();
