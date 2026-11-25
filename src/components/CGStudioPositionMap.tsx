import React, { useState, useEffect, useRef } from 'react';
import {
  Move,
  Maximize2,
  ArrowUp,
  ArrowDown,
  AlignLeft,
  AlignRight,
  Tv,
  Layout,
  Sparkles,
  Eye,
  EyeOff,
  Crosshair
} from 'lucide-react';
import {
  TVChannel,
  BottomScrollConfig,
  OverlayBannerConfig,
  LogoItemConfig,
  LShapeConfig
} from '../types/playout';
import { videoGenerator } from '../services/videoGenerator';

interface CGStudioPositionMapProps {
  channel: TVChannel;
  bottomOverlay: OverlayBannerConfig;
  topOverlay: OverlayBannerConfig;
  lShape: LShapeConfig;
  channelLogo: LogoItemConfig;
  sponsor1: LogoItemConfig;
  sponsor2: LogoItemConfig;
  activeLayer?: string;
  onSelectLayer?: (layer: any) => void;
  onUpdateGraphics: (partial: Partial<BottomScrollConfig>) => void;
  onUpdateBottomOverlay: (partial: Partial<OverlayBannerConfig>) => void;
  onUpdateTopOverlay: (partial: Partial<OverlayBannerConfig>) => void;
  onUpdateLShape?: (partial: Partial<LShapeConfig>) => void;
  onUpdateLogo: (type: 'channel' | 'sponsor1' | 'sponsor2', partial: Partial<LogoItemConfig>) => void;
  activeVideoElement?: HTMLVideoElement | null;
  activeOverlayVideoElement?: HTMLVideoElement | null;
  activeTopOverlayVideoElement?: HTMLVideoElement | null;
  activeLShapeVideoElement?: HTMLVideoElement | null;
  onTogglePlay?: (id: number) => void;
  onSkipNext?: (id: number) => void;
  onImportVideos?: (channelId: number, files: FileList | File[]) => void;
  onToggleStudioPreviewMute?: (id: number) => void;
}

export type MapLayerKey =
  | 'lshape'
  | 'bottom_overlay'
  | 'top_overlay'
  | 'ticker'
  | 'top_ticker'
  | 'channel_logo'
  | 'sponsor1'
  | 'sponsor2';

export const CGStudioPositionMap: React.FC<CGStudioPositionMapProps> = ({
  channel,
  bottomOverlay,
  topOverlay,
  lShape,
  channelLogo,
  sponsor1,
  sponsor2,
  activeLayer,
  onSelectLayer,
  onUpdateGraphics,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUpdateLShape,
  onUpdateLogo,
  activeVideoElement,
  activeOverlayVideoElement,
  activeTopOverlayVideoElement,
  activeLShapeVideoElement,
  onTogglePlay,
  onSkipNext,
  onImportVideos,
  onToggleStudioPreviewMute,
}) => {
  const g = channel.graphics;
  const [selectedLayer, setSelectedLayer] = useState<MapLayerKey>('ticker');
  const [step, setStep] = useState<1 | 10 | 50>(10);
  const [showSafeTitle, setShowSafeTitle] = useState(false);
  const [showSafeAction, setShowSafeAction] = useState(false);
  const [showInteractiveBoxes, setShowInteractiveBoxes] = useState(true);
  const [draggingLayer, setDraggingLayer] = useState<MapLayerKey | null>(null);
  const [dragMode, setDragMode] = useState<'move' | 'resize'>('move');
  const [dragStart, setDragStart] = useState<{
    clientX: number;
    clientY: number;
    origX: number;
    origY: number;
    origW?: number;
    origH?: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number | null>(null);
  const latestRenderArgsRef = useRef({
    channel,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
  });
  latestRenderArgsRef.current = {
    channel,
    activeOverlayVideoElement,
    activeTopOverlayVideoElement,
    activeLShapeVideoElement,
  };

  // Sync with parent activeLayer if provided
  useEffect(() => {
    if (!activeLayer) return;
    if (activeLayer === 'lshape') setSelectedLayer('lshape');
    else if (activeLayer === 'bottom_overlay' || activeLayer === 'bottom') setSelectedLayer('bottom_overlay');
    else if (activeLayer === 'top_overlay' || activeLayer === 'top') setSelectedLayer('top_overlay');
    else if (activeLayer === 'crawler' || activeLayer === 'bottom_scroll' || activeLayer === 'ticker') setSelectedLayer('ticker');
    else if (activeLayer === 'top_ticker') setSelectedLayer('top_ticker');
    else if (activeLayer === 'logos' || activeLayer === 'logo') setSelectedLayer('channel_logo');
  }, [activeLayer]);

  const selectAndNotify = (layer: MapLayerKey) => {
    setSelectedLayer(layer);
    if (!onSelectLayer) return;
    if (layer === 'lshape') onSelectLayer('lshape');
    else if (layer === 'bottom_overlay') onSelectLayer('bottom_overlay');
    else if (layer === 'top_overlay') onSelectLayer('top_overlay');
    else if (layer === 'ticker') onSelectLayer('bottom_scroll');
    else if (layer === 'top_ticker') onSelectLayer('top_ticker');
    else if (layer === 'channel_logo' || layer === 'sponsor1' || layer === 'sponsor2') onSelectLayer('logos');
  };

  // Smooth ~24fps CG-Only 1080p Canvas Render Loop (never plays main playlist video inside CG overlay stage)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let running = true;
    let lastDrawMs = 0;

    const render = (time: number) => {
      if (!running) return;
      if (!document.hidden && time - lastDrawMs >= 42) {
        lastDrawMs = time;
        const args = latestRenderArgsRef.current;
        videoGenerator.renderChannelFrame(
          canvas,
          args.channel,
          time,
          null,
          args.activeOverlayVideoElement,
          args.activeTopOverlayVideoElement,
          args.activeLShapeVideoElement,
          { cgOnlyStage: true }
        );
      }
      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);
    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // Mouse drag-to-move or resize on HD Player
  const handleStartDrag = (
    e: React.MouseEvent,
    layer: MapLayerKey,
    origX: number,
    origY: number,
    mode: 'move' | 'resize' = 'move',
    origW?: number,
    origH?: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    selectAndNotify(layer);
    setDraggingLayer(layer);
    setDragMode(mode);
    setDragStart({
      clientX: e.clientX,
      clientY: e.clientY,
      origX,
      origY,
      origW,
      origH,
    });
  };

  const getBottomTickerDefaultY = () => {
    const h = g.tickerCustomHeight || 48;
    const ov = bottomOverlay.enabled ? bottomOverlay.height || 200 : 0;
    return Math.max(0, 1080 - h - ov);
  };

  const getTopTickerDefaultY = () => {
    return topOverlay.enabled ? topOverlay.height || 90 : 0;
  };

  useEffect(() => {
    if (!draggingLayer || !dragStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!viewportRef.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      const scaleX = 1920 / Math.max(1, rect.width);
      const scaleY = 1080 / Math.max(1, rect.height);
      const dx = Math.round((e.clientX - dragStart.clientX) * scaleX);
      const dy = Math.round((e.clientY - dragStart.clientY) * scaleY);

      if (dragMode === 'resize') {
        if (draggingLayer === 'ticker') {
          const newW = Math.max(200, Math.min(1920, (dragStart.origW || 1920) + dx));
          const newH = Math.max(28, Math.min(1080, (dragStart.origH || 48) + dy));
          onUpdateGraphics({
            customWidth: newW,
            tickerCustomWidth: newW,
            tickerCustomHeight: newH,
          });
        } else if (draggingLayer === 'top_ticker') {
          const newW = Math.max(200, Math.min(1920, (dragStart.origW || 1920) + dx));
          const newH = Math.max(28, Math.min(1080, (dragStart.origH || 48) + dy));
          onUpdateGraphics({
            topTickerCustomWidth: newW,
            topTickerHeight: newH,
          });
        } else if (draggingLayer === 'bottom_overlay') {
          const newW = Math.max(200, Math.min(1920, (dragStart.origW || 1920) + dx));
          const newH = Math.max(30, Math.min(1080, (dragStart.origH || 200) + dy));
          onUpdateBottomOverlay({
            width: newW,
            height: newH,
          });
        } else if (draggingLayer === 'top_overlay') {
          const newW = Math.max(200, Math.min(1920, (dragStart.origW || 1920) + dx));
          const newH = Math.max(30, Math.min(1080, (dragStart.origH || 90) + dy));
          onUpdateTopOverlay({
            width: newW,
            height: newH,
          });
        } else if (
          draggingLayer === 'channel_logo' ||
          draggingLayer === 'sponsor1' ||
          draggingLayer === 'sponsor2'
        ) {
          const targetKey =
            draggingLayer === 'channel_logo'
              ? 'channel'
              : draggingLayer === 'sponsor1'
              ? 'sponsor1'
              : 'sponsor2';
          const newW = Math.max(40, Math.min(1920, (dragStart.origW || 150) + dx));
          const newH = Math.max(24, Math.min(1080, (dragStart.origH || 90) + dy));
          onUpdateLogo(targetKey, {
            fullScreen: false,
            customWidth: newW,
            customHeight: newH,
            size: Math.min(1920, Math.round(newW / 1.3)),
          });
        }
        return;
      }

      if (draggingLayer === 'bottom_overlay') {
        onUpdateBottomOverlay({
          x: Math.max(-400, Math.min(1900, dragStart.origX + dx)),
          y: Math.max(0, Math.min(1040, dragStart.origY + dy)),
        });
      } else if (draggingLayer === 'top_overlay') {
        onUpdateTopOverlay({
          x: Math.max(-400, Math.min(1900, dragStart.origX + dx)),
          y: Math.max(0, Math.min(1040, dragStart.origY + dy)),
        });
      } else if (draggingLayer === 'ticker') {
        const nextX = Math.max(0, Math.min(1800, dragStart.origX + dx));
        const nextY = Math.max(0, Math.min(1080 - (g.tickerCustomHeight || 48), dragStart.origY + dy));
        onUpdateGraphics({
          tickerPosition: 'custom',
          customX: nextX,
          customY: nextY,
          tickerCustomX: nextX,
          tickerCustomY: nextY,
        });
      } else if (draggingLayer === 'top_ticker') {
        const nextX = Math.max(0, Math.min(1800, dragStart.origX + dx));
        const nextY = Math.max(0, Math.min(1080 - (g.topTickerHeight || 48), dragStart.origY + dy));
        onUpdateGraphics({
          topTickerCustomX: nextX,
          topTickerCustomY: nextY,
        });
      } else if (draggingLayer === 'lshape' && onUpdateLShape && lShape) {
        onUpdateLShape({
          offsetX: Math.max(-500, Math.min(500, dragStart.origX + dx)),
          offsetY: Math.max(-500, Math.min(500, dragStart.origY + dy)),
        });
      } else if (draggingLayer === 'channel_logo') {
        onUpdateLogo('channel', {
          offsetX: Math.max(-800, Math.min(800, dragStart.origX + dx)),
          offsetY: Math.max(-600, Math.min(600, dragStart.origY + dy)),
        });
      } else if (draggingLayer === 'sponsor1') {
        onUpdateLogo('sponsor1', {
          offsetX: Math.max(-800, Math.min(800, dragStart.origX + dx)),
          offsetY: Math.max(-600, Math.min(600, dragStart.origY + dy)),
        });
      } else if (draggingLayer === 'sponsor2') {
        onUpdateLogo('sponsor2', {
          offsetX: Math.max(-800, Math.min(800, dragStart.origX + dx)),
          offsetY: Math.max(-600, Math.min(600, dragStart.origY + dy)),
        });
      }
    };

    const handleMouseUp = () => {
      setDraggingLayer(null);
      setDragStart(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingLayer, dragStart, dragMode, channelLogo.position, sponsor1.position, sponsor2.position, g.tickerCustomHeight, g.topTickerHeight]);

  // Directional Nudge for selected layer
  const handleNudge = (dx: number, dy: number) => {
    if (selectedLayer === 'lshape' && onUpdateLShape) {
      onUpdateLShape({
        sideWidth: Math.max(200, Math.min(900, (lShape.sideWidth || 380) + dx)),
        bottomHeight: Math.max(90, Math.min(480, (lShape.bottomHeight || 190) + dy)),
        presetSize: 'custom',
      });
    } else if (selectedLayer === 'bottom_overlay') {
      const currentX = bottomOverlay.x || 0;
      const currentY = bottomOverlay.y ?? (1080 - (bottomOverlay.height || 200));
      onUpdateBottomOverlay({
        x: Math.max(-200, Math.min(1920, currentX + dx)),
        y: Math.max(0, Math.min(1080, currentY + dy)),
      });
    } else if (selectedLayer === 'top_overlay') {
      const currentX = topOverlay.x || 0;
      const currentY = topOverlay.y || 0;
      onUpdateTopOverlay({
        x: Math.max(-200, Math.min(1920, currentX + dx)),
        y: Math.max(0, Math.min(1080, currentY + dy)),
      });
    } else if (selectedLayer === 'ticker') {
      const currentX = g.customX ?? g.tickerCustomX ?? 0;
      const currentY = g.customY ?? g.tickerCustomY ?? getBottomTickerDefaultY();
      const nextX = Math.max(0, Math.min(1800, currentX + dx));
      const nextY = Math.max(0, Math.min(1080 - (g.tickerCustomHeight || 48), currentY + dy));
      onUpdateGraphics({
        tickerPosition: 'custom',
        customX: nextX,
        customY: nextY,
        tickerCustomX: nextX,
        tickerCustomY: nextY,
      });
    } else if (selectedLayer === 'top_ticker') {
      const currentX = g.topTickerCustomX ?? 0;
      const currentY = g.topTickerCustomY ?? getTopTickerDefaultY();
      const nextX = Math.max(0, Math.min(1800, currentX + dx));
      const nextY = Math.max(0, Math.min(1080 - (g.topTickerHeight || 48), currentY + dy));
      onUpdateGraphics({
        topTickerCustomX: nextX,
        topTickerCustomY: nextY,
      });
    } else if (selectedLayer === 'channel_logo') {
      onUpdateLogo('channel', {
        offsetX: Math.max(-400, Math.min(400, channelLogo.offsetX + dx)),
        offsetY: Math.max(-400, Math.min(400, channelLogo.offsetY + dy)),
      });
    } else if (selectedLayer === 'sponsor1') {
      onUpdateLogo('sponsor1', {
        offsetX: Math.max(-400, Math.min(400, sponsor1.offsetX + dx)),
        offsetY: Math.max(-400, Math.min(400, sponsor1.offsetY + dy)),
      });
    } else if (selectedLayer === 'sponsor2') {
      onUpdateLogo('sponsor2', {
        offsetX: Math.max(-400, Math.min(400, sponsor2.offsetX + dx)),
        offsetY: Math.max(-400, Math.min(400, sponsor2.offsetY + dy)),
      });
    }
  };

  // Size increase & decrease (Supports up to Full Screen 1920x1080)
  const handleSizeDelta = (dw: number, dh: number) => {
    if (selectedLayer === 'lshape' && onUpdateLShape) {
      onUpdateLShape({
        sideWidth: Math.max(200, Math.min(1920, (lShape.sideWidth || 380) + dw)),
        bottomHeight: Math.max(90, Math.min(1080, (lShape.bottomHeight || 190) + dh)),
        presetSize: 'custom',
      });
    } else if (selectedLayer === 'bottom_overlay') {
      const w = Math.max(200, Math.min(1920, (bottomOverlay.width || 1920) + dw));
      const h = Math.max(30, Math.min(1080, (bottomOverlay.height || 200) + dh));
      onUpdateBottomOverlay({ width: w, height: h });
    } else if (selectedLayer === 'top_overlay') {
      const w = Math.max(200, Math.min(1920, (topOverlay.width || 1920) + dw));
      const h = Math.max(30, Math.min(1080, (topOverlay.height || 90) + dh));
      onUpdateTopOverlay({ width: w, height: h });
    } else if (selectedLayer === 'ticker') {
      const curW = g.customWidth ?? g.tickerCustomWidth ?? 1920;
      const w = Math.max(200, Math.min(1920, curW + dw));
      const h = Math.max(24, Math.min(1080, (g.tickerCustomHeight || 48) + dh));
      onUpdateGraphics({ customWidth: w, tickerCustomWidth: w, tickerCustomHeight: h });
    } else if (selectedLayer === 'top_ticker') {
      const curW = g.topTickerCustomWidth ?? 1920;
      const w = Math.max(200, Math.min(1920, curW + dw));
      const h = Math.max(24, Math.min(1080, (g.topTickerHeight || 48) + dh));
      onUpdateGraphics({ topTickerCustomWidth: w, topTickerHeight: h });
    } else if (selectedLayer === 'channel_logo') {
      const curW = channelLogo.fullScreen ? 1920 : channelLogo.customWidth || Math.round((channelLogo.size || 115) * 1.3);
      const curH = channelLogo.fullScreen ? 1080 : channelLogo.customHeight || Math.round(curW * 0.52);
      const nextW = Math.max(40, Math.min(1920, curW + dw));
      const nextH = Math.max(24, Math.min(1080, curH + dh));
      onUpdateLogo('channel', {
        fullScreen: false,
        customWidth: nextW,
        customHeight: nextH,
        size: Math.max(40, Math.min(1920, (channelLogo.size || 115) + dw)),
      });
    } else if (selectedLayer === 'sponsor1') {
      const curW = sponsor1.fullScreen ? 1920 : sponsor1.customWidth || Math.round((sponsor1.size || 115) * 1.3);
      const curH = sponsor1.fullScreen ? 1080 : sponsor1.customHeight || Math.round(curW * 0.52);
      const nextW = Math.max(40, Math.min(1920, curW + dw));
      const nextH = Math.max(24, Math.min(1080, curH + dh));
      onUpdateLogo('sponsor1', {
        fullScreen: false,
        customWidth: nextW,
        customHeight: nextH,
        size: Math.max(40, Math.min(1920, (sponsor1.size || 115) + dw)),
      });
    } else if (selectedLayer === 'sponsor2') {
      const curW = sponsor2.fullScreen ? 1920 : sponsor2.customWidth || Math.round((sponsor2.size || 115) * 1.3);
      const curH = sponsor2.fullScreen ? 1080 : sponsor2.customHeight || Math.round(curW * 0.52);
      const nextW = Math.max(40, Math.min(1920, curW + dw));
      const nextH = Math.max(24, Math.min(1080, curH + dh));
      onUpdateLogo('sponsor2', {
        fullScreen: false,
        customWidth: nextW,
        customHeight: nextH,
        size: Math.max(40, Math.min(1920, (sponsor2.size || 115) + dw)),
      });
    }
  };

  // Snap to Safe margins / Left side fix / Right side fix
  const handleSnapLeft = () => {
    if (selectedLayer === 'lshape' && onUpdateLShape) {
      onUpdateLShape({ side: 'left' });
    } else if (selectedLayer === 'bottom_overlay') {
      onUpdateBottomOverlay({ x: 0 });
    } else if (selectedLayer === 'top_overlay') {
      onUpdateTopOverlay({ x: 0 });
    } else if (selectedLayer === 'ticker') {
      onUpdateGraphics({ customX: 0, tickerCustomX: 0 });
    } else if (selectedLayer === 'top_ticker') {
      onUpdateGraphics({ topTickerCustomX: 0 });
    } else if (selectedLayer === 'channel_logo') {
      onUpdateLogo('channel', { position: 'top-left', offsetX: 0 });
    } else if (selectedLayer === 'sponsor1') {
      onUpdateLogo('sponsor1', { position: 'top-left', offsetX: 0 });
    } else if (selectedLayer === 'sponsor2') {
      onUpdateLogo('sponsor2', { position: 'bottom-left', offsetX: 0 });
    }
  };

  const handleSnapRight = () => {
    if (selectedLayer === 'lshape' && onUpdateLShape) {
      onUpdateLShape({ side: 'right' });
    } else if (selectedLayer === 'bottom_overlay') {
      const w = bottomOverlay.width || 1920;
      onUpdateBottomOverlay({ x: Math.max(0, 1920 - w) });
    } else if (selectedLayer === 'top_overlay') {
      const w = topOverlay.width || 1920;
      onUpdateTopOverlay({ x: Math.max(0, 1920 - w) });
    } else if (selectedLayer === 'ticker') {
      const w = g.customWidth ?? g.tickerCustomWidth ?? 1920;
      const x = Math.max(0, 1920 - w);
      onUpdateGraphics({ customX: x, tickerCustomX: x });
    } else if (selectedLayer === 'top_ticker') {
      const w = g.topTickerCustomWidth ?? 1920;
      const x = Math.max(0, 1920 - w);
      onUpdateGraphics({ topTickerCustomX: x });
    } else if (selectedLayer === 'channel_logo') {
      onUpdateLogo('channel', { position: 'top-right', offsetX: 0 });
    } else if (selectedLayer === 'sponsor1') {
      onUpdateLogo('sponsor1', { position: 'top-right', offsetX: 0 });
    } else if (selectedLayer === 'sponsor2') {
      onUpdateLogo('sponsor2', { position: 'bottom-right', offsetX: 0 });
    }
  };

  const handleSnap100Percent = () => {
    if (selectedLayer === 'lshape' && onUpdateLShape) {
      onUpdateLShape({ presetSize: 'full_fit', sideWidth: 580, bottomHeight: 320, fitMode: 'fill' });
    } else if (selectedLayer === 'bottom_overlay') {
      onUpdateBottomOverlay({ width: 1920, x: 0 });
    } else if (selectedLayer === 'top_overlay') {
      onUpdateTopOverlay({ width: 1920, x: 0 });
    } else if (selectedLayer === 'ticker') {
      onUpdateGraphics({ customWidth: 1920, tickerCustomWidth: 1920, customX: 0, tickerCustomX: 0 });
    } else if (selectedLayer === 'top_ticker') {
      onUpdateGraphics({ topTickerCustomWidth: 1920, topTickerCustomX: 0 });
    }
  };

  const handleSnapBottom = () => {
    if (selectedLayer === 'bottom_overlay') {
      const h = bottomOverlay.height || 200;
      onUpdateBottomOverlay({ y: 1080 - h });
    } else if (selectedLayer === 'ticker') {
      const h = g.tickerCustomHeight || 48;
      onUpdateGraphics({ tickerPosition: 'bottom', customY: 1080 - h, tickerCustomY: 1080 - h });
    } else if (selectedLayer === 'top_ticker') {
      const h = g.topTickerHeight || 48;
      onUpdateGraphics({ topTickerCustomY: 1080 - h });
    } else if (selectedLayer === 'top_overlay') {
      onUpdateTopOverlay({ y: 1080 - (topOverlay.height || 90) });
    }
  };

  const handleSnapTop = () => {
    if (selectedLayer === 'top_overlay') {
      onUpdateTopOverlay({ y: 0 });
    } else if (selectedLayer === 'ticker') {
      onUpdateGraphics({ tickerPosition: 'top', customY: 0, tickerCustomY: 0 });
    } else if (selectedLayer === 'top_ticker') {
      onUpdateGraphics({ topTickerCustomY: 0 });
    } else if (selectedLayer === 'bottom_overlay') {
      onUpdateBottomOverlay({ y: 0 });
    }
  };

  // Helper values for current layer display
  const getSelectedLayerInfo = () => {
    switch (selectedLayer) {
      case 'lshape':
        return {
          title: `L-SHAPE TELESHOP (${(lShape?.side || 'left').toUpperCase()} SIDE)`,
          enabled: lShape?.enabled || false,
          w: lShape?.sideWidth || 380,
          h: lShape?.bottomHeight || 190,
          x: lShape?.side === 'right' ? 1920 - (lShape?.sideWidth || 380) : 0,
          y: 1080 - (lShape?.bottomHeight || 190),
          toggle: () => onUpdateLShape?.({ enabled: !lShape?.enabled }),
        };
      case 'bottom_overlay':
        return {
          title: 'BOTTOM OVERLAY BANNER (1920x200)',
          enabled: bottomOverlay.enabled,
          w: bottomOverlay.width || 1920,
          h: bottomOverlay.height || 200,
          x: bottomOverlay.x || 0,
          y: bottomOverlay.y ?? (1080 - (bottomOverlay.height || 200)),
          toggle: () => onUpdateBottomOverlay({ enabled: !bottomOverlay.enabled }),
        };
      case 'top_overlay':
        return {
          title: 'TOP OVERLAY BANNER',
          enabled: topOverlay.enabled,
          w: topOverlay.width || 1920,
          h: topOverlay.height || 90,
          x: topOverlay.x || 0,
          y: topOverlay.y || 0,
          toggle: () => onUpdateTopOverlay({ enabled: !topOverlay.enabled }),
        };
      case 'ticker':
        return {
          title: '▾ BOTTOM SCROLL TICKER',
          enabled: g.tickerEnabled,
          w: g.customWidth ?? g.tickerCustomWidth ?? 1920,
          h: g.tickerCustomHeight || 48,
          x: g.customX ?? g.tickerCustomX ?? 0,
          y: g.customY ?? g.tickerCustomY ?? getBottomTickerDefaultY(),
          toggle: () => onUpdateGraphics({ tickerEnabled: !g.tickerEnabled }),
        };
      case 'top_ticker':
        return {
          title: '▴ TOP SCROLL TICKER',
          enabled: !!g.topTickerEnabled,
          w: g.topTickerCustomWidth ?? 1920,
          h: g.topTickerHeight || 48,
          x: g.topTickerCustomX ?? 0,
          y: g.topTickerCustomY ?? getTopTickerDefaultY(),
          toggle: () => onUpdateGraphics({ topTickerEnabled: !g.topTickerEnabled }),
        };
      case 'channel_logo':
        return {
          title: 'CHANNEL STATION LOGO',
          enabled: channelLogo.enabled,
          w: channelLogo.fullScreen ? 1920 : channelLogo.customWidth || channelLogo.size,
          h: channelLogo.fullScreen ? 1080 : channelLogo.customHeight || channelLogo.size,
          x: channelLogo.offsetX,
          y: channelLogo.offsetY,
          toggle: () => onUpdateLogo('channel', { enabled: !channelLogo.enabled }),
        };
      case 'sponsor1':
        return {
          title: 'SPONSOR 1 LOGO',
          enabled: sponsor1.enabled,
          w: sponsor1.fullScreen ? 1920 : sponsor1.customWidth || sponsor1.size,
          h: sponsor1.fullScreen ? 1080 : sponsor1.customHeight || sponsor1.size,
          x: sponsor1.offsetX,
          y: sponsor1.offsetY,
          toggle: () => onUpdateLogo('sponsor1', { enabled: !sponsor1.enabled }),
        };
      case 'sponsor2':
        return {
          title: 'SPONSOR 2 LOGO',
          enabled: sponsor2.enabled,
          w: sponsor2.fullScreen ? 1920 : sponsor2.customWidth || sponsor2.size,
          h: sponsor2.fullScreen ? 1080 : sponsor2.customHeight || sponsor2.size,
          x: sponsor2.offsetX,
          y: sponsor2.offsetY,
          toggle: () => onUpdateLogo('sponsor2', { enabled: !sponsor2.enabled }),
        };
    }
  };

  const layerInfo = getSelectedLayerInfo();

  return (
    <div className="space-y-2.5 font-mono">
      {/* Top CG Overlay Stage Header & Controls (No Playlist Video Playing Here) */}
      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 shadow-md flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-700 text-white rounded text-[10px] font-black tracking-wider">
            <Tv className="w-3 h-3" />
            <span>CG OVERLAY PLAYER</span>
          </div>
          <h3 className="text-xs font-black tracking-wider text-white uppercase">
            CG LAYER STAGE (1920×1080) • BACKEND SYNC ON
          </h3>
        </div>

        {/* Viewport Safe Margins & Interactive Box Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            onClick={() => setShowInteractiveBoxes(!showInteractiveBoxes)}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition ${
              showInteractiveBoxes
                ? 'bg-purple-950 text-purple-300 border-purple-600'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
            title="Show or hide interactive drag & click boxes over the live HD player"
          >
            {showInteractiveBoxes ? '✦ Drag Handles: ON' : 'Clean HD Output'}
          </button>
          <button
            onClick={() => setShowSafeTitle(!showSafeTitle)}
            className={`px-2 py-1 rounded text-[10px] font-bold border transition ${
              showSafeTitle
                ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                : 'bg-zinc-900 text-zinc-500 border-zinc-800'
            }`}
          >
            Safe 90%
          </button>
          <div className="flex items-center gap-1 bg-black px-2 py-0.5 rounded border border-zinc-800 text-[10px]">
            <span className="text-zinc-500">Step:</span>
            {[1, 10, 50].map((s) => (
              <button
                key={s}
                onClick={() => setStep(s as 1 | 10 | 50)}
                className={`px-1.5 py-0.5 rounded font-bold ${
                  step === s ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Center 16:9 Live 1080p HD Broadcast Player + Interactive Drag Map */}
      <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 shadow-2xl">
        <div
          ref={viewportRef}
          className="relative w-full aspect-video bg-black rounded-lg border-2 border-zinc-700 overflow-hidden shadow-2xl select-none"
        >
          {/* Real-Time 60fps 1920x1080 Live Broadcast Canvas */}
          <canvas
            ref={canvasRef}
            width={1920}
            height={1080}
            className="relative z-10 w-full h-full object-contain block pointer-events-none"
          />

          {/* Action Safe (93% boundary: 3.5% padding) */}
          {showSafeAction && (
            <div className="absolute inset-[3.5%] border border-dashed border-amber-500/40 pointer-events-none flex items-start justify-end p-1">
              <span className="text-[8px] text-amber-500/70 font-bold bg-black/50 px-1 rounded">ACTION SAFE 93%</span>
            </div>
          )}

          {/* Title Safe (90% boundary: 5% padding) */}
          {showSafeTitle && (
            <div className="absolute inset-[5%] border border-dashed border-emerald-500/35 pointer-events-none flex items-start justify-start p-1">
              <span className="text-[8px] text-emerald-400/75 font-bold bg-black/50 px-1 rounded">1080p SAFE AREA</span>
            </div>
          )}

          {/* Interactive Click & Drag Handles Overlay */}
          {showInteractiveBoxes && (
            <>
              {/* LAYER 1: Top Overlay Banner (Click & Drag + Resize Handle) */}
              {topOverlay.enabled && (
                <div
                  onMouseDown={(e) =>
                    handleStartDrag(
                      e,
                      'top_overlay',
                      topOverlay.x || 0,
                      topOverlay.y || 0,
                      'move',
                      topOverlay.width || 1920,
                      topOverlay.height || 90
                    )
                  }
                  onClick={() => selectAndNotify('top_overlay')}
                  style={{
                    left: `${((topOverlay.x || 0) / 1920) * 100}%`,
                    top: `${((topOverlay.y || 0) / 1080) * 100}%`,
                    width: `${((topOverlay.width || 1920) / 1920) * 100}%`,
                    height: `${((topOverlay.height || 90) / 1080) * 100}%`,
                  }}
                  className={`absolute cursor-move transition-colors border-2 flex items-center justify-between px-3 text-[10px] font-bold ${
                    selectedLayer === 'top_overlay'
                      ? 'border-amber-400 bg-amber-500/15 text-white z-30 shadow-lg'
                      : 'border-amber-500/40 bg-transparent text-zinc-200 hover:border-amber-400 z-20'
                  }`}
                  title="Drag to move Top Overlay Banner"
                >
                  <span className="bg-black/80 px-2 py-0.5 rounded border border-amber-500/50 text-amber-300">
                    ▴ TOP BANNER [{topOverlay.width || 1920}×{topOverlay.height || 90}] (DRAG TO MOVE)
                  </span>
                  <div
                    onMouseDown={(e) =>
                      handleStartDrag(
                        e,
                        'top_overlay',
                        topOverlay.x || 0,
                        topOverlay.y || 0,
                        'resize',
                        topOverlay.width || 1920,
                        topOverlay.height || 90
                      )
                    }
                    className="px-1.5 py-0.5 bg-amber-400 text-black font-black text-[9px] rounded cursor-nwse-resize shadow hover:bg-amber-300"
                    title="Drag to resize Top Overlay Banner Width & Height"
                  >
                    ⤡ RESIZE
                  </div>
                </div>
              )}

              {/* LAYER 2: Bottom Banner Overlay (Click & Drag + Resize Handle) */}
              {bottomOverlay.enabled && (
                <div
                  onMouseDown={(e) =>
                    handleStartDrag(
                      e,
                      'bottom_overlay',
                      bottomOverlay.x || 0,
                      bottomOverlay.y ?? (1080 - (bottomOverlay.height || 200)),
                      'move',
                      bottomOverlay.width || 1920,
                      bottomOverlay.height || 200
                    )
                  }
                  onClick={() => selectAndNotify('bottom_overlay')}
                  style={{
                    left: `${((bottomOverlay.x || 0) / 1920) * 100}%`,
                    top: `${((bottomOverlay.y ?? (1080 - (bottomOverlay.height || 200))) / 1080) * 100}%`,
                    width: `${((bottomOverlay.width || 1920) / 1920) * 100}%`,
                    height: `${((bottomOverlay.height || 200) / 1080) * 100}%`,
                  }}
                  className={`absolute cursor-move transition-colors border-2 flex items-start justify-between p-2 text-xs font-bold ${
                    selectedLayer === 'bottom_overlay'
                      ? 'border-red-500 bg-red-600/15 text-white z-30 shadow-lg'
                      : 'border-red-500/40 bg-transparent text-zinc-200 hover:border-red-500 z-20'
                  }`}
                  title="Drag to move Bottom Overlay Banner"
                >
                  <span className="bg-black/80 px-2 py-0.5 rounded border border-red-500/60 text-[10px] text-red-300">
                    ▾ BOTTOM BANNER [{bottomOverlay.width || 1920}×{bottomOverlay.height || 200}]
                  </span>
                  <div
                    onMouseDown={(e) =>
                      handleStartDrag(
                        e,
                        'bottom_overlay',
                        bottomOverlay.x || 0,
                        bottomOverlay.y ?? (1080 - (bottomOverlay.height || 200)),
                        'resize',
                        bottomOverlay.width || 1920,
                        bottomOverlay.height || 200
                      )
                    }
                    className="px-1.5 py-0.5 bg-red-500 text-white font-black text-[9px] rounded cursor-nwse-resize shadow hover:bg-red-400"
                    title="Drag to resize Bottom Overlay Banner Width & Height"
                  >
                    ⤡ RESIZE
                  </div>
                </div>
              )}

              {/* LAYER 3A: Bottom Scrolling Ticker (Click & Drag + Resize Handles) */}
              {(g.tickerEnabled || selectedLayer === 'ticker') && (() => {
                const tickX = g.customX ?? g.tickerCustomX ?? 0;
                const tickY = g.customY ?? g.tickerCustomY ?? getBottomTickerDefaultY();
                const tickW = g.customWidth ?? g.tickerCustomWidth ?? 1920;
                const tickH = g.tickerCustomHeight || 48;
                return (
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'ticker', tickX, tickY, 'move', tickW, tickH)}
                    onClick={() => selectAndNotify('ticker')}
                    style={{
                      left: `${(tickX / 1920) * 100}%`,
                      top: `${(tickY / 1080) * 100}%`,
                      width: `${(tickW / 1920) * 100}%`,
                      height: `${Math.max(3.2, (tickH / 1080) * 100)}%`,
                    }}
                    className={`absolute cursor-move transition-colors border-2 flex items-center justify-between px-2 text-[10px] font-bold ${
                      selectedLayer === 'ticker'
                        ? 'border-cyan-400 bg-cyan-500/20 text-white z-40 shadow-lg ring-2 ring-cyan-400/50'
                        : 'border-cyan-400/60 bg-cyan-950/15 text-cyan-200 hover:border-cyan-300 z-30'
                    }`}
                    title="Click & Drag anywhere to move Bottom Ticker"
                  >
                    <span className="bg-black/90 px-2 py-0.5 rounded border border-cyan-400 text-cyan-300 font-black flex items-center gap-1 shadow">
                      ✥ ▾ BOTTOM TICKER [X:{tickX} Y:{tickY} • {tickW}×{tickH}px] (DRAG TO MOVE)
                    </span>
                    <div
                      onMouseDown={(e) => handleStartDrag(e, 'ticker', tickX, tickY, 'resize', tickW, tickH)}
                      className="px-1.5 py-0.5 bg-cyan-500 text-black font-black text-[9px] rounded cursor-nwse-resize shadow hover:bg-cyan-300"
                      title="Drag to resize Bottom Ticker Width & Height"
                    >
                      ⤡ RESIZE
                    </div>
                  </div>
                );
              })()}

              {/* LAYER 3B: Top Scrolling Ticker (Click & Drag + Resize Handles) */}
              {(g.topTickerEnabled || selectedLayer === 'top_ticker') && (() => {
                const topX = g.topTickerCustomX ?? 0;
                const topY = g.topTickerCustomY ?? getTopTickerDefaultY();
                const topW = g.topTickerCustomWidth ?? 1920;
                const topH = g.topTickerHeight || 48;
                return (
                  <div
                    onMouseDown={(e) => handleStartDrag(e, 'top_ticker', topX, topY, 'move', topW, topH)}
                    onClick={() => selectAndNotify('top_ticker')}
                    style={{
                      left: `${(topX / 1920) * 100}%`,
                      top: `${(topY / 1080) * 100}%`,
                      width: `${(topW / 1920) * 100}%`,
                      height: `${Math.max(3.2, (topH / 1080) * 100)}%`,
                    }}
                    className={`absolute cursor-move transition-colors border-2 flex items-center justify-between px-2 text-[10px] font-bold ${
                      selectedLayer === 'top_ticker'
                        ? 'border-yellow-400 bg-yellow-500/20 text-white z-40 shadow-lg ring-2 ring-yellow-400/50'
                        : 'border-yellow-400/60 bg-yellow-950/15 text-yellow-200 hover:border-yellow-300 z-30'
                    }`}
                    title="Click & Drag anywhere to move Top Ticker"
                  >
                    <span className="bg-black/90 px-2 py-0.5 rounded border border-yellow-400 text-yellow-300 font-black flex items-center gap-1 shadow">
                      ✥ ▴ TOP TICKER [X:{topX} Y:{topY} • {topW}×{topH}px] (DRAG TO MOVE)
                    </span>
                    <div
                      onMouseDown={(e) => handleStartDrag(e, 'top_ticker', topX, topY, 'resize', topW, topH)}
                      className="px-1.5 py-0.5 bg-yellow-400 text-black font-black text-[9px] rounded cursor-nwse-resize shadow hover:bg-yellow-300"
                      title="Drag to resize Top Ticker Width & Height"
                    >
                      ⤡ RESIZE
                    </div>
                  </div>
                );
              })()}

              {/* LAYER 4, 5, 6: Logos (Click & Drag + Resize Handles across all 8 sides or Full Screen) */}
              {[
                { key: 'channel_logo' as const, logo: channelLogo, label: 'CH LOGO', color: 'border-blue-400/80 text-blue-300 bg-transparent' },
                { key: 'sponsor1' as const, logo: sponsor1, label: 'SP1', color: 'border-indigo-400/80 text-indigo-300 bg-transparent' },
                { key: 'sponsor2' as const, logo: sponsor2, label: 'SP2', color: 'border-emerald-400/80 text-emerald-300 bg-transparent' },
              ].map(({ key, logo, label, color }) => {
                if (!logo.enabled) return null;
                const w = logo.fullScreen
                  ? 1920
                  : typeof logo.customWidth === 'number' && logo.customWidth >= 20
                  ? logo.customWidth
                  : (logo.size || 120) * 1.3;
                const h = logo.fullScreen
                  ? 1080
                  : typeof logo.customHeight === 'number' && logo.customHeight >= 20
                  ? logo.customHeight
                  : w * 0.48;
                const margin = 38;
                const bottomExtra = (bottomOverlay.enabled ? (bottomOverlay.height || 200) : 0) + (g.tickerEnabled ? 54 : 0);
                let baseX = 1920 - w - margin;
                let baseY = margin;
                if (logo.fullScreen) {
                  baseX = 0;
                  baseY = 0;
                } else if (logo.position === 'top-left') {
                  baseX = margin;
                  baseY = margin;
                } else if (logo.position === 'top-center') {
                  baseX = (1920 - w) / 2;
                  baseY = margin;
                } else if (logo.position === 'top-right') {
                  baseX = 1920 - w - margin;
                  baseY = margin;
                } else if (logo.position === 'middle-left') {
                  baseX = margin;
                  baseY = (1080 - bottomExtra - h) / 2;
                } else if (logo.position === 'middle-right') {
                  baseX = 1920 - w - margin;
                  baseY = (1080 - bottomExtra - h) / 2;
                } else if (logo.position === 'bottom-left') {
                  baseX = margin;
                  baseY = 1080 - h - margin - bottomExtra;
                } else if (logo.position === 'bottom-center') {
                  baseX = (1920 - w) / 2;
                  baseY = 1080 - h - margin - bottomExtra;
                } else if (logo.position === 'bottom-right') {
                  baseX = 1920 - w - margin;
                  baseY = 1080 - h - margin - bottomExtra;
                }
                const finalX = baseX + (logo.offsetX || 0);
                const finalY = baseY + (logo.offsetY || 0);

                return (
                  <div
                    key={key}
                    onMouseDown={(e) =>
                      handleStartDrag(e, key, logo.offsetX || 0, logo.offsetY || 0, 'move', w, h)
                    }
                    onClick={() => selectAndNotify(key)}
                    style={{
                      position: 'absolute',
                      left: `${(finalX / 1920) * 100}%`,
                      top: `${(finalY / 1080) * 100}%`,
                      width: `${(w / 1920) * 100}%`,
                      height: `${(h / 1080) * 100}%`,
                    }}
                    className={`cursor-move rounded transition-colors border-2 flex items-end justify-between p-0.5 ${
                      selectedLayer === key
                        ? `${color} z-30 shadow-lg`
                        : 'border-white/40 bg-transparent hover:border-white z-20'
                    }`}
                    title={`Click & Drag ${label} anywhere on screen or drag corner to resize`}
                  >
                    <span className="text-[8px] bg-black/85 text-white px-1 rounded font-bold">
                      ✥ {label} [{Math.round(w)}×{Math.round(h)}]
                    </span>
                    <div
                      onMouseDown={(e) =>
                        handleStartDrag(e, key, logo.offsetX || 0, logo.offsetY || 0, 'resize', w, h)
                      }
                      className="px-1 py-0.5 bg-blue-500 text-white font-black text-[8px] rounded cursor-nwse-resize shadow hover:bg-blue-400"
                      title={`Drag to resize ${label} Width & Height`}
                    >
                      ⤡
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Center Player Quick Layer Selector & Alignment Deck */}
      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
        {/* Layer Switcher Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-zinc-800 pb-2">
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            <button
              onClick={() => {
                setShowInteractiveBoxes(true);
                selectAndNotify('ticker');
              }}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'ticker'
                  ? 'bg-cyan-600 text-white border-cyan-400 shadow-sm'
                  : 'bg-zinc-900 text-cyan-300 border-zinc-800 hover:text-white'
              }`}
            >
              ✥ ▾ Ticker Bottom
            </button>
            <button
              onClick={() => {
                setShowInteractiveBoxes(true);
                selectAndNotify('top_ticker');
              }}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'top_ticker'
                  ? 'bg-amber-500 text-black border-amber-300 shadow-sm'
                  : 'bg-zinc-900 text-amber-300 border-zinc-800 hover:text-white'
              }`}
            >
              ✥ ▴ Ticker Top
            </button>
            <button
              onClick={() => selectAndNotify('bottom_overlay')}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'bottom_overlay'
                  ? 'bg-red-600 text-white border-red-500 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              ▾ Bottom Banner
            </button>
            <button
              onClick={() => selectAndNotify('top_overlay')}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'top_overlay'
                  ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              ▴ Top Banner
            </button>
            <button
              onClick={() => selectAndNotify('channel_logo')}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'channel_logo'
                  ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              Station Logo
            </button>
            <button
              onClick={() => selectAndNotify('sponsor1')}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'sponsor1'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              Sponsor 1
            </button>
            <button
              onClick={() => selectAndNotify('sponsor2')}
              className={`px-2 py-1 rounded font-bold border transition ${
                selectedLayer === 'sponsor2'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              Sponsor 2
            </button>
          </div>

          {/* Active Layer ON/OFF button */}
          <button
            onClick={layerInfo.toggle}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition shadow-sm ${
              layerInfo.enabled
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
            }`}
          >
            {layerInfo.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>{layerInfo.enabled ? 'ON AIR' : 'OFF'}</span>
          </button>
        </div>

        {/* Selected Layer Adjuster Deck: 1) 8-SIDE PLACE, 2) MOVE PAD, 3) 6 SIZES */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {/* Deck 1: 8-Side Place Matrix */}
          <div className="bg-black/60 p-2 rounded-lg border border-zinc-800 space-y-1.5">
            <span className="text-[9px] text-zinc-400 font-bold block uppercase truncate">
              1. CLICK 8 SIDES TO FIX PLACE ({layerInfo.title})
            </span>
            {selectedLayer === 'channel_logo' || selectedLayer === 'sponsor1' || selectedLayer === 'sponsor2' ? (
              <div className="grid grid-cols-3 gap-1 text-[9px]">
                {(
                  [
                    ['top-left', '↖ Top-L'],
                    ['top-center', '↑ Top-C'],
                    ['top-right', '↗ Top-R'],
                    ['middle-left', '← Mid-L'],
                    ['middle-right', '→ Mid-R'],
                    ['bottom-left', '↙ Bot-L'],
                    ['bottom-center', '↓ Bot-C'],
                    ['bottom-right', '↘ Bot-R'],
                  ] as const
                ).map(([pos, lbl]) => {
                  const targetKey =
                    selectedLayer === 'channel_logo'
                      ? 'channel'
                      : selectedLayer === 'sponsor1'
                      ? 'sponsor1'
                      : 'sponsor2';
                  const curLogo =
                    selectedLayer === 'channel_logo'
                      ? channelLogo
                      : selectedLayer === 'sponsor1'
                      ? sponsor1
                      : sponsor2;
                  return (
                    <button
                      key={pos}
                      onClick={() =>
                        onUpdateLogo(targetKey, {
                          enabled: true,
                          position: pos,
                          offsetX: 0,
                          offsetY: 0,
                        })
                      }
                      className={`py-1 rounded border font-bold transition ${
                        curLogo.position === pos && (curLogo.offsetX || 0) === 0 && (curLogo.offsetY || 0) === 0
                          ? 'bg-blue-600 text-white border-blue-400'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    const targetKey =
                      selectedLayer === 'channel_logo'
                        ? 'channel'
                        : selectedLayer === 'sponsor1'
                        ? 'sponsor1'
                        : 'sponsor2';
                    onUpdateLogo(targetKey, { offsetX: 0, offsetY: 0 });
                  }}
                  className="py-1 rounded border font-bold bg-zinc-900 text-amber-400 border-zinc-700 hover:text-white"
                >
                  🎯 0,0
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <button
                  onClick={handleSnapLeft}
                  className="flex items-center justify-center gap-1 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 font-bold"
                >
                  <AlignLeft className="w-3 h-3 text-emerald-400" />
                  <span>Fix Left</span>
                </button>
                <button
                  onClick={handleSnapRight}
                  className="flex items-center justify-center gap-1 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 font-bold"
                >
                  <AlignRight className="w-3 h-3 text-emerald-400" />
                  <span>Fix Right</span>
                </button>
                <button
                  onClick={handleSnapTop}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 font-bold"
                >
                  Fix Top
                </button>
                <button
                  onClick={handleSnapBottom}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700 font-bold"
                >
                  Fix Bottom
                </button>
              </div>
            )}
          </div>

          {/* Deck 2: Directional Move Pad (Left, Right, Top, Bottom + Click & Drag) */}
          <div className="bg-black/60 p-2 rounded-lg border border-zinc-800 flex flex-col items-center justify-between">
            <span className="text-[9px] text-zinc-400 font-bold block uppercase w-full">
              2. CLICK & MOVE ACCESS (STEP: {step}PX)
            </span>

            <div className="flex flex-col items-center gap-1 py-0.5">
              <button
                onClick={() => handleNudge(0, -step)}
                className="p-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700"
                title="Move Up"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleNudge(-step, 0)}
                  className="p-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700"
                  title="Move Left"
                >
                  <ArrowDown className="w-3 h-3 -rotate-90" />
                </button>
                <div className="px-2 py-0.5 bg-black rounded border border-zinc-800 text-[9px] font-bold text-center text-zinc-300">
                  X:{layerInfo.x} Y:{layerInfo.y}
                </div>
                <button
                  onClick={() => handleNudge(step, 0)}
                  className="p-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700"
                  title="Move Right"
                >
                  <ArrowDown className="w-3 h-3 rotate-90" />
                </button>
              </div>
              <button
                onClick={() => handleNudge(0, step)}
                className="p-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 rounded border border-zinc-700"
                title="Move Down"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>

            <span className="text-[8px] text-emerald-400 font-bold">
              ✓ Click & Drag directly on HD Player
            </span>
          </div>

          {/* Deck 3: 6 Quick Sizes + Full Screen 1920x1080 & Fine Size Adjust */}
          <div className="bg-black/60 p-2 rounded-lg border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-zinc-400 font-bold uppercase">
                3. RESIZE &amp; FULL SCREEN ({layerInfo.w}×{layerInfo.h})
              </span>
              <button
                type="button"
                onClick={() => {
                  if (selectedLayer === 'channel_logo' || selectedLayer === 'sponsor1' || selectedLayer === 'sponsor2') {
                    const targetKey =
                      selectedLayer === 'channel_logo'
                        ? 'channel'
                        : selectedLayer === 'sponsor1'
                        ? 'sponsor1'
                        : 'sponsor2';
                    onUpdateLogo(targetKey, {
                      enabled: true,
                      fullScreen: true,
                      customWidth: 1920,
                      customHeight: 1080,
                      size: 1920,
                      offsetX: 0,
                      offsetY: 0,
                    });
                  } else if (selectedLayer === 'bottom_overlay') {
                    onUpdateBottomOverlay({ enabled: true, width: 1920, height: 1080, x: 0, y: 0 });
                  } else if (selectedLayer === 'top_overlay') {
                    onUpdateTopOverlay({ enabled: true, width: 1920, height: 1080, x: 0, y: 0 });
                  } else if (selectedLayer === 'ticker') {
                    onUpdateGraphics({
                      tickerEnabled: true,
                      customWidth: 1920,
                      tickerCustomWidth: 1920,
                      tickerCustomHeight: 1080,
                      customX: 0,
                      customY: 0,
                    });
                  } else if (selectedLayer === 'top_ticker') {
                    onUpdateGraphics({
                      topTickerEnabled: true,
                      topTickerCustomWidth: 1920,
                      topTickerHeight: 1080,
                      topTickerCustomX: 0,
                      topTickerCustomY: 0,
                    });
                  }
                }}
                className="px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-black text-[8px] shadow cursor-pointer"
                title="Resize Selected Graphic to Full Screen 1920x1080"
              >
                ⛶ FULL 1080P
              </button>
            </div>

            {selectedLayer === 'channel_logo' || selectedLayer === 'sponsor1' || selectedLayer === 'sponsor2' ? (
              <div className="grid grid-cols-3 gap-1 text-[9px]">
                {[
                  { label: '1:Mini(65)', size: 65, w: 85, h: 48 },
                  { label: '2:Sml(90)', size: 90, w: 120, h: 68 },
                  { label: '3:Med(115)', size: 115, w: 155, h: 88 },
                  { label: '4:Lrg(145)', size: 145, w: 210, h: 118 },
                  { label: '5:XL(260)', size: 260, w: 360, h: 200 },
                  { label: '6:Big(520)', size: 520, w: 680, h: 380 },
                ].map((p) => {
                  const targetKey =
                    selectedLayer === 'channel_logo'
                      ? 'channel'
                      : selectedLayer === 'sponsor1'
                      ? 'sponsor1'
                      : 'sponsor2';
                  return (
                    <button
                      key={p.size}
                      onClick={() =>
                        onUpdateLogo(targetKey, {
                          fullScreen: false,
                          size: p.size,
                          customWidth: p.w,
                          customHeight: p.h,
                        })
                      }
                      className={`py-1 rounded border font-bold transition ${
                        layerInfo.w === p.w || layerInfo.w === p.size
                          ? 'bg-blue-600 text-white border-blue-400'
                          : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <div className="text-[9px] text-zinc-400 mb-0.5 flex items-center justify-between">
                  <span>WIDTH:</span>
                  <span className="text-white font-bold">{layerInfo.w} PX</span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[9px]">
                  <button
                    onClick={() => handleSizeDelta(-50, 0)}
                    className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                  >
                    -50
                  </button>
                  <button
                    onClick={() => handleSizeDelta(-10, 0)}
                    className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                  >
                    -10
                  </button>
                  <button
                    onClick={() => handleSizeDelta(10, 0)}
                    className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                  >
                    +10
                  </button>
                  <button
                    onClick={() => handleSizeDelta(50, 0)}
                    className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                  >
                    +50
                  </button>
                </div>
              </div>
            )}

            <div className="pt-1 border-t border-zinc-800">
              <div className="text-[9px] text-zinc-400 mb-0.5 flex items-center justify-between">
                <span>FINE SIZE / HEIGHT:</span>
                <span className="text-white font-bold">{layerInfo.w}W × {layerInfo.h}H</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[9px]">
                <button
                  onClick={() => handleSizeDelta(-20, -20)}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                >
                  -20
                </button>
                <button
                  onClick={() => handleSizeDelta(-10, -10)}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                >
                  -10
                </button>
                <button
                  onClick={() => handleSizeDelta(10, 10)}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                >
                  +10
                </button>
                <button
                  onClick={() => handleSizeDelta(20, 20)}
                  className="py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded border border-zinc-800"
                >
                  +20
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
