import React from 'react';
import {
  ArrowUp,
  ArrowDown,
  AlignLeft,
  AlignRight,
  Eye,
  EyeOff,
  Maximize2,
  Move,
  Sliders,
  Sparkles,
  Layers,
  Tag,
  Image as ImageIcon,
  Layout,
  RotateCcw
} from 'lucide-react';
import {
  TVChannel,
  BottomScrollConfig,
  OverlayBannerConfig,
  LShapeConfig,
  LogoItemConfig,
  LogoCornerPosition,
  OverlayFitMode
} from '../types/playout';
import { createLShapeGraphicSvg } from '../utils/defaultOverlays';
import { LSHAPE_TIME_OPTIONS } from './LShapeStudioPanel';

export type StudioActiveLayer =
  | 'lshape'
  | 'crawler'
  | 'logos'
  | 'bottom_overlay'
  | 'top_overlay'
  | 'clock';
export type StudioFocusTab = StudioActiveLayer | 'overlay';

interface CGLeftControlPanelProps {
  channel: TVChannel;
  activeLayer?: StudioActiveLayer;
  onSelectLayer?: (layer: StudioActiveLayer) => void;
  activeTab?: StudioFocusTab;
  setActiveTab?: (tab: any) => void;
  selectedLogoTab: 'channel' | 'sponsor1' | 'sponsor2';
  onSelectLogoTab?: (tab: 'channel' | 'sponsor1' | 'sponsor2') => void;
  setSelectedLogoTab?: (tab: 'channel' | 'sponsor1' | 'sponsor2') => void;
  selectedOverlaySubTab?: 'bottom' | 'top';
  setSelectedOverlaySubTab?: (tab: 'bottom' | 'top') => void;
  nudgeDelta?: 1 | 10 | 50;
  onChangeNudgeDelta?: (delta: 1 | 10 | 50) => void;
  lShape: LShapeConfig;
  bottomOverlay: OverlayBannerConfig;
  topOverlay: OverlayBannerConfig;
  channelLogo: LogoItemConfig;
  sponsor1: LogoItemConfig;
  sponsor2: LogoItemConfig;
  onUpdateGraphics: (partial: Partial<BottomScrollConfig>) => void;
  onUpdateLShape: (partial: Partial<LShapeConfig>) => void;
  onUpdateBottomOverlay: (partial: Partial<OverlayBannerConfig>) => void;
  onUpdateTopOverlay: (partial: Partial<OverlayBannerConfig>) => void;
  onUpdateLogo: (type: 'channel' | 'sponsor1' | 'sponsor2', partial: Partial<LogoItemConfig>) => void;
}

export const CGLeftControlPanel: React.FC<CGLeftControlPanelProps> = ({
  channel,
  activeLayer,
  onSelectLayer,
  activeTab,
  setActiveTab,
  selectedLogoTab,
  onSelectLogoTab,
  setSelectedLogoTab,
  selectedOverlaySubTab: propOverlaySubTab,
  setSelectedOverlaySubTab,
  lShape,
  bottomOverlay,
  topOverlay,
  channelLogo,
  sponsor1,
  sponsor2,
  onUpdateGraphics,
  onUpdateLShape,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUpdateLogo,
}) => {
  const currentLayer: StudioActiveLayer =
    activeLayer
      ? activeLayer
      : activeTab === 'overlay'
      ? propOverlaySubTab === 'top'
        ? 'top_overlay'
        : 'bottom_overlay'
      : 'bottom_overlay';

  const handleSelectLayer = (layer: StudioActiveLayer) => {
    if (onSelectLayer) onSelectLayer(layer);
    if (setActiveTab) setActiveTab(layer);
  };

  const handleSelectLogo = (tab: 'channel' | 'sponsor1' | 'sponsor2') => {
    if (onSelectLogoTab) onSelectLogoTab(tab);
    if (setSelectedLogoTab) setSelectedLogoTab(tab);
  };

  const selectedOverlaySubTab: 'bottom' | 'top' =
    currentLayer === 'top_overlay' ? 'top' : propOverlaySubTab || 'bottom';

  const g = channel.graphics;
  const activeLogo =
    selectedLogoTab === 'channel'
      ? channelLogo
      : selectedLogoTab === 'sponsor1'
      ? sponsor1
      : sponsor2;
  const currentOverlay = selectedOverlaySubTab === 'top' ? topOverlay : bottomOverlay;
  const updateCurrentOverlay =
    selectedOverlaySubTab === 'top' ? onUpdateTopOverlay : onUpdateBottomOverlay;

  // Switch L-Shape Side (Left or Right) and regenerate SVG templates for that side
  const handleSetLShapeSide = (side: 'left' | 'right') => {
    const updatedPlaylist = (lShape.playlist || []).map((item) => {
      if (item.url?.startsWith('data:image/svg+xml')) {
        return {
          ...item,
          url: createLShapeGraphicSvg(
            channel.id,
            channel.colorAccent,
            side,
            item.title,
            item.price || '₹999 ONLY',
            item.phone || '0427-2444555'
          ),
        };
      }
      return item;
    });
    onUpdateLShape({ side, playlist: updatedPlaylist });
  };

  return (
    <div className="space-y-2.5 text-xs font-mono">
      {/* 1. MASTER ON-AIR GRAPHIC LAYERS SWITCHBOARD */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
          <span className="text-[11px] font-black text-white uppercase flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-red-500" />
            <span>ON-AIR GRAPHIC LAYERS</span>
          </span>
          <span className="text-[9px] text-zinc-400">Click to Fix & Toggle</span>
        </div>

        <div className="space-y-1">
          {/* Layer 1: Channel Logo */}
          <div
            onClick={() => {
              handleSelectLayer('logos');
              handleSelectLogo('channel');
            }}
            className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
              currentLayer === 'logos' && selectedLogoTab === 'channel'
                ? 'bg-blue-950/40 border-blue-500 text-white'
                : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <ImageIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold truncate text-[11px]">
                Playout Channel Logo ({channelLogo.position})
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateLogo('channel', { enabled: !channelLogo.enabled });
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-black transition ${
                channelLogo.enabled
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
              }`}
            >
              {channelLogo.enabled ? 'ON AIR' : 'OFF'}
            </button>
          </div>

          {/* Layer 3: Sponsor 1 & 2 Logos */}
          <div className="grid grid-cols-2 gap-1">
            <div
              onClick={() => {
                handleSelectLayer('logos');
                handleSelectLogo('sponsor1');
              }}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'logos' && selectedLogoTab === 'sponsor1'
                  ? 'bg-indigo-950/40 border-indigo-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">Sponsor 1</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLogo('sponsor1', { enabled: !sponsor1.enabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  sponsor1.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {sponsor1.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div
              onClick={() => {
                handleSelectLayer('logos');
                handleSelectLogo('sponsor2');
              }}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'logos' && selectedLogoTab === 'sponsor2'
                  ? 'bg-emerald-950/40 border-emerald-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">Sponsor 2</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLogo('sponsor2', { enabled: !sponsor2.enabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  sponsor2.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {sponsor2.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Layer 4: Bottom & Top Overlays */}
          <div className="grid grid-cols-2 gap-1">
            <div
              onClick={() => {
                handleSelectLayer('bottom_overlay');
                if (setSelectedOverlaySubTab) setSelectedOverlaySubTab('bottom');
              }}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'bottom_overlay'
                  ? 'bg-red-950/40 border-red-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">▾ Bot 1920×200</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateBottomOverlay({ enabled: !bottomOverlay.enabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  bottomOverlay.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {bottomOverlay.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div
              onClick={() => {
                handleSelectLayer('top_overlay');
                if (setSelectedOverlaySubTab) setSelectedOverlaySubTab('top');
              }}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'top_overlay'
                  ? 'bg-amber-950/40 border-amber-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">▴ Top Banner</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateTopOverlay({ enabled: !topOverlay.enabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  topOverlay.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {topOverlay.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Layer 5: Ticker Bottom & Ticker Top */}
          <div className="grid grid-cols-2 gap-1">
            <div
              onClick={() => handleSelectLayer('crawler')}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'crawler'
                  ? 'bg-cyan-950/40 border-cyan-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">▾ Ticker Bottom</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateGraphics({ tickerEnabled: !g.tickerEnabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  g.tickerEnabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {g.tickerEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div
              onClick={() => handleSelectLayer('crawler')}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'crawler'
                  ? 'bg-amber-950/40 border-amber-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">▴ Ticker Top</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateGraphics({ topTickerEnabled: !g.topTickerEnabled });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  g.topTickerEnabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {g.topTickerEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Layer 6: L-Shape & Clock CG */}
          <div className="grid grid-cols-2 gap-1">
            <div
              onClick={() => handleSelectLayer('lshape')}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'lshape'
                  ? 'bg-purple-950/40 border-purple-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">◱ L-Shape CG</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLShape({ enabled: !lShape.enabled, isPlaying: true, periodicActive: true });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  lShape.enabled ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {lShape.enabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div
              onClick={() => handleSelectLayer('clock')}
              className={`flex items-center justify-between p-1.5 rounded border cursor-pointer transition ${
                currentLayer === 'clock'
                  ? 'bg-yellow-950/40 border-yellow-500 text-white'
                  : 'bg-black/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <span className="font-bold truncate text-[10px]">🕒 Clock CG</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateGraphics({ clockEnabled: !(g.clockEnabled !== false) });
                }}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                  g.clockEnabled !== false ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {g.clockEnabled !== false ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 2. CONTEXTUAL PLACEMENT, SIDE, SIZE (SMALL/BIG) & FIT CONTROLLER  */}
      {/* ================================================================= */}

      {/* B) WHEN LOGOS IS SELECTED (8-SIDE PLACE + 6 LOGO SIZES + CLICK & MOVE) */}
      {currentLayer === 'logos' && (
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-black text-blue-400 text-[11px] uppercase">
              8-SIDE LOGO PLACE & 6 SIZES
            </span>
            <span className="text-[10px] text-zinc-400">{activeLogo.size || 120}px</span>
          </div>

          {/* Select which Logo */}
          <div className="grid grid-cols-3 gap-1">
            {(['channel', 'sponsor1', 'sponsor2'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleSelectLogo(t)}
                className={`py-1 rounded font-bold border text-[10px] ${
                  selectedLogoTab === t
                    ? 'bg-blue-600 text-white border-blue-400'
                    : 'bg-black text-zinc-400 border-zinc-800'
                }`}
              >
                {t === 'channel' ? 'CH LOGO' : t === 'sponsor1' ? 'SPONSOR 1' : 'SPONSOR 2'}
              </button>
            ))}
          </div>

          {/* 8-SIDE POSITION QUICK FIX MATRIX */}
          <div>
            <label className="text-[10px] text-zinc-400 font-bold block mb-1">
              1. CLICK ANY OF 8 SIDES TO FIX PLACE:
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ['top-left', '↖ TOP-LEFT'],
                  ['top-center', '↑ TOP-CENTER'],
                  ['top-right', '↗ TOP-RIGHT'],
                  ['middle-left', '← MID-LEFT'],
                  ['middle-right', '→ MID-RIGHT'],
                  ['bottom-left', '↙ BOT-LEFT'],
                  ['bottom-center', '↓ BOT-CENTER'],
                  ['bottom-right', '↘ BOT-RIGHT'],
                ] as [LogoCornerPosition, string][]
              ).map(([pos, label]) => (
                <button
                  key={pos}
                  onClick={() =>
                    onUpdateLogo(selectedLogoTab, {
                      enabled: true,
                      position: pos,
                      offsetX: 0,
                      offsetY: 0,
                    })
                  }
                  className={`py-1.5 px-1 rounded font-bold border text-[9px] transition ${
                    activeLogo.position === pos && (activeLogo.offsetX || 0) === 0 && (activeLogo.offsetY || 0) === 0
                      ? 'bg-blue-600 text-white border-blue-400 shadow-xs'
                      : activeLogo.position === pos
                      ? 'bg-blue-950/70 text-blue-300 border-blue-600'
                      : 'bg-black text-zinc-300 border-zinc-800 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => onUpdateLogo(selectedLogoTab, { offsetX: 0, offsetY: 0 })}
                className="py-1.5 px-1 rounded font-bold border text-[9px] bg-zinc-900 text-amber-400 border-zinc-700 hover:text-white"
                title="Reset move offsets to exact snapped side"
              >
                🎯 SNAP 0,0
              </button>
            </div>
          </div>

          {/* LOGO & SPONSOR RESIZE OPTIONS (UP TO FULL SCREEN 1920x1080) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-zinc-300 font-bold">
                2. RESIZE LOGO / SPONSOR (UP TO FULL SCREEN):
              </label>
              <span className="text-[10px] font-black text-emerald-400">
                {activeLogo.fullScreen
                  ? 'FULL SCREEN (1920×1080)'
                  : `${activeLogo.customWidth || activeLogo.size || 120}×${activeLogo.customHeight || 'Auto'}px`}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: 'MINI (65)', w: 65, h: 0, fs: false },
                { label: 'SMALL (115)', w: 115, h: 0, fs: false },
                { label: 'MED (180)', w: 180, h: 0, fs: false },
                { label: 'LARGE (320)', w: 320, h: 0, fs: false },
                { label: 'HALF (960)', w: 960, h: 540, fs: false },
                { label: 'FULL SCREEN', w: 1920, h: 1080, fs: true },
              ].map((preset) => {
                const isSelected = preset.fs
                  ? Boolean(activeLogo.fullScreen)
                  : !activeLogo.fullScreen &&
                    (activeLogo.customWidth || activeLogo.size || 115) === preset.w;
                return (
                  <button
                    key={preset.label}
                    onClick={() =>
                      onUpdateLogo(selectedLogoTab, {
                        enabled: true,
                        size: preset.w,
                        customWidth: preset.w,
                        customHeight: preset.h > 0 ? preset.h : undefined,
                        fullScreen: preset.fs,
                        fitMode: preset.fs ? 'fill' : activeLogo.fitMode || 'contain',
                        offsetX: preset.fs ? 0 : activeLogo.offsetX || 0,
                        offsetY: preset.fs ? 0 : activeLogo.offsetY || 0,
                      })
                    }
                    className={`py-1.5 px-1 rounded border font-bold text-[9px] transition cursor-pointer ${
                      isSelected
                        ? preset.fs
                          ? 'bg-emerald-600 text-white border-emerald-400 shadow'
                          : 'bg-blue-600 text-white border-blue-400 shadow-xs'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Custom Width Slider (30px to 1920px Full Screen) */}
            <div className="bg-black/60 p-2 rounded border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400 font-bold">WIDTH (PX):</span>
                <span className="text-blue-400 font-black">
                  {activeLogo.fullScreen ? 1920 : activeLogo.customWidth || activeLogo.size || 120}px
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="1920"
                value={activeLogo.fullScreen ? 1920 : activeLogo.customWidth || activeLogo.size || 120}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateLogo(selectedLogoTab, {
                    enabled: true,
                    size: val,
                    customWidth: val,
                    fullScreen: val >= 1900 && (activeLogo.customHeight || 0) >= 1060,
                  });
                }}
                className="w-full accent-blue-500"
              />
            </div>

            {/* Custom Height Slider (0 Auto to 1080px Full Screen) */}
            <div className="bg-black/60 p-2 rounded border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400 font-bold">HEIGHT (PX):</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-400 font-black">
                    {activeLogo.fullScreen
                      ? '1080px'
                      : activeLogo.customHeight
                      ? `${activeLogo.customHeight}px`
                      : 'Auto Aspect'}
                  </span>
                  {activeLogo.customHeight ? (
                    <button
                      onClick={() =>
                        onUpdateLogo(selectedLogoTab, {
                          customHeight: undefined,
                          fullScreen: false,
                        })
                      }
                      className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300 hover:bg-zinc-700"
                    >
                      Auto
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="1080"
                value={activeLogo.fullScreen ? 1080 : activeLogo.customHeight || 0}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  onUpdateLogo(selectedLogoTab, {
                    enabled: true,
                    customHeight: val > 0 ? val : undefined,
                    fullScreen: (activeLogo.customWidth || activeLogo.size || 120) >= 1900 && val >= 1060,
                  });
                }}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          {/* Move / Nudge Pad */}
          <div className="pt-1 border-t border-zinc-800">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <span>MOVE ACCESS (X:{activeLogo.offsetX || 0}, Y:{activeLogo.offsetY || 0})</span>
              <button
                onClick={() => onUpdateLogo(selectedLogoTab, { offsetX: 0, offsetY: 0 })}
                className="text-blue-400 hover:underline flex items-center gap-0.5"
              >
                <RotateCcw className="w-2.5 h-2.5" /> Reset
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button
                onClick={() =>
                  onUpdateLogo(selectedLogoTab, { offsetX: (activeLogo.offsetX || 0) - 10 })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
              >
                ⬅ Left
              </button>
              <button
                onClick={() =>
                  onUpdateLogo(selectedLogoTab, { offsetY: (activeLogo.offsetY || 0) - 10 })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
              >
                ⬆ Up
              </button>
              <button
                onClick={() =>
                  onUpdateLogo(selectedLogoTab, { offsetY: (activeLogo.offsetY || 0) + 10 })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
              >
                ⬇ Down
              </button>
              <button
                onClick={() =>
                  onUpdateLogo(selectedLogoTab, { offsetX: (activeLogo.offsetX || 0) + 10 })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
              >
                ➡ Right
              </button>
            </div>
          </div>
        </div>
      )}

      {/* C) WHEN TOP OR BOTTOM OVERLAY BANNER IS SELECTED */}
      {(currentLayer === 'bottom_overlay' || currentLayer === 'top_overlay') && (
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => {
                handleSelectLayer('bottom_overlay');
                if (setSelectedOverlaySubTab) setSelectedOverlaySubTab('bottom');
              }}
              className={`py-1.5 rounded font-bold border text-[10px] ${
                selectedOverlaySubTab === 'bottom'
                  ? 'bg-red-600 text-white border-red-400'
                  : 'bg-black text-zinc-400 border-zinc-800'
              }`}
            >
              ▾ BOTTOM SCROLL BANNER
            </button>
            <button
              onClick={() => {
                handleSelectLayer('top_overlay');
                if (setSelectedOverlaySubTab) setSelectedOverlaySubTab('top');
              }}
              className={`py-1.5 rounded font-bold border text-[10px] ${
                selectedOverlaySubTab === 'top'
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-black text-zinc-400 border-zinc-800'
              }`}
            >
              ▴ TOP SCROLL BANNER
            </button>
          </div>

          {/* Quick Place & Size Presets (Including Full Screen 1920x1080) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-zinc-300 font-bold">
                RESIZE SCROLL BANNER (UP TO FULL SCREEN):
              </label>
              <span className="text-[10px] font-black text-amber-400">
                {currentOverlay.width || 1920}×{currentOverlay.height || 200}px
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: 'Small (110H)', w: 1920, h: 110 },
                { label: 'Med (200H)', w: 1920, h: 200 },
                { label: 'Big (320H)', w: 1920, h: 320 },
                { label: 'Half (540H)', w: 1920, h: 540 },
                { label: 'Box (800×450)', w: 800, h: 450 },
                { label: 'FULL SCREEN', w: 1920, h: 1080 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() =>
                    updateCurrentOverlay({
                      enabled: true,
                      width: p.w,
                      height: p.h,
                      x: p.w === 1920 ? 0 : currentOverlay.x || 0,
                      y:
                        p.h === 1080
                          ? 0
                          : selectedOverlaySubTab === 'top'
                          ? 0
                          : Math.max(0, 1080 - p.h),
                    })
                  }
                  className={`py-1.5 px-1 rounded border font-bold text-[9px] transition cursor-pointer ${
                    (currentOverlay.width || 1920) === p.w &&
                    (currentOverlay.height || 200) === p.h
                      ? 'bg-emerald-600 text-white border-emerald-400'
                      : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Banner Width & Height Sliders */}
            <div className="bg-black/60 p-2 rounded border border-zinc-800 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400 font-bold">BANNER WIDTH:</span>
                <span className="text-cyan-400 font-black">{currentOverlay.width || 1920}px</span>
              </div>
              <input
                type="range"
                min="100"
                max="1920"
                value={currentOverlay.width || 1920}
                onChange={(e) =>
                  updateCurrentOverlay({ width: parseInt(e.target.value, 10) })
                }
                className="w-full accent-cyan-500"
              />
              <div className="flex items-center justify-between text-[10px] pt-1">
                <span className="text-zinc-400 font-bold">BANNER HEIGHT:</span>
                <span className="text-amber-400 font-black">{currentOverlay.height || 200}px</span>
              </div>
              <input
                type="range"
                min="40"
                max="1080"
                value={currentOverlay.height || 200}
                onChange={(e) => {
                  const nextH = parseInt(e.target.value, 10);
                  updateCurrentOverlay({
                    height: nextH,
                    y:
                      selectedOverlaySubTab === 'top'
                        ? Math.min(1080 - nextH, currentOverlay.y || 0)
                        : Math.max(0, 1080 - nextH),
                  });
                }}
                className="w-full accent-amber-500"
              />
            </div>

            <button
              onClick={() =>
                updateCurrentOverlay({
                  squeezeProgramVideo: !currentOverlay.squeezeProgramVideo,
                })
              }
              className={`w-full py-1.5 px-2 rounded font-bold border flex items-center justify-between text-[10px] transition ${
                currentOverlay.squeezeProgramVideo
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
              }`}
            >
              <span>SHRINK MAIN VIDEO FOR OVERLAY:</span>
              <span>{currentOverlay.squeezeProgramVideo ? 'YES (SMALL ➔ BIG)' : 'OVERLAY ON TOP'}</span>
            </button>
          </div>

          {/* Nudge & Fit */}
          <div className="grid grid-cols-4 gap-1">
            <button
              onClick={() => updateCurrentOverlay({ x: (currentOverlay.x || 0) - 10 })}
              className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
            >
              ⬅ Left
            </button>
            <button
              onClick={() => updateCurrentOverlay({ y: Math.max(0, (currentOverlay.y ?? 880) - 10) })}
              className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
            >
              ⬆ Up
            </button>
            <button
              onClick={() => updateCurrentOverlay({ y: Math.min(1040, (currentOverlay.y ?? 880) + 10) })}
              className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
            >
              ⬇ Down
            </button>
            <button
              onClick={() => updateCurrentOverlay({ x: (currentOverlay.x || 0) + 10 })}
              className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold"
            >
              ➡ Right
            </button>
          </div>
        </div>
      )}

      {/* D) WHEN TICKER TOP & BOTTOM IS SELECTED */}
      {currentLayer === 'crawler' && (
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-black text-cyan-400 text-[11px] uppercase">
              TICKER TOP &amp; BOTTOM RESIZE &amp; SPEED
            </span>
          </div>

          {/* Bottom Ticker Resize */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-zinc-300 font-bold block">
              1. BOTTOM TICKER RESIZE ({g.customWidth ?? g.tickerCustomWidth ?? 1920}×{g.tickerCustomHeight || 48}px):
            </label>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'SMALL (36)', h: 36, f: 18 },
                { label: 'MED (50)', h: 50, f: 24 },
                { label: 'BIG (80)', h: 80, f: 36 },
                { label: 'FULL (1080)', h: 1080, f: 64 },
              ].map((p) => (
                <button
                  key={p.h}
                  onClick={() =>
                    onUpdateGraphics({
                      tickerEnabled: true,
                      tickerCustomHeight: p.h,
                      tickerFontSize: p.f,
                      customY: p.h === 1080 ? 0 : undefined,
                      tickerCustomY: p.h === 1080 ? 0 : undefined,
                    })
                  }
                  className={`py-1.5 rounded font-bold border text-[9px] ${
                    (g.tickerCustomHeight || 50) === p.h
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-black text-zinc-300 border-zinc-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-black/50 p-1.5 rounded border border-zinc-800">
              <div>
                <span className="text-[9px] text-zinc-400 block">Width: {g.customWidth ?? g.tickerCustomWidth ?? 1920}px</span>
                <input
                  type="range"
                  min={200}
                  max={1920}
                  value={g.customWidth ?? g.tickerCustomWidth ?? 1920}
                  onChange={(e) => {
                    const w = Number(e.target.value);
                    onUpdateGraphics({ customWidth: w, tickerCustomWidth: w });
                  }}
                  className="w-full accent-cyan-500"
                />
              </div>
              <div>
                <span className="text-[9px] text-zinc-400 block">Height: {g.tickerCustomHeight || 48}px</span>
                <input
                  type="range"
                  min={28}
                  max={1080}
                  value={g.tickerCustomHeight || 48}
                  onChange={(e) =>
                    onUpdateGraphics({ tickerCustomHeight: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Top Ticker Resize */}
          <div className="space-y-1.5">
            <label className="text-[10px] text-zinc-300 font-bold block">
              2. TOP TICKER RESIZE ({g.topTickerCustomWidth ?? 1920}×{g.topTickerHeight || 48}px):
            </label>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'SMALL (36)', h: 36, f: 18 },
                { label: 'MED (50)', h: 50, f: 24 },
                { label: 'BIG (80)', h: 80, f: 36 },
                { label: 'FULL (1080)', h: 1080, f: 64 },
              ].map((p) => (
                <button
                  key={p.h}
                  onClick={() =>
                    onUpdateGraphics({
                      topTickerEnabled: true,
                      topTickerHeight: p.h,
                      topTickerFontSize: p.f,
                      topTickerCustomY: p.h === 1080 ? 0 : undefined,
                    })
                  }
                  className={`py-1.5 rounded font-bold border text-[9px] ${
                    (g.topTickerHeight || 50) === p.h
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-black text-zinc-300 border-zinc-800'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-black/50 p-1.5 rounded border border-zinc-800">
              <div>
                <span className="text-[9px] text-zinc-400 block">Width: {g.topTickerCustomWidth ?? 1920}px</span>
                <input
                  type="range"
                  min={200}
                  max={1920}
                  value={g.topTickerCustomWidth ?? 1920}
                  onChange={(e) =>
                    onUpdateGraphics({ topTickerCustomWidth: Number(e.target.value) })
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <span className="text-[9px] text-zinc-400 block">Height: {g.topTickerHeight || 48}px</span>
                <input
                  type="range"
                  min={28}
                  max={1080}
                  value={g.topTickerHeight || 48}
                  onChange={(e) =>
                    onUpdateGraphics({ topTickerHeight: Number(e.target.value) })
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Bottom Ticker Move & Position */}
          <div className="bg-black/60 p-2 rounded border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-cyan-300 font-black">▾ MOVE BOTTOM TICKER:</span>
              <span className="text-zinc-400 font-mono">
                X:{g.customX ?? g.tickerCustomX ?? 0} Y:{g.customY ?? g.tickerCustomY ?? Math.max(0, 1080 - (g.tickerCustomHeight || 48) - (bottomOverlay.enabled ? bottomOverlay.height || 200 : 0))}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1 text-[9px] font-bold">
              <button
                onClick={() => {
                  const curY =
                    g.customY ??
                    g.tickerCustomY ??
                    Math.max(0, 1080 - (g.tickerCustomHeight || 48) - (bottomOverlay.enabled ? bottomOverlay.height || 200 : 0));
                  const nextY = Math.max(0, curY - 10);
                  onUpdateGraphics({ tickerPosition: 'custom', customY: nextY, tickerCustomY: nextY });
                }}
                className="py-1 bg-zinc-900 hover:bg-cyan-900/60 rounded border border-zinc-700 text-cyan-300"
              >
                ⬆ Up
              </button>
              <button
                onClick={() => {
                  const curY =
                    g.customY ??
                    g.tickerCustomY ??
                    Math.max(0, 1080 - (g.tickerCustomHeight || 48) - (bottomOverlay.enabled ? bottomOverlay.height || 200 : 0));
                  const nextY = Math.min(1080 - (g.tickerCustomHeight || 48), curY + 10);
                  onUpdateGraphics({ tickerPosition: 'custom', customY: nextY, tickerCustomY: nextY });
                }}
                className="py-1 bg-zinc-900 hover:bg-cyan-900/60 rounded border border-zinc-700 text-cyan-300"
              >
                ⬇ Down
              </button>
              <button
                onClick={() => {
                  const curX = g.customX ?? g.tickerCustomX ?? 0;
                  const nextX = Math.max(0, curX - 20);
                  onUpdateGraphics({ tickerPosition: 'custom', customX: nextX, tickerCustomX: nextX });
                }}
                className="py-1 bg-zinc-900 hover:bg-cyan-900/60 rounded border border-zinc-700 text-cyan-300"
              >
                ⬅ Left
              </button>
              <button
                onClick={() => {
                  const curX = g.customX ?? g.tickerCustomX ?? 0;
                  const nextX = Math.min(1800, curX + 20);
                  onUpdateGraphics({ tickerPosition: 'custom', customX: nextX, tickerCustomX: nextX });
                }}
                className="py-1 bg-zinc-900 hover:bg-cyan-900/60 rounded border border-zinc-700 text-cyan-300"
              >
                ➡ Right
              </button>
              <button
                onClick={() =>
                  onUpdateGraphics({
                    customX: undefined,
                    customY: undefined,
                    customWidth: 1920,
                    tickerCustomX: undefined,
                    tickerCustomY: undefined,
                    tickerCustomWidth: 1920,
                  })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 text-amber-300"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Top Ticker Move & Position */}
          <div className="bg-black/60 p-2 rounded border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-amber-300 font-black">▴ MOVE TOP TICKER:</span>
              <span className="text-zinc-400 font-mono">
                X:{g.topTickerCustomX ?? 0} Y:{g.topTickerCustomY ?? (topOverlay.enabled ? topOverlay.height || 90 : 0)}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1 text-[9px] font-bold">
              <button
                onClick={() => {
                  const curY = g.topTickerCustomY ?? (topOverlay.enabled ? topOverlay.height || 90 : 0);
                  onUpdateGraphics({ topTickerCustomY: Math.max(0, curY - 10) });
                }}
                className="py-1 bg-zinc-900 hover:bg-amber-900/60 rounded border border-zinc-700 text-amber-300"
              >
                ⬆ Up
              </button>
              <button
                onClick={() => {
                  const curY = g.topTickerCustomY ?? (topOverlay.enabled ? topOverlay.height || 90 : 0);
                  onUpdateGraphics({
                    topTickerCustomY: Math.min(1080 - (g.topTickerHeight || 48), curY + 10),
                  });
                }}
                className="py-1 bg-zinc-900 hover:bg-amber-900/60 rounded border border-zinc-700 text-amber-300"
              >
                ⬇ Down
              </button>
              <button
                onClick={() => {
                  const curX = g.topTickerCustomX ?? 0;
                  onUpdateGraphics({ topTickerCustomX: Math.max(0, curX - 20) });
                }}
                className="py-1 bg-zinc-900 hover:bg-amber-900/60 rounded border border-zinc-700 text-amber-300"
              >
                ⬅ Left
              </button>
              <button
                onClick={() => {
                  const curX = g.topTickerCustomX ?? 0;
                  onUpdateGraphics({ topTickerCustomX: Math.min(1800, curX + 20) });
                }}
                className="py-1 bg-zinc-900 hover:bg-amber-900/60 rounded border border-zinc-700 text-amber-300"
              >
                ➡ Right
              </button>
              <button
                onClick={() =>
                  onUpdateGraphics({
                    topTickerCustomX: undefined,
                    topTickerCustomY: undefined,
                    topTickerCustomWidth: 1920,
                  })
                }
                className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 text-cyan-300"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Scroll Speed */}
          <div className="space-y-1.5 pt-1 border-t border-zinc-800">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-400">BOTTOM SPEED: {g.tickerSpeed || 4}</span>
              <span className="text-zinc-400">TOP SPEED: {g.topTickerSpeed || 4}</span>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              value={g.tickerSpeed || 4}
              onChange={(e) => {
                const spd = parseInt(e.target.value, 10);
                onUpdateGraphics({ tickerSpeed: spd, topTickerSpeed: spd });
              }}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>
      )}

      {/* E) WHEN L-SHAPE CG IS SELECTED */}
      {currentLayer === 'lshape' && (
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-black text-purple-400 text-[11px] uppercase">
              L-SHAPE SIDE &amp; SHARP SQUEEZE / OVERLAY
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <button
              onClick={() => handleSetLShapeSide('left')}
              className={`py-1.5 rounded font-bold border ${
                lShape.side === 'left'
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-black text-zinc-300 border-zinc-800'
              }`}
            >
              ◱ Left Side L-Shape
            </button>
            <button
              onClick={() => handleSetLShapeSide('right')}
              className={`py-1.5 rounded font-bold border ${
                lShape.side === 'right'
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-black text-zinc-300 border-zinc-800'
              }`}
            >
              ◲ Right Side L-Shape
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <button
              onClick={() =>
                onUpdateLShape({
                  renderMode: 'squeeze',
                  squeezeProgramVideo: true,
                })
              }
              className={`py-1.5 rounded font-bold border ${
                (lShape.renderMode || 'squeeze') === 'squeeze'
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-black text-zinc-300 border-zinc-800'
              }`}
            >
              Sharp Squeeze Video
            </button>
            <button
              onClick={() =>
                onUpdateLShape({
                  renderMode: 'overlay',
                  squeezeProgramVideo: false,
                })
              }
              className={`py-1.5 rounded font-bold border ${
                lShape.renderMode === 'overlay'
                  ? 'bg-cyan-600 text-white border-cyan-400'
                  : 'bg-black text-zinc-300 border-zinc-800'
              }`}
            >
              Overlay Play on Top
            </button>
          </div>

          <div className="space-y-1 pt-1 border-t border-zinc-800">
            <label className="text-[9px] text-amber-300 font-bold block">
              L-SHAPE SIZE (TOO SMALL • SMALL • MED • BIG):
            </label>
            <div className="grid grid-cols-2 gap-1 text-[9px]">
              {[
                { id: 'too_small', label: 'Too Small (100×48)', w: 100, h: 48 },
                { id: 'extra_small', label: 'Extra Small (140×68)', w: 140, h: 68 },
                { id: 'very_small', label: 'Very Small (180×88)', w: 180, h: 88 },
                { id: 'small', label: 'Small (220×105)', w: 220, h: 105 },
                { id: 'compact', label: 'Compact (280×130)', w: 280, h: 130 },
                { id: 'medium', label: 'Medium (360×170)', w: 360, h: 170 },
                { id: 'large', label: 'Big (460×220)', w: 460, h: 220 },
              ].map((sz) => (
                <button
                  key={sz.id}
                  onClick={() =>
                    onUpdateLShape({
                      presetSize: sz.id as any,
                      sideWidth: sz.w,
                      bottomHeight: sz.h,
                    })
                  }
                  className={`py-1 rounded font-bold border ${
                    (lShape.sideWidth || 280) === sz.w
                      ? 'bg-amber-500 text-black border-amber-300'
                      : 'bg-black text-zinc-300 border-zinc-800 hover:text-white'
                  }`}
                >
                  {sz.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* F) WHEN CLOCK CG IS SELECTED */}
      {currentLayer === 'clock' && (
        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-md space-y-2.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
            <span className="font-black text-amber-400 text-[11px] uppercase">
              CLOCK CG QUICK OPTIONS
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            {[
              { id: 'time_only', label: 'Only Time' },
              { id: 'time_date', label: 'Time & Date' },
              { id: 'only_date', label: 'Only Date' },
              { id: 'date_day', label: 'Date & Day' },
              { id: 'day_time', label: 'Day & Time' },
              { id: 'full_day_date_time', label: 'Full Day+Date+Time' },
            ].map((fmt) => (
              <button
                key={fmt.id}
                onClick={() =>
                  onUpdateGraphics({
                    clockEnabled: true,
                    clockFormat: fmt.id as any,
                  })
                }
                className={`py-1.5 rounded font-bold border ${
                  (g.clockFormat || 'full_day_date_time') === fmt.id
                    ? 'bg-amber-500 text-black border-amber-400'
                    : 'bg-black text-zinc-300 border-zinc-800'
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <button
              onClick={() => onUpdateGraphics({ clockTransparentBg: !g.clockTransparentBg })}
              className={`py-1.5 rounded font-bold border ${
                g.clockTransparentBg
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700'
              }`}
            >
              {g.clockTransparentBg ? '✓ BG Removed' : 'Remove BG'}
            </button>
            <button
              onClick={() => onUpdateGraphics({ clockIs3D: !(g.clockIs3D ?? true) })}
              className={`py-1.5 rounded font-bold border ${
                g.clockIs3D ?? true
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700'
              }`}
            >
              {g.clockIs3D ?? true ? '✓ 3D Text ON' : '3D Text OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
