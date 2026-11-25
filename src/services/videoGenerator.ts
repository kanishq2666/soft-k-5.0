import { TVChannel, AspectRatioMode, LogoItemConfig, OverlayBannerConfig, OverlayFitMode, BackInTimerConfig } from '../types/playout';
import { DEFAULT_BACK_IN_TIMER_CONFIG } from '../components/BackInTimerEditorModal';
import { swfEngine, isVideoFile, isImageUrl } from './swfEngine';
import { evaluateLicenseStatus } from '../utils/licenseCrypto';
import { isYouTubeLiveStageActive } from '../utils/youtubeLive';
import { getActiveFallbackCanvas } from '../utils/liveCaptureFallbackStream';
import { getMediaFromOfflineVault } from './offlineMediaVault';
import {
  ActiveTickerItem,
  CgLiveSyncSnapshot,
  TickerSyncTrackState,
  evaluateTickerPassCompletion,
  filterActiveTickerItems,
  isTickerBarExpired,
  pickSyncedCycleLogoIndex,
  reconcileSyncedTickerState,
  resolveTickerItemDurationSec,
} from '../utils/tickerSync';

interface DetectedLShapeLayout {
  isFullL: boolean;
  hasAlphaCutout: boolean;
  hasSolidColorCutout: boolean;
  nativeSide: 'left' | 'right';
  cutoutSideW?: number;
  cutoutBottomH?: number;
  keyColor?: [number, number, number];
}

class VideoGeneratorService {
  private tickerOffsets: Map<string, number> = new Map();
  private tickerSeqState: Map<
    string,
    {
      itemIndex: number;
      posX: number;
      initialized: boolean;
      activeItemId: string;
      lastDirection: 'rtl' | 'ltr';
      lastTimestamp?: number;
      itemStartedAtMs?: number;
    }
  > = new Map();
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private logoVideoCache: Map<string, HTMLVideoElement> = new Map();
  private lastBannerCanvas: Map<string, HTMLCanvasElement> = new Map();
  private lastBannerSnapshotMeta: Map<string, { url: string; ts: number }> = new Map();
  private logoSpriteCache: Map<string, HTMLCanvasElement> = new Map();
  private tickerStripCache: Map<string, { canvas: HTMLCanvasElement; width: number; height: number; textWidth: number }> = new Map();
  private tickerBadgeCache: Map<string, { canvas: HTMLCanvasElement; width: number; height: number }> = new Map();
  private demoBadgeCache: { key: string; canvas: HTMLCanvasElement; pillX: number; pillY: number } | null = null;
  private lastMainVideoCanvas: HTMLCanvasElement | null = null;
  private lastProgVideoCanvas: HTMLCanvasElement | null = null;
  private lastActiveLogoUrlBySlot: Map<string, string> = new Map();
  private lShapeLayoutCache: Map<string, DetectedLShapeLayout> = new Map();
  private keyedLShapeCanvas: HTMLCanvasElement | null = null;
  private lastCacheSnapshotMs = 0;
  private authoritativeCgSync: CgLiveSyncSnapshot | null = null;
  private liveTickerSnapshot: {
    bottomTicker?: TickerSyncTrackState;
    topTicker?: TickerSyncTrackState;
  } = {};

  public setAuthoritativeCgSync(snapshot: CgLiveSyncSnapshot | null | undefined) {
    this.authoritativeCgSync = snapshot || null;
  }

  public getAuthoritativeCgSyncSnapshot(channel?: TVChannel): CgLiveSyncSnapshot {
    return {
      epochMs: Date.now(),
      bottomOverlay: channel?.bottomOverlay
        ? {
            currentIndex: channel.bottomOverlay.currentIndex || 0,
            currentTime: channel.bottomOverlay.currentTime || 0,
          }
        : undefined,
      topOverlay: channel?.topOverlay
        ? {
            currentIndex: channel.topOverlay.currentIndex || 0,
            currentTime: channel.topOverlay.currentTime || 0,
          }
        : undefined,
      lShape: channel?.lShape
        ? {
            currentIndex: channel.lShape.currentIndex || 0,
            currentTime: channel.lShape.currentTime || 0,
            periodicActive: channel.lShape.periodicActive,
          }
        : undefined,
      bottomTicker: this.liveTickerSnapshot.bottomTicker,
      topTicker: this.liveTickerSnapshot.topTicker,
    };
  }

  private detectLShapeFrameLayout(
    url: string,
    source: CanvasImageSource,
    mediaW: number,
    mediaH: number
  ): DetectedLShapeLayout {
    if (!url) {
      return {
        isFullL: false,
        hasAlphaCutout: false,
        hasSolidColorCutout: false,
        nativeSide: 'left',
      };
    }
    if (url.startsWith('data:image/svg+xml')) {
      return {
        isFullL: true,
        hasAlphaCutout: true,
        hasSolidColorCutout: false,
        nativeSide: url.includes('x="1540"') ? 'right' : 'left',
        cutoutSideW: 380,
        cutoutBottomH: 180,
      };
    }
    const cached = this.lShapeLayoutCache.get(url);
    if (cached) return cached;

    if (mediaW < 300 || mediaH < 200 || mediaW / mediaH < 1.28) {
      const res: DetectedLShapeLayout = {
        isFullL: false,
        hasAlphaCutout: false,
        hasSolidColorCutout: false,
        nativeSide: 'left',
      };
      this.lShapeLayoutCache.set(url, res);
      return res;
    }

    try {
      const W = 160;
      const H = 90;
      const probe = document.createElement('canvas');
      probe.width = W;
      probe.height = H;
      const pCtx = probe.getContext('2d');
      if (pCtx) {
        pCtx.drawImage(source, 0, 0, W, H);
        const imgData = pCtx.getImageData(0, 0, W, H).data;
        const px = (x: number, y: number) => {
          const idx = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4;
          return [imgData[idx], imgData[idx + 1], imgData[idx + 2], imgData[idx + 3]] as const;
        };

        const topRight = px(115, 22);
        const topLeft = px(45, 22);
        const leftPillar = px(10, 42);
        const rightPillar = px(148, 42);
        const botBar = px(80, 82);

        // 1. Check if transparent L-Shape PNG/WebP/GIF cutout in top-right (Left L-Shape)
        if (topRight[3] < 60 && (leftPillar[3] > 80 || botBar[3] > 80)) {
          // Scan from INSIDE the transparent upper-right window leftward to find the true outer edge of the left wing
          let maxLeftWingX = 24;
          for (let y = 8; y < 62; y += 2) {
            for (let x = 120; x >= 8; x--) {
              if (px(x, y)[3] > 90 && px(Math.max(0, x - 1), y)[3] > 90) {
                if (x > maxLeftWingX) maxLeftWingX = x;
                break;
              }
            }
          }
          // Scan from INSIDE the transparent upper-right window downward to find the true top edge of the bottom bar
          let minBotBarY = 72;
          for (let x = 45; x < 150; x += 3) {
            for (let y = 20; y < H - 2; y++) {
              if (px(x, y)[3] > 90 && px(x, Math.min(H - 1, y + 1))[3] > 90) {
                if (y < minBotBarY) minBotBarY = y;
                break;
              }
            }
          }
          const res: DetectedLShapeLayout = {
            isFullL: true,
            hasAlphaCutout: true,
            hasSolidColorCutout: false,
            nativeSide: 'left',
            cutoutSideW: Math.max(180, Math.min(680, Math.round((maxLeftWingX / W) * 1920))),
            cutoutBottomH: Math.max(90, Math.min(380, Math.round(((H - minBotBarY) / H) * 1080))),
          };
          this.lShapeLayoutCache.set(url, res);
          return res;
        }

        // 2. Check if transparent L-Shape PNG/WebP/GIF cutout in top-left (Right L-Shape)
        if (topLeft[3] < 60 && (rightPillar[3] > 80 || botBar[3] > 80)) {
          let minRightWingX = W - 24;
          for (let y = 8; y < 62; y += 2) {
            for (let x = 40; x < W - 8; x++) {
              if (px(x, y)[3] > 90 && px(Math.min(W - 1, x + 1), y)[3] > 90) {
                if (x < minRightWingX) minRightWingX = x;
                break;
              }
            }
          }
          let minBotBarY = 72;
          for (let x = 10; x < 115; x += 3) {
            for (let y = 20; y < H - 2; y++) {
              if (px(x, y)[3] > 90 && px(x, Math.min(H - 1, y + 1))[3] > 90) {
                if (y < minBotBarY) minBotBarY = y;
                break;
              }
            }
          }
          const res: DetectedLShapeLayout = {
            isFullL: true,
            hasAlphaCutout: true,
            hasSolidColorCutout: false,
            nativeSide: 'right',
            cutoutSideW: Math.max(180, Math.min(680, Math.round(((W - minRightWingX) / W) * 1920))),
            cutoutBottomH: Math.max(90, Math.min(380, Math.round(((H - minBotBarY) / H) * 1080))),
          };
          this.lShapeLayoutCache.set(url, res);
          return res;
        }

        // 3. Non-PNG Detection (JPG, Opaque PNG):
        // Check if top-right window is a uniform solid color (Black, Green, Blue, White, etc.)
        const colorDist = (
          a: readonly [number, number, number, number],
          b: readonly [number, number, number, number]
        ) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

        const tr1 = px(95, 14);
        const tr2 = px(135, 14);
        const tr3 = px(95, 42);
        const tr4 = px(135, 42);
        const trCenter = px(115, 28);
        const isTopRightUniform =
          colorDist(tr1, trCenter) < 35 &&
          colorDist(tr2, trCenter) < 35 &&
          colorDist(tr3, trCenter) < 35 &&
          colorDist(tr4, trCenter) < 35;
        const isLeftAndBotDifferent =
          colorDist(leftPillar, trCenter) > 40 ||
          colorDist(px(15, 20), trCenter) > 40 ||
          colorDist(botBar, trCenter) > 40;

        if (isTopRightUniform && isLeftAndBotDifferent) {
          let maxLeftWingX = 28;
          for (let y = 10; y < 58; y += 3) {
            for (let x = 120; x >= 8; x--) {
              if (colorDist(px(x, y), trCenter) > 42 && colorDist(px(Math.max(0, x - 1), y), trCenter) > 42) {
                if (x > maxLeftWingX) maxLeftWingX = x;
                break;
              }
            }
          }
          let minBotBarY = 72;
          for (let x = 55; x < 148; x += 4) {
            for (let y = 20; y < H - 2; y++) {
              if (colorDist(px(x, y), trCenter) > 42 && colorDist(px(x, Math.min(H - 1, y + 1)), trCenter) > 42) {
                if (y < minBotBarY) minBotBarY = y;
                break;
              }
            }
          }
          const res: DetectedLShapeLayout = {
            isFullL: true,
            hasAlphaCutout: false,
            hasSolidColorCutout: true,
            nativeSide: 'left',
            cutoutSideW: Math.max(180, Math.min(680, Math.round((maxLeftWingX / W) * 1920))),
            cutoutBottomH: Math.max(90, Math.min(380, Math.round(((H - minBotBarY) / H) * 1080))),
            keyColor: [trCenter[0], trCenter[1], trCenter[2]],
          };
          this.lShapeLayoutCache.set(url, res);
          return res;
        }

        // Check if top-left window is a uniform solid color (Right-Side Non-PNG L-Shape)
        const tl1 = px(20, 14);
        const tl2 = px(60, 14);
        const tl3 = px(20, 42);
        const tl4 = px(60, 42);
        const tlCenter = px(40, 28);
        const isTopLeftUniform =
          colorDist(tl1, tlCenter) < 35 &&
          colorDist(tl2, tlCenter) < 35 &&
          colorDist(tl3, tlCenter) < 35 &&
          colorDist(tl4, tlCenter) < 35;
        const isRightAndBotDifferent =
          colorDist(rightPillar, tlCenter) > 40 ||
          colorDist(px(145, 20), tlCenter) > 40 ||
          colorDist(botBar, tlCenter) > 40;

        if (isTopLeftUniform && isRightAndBotDifferent) {
          let minRightWingX = W - 28;
          for (let y = 10; y < 58; y += 3) {
            for (let x = 40; x < W - 8; x++) {
              if (colorDist(px(x, y), tlCenter) > 42 && colorDist(px(Math.min(W - 1, x + 1), y), tlCenter) > 42) {
                if (x < minRightWingX) minRightWingX = x;
                break;
              }
            }
          }
          let minBotBarY = 72;
          for (let x = 12; x < 110; x += 4) {
            for (let y = 20; y < H - 2; y++) {
              if (colorDist(px(x, y), tlCenter) > 42 && colorDist(px(x, Math.min(H - 1, y + 1)), tlCenter) > 42) {
                if (y < minBotBarY) minBotBarY = y;
                break;
              }
            }
          }
          const res: DetectedLShapeLayout = {
            isFullL: true,
            hasAlphaCutout: false,
            hasSolidColorCutout: true,
            nativeSide: 'right',
            cutoutSideW: Math.max(180, Math.min(680, Math.round(((W - minRightWingX) / W) * 1920))),
            cutoutBottomH: Math.max(90, Math.min(380, Math.round(((H - minBotBarY) / H) * 1080))),
            keyColor: [tlCenter[0], tlCenter[1], tlCenter[2]],
          };
          this.lShapeLayoutCache.set(url, res);
          return res;
        }
      }
    } catch {
      // Ignore CORS canvas read if any
    }

    const fallback: DetectedLShapeLayout = {
      isFullL: false,
      hasAlphaCutout: false,
      hasSolidColorCutout: false,
      nativeSide: 'left',
    };
    this.lShapeLayoutCache.set(url, fallback);
    return fallback;
  }

  /**
   * Keys out the solid background color (Black, Chroma Green, Chroma Blue, or White) in the main video
   * window of a Non-PNG L-Shape image or video so the underlying main video is 100% visible in Overlay mode!
   */
  private getKeyedNonPngLShapeSource(
    source: CanvasImageSource,
    mediaW: number,
    mediaH: number,
    keyColor: [number, number, number],
    isLeft: boolean,
    sideRatio: number,
    bottomRatio: number
  ): HTMLCanvasElement | null {
    try {
      const targetW = Math.min(960, Math.max(320, mediaW));
      const targetH = Math.min(540, Math.max(180, mediaH));
      if (!this.keyedLShapeCanvas) {
        this.keyedLShapeCanvas = document.createElement('canvas');
      }
      const c = this.keyedLShapeCanvas;
      if (c.width !== targetW || c.height !== targetH) {
        c.width = targetW;
        c.height = targetH;
      }
      const kCtx = c.getContext('2d');
      if (!kCtx) return null;

      kCtx.clearRect(0, 0, targetW, targetH);
      kCtx.drawImage(source, 0, 0, targetW, targetH);

      // Only key out pixels inside the main video window + a small 8% feather margin around the inner L-Shape corner
      const winXStart = isLeft ? Math.max(0, Math.floor(targetW * (sideRatio - 0.08))) : 0;
      const winXEnd = isLeft ? targetW : Math.min(targetW, Math.ceil(targetW * (1 - sideRatio + 0.08)));
      const winYEnd = Math.min(targetH, Math.ceil(targetH * (1 - bottomRatio + 0.08)));

      const imgData = kCtx.getImageData(0, 0, targetW, targetH);
      const data = imgData.data;
      const [kr, kg, kb] = keyColor;

      for (let y = 0; y < winYEnd; y++) {
        const rowOff = y * targetW * 4;
        for (let x = winXStart; x < winXEnd; x++) {
          const i = rowOff + x * 4;
          const dr = Math.abs(data[i] - kr);
          const dg = Math.abs(data[i + 1] - kg);
          const db = Math.abs(data[i + 2] - kb);
          const dist = dr + dg + db;
          if (dist < 48) {
            data[i + 3] = 0;
          } else if (dist < 85) {
            data[i + 3] = Math.round(((dist - 48) / 37) * 255);
          }
        }
      }
      kCtx.putImageData(imgData, 0, 0);
      return c;
    } catch {
      return null;
    }
  }

  /**
   * Helper to retrieve or cache an HTMLImageElement for PNG, SVG, and GIF rendering.
   */
  public getOrLoadImage(url: string, labelHint?: string): HTMLImageElement | null {
    if (!url || typeof url !== 'string') return null;
    let img = this.imageCache.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onerror = () => {
        // Fallback: recover blob from offline IndexedDB vault if local URL was revoked or unavailable
        getMediaFromOfflineVault(undefined, labelHint || url)
          .then((rec) => {
            if (rec?.blobUrl && img && img.src !== rec.blobUrl) {
              img.src = rec.blobUrl;
            }
          })
          .catch(() => {});
      };
      this.imageCache.set(url, img);
    }
    if (img.complete && img.naturalWidth > 0) {
      return img;
    }
    return null;
  }

  /**
   * Helper to retrieve or cache an HTMLVideoElement for animated Video Logos.
   */
  public getOrLoadLogoVideo(url: string): HTMLVideoElement | null {
    if (!url || typeof url !== 'string') return null;
    let vid = this.logoVideoCache.get(url);
    if (!vid) {
      vid = document.createElement('video');
      vid.src = url;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.autoplay = true;
      vid.play().catch(() => {});
      this.logoVideoCache.set(url, vid);
    } else if (vid.paused && !vid.error) {
      vid.play().catch(() => {});
    }
    if (vid.readyState >= 1 && vid.videoWidth > 0) {
      return vid;
    }
    return null;
  }

  /**
   * Computes the normalized (0-100%) program video rectangle for GPU-layered Display 2 playback
   * so L-Shape squeeze and Top/Bottom banner squeeze match the 1920x1080 CG overlay canvas exactly.
   */
  public calculateProgramViewportRect(
    channel: TVChannel,
    isCleanOutput: boolean = false
  ): { xPct: number; yPct: number; wPct: number; hPct: number } {
    const activeAd = channel.activeEveryNMinAd;
    const activeProgram = channel.activeProgramId
      ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
      : undefined;
    const effectiveOverlayMode = activeAd
      ? activeAd.overlayMode || 'logo_only'
      : activeProgram?.overlayMode || 'all_overlays';
    const isChannelOff = channel.status === 'STOPPED';
    const isLiveInputActiveNow =
      !isChannelOff && Boolean(channel.liveInput?.active) && !activeAd && !activeProgram;
    const liveOverlayMode =
      channel.liveInput?.showOverlaysOnLive === false
        ? 'clean'
        : channel.liveInput?.liveOverlayMode || 'all';
    const allowBannersAndTicker =
      !isCleanOutput &&
      (effectiveOverlayMode === 'all_overlays' || effectiveOverlayMode === 'banners_only') &&
      (!isLiveInputActiveNow || liveOverlayMode === 'all');
    const isAdPlayingNow =
      Boolean(activeAd) ||
      channel.playbackContext === 'everyNMinAd' ||
      channel.playbackContext === 'ad';
    const allowLShape =
      !isCleanOutput &&
      !isAdPlayingNow &&
      effectiveOverlayMode !== 'clean_none' &&
      effectiveOverlayMode !== 'logo_only' &&
      effectiveOverlayMode !== 'banners_only' &&
      (!isLiveInputActiveNow || liveOverlayMode !== 'clean');
    const lShapeState = this.getLShapeOnAirState(channel, allowLShape);
    const activeLShapeItem = lShapeState.active ? lShapeState.item : undefined;
    const finalAllowBannersAndTicker = allowBannersAndTicker && !lShapeState.active;

    let progX = 0;
    let progY = 0;
    let progW = 1920;
    let progH = 1080;

    if (lShapeState.active && lShapeState.squeeze) {
      const itemSideW = activeLShapeItem?.sideWidth;
      const itemBotH = activeLShapeItem?.bottomHeight;
      const rawSideW =
        itemSideW && itemSideW >= 50
          ? itemSideW
          : channel.lShape?.sideWidth && channel.lShape.sideWidth >= 50
          ? channel.lShape.sideWidth
          : 280;
      const rawBotH =
        itemBotH && itemBotH >= 28
          ? itemBotH
          : channel.lShape?.bottomHeight && channel.lShape.bottomHeight >= 28
          ? channel.lShape.bottomHeight
          : 130;
      if (lShapeState.side === 'left') {
        progX += rawSideW;
        progW = Math.max(160, progW - rawSideW);
      } else {
        progW = Math.max(160, progW - rawSideW);
      }
      progH = Math.max(120, progH - rawBotH);
    }

    if (finalAllowBannersAndTicker) {
      const hasEnabledTopOv = (channel.topOverlay?.playlist || []).some(
        (it) => it && it.enabled !== false
      );
      const hasEnabledBotOv = (channel.bottomOverlay?.playlist || []).some(
        (it) => it && it.enabled !== false
      );
      if (channel.topOverlay?.enabled && channel.topOverlay.squeezeProgramVideo && hasEnabledTopOv) {
        const topH = channel.topOverlay.height || 90;
        progY += topH;
        progH = Math.max(100, progH - topH);
      }
      if (channel.bottomOverlay?.enabled && channel.bottomOverlay.squeezeProgramVideo && hasEnabledBotOv) {
        const botOvH = channel.bottomOverlay.height || 200;
        progH = Math.max(100, progH - botOvH);
      }
    }

    return {
      xPct: (progX / 1920) * 100,
      yPct: (progY / 1080) * 100,
      wPct: (progW / 1920) * 100,
      hPct: (progH / 1080) * 100,
    };
  }

  /**
   * Main render loop for the single-channel broadcast playout canvas.
   * Renders SMPTE Color Bars or Live Video/Camera + L-Shape Ad + Top/Bottom Overlays +
   * Up to 5 Logos + Top/Bottom Scrolling Ads + Broadcast Clock + Demo Watermark.
   */
  public renderChannelFrame(
    canvas: HTMLCanvasElement,
    channel: TVChannel,
    timestamp: number,
    videoElement?: HTMLVideoElement | null,
    overlayVideoElement?: HTMLVideoElement | null,
    topOverlayVideoElement?: HTMLVideoElement | null,
    lShapeVideoElement?: HTMLVideoElement | null,
    options?: {
      disableAllOverlays?: boolean;
      forceCleanFeed?: boolean;
      cgOnlyStage?: boolean;
      transparentVideoStage?: boolean;
      stateScope?: string;
    }
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const isYouTubeStage = !options?.cgOnlyStage && isYouTubeLiveStageActive(channel);

    // 1. Clear Canvas with transparent background for YouTube / GPU hardware video stage, or true broadcast black
    if (isYouTubeStage || options?.transparentVideoStage) {
      ctx.clearRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Aspect ratio viewport calculation
    const { vx, vy, vw, vh } = this.calculateViewport(
      width,
      height,
      channel.transmission.aspectRatioMode
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(vx, vy, vw, vh);
    ctx.clip();

    // Check if clean playout / no overlay mode is requested (e.g. 2nd display clean feed)
    const isCleanOutput = Boolean(options?.disableAllOverlays || options?.forceCleanFeed);

    // Check if an active Every N Min Ad or Scheduled Program overrides overlay visibility
    const activeAd = channel.activeEveryNMinAd;
    const activeProgram = channel.activeProgramId
      ? (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId)
      : undefined;

    const effectiveOverlayMode = activeAd
      ? activeAd.overlayMode || 'logo_only'
      : activeProgram?.overlayMode || 'all_overlays';

    // Check Live Input CG Overlay visibility setting ("Show Overlay or Not in Live Input")
    const isLiveInputActiveNow =
      Boolean(channel.liveInput?.active) && !activeAd && !activeProgram;
    const liveOverlayMode =
      channel.liveInput?.showOverlaysOnLive === false
        ? 'clean'
        : channel.liveInput?.liveOverlayMode || 'all';

    const allowLogos =
      !isCleanOutput &&
      (effectiveOverlayMode === 'all_overlays' || effectiveOverlayMode === 'logo_only') &&
      (!isLiveInputActiveNow || liveOverlayMode === 'all' || liveOverlayMode === 'logo_clock_only');
    const onlyFirstLogo = effectiveOverlayMode === 'logo_only';
    const allowBannersAndTicker =
      !isCleanOutput &&
      (effectiveOverlayMode === 'all_overlays' || effectiveOverlayMode === 'banners_only') &&
      (!isLiveInputActiveNow || liveOverlayMode === 'all');
    const isAdPlayingNow =
      Boolean(activeAd) ||
      channel.playbackContext === 'everyNMinAd' ||
      channel.playbackContext === 'ad';
    const allowLShape =
      !isCleanOutput &&
      !isAdPlayingNow &&
      effectiveOverlayMode !== 'clean_none' &&
      effectiveOverlayMode !== 'logo_only' &&
      effectiveOverlayMode !== 'banners_only' &&
      (!isLiveInputActiveNow || liveOverlayMode !== 'clean');
    const allowClock =
      !isCleanOutput &&
      (!isLiveInputActiveNow || liveOverlayMode === 'all' || liveOverlayMode === 'logo_clock_only');

    // Determine if L-Shape is currently visible on air (returns to FULL SCREEN when periodic wait is active)
    const lShapeState = this.getLShapeOnAirState(channel, allowLShape);
    const activeLShapeItem = lShapeState.active ? lShapeState.item : undefined;
    // Default during L-Shape playing time: ONLY show 1st Logo + L-Shape on top (DO NOT play Sponsor Logos or Top & Bottom Tickers!)
    const lShapeCgMode =
      activeLShapeItem?.cgOverlayMode ||
      channel.lShape?.cgOverlayMode ||
      'lshape_and_logo';

    const finalAllowLogos =
      allowLogos && (!lShapeState.active || lShapeCgMode !== 'lshape_only');
    const finalOnlyFirstLogo =
      onlyFirstLogo ||
      (lShapeState.active &&
        lShapeCgMode !== 'lshape_all_logos' &&
        lShapeCgMode !== 'all_overlays');
    const finalAllowBannersAndTicker =
      allowBannersAndTicker && !lShapeState.active;

    // 2b. Calculate Program Video Box (Squeezed if L-Shape or Top/Bottom Overlay Squeeze is active; Fullscreen in Clean Feed mode!)
    let progX = vx;
    let progY = vy;
    let progW = vw;
    let progH = vh;

    const scaleX = vw / 1920;
    const scaleY = vh / 1080;

    // L-Shape Squeeze (ONLY when L-Shape is actively showing and in Squeeze mode; otherwise 100% FULL SCREEN!)
    if (lShapeState.active && lShapeState.squeeze) {
      const itemSideW = activeLShapeItem?.sideWidth;
      const itemBotH = activeLShapeItem?.bottomHeight;
      const rawSideW =
        itemSideW && itemSideW >= 50
          ? itemSideW
          : channel.lShape?.sideWidth && channel.lShape.sideWidth >= 50
          ? channel.lShape.sideWidth
          : 280;
      const rawBotH =
        itemBotH && itemBotH >= 28
          ? itemBotH
          : channel.lShape?.bottomHeight && channel.lShape.bottomHeight >= 28
          ? channel.lShape.bottomHeight
          : 130;
      const sideW = rawSideW * scaleX;
      const bottomH = rawBotH * scaleY;
      if (lShapeState.side === 'left') {
        progX += sideW;
        progW = Math.max(160, progW - sideW);
      } else {
        progW = Math.max(160, progW - sideW);
      }
      progH = Math.max(120, progH - bottomH);
    }

    // Top & Bottom Overlay Squeeze (only when overlay has at least one enabled item)
    if (finalAllowBannersAndTicker) {
      const hasEnabledTopOv = (channel.topOverlay?.playlist || []).some(
        (it) => it && it.enabled !== false
      );
      const hasEnabledBotOv = (channel.bottomOverlay?.playlist || []).some(
        (it) => it && it.enabled !== false
      );
      if (channel.topOverlay?.enabled && channel.topOverlay.squeezeProgramVideo && hasEnabledTopOv) {
        const topH = (channel.topOverlay.height || 90) * scaleY;
        progY += topH;
        progH = Math.max(100, progH - topH);
      }
      if (channel.bottomOverlay?.enabled && channel.bottomOverlay.squeezeProgramVideo && hasEnabledBotOv) {
        const botOvH = (channel.bottomOverlay.height || 200) * scaleY;
        progH = Math.max(100, progH - botOvH);
      }
    }

    // 3. Render Video Source (Main Playlist / Program / Every N Min / Live Camera / SWF) or Full Black / Standby
    let hasRenderedVideo = false;
    const isChannelOff = channel.status === 'STOPPED';
    const rawActiveClip = activeAd
      ? activeAd.enabled !== false
        ? activeAd
        : undefined
      : activeProgram
      ? activeProgram.enabled !== false
        ? activeProgram.playlist[channel.activeProgramClipIndex || 0]
        : undefined
      : channel.playlist[channel.currentClipIndex];
    const activeClip =
      rawActiveClip && (rawActiveClip as any).enabled !== false ? rawActiveClip : undefined;
    const activeClipUrl = activeClip?.url || activeClip?.videoUrl || '';
    const isLiveInputActive =
      !isChannelOff && Boolean(channel.liveInput?.active) && !activeAd && !activeProgram;
    const isActiveSwf =
      !isLiveInputActive &&
      Boolean(activeClipUrl) &&
      swfEngine.isSwfUrl(activeClipUrl, activeClip?.fileName || activeClip?.title);
    const isActiveImage =
      !isLiveInputActive &&
      !isActiveSwf &&
      Boolean(activeClipUrl) &&
      (isImageUrl(activeClipUrl, activeClip?.fileName || activeClip?.title) ||
        (activeClip as any)?.mediaType === 'image');

    const hasActiveSource =
      !isChannelOff &&
      (Boolean(activeClip) ||
        !!(channel as any).liveCameraActive ||
        isLiveInputActive ||
        !!(channel as any).everyNMinActive);

    if (options?.cgOnlyStage) {
      // Dedicated CG Overlay Stage (zero main playlist video decoding or compositing overhead)
      ctx.save();
      ctx.fillStyle = '#070b14';
      ctx.fillRect(progX, progY, progW, progH);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      const step = Math.max(40, Math.round(96 * scaleX));
      for (let gx = progX + step; gx < progX + progW; gx += step) {
        ctx.beginPath();
        ctx.moveTo(gx, progY);
        ctx.lineTo(gx, progY + progH);
        ctx.stroke();
      }
      for (let gy = progY + step; gy < progY + progH; gy += step) {
        ctx.beginPath();
        ctx.moveTo(progX, gy);
        ctx.lineTo(progX + progW, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.font = `800 ${Math.max(14, Math.round(26 * Math.min(scaleX, scaleY)))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'CG OVERLAY STAGE (1920×1080) — LAYER PREVIEW ONLY',
        progX + progW / 2,
        progY + progH / 2
      );
      ctx.restore();
      hasRenderedVideo = true;
    } else if (isYouTubeStage && !activeAd && !activeProgram) {
      // Leave program video rectangle transparent so synchronized YouTubeBroadcastLayer shows cleanly beneath all CG overlays
      ctx.clearRect(progX, progY, progW, progH);
      hasRenderedVideo = true;
    } else if (hasActiveSource && isActiveSwf && activeClipUrl) {
      const swfCanvas = swfEngine.renderSwfToCanvas(
        activeClipUrl,
        activeClip?.title || 'SWF BROADCAST',
        timestamp,
        1920,
        1080,
        'fullscreen'
      );
      ctx.fillStyle = '#000000';
      ctx.fillRect(progX, progY, progW, progH);
      ctx.drawImage(swfCanvas, progX, progY, progW, progH);
      hasRenderedVideo = true;
    } else if (hasActiveSource && isActiveImage && activeClipUrl) {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(progX, progY, progW, progH);
      const adImg = this.getOrLoadImage(
        activeClipUrl,
        activeClip?.fileName || activeClip?.title
      );
      if (adImg && adImg.naturalWidth > 0 && adImg.naturalHeight > 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const imgAspect = adImg.naturalWidth / adImg.naturalHeight;
        const boxAspect = progW / Math.max(1, progH);
        const aspectRatioMode = channel.transmission?.aspectRatioMode || 'FILL';
        if (aspectRatioMode === 'STRETCH' || Math.abs(imgAspect - boxAspect) < 0.22) {
          ctx.drawImage(adImg, progX, progY, progW, progH);
        } else {
          const fitScale = Math.min(progW / adImg.naturalWidth, progH / adImg.naturalHeight);
          const drawW = adImg.naturalWidth * fitScale;
          const drawH = adImg.naturalHeight * fitScale;
          const drawX = progX + (progW - drawW) / 2;
          const drawY = progY + (progH - drawH) / 2;
          ctx.drawImage(adImg, drawX, drawY, drawW, drawH);
        }
      }
      ctx.restore();
      hasRenderedVideo = true;
    } else if (
      options?.transparentVideoStage &&
      hasActiveSource &&
      !activeClip?.isTranscoding &&
      !(videoElement && videoElement.error && !activeClipUrl.startsWith('/api/media/vlc-stream'))
    ) {
      // GPU-native <video> layer handles video pixels directly at 60 FPS with zero 2D canvas readback!
      ctx.clearRect(progX, progY, progW, progH);
      hasRenderedVideo = true;
    } else if (
      hasActiveSource &&
      videoElement &&
      (videoElement.readyState >= 1 || Boolean((videoElement as any).srcObject)) &&
      (videoElement.videoWidth > 0 || Boolean((videoElement as any).srcObject))
    ) {
      const targetResumeSec = Number(videoElement.dataset.targetResumeSec || 0);
      const isLiveStreamActive = isLiveInputActive || Boolean((videoElement as any).srcObject);
      const isSeekingToResume =
        !isLiveStreamActive &&
        (videoElement.dataset.isSeekingResume === 'true' ||
          (targetResumeSec > 0.4 &&
            (videoElement.seeking || videoElement.currentTime < targetResumeSec - 0.4)));

      const resumeCacheCanvas = activeProgram
        ? this.lastProgVideoCanvas || this.lastMainVideoCanvas
        : this.lastMainVideoCanvas;

      if (isSeekingToResume && resumeCacheCanvas && resumeCacheCanvas.width > 0) {
        ctx.drawImage(resumeCacheCanvas, progX, progY, progW, progH);
        hasRenderedVideo = true;
      } else if (!isSeekingToResume) {
        try {
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';

          if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            ctx.drawImage(videoElement, progX, progY, progW, progH);
            hasRenderedVideo = true;
          } else if (Boolean((videoElement as any).srcObject)) {
            try {
              ctx.drawImage(videoElement, progX, progY, progW, progH);
              hasRenderedVideo = true;
            } catch {
              const fallbackCanvas = getActiveFallbackCanvas();
              if (fallbackCanvas && fallbackCanvas.width > 0) {
                ctx.drawImage(fallbackCanvas, progX, progY, progW, progH);
                hasRenderedVideo = true;
              } else {
                ctx.fillStyle = '#060a14';
                ctx.fillRect(progX, progY, progW, progH);
                ctx.fillStyle = '#38bdf8';
                ctx.font = 'bold 22px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('● CONNECTING TO LIVE SCREEN / WINDOW CAPTURE...', progX + progW / 2, progY + progH / 2);
                hasRenderedVideo = true;
              }
            }
          } else {
            const fallbackCanvas = getActiveFallbackCanvas();
            if (fallbackCanvas && fallbackCanvas.width > 0) {
              ctx.drawImage(fallbackCanvas, progX, progY, progW, progH);
              hasRenderedVideo = true;
            } else if (isLiveStreamActive) {
              // High-tech live display/stream connecting indicator
              ctx.fillStyle = '#0a0f1d';
              ctx.fillRect(progX, progY, progW, progH);
              ctx.fillStyle = '#a855f7';
              ctx.font = 'bold 22px monospace';
              ctx.textAlign = 'center';
              ctx.fillText('● CONNECTING TO LIVE SCREEN / WINDOW CAPTURE...', progX + progW / 2, progY + progH / 2);
              hasRenderedVideo = true;
            }
          }
          ctx.restore();

          // Cache valid non-seeking video frame separately for Main Playlist and Program Playlist (~2fps throttle)
          // using lightweight 320x180 snapshot so resuming never stalls 60fps video playback.
          if (
            !videoElement.seeking &&
            !activeAd &&
            videoElement.videoWidth > 0 &&
            timestamp - this.lastCacheSnapshotMs > 500
          ) {
            this.lastCacheSnapshotMs = timestamp;
            if (activeProgram) {
              if (!this.lastProgVideoCanvas) {
                this.lastProgVideoCanvas = document.createElement('canvas');
                this.lastProgVideoCanvas.width = 320;
                this.lastProgVideoCanvas.height = 180;
              }
              const cacheCtx = this.lastProgVideoCanvas.getContext('2d');
              if (cacheCtx) {
                cacheCtx.drawImage(
                  videoElement,
                  0,
                  0,
                  this.lastProgVideoCanvas.width,
                  this.lastProgVideoCanvas.height
                );
              }
            } else {
              if (!this.lastMainVideoCanvas) {
                this.lastMainVideoCanvas = document.createElement('canvas');
                this.lastMainVideoCanvas.width = 320;
                this.lastMainVideoCanvas.height = 180;
              }
              const cacheCtx = this.lastMainVideoCanvas.getContext('2d');
              if (cacheCtx) {
                cacheCtx.drawImage(
                  videoElement,
                  0,
                  0,
                  this.lastMainVideoCanvas.width,
                  this.lastMainVideoCanvas.height
                );
              }
            }
          }
        } catch {
          const fallbackCanvas = getActiveFallbackCanvas();
          if (fallbackCanvas && fallbackCanvas.width > 0) {
            try {
              ctx.drawImage(fallbackCanvas, progX, progY, progW, progH);
              hasRenderedVideo = true;
            } catch {
              hasRenderedVideo = false;
            }
          } else {
            hasRenderedVideo = false;
          }
        }
      }
    } else if (
      hasActiveSource &&
      activeClip?.isTranscoding
    ) {
      ctx.save();
      ctx.fillStyle = '#05070c';
      ctx.fillRect(progX, progY, progW, progH);
      const scale = Math.min(progW / 1920, progH / 1080);
      ctx.fillStyle = '#22d3ee';
      ctx.font = `900 ${Math.max(16, Math.round(32 * scale))}px Inter, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'VLC / 123PLAYER 4K & UNIVERSAL DECODER STARTING...',
        progX + progW / 2,
        progY + progH / 2 - Math.round(16 * scale)
      );
      ctx.fillStyle = '#a1a1aa';
      ctx.font = `700 ${Math.max(12, Math.round(20 * scale))}px monospace`;
      ctx.fillText(
        activeClip?.title || activeClip?.fileName || 'Preparing video stream...',
        progX + progW / 2,
        progY + progH / 2 + Math.round(22 * scale)
      );
      ctx.restore();
      hasRenderedVideo = true;
    } else if (
      hasActiveSource &&
      activeClipUrl &&
      videoElement &&
      videoElement.error &&
      !activeClipUrl.startsWith('/api/media/vlc-stream')
    ) {
      // Fallback broadcast renderer only if both native and VLC stream fail
      const fallbackCanvas = swfEngine.renderSwfToCanvas(
        activeClipUrl,
        activeClip?.title || 'BROADCAST MEDIA',
        timestamp,
        1920,
        1080,
        'fullscreen'
      );
      ctx.drawImage(fallbackCanvas, progX, progY, progW, progH);
      hasRenderedVideo = true;
    }

    if (!hasRenderedVideo) {
      if (channel.standbyScreenMode === 'bars') {
        this.drawSmpteColorBars(ctx, progX, progY, progW, progH);
      } else {
        // Pure Full Black broadcast frame
        ctx.fillStyle = '#000000';
        ctx.fillRect(progX, progY, progW, progH);
      }
    }

    // 4. Render L-Shape Ad (if currently active on air)
    if (lShapeState.active) {
      this.drawLShape(ctx, channel, timestamp, vx, vy, vw, vh, lShapeVideoElement);
    }

    const stateScope = options?.stateScope || (options?.cgOnlyStage ? 'cg:' : '');

    // 5. Render Top Overlay Banner Playlist (if enabled)
    if (finalAllowBannersAndTicker && channel.topOverlay?.enabled) {
      this.drawOverlayBanner(
        ctx,
        channel,
        channel.topOverlay,
        vx,
        vy,
        vw,
        vh,
        topOverlayVideoElement,
        timestamp,
        stateScope
      );
    }

    // 6. Render Bottom Overlay 1920x200 Playlist (if enabled)
    if (finalAllowBannersAndTicker && channel.bottomOverlay?.enabled) {
      this.drawOverlayBanner(
        ctx,
        channel,
        channel.bottomOverlay,
        vx,
        vy,
        vw,
        vh,
        overlayVideoElement,
        timestamp,
        stateScope
      );
    }

    // 7. Render Channel & Sponsor Logos (up to 5 logos, or Only 1st Logo during L-Shape / Ad / Program)
    if (finalAllowLogos) {
      this.drawChannelLogos(ctx, channel, timestamp, vx, vy, vw, vh, finalOnlyFirstLogo, stateScope);
    }

    // 8. Render Top & Bottom Scrolling Ads (Tickers)
    if (finalAllowBannersAndTicker && channel.graphics.tickerEnabled) {
      this.drawBottomScrollTicker(ctx, channel, timestamp, vx, vy, vw, vh, stateScope);
    }
    if (finalAllowBannersAndTicker && (channel.graphics as any).topTickerEnabled) {
      this.drawTopScrollTicker(ctx, channel, timestamp, vx, vy, vw, vh, stateScope);
    }

    // 9. Render On-Screen Broadcast Clock (with 3D, Format, Background & Special Style options)
    if (allowClock && channel.graphics.clockEnabled !== false) {
      this.drawBroadcastClock(ctx, channel, vx, vy, vw, vh);
    }

    // 10. Render Ashoka DEMO Watermark in bottom-right (hidden when license is active)
    const gAny = (channel.graphics || {}) as any;
    let licRecord = gAny?.licenseRecord || (channel as any)?.licenseRecord;
    if (!licRecord) {
      try {
        const stored =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem('ashoka_license_record_v1')
            : null;
        if (stored) licRecord = JSON.parse(stored);
      } catch {}
    }
    const licenseEval = licRecord ? evaluateLicenseStatus(licRecord) : null;
    const isLicenseActive = Boolean(licenseEval && licenseEval.isValidAndActive);
    const isExplicitlyDisabled = gAny.demoWatermarkEnabled === false;
    const shouldShowDemoBadge = !isCleanOutput && !isLicenseActive && !isExplicitlyDisabled;
    if (shouldShowDemoBadge) {
      this.drawAshokaDemoWatermark(ctx, vx, vy, vw, vh);
    }

    // 11. Render "BACK IN XX SEC" Commercial Break & Program Countdown Badge (suppressed in clean output mode)
    if (!isCleanOutput) {
      this.drawBackInTimer(ctx, channel, timestamp, vx, vy, vw, vh);
    }

    ctx.restore();
  }

  /**
   * Draws authentic 7-column SMPTE Broadcast Color Bars across the viewport.
   */
  private drawSmpteColorBars(
    ctx: CanvasRenderingContext2D,
    vx: number,
    vy: number,
    vw: number,
    vh: number
  ) {
    const colors = [
      '#d4d4d4', // White / 75% Gray
      '#e5d200', // Yellow
      '#00d2d2', // Cyan
      '#33c44d', // Green
      '#c837b5', // Magenta
      '#e61919', // Red
      '#1432ba', // Blue
    ];
    const barW = vw / colors.length;
    for (let i = 0; i < colors.length; i++) {
      ctx.fillStyle = colors[i];
      ctx.fillRect(vx + i * barW, vy, Math.ceil(barW) + 1, vh);
    }
  }

  /**
   * Helper to determine if L-Shape is currently active on air, which item is playing,
   * which side (left/right) is selected, and whether Program Video should be squeezed or full-screen.
   */
  public getLShapeOnAirState(
    channel: TVChannel,
    allowLShape: boolean = true
  ): {
    active: boolean;
    side: 'left' | 'right';
    squeeze: boolean;
    item?: any;
  } {
    const lShape = channel.lShape;
    if (!allowLShape || !lShape || !lShape.enabled) {
      return { active: false, side: lShape?.side || 'left', squeeze: false };
    }
    if (channel.graphics?.dskKeyActive === false) {
      return { active: false, side: lShape.side || 'left', squeeze: false };
    }
    const allItems = lShape.playlist || [];
    const tickedItems = allItems.filter((it) => it.enabled !== false);
    if (tickedItems.length === 0) {
      return { active: false, side: lShape.side || 'left', squeeze: false };
    }
    const currentIdx = Math.max(0, Math.min(allItems.length - 1, lShape.currentIndex || 0));
    let item = allItems[currentIdx];
    if (!item || item.enabled === false) {
      item = tickedItems[0];
    }
    if (!item) {
      return { active: false, side: lShape.side || 'left', squeeze: false };
    }

    const effectiveRepeatMin =
      (item.repeatEveryMin !== undefined ? item.repeatEveryMin : lShape.repeatEveryMin) || 0;
    const isPeriodicWaitMode =
      lShape.playMode === 'periodic' || effectiveRepeatMin > 0;

    if (isPeriodicWaitMode && lShape.periodicActive === false) {
      return { active: false, side: item.side || lShape.side || 'left', squeeze: false };
    }

    const effectiveSide: 'left' | 'right' = item.side || lShape.side || 'left';
    const effectiveRenderMode =
      item.renderMode ||
      (item as any).squeezeMode ||
      lShape.renderMode ||
      (lShape.squeezeProgramVideo === false ? 'overlay' : 'squeeze');
    const effectiveSqueeze: boolean = effectiveRenderMode === 'squeeze';

    return {
      active: true,
      side: effectiveSide,
      squeeze: effectiveSqueeze,
      item,
    };
  }

  /**
   * Draws the Broadcast Date & Time Clock with full support for:
   * - Format (Only Time, Time + Date, Only Date, Date + Day, Day + Time, Full Day + Date + Time)
   * - 12-Hour / 24-Hour & Seconds toggle
   * - 3D Text & 3D Box Extrusion with custom 3D depth & color
   * - Transparent Text opacity
   * - Custom Background Color & Opacity OR Remove Background (Transparent)
   * - 6 Special Broadcast Presets & 8 Screen Positions + X/Y Offset
   */
  private drawBroadcastClock(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    vx: number,
    vy: number,
    vw: number,
    vh: number
  ) {
    const g = channel.graphics as any;
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    const dayName = days[now.getDay()];
    const dayNum = String(now.getDate()).padStart(2, '0');
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();

    const use12h = Boolean(g.clockUse12Hour);
    const showSec = g.clockShowSeconds !== false;
    let rawHours = now.getHours();
    const ampm = rawHours >= 12 ? ' PM' : ' AM';
    if (use12h) {
      rawHours = rawHours % 12 || 12;
    }
    const hh = String(rawHours).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    const timePart = `${hh}:${mm}${showSec ? `:${ss}` : ''}${use12h ? ampm : ''}`;
    const datePart = `${dayNum} ${monthName} ${year}`;

    const format: string =
      g.clockFormat || (g.clockShowDate === false ? 'time_only' : 'full_day_date_time');

    let text = `${dayName}, ${datePart} - ${timePart}`;
    if (format === 'time_only') {
      text = timePart;
    } else if (format === 'time_date') {
      text = `${datePart} • ${timePart}`;
    } else if (format === 'only_date') {
      text = datePart;
    } else if (format === 'date_day') {
      text = `${dayName}, ${datePart}`;
    } else if (format === 'day_time') {
      text = `${dayName} • ${timePart}`;
    }

    const scale = Math.min(vw / 1920, vh / 1080);
    const baseFontSize = typeof g.clockFontSize === 'number' ? g.clockFontSize : 20;
    const fontSize = Math.max(11, Math.round(baseFontSize * scale));
    const fontFamily = g.clockFontFamily || 'monospace';

    const specialStyle: string = g.clockSpecialStyle || 'standard';
    const is3D = Boolean(g.clock3DEnabled) || specialStyle === '3d_badge';
    const depth3D = Math.max(1, Math.round((typeof g.clock3DDepth === 'number' ? g.clock3DDepth : 4) * scale));
    const color3D = g.clock3DColor || '#000000';
    const removeBg = Boolean(g.clockRemoveBg) || specialStyle === 'minimal_clean';
    const bgColor = g.clockBgColor || '#05070c';
    const bgOpacity = typeof g.clockBgOpacity === 'number' ? Math.max(0, Math.min(1, g.clockBgOpacity)) : 0.88;
    const textColor = g.clockTextColor || '#fbbf24';
    const textOpacity = typeof g.clockTextOpacity === 'number' ? Math.max(0.05, Math.min(1, g.clockTextOpacity)) : 1;

    ctx.save();
    ctx.font = `800 ${fontSize}px "${fontFamily}", monospace, sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const padX = Math.max(10, Math.round(18 * scale));
    const padY = Math.max(6, Math.round(9 * scale));
    const boxW = textWidth + padX * 2;
    const boxH = fontSize + padY * 2;
    const marginX = Math.max(16, Math.round(36 * scale));
    const marginY = Math.max(14, Math.round(28 * scale));

    const offX = (g.clockOffsetX || 0) * scale;
    const offY = (g.clockOffsetY || 0) * scale;

    const clockPos = g.clockPosition || 'top-right';
    let x = vx + vw - boxW - marginX + offX;
    let y = vy + marginY + offY;

    if (clockPos === 'top-left') {
      x = vx + marginX + offX;
      y = vy + marginY + offY;
    } else if (clockPos === 'top-center') {
      x = vx + (vw - boxW) / 2 + offX;
      y = vy + marginY + offY;
    } else if (clockPos === 'middle-left') {
      x = vx + marginX + offX;
      y = vy + (vh - boxH) / 2 + offY;
    } else if (clockPos === 'middle-right') {
      x = vx + vw - boxW - marginX + offX;
      y = vy + (vh - boxH) / 2 + offY;
    } else if (clockPos === 'bottom-left') {
      x = vx + marginX + offX;
      y = vy + vh - boxH - marginY + offY;
    } else if (clockPos === 'bottom-center') {
      x = vx + (vw - boxW) / 2 + offX;
      y = vy + vh - boxH - marginY + offY;
    } else if (clockPos === 'bottom-right') {
      x = vx + vw - boxW - marginX + offX;
      y = vy + vh - boxH - marginY + offY;
    }

    const radius =
      specialStyle === 'glass_pill'
        ? boxH / 2
        : Math.max(4, Math.round(7 * scale));

    // 1. Background Box (unless Remove Background is enabled)
    if (!removeBg && bgOpacity > 0) {
      // 3D Extruded Box Shadow Block
      if (is3D) {
        ctx.save();
        ctx.fillStyle = color3D;
        ctx.globalAlpha = Math.min(1, bgOpacity + 0.1);
        ctx.beginPath();
        ctx.roundRect(x + depth3D, y + depth3D, boxW, boxH, radius);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = bgOpacity;
      if (specialStyle === 'gold_luxury') {
        const grad = ctx.createLinearGradient(x, y, x, y + boxH);
        grad.addColorStop(0, '#2e1f05');
        grad.addColorStop(0.5, '#170f02');
        grad.addColorStop(1, '#090501');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = bgColor;
      }
      ctx.beginPath();
      ctx.roundRect(x, y, boxW, boxH, radius);
      ctx.fill();

      // Crisp zero-blur border styling
      if (specialStyle === 'neon_cyber') {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = Math.max(1.5, scale * 2.2);
        ctx.stroke();
      } else if (specialStyle === 'gold_luxury') {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = Math.max(1.5, scale * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = is3D ? textColor : 'rgba(251, 191, 36, 0.4)';
        ctx.lineWidth = Math.max(1, scale * 1.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    const centerX = x + boxW / 2;
    const centerY = y + boxH / 2 + 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 2. 3D Extruded Text Layers or crisp zero-blur drop shadow
    if (is3D) {
      ctx.save();
      ctx.globalAlpha = textOpacity;
      ctx.fillStyle = color3D;
      for (let d = depth3D; d >= 1; d--) {
        ctx.fillText(text, centerX + d, centerY + d);
      }
      ctx.restore();
    } else if (removeBg) {
      ctx.save();
      ctx.globalAlpha = textOpacity * 0.9;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.fillText(text, centerX + Math.max(1, 1.5 * scale), centerY + Math.max(1, 1.5 * scale));
      ctx.restore();
    }

    // 3. Main Clock Text with Transparent Text Opacity support
    ctx.globalAlpha = textOpacity;
    ctx.fillStyle = textColor;
    ctx.fillText(text, centerX, centerY);

    ctx.restore();
  }

  /**
   * Draws a crisp Ashoka TV Logo emblem directly on canvas as an instant vector fallback
   * whenever the SVG bitmap is still decoding or offline.
   */
  private drawAshokaEmblemVector(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number
  ) {
    const s = size / 256;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // Outer rounded black badge with crisp white border
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 240, 54);
    ctx.fill();
    ctx.stroke();

    // Antennas + tips
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(112, 74);
    ctx.lineTo(78, 36);
    ctx.moveTo(128, 74);
    ctx.lineTo(164, 36);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(76, 34, 7, 0, Math.PI * 2);
    ctx.arc(166, 34, 7, 0, Math.PI * 2);
    ctx.fill();

    // TV Cabinet + inner screen
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(34, 74, 164, 120, 24);
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(48, 88, 116, 92, 14);
    ctx.fill();
    ctx.stroke();

    // TV stand legs
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(74, 196);
    ctx.lineTo(62, 214);
    ctx.moveTo(158, 196);
    ctx.lineTo(170, 214);
    ctx.stroke();

    // Bold "TV" emblem inside screen
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(62, 110);
    ctx.lineTo(100, 110);
    ctx.lineTo(100, 122);
    ctx.lineTo(87, 122);
    ctx.lineTo(87, 160);
    ctx.lineTo(75, 160);
    ctx.lineTo(75, 122);
    ctx.lineTo(62, 122);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(104, 110);
    ctx.lineTo(117, 110);
    ctx.lineTo(126, 144);
    ctx.lineTo(135, 110);
    ctx.lineTo(148, 110);
    ctx.lineTo(132, 160);
    ctx.lineTo(120, 160);
    ctx.closePath();
    ctx.fill();

    // Bottom-right circular Play broadcast badge
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(188, 178, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(177, 160);
    ctx.lineTo(209, 178);
    ctx.lineTo(177, 196);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws the Ashoka Icon + DEMO watermark badge in the bottom-right corner using a pre-rendered offscreen sprite.
   */
  private drawAshokaDemoWatermark(
    ctx: CanvasRenderingContext2D,
    vx: number,
    vy: number,
    vw: number,
    vh: number
  ) {
    const iconImg = this.getOrLoadImage('/assets/ashoka-icon.svg');
    const iconReady = Boolean(iconImg && iconImg.naturalWidth > 0);
    const cacheKey = `${vx},${vy},${vw},${vh}|${iconReady ? 1 : 0}`;

    if (!this.demoBadgeCache || this.demoBadgeCache.key !== cacheKey) {
      const scale = Math.min(vw / 1920, vh / 1080);
      const iconSize = Math.max(38, Math.round(74 * scale));
      const padX = Math.max(10, Math.round(16 * scale));
      const padY = Math.max(7, Math.round(10 * scale));
      const gap = Math.max(8, Math.round(14 * scale));
      const marginX = Math.max(18, Math.round(34 * scale));
      const marginY = Math.max(16, Math.round(24 * scale));
      const demoFontSize = Math.max(17, Math.round(34 * scale));

      const off = document.createElement('canvas');
      const oCtx = off.getContext('2d');
      if (oCtx) {
        oCtx.font = `900 ${demoFontSize}px Arial, sans-serif`;
        const demoTextW = oCtx.measureText('DEMO').width;
        const pillW = Math.ceil(padX * 2 + iconSize + gap + demoTextW);
        const pillH = Math.ceil(iconSize + padY * 2);
        const padBlur = 8;
        off.width = pillW + padBlur * 2;
        off.height = pillH + padBlur * 2;

        oCtx.font = `900 ${demoFontSize}px Arial, sans-serif`;
        oCtx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        oCtx.shadowBlur = Math.max(4, Math.round(8 * scale));
        oCtx.fillStyle = 'rgba(6, 10, 18, 0.78)';
        oCtx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        oCtx.lineWidth = Math.max(1.5, Math.round(2 * scale));
        oCtx.beginPath();
        oCtx.roundRect(padBlur, padBlur, pillW, pillH, Math.max(10, Math.round(16 * scale)));
        oCtx.fill();
        oCtx.stroke();
        oCtx.shadowBlur = 0;

        const iconX = padBlur + padX;
        const iconY = padBlur + padY;
        if (iconReady && iconImg) {
          oCtx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
        } else {
          this.drawAshokaEmblemVector(oCtx, iconX, iconY, iconSize);
        }

        const textX = iconX + iconSize + gap;
        const textY = padBlur + pillH / 2 + Math.round(1 * scale);
        oCtx.textAlign = 'left';
        oCtx.textBaseline = 'middle';
        oCtx.lineWidth = Math.max(2, Math.round(4 * scale));
        oCtx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        oCtx.strokeText('DEMO', textX, textY);
        oCtx.fillStyle = '#ef4444';
        oCtx.fillText('DEMO', textX, textY);

        const pillX = vx + vw - pillW - marginX - padBlur;
        const pillY = vy + vh - pillH - marginY - padBlur;
        this.demoBadgeCache = { key: cacheKey, canvas: off, pillX, pillY };
      }
    }

    if (this.demoBadgeCache) {
      ctx.drawImage(this.demoBadgeCache.canvas, this.demoBadgeCache.pillX, this.demoBadgeCache.pillY);
    }
  }

  /**
   * Dedicated high-contrast overlay banner renderer for 1920x200 bottom banner playlist & top banner.
   */
  public drawOverlayBanner(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    banner: OverlayBannerConfig,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    overlayVideoElement?: HTMLVideoElement | null,
    timestamp: number = 0,
    stateScope: string = ''
  ) {
    if (!banner || !banner.enabled) return;
    const opacity = typeof banner.opacity === 'number' ? Math.max(0, Math.min(1, banner.opacity)) : 1;
    if (opacity <= 0) return;

    if (channel.graphics?.dskKeyActive === false) return;
    if (banner.keyEnabled === false) return;

    const allItems = banner.playlist || [];
    const tickedItems = allItems.filter((it) => it.enabled !== false);
    if (allItems.length === 0 || tickedItems.length === 0) return;

    // Pre-warm SWF items in the banner playlist so switching clips never has a loading delay
    tickedItems.forEach((it) => {
      if (it.url && (it.mediaType === 'swf' || swfEngine.isSwfUrl(it.url, it.fileName || it.title))) {
        swfEngine.preloadSwf(it.url, it.fileName || it.title, undefined, 'banner');
      }
    });

    const viewScaleX = vw / 1920;
    const viewScaleY = vh / 1080;

    const bannerW = (banner.width || 1920) * viewScaleX;
    const bannerH = (banner.height || 200) * viewScaleY;

    const bannerX = vx + (banner.x || 0) * viewScaleX;
    let bannerY = vy;

    if (banner.position === 'top') {
      bannerY = vy + (banner.y || 0) * viewScaleY;
    } else {
      const defaultY = 1080 - (banner.height || 200);
      bannerY = vy + (banner.y !== undefined ? banner.y : defaultY) * viewScaleY;
    }

    const currentIdx = Math.max(0, Math.min(allItems.length - 1, banner.currentIndex || 0));
    let item = allItems[currentIdx];
    if (item && item.enabled === false) {
      item = tickedItems[0];
    }
    if (!item) return;

    const itemHint = item.fileName || item.title || item.url || '';
    const isSwfItem =
      item.mediaType === 'swf' || swfEngine.isSwfUrl(item.url, itemHint);
    const isVideoItem =
      !isSwfItem &&
      (item.mediaType === 'video' ||
        (!isImageUrl(item.url || '', itemHint) && isVideoFile(itemHint)));

    let mediaSource: CanvasImageSource | null = null;
    let mediaW = 0;
    let mediaH = 0;

    if (isSwfItem && item.url) {
      const swfCanvas = swfEngine.renderSwfToCanvas(
        item.url,
        item.title,
        timestamp,
        banner.width || 1920,
        banner.height || 200,
        'banner'
      );
      if (swfEngine.hasRenderedFrame(item.url) && swfCanvas.width > 0 && swfCanvas.height > 0) {
        mediaSource = swfCanvas;
        mediaW = swfCanvas.width;
        mediaH = swfCanvas.height;
      }
    } else if (isVideoItem) {
      if (
        overlayVideoElement &&
        !overlayVideoElement.error &&
        overlayVideoElement.readyState >= 2 &&
        overlayVideoElement.videoWidth > 0
      ) {
        if (overlayVideoElement.paused && !overlayVideoElement.ended) {
          overlayVideoElement.play().catch(() => {});
        }
        mediaSource = overlayVideoElement;
        mediaW = overlayVideoElement.videoWidth;
        mediaH = overlayVideoElement.videoHeight;
      } else {
        const fbUrl = (item as any).serverUrl || item.url;
        if (fbUrl) {
          const cachedVid = this.getOrLoadLogoVideo(fbUrl);
          if (cachedVid && cachedVid.readyState >= 2 && cachedVid.videoWidth > 0) {
            mediaSource = cachedVid;
            mediaW = cachedVid.videoWidth;
            mediaH = cachedVid.videoHeight;
          }
        }
      }
    } else if (!isVideoItem && !isSwfItem && item.url) {
      const img = this.getOrLoadImage(item.url, itemHint);
      if (img && img.naturalWidth > 0) {
        mediaSource = img;
        mediaW = img.naturalWidth;
        mediaH = img.naturalHeight;
      }
    }

    const cacheKey = `${stateScope}${banner.position === 'top' ? 'top' : 'bottom'}`;
    let cacheCanvas = this.lastBannerCanvas.get(cacheKey);
    if (!cacheCanvas) {
      cacheCanvas = document.createElement('canvas');
      this.lastBannerCanvas.set(cacheKey, cacheCanvas);
    }

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const effectiveFitMode: OverlayFitMode =
      item.fitMode || banner.fitMode || 'fill';
    const cw = Math.max(1, Math.round(bannerW));
    const ch = Math.max(1, Math.round(bannerH));
    const itemKey = `${item.url || item.id}|${cw}x${ch}|${effectiveFitMode}`;
    const prevMeta = this.lastBannerSnapshotMeta.get(cacheKey);

    if (mediaSource && mediaW > 0 && mediaH > 0) {
      try {
        this.drawFittedMedia(
          ctx,
          mediaSource,
          mediaW,
          mediaH,
          bannerX,
          bannerY,
          bannerW,
          bannerH,
          effectiveFitMode,
          item.opacity ?? 1
        );

        // Cache valid rendered banner frame (once for static images, throttled 350ms for animated video/SWF)
        const isAnimatedBanner = isSwfItem || isVideoItem;
        const needsSnap =
          cacheCanvas.width !== cw ||
          cacheCanvas.height !== ch ||
          !prevMeta ||
          prevMeta.url !== itemKey ||
          (isAnimatedBanner && timestamp - prevMeta.ts > 350);
        if (needsSnap) {
          this.lastBannerSnapshotMeta.set(cacheKey, { url: itemKey, ts: timestamp });
          if (cacheCanvas.width !== cw || cacheCanvas.height !== ch) {
            cacheCanvas.width = cw;
            cacheCanvas.height = ch;
          }
          const cCtx = cacheCanvas.getContext('2d');
          if (cCtx) {
            cCtx.imageSmoothingEnabled = true;
            cCtx.imageSmoothingQuality = 'high';
            cCtx.clearRect(0, 0, cw, ch);
            cCtx.drawImage(mediaSource, 0, 0, cw, ch);
          }
        }
      } catch {
        // Ignore transient frame read error
      }
    } else if (
      cacheCanvas.width > 0 &&
      cacheCanvas.height > 0 &&
      (!prevMeta || prevMeta.url === itemKey || timestamp - prevMeta.ts < 5000)
    ) {
      // Seamless transition: hold previous banner frame while next video/SWF decodes first frame
      ctx.drawImage(cacheCanvas, bannerX, bannerY, bannerW, bannerH);
    }

    ctx.restore();
  }

  /**
   * Dedicated renderer for Professional Satellite TV L-Shape (Left or Right side with Bottom banner).
   */
  public drawLShape(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    _timestamp: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    lShapeVideoElement?: HTMLVideoElement | null
  ) {
    const lShapeState = this.getLShapeOnAirState(channel, true);
    if (!lShapeState.active) return;

    const lShape = channel.lShape!;
    const allItems = lShape.playlist || [];
    const tickedItems = allItems.filter((it) => it.enabled !== false);
    if (tickedItems.length === 0) return;

    const currentIdx = Math.max(0, Math.min(allItems.length - 1, lShape.currentIndex || 0));
    let item = allItems[currentIdx];
    if (!item || item.enabled === false) {
      item = tickedItems[0];
    }
    if (!item) return;

    const opacity =
      typeof lShape.opacity === 'number' && lShape.opacity > 0
        ? Math.max(0.1, Math.min(1, lShape.opacity))
        : 1;

    const scaleX = vw / 1920;
    const scaleY = vh / 1080;
    const offX = (lShape.offsetX || 0) * scaleX;
    const offY = (lShape.offsetY || 0) * scaleY;
    const itemSideW = item.sideWidth;
    const itemBotH = item.bottomHeight;
    const rawSideW =
      itemSideW && itemSideW >= 50
        ? itemSideW
        : lShape.sideWidth && lShape.sideWidth >= 50
        ? lShape.sideWidth
        : 280;
    const rawBotH =
      itemBotH && itemBotH >= 28
        ? itemBotH
        : lShape.bottomHeight && lShape.bottomHeight >= 28
        ? lShape.bottomHeight
        : 130;
    const isLeft = lShapeState.side === 'left';
    const fitMode = item.fitMode || lShape.fitMode || 'fill';
    const itemDisplayZone = item.displayZone || lShape.displayZone || 'full_l_canvas';
    const accent = channel.colorAccent || '#f59e0b';

    let mediaSource: CanvasImageSource | null = null;
    let mediaW = 0;
    let mediaH = 0;

    const isSwfLShape = item.mediaType === 'swf' || swfEngine.isSwfUrl(item.url, item.title);

    if (isSwfLShape) {
      const swfCanvas = swfEngine.renderSwfToCanvas(
        item.url,
        item.title,
        _timestamp,
        1920,
        1080,
        'lshape'
      );
      mediaSource = swfCanvas;
      mediaW = swfCanvas.width;
      mediaH = swfCanvas.height;
    } else if (item.mediaType === 'video') {
      if (
        lShapeVideoElement &&
        lShapeVideoElement.readyState >= 1 &&
        lShapeVideoElement.videoWidth > 0
      ) {
        mediaSource = lShapeVideoElement;
        mediaW = lShapeVideoElement.videoWidth;
        mediaH = lShapeVideoElement.videoHeight;
      } else if (item.url) {
        const cachedVid = this.getOrLoadLogoVideo(item.url);
        if (cachedVid && cachedVid.videoWidth > 0) {
          mediaSource = cachedVid;
          mediaW = cachedVid.videoWidth;
          mediaH = cachedVid.videoHeight;
        } else if (lShapeVideoElement && lShapeVideoElement.error) {
          const fallbackCanvas = swfEngine.renderSwfToCanvas(
            item.url,
            item.title,
            _timestamp,
            1920,
            1080,
            'lshape'
          );
          mediaSource = fallbackCanvas;
          mediaW = fallbackCanvas.width;
          mediaH = fallbackCanvas.height;
        }
      }
    } else if (item.url) {
      const img = this.getOrLoadImage(item.url);
      if (img && img.naturalWidth > 0) {
        mediaSource = img;
        mediaW = img.naturalWidth;
        mediaH = img.naturalHeight;
      }
    }

    const detectedLayout =
      !isSwfLShape && mediaSource && mediaW > 0 && mediaH > 0
        ? this.detectLShapeFrameLayout(item.url || '', mediaSource, mediaW, mediaH)
        : {
            isFullL: false,
            hasAlphaCutout: false,
            hasSolidColorCutout: false,
            nativeSide: isLeft ? ('left' as const) : ('right' as const),
          };

    const nativeCutSideW = detectedLayout.cutoutSideW || 380;
    const nativeCutBotH = detectedLayout.cutoutBottomH || 180;

    // Respect exact user-selected L-Shape size (including Too Small, Extra Small, Very Small, Small, Medium, Big)
    const sideW = rawSideW * scaleX;
    const bottomH = rawBotH * scaleY;
    const pillarX = (isLeft ? vx : vx + vw - sideW) + offX;
    const pillarY = vy + offY;
    const botX = vx + offX;
    const botY = vy + vh - bottomH + offY;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const isTransparentPngLShape = Boolean(detectedLayout.hasAlphaCutout);
    const shouldUseChromaKey = !isTransparentPngLShape && (!isSwfLShape || itemDisplayZone === 'chroma_key');

    // NEVER clip or draw an opaque background behind uploaded L-Shape images so 100% of the full L-Shape image & transparency show!
    if (mediaSource && mediaW > 0 && mediaH > 0) {
      const isWidescreenMedia = mediaW / mediaH >= 1.25;
      const isFullLTemplate =
        !isSwfLShape &&
        (detectedLayout.isFullL ||
          itemDisplayZone === 'full_l_canvas' ||
          itemDisplayZone === 'chroma_key' ||
          (fitMode as string) === 'full_l' ||
          (isWidescreenMedia && itemDisplayZone !== 'smart_l'));

      if (isFullLTemplate) {
        const builtForRight =
          detectedLayout.isFullL ? detectedLayout.nativeSide === 'right' : !isLeft;
        const builtForLeft = !builtForRight;

        let renderSource: CanvasImageSource = mediaSource;
        let renderW = mediaW;
        let renderH = mediaH;

        if (shouldUseChromaKey) {
          const keyCol: [number, number, number] = detectedLayout.keyColor || [0, 0, 0];
          const keyedCanvas = this.getKeyedNonPngLShapeSource(
            mediaSource,
            mediaW,
            mediaH,
            keyCol,
            builtForLeft,
            nativeCutSideW / 1920,
            nativeCutBotH / 1080
          );
          if (keyedCanvas) {
            renderSource = keyedCanvas;
            renderW = keyedCanvas.width;
            renderH = keyedCanvas.height;
          }
        }

        const itemPreset = item.presetSize || lShape.presetSize;
        const isNativeFullImage =
          !itemPreset ||
          itemPreset === 'full_image' ||
          (!lShapeState.squeeze && itemPreset === 'compact');

        ctx.save();
        if (builtForLeft !== isLeft) {
          // Flip horizontally if L-Shape graphic was designed for opposite side
          ctx.translate(vx + vw + offX, vy + offY);
          ctx.scale(-1, 1);
          if (isNativeFullImage) {
            ctx.drawImage(renderSource, 0, 0, renderW, renderH, 0, 0, vw, vh);
          } else {
            const splitSrcX = Math.max(16, Math.min(renderW - 16, Math.round(renderW * (nativeCutSideW / 1920))));
            const splitSrcY = Math.max(16, Math.min(renderH - 16, Math.round(renderH * (1 - nativeCutBotH / 1080))));
            const splitDstX = Math.max(16, Math.min(vw - 16, sideW));
            const splitDstY = Math.max(16, Math.min(vh - 16, vh - bottomH));
            // Draw all 4 quadrants of the full L-Shape image so ZERO artwork is ever cut off!
            ctx.drawImage(renderSource, 0, 0, splitSrcX, splitSrcY, 0, 0, splitDstX, splitDstY);
            ctx.drawImage(renderSource, splitSrcX, 0, renderW - splitSrcX, splitSrcY, splitDstX, 0, vw - splitDstX, splitDstY);
            ctx.drawImage(renderSource, 0, splitSrcY, splitSrcX, renderH - splitSrcY, 0, splitDstY, splitDstX, vh - splitDstY);
            ctx.drawImage(renderSource, splitSrcX, splitSrcY, renderW - splitSrcX, renderH - splitSrcY, splitDstX, splitDstY, vw - splitDstX, vh - splitDstY);
          }
        } else {
          if (isNativeFullImage) {
            // Draw 100% FULL L-Shape image directly across the full TV screen with full transparency!
            ctx.drawImage(renderSource, 0, 0, renderW, renderH, vx + offX, vy + offY, vw, vh);
          } else {
            // 4-Quadrant Full-Image Continuous Warp: scales wings to sideW & bottomH while drawing 100% of the image without clipping!
            const splitSrcX = isLeft
              ? Math.max(16, Math.min(renderW - 16, Math.round(renderW * (nativeCutSideW / 1920))))
              : Math.max(16, Math.min(renderW - 16, Math.round(renderW * (1 - nativeCutSideW / 1920))));
            const splitSrcY = Math.max(16, Math.min(renderH - 16, Math.round(renderH * (1 - nativeCutBotH / 1080))));
            const splitDstX = isLeft
              ? Math.max(16, Math.min(vw - 16, sideW))
              : Math.max(16, Math.min(vw - 16, vw - sideW));
            const splitDstY = Math.max(16, Math.min(vh - 16, vh - bottomH));

            ctx.drawImage(renderSource, 0, 0, splitSrcX, splitSrcY, vx + offX, vy + offY, splitDstX, splitDstY);
            ctx.drawImage(renderSource, splitSrcX, 0, renderW - splitSrcX, splitSrcY, vx + offX + splitDstX, vy + offY, vw - splitDstX, splitDstY);
            ctx.drawImage(renderSource, 0, splitSrcY, splitSrcX, renderH - splitSrcY, vx + offX, vy + offY + splitDstY, splitDstX, vh - splitDstY);
            ctx.drawImage(renderSource, splitSrcX, splitSrcY, renderW - splitSrcX, renderH - splitSrcY, vx + offX + splitDstX, vy + offY + splitDstY, vw - splitDstX, vh - splitDstY);
          }
        }
        ctx.restore();
      } else {
        // Split Wings Mode (smart_l): Draw uploaded Poster / Square Image inside BOTH the Left/Right Vertical Wing AND Bottom Horizontal Wing!
        const wingFit: OverlayFitMode = fitMode === 'contain' ? 'contain' : 'fill';
        this.drawFittedMedia(
          ctx,
          mediaSource,
          mediaW,
          mediaH,
          pillarX,
          pillarY,
          sideW,
          vh - bottomH,
          wingFit,
          item.opacity ?? 1
        );
        this.drawFittedMedia(
          ctx,
          mediaSource,
          mediaW,
          mediaH,
          botX,
          botY,
          vw,
          bottomH,
          wingFit,
          item.opacity ?? 1
        );
      }
    }

    ctx.restore();
  }

  private drawFittedMedia(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceW: number,
    sourceH: number,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    fitMode: OverlayFitMode,
    opacity: number = 1
  ) {
    if (sourceW <= 0 || sourceH <= 0) return;
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * Math.max(0, Math.min(1, opacity));

    ctx.beginPath();
    ctx.rect(destX, destY, destW, destH);
    ctx.clip();

    if (fitMode === 'fill' || fitMode === 'stretch') {
      ctx.drawImage(source, destX, destY, destW, destH);
    } else if (fitMode === 'cover') {
      const sRatio = sourceW / sourceH;
      const dRatio = destW / destH;
      let sX = 0, sY = 0, sW = sourceW, sH = sourceH;
      if (sRatio > dRatio) {
        sW = sourceH * dRatio;
        sX = (sourceW - sW) / 2;
      } else {
        sH = sourceW / dRatio;
        sY = (sourceH - sH) / 2;
      }
      ctx.drawImage(source, sX, sY, sW, sH, destX, destY, destW, destH);
    } else if (fitMode === '16:9') {
      const targetRatio = 16 / 9;
      const targetW = Math.min(destW, destH * targetRatio);
      const targetH = targetW / targetRatio;
      const targetX = destX + (destW - targetW) / 2;
      const targetY = destY + (destH - targetH) / 2;
      ctx.drawImage(source, targetX, targetY, targetW, targetH);
    } else if (fitMode === 'center') {
      const targetX = destX + (destW - sourceW) / 2;
      const targetY = destY + (destH - sourceH) / 2;
      ctx.drawImage(source, targetX, targetY, sourceW, sourceH);
    } else {
      const sRatio = sourceW / sourceH;
      const dRatio = destW / destH;
      let drawW = destW;
      let drawH = destH;
      if (sRatio > dRatio) {
        drawH = destW / sRatio;
      } else {
        drawW = destH * sRatio;
      }
      const drawX = destX + (destW - drawW) / 2;
      const drawY = destY + (destH - drawH) / 2;
      ctx.drawImage(source, drawX, drawY, drawW, drawH);
    }

    ctx.restore();
  }

  private calculateViewport(
    cw: number,
    ch: number,
    _mode: AspectRatioMode
  ): { vx: number; vy: number; vw: number; vh: number } {
    // Default in TV Output & Software Preview: ALL video file sizes fill 100% Full Screen of the TV Output!
    return { vx: 0, vy: 0, vw: cw, vh: ch };
  }

  private drawSingleLogo(
    ctx: CanvasRenderingContext2D,
    logo: LogoItemConfig,
    channel: TVChannel,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    stateScope: string = ''
  ) {
    if (!logo.enabled) return;
    const opacity = typeof logo.opacity === 'number' ? Math.max(0, Math.min(1, logo.opacity)) : 0.95;
    if (opacity <= 0) return;

    const scaleX = vw / 1920;
    const scaleY = vh / 1080;
    const viewScale = Math.min(scaleX, scaleY);
    const rawWidth = logo.fullScreen
      ? 1920
      : logo.customWidth || (logo as any).width || logo.size || 110;
    const rawHeight = logo.fullScreen
      ? 1080
      : logo.customHeight || (logo as any).height || 0;
    const isFullScreenLogo =
      Boolean(logo.fullScreen) || (rawWidth >= 1880 && (rawHeight >= 1040 || rawHeight === 0));

    let logoWidth = isFullScreenLogo
      ? vw
      : rawWidth >= 200
      ? rawWidth * scaleX
      : Math.max(25, rawWidth * Math.max(0.65, viewScale * 1.4));
    let logoHeight = isFullScreenLogo
      ? vh
      : rawHeight > 0
      ? rawHeight * scaleY
      : logoWidth * 0.45;

    const margin = isFullScreenLogo ? 0 : Math.max(12, Math.floor(vw * 0.02));
    const overlayExtra =
      !isFullScreenLogo && channel.bottomOverlay?.enabled
        ? (channel.bottomOverlay.height || 200) * scaleY
        : 0;
    const bottomExtra = isFullScreenLogo
      ? 0
      : (channel.graphics.tickerEnabled ? Math.max(34, Math.floor(vh * 0.054)) + 6 : 0) +
        overlayExtra;

    const offX = (logo.offsetX ?? (logo as any).x ?? 0) * scaleX;
    const offY = (logo.offsetY ?? (logo as any).y ?? 0) * scaleY;

    const enabledPlaylist = Array.isArray(logo.playlist)
      ? logo.playlist.filter((it) => it && it.enabled !== false && it.url)
      : [];
    let resolvedUrl = logo.url;
    let resolvedLabel = logo.label || logo.fileName || '';
    let resolvedIsSwf = Boolean(logo.isSwf);

    if (enabledPlaylist.length > 0) {
      enabledPlaylist.forEach((it) => {
        if (it.url && (it.isSwf || swfEngine.isSwfUrl(it.url, it.fileName || it.title))) {
          swfEngine.preloadSwf(it.url, it.fileName || it.title);
        }
      });
      if (enabledPlaylist.length === 1) {
        const single = enabledPlaylist[0];
        resolvedUrl = single.url;
        resolvedLabel = single.fileName || single.title || resolvedLabel;
        resolvedIsSwf = Boolean(single.isSwf || swfEngine.isSwfUrl(single.url, resolvedLabel));
      } else {
        const fullPlaylist = Array.isArray(logo.playlist) ? logo.playlist : enabledPlaylist;
        const rawIdx = typeof logo.currentIndex === 'number' ? Math.max(0, logo.currentIndex) : 0;
        const directItem = fullPlaylist[rawIdx];
        const chosen =
          directItem && directItem.enabled !== false && directItem.url
            ? directItem
            : enabledPlaylist[rawIdx % enabledPlaylist.length] || enabledPlaylist[0];
        if (chosen && chosen.url) {
          resolvedUrl = chosen.url;
          resolvedLabel = chosen.fileName || chosen.title || resolvedLabel;
          resolvedIsSwf = Boolean(chosen.isSwf || swfEngine.isSwfUrl(chosen.url, resolvedLabel));
        }
      }
    }

    const isSwfLogo = resolvedIsSwf || swfEngine.isSwfUrl(resolvedUrl, resolvedLabel);
    const slotKey = `${stateScope}${String(logo.id || logo.type || logo.name || 'logo')}`;
    const prevSlotUrl = this.lastActiveLogoUrlBySlot.get(slotKey);
    if (resolvedUrl && prevSlotUrl !== resolvedUrl) {
      this.lastActiveLogoUrlBySlot.set(slotKey, resolvedUrl);
      if (isSwfLogo && prevSlotUrl !== undefined && !stateScope) {
        swfEngine.restartSwf(resolvedUrl);
      }
    }

    const isVidLogo = !isSwfLogo && isVideoFile(resolvedLabel || '');
    const logoVid = isVidLogo && resolvedUrl ? this.getOrLoadLogoVideo(resolvedUrl) : null;
    const img = !isSwfLogo && !isVidLogo && resolvedUrl ? this.getOrLoadImage(resolvedUrl, resolvedLabel) : null;
    const targetSwfW = Math.max(360, Math.min(1920, Math.round(rawWidth)));
    const targetSwfH = Math.max(220, Math.min(1080, Math.round(rawHeight || rawWidth * 0.5625)));
    const swfLogoCanvas =
      isSwfLogo && resolvedUrl
        ? swfEngine.renderSwfToCanvas(
            resolvedUrl,
            resolvedLabel || '',
            performance.now(),
            targetSwfW,
            targetSwfH,
            'logo'
          )
        : null;

    if (!isFullScreenLogo && rawHeight <= 0) {
      if (swfLogoCanvas && swfLogoCanvas.width > 0 && swfLogoCanvas.height > 0) {
        const aspect = Math.max(0.25, Math.min(2, swfLogoCanvas.height / swfLogoCanvas.width));
        logoHeight = logoWidth * aspect;
      } else if (logoVid && logoVid.videoWidth > 0 && logoVid.videoHeight > 0) {
        const aspect = logoVid.videoHeight / logoVid.videoWidth;
        logoHeight = logoWidth * aspect;
      } else if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const aspect = img.naturalHeight / img.naturalWidth;
        logoHeight = logoWidth * aspect;
      }
    }

    let x = vx + vw - logoWidth - margin + offX;
    let y = vy + margin + offY;

    if (isFullScreenLogo) {
      x = vx + offX;
      y = vy + offY;
    } else if (logo.position === 'top-left') {
      x = vx + margin + offX;
      y = vy + margin + offY;
    } else if (logo.position === 'top-center') {
      x = vx + (vw - logoWidth) / 2 + offX;
      y = vy + margin + offY;
    } else if (logo.position === 'top-right') {
      x = vx + vw - logoWidth - margin + offX;
      y = vy + margin + offY;
    } else if (logo.position === 'middle-left') {
      x = vx + margin + offX;
      y = vy + (vh - bottomExtra - logoHeight) / 2 + offY;
    } else if (logo.position === 'middle-right') {
      x = vx + vw - logoWidth - margin + offX;
      y = vy + (vh - bottomExtra - logoHeight) / 2 + offY;
    } else if (logo.position === 'bottom-left') {
      x = vx + margin + offX;
      y = vy + vh - logoHeight - margin - bottomExtra + offY;
    } else if (logo.position === 'bottom-center') {
      x = vx + (vw - logoWidth) / 2 + offX;
      y = vy + vh - logoHeight - margin - bottomExtra + offY;
    } else if (logo.position === 'bottom-right') {
      x = vx + vw - logoWidth - margin + offX;
      y = vy + vh - logoHeight - margin - bottomExtra + offY;
    }

    ctx.save();
    ctx.globalAlpha = opacity;

    const effectiveFitMode: OverlayFitMode =
      logo.fitMode || (isFullScreenLogo || rawHeight > 0 ? 'fill' : 'contain');

    if (isSwfLogo && resolvedUrl && swfLogoCanvas) {
      if (isFullScreenLogo || rawHeight > 0) {
        this.drawFittedMedia(
          ctx,
          swfLogoCanvas,
          swfLogoCanvas.width,
          swfLogoCanvas.height,
          x,
          y,
          logoWidth,
          logoHeight,
          effectiveFitMode,
          1
        );
      } else {
        ctx.drawImage(swfLogoCanvas, x, y, logoWidth, logoHeight);
      }
    } else if (logoVid && logoVid.videoWidth > 0) {
      if (isFullScreenLogo || rawHeight > 0) {
        this.drawFittedMedia(
          ctx,
          logoVid,
          logoVid.videoWidth,
          logoVid.videoHeight,
          x,
          y,
          logoWidth,
          logoHeight,
          effectiveFitMode,
          1
        );
      } else {
        ctx.drawImage(logoVid, x, y, logoWidth, logoHeight);
      }
    } else if (img && img.naturalWidth > 0) {
      const targetW = Math.max(2, Math.round(logoWidth));
      const targetH = Math.max(2, Math.round(logoHeight));
      const isGif = (resolvedUrl || '').toLowerCase().includes('.gif');
      if (isGif || isFullScreenLogo) {
        if (isFullScreenLogo || rawHeight > 0) {
          this.drawFittedMedia(
            ctx,
            img,
            img.naturalWidth,
            img.naturalHeight,
            x,
            y,
            logoWidth,
            logoHeight,
            effectiveFitMode,
            1
          );
        } else {
          ctx.drawImage(img, x, y, logoWidth, logoHeight);
        }
      } else {
        // Pre-bake logo bitmap + subtle drop shadow once per size/URL (eliminates 60fps Gaussian shadowBlur passes)
        const spriteKey = `${resolvedUrl}|${targetW}x${targetH}|${effectiveFitMode}|${rawHeight > 0 ? 1 : 0}`;
        let sprite = this.logoSpriteCache.get(spriteKey);
        if (!sprite) {
          if (this.logoSpriteCache.size >= 32) {
            const firstKey = this.logoSpriteCache.keys().next().value;
            if (firstKey) this.logoSpriteCache.delete(firstKey);
          }
          const pad = 6;
          sprite = document.createElement('canvas');
          sprite.width = targetW + pad * 2;
          sprite.height = targetH + pad * 2;
          const sCtx = sprite.getContext('2d');
          if (sCtx) {
            sCtx.imageSmoothingEnabled = true;
            sCtx.imageSmoothingQuality = 'high';
            sCtx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            sCtx.shadowBlur = 4;
            sCtx.shadowOffsetX = 1;
            sCtx.shadowOffsetY = 2;
            if (rawHeight > 0) {
              this.drawFittedMedia(
                sCtx,
                img,
                img.naturalWidth,
                img.naturalHeight,
                pad,
                pad,
                targetW,
                targetH,
                effectiveFitMode,
                1
              );
            } else {
              sCtx.drawImage(img, pad, pad, targetW, targetH);
            }
          }
          this.logoSpriteCache.set(spriteKey, sprite);
        }
        ctx.drawImage(sprite, x - 6, y - 6);
      }
    }

    ctx.restore();
  }

  private drawChannelLogos(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    timestamp: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    onlyFirstLogo: boolean = false,
    stateScope: string = ''
  ) {
    const g = channel.graphics;
    if (!g) return;

    const mode = g.logoDisplayMode || 'all';
    const chLogo = g.channelLogo;
    const sp1 = g.sponsorLogo1 || g.sponsor1Logo;
    const sp2 = g.sponsorLogo2 || g.sponsor2Logo;
    const sp3 = (g as any).sponsorLogo3 as LogoItemConfig | undefined;
    const sp4 = (g as any).sponsorLogo4 as LogoItemConfig | undefined;

    if (onlyFirstLogo) {
      // Show ONLY 1st Logo (Main Channel Logo #1) — NEVER draw Sponsor Logos (sp1, sp2, sp3, sp4)!
      const hasFirstLogoMedia =
        chLogo &&
        (Boolean(chLogo.url) ||
          (Array.isArray(chLogo.playlist) &&
            chLogo.playlist.some((it) => it && it.enabled !== false && Boolean(it.url))));
      if (chLogo && chLogo.enabled !== false && hasFirstLogoMedia) {
        this.drawSingleLogo(ctx, chLogo, channel, vx, vy, vw, vh, stateScope);
      }
      return;
    }

    const allLogos = [chLogo, sp1, sp2, sp3, sp4].filter(
      (l): l is LogoItemConfig => !!l && l.enabled
    );

    if (allLogos.length === 0) return;

    allLogos.forEach((l) => {
      if (l.url && (l.isSwf || swfEngine.isSwfUrl(l.url, l.label))) {
        swfEngine.preloadSwf(l.url, l.label);
      }
    });

    if (mode === 'channel_only') {
      if (chLogo?.enabled) this.drawSingleLogo(ctx, chLogo, channel, vx, vy, vw, vh, stateScope);
      return;
    }

    if (mode === 'cycle') {
      // Epoch-synced cycle logo switching so PGM OUT & 2nd Display match identically
      const defaultSec = g.logoCycleIntervalSec || 10;
      const chosenIdx = pickSyncedCycleLogoIndex(
        allLogos.map((l) => l.duration || defaultSec),
        defaultSec,
        Date.now()
      );
      this.drawSingleLogo(ctx, allLogos[chosenIdx] || allLogos[0], channel, vx, vy, vw, vh, stateScope);
      return;
    }

    allLogos.forEach((logo) => {
      this.drawSingleLogo(ctx, logo, channel, vx, vy, vw, vh, stateScope);
    });
  }

  private drawBottomScrollTicker(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    timestamp: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    stateScope: string = ''
  ) {
    const g = channel.graphics as any;
    const nowEpochMs = Date.now();
    if (isTickerBarExpired(g.tickerExpiresAt, nowEpochMs)) return;
    const activeItems = filterActiveTickerItems(g.tickerItems || [], nowEpochMs);
    if (activeItems.length === 0) return;

    const viewScaleX = vw / 1920;
    const viewScaleY = vh / 1080;
    const rawHeight = g.tickerCustomHeight || Math.round(1080 * 0.054);
    const barHeight = Math.max(24, Math.floor(rawHeight * viewScaleY));

    const hasEnabledBotOv = (channel.bottomOverlay?.playlist || []).some(
      (it) => it && it.enabled !== false
    );
    const overlayOffset =
      channel.bottomOverlay?.enabled && hasEnabledBotOv
        ? (channel.bottomOverlay.height || 200) * viewScaleY
        : 0;

    const customX =
      typeof g.customX === 'number'
        ? g.customX
        : typeof g.tickerCustomX === 'number'
        ? g.tickerCustomX
        : typeof channel.bottomScroll?.customX === 'number'
        ? channel.bottomScroll.customX
        : 0;
    const customY =
      typeof g.customY === 'number'
        ? g.customY
        : typeof g.tickerCustomY === 'number'
        ? g.tickerCustomY
        : typeof channel.bottomScroll?.customY === 'number'
        ? channel.bottomScroll.customY
        : undefined;
    const customW =
      typeof g.customWidth === 'number' && g.customWidth >= 150
        ? g.customWidth
        : typeof g.tickerCustomWidth === 'number' && g.tickerCustomWidth >= 150
        ? g.tickerCustomWidth
        : typeof channel.bottomScroll?.customWidth === 'number' && channel.bottomScroll.customWidth >= 150
        ? channel.bottomScroll.customWidth
        : 1920;

    const barX = vx + Math.max(0, Math.min(1800, customX)) * viewScaleX;
    const barY =
      typeof customY === 'number'
        ? vy + Math.max(0, Math.min(1080 - rawHeight, customY)) * viewScaleY
        : vy + vh - barHeight - overlayOffset;
    const barW = Math.max(120, Math.min(vw - (barX - vx), customW * viewScaleX));

    const barDurationSec =
      typeof g.tickerDurationSec === 'number'
        ? g.tickerDurationSec
        : typeof channel.bottomScroll?.tickerDurationSec === 'number'
        ? channel.bottomScroll.tickerDurationSec
        : 0;

    this.renderTickerBar(
      ctx,
      channel,
      activeItems,
      barX,
      barY,
      barW,
      barHeight,
      g.tickerBgColor || '#06080e',
      g.tickerTextColor || '#FFFFFF',
      g.tickerFontFamily || 'Arial',
      g.tickerFontSize ? Math.max(12, Math.floor(g.tickerFontSize * viewScaleY)) : undefined,
      g.tickerSpeed || 4,
      g.tickerDirection || 'rtl',
      `${stateScope}bottom-ticker`,
      timestamp,
      {
        barDurationSec,
        trackKey: 'bottomTicker',
        stateScope,
        nowEpochMs,
      }
    );
  }

  private drawTopScrollTicker(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    timestamp: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number,
    stateScope: string = ''
  ) {
    const g = channel.graphics as any;
    const nowEpochMs = Date.now();
    if (isTickerBarExpired(g.topTickerExpiresAt, nowEpochMs)) return;
    const topItems = filterActiveTickerItems(g.topTickerItems || [], nowEpochMs);
    if (topItems.length === 0) return;

    const viewScaleX = vw / 1920;
    const viewScaleY = vh / 1080;
    const rawHeight = g.topTickerHeight || 48;
    const barHeight = Math.max(24, Math.floor(rawHeight * viewScaleY));
    const hasEnabledTopOv = (channel.topOverlay?.playlist || []).some(
      (it) => it && it.enabled !== false
    );
    const topOverlayOffset =
      channel.topOverlay?.enabled && hasEnabledTopOv
        ? (channel.topOverlay.height || 90) * viewScaleY
        : 0;

    const customX =
      typeof g.topTickerCustomX === 'number'
        ? g.topTickerCustomX
        : typeof channel.bottomScroll?.topTickerCustomX === 'number'
        ? channel.bottomScroll.topTickerCustomX
        : 0;
    const customY =
      typeof g.topTickerCustomY === 'number'
        ? g.topTickerCustomY
        : typeof channel.bottomScroll?.topTickerCustomY === 'number'
        ? channel.bottomScroll.topTickerCustomY
        : undefined;
    const customW =
      typeof g.topTickerCustomWidth === 'number' && g.topTickerCustomWidth >= 150
        ? g.topTickerCustomWidth
        : typeof channel.bottomScroll?.topTickerCustomWidth === 'number' &&
          channel.bottomScroll.topTickerCustomWidth >= 150
        ? channel.bottomScroll.topTickerCustomWidth
        : 1920;

    const barX = vx + Math.max(0, Math.min(1800, customX)) * viewScaleX;
    const barY =
      typeof customY === 'number'
        ? vy + Math.max(0, Math.min(1080 - rawHeight, customY)) * viewScaleY
        : vy + topOverlayOffset;
    const barW = Math.max(120, Math.min(vw - (barX - vx), customW * viewScaleX));

    const barDurationSec =
      typeof g.topTickerDurationSec === 'number'
        ? g.topTickerDurationSec
        : typeof channel.bottomScroll?.topTickerDurationSec === 'number'
        ? channel.bottomScroll.topTickerDurationSec
        : 0;

    this.renderTickerBar(
      ctx,
      channel,
      topItems,
      barX,
      barY,
      barW,
      barHeight,
      g.topTickerBgColor || '#082f49',
      g.topTickerTextColor || '#fef08a',
      g.topTickerFontFamily || g.tickerFontFamily || 'Arial',
      g.topTickerFontSize ? Math.max(12, Math.floor(g.topTickerFontSize * viewScaleY)) : undefined,
      g.topTickerSpeed || 4,
      g.topTickerDirection || 'rtl',
      `${stateScope}top-ticker`,
      timestamp,
      {
        barDurationSec,
        trackKey: 'topTicker',
        stateScope,
        nowEpochMs,
      }
    );
  }

  private renderTickerBar(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    activeItems: ActiveTickerItem[],
    barX: number,
    barY: number,
    barWidth: number,
    barHeight: number,
    bgColor: string,
    textColor: string,
    fontFamily: string,
    customFontSize: number | undefined,
    speedVal: number,
    direction: 'rtl' | 'ltr',
    offsetKey: string,
    timestamp: number,
    syncOpts?: {
      barDurationSec?: number;
      trackKey?: 'bottomTicker' | 'topTicker';
      stateScope?: string;
      nowEpochMs?: number;
    }
  ) {
    if (activeItems.length === 0) return;

    const accentColor = channel.colorAccent || '#EF4444';
    ctx.save();
    if (bgColor && bgColor !== 'transparent' && bgColor !== 'none') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle = accentColor;
      ctx.fillRect(barX, barY, barWidth, 2.5);
    }

    const fontSize = customFontSize || Math.max(13, Math.floor(barHeight * 0.48));
    const safeFont = fontFamily || 'Arial';
    const nowEpochMs = syncOpts?.nowEpochMs || Date.now();
    const stateScope = syncOpts?.stateScope || '';
    const isSlaveDisplay = stateScope.startsWith('ext-') || stateScope.startsWith('fs-');

    // Sequential Full-Scroll State (1st Scroll plays 100% Full across bar, AFTER it finishes Next Scroll plays!)
    let seq = this.tickerSeqState.get(offsetKey);
    if (!seq) {
      seq = {
        itemIndex: 0,
        posX: 0,
        initialized: false,
        activeItemId: '',
        lastDirection: direction,
        lastTimestamp: 0,
        itemStartedAtMs: nowEpochMs,
      };
      this.tickerSeqState.set(offsetKey, seq);
    }

    if (seq.itemIndex >= activeItems.length || seq.itemIndex < 0) {
      seq.itemIndex = 0;
      seq.initialized = false;
    }

    // Slave displays (2nd Display / Fullscreen) reconcile scroll item & posX with authoritative PGM OUT
    if (isSlaveDisplay && syncOpts?.trackKey) {
      const authTrack = this.authoritativeCgSync?.[syncOpts.trackKey];
      const reconciled = reconcileSyncedTickerState({
        authoritative: authTrack,
        activeItems,
        direction,
        speedVal,
        nowEpochMs,
        currentLocalItemId: seq.activeItemId,
        currentLocalPosX: seq.initialized ? seq.posX : undefined,
      });
      if (reconciled && reconciled.shouldSnap) {
        seq.itemIndex = reconciled.matchedIndex;
        seq.posX = reconciled.syncedPosX;
        seq.activeItemId = activeItems[reconciled.matchedIndex].id;
        seq.lastDirection = direction;
        seq.initialized = true;
        seq.itemStartedAtMs = nowEpochMs - reconciled.elapsedSec * 1000;
      }
    }

    const currentItem = activeItems[seq.itemIndex];
    if (!currentItem) {
      ctx.restore();
      return;
    }

    if (seq.activeItemId !== currentItem.id || seq.lastDirection !== direction) {
      seq.initialized = false;
    }

    const activeTitle = (currentItem.title || '').trim();
    let contentStartX = barX + 12;
    let contentWidth = Math.max(40, barWidth - 24);

    // Pre-rendered left Title badge box (cached bitmap, zero per-frame measureText/fillText)
    if (activeTitle.length > 0) {
      const badgeH = Math.max(12, Math.round(barHeight));
      const badgeKey = `${safeFont}|${badgeH}|${accentColor}|${activeTitle}`;
      let badgeEntry = this.tickerBadgeCache.get(badgeKey);
      if (!badgeEntry) {
        if (this.tickerBadgeCache.size >= 16) {
          const fk = this.tickerBadgeCache.keys().next().value;
          if (fk) this.tickerBadgeCache.delete(fk);
        }
        const bCanvas = document.createElement('canvas');
        const bCtx = bCanvas.getContext('2d');
        const badgeFontSize = Math.max(11, Math.floor(barHeight * 0.42));
        let badgeW = 72;
        if (bCtx) {
          bCtx.font = `900 ${badgeFontSize}px "${safeFont}", Arial, sans-serif`;
          const badgeTextW = bCtx.measureText(activeTitle).width;
          badgeW = Math.max(72, Math.floor(badgeTextW + 28));
          bCanvas.width = badgeW;
          bCanvas.height = badgeH;
          bCtx.fillStyle = accentColor;
          bCtx.fillRect(0, 0, badgeW, badgeH);
          bCtx.font = `900 ${badgeFontSize}px "${safeFont}", Arial, sans-serif`;
          bCtx.fillStyle = '#FFFFFF';
          bCtx.textAlign = 'center';
          bCtx.textBaseline = 'middle';
          bCtx.fillText(activeTitle, badgeW / 2, badgeH / 2 + 1);
        }
        badgeEntry = { canvas: bCanvas, width: badgeW, height: badgeH };
        this.tickerBadgeCache.set(badgeKey, badgeEntry);
      }

      ctx.drawImage(badgeEntry.canvas, barX, barY, badgeEntry.width, barHeight);
      contentStartX = barX + badgeEntry.width + 14;
      contentWidth = Math.max(40, barWidth - badgeEntry.width - 20);
    }

    const itemText = (currentItem.text || '').trim();
    if (!itemText) {
      seq.itemIndex = (seq.itemIndex + 1) % activeItems.length;
      seq.initialized = false;
      ctx.restore();
      return;
    }

    const stripH = Math.max(16, Math.round(barHeight));
    const stripKey = `${safeFont}|${fontSize}|${textColor}|${stripH}|${itemText}`;
    let stripEntry = this.tickerStripCache.get(stripKey);
    if (!stripEntry) {
      if (this.tickerStripCache.size >= 16) {
        const fk = this.tickerStripCache.keys().next().value;
        if (fk) this.tickerStripCache.delete(fk);
      }
      const sCanvas = document.createElement('canvas');
      const sCtx = sCanvas.getContext('2d');
      let measuredW = 0;
      if (sCtx) {
        sCtx.font = `700 ${fontSize}px "${safeFont}", Arial, sans-serif`;
        measuredW = sCtx.measureText(itemText).width;
        if (measuredW > 0 && measuredW <= 7600) {
          sCanvas.width = Math.ceil(measuredW) + 8;
          sCanvas.height = stripH;
          sCtx.font = `700 ${fontSize}px "${safeFont}", Arial, sans-serif`;
          sCtx.textBaseline = 'middle';
          sCtx.textAlign = 'left';
          sCtx.fillStyle = textColor;
          sCtx.fillText(itemText, 0, stripH / 2 + 1);
        }
      }
      stripEntry = { canvas: sCanvas, width: sCanvas.width, height: stripH, textWidth: measuredW };
      this.tickerStripCache.set(stripKey, stripEntry);
    }

    const itemTextWidth = stripEntry.textWidth;
    if (itemTextWidth > 0) {
      const isLtr = direction === 'ltr';
      const nowTs = timestamp > 0 ? timestamp : performance.now();
      const dtMs =
        seq.lastTimestamp && seq.lastTimestamp > 0
          ? Math.min(48, Math.max(4, nowTs - seq.lastTimestamp))
          : 16.6667;
      seq.lastTimestamp = nowTs;

      if (!seq.initialized) {
        seq.posX = isLtr ? -itemTextWidth : contentWidth;
        seq.initialized = true;
        seq.activeItemId = currentItem.id;
        seq.lastDirection = direction;
        seq.itemStartedAtMs = nowEpochMs;
      }

      const speed = Math.max(0.6, speedVal * 0.9) * (dtMs / 16.6667);
      if (isLtr) {
        seq.posX += speed;
      } else {
        seq.posX -= speed;
      }

      if (stripEntry.width > 0 && itemTextWidth <= 7600) {
        // Fast hardware bitmap slice blit: zero text shaping or font rasterization per frame!
        const visStart = Math.max(0, -seq.posX);
        const visEnd = Math.min(stripEntry.width, contentWidth - seq.posX);
        const drawW = visEnd - visStart;
        if (drawW > 0.5) {
          const dstX = contentStartX + Math.max(0, seq.posX);
          ctx.drawImage(
            stripEntry.canvas,
            visStart,
            0,
            drawW,
            stripEntry.height,
            dstX,
            barY,
            drawW,
            barHeight
          );
        }
      } else {
        // Ultra-long string safety fallback (>7600px)
        ctx.beginPath();
        ctx.rect(contentStartX, barY, contentWidth, barHeight);
        ctx.clip();
        ctx.font = `700 ${fontSize}px "${safeFont}", Arial, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'left';
        ctx.fillText(itemText, contentStartX + seq.posX, barY + barHeight / 2 + 1);
      }

      const elapsedItemSec = Math.max(0, (nowEpochMs - (seq.itemStartedAtMs || nowEpochMs)) / 1000);
      const minDurationSec = resolveTickerItemDurationSec(
        currentItem.durationSec,
        syncOpts?.barDurationSec
      );
      const passEval = evaluateTickerPassCompletion({
        isLtr,
        posX: seq.posX,
        contentWidth,
        textWidth: itemTextWidth,
        elapsedItemSec,
        minDurationSec,
      });

      if (!isSlaveDisplay && syncOpts?.trackKey && stateScope === '') {
        this.liveTickerSnapshot[syncOpts.trackKey] = {
          itemIndex: seq.itemIndex,
          itemId: currentItem.id,
          posX: seq.posX,
          contentWidth,
          textWidth: itemTextWidth,
          elapsedSec: elapsedItemSec,
          updatedAtMs: nowEpochMs,
        };
      }

      if (passEval.passFinished) {
        if (passEval.repeatCurrentItem) {
          seq.posX = isLtr ? -itemTextWidth : contentWidth;
        } else {
          seq.itemIndex = (seq.itemIndex + 1) % activeItems.length;
          seq.initialized = false;
        }
      }
    } else {
      seq.itemIndex = (seq.itemIndex + 1) % activeItems.length;
      seq.initialized = false;
    }

    ctx.restore();
  }

  /**
   * Draws the "BACK IN XX SEC" Broadcast Commercial Break & Program Countdown Badge.
   * Prominently displayed during commercial ad breaks (Every N Min Ads & attached ads)
   * or during scheduled programs with live countdown calculated across all queued ads.
   */
  public drawBackInTimer(
    ctx: CanvasRenderingContext2D,
    channel: TVChannel,
    timestamp: number,
    vx: number,
    vy: number,
    vw: number,
    vh: number
  ) {
    const cfg: BackInTimerConfig =
      (channel.graphics as any)?.backInTimer ||
      channel.backInTimer ||
      DEFAULT_BACK_IN_TIMER_CONFIG;

    if (cfg.enabled === false) return;

    // Determine if an ad or program is currently active
    const isAdPlaying =
      Boolean(channel.activeEveryNMinAd) ||
      channel.playbackContext === 'everyNMinAd' ||
      channel.playbackContext === 'ad';
    const isProgramPlaying =
      Boolean(channel.activeProgramId) ||
      channel.playbackContext === 'program';

    const shouldShow =
      (isAdPlaying && cfg.showDuringAds !== false) ||
      (isProgramPlaying && Boolean(cfg.showDuringPrograms));

    if (!shouldShow) return;

    // Calculate total remaining break duration across current ad + all queued ads
    let totalRemainingSec = 0;
    if (isAdPlaying) {
      const activeAd = channel.activeEveryNMinAd;
      const activeDuration = Math.max(1, activeAd?.duration || 30);
      const activeElapsed = Math.max(0, channel.everyNMinTime ?? activeAd?.elapsedSec ?? 0);
      const currentAdRem = Math.max(0, activeDuration - activeElapsed);

      // Sum of remaining queued ads playing in this commercial break
      const queuedAdsRem = (channel.everyNMinQueue || []).reduce(
        (acc, ad) => acc + Math.max(1, ad.duration || 30),
        0
      );

      totalRemainingSec = Math.max(1, Math.round(currentAdRem + queuedAdsRem));
    } else if (isProgramPlaying) {
      const activeProg = (channel.scheduledPrograms || []).find((p) => p.id === channel.activeProgramId);
      const clipIdx = channel.activeProgramClipIndex || 0;
      const curClip = activeProg?.playlist?.[clipIdx];
      const clipDur = Math.max(1, curClip?.duration || 300);
      const progTime = Math.max(0, channel.activeProgramTime || 0);
      totalRemainingSec = Math.max(1, Math.round(clipDur - progTime));
    }

    const mins = Math.floor(totalRemainingSec / 60);
    const secs = totalRemainingSec % 60;
    const timeFormatted =
      cfg.timeFormat === 'seconds_only'
        ? `${totalRemainingSec}s`
        : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const labelText = (cfg.labelText || 'BACK IN').trim().toUpperCase();

    const scaleX = vw / 1920;
    const scaleY = vh / 1080;
    const baseScale = Math.min(scaleX, scaleY);
    const userScale = Math.max(0.4, Math.min(2.5, cfg.scale || 1));
    const finalScale = baseScale * userScale;

    const baseFontSize = Math.max(14, Math.round((cfg.fontSize || 26) * finalScale));
    const fontFamily = cfg.fontFamily || 'Impact, Arial Black, sans-serif';

    ctx.save();
    ctx.textBaseline = 'middle';

    const style = cfg.style || 'split_badge';

    if (style === 'split_badge') {
      // 1. TV Broadcast Split Box (Red Label Box + White Timer Box)
      const labelFont = `900 ${baseFontSize}px ${fontFamily}`;
      const timerFont = `900 ${baseFontSize}px ${fontFamily}`;

      ctx.font = labelFont;
      const labelTextW = ctx.measureText(labelText).width;
      ctx.font = timerFont;
      const timerTextW = ctx.measureText(timeFormatted).width;

      const padX = Math.round(14 * finalScale);
      const padY = Math.round(8 * finalScale);
      const labelBoxW = Math.round(labelTextW + padX * 2);
      const timerBoxW = Math.round(timerTextW + padX * 2);
      const badgeH = Math.round(baseFontSize + padY * 2);
      const totalBadgeW = labelBoxW + timerBoxW;

      const offX = (cfg.offsetX ?? 36) * scaleX;
      const offY = (cfg.offsetY ?? 36) * scaleY;

      let badgeX = vx + offX;
      let badgeY = vy + offY;

      if (cfg.position === 'top-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'top-center') {
        badgeX = vx + (vw - totalBadgeW) / 2 + offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'bottom-left') {
        badgeX = vx + offX;
        badgeY = vy + vh - badgeH - offY;
      } else if (cfg.position === 'bottom-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + vh - badgeH - offY;
      }

      // Crisp zero-blur drop shadow backing rectangle
      if (cfg.showShadow !== false) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(
          badgeX + Math.round(3 * finalScale),
          badgeY + Math.round(4 * finalScale),
          totalBadgeW,
          badgeH
        );
      }

      // Border outline if enabled
      const borderWidth = cfg.showBorder !== false ? Math.max(1, Math.round(2 * finalScale)) : 0;
      if (borderWidth > 0) {
        ctx.fillStyle = cfg.borderColor || '#ffffff';
        ctx.fillRect(
          badgeX - borderWidth,
          badgeY - borderWidth,
          totalBadgeW + borderWidth * 2,
          badgeH + borderWidth * 2
        );
      }

      // Draw Left Label Box
      ctx.fillStyle = cfg.labelBgColor || '#cc0000';
      ctx.fillRect(badgeX, badgeY, labelBoxW, badgeH);

      // Draw Right Timer Box
      ctx.fillStyle = cfg.timerBgColor || '#ffffff';
      ctx.fillRect(badgeX + labelBoxW, badgeY, timerBoxW, badgeH);

      // Draw Left Label Text
      ctx.font = labelFont;
      ctx.fillStyle = cfg.labelTextColor || '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(labelText, badgeX + labelBoxW / 2, badgeY + badgeH / 2);

      // Draw Right Timer Text
      ctx.font = timerFont;
      ctx.fillStyle = cfg.timerTextColor || '#000000';
      ctx.textAlign = 'center';
      ctx.fillText(timeFormatted, badgeX + labelBoxW + timerBoxW / 2, badgeY + badgeH / 2);

    } else if (style === 'glass_pill') {
      // 2. Modern Neon Glass Pill with live pulsing red dot
      const labelFont = `700 ${Math.round(baseFontSize * 0.85)}px ${fontFamily}`;
      const timerFont = `900 ${baseFontSize}px monospace, ${fontFamily}`;

      ctx.font = labelFont;
      const labelTextW = ctx.measureText(labelText).width;
      ctx.font = timerFont;
      const timerTextW = ctx.measureText(timeFormatted).width;

      const dotR = Math.max(3, Math.round(5 * finalScale));
      const padX = Math.round(18 * finalScale);
      const padY = Math.round(8 * finalScale);
      const totalBadgeW = Math.round(dotR * 2 + 10 * finalScale + labelTextW + 12 * finalScale + timerTextW + padX * 2);
      const badgeH = Math.round(baseFontSize + padY * 2);

      const offX = (cfg.offsetX ?? 36) * scaleX;
      const offY = (cfg.offsetY ?? 36) * scaleY;

      let badgeX = vx + offX;
      let badgeY = vy + offY;

      if (cfg.position === 'top-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'top-center') {
        badgeX = vx + (vw - totalBadgeW) / 2 + offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'bottom-left') {
        badgeX = vx + offX;
        badgeY = vy + vh - badgeH - offY;
      } else if (cfg.position === 'bottom-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + vh - badgeH - offY;
      }

      // Pill container
      const cornerR = badgeH / 2;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, totalBadgeW, badgeH, cornerR);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
      ctx.fill();

      // Border with neon color
      ctx.lineWidth = Math.max(1, Math.round(2 * finalScale));
      ctx.strokeStyle = cfg.borderColor || '#38bdf8';
      ctx.stroke();

      // Pulsing Live Red Dot
      const pulseCycle = (timestamp % 1000) / 1000;
      const dotAlpha = 0.5 + 0.5 * Math.sin(pulseCycle * Math.PI * 2);
      const dotCenterX = badgeX + padX + dotR;
      const dotCenterY = badgeY + badgeH / 2;

      ctx.beginPath();
      ctx.arc(dotCenterX, dotCenterY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(239, 68, 68, ${dotAlpha.toFixed(2)})`;
      ctx.fill();

      // Label Text
      ctx.font = labelFont;
      ctx.fillStyle = cfg.labelTextColor || '#ffffff';
      ctx.textAlign = 'left';
      const textStartX = dotCenterX + dotR + Math.round(10 * finalScale);
      ctx.fillText(labelText, textStartX, badgeY + badgeH / 2);

      // Timer Text
      ctx.font = timerFont;
      ctx.fillStyle = cfg.timerTextColor || '#38bdf8';
      ctx.textAlign = 'left';
      ctx.fillText(timeFormatted, textStartX + labelTextW + Math.round(12 * finalScale), badgeY + badgeH / 2);

    } else {
      // 3. News / Sports Channel Box Ribbon
      const labelFont = `800 ${Math.round(baseFontSize * 0.85)}px ${fontFamily}`;
      const timerFont = `900 ${baseFontSize}px monospace, ${fontFamily}`;

      ctx.font = labelFont;
      const fullLabel = `⏱️ ${labelText || 'PROGRAM RESUMES IN'}`;
      const labelTextW = ctx.measureText(fullLabel).width;
      ctx.font = timerFont;
      const timerTextW = ctx.measureText(timeFormatted).width;

      const padX = Math.round(14 * finalScale);
      const padY = Math.round(8 * finalScale);
      const timerBlockW = Math.round(timerTextW + 16 * finalScale);
      const totalBadgeW = Math.round(labelTextW + timerBlockW + padX * 2 + 10 * finalScale);
      const badgeH = Math.round(baseFontSize + padY * 2);

      const offX = (cfg.offsetX ?? 36) * scaleX;
      const offY = (cfg.offsetY ?? 36) * scaleY;

      let badgeX = vx + offX;
      let badgeY = vy + offY;

      if (cfg.position === 'top-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'top-center') {
        badgeX = vx + (vw - totalBadgeW) / 2 + offX;
        badgeY = vy + offY;
      } else if (cfg.position === 'bottom-left') {
        badgeX = vx + offX;
        badgeY = vy + vh - badgeH - offY;
      } else if (cfg.position === 'bottom-right') {
        badgeX = vx + vw - totalBadgeW - offX;
        badgeY = vy + vh - badgeH - offY;
      }

      // Background Box
      const cornerR = Math.round(6 * finalScale);
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, totalBadgeW, badgeH, cornerR);
      ctx.fillStyle = cfg.labelBgColor || '#1e1b4b';
      ctx.fill();

      // Border
      ctx.lineWidth = Math.max(1, Math.round(2 * finalScale));
      ctx.strokeStyle = cfg.borderColor || '#a855f7';
      ctx.stroke();

      // Label Text
      ctx.font = labelFont;
      ctx.fillStyle = cfg.labelTextColor || '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(fullLabel, badgeX + padX, badgeY + badgeH / 2);

      // Timer Block Inside Ribbon
      const timerBlockX = badgeX + totalBadgeW - padX - timerBlockW;
      const timerBlockY = badgeY + Math.round(4 * finalScale);
      const timerBlockH = badgeH - Math.round(8 * finalScale);

      ctx.beginPath();
      ctx.roundRect(timerBlockX, timerBlockY, timerBlockW, timerBlockH, Math.round(4 * finalScale));
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fill();

      ctx.font = timerFont;
      ctx.fillStyle = cfg.timerTextColor || '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText(timeFormatted, timerBlockX + timerBlockW / 2, timerBlockY + timerBlockH / 2);
    }

    ctx.restore();
  }
}

export const videoGenerator = new VideoGeneratorService();
