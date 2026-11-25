import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import {
  generateAshokaIcoBuffer,
  buildSelfExtractingOfflineOnlineSetupExe,
  buildStandaloneUninstallerExe,
  generateObsStyleInstallerHta,
  generateUninstallerHta,
  generateUninstallBat,
  buildZipArchiveBuffer,
} from './src/server/windowsExeBuilder';
import {
  KANISHQ_MASTER_KEY,
  StationLicenseRecord,
  computeLicenseSignature,
  evaluateLicenseStatus,
  verifyLicenseSignature,
} from './src/utils/licenseCrypto';
import {
  parseYouTubeBatchInput,
  YOUTUBE_VIDEO_ID_REGEX,
  YOUTUBE_PLAYLIST_ID_REGEX,
} from './src/utils/youtubeLive';
import {
  compactChannel,
  compactCgStatePayload,
  compactPlayoutStateEnvelope,
} from './src/utils/stateCompactor';
import type { YouTubeQueueItem } from './src/types/playout';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure multi-resolution Windows .ico file & persistent data/upload directories exist
const assetsDir = path.join(__dirname, 'public', 'assets');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const dataDir = path.join(__dirname, 'data');
const stateFilePath = path.join(dataDir, 'ashoka_playout_state.json');
const cgStateFilePath = path.join(dataDir, 'ashoka_cg_state.json');
const mediaRegistryPath = path.join(dataDir, 'media_registry.json');

try {
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'ashoka-icon.ico'), generateAshokaIcoBuffer());
} catch {}

interface MediaRegistryEntry {
  url: string;
  fileName: string;
  safeName: string;
  duration?: number;
  transcoded?: boolean;
  fileSize?: number;
  updatedAt: string;
}

function loadMediaRegistry(): Record<string, MediaRegistryEntry> {
  try {
    if (fs.existsSync(mediaRegistryPath)) {
      const raw = fs.readFileSync(mediaRegistryPath, 'utf-8');
      const parsed = JSON.parse(raw) || {};
      const compactStr = JSON.stringify(parsed);
      if (raw.length > compactStr.length + 128) {
        try {
          fs.writeFileSync(mediaRegistryPath, compactStr, 'utf-8');
        } catch {}
      }
      return parsed;
    }
  } catch {}
  return {};
}

function saveMediaRegistry(reg: Record<string, MediaRegistryEntry>) {
  try {
    fs.writeFileSync(mediaRegistryPath, JSON.stringify(reg), 'utf-8');
  } catch {}
}

let mediaRegistry: Record<string, MediaRegistryEntry> = loadMediaRegistry();

function parseSwfDurationSecFromDisk(filePath: string): number | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const buf = fs.readFileSync(filePath);
    if (buf.length < 12) return undefined;
    const sig = buf.subarray(0, 3).toString('ascii');
    if (sig !== 'FWS' && sig !== 'CWS') return undefined;
    const body = sig === 'CWS' ? zlib.inflateSync(buf.subarray(8)) : buf.subarray(8);
    if (body.length < 12) return undefined;
    const nBits = body[0] >> 3;
    const rectBytes = Math.ceil((5 + nBits * 4) / 8);
    if (body.length < rectBytes + 4) return undefined;
    const fps = Math.max(1, body[rectBytes + 1] + body[rectBytes] / 256 || 25);
    const rootFrames = Math.max(1, body.readUInt16LE(rectBytes + 2));
    let maxSpriteFrames = 0;
    try {
      let pos = rectBytes + 4;
      let checked = 0;
      while (pos + 2 <= body.length && checked < 4000) {
        const th = body.readUInt16LE(pos);
        const tt = th >> 6;
        let tl = th & 0x3f;
        pos += 2;
        if (tl === 0x3f) {
          if (pos + 4 > body.length) break;
          tl = body.readUInt32LE(pos);
          pos += 4;
        }
        if (tt === 0) break;
        if (tt === 39 && tl >= 4 && pos + 4 <= body.length) {
          const sf = body.readUInt16LE(pos + 2);
          if (sf > maxSpriteFrames) maxSpriteFrames = sf;
        }
        if (tl < 0 || pos + tl > body.length) break;
        pos += tl;
        checked++;
      }
    } catch {}
    const frames = Math.max(rootFrames, maxSpriteFrames);
    return frames <= 2 ? 15 : Math.max(2, Math.ceil(frames / fps));
  } catch {
    return undefined;
  }
}

function resolveUploadedFileUrl(
  fileNameOrTitle?: string,
  currentUrl?: string
): { url: string; duration?: number } | null {
  if (currentUrl && currentUrl.startsWith('/uploads/')) {
    const rel = path.basename(currentUrl.replace(/^\/uploads\//, '').split('?')[0]);
    const fullP = path.join(uploadsDir, rel);
    if (fs.existsSync(fullP)) {
      const dur = rel.toLowerCase().endsWith('.swf') ? parseSwfDurationSecFromDisk(fullP) : undefined;
      return { url: `/uploads/${rel}`, duration: dur };
    }
  }
  const fallbackFromUrl =
    currentUrl && currentUrl.startsWith('/uploads/')
      ? path
          .basename(currentUrl.split('?')[0])
          .replace(/^\d{10,15}_/, '')
      : '';
  const rawKey = (fileNameOrTitle || fallbackFromUrl || '').trim();
  if (!rawKey) return null;
  const safeKey = rawKey.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const baseNoExt = safeKey.replace(/\.[^/.]+$/, '');

  // 1. Check mediaRegistry
  const direct = mediaRegistry[rawKey.toLowerCase()] || mediaRegistry[safeKey] || mediaRegistry[baseNoExt];
  if (direct && direct.url) {
    const rel = path.basename(direct.url.replace(/^\/uploads\//, ''));
    const fullP = path.join(uploadsDir, rel);
    if (fs.existsSync(fullP)) {
      const dur =
        direct.duration ||
        (rel.toLowerCase().endsWith('.swf') ? parseSwfDurationSecFromDisk(fullP) : undefined);
      return { url: direct.url, duration: dur };
    }
  }

  // 2. Scan uploadsDir for matching uploaded/transcoded file (including extension-stripped titles)
  try {
    const files = fs.readdirSync(uploadsDir);
    for (let i = files.length - 1; i >= 0; i--) {
      const f = files[i];
      const fLower = f.toLowerCase();
      const fNoExt = fLower.replace(/\.[^/.]+$/, '');
      if (
        fLower.endsWith(`_${safeKey}`) ||
        fLower.endsWith(`_${baseNoExt}_vlc.mp4`) ||
        fNoExt.endsWith(`_${baseNoExt}`) ||
        fLower === safeKey
      ) {
        const fullP = path.join(uploadsDir, f);
        const dur = fLower.endsWith('.swf') ? parseSwfDurationSecFromDisk(fullP) : undefined;
        return { url: `/uploads/${f}`, duration: dur };
      }
    }
  } catch {}
  return null;
}

function repairChannelMediaUrls(
  stateObj: any,
  opts: { keepActiveLiveState?: boolean } = {}
): any {
  if (!stateObj || !Array.isArray(stateObj.channels)) return stateObj;
  const keepActive = Boolean(opts.keepActiveLiveState);
  const fixItem = (it: any) => {
    if (!it) return it;
    const normalizedEnabled = it.enabled !== false;
    const u = it.url || it.videoUrl || it.imageUrl || '';
    if (u.startsWith('data:image/')) {
      return { ...it, enabled: normalizedEnabled };
    }
    const resolved = resolveUploadedFileUrl(it.fileName || it.name || it.title, u);
    if (resolved) {
      const next: any = {
        ...it,
        enabled: normalizedEnabled,
        url: resolved.url,
        duration:
          resolved.duration && (!it.duration || it.duration === 15 || it.duration === 30)
            ? resolved.duration
            : it.duration,
        isTranscoding: false,
      };
      if ('videoUrl' in it) next.videoUrl = resolved.url;
      if ('imageUrl' in it) next.imageUrl = resolved.url;
      return next;
    }
    return { ...it, enabled: normalizedEnabled };
  };

  const fixLogoItem = (logo: any) => {
    if (!logo || typeof logo !== 'object') return logo;
    let nextLogo = { ...logo };
    if (Array.isArray(nextLogo.playlist) && nextLogo.playlist.length > 0) {
      nextLogo.playlist = nextLogo.playlist.map((item: any) => {
        if (!item) return item;
        const itemUrl = String(item.url || '');
        if (itemUrl.startsWith('data:image/')) return item;
        const res = resolveUploadedFileUrl(item.fileName || item.name || item.title, itemUrl);
        if (res) {
          const isSwf = res.url.toLowerCase().endsWith('.swf');
          return {
            ...item,
            url: res.url,
            type: isSwf ? 'swf' : item.type,
          };
        }
        return item;
      });
    }
    const u = String(nextLogo.imageUrl || nextLogo.url || '');
    const lbl = String(nextLogo.fileName || nextLogo.name || nextLogo.label || '');
    if (!u.startsWith('data:image/') || lbl.toLowerCase().endsWith('.swf')) {
      const resolved = resolveUploadedFileUrl(lbl, u.startsWith('data:image/') ? '' : u);
      if (resolved) {
        const isSwf = resolved.url.toLowerCase().endsWith('.swf');
        nextLogo.imageUrl = resolved.url;
        if ('url' in nextLogo) nextLogo.url = resolved.url;
        if (isSwf) nextLogo.mediaType = 'swf';
      } else if (Array.isArray(nextLogo.playlist) && nextLogo.playlist.length > 0) {
        const idx = Math.min(Math.max(0, nextLogo.currentIndex || 0), nextLogo.playlist.length - 1);
        const active = nextLogo.playlist[idx] || nextLogo.playlist[0];
        if (active?.url && (!u || u.startsWith('blob:'))) {
          nextLogo.imageUrl = active.url;
          if (active.type) nextLogo.mediaType = active.type;
        }
      }
    }
    return nextLogo;
  };

  if (Array.isArray(stateObj.everyNMinAds)) {
    stateObj.everyNMinAds = stateObj.everyNMinAds.map(fixItem);
  }

  stateObj.channels = stateObj.channels.map((ch: any) => {
    const g = ch.graphics
      ? {
          ...ch.graphics,
          channelLogo: fixLogoItem(ch.graphics.channelLogo),
          sponsorLogo1: fixLogoItem(ch.graphics.sponsorLogo1),
          sponsorLogo2: fixLogoItem(ch.graphics.sponsorLogo2),
          sponsorLogo3: fixLogoItem(ch.graphics.sponsorLogo3),
          sponsorLogo4: fixLogoItem(ch.graphics.sponsorLogo4),
          sponsor1Logo: ch.graphics.sponsor1Logo ? fixLogoItem(ch.graphics.sponsor1Logo) : undefined,
          sponsor2Logo: ch.graphics.sponsor2Logo ? fixLogoItem(ch.graphics.sponsor2Logo) : undefined,
        }
      : ch.graphics;

    const savedMain =
      !keepActive &&
      ch.savedMainPlaybackState &&
      typeof ch.savedMainPlaybackState.clipIndex === 'number' &&
      typeof ch.savedMainPlaybackState.currentTime === 'number'
        ? ch.savedMainPlaybackState
        : null;

    return {
      ...ch,
      loopMode: ch.loopMode === 'off' ? 'off' : 'playlist',
      loopFolders: [],
      currentClipIndex: savedMain ? savedMain.clipIndex : ch.currentClipIndex || 0,
      currentTime: savedMain ? savedMain.currentTime : ch.currentTime || 0,
      savedMainPlaybackState: keepActive
        ? ch.savedMainPlaybackState
        : ch.liveInput?.active
        ? savedMain
        : null,
      activeEveryNMinAd: keepActive && ch.activeEveryNMinAd ? fixItem(ch.activeEveryNMinAd) : null,
      everyNMinQueue: keepActive && Array.isArray(ch.everyNMinQueue)
        ? ch.everyNMinQueue.map(fixItem)
        : [],
      activeProgramId: keepActive ? ch.activeProgramId ?? null : null,
      graphics: g,
      playlist: Array.isArray(ch.playlist) ? ch.playlist.map(fixItem) : [],
      scheduledPrograms: Array.isArray(ch.scheduledPrograms)
        ? ch.scheduledPrograms.map((p: any) => ({
            ...p,
            clips: Array.isArray(p.clips) ? p.clips.map(fixItem) : [],
            playlist: Array.isArray(p.playlist) ? p.playlist.map(fixItem) : undefined,
          }))
        : [],
      everyNMinAds: Array.isArray(ch.everyNMinAds) ? ch.everyNMinAds.map(fixItem) : [],
      bottomOverlay: ch.bottomOverlay
        ? {
            ...ch.bottomOverlay,
            playlist: Array.isArray(ch.bottomOverlay.playlist)
              ? ch.bottomOverlay.playlist.map(fixItem)
              : [],
          }
        : ch.bottomOverlay,
      topOverlay: ch.topOverlay
        ? {
            ...ch.topOverlay,
            playlist: Array.isArray(ch.topOverlay.playlist)
              ? ch.topOverlay.playlist.map(fixItem)
              : [],
          }
        : ch.topOverlay,
      lShape: ch.lShape
        ? {
            ...ch.lShape,
            playlist: Array.isArray(ch.lShape.playlist)
              ? ch.lShape.playlist.map(fixItem)
              : [],
          }
        : ch.lShape,
    };
  });
  return stateObj;
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Allow cross-origin requests from local desktop software
app.use((req: Request, res: Response, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

const MEDIA_MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.swf': 'application/x-shockwave-flash',
};

function streamFileWithRange(req: Request, res: Response, filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MEDIA_MIME_MAP[ext] || 'application/octet-stream';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(total - 1, parseInt(match[2], 10)) : total - 1;
        if (start >= total || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(chunkSize));
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', () => {
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
        return;
      }
    }

    res.status(200);
    res.setHeader('Content-Length', String(total));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(404).send('Media not found');
  }
}

// Serve uploaded media files statically from /uploads with range support & automatic filename fallback
app.use(
  '/uploads',
  express.static(uploadsDir, { acceptRanges: true, maxAge: '1d' }),
  (req: Request, res: Response, next) => {
    try {
      const rawBase = decodeURIComponent(path.basename(req.path || '')).replace(/^\d{10,15}_/, '');
      if (rawBase) {
        const resolved = resolveUploadedFileUrl(rawBase);
        if (resolved && resolved.url) {
          const rel = path.basename(resolved.url.replace(/^\/uploads\//, ''));
          const fullPath = path.join(uploadsDir, rel);
          if (fs.existsSync(fullPath)) {
            streamFileWithRange(req, res, fullPath);
            return;
          }
        }
      }
    } catch {}
    next();
  }
);

// Serve local Ruffle Flash engine files from node_modules/@ruffle-rs/ruffle without duplicating 28 MB into public/ruffle
const ruffleNodeModulesDir = path.join(process.cwd(), 'node_modules', '@ruffle-rs', 'ruffle');
const publicRuffleDir = path.join(process.cwd(), 'public', 'ruffle');
if (fs.existsSync(ruffleNodeModulesDir)) {
  app.use('/ruffle', express.static(ruffleNodeModulesDir, { maxAge: '7d' }));
}
if (fs.existsSync(publicRuffleDir)) {
  app.use('/ruffle', express.static(publicRuffleDir, { maxAge: '7d' }));
}
const aistudioAssetsDir = path.join(process.cwd(), 'public', 'assets', 'aistudio');
if (fs.existsSync(aistudioAssetsDir)) {
  app.use('/assets/aistudio', express.static(aistudioAssetsDir, { maxAge: '1d' }));
}

// Load persistent playout state from disk if available
function loadPersistedState(): any {
  try {
    if (fs.existsSync(stateFilePath)) {
      const raw = fs.readFileSync(stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.channels)) {
        const repaired = repairChannelMediaUrls(parsed, { keepActiveLiveState: false });
        const compacted = compactPlayoutStateEnvelope(repaired);
        const compactStr = JSON.stringify(compacted);
        if (raw.length > compactStr.length + 256) {
          try {
            fs.writeFileSync(stateFilePath, compactStr, 'utf-8');
          } catch {}
        }
        return compacted;
      }
    }
  } catch {}
  return {
    appName: 'ASHOKA MSO PLAYLIST',
    updatedAt: new Date().toISOString(),
    everyNMinEnabled: false,
    everyNMinInterval: 15,
    isLicensed: false,
    channels: [],
  };
}

function savePersistedState(stateObj: any) {
  try {
    const repaired = repairChannelMediaUrls(stateObj, { keepActiveLiveState: false });
    const compacted = compactPlayoutStateEnvelope(repaired);
    syncedPlayoutState = compacted;
    fs.writeFileSync(stateFilePath, JSON.stringify(compacted), 'utf-8');
  } catch {}
}

function loadCgBackendState(): any {
  try {
    if (fs.existsSync(cgStateFilePath)) {
      const raw = fs.readFileSync(cgStateFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const wrapped = repairChannelMediaUrls(
          {
            channels: [
              {
                bottomOverlay: parsed.bottomOverlay,
                topOverlay: parsed.topOverlay,
                lShape: parsed.lShape,
                graphics: parsed.graphics,
              },
            ],
          },
          { keepActiveLiveState: false }
        );
        const repairedCh = wrapped?.channels?.[0] || {};
        const compacted = compactCgStatePayload({
          ok: true,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : 0,
          channelId: parsed.channelId || 1,
          bottomOverlay: repairedCh.bottomOverlay ?? parsed.bottomOverlay ?? null,
          topOverlay: repairedCh.topOverlay ?? parsed.topOverlay ?? null,
          lShape: repairedCh.lShape ?? parsed.lShape ?? null,
          graphics: repairedCh.graphics ?? parsed.graphics ?? null,
        });
        const compactStr = JSON.stringify(compacted);
        if (raw.length > compactStr.length + 128) {
          try {
            fs.writeFileSync(cgStateFilePath, compactStr, 'utf-8');
          } catch {}
        }
        return compacted;
      }
    }
  } catch {}
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    updatedAtMs: 0,
    bottomOverlay: null,
    topOverlay: null,
    lShape: null,
    graphics: null,
  };
}

let syncedCgState: any = loadCgBackendState();

function saveCgBackendState(cgPayload: any): any {
  try {
    const wrapped = repairChannelMediaUrls(
      {
        channels: [
          {
            bottomOverlay: cgPayload?.bottomOverlay ?? null,
            topOverlay: cgPayload?.topOverlay ?? null,
            lShape: cgPayload?.lShape ?? null,
            graphics: cgPayload?.graphics ?? null,
          },
        ],
      },
      { keepActiveLiveState: false }
    );
    const repairedCh = wrapped?.channels?.[0] || {};
    syncedCgState = compactCgStatePayload({
      ok: true,
      updatedAt: new Date().toISOString(),
      updatedAtMs:
        typeof cgPayload?.updatedAtMs === 'number' ? cgPayload.updatedAtMs : Date.now(),
      channelId: cgPayload?.channelId || 1,
      bottomOverlay: repairedCh.bottomOverlay ?? cgPayload?.bottomOverlay ?? null,
      topOverlay: repairedCh.topOverlay ?? cgPayload?.topOverlay ?? null,
      lShape: repairedCh.lShape ?? cgPayload?.lShape ?? null,
      graphics: repairedCh.graphics ?? cgPayload?.graphics ?? null,
    });
    fs.writeFileSync(cgStateFilePath, JSON.stringify(syncedCgState), 'utf-8');
  } catch {}
  return syncedCgState;
}

let syncedPlayoutState: any = loadPersistedState();

// Real System CPU Percentage Sampler (os.cpus() delta across all cores)
function readCpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      total += cpu.times[type];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let prevCpuSnap = readCpuSnapshot();
let currentRealCpuPercent = 8;

setInterval(() => {
  try {
    const nextSnap = readCpuSnapshot();
    const idleDiff = nextSnap.idle - prevCpuSnap.idle;
    const totalDiff = nextSnap.total - prevCpuSnap.total;
    prevCpuSnap = nextSnap;
    if (totalDiff > 0) {
      const usage = Math.round((1 - idleDiff / totalDiff) * 100);
      currentRealCpuPercent = Math.max(1, Math.min(100, usage));
    }
  } catch {}
}, 1500);

// 1. Health & Real System CPU/RAM Telemetry API
app.get(['/api/health', '/api/system/stats'], (_req: Request, res: Response) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
  const licenseEval = evaluateLicenseStatus(syncedPlayoutState.licenseRecord);

  res.json({
    status: 'ok',
    version: 'NEW VERSION 2026.10 PRO',
    serverTimeIso: new Date().toISOString(),
    cpuPercent: currentRealCpuPercent,
    cpuCores: os.cpus().length,
    ramPercent,
    usedRamGb: Number((usedMem / (1024 * 1024 * 1024)).toFixed(1)),
    totalRamGb: Number((totalMem / (1024 * 1024 * 1024)).toFixed(1)),
    app: 'ASHOKA MSO PLAYLIST - Single-Channel Playout Automation Studio',
    channels: 1,
    uptime: process.uptime(),
    licenseStatus: licenseEval,
    playoutState: syncedPlayoutState,
  });
});

// 1a-3. Hardware Multi-Display Output Discovery (Detects 1, 2, 3, 4+ Connected Displays on Windows / Linux)
app.get('/api/system/displays', async (_req: Request, res: Response) => {
  const detectedDisplays: Array<{
    index: number;
    id: string;
    name: string;
    resolution: string;
    isPrimary: boolean;
    connected: boolean;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }> = [];

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Select-Object DeviceName, Primary, @{N='Width';E={$_.Bounds.Width}}, @{N='Height';E={$_.Bounds.Height}}, @{N='Left';E={$_.Bounds.X}}, @{N='Top';E={$_.Bounds.Y}} | ConvertTo-Json -Compress",
        ],
        { timeout: 1800 }
      );
      if (stdout && stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach((scr: any, idx: number) => {
          const w = Number(scr?.Width) || 1920;
          const h = Number(scr?.Height) || 1080;
          const num = idx + 1;
          detectedDisplays.push({
            index: num,
            id: `display-${num}`,
            name: scr?.Primary
              ? `Display ${num} — Primary Studio Monitor (${w}×${h})`
              : `Display ${num} — TV / HDMI Playout Output (${w}×${h})`,
            resolution: `${w}×${h}`,
            isPrimary: Boolean(scr?.Primary),
            connected: true,
            left: Number(scr?.Left) || 0,
            top: Number(scr?.Top) || 0,
            width: w,
            height: h,
          });
        });
      }
    } else {
      const { stdout } = await execFileAsync('xrandr', ['--query'], { timeout: 1000 }).catch(
        () => ({ stdout: '' })
      );
      if (stdout && stdout.trim()) {
        const lines = stdout.trim().split('\n');
        let idx = 0;
        for (const line of lines) {
          if (line.includes(' connected')) {
            idx++;
            const parts = line.trim().split(/\s+/);
            const portName = parts[0] || `HDMI-${idx}`;
            const isPrim = line.includes('primary');
            const resMatch = line.match(/(\d{3,5})x(\d{3,5})\+(\d+)\+(\d+)/);
            const w = resMatch ? Number(resMatch[1]) : 1920;
            const h = resMatch ? Number(resMatch[2]) : 1080;
            const left = resMatch ? Number(resMatch[3]) : (idx - 1) * 1920;
            const top = resMatch ? Number(resMatch[4]) : 0;
            detectedDisplays.push({
              index: idx,
              id: `display-${idx}`,
              name: isPrim
                ? `Display ${idx} (${portName}) — Primary Monitor (${w}×${h})`
                : `Display ${idx} (${portName}) — Broadcast Output (${w}×${h})`,
              resolution: `${w}×${h}`,
              isPrimary: isPrim,
              connected: true,
              left,
              top,
              width: w,
              height: h,
            });
          }
        }
      }
    }
  } catch {}

  res.json({
    success: true,
    detectedCount: detectedDisplays.length,
    displays: detectedDisplays,
  });
});

// 1b. Kanishq Master Key License Activation & Lock Endpoint
app.post('/api/playout/license/activate', (req: Request, res: Response) => {
  const { masterKey, clientName, licenseKey, startDate, expiryDate } = req.body || {};
  if (String(masterKey || '').trim() !== KANISHQ_MASTER_KEY) {
    res.status(403).json({
      success: false,
      error: 'Invalid Kanishq Master Key! Unauthorized license modification blocked.',
    });
    return;
  }
  const cleanClient = String(clientName || '').trim();
  const cleanExpiry = String(expiryDate || '').trim();
  if (!cleanClient || !cleanExpiry) {
    res.status(400).json({
      success: false,
      error: 'Client Name and Expiry Date are required.',
    });
    return;
  }
  const cleanStart = String(startDate || new Date().toISOString().slice(0, 10)).trim();
  const cleanLicenseKey = String(licenseKey || `ASHOKA-${cleanClient.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`).trim();

  const recordBase = {
    clientName: cleanClient,
    licenseKey: cleanLicenseKey,
    startDate: cleanStart,
    expiryDate: cleanExpiry,
    isLocked: true,
    activatedAt: new Date().toISOString(),
  };
  const signature = computeLicenseSignature(recordBase);
  const signedRecord: StationLicenseRecord = {
    ...recordBase,
    signature,
  };

  const evaluated = evaluateLicenseStatus(signedRecord);
  syncedPlayoutState = {
    ...syncedPlayoutState,
    updatedAt: new Date().toISOString(),
    licenseRecord: signedRecord,
    isLicensed: evaluated.isValidAndActive,
  };
  savePersistedState(syncedPlayoutState);

  res.json({
    success: true,
    licenseRecord: signedRecord,
    licenseStatus: evaluated,
    isLicensed: evaluated.isValidAndActive,
  });
});

// 2. Playout State Sync & Persistent Save (Single Channel + Live Input + CG + Programs + Every N Min)
app.post(['/api/playout/state', '/api/playout/save'], (req: Request, res: Response) => {
  if (req.body && Array.isArray(req.body.channels)) {
    // Only accept a licenseRecord if its cryptographic Kanishq signature is 100% valid
    let nextLicenseRecord: StationLicenseRecord | undefined = syncedPlayoutState.licenseRecord;
    if (req.body.licenseRecord && verifyLicenseSignature(req.body.licenseRecord)) {
      nextLicenseRecord = req.body.licenseRecord;
    }
    const evaluated = evaluateLicenseStatus(nextLicenseRecord);

    syncedPlayoutState = {
      appName: 'ASHOKA CABLE TV PLAYOUT',
      updatedAt: new Date().toISOString(),
      updatedAtMs: typeof req.body.updatedAtMs === 'number' ? req.body.updatedAtMs : Date.now(),
      everyNMinAds: Array.isArray(req.body.everyNMinAds)
        ? req.body.everyNMinAds
        : syncedPlayoutState.everyNMinAds || [],
      everyNMinEnabled: req.body.everyNMinEnabled ?? syncedPlayoutState.everyNMinEnabled ?? false,
      everyNMinInterval: req.body.everyNMinInterval ?? syncedPlayoutState.everyNMinInterval ?? 15,
      licenseRecord: nextLicenseRecord,
      isLicensed: evaluated.isValidAndActive,
      channels: req.body.channels.slice(0, 1),
    };
    savePersistedState(syncedPlayoutState);
  }
  res.json({
    success: true,
    savedAt: syncedPlayoutState.updatedAt,
    state: syncedPlayoutState,
  });
});

app.get(['/api/playout/state', '/api/playout/load'], (_req: Request, res: Response) => {
  syncedPlayoutState = loadPersistedState();
  const evaluated = evaluateLicenseStatus(syncedPlayoutState.licenseRecord);
  syncedPlayoutState.isLicensed = evaluated.isValidAndActive;
  res.json(syncedPlayoutState);
});

// 2a-live. High-speed real-time live sync bridge for 2nd Display / isolated kiosk profiles
let livePlayoutSyncSnapshot: any = null;
let lastLiveSyncSeq = 0;

app.post('/api/playout/live-sync', (req: Request, res: Response) => {
  try {
    if (req.body && req.body.channel) {
      const incomingSeq = typeof req.body.syncSeq === 'number' ? req.body.syncSeq : 0;
      if (incomingSeq > 2 && lastLiveSyncSeq > 0 && incomingSeq < lastLiveSyncSeq) {
        res.json({ ok: true, ignoredStale: true });
        return;
      }
      if (incomingSeq > 0) {
        lastLiveSyncSeq = incomingSeq;
      }
      const repairedWrapper = repairChannelMediaUrls(
        { channels: [req.body.channel] },
        { keepActiveLiveState: true }
      );
      const repairedChannel = compactChannel(repairedWrapper?.channels?.[0] || req.body.channel, {
        keepActiveLiveState: true,
      });
      livePlayoutSyncSnapshot = {
        ...req.body,
        channel: repairedChannel,
        serverTimestampMs: Date.now(),
      };
    }
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

app.get('/api/playout/live-sync', (_req: Request, res: Response) => {
  if (livePlayoutSyncSnapshot && livePlayoutSyncSnapshot.channel) {
    res.json(livePlayoutSyncSnapshot);
    return;
  }
  const evaluated = evaluateLicenseStatus(syncedPlayoutState.licenseRecord);
  res.json({
    updatedAtMs: syncedPlayoutState.updatedAtMs || 0,
    isLicensed: evaluated.isValidAndActive,
    licenseRecord: syncedPlayoutState.licenseRecord || null,
    channel: syncedPlayoutState.channels?.[0] || null,
    time: 0,
  });
});

// 2a-cg. Dedicated CG Backend State API (Overlay, L-Shape, Ticker, Logo sync independent of video pipeline)
app.get('/api/cg/state', (_req: Request, res: Response) => {
  syncedCgState = loadCgBackendState();
  res.json(syncedCgState);
});

app.post('/api/cg/save', (req: Request, res: Response) => {
  try {
    const savedCg = saveCgBackendState(req.body || {});
    if (Array.isArray(syncedPlayoutState.channels) && syncedPlayoutState.channels[0]) {
      const ch0 = syncedPlayoutState.channels[0];
      syncedPlayoutState.channels[0] = {
        ...ch0,
        bottomOverlay: savedCg.bottomOverlay ?? ch0.bottomOverlay,
        topOverlay: savedCg.topOverlay ?? ch0.topOverlay,
        lShape: savedCg.lShape ?? ch0.lShape,
        graphics: savedCg.graphics ?? ch0.graphics,
      };
    }
    if (livePlayoutSyncSnapshot && livePlayoutSyncSnapshot.channel) {
      livePlayoutSyncSnapshot = {
        ...livePlayoutSyncSnapshot,
        channel: {
          ...livePlayoutSyncSnapshot.channel,
          bottomOverlay: savedCg.bottomOverlay ?? livePlayoutSyncSnapshot.channel.bottomOverlay,
          topOverlay: savedCg.topOverlay ?? livePlayoutSyncSnapshot.channel.topOverlay,
          lShape: savedCg.lShape ?? livePlayoutSyncSnapshot.channel.lShape,
          graphics: savedCg.graphics ?? livePlayoutSyncSnapshot.channel.graphics,
        },
        serverTimestampMs: Date.now(),
      };
    }
    res.json({ ok: true, ...savedCg });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Failed to save CG state' });
  }
});

app.post('/api/app/exit', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// 2a-custom. Custom License Activation API
app.post('/api/license/activate', (req: Request, res: Response) => {
  try {
    const record = req.body?.licenseRecord;
    if (!record || !verifyLicenseSignature(record)) {
      res.status(400).json({ success: false, error: 'Invalid license signature or key' });
      return;
    }
    const evaluated = evaluateLicenseStatus(record);
    syncedPlayoutState = loadPersistedState();
    syncedPlayoutState.licenseRecord = record;
    syncedPlayoutState.isLicensed = evaluated.isValidAndActive;
    syncedPlayoutState.updatedAt = new Date().toISOString();
    syncedPlayoutState.updatedAtMs = Date.now();

    if (evaluated.isValidAndActive && Array.isArray(syncedPlayoutState.channels)) {
      syncedPlayoutState.channels = syncedPlayoutState.channels.map((ch: any) => ({
        ...ch,
        graphics: ch.graphics ? { ...ch.graphics, demoWatermarkEnabled: false } : ch.graphics,
      }));
    }

    savePersistedState(syncedPlayoutState);
    res.json({
      success: true,
      licenseRecord: record,
      isLicensed: evaluated.isValidAndActive,
      evaluated,
      state: syncedPlayoutState,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to activate license' });
  }
});

// 2b. Dedicated Backend Endpoint to Enable / Disable Any Individual File or Folder Across All Playlists
app.post('/api/playout/toggle-enable', (req: Request, res: Response) => {
  try {
    const {
      section: rawSection,
      scope: rawScope,
      itemId,
      programId,
      folderName,
      enabled,
      channelId = 1,
    } = req.body || {};
    const section = String(rawSection || rawScope || '').trim();
    const targetEnabled = Boolean(enabled);

    if (Array.isArray(syncedPlayoutState.channels)) {
      syncedPlayoutState.channels = syncedPlayoutState.channels.map((ch: any) => {
        if (channelId && ch.id && ch.id !== channelId) return ch;
        const nextCh = { ...ch };

        if (section === 'main' && Array.isArray(nextCh.playlist)) {
          nextCh.playlist = nextCh.playlist.map((it: any) => {
            if (folderName && it.folderName === folderName) {
              return { ...it, enabled: targetEnabled };
            }
            if (itemId && it.id === itemId) {
              return { ...it, enabled: targetEnabled };
            }
            return it;
          });
        } else if (section === 'program' && Array.isArray(nextCh.scheduledPrograms)) {
          nextCh.scheduledPrograms = nextCh.scheduledPrograms.map((p: any) => {
            if (programId && p.id === programId) {
              if (folderName) {
                return {
                  ...p,
                  playlist: Array.isArray(p.playlist)
                    ? p.playlist.map((c: any) =>
                        c.folderName === folderName || !c.folderName
                          ? { ...c, enabled: targetEnabled }
                          : c
                      )
                    : p.playlist,
                };
              }
              if (itemId) {
                const updatedClips = Array.isArray(p.playlist)
                  ? p.playlist.map((c: any) =>
                      c.id === itemId ? { ...c, enabled: targetEnabled } : c
                    )
                  : p.playlist;
                const anyClipEnabled = Array.isArray(updatedClips)
                  ? updatedClips.some((c: any) => c.enabled !== false)
                  : p.enabled;
                return {
                  ...p,
                  enabled: targetEnabled ? true : anyClipEnabled,
                  playlist: updatedClips,
                };
              }
              return {
                ...p,
                enabled: targetEnabled,
                playlist: Array.isArray(p.playlist)
                  ? p.playlist.map((c: any) => ({ ...c, enabled: targetEnabled }))
                  : p.playlist,
              };
            }
            return p;
          });
        } else if (section === 'every_n_min') {
          if (Array.isArray(nextCh.everyNMinAds)) {
            nextCh.everyNMinAds = nextCh.everyNMinAds.map((ad: any) => {
              if (folderName && ad.folderName === folderName) {
                return { ...ad, enabled: targetEnabled };
              }
              if (itemId && ad.id === itemId) {
                return { ...ad, enabled: targetEnabled };
              }
              return ad;
            });
          }
        } else if (section === 'bottom_overlay' && nextCh.bottomOverlay) {
          nextCh.bottomOverlay = {
            ...nextCh.bottomOverlay,
            playlist: Array.isArray(nextCh.bottomOverlay.playlist)
              ? nextCh.bottomOverlay.playlist.map((it: any) => {
                  if (folderName && it.folderName === folderName) {
                    return { ...it, enabled: targetEnabled };
                  }
                  if (itemId && it.id === itemId) {
                    return { ...it, enabled: targetEnabled };
                  }
                  return it;
                })
              : [],
          };
        } else if (section === 'top_overlay' && nextCh.topOverlay) {
          nextCh.topOverlay = {
            ...nextCh.topOverlay,
            playlist: Array.isArray(nextCh.topOverlay.playlist)
              ? nextCh.topOverlay.playlist.map((it: any) => {
                  if (folderName && it.folderName === folderName) {
                    return { ...it, enabled: targetEnabled };
                  }
                  if (itemId && it.id === itemId) {
                    return { ...it, enabled: targetEnabled };
                  }
                  return it;
                })
              : [],
          };
        } else if (section === 'bottom_ticker' && nextCh.graphics) {
          nextCh.graphics = {
            ...nextCh.graphics,
            tickerItems: Array.isArray(nextCh.graphics.tickerItems)
              ? nextCh.graphics.tickerItems.map((it: any) => {
                  if (folderName && it.folderName === folderName) {
                    return { ...it, enabled: targetEnabled };
                  }
                  if (itemId && it.id === itemId) {
                    return { ...it, enabled: targetEnabled };
                  }
                  return it;
                })
              : [],
          };
        } else if (section === 'top_ticker' && nextCh.graphics) {
          nextCh.graphics = {
            ...nextCh.graphics,
            topTickerItems: Array.isArray(nextCh.graphics.topTickerItems)
              ? nextCh.graphics.topTickerItems.map((it: any) => {
                  if (folderName && it.folderName === folderName) {
                    return { ...it, enabled: targetEnabled };
                  }
                  if (itemId && it.id === itemId) {
                    return { ...it, enabled: targetEnabled };
                  }
                  return it;
                })
              : [],
          };
        } else if (section === 'lshape' && nextCh.lShape) {
          nextCh.lShape = {
            ...nextCh.lShape,
            playlist: Array.isArray(nextCh.lShape.playlist)
              ? nextCh.lShape.playlist.map((it: any) => {
                  if (folderName && it.folderName === folderName) {
                    return { ...it, enabled: targetEnabled };
                  }
                  if (itemId && it.id === itemId) {
                    return { ...it, enabled: targetEnabled };
                  }
                  return it;
                })
              : [],
          };
        }

        return nextCh;
      });
    }

    if (section === 'every_n_min' && Array.isArray(syncedPlayoutState.everyNMinAds)) {
      syncedPlayoutState.everyNMinAds = syncedPlayoutState.everyNMinAds.map((ad: any) => {
        if (folderName && ad.folderName === folderName) {
          return { ...ad, enabled: targetEnabled };
        }
        if (itemId && ad.id === itemId) {
          return { ...ad, enabled: targetEnabled };
        }
        return ad;
      });
    }

    syncedPlayoutState.updatedAt = new Date().toISOString();
    syncedPlayoutState.updatedAtMs = Date.now();
    savePersistedState(syncedPlayoutState);

    res.json({
      success: true,
      section,
      itemId,
      programId,
      folderName,
      enabled: targetEnabled,
      updatedAt: syncedPlayoutState.updatedAt,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to toggle item state',
    });
  }
});

app.post('/api/playout/reset', (req: Request, res: Response) => {
  const existingLicense = syncedPlayoutState.licenseRecord;
  const evaluated = evaluateLicenseStatus(existingLicense);
  const resetChannels = Array.isArray(req.body?.channels) ? req.body.channels.slice(0, 1) : [];
  syncedPlayoutState = {
    appName: 'ASHOKA MSO PLAYLIST',
    updatedAt: new Date().toISOString(),
    everyNMinAds: [],
    everyNMinEnabled: false,
    everyNMinInterval: 15,
    licenseRecord: existingLicense,
    isLicensed: evaluated.isValidAndActive,
    channels: resetChannels,
  };
  savePersistedState(syncedPlayoutState);
  saveCgBackendState({
    updatedAtMs: Date.now(),
    bottomOverlay: resetChannels[0]?.bottomOverlay ?? null,
    topOverlay: resetChannels[0]?.topOverlay ?? null,
    lShape: resetChannels[0]?.lShape ?? null,
    graphics: resetChannels[0]?.graphics ?? null,
  });
  res.json({
    success: true,
    state: syncedPlayoutState,
  });
});

const IMAGE_OR_SWF_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'apng',
  'swf',
]);

const FORCE_TRANSCODE_CONTAINERS = new Set([
  'mkv',
  'avi',
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
  'mp2',
  'm2v',
  'mpv',
  'ogv',
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
  'mov',
  'm4v',
]);

interface ProbedMediaInfo {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  profile: string;
  pixFmt: string;
  audioCodec: string;
  audioChannels: number;
  audioSampleRate: number;
  audioStreamIndex: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

function parseTagDurationSec(tagVal: any): number {
  if (!tagVal || typeof tagVal !== 'string') return 0;
  const m = tagVal.trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

async function probeMediaWithFfprobe(filePath: string): Promise<ProbedMediaInfo | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-analyzeduration',
      '100M',
      '-probesize',
      '100M',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const data = JSON.parse(stdout || '{}');
    const streams: any[] = Array.isArray(data.streams) ? data.streams : [];
    const vStream = streams.find((s) => s.codec_type === 'video');
    const aStreams = streams.filter((s) => s.codec_type === 'audio');
    const aStream =
      aStreams.find((s) => Number(s.channels || 0) > 0) || aStreams[0];
    const audioStreamIndex = aStream ? Math.max(0, aStreams.indexOf(aStream)) : 0;
    const rawDur =
      parseFloat(data?.format?.duration) ||
      parseFloat(vStream?.duration) ||
      parseFloat(aStream?.duration) ||
      parseTagDurationSec(vStream?.tags?.DURATION) ||
      parseTagDurationSec(vStream?.tags?.duration) ||
      parseTagDurationSec(data?.format?.tags?.DURATION) ||
      parseTagDurationSec(data?.format?.tags?.duration) ||
      0;

    return {
      duration: rawDur > 0 && Number.isFinite(rawDur) ? Math.max(1, Math.ceil(rawDur)) : 15,
      width: Number(vStream?.width || 0),
      height: Number(vStream?.height || 0),
      videoCodec: String(vStream?.codec_name || '').toLowerCase(),
      profile: String(vStream?.profile || '').toLowerCase(),
      pixFmt: String(vStream?.pix_fmt || '').toLowerCase(),
      audioCodec: String(aStream?.codec_name || '').toLowerCase(),
      audioChannels: Number(aStream?.channels || 0),
      audioSampleRate: Number(aStream?.sample_rate || 0),
      audioStreamIndex,
      hasVideo: Boolean(vStream),
      hasAudio: Boolean(aStream),
    };
  } catch {
    return null;
  }
}

function shouldTranscodeForBrowser(ext: string, info: ProbedMediaInfo): boolean {
  if (FORCE_TRANSCODE_CONTAINERS.has(ext)) return true;

  // Check video codec & pixel format compatibility
  if (info.hasVideo) {
    if (
      info.videoCodec !== 'h264' &&
      info.videoCodec !== 'vp8' &&
      info.videoCodec !== 'vp9' &&
      info.videoCodec !== 'av1'
    ) {
      return true;
    }
    if (
      info.profile.includes('10') ||
      info.profile.includes('4:2:2') ||
      info.profile.includes('4:4:4')
    ) {
      return true;
    }
    if (
      info.pixFmt &&
      info.pixFmt !== 'yuv420p' &&
      info.pixFmt !== 'yuvj420p' &&
      info.pixFmt !== 'nv12'
    ) {
      return true;
    }
  } else {
    return true;
  }

  // Check audio codec, channel count, and sample rate so audio ALWAYS plays with clear stereo sound
  if (info.hasAudio) {
    const isWebm = ext === 'webm';
    const validBrowserAudio = isWebm
      ? info.audioCodec === 'opus' || info.audioCodec === 'vorbis'
      : info.audioCodec === 'aac' || info.audioCodec === 'mp3';
    if (!validBrowserAudio) {
      return true;
    }
    if (info.audioChannels > 2 || info.audioChannels === 0) return true;
    if (info.audioSampleRate > 0 && (info.audioSampleRate < 22050 || info.audioSampleRate > 48000)) {
      return true;
    }
    if (info.audioStreamIndex > 0) return true;
  }

  return false;
}

async function transcodeToUniversalMp4(
  inputPath: string,
  outputPath: string,
  info: ProbedMediaInfo | null,
  forceReencode: boolean = false,
  ext: string = ''
): Promise<boolean> {
  const isLegacyContainer = new Set([
    'dat',
    'vob',
    'mpg',
    'mpeg',
    'avi',
    'ts',
    'm2ts',
    'mts',
    'wmv',
    'asf',
    '3gp',
    '3g2',
    'divx',
    'xvid',
    'rm',
    'rmvb',
    'dv',
    'ogv',
  ]).has(ext);

  const canCopyVideo =
    !forceReencode &&
    !isLegacyContainer &&
    Boolean(
      info &&
        info.hasVideo &&
        info.videoCodec === 'h264' &&
        (info.pixFmt === 'yuv420p' || info.pixFmt === 'yuvj420p' || info.pixFmt === 'nv12') &&
        !info.profile.includes('10') &&
        !info.profile.includes('4:2:2') &&
        !info.profile.includes('4:4:4')
    );

  const audioMapSpec =
    info && info.audioStreamIndex > 0 ? `0:a:${info.audioStreamIndex}?` : '0:a:0?';

  const buildArgs = (includeAudio: boolean, forceEncodeVideo: boolean): string[] => {
    const args: string[] = [
      '-y',
      '-fflags',
      '+genpts+igndts',
      '-err_detect',
      'ignore_err',
      '-analyzeduration',
      '100M',
      '-probesize',
      '100M',
      '-threads',
      '0',
      '-i',
      inputPath,
      '-map',
      '0:v:0?',
    ];

    if (includeAudio) {
      args.push('-map', audioMapSpec);
    }

    if (canCopyVideo && !forceEncodeVideo) {
      args.push('-c:v', 'copy');
    } else {
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '22',
        '-profile:v',
        'high',
        '-level:v',
        '4.1',
        '-pix_fmt',
        'yuv420p',
        '-sws_flags',
        'fast_bilinear',
        '-vf',
        "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
        '-r',
        '30'
      );
    }

    if (includeAudio && (!info || info.hasAudio)) {
      args.push(
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-b:a',
        '192k',
        '-af',
        'aresample=async=1:first_pts=0'
      );
    } else {
      args.push('-an');
    }

    args.push('-movflags', '+faststart', outputPath);
    return args;
  };

  try {
    await execFileAsync('ffmpeg', buildArgs(true, false), { maxBuffer: 30 * 1024 * 1024 });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return true;
    }
  } catch {
    // Fallback 1: Force full video re-encode with audio
    try {
      await execFileAsync('ffmpeg', buildArgs(true, true), { maxBuffer: 30 * 1024 * 1024 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return true;
      }
    } catch {
      // Fallback 2: Force full video re-encode without audio (if legacy file has corrupt audio track)
      try {
        await execFileAsync('ffmpeg', buildArgs(false, true), { maxBuffer: 30 * 1024 * 1024 });
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return true;
        }
      } catch {}
    }
  }
  return false;
}

function registerUploadedMedia(
  decodedName: string,
  safeName: string,
  url: string,
  duration?: number,
  transcoded?: boolean,
  fileSize?: number
) {
  const entry: MediaRegistryEntry = {
    url,
    fileName: decodedName,
    safeName,
    duration,
    transcoded,
    fileSize,
    updatedAt: new Date().toISOString(),
  };
  const lowerName = decodedName.toLowerCase();
  const lowerSafe = safeName.toLowerCase();
  const baseNoExt = lowerSafe.replace(/\.[^/.]+$/, '');
  mediaRegistry[lowerName] = entry;
  mediaRegistry[lowerSafe] = entry;
  mediaRegistry[baseNoExt] = entry;
  saveMediaRegistry(mediaRegistry);
  if (syncedPlayoutState && Array.isArray(syncedPlayoutState.channels)) {
    savePersistedState(syncedPlayoutState);
  }
}

async function processUploadedMediaFileOnDisk(
  targetPath: string,
  decodedName: string,
  safeName: string,
  finalFileName: string,
  stampTag: string
): Promise<{
  success: boolean;
  url: string;
  fileName: string;
  duration?: number;
  transcoded: boolean;
}> {
  const uploadedSize = fs.statSync(targetPath).size;
  registerUploadedMedia(decodedName, safeName, `/uploads/${finalFileName}`, undefined, false, uploadedSize);

  const ext = (safeName.split('.').pop() || '').toLowerCase();
  if (IMAGE_OR_SWF_EXTS.has(ext)) {
    const swfDur = ext === 'swf' ? parseSwfDurationSecFromDisk(targetPath) : undefined;
    if (swfDur) {
      registerUploadedMedia(decodedName, safeName, `/uploads/${finalFileName}`, swfDur, false, uploadedSize);
    }
    return {
      success: true,
      url: `/uploads/${finalFileName}`,
      fileName: decodedName,
      duration: swfDur,
      transcoded: false,
    };
  }

  const info = await probeMediaWithFfprobe(targetPath);
  if (!info || shouldTranscodeForBrowser(ext, info)) {
    const baseNoExt = safeName.replace(/\.[^/.]+$/, '');
    const transcodedFileName = `${stampTag}_${baseNoExt}_vlc.mp4`;
    const transcodedPath = path.join(uploadsDir, transcodedFileName);
    const ok = await transcodeToUniversalMp4(targetPath, transcodedPath, info, false, ext);
    if (ok) {
      try {
        fs.unlinkSync(targetPath);
      } catch {}
      const postInfo = await probeMediaWithFfprobe(transcodedPath);
      const finalDur = postInfo?.duration || info?.duration || 15;
      registerUploadedMedia(
        decodedName,
        safeName,
        `/uploads/${transcodedFileName}`,
        finalDur,
        true,
        uploadedSize
      );
      return {
        success: true,
        url: `/uploads/${transcodedFileName}`,
        duration: finalDur,
        transcoded: true,
        fileName: decodedName,
      };
    }
  }

  registerUploadedMedia(
    decodedName,
    safeName,
    `/uploads/${finalFileName}`,
    info?.duration || undefined,
    false,
    uploadedSize
  );
  return {
    success: true,
    url: `/uploads/${finalFileName}`,
    duration: info?.duration || undefined,
    transcoded: false,
    fileName: decodedName,
  };
}

let uploadSeqCounter = 0;
function nextUploadStampTag(): string {
  uploadSeqCounter = (uploadSeqCounter + 1) % 10000;
  return `${Date.now()}_${String(uploadSeqCounter).padStart(4, '0')}`;
}

// 3. Media File Upload API -> Streams videos, 4K files, old formats, SWFs, logos, and banners to /uploads/<filename>
app.post('/api/media/upload', async (req: Request, res: Response) => {
  try {
    const rawHeaderName =
      (req.headers['x-file-name'] as string) ||
      (req.query.name as string) ||
      `media_${Date.now()}.mp4`;
    const decodedName = decodeURIComponent(rawHeaderName);
    const safeName = decodedName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stampTag = nextUploadStampTag();
    const finalFileName = `${stampTag}_${safeName}`;
    const targetPath = path.join(uploadsDir, finalFileName);

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      fs.writeFileSync(targetPath, req.body);
    } else {
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(targetPath);
        req.pipe(writeStream);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
        req.on('error', (err) => reject(err));
      });
    }

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size === 0) {
      res.status(400).json({ success: false, error: 'Empty file uploaded' });
      return;
    }

    const result = await processUploadedMediaFileOnDisk(
      targetPath,
      decodedName,
      safeName,
      finalFileName,
      stampTag
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Upload failed' });
  }
});

// 3a-chunk. Chunked Media Upload API for large video files (>12MB, e.g. 100MB, 500MB, 2GB)
app.post('/api/media/upload-chunk', async (req: Request, res: Response) => {
  try {
    const uploadId = String(req.query.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const chunkIndex = parseInt(String(req.query.index || '0'), 10) || 0;
    if (!uploadId) {
      res.status(400).json({ success: false, error: 'Missing uploadId' });
      return;
    }
    const partPath = path.join(uploadsDir, `.part_${uploadId}.bin`);
    const flags = chunkIndex === 0 ? 'w' : 'a';

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      if (chunkIndex === 0) {
        fs.writeFileSync(partPath, req.body);
      } else {
        fs.appendFileSync(partPath, req.body);
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(partPath, { flags });
        req.pipe(ws);
        ws.on('finish', () => resolve());
        ws.on('error', (err) => reject(err));
        req.on('error', (err) => reject(err));
      });
    }

    res.json({ success: true, index: chunkIndex });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Chunk upload failed' });
  }
});

app.post('/api/media/upload-complete', async (req: Request, res: Response) => {
  try {
    const uploadId = String(req.body?.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const rawFileName = String(req.body?.fileName || `media_${Date.now()}.mp4`);
    const decodedName = decodeURIComponent(rawFileName);
    const safeName = decodedName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const partPath = path.join(uploadsDir, `.part_${uploadId}.bin`);

    if (!uploadId || !fs.existsSync(partPath) || fs.statSync(partPath).size === 0) {
      res.status(400).json({ success: false, error: 'Chunked upload file not found' });
      return;
    }

    const stampTag = nextUploadStampTag();
    const finalFileName = `${stampTag}_${safeName}`;
    const targetPath = path.join(uploadsDir, finalFileName);
    fs.renameSync(partPath, targetPath);

    const result = await processUploadedMediaFileOnDisk(
      targetPath,
      decodedName,
      safeName,
      finalFileName,
      stampTag
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Chunk finalize failed' });
  }
});

// 3a. Resolve & stream any uploaded media by original fileName or title with HTTP 206 Range Support
app.get('/api/media/by-name/:name', (req: Request, res: Response) => {
  try {
    const rawName = decodeURIComponent(String(req.params.name || '')).trim();
    const resolved = resolveUploadedFileUrl(rawName);
    if (resolved && resolved.url) {
      const rel = path.basename(resolved.url.replace(/^\/uploads\//, ''));
      const fullPath = path.join(uploadsDir, rel);
      if (fs.existsSync(fullPath)) {
        streamFileWithRange(req, res, fullPath);
        return;
      }
    }
    res.status(404).send('Media not found');
  } catch {
    res.status(500).send('Error resolving media');
  }
});

// 3b. On-Demand VLC Re-Encode & Stream Endpoint with HTTP 206 Range Support
app.get('/api/media/vlc-stream', async (req: Request, res: Response) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    let relName = '';
    if (rawUrl.startsWith('/uploads/')) {
      relName = path.basename(rawUrl.replace(/^\/uploads\//, '').split('?')[0]);
    } else if (rawUrl.startsWith('/api/media/by-name/')) {
      const targetName = decodeURIComponent(rawUrl.replace(/^\/api\/media\/by-name\//, '').split('?')[0]);
      const resolved = resolveUploadedFileUrl(targetName);
      if (resolved?.url && resolved.url.startsWith('/uploads/')) {
        relName = path.basename(resolved.url.replace(/^\/uploads\//, ''));
      }
    } else {
      res.status(400).json({ success: false, error: 'Invalid media path' });
      return;
    }

    const sourcePath = relName ? path.join(uploadsDir, relName) : '';
    if (!relName || !fs.existsSync(sourcePath)) {
      res.status(404).json({ success: false, error: 'Media file not found' });
      return;
    }

    const ext = (relName.split('.').pop() || '').toLowerCase();
    const baseNoExt = relName.replace(/\.[^/.]+$/, '');
    const cachedName = baseNoExt.endsWith('_reencoded_h264')
      ? `${baseNoExt}.mp4`
      : `${baseNoExt}_reencoded_h264.mp4`;
    const cachedPath = path.join(uploadsDir, cachedName);

    if (!fs.existsSync(cachedPath)) {
      const info = await probeMediaWithFfprobe(sourcePath);
      const ok = await transcodeToUniversalMp4(sourcePath, cachedPath, info, true, ext);
      if (!ok) {
        try {
          if (fs.existsSync(cachedPath)) fs.unlinkSync(cachedPath);
        } catch {}
        res.status(415).json({ success: false, error: 'Unsupported or corrupted video file' });
        return;
      }
    }

    streamFileWithRange(req, res, cachedPath);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'VLC stream error' });
  }
});

// 4. RTMP / RTSP / Raw TS Live Stream Pull & Shared HTTP Fragmented-MP4 Broadcaster Hub
interface SharedRtmpSession {
  key: string;
  child: ReturnType<typeof spawn>;
  subscribers: Set<Response>;
  initBoxes: Buffer[];
  initSegment: Buffer | null;
  gopChunks: Buffer[];
  gopBytes: number;
  pendingBytes: Buffer;
  stopTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
}

const sharedRtmpHub = new Map<string, SharedRtmpSession>();

function appendMp4BoxesFromBuffer(session: SharedRtmpSession, incoming: Buffer) {
  session.pendingBytes =
    session.pendingBytes.length > 0
      ? Buffer.concat([session.pendingBytes, incoming])
      : incoming;

  while (session.pendingBytes.length >= 8) {
    const size32 = session.pendingBytes.readUInt32BE(0);
    if (size32 < 8 || size32 > 32 * 1024 * 1024) {
      session.pendingBytes = Buffer.alloc(0);
      break;
    }
    if (session.pendingBytes.length < size32) break;

    const boxType = session.pendingBytes.subarray(4, 8).toString('ascii');
    const box = Buffer.from(session.pendingBytes.subarray(0, size32));
    session.pendingBytes = session.pendingBytes.subarray(size32);

    if (!session.initSegment) {
      if (boxType === 'ftyp' || boxType === 'moov') {
        session.initBoxes.push(box);
        if (boxType === 'moov') {
          session.initSegment = Buffer.concat(session.initBoxes);
        }
        continue;
      }
      if (session.initBoxes.length > 0) {
        session.initSegment = Buffer.concat(session.initBoxes);
      }
    }

    if (boxType === 'moof') {
      session.gopChunks = [box];
      session.gopBytes = box.length;
    } else if (session.gopChunks.length > 0) {
      session.gopChunks.push(box);
      session.gopBytes += box.length;
      while (session.gopBytes > 8 * 1024 * 1024 && session.gopChunks.length > 1) {
        const dropped = session.gopChunks.shift();
        if (dropped) session.gopBytes -= dropped.length;
      }
    }
  }
}

function buildRtmpPullFfmpegArgs(rawUrl: string): string[] {
  const lower = rawUrl.toLowerCase();
  const inputArgs: string[] = [];

  if (lower.startsWith('rtmp://') || lower.startsWith('rtmps://')) {
    inputArgs.push(
      '-rtmp_live', 'live',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
      '-flags', 'low_delay',
      '-analyzeduration', '3000000',
      '-probesize', '3000000'
    );
  } else if (lower.startsWith('rtsp://')) {
    inputArgs.push(
      '-rtsp_transport', 'tcp',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
      '-flags', 'low_delay',
      '-analyzeduration', '3000000',
      '-probesize', '3000000'
    );
  } else {
    inputArgs.push(
      '-rw_timeout', '10000000',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      '-fflags', '+genpts+discardcorrupt'
    );
  }

  return [
    ...inputArgs,
    '-i', rawUrl,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '4.0',
    '-pix_fmt', 'yuv420p',
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];
}

app.get('/api/live/rtmp-pull', (req: Request, res: Response) => {
  const rawUrl = String(req.query.url || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  if (!rawUrl) {
    res.status(400).send('Missing url');
    return;
  }

  const lower = rawUrl.toLowerCase();
  if (
    !lower.startsWith('rtmp://') &&
    !lower.startsWith('rtmps://') &&
    !lower.startsWith('rtsp://') &&
    !lower.startsWith('http://') &&
    !lower.startsWith('https://')
  ) {
    res.status(400).send('Unsupported live stream protocol');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  let session = sharedRtmpHub.get(rawUrl);
  if (!session || session.ended) {
    const ffmpegArgs = buildRtmpPullFfmpegArgs(rawUrl);
    const child = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const newSession: SharedRtmpSession = {
      key: rawUrl,
      child,
      subscribers: new Set<Response>(),
      initBoxes: [],
      initSegment: null,
      gopChunks: [],
      gopBytes: 0,
      pendingBytes: Buffer.alloc(0),
      stopTimer: null,
      ended: false,
    };
    sharedRtmpHub.set(rawUrl, newSession);

    const finalizeSession = () => {
      if (newSession.ended) return;
      newSession.ended = true;
      if (newSession.stopTimer) {
        clearTimeout(newSession.stopTimer);
        newSession.stopTimer = null;
      }
      if (sharedRtmpHub.get(rawUrl) === newSession) {
        sharedRtmpHub.delete(rawUrl);
      }
      for (const sub of newSession.subscribers) {
        try {
          if (!sub.writableEnded) sub.end();
        } catch {}
      }
      newSession.subscribers.clear();
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (newSession.ended) return;
      appendMp4BoxesFromBuffer(newSession, chunk);
      for (const sub of Array.from(newSession.subscribers)) {
        try {
          if (!sub.writableEnded && sub.writable) {
            sub.write(chunk);
          } else {
            newSession.subscribers.delete(sub);
          }
        } catch {
          newSession.subscribers.delete(sub);
        }
      }
    });

    child.stderr?.on('data', () => {
      // Drain stderr to prevent buffer block
    });

    child.on('exit', finalizeSession);
    child.on('error', finalizeSession);
    session = newSession;
  }

  if (session.stopTimer) {
    clearTimeout(session.stopTimer);
    session.stopTimer = null;
  }

  // Send MP4 init segment + most recent GOP fragment so late joiners (Display 2) start immediately
  try {
    if (session.initSegment && res.writable && !res.writableEnded) {
      res.write(session.initSegment);
      for (const frag of session.gopChunks) {
        if (res.writable && !res.writableEnded) {
          res.write(frag);
        }
      }
    }
  } catch {}

  session.subscribers.add(res);

  const activeSession = session;
  req.on('close', () => {
    activeSession.subscribers.delete(res);
    if (activeSession.subscribers.size === 0 && !activeSession.ended) {
      if (activeSession.stopTimer) clearTimeout(activeSession.stopTimer);
      activeSession.stopTimer = setTimeout(() => {
        if (activeSession.subscribers.size === 0 && !activeSession.ended) {
          activeSession.ended = true;
          if (sharedRtmpHub.get(rawUrl) === activeSession) {
            sharedRtmpHub.delete(rawUrl);
          }
          try {
            activeSession.child.kill('SIGKILL');
          } catch {}
        }
      }, 4000);
    }
  });
});

// 5. M3U8 / HLS / HTTP Live Stream CORS Proxy (rewrites segments, keys, maps, and variant playlists)
app.get('/api/live/m3u8-proxy', async (req: Request, res: Response) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl) {
    res.status(400).send('Missing url');
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream error ${upstream.status}`);
      return;
    }

    const finalUrl = upstream.url || targetUrl;
    const contentType = upstream.headers.get('content-type') || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const isM3u8 =
      finalUrl.toLowerCase().includes('.m3u8') ||
      targetUrl.toLowerCase().includes('.m3u8') ||
      contentType.toLowerCase().includes('mpegurl') ||
      contentType.toLowerCase().includes('x-mpegurl');

    if (isM3u8) {
      const text = await upstream.text();
      const baseUrl = new URL('.', finalUrl).toString();
      const rewriteUri = (rawUri: string) => {
        try {
          const abs = new URL(rawUri, baseUrl).toString();
          return `/api/live/m3u8-proxy?url=${encodeURIComponent(abs)}`;
        } catch {
          return rawUri;
        }
      };

      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#')) {
            // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, #EXT-X-I-FRAME-STREAM-INF, etc.
            return line.replace(/URI="([^"]+)"/gi, (_m, uriVal) => `URI="${rewriteUri(uriVal)}"`);
          }
          return rewriteUri(trimmed);
        })
        .join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
      return;
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const contentLen = upstream.headers.get('content-length');
    if (contentLen) {
      res.setHeader('Content-Length', contentLen);
    }

    if (upstream.body && typeof (upstream.body as any).getReader === 'function') {
      const reader = (upstream.body as any).getReader();
      let reqClosed = false;
      req.on('close', () => {
        reqClosed = true;
        reader.cancel().catch(() => {});
      });
      while (!reqClosed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const arrayBuf = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(502).send(err?.message || 'Proxy error');
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

// 5b. YouTube Video / Live / Playlist Resolver (safely parses pasted batches and expands YouTube playlists)
const YT_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchYouTubeOEmbedTitle(videoId: string): Promise<{ title?: string } | null> {
  if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) return null;
  try {
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { headers: YT_FETCH_HEADERS, signal: AbortSignal.timeout(3500) }
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as any;
    return {
      title: typeof json?.title === 'string' && json.title.trim() ? json.title.trim() : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveYouTubePlaylistFromWeb(playlistId: string): Promise<YouTubeQueueItem[]> {
  if (!YOUTUBE_PLAYLIST_ID_REGEX.test(playlistId)) return [];
  try {
    const resp = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, {
      headers: YT_FETCH_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const match = html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!match?.[1]) return [];
    const data = JSON.parse(match[1]);
    const collected: YouTubeQueueItem[] = [];
    const seen = new Set<string>();

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.playlistVideoRenderer && typeof node.playlistVideoRenderer === 'object') {
        const r = node.playlistVideoRenderer;
        const vid = String(r.videoId || '').trim();
        if (YOUTUBE_VIDEO_ID_REGEX.test(vid) && !seen.has(vid)) {
          seen.add(vid);
          const titleRuns = Array.isArray(r.title?.runs) ? r.title.runs.map((x: any) => x.text || '').join('') : '';
          const simpleTitle = String(r.title?.simpleText || titleRuns || `YouTube Video (${vid})`).trim();
          const lenSec = parseInt(String(r.lengthSeconds || '0'), 10) || undefined;
          const badgeList = Array.isArray(r.thumbnailOverlays) ? JSON.stringify(r.thumbnailOverlays) : '';
          const isLive = badgeList.includes('"style":"LIVE"') || Boolean(r.isLivePlayback);
          collected.push({
            id: `yt-${vid}-${collected.length}`,
            videoId: vid,
            playlistId,
            url: `https://www.youtube.com/watch?v=${vid}`,
            title: simpleTitle,
            isLive,
            enabled: true,
            durationSec: lenSec,
          });
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else {
        for (const k of Object.keys(node)) walk(node[k]);
      }
    };

    walk(data);
    return collected;
  } catch {
    return [];
  }
}

async function resolveChannelLiveVideoFromWeb(channelLiveUrl: string): Promise<YouTubeQueueItem | null> {
  try {
    const parsed = new URL(channelLiveUrl);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname.toLowerCase())) {
      return null;
    }
    const resp = await fetch(parsed.toString(), {
      headers: YT_FETCH_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/i);
    const idMatch = canonicalMatch?.[1] || html.match(/"videoId":"([A-Za-z0-9_-]{11})"/)?.[1];
    if (!idMatch || !YOUTUBE_VIDEO_ID_REGEX.test(idMatch)) return null;
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch?.[1]?.replace(/\s*-\s*YouTube\s*$/i, '').trim() || `YouTube Live (${idMatch})`;
    return {
      id: `yt-${idMatch}-live`,
      videoId: idMatch,
      url: `https://www.youtube.com/watch?v=${idMatch}`,
      title: rawTitle,
      isLive: true,
      enabled: true,
    };
  } catch {
    return null;
  }
}

app.post('/api/live/youtube/resolve', async (req: Request, res: Response) => {
  try {
    const rawText = typeof req.body?.inputText === 'string'
      ? req.body.inputText
      : Array.isArray(req.body?.urls)
      ? req.body.urls.join('\n')
      : '';

    const { tokens, invalidTokens } = parseYouTubeBatchInput(rawText);
    const resolvedItems: YouTubeQueueItem[] = [];
    const seenVideoIds = new Set<string>();
    const unresolvedPlaylists: string[] = [];

    const pushUniqueItem = (it: YouTubeQueueItem) => {
      if (!it.videoId || !YOUTUBE_VIDEO_ID_REGEX.test(it.videoId)) return;
      if (seenVideoIds.has(it.videoId)) return;
      seenVideoIds.add(it.videoId);
      resolvedItems.push({
        ...it,
        id: it.id || `yt-${it.videoId}-${resolvedItems.length}`,
        enabled: it.enabled !== false,
      });
    };

    const oembedJobs: Array<Promise<void>> = [];

    for (const token of tokens) {
      if (token.kind === 'video' && token.videoId) {
        const item: YouTubeQueueItem = {
          id: `yt-${token.videoId}-${resolvedItems.length}`,
          videoId: token.videoId,
          playlistId: token.playlistId,
          url: token.url,
          title: token.title,
          isLive: Boolean(token.isLiveHint),
          enabled: true,
        };
        pushUniqueItem(item);
        oembedJobs.push(
          fetchYouTubeOEmbedTitle(token.videoId).then((meta) => {
            if (meta?.title) {
              item.title = meta.title;
            }
          })
        );
      } else if (token.kind === 'playlist' && token.playlistId) {
        const plItems = await resolveYouTubePlaylistFromWeb(token.playlistId);
        if (plItems.length === 0) {
          unresolvedPlaylists.push(token.playlistId);
        } else {
          plItems.forEach((pItem) => pushUniqueItem(pItem));
        }
      } else if (token.kind === 'channel_live') {
        const liveItem = await resolveChannelLiveVideoFromWeb(token.url);
        if (liveItem) {
          pushUniqueItem(liveItem);
        }
      }
    }

    await Promise.allSettled(oembedJobs);

    res.json({
      success: true,
      items: resolvedItems,
      invalidTokens,
      unresolvedPlaylists,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to resolve YouTube links',
      items: [],
    });
  }
});

// 6. Native Windows Multi-Resolution Icon (.ico)
app.get('/assets/ashoka-icon.ico', (_req: Request, res: Response) => {
  const icoBuf = generateAshokaIcoBuffer();
  res.setHeader('Content-Type', 'image/x-icon');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(icoBuf);
});

// 7. OBS-Style Windows Setup Wizard (.hta)
app.get('/api/installer/obs-wizard.hta', (_req: Request, res: Response) => {
  const hta = generateObsStyleInstallerHta();
  res.setHeader('Content-Type', 'application/hta; charset=utf-8');
  res.send(hta);
});

// 7b. OBS-Style Windows Uninstaller Wizard (.hta) & uninstall scripts
app.get('/api/installer/uninstaller-wizard.hta', (_req: Request, res: Response) => {
  const hta = generateUninstallerHta();
  res.setHeader('Content-Type', 'application/hta; charset=utf-8');
  res.send(hta);
});

app.get(['/api/download/uninstall.bat', '/download/uninstall.bat'], (_req: Request, res: Response) => {
  const bat = generateUninstallBat();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="uninstall.bat"');
  res.send(bat);
});

app.get(
  ['/api/download/Uninstall.exe', '/api/download/uninstall.exe', '/download/Uninstall.exe', '/download/uninstall.exe'],
  (_req: Request, res: Response) => {
    const exeBuffer = buildStandaloneUninstallerExe();
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    res.setHeader('Content-Disposition', 'attachment; filename="Uninstall.exe"');
    res.setHeader('Content-Length', exeBuffer.length.toString());
    res.send(exeBuffer);
  }
);

// 8. Downloadable Genuine Windows ashokacabletvplayout.settop.exe Installer
app.get(
  [
    '/download/ashokacabletvplayout.settop.exe',
    '/api/download/ashokacabletvplayout.settop.exe',
    '/ashokacabletvplayout.settop.exe',
    '/download/Setup.exe',
    '/api/download/Setup.exe',
    '/api/download/Ashoka_MSO_Playlist_Setup.exe',
    '/api/download/Ashoka_MSO_Playlist.exe',
  ],
  (req: Request, res: Response) => {
    const outFileName = req.path.toLowerCase().includes('setup.exe')
      ? 'Setup.exe'
      : 'ashokacabletvplayout.settop.exe';
    const exeBuffer = buildSelfExtractingOfflineOnlineSetupExe(__dirname);
    res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
    res.setHeader('Content-Disposition', `attachment; filename="${outFileName}"`);
    res.setHeader('Content-Length', exeBuffer.length.toString());
    res.send(exeBuffer);
  }
);

// 9. Lightweight Software + Backend Code Export (< 5 MB, excludes uploaded media & node_modules)
app.get(
  ['/api/download/software-code.zip', '/api/export/backend-code.zip'],
  (_req: Request, res: Response) => {
    try {
      const entries: Array<{ name: string; data: Buffer; compress?: boolean }> = [];
      const addFileIfExists = (relPath: string, compress = true) => {
        const full = path.join(__dirname, relPath);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          entries.push({ name: relPath.replace(/\\/g, '/'), data: fs.readFileSync(full), compress });
        }
      };
      const addDirRecursive = (relDir: string) => {
        const base = path.join(__dirname, relDir);
        if (!fs.existsSync(base)) return;
        for (const item of fs.readdirSync(base)) {
          const itemRel = path.join(relDir, item);
          const full = path.join(__dirname, itemRel);
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            addDirRecursive(itemRel);
          } else if (st.isFile()) {
            const isBinaryVideo = item.toLowerCase().endsWith('.mp4');
            entries.push({
              name: itemRel.replace(/\\/g, '/'),
              data: fs.readFileSync(full),
              compress: !isBinaryVideo,
            });
          }
        }
      };

      for (const f of [
        'server.ts',
        'index.html',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'metadata.json',
        '.env.example',
        '.gitignore',
        'public/manifest.json',
        'public/sw.js',
        'public/assets/ashoka-icon.svg',
        'public/assets/ashoka-icon.ico',
      ]) {
        addFileIfExists(f, true);
      }
      addDirRecursive('src');
      addDirRecursive('data');
      addDirRecursive('public/videos');

      const zipBuffer = buildZipArchiveBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="ashoka-playout-software-code.zip"');
      res.setHeader('Content-Length', zipBuffer.length.toString());
      res.send(zipBuffer);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to build software code archive' });
    }
  }
);

// Mount Vite in dev mode or serve static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ashoka Playout Studio running at http://localhost:${PORT}`);
  });
}

startServer();
