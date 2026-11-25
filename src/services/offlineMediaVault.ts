import {
  isSwfFile,
  parseSwfHeaderMetadata,
  swfEngine,
  uploadMediaFileToBackend,
} from './swfEngine';

const DB_NAME = 'ashoka_offline_vault_v1';
const DB_VERSION = 1;
const STORE_MEDIA = 'media_files';
const STORE_STATE = 'playout_state';

interface StoredMediaRecord {
  id: string;
  name: string;
  normalizedName: string;
  type: string;
  size: number;
  folderName?: string;
  serverUrl?: string;
  blob: Blob;
  updatedAt: number;
}

const liveBlobUrlByVaultId = new Map<string, string>();
const liveFileByVaultId = new Map<string, File>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_MEDIA)) {
          const store = db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
          store.createIndex('normalizedName', 'normalizedName', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_STATE)) {
          db.createObjectStore(STORE_STATE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export function normalizeMediaFileName(name?: string): string {
  if (!name) return '';
  // Strip any leading timestamp prefix like 1790823926024_ from /uploads/ filenames
  const base = name.split('/').pop()?.split('?')[0] || name;
  return decodeURIComponent(base)
    .replace(/^\d{10,15}_/, '')
    .trim()
    .toLowerCase();
}

export function extractFolderName(file: File): string | undefined {
  const rel = (file as any).webkitRelativePath as string | undefined;
  if (!rel || !rel.includes('/')) return undefined;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  // Return the top-level or nested folder path excluding the filename
  return parts.slice(0, parts.length - 1).join(' / ');
}

export function computeVaultIdForFile(file: File): string {
  const folder = extractFolderName(file) || '';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `vault:${folder ? folder + ':' : ''}${safeName}:${file.size}`;
}

export function registerLiveMediaInVault(
  file: File,
  customVaultId?: string
): { vaultId: string; blobUrl: string } {
  const vaultId = customVaultId || computeVaultIdForFile(file);
  let blobUrl = liveBlobUrlByVaultId.get(vaultId);
  if (!blobUrl) {
    blobUrl = URL.createObjectURL(file);
    liveBlobUrlByVaultId.set(vaultId, blobUrl);
  }
  liveFileByVaultId.set(vaultId, file);
  return { vaultId, blobUrl };
}

export async function saveFileToOfflineVault(
  file: File,
  customVaultId?: string,
  serverUrl?: string
): Promise<{ vaultId: string; blobUrl: string }> {
  const { vaultId, blobUrl } = registerLiveMediaInVault(file, customVaultId);
  const folderName = extractFolderName(file);

  const db = await openVaultDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_MEDIA, 'readwrite');
        const store = tx.objectStore(STORE_MEDIA);
        const rec: StoredMediaRecord = {
          id: vaultId,
          name: file.name,
          normalizedName: normalizeMediaFileName(file.name),
          type: file.type || 'application/octet-stream',
          size: file.size,
          folderName,
          serverUrl,
          blob: file,
          updatedAt: Date.now(),
        };
        store.put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  return { vaultId, blobUrl };
}

export const saveMediaToOfflineVault = saveFileToOfflineVault;

export async function updateVaultRecordServerUrl(
  vaultId: string,
  serverUrl: string
): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      const store = tx.objectStore(STORE_MEDIA);
      const getReq = store.get(vaultId);
      getReq.onsuccess = () => {
        const existing = getReq.result as StoredMediaRecord | undefined;
        if (existing) {
          existing.serverUrl = serverUrl;
          existing.updatedAt = Date.now();
          store.put(existing);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getMediaFromOfflineVault(
  vaultId?: string,
  fileNameOrUrl?: string
): Promise<{ vaultId: string; blobUrl: string; file: File; serverUrl?: string; folderName?: string } | null> {
  if (vaultId && liveBlobUrlByVaultId.has(vaultId) && liveFileByVaultId.has(vaultId)) {
    return {
      vaultId,
      blobUrl: liveBlobUrlByVaultId.get(vaultId)!,
      file: liveFileByVaultId.get(vaultId)!,
    };
  }

  const db = await openVaultDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MEDIA, 'readonly');
      const store = tx.objectStore(STORE_MEDIA);

      const finishWithRecord = (rec?: StoredMediaRecord | null) => {
        if (!rec || !rec.blob) {
          resolve(null);
          return;
        }
        let blobUrl = liveBlobUrlByVaultId.get(rec.id);
        let fileObj = liveFileByVaultId.get(rec.id);
        if (!fileObj) {
          fileObj =
            rec.blob instanceof File
              ? rec.blob
              : new File([rec.blob], rec.name || 'media', { type: rec.type });
          liveFileByVaultId.set(rec.id, fileObj);
        }
        if (!blobUrl) {
          blobUrl = URL.createObjectURL(fileObj);
          liveBlobUrlByVaultId.set(rec.id, blobUrl);
        }
        resolve({
          vaultId: rec.id,
          blobUrl,
          file: fileObj,
          serverUrl: rec.serverUrl,
          folderName: rec.folderName,
        });
      };

      if (vaultId) {
        const req = store.get(vaultId);
        req.onsuccess = () => {
          if (req.result) {
            finishWithRecord(req.result as StoredMediaRecord);
          } else if (fileNameOrUrl) {
            lookupByName(store, fileNameOrUrl, finishWithRecord);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => {
          if (fileNameOrUrl) {
            lookupByName(store, fileNameOrUrl, finishWithRecord);
          } else {
            resolve(null);
          }
        };
      } else if (fileNameOrUrl) {
        lookupByName(store, fileNameOrUrl, finishWithRecord);
      } else {
        resolve(null);
      }
    } catch {
      resolve(null);
    }
  });
}

function lookupByName(
  store: IDBObjectStore,
  fileNameOrUrl: string,
  cb: (rec?: StoredMediaRecord | null) => void
) {
  const norm = normalizeMediaFileName(fileNameOrUrl);
  if (!norm) {
    cb(null);
    return;
  }
  try {
    const idx = store.index('normalizedName');
    const req = idx.getAll(norm);
    req.onsuccess = () => {
      const list = (req.result as StoredMediaRecord[]) || [];
      if (list.length > 0) {
        // Pick most recently updated
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        cb(list[0]);
      } else {
        cb(null);
      }
    };
    req.onerror = () => cb(null);
  } catch {
    cb(null);
  }
}

export async function uploadAndPersistMediaFile(
  file: File,
  existingVaultId?: string
): Promise<{
  vaultId: string;
  blobUrl: string;
  serverUrl?: string;
  bestUrl: string;
  duration?: number;
  transcoded?: boolean;
  folderName?: string;
}> {
  const folderName = extractFolderName(file);
  const { vaultId, blobUrl } = await saveFileToOfflineVault(file, existingVaultId);

  // If SWF, preload immediately into swfEngine from raw File bytes
  if (isSwfFile(file)) {
    try {
      const meta = await parseSwfHeaderMetadata(file);
      swfEngine.registerSwfMetadata(blobUrl, file.name, meta);
    } catch {}
  }

  try {
    const upData = await uploadMediaFileToBackend(file);
    if (upData && upData.url) {
      await updateVaultRecordServerUrl(vaultId, upData.url);
      if (isSwfFile(file)) {
        try {
          const meta = await parseSwfHeaderMetadata(file);
          swfEngine.aliasSwfUrl(blobUrl, upData.url, file.name, meta);
        } catch {}
      }
      return {
        vaultId,
        blobUrl,
        serverUrl: upData.url,
        bestUrl: upData.url,
        duration: typeof upData.duration === 'number' && upData.duration > 0 ? upData.duration : undefined,
        transcoded: Boolean(upData.transcoded),
        folderName,
      };
    }
  } catch {
    // Offline mode: fallback cleanly to IndexedDB vault blobUrl
  }

  return {
    vaultId,
    blobUrl,
    bestUrl: blobUrl,
    folderName,
  };
}

export async function savePlayoutStateToOfflineVault(statePayload: any): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_STATE, 'readwrite');
      const store = tx.objectStore(STORE_STATE);
      store.put({
        id: 'current_playout_state',
        payload: statePayload,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export const savePlayoutStateToVault = savePlayoutStateToOfflineVault;

export async function loadPlayoutStateFromOfflineVault(): Promise<any | null> {
  const db = await openVaultDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const store = tx.objectStore(STORE_STATE);
      const req = store.get('current_playout_state');
      req.onsuccess = () => {
        resolve(req.result?.payload || null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const loadPlayoutStateFromVault = loadPlayoutStateFromOfflineVault;

export async function clearOfflineVaultForReset(): Promise<void> {
  liveBlobUrlByVaultId.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  liveBlobUrlByVaultId.clear();
  liveFileByVaultId.clear();

  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE_MEDIA, STORE_STATE], 'readwrite');
      tx.objectStore(STORE_MEDIA).clear();
      tx.objectStore(STORE_STATE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function restoreMediaUrlFromVault(
  vaultId?: string,
  fileNameOrUrl?: string
): Promise<string | null> {
  const rec = await getMediaFromOfflineVault(vaultId, fileNameOrUrl);
  return rec ? rec.blobUrl : null;
}

async function isServerUrlReachable(url: string): Promise<boolean> {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

async function hydrateSingleMediaItem(item: any): Promise<any> {
  if (!item || typeof item !== 'object') return item;
  const rawUrl = String(item.url || item.imageUrl || item.videoUrl || '');
  const nameHint = item.fileName || item.name || item.label || item.title || rawUrl;
  const vaultId = item.vaultId as string | undefined;

  if (rawUrl.startsWith('data:')) {
    return item;
  }

  // 1. Check Offline IndexedDB Vault FIRST!
  // Restoring a local blob: URL from IndexedDB takes <2ms and guarantees that every file & folder
  // added on Day 1 plays immediately on next startup even offline or after container restarts.
  const restored = await getMediaFromOfflineVault(vaultId, nameHint);
  if (restored && restored.blobUrl) {
    const finalUrl = restored.blobUrl;

    if (restored.file && isSwfFile(restored.file)) {
      parseSwfHeaderMetadata(restored.file)
        .then((meta) => {
          swfEngine.registerSwfMetadata(restored.blobUrl, restored.file.name, meta);
        })
        .catch(() => {});
    }

    // Non-blocking background sync to server if needed (never blocks startup playback!)
    if (restored.file && !restored.serverUrl) {
      uploadMediaFileToBackend(restored.file)
        .then(async (upData) => {
          if (upData?.url) {
            await updateVaultRecordServerUrl(restored.vaultId, upData.url);
            if (isSwfFile(restored.file)) {
              const meta = await parseSwfHeaderMetadata(restored.file);
              swfEngine.aliasSwfUrl(restored.blobUrl, upData.url, restored.file.name, meta);
            }
          }
        })
        .catch(() => {});
    }

    const next = {
      ...item,
      vaultId: restored.vaultId,
      folderName: item.folderName || restored.folderName,
    };
    if ('url' in item || !('imageUrl' in item)) {
      next.url = finalUrl;
    }
    if ('videoUrl' in item) {
      next.videoUrl = finalUrl;
    }
    if ('imageUrl' in item) {
      next.imageUrl = finalUrl;
    }
    return next;
  }

  // 2. Fallback: Check if URL is a valid reachable server URL (/uploads/..., /api/media/by-name/..., /videos/...)
  if (
    rawUrl.startsWith('/uploads/') ||
    rawUrl.startsWith('/api/media/') ||
    rawUrl.startsWith('/videos/') ||
    rawUrl.startsWith('http')
  ) {
    const isSwfCandidate =
      item.mediaType === 'swf' ||
      item.type === 'swf' ||
      item.isSwf ||
      rawUrl.toLowerCase().endsWith('.swf') ||
      String(nameHint).toLowerCase().endsWith('.swf');

    const ok = await isServerUrlReachable(rawUrl);
    if (ok) {
      if (isSwfCandidate) {
        swfEngine.preloadSwf(rawUrl, String(nameHint));
      }
      return item;
    }

    // If an older timestamped /uploads/ URL was replaced by a newer upload of the same file name, resolve by name!
    if (nameHint && !rawUrl.startsWith('/api/media/by-name/')) {
      const byNameUrl = `/api/media/by-name/${encodeURIComponent(String(nameHint))}`;
      const byNameOk = await isServerUrlReachable(byNameUrl);
      if (byNameOk) {
        if (isSwfCandidate) {
          swfEngine.preloadSwf(byNameUrl, String(nameHint));
        }
        const next = { ...item };
        if ('url' in item || !('imageUrl' in item)) next.url = byNameUrl;
        if ('videoUrl' in item) next.videoUrl = byNameUrl;
        if ('imageUrl' in item) next.imageUrl = byNameUrl;
        return next;
      }
    }
  }

  return item;
}

async function hydrateLogoConfig(logo: any): Promise<any> {
  if (!logo || typeof logo !== 'object') return logo;
  let nextLogo = { ...logo };

  if (Array.isArray(nextLogo.playlist) && nextLogo.playlist.length > 0) {
    const hydratedPlaylist = await Promise.all(
      nextLogo.playlist.map((it: any) => hydrateSingleMediaItem(it))
    );
    nextLogo.playlist = hydratedPlaylist;
    const activeIdx = Math.min(
      Math.max(0, nextLogo.currentIndex || 0),
      hydratedPlaylist.length - 1
    );
    const activeItem = hydratedPlaylist[activeIdx] || hydratedPlaylist[0];
    if (activeItem?.url) {
      nextLogo.url = activeItem.url;
      nextLogo.label = activeItem.fileName || activeItem.title || nextLogo.label;
      nextLogo.isSwf = Boolean(
        activeItem.isSwf ||
          String(activeItem.fileName || activeItem.title || activeItem.url)
            .toLowerCase()
            .endsWith('.swf')
      );
      nextLogo.isGif = Boolean(activeItem.isGif);
      nextLogo.duration = activeItem.duration || nextLogo.duration;
    }
  } else if (nextLogo.url || nextLogo.imageUrl || nextLogo.label) {
    const hydratedSelf = await hydrateSingleMediaItem(nextLogo);
    nextLogo = hydratedSelf;
  }

  return nextLogo;
}

export async function hydrateChannelsAndAdsFromVault(
  channels: any[],
  everyNMinAds?: any[]
): Promise<{ channels: any[]; everyNMinAds: any[] }> {
  const hydratedAds = Array.isArray(everyNMinAds)
    ? await Promise.all(everyNMinAds.map((ad) => hydrateSingleMediaItem(ad)))
    : [];

  const hydratedChannels = await Promise.all(
    (channels || []).map(async (ch) => {
      if (!ch || typeof ch !== 'object') return ch;

      const playlist = Array.isArray(ch.playlist)
        ? await Promise.all(ch.playlist.map((c: any) => hydrateSingleMediaItem(c)))
        : [];

      const scheduledPrograms = Array.isArray(ch.scheduledPrograms)
        ? await Promise.all(
            ch.scheduledPrograms.map(async (prog: any) => ({
              ...prog,
              playlist: Array.isArray(prog?.playlist)
                ? await Promise.all(prog.playlist.map((c: any) => hydrateSingleMediaItem(c)))
                : [],
              clips: Array.isArray(prog?.clips)
                ? await Promise.all(prog.clips.map((c: any) => hydrateSingleMediaItem(c)))
                : undefined,
            }))
          )
        : [];

      const chAds = Array.isArray(ch.everyNMinAds)
        ? await Promise.all(ch.everyNMinAds.map((ad: any) => hydrateSingleMediaItem(ad)))
        : hydratedAds;

      const bottomOverlay = ch.bottomOverlay
        ? {
            ...ch.bottomOverlay,
            playlist: Array.isArray(ch.bottomOverlay.playlist)
              ? await Promise.all(
                  ch.bottomOverlay.playlist.map((it: any) => hydrateSingleMediaItem(it))
                )
              : [],
          }
        : ch.bottomOverlay;

      const topOverlay = ch.topOverlay
        ? {
            ...ch.topOverlay,
            playlist: Array.isArray(ch.topOverlay.playlist)
              ? await Promise.all(
                  ch.topOverlay.playlist.map((it: any) => hydrateSingleMediaItem(it))
                )
              : [],
          }
        : ch.topOverlay;

      const lShape = ch.lShape
        ? {
            ...ch.lShape,
            playlist: Array.isArray(ch.lShape.playlist)
              ? await Promise.all(
                  ch.lShape.playlist.map((it: any) => hydrateSingleMediaItem(it))
                )
              : [],
          }
        : ch.lShape;

      const g = ch.graphics ? { ...ch.graphics } : {};
      if (g.channelLogo) g.channelLogo = await hydrateLogoConfig(g.channelLogo);
      if (g.sponsor1Logo) g.sponsor1Logo = await hydrateLogoConfig(g.sponsor1Logo);
      if (g.sponsor2Logo) g.sponsor2Logo = await hydrateLogoConfig(g.sponsor2Logo);
      if (g.sponsorLogo1) g.sponsorLogo1 = await hydrateLogoConfig(g.sponsorLogo1);
      if (g.sponsorLogo2) g.sponsorLogo2 = await hydrateLogoConfig(g.sponsorLogo2);
      if (g.sponsorLogo3) g.sponsorLogo3 = await hydrateLogoConfig(g.sponsorLogo3);
      if (g.sponsorLogo4) g.sponsorLogo4 = await hydrateLogoConfig(g.sponsorLogo4);

      return {
        ...ch,
        playlist,
        scheduledPrograms,
        everyNMinAds: chAds,
        bottomOverlay,
        topOverlay,
        lShape,
        graphics: g,
      };
    })
  );

  return {
    channels: hydratedChannels,
    everyNMinAds: hydratedChannels[0]?.everyNMinAds || hydratedAds,
  };
}
