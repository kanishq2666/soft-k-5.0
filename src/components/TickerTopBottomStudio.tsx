import React, { useState, useRef } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  Edit3,
  Check,
  CheckSquare,
  Square,
  Upload,
  Save,
  Type,
  Palette,
  Gauge,
  Maximize2,
  Move,
  RotateCcw,
  Clock
} from 'lucide-react';
import {
  TVChannel,
  BottomScrollConfig,
  TickerScrollItem,
  BottomOverlayConfig,
} from '../types/playout';
import { ALL_CG_MEDIA_ACCEPT } from '../services/swfEngine';
import { computeRemainingSeconds } from '../utils/tickerSync';

interface TickerTopBottomStudioProps {
  channel: TVChannel;
  onUpdateGraphics: (partial: Partial<BottomScrollConfig>) => void;
  onSaveChannel?: () => void;
  onSelectTickerLayer?: (layer: 'bottom_scroll' | 'top_ticker') => void;
  bottomOverlay?: BottomOverlayConfig;
  topOverlay?: BottomOverlayConfig;
  onUpdateBottomOverlay?: (partial: Partial<BottomOverlayConfig>) => void;
  onUpdateTopOverlay?: (partial: Partial<BottomOverlayConfig>) => void;
  onUploadOverlayMedia?: (files: FileList | File[] | null, target: 'bottom' | 'top') => void;
}

const FONT_FAMILIES = [
  'Inter',
  'Arial Black',
  'Impact',
  'Montserrat',
  'Roboto',
  'Oswald',
  'Bebas Neue',
  'Georgia',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Noto Sans Tamil',
];

const TEXT_COLOR_SWATCHES = [
  '#FFFFFF',
  '#FEF08A',
  '#38BDF8',
  '#4ADE80',
  '#FB923C',
  '#F87171',
  '#E879F9',
  '#000000',
];

const BG_COLOR_SWATCHES = [
  '#06080E',
  '#082F49',
  '#7F1D1D',
  '#1E1B4B',
  '#052E16',
  '#451A03',
  '#3B0764',
  '#18181B',
];

export const TickerTopBottomStudio: React.FC<TickerTopBottomStudioProps> = ({
  channel,
  onUpdateGraphics,
  onSaveChannel,
  onSelectTickerLayer,
  bottomOverlay,
  topOverlay,
  onUpdateBottomOverlay,
  onUpdateTopOverlay,
  onUploadOverlayMedia,
}) => {
  const g = channel.graphics;
  const [activeTickerTab, setActiveTickerTab] = useState<'bottom' | 'top'>('bottom');
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newItemDurationSec, setNewItemDurationSec] = useState<number>(0);
  const [newItemExpiryMin, setNewItemExpiryMin] = useState<number>(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [editDurationSec, setEditDurationSec] = useState<number>(0);
  const [savedToast, setSavedToast] = useState(false);

  const txtFileInputRef = useRef<HTMLInputElement>(null);
  const txtFolderInputRef = useRef<HTMLInputElement>(null);
  const swfFileInputRef = useRef<HTMLInputElement>(null);
  const swfFolderInputRef = useRef<HTMLInputElement>(null);

  const isTop = activeTickerTab === 'top';
  const activeSwfOverlay = isTop
    ? topOverlay || channel.topOverlay
    : bottomOverlay || channel.bottomOverlay;
  const updateActiveSwfOverlay = isTop ? onUpdateTopOverlay : onUpdateBottomOverlay;
  const items: TickerScrollItem[] = isTop
    ? g.topTickerItems || []
    : g.tickerItems || [];

  const isEnabled = isTop ? !!g.topTickerEnabled : !!g.tickerEnabled;
  const barHeight = isTop
    ? g.topTickerHeight || 48
    : g.tickerCustomHeight || 48;
  const defaultY = isTop
    ? channel.topOverlay?.enabled
      ? channel.topOverlay.height || 90
      : 0
    : Math.max(
        0,
        1080 -
          barHeight -
          (channel.bottomOverlay?.enabled ? channel.bottomOverlay.height || 200 : 0)
      );
  const posX = isTop
    ? typeof g.topTickerCustomX === 'number'
      ? g.topTickerCustomX
      : 0
    : typeof g.customX === 'number'
    ? g.customX
    : 0;
  const posY = isTop
    ? typeof g.topTickerCustomY === 'number'
      ? g.topTickerCustomY
      : defaultY
    : typeof g.customY === 'number'
    ? g.customY
    : defaultY;
  const barWidth = isTop
    ? typeof g.topTickerCustomWidth === 'number' && g.topTickerCustomWidth >= 150
      ? g.topTickerCustomWidth
      : 1920
    : typeof g.customWidth === 'number' && g.customWidth >= 150
    ? g.customWidth
    : 1920;
  const fontSize = isTop
    ? g.topTickerFontSize || 22
    : g.tickerFontSize || 22;
  const fontFamily = isTop
    ? g.topTickerFontFamily || 'Inter'
    : g.tickerFontFamily || 'Inter';
  const textColor = isTop
    ? g.topTickerTextColor || '#FEF08A'
    : g.tickerTextColor || '#FFFFFF';
  const bgColor = isTop
    ? g.topTickerBgColor || '#082F49'
    : g.tickerBgColor || '#06080E';
  const speed = isTop
    ? g.topTickerSpeed || 4
    : g.tickerSpeed || 4;
  const direction = isTop
    ? g.topTickerDirection || 'rtl'
    : g.tickerDirection || 'rtl';
  const barDurationSec = isTop
    ? g.topTickerDurationSec ?? 0
    : g.tickerDurationSec ?? 0;
  const barExpiresAt = isTop
    ? g.topTickerExpiresAt ?? null
    : g.tickerExpiresAt ?? null;
  const remainingExpirySec = computeRemainingSeconds(barExpiresAt);

  const updateCurrentTicker = (
    partial: {
      enabled?: boolean;
      height?: number;
      x?: number | undefined;
      y?: number | undefined;
      width?: number | undefined;
      fontSize?: number;
      fontFamily?: string;
      textColor?: string;
      bgColor?: string;
      speed?: number;
      direction?: 'rtl' | 'ltr';
      durationSec?: number;
      expiresAt?: number | null;
      expiryMinutes?: number;
      items?: TickerScrollItem[];
    }
  ) => {
    if (isTop) {
      const next: Partial<BottomScrollConfig> = {};
      if (partial.enabled !== undefined) next.topTickerEnabled = partial.enabled;
      if (partial.height !== undefined) next.topTickerHeight = partial.height;
      if ('x' in partial) next.topTickerCustomX = partial.x;
      if ('y' in partial) next.topTickerCustomY = partial.y;
      if ('width' in partial) next.topTickerCustomWidth = partial.width;
      if (partial.fontSize !== undefined) next.topTickerFontSize = partial.fontSize;
      if (partial.fontFamily !== undefined) next.topTickerFontFamily = partial.fontFamily;
      if (partial.textColor !== undefined) next.topTickerTextColor = partial.textColor;
      if (partial.bgColor !== undefined) next.topTickerBgColor = partial.bgColor;
      if (partial.speed !== undefined) next.topTickerSpeed = partial.speed;
      if (partial.direction !== undefined) next.topTickerDirection = partial.direction;
      if (partial.durationSec !== undefined) next.topTickerDurationSec = partial.durationSec;
      if ('expiresAt' in partial) next.topTickerExpiresAt = partial.expiresAt;
      if (partial.expiryMinutes !== undefined) next.topTickerExpiryMinutes = partial.expiryMinutes;
      if (partial.items !== undefined) next.topTickerItems = partial.items;
      onUpdateGraphics(next);
    } else {
      const next: Partial<BottomScrollConfig> = {};
      if (partial.enabled !== undefined) next.tickerEnabled = partial.enabled;
      if (partial.height !== undefined) next.tickerCustomHeight = partial.height;
      if ('x' in partial) next.customX = partial.x;
      if ('y' in partial) next.customY = partial.y;
      if ('width' in partial) next.customWidth = partial.width;
      if (partial.fontSize !== undefined) next.tickerFontSize = partial.fontSize;
      if (partial.fontFamily !== undefined) next.tickerFontFamily = partial.fontFamily;
      if (partial.textColor !== undefined) next.tickerTextColor = partial.textColor;
      if (partial.bgColor !== undefined) next.tickerBgColor = partial.bgColor;
      if (partial.speed !== undefined) next.tickerSpeed = partial.speed;
      if (partial.direction !== undefined) next.tickerDirection = partial.direction;
      if (partial.durationSec !== undefined) next.tickerDurationSec = partial.durationSec;
      if ('expiresAt' in partial) next.tickerExpiresAt = partial.expiresAt;
      if (partial.expiryMinutes !== undefined) next.tickerExpiryMinutes = partial.expiryMinutes;
      if (partial.items !== undefined) next.tickerItems = partial.items;
      onUpdateGraphics(next);
    }
  };

  const handleAddItem = () => {
    const cleanText = newText.trim();
    if (!cleanText) return;
    const cleanTitle = newTitle.trim();
    const newItem: TickerScrollItem = {
      id: `${isTop ? 'top' : 'bot'}-tick-${Date.now()}`,
      title: cleanTitle || undefined,
      text: cleanText,
      enabled: true,
      durationSec: newItemDurationSec > 0 ? newItemDurationSec : undefined,
      expiresAt: newItemExpiryMin > 0 ? Date.now() + newItemExpiryMin * 60_000 : null,
    };
    updateCurrentTicker({
      enabled: true,
      items: [...items, newItem],
    });
    setNewText('');
    setNewTitle('');
  };

  const handleToggleItem = (idx: number) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], enabled: !copy[idx].enabled };
    updateCurrentTicker({ items: copy });
  };

  const handleDeleteItem = (idx: number) => {
    updateCurrentTicker({
      items: items.filter((_, i) => i !== idx),
    });
  };

  const handleMoveItem = (idx: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    const [moved] = copy.splice(idx, 1);
    copy.splice(target, 0, moved);
    updateCurrentTicker({ items: copy });
  };

  const startEditItem = (idx: number) => {
    const it = items[idx];
    setEditingIdx(idx);
    setEditTitle(it.title || '');
    setEditText(it.text);
    setEditDurationSec(it.durationSec || 0);
  };

  const saveEditItem = (idx: number) => {
    if (!editText.trim()) return;
    const copy = [...items];
    copy[idx] = {
      ...copy[idx],
      title: editTitle.trim() || undefined,
      text: editText.trim(),
      durationSec: editDurationSec > 0 ? editDurationSec : undefined,
    };
    updateCurrentTicker({ items: copy });
    setEditingIdx(null);
  };

  const handleTriggerSave = () => {
    if (onSaveChannel) onSaveChannel();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  return (
    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-lg space-y-3 font-mono text-xs">
      {/* Header + Save Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div>
          <h3 className="text-xs font-black text-white uppercase tracking-wide">
            TICKER TOP &amp; BOTTOM STUDIO (1ST SCROLL FULL ➔ THEN NEXT SCROLL PLAY)
          </h3>
          <span className="text-[10px] text-emerald-400 font-bold block">
            Each Scroll Plays 100% Full Across Screen Before Next Scroll Starts • Bottom:{' '}
            {(g.tickerItems || []).filter((i) => i.enabled).length} active • Top:{' '}
            {(g.topTickerItems || []).filter((i) => i.enabled).length} active
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleTriggerSave}
            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black flex items-center gap-1 shadow cursor-pointer"
          >
            <Save className="w-3 h-3" />
            <span>{savedToast ? '✓ SAVED' : 'SAVE TICKER'}</span>
          </button>
        </div>
      </div>

      {/* Switch Between Bottom Ticker & Top Ticker + Independent ON/OFF */}
      <div className="grid grid-cols-2 gap-2">
        <div
          onClick={() => {
            setActiveTickerTab('bottom');
            setEditingIdx(null);
            onSelectTickerLayer?.('bottom_scroll');
          }}
          className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
            activeTickerTab === 'bottom'
              ? 'bg-cyan-950/60 border-cyan-400 text-white shadow'
              : 'bg-black/60 border-zinc-800 text-zinc-400 hover:text-white'
          }`}
        >
          <div>
            <div className="text-[11px] font-black">▾ TICKER BOTTOM</div>
            <div className="text-[9px] text-zinc-400">
              {(g.tickerItems || []).length} Items • X:{typeof g.customX === 'number' ? g.customX : 0} Y:{typeof g.customY === 'number' ? g.customY : 'Auto'} • {g.tickerCustomHeight || 48}px
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateGraphics({ tickerEnabled: !g.tickerEnabled });
            }}
            className={`px-2 py-1 rounded text-[10px] font-black ${
              g.tickerEnabled
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-700'
            }`}
          >
            {g.tickerEnabled ? 'ON AIR' : 'OFF'}
          </button>
        </div>

        <div
          onClick={() => {
            setActiveTickerTab('top');
            setEditingIdx(null);
            onSelectTickerLayer?.('top_ticker');
          }}
          className={`p-2 rounded-lg border cursor-pointer transition flex items-center justify-between ${
            activeTickerTab === 'top'
              ? 'bg-amber-950/60 border-amber-400 text-white shadow'
              : 'bg-black/60 border-zinc-800 text-zinc-400 hover:text-white'
          }`}
        >
          <div>
            <div className="text-[11px] font-black">▴ TICKER TOP</div>
            <div className="text-[9px] text-zinc-400">
              {(g.topTickerItems || []).length} Items • X:{typeof g.topTickerCustomX === 'number' ? g.topTickerCustomX : 0} Y:{typeof g.topTickerCustomY === 'number' ? g.topTickerCustomY : 'Auto'} • {g.topTickerHeight || 48}px
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateGraphics({ topTickerEnabled: !g.topTickerEnabled });
            }}
            className={`px-2 py-1 rounded text-[10px] font-black ${
              g.topTickerEnabled
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-700'
            }`}
          >
            {g.topTickerEnabled ? 'ON AIR' : 'OFF'}
          </button>
        </div>
      </div>

      {/* MOVE & POSITION CONTROLS (X, Y, WIDTH, SNAP PRESETS & NUDGE BUTTONS) */}
      <div className="bg-black/80 p-2.5 rounded-lg border border-cyan-500/40 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-black text-cyan-300 uppercase flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-cyan-400" />
            {isTop ? '▴ TOP TICKER' : '▾ BOTTOM TICKER'} MOVE &amp; DRAG POSITION (1920×1080)
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-amber-300 font-bold">
              X: {posX}px • Y: {posY}px • W: {barWidth}px • H: {barHeight}px
            </span>
            <button
              type="button"
              onClick={() =>
                updateCurrentTicker({
                  x: undefined,
                  y: undefined,
                  width: 1920,
                  height: 48,
                })
              }
              className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[9px] font-black text-zinc-300 flex items-center gap-1 cursor-pointer"
              title="Reset Ticker Position & Size to Default"
            >
              <RotateCcw className="w-2.5 h-2.5" /> RESET POS
            </button>
          </div>
        </div>

        {/* Directional Nudge Buttons + Quick Snap Presets */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 text-[9px] font-black">
          <button
            type="button"
            onClick={() => updateCurrentTicker({ y: Math.max(0, posY - 10) })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-cyan-900/60 border border-zinc-700 hover:border-cyan-400 text-cyan-300 cursor-pointer"
          >
            ▲ UP (-10)
          </button>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ y: Math.min(1080 - barHeight, posY + 10) })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-cyan-900/60 border border-zinc-700 hover:border-cyan-400 text-cyan-300 cursor-pointer"
          >
            ▼ DOWN (+10)
          </button>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ x: Math.max(0, posX - 20) })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-cyan-900/60 border border-zinc-700 hover:border-cyan-400 text-cyan-300 cursor-pointer"
          >
            ◀ LEFT (-20)
          </button>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ x: Math.min(1800, posX + 20) })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-cyan-900/60 border border-zinc-700 hover:border-cyan-400 text-cyan-300 cursor-pointer"
          >
            ▶ RIGHT (+20)
          </button>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ x: 0, y: 0, width: 1920 })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-amber-900/50 border border-zinc-700 text-amber-300 cursor-pointer"
          >
            SNAP TOP (0)
          </button>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ x: 0, y: 90, width: 1920 })}
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-amber-900/50 border border-zinc-700 text-amber-300 cursor-pointer"
          >
            BELOW TOP (90)
          </button>
          <button
            type="button"
            onClick={() =>
              updateCurrentTicker({
                x: 0,
                y: Math.max(0, 1080 - barHeight - 200),
                width: 1920,
              })
            }
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-emerald-900/50 border border-zinc-700 text-emerald-300 cursor-pointer"
          >
            ABOVE BANNER
          </button>
          <button
            type="button"
            onClick={() =>
              updateCurrentTicker({
                x: 0,
                y: Math.max(0, 1080 - barHeight),
                width: 1920,
              })
            }
            className="py-1.5 px-1.5 rounded bg-zinc-900 hover:bg-emerald-900/50 border border-zinc-700 text-emerald-300 cursor-pointer"
          >
            SNAP BOTTOM
          </button>
        </div>

        {/* Sliders for X, Y, and Width */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <div className="bg-zinc-900/90 p-1.5 rounded border border-zinc-800">
            <div className="flex justify-between text-[9px] font-bold mb-1">
              <span className="text-zinc-400">MOVE X (LEFT/RIGHT):</span>
              <span className="text-cyan-400 font-black">{posX}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={1700}
              value={posX}
              onChange={(e) => updateCurrentTicker({ x: Number(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>
          <div className="bg-zinc-900/90 p-1.5 rounded border border-zinc-800">
            <div className="flex justify-between text-[9px] font-bold mb-1">
              <span className="text-zinc-400">MOVE Y (UP/DOWN):</span>
              <span className="text-amber-400 font-black">{posY}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, 1080 - barHeight)}
              value={posY}
              onChange={(e) => updateCurrentTicker({ y: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>
          <div className="bg-zinc-900/90 p-1.5 rounded border border-zinc-800">
            <div className="flex justify-between text-[9px] font-bold mb-1">
              <span className="text-zinc-400">TICKER WIDTH:</span>
              <span className="text-emerald-400 font-black">{barWidth}px</span>
            </div>
            <input
              type="range"
              min={200}
              max={1920}
              value={barWidth}
              onChange={(e) => updateCurrentTicker({ width: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Styling Controls for Selected Ticker (Size, Font Family, Font Color, Background Color, Speed) */}
      <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-cyan-400 uppercase">
            {isTop ? '▴ TOP TICKER' : '▾ BOTTOM TICKER'} STYLE &amp; SPEED CONTROLS
          </span>
          <button
            type="button"
            onClick={() => updateCurrentTicker({ enabled: !isEnabled })}
            className={`px-2.5 py-0.5 rounded text-[10px] font-black ${
              isEnabled ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {isEnabled ? '● ACTIVE ON SCREEN' : '○ CLICK TO ENABLE'}
          </button>
        </div>

        {/* 1. Size: Bar Height & Font Size (Up to Full Screen 1080p) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-300 font-bold flex items-center gap-1">
                <Maximize2 className="w-3 h-3 text-cyan-400" /> RESIZE BAR HEIGHT (UP TO 1080PX):
              </span>
              <span className="text-cyan-400 font-black">{barWidth}×{barHeight}px</span>
            </div>
            <div className="grid grid-cols-5 gap-1 mb-1.5 text-[9px]">
              {[
                { label: 'Sml (36)', w: 1920, h: 36, f: 18 },
                { label: 'Med (50)', w: 1920, h: 50, f: 24 },
                { label: 'Big (85)', w: 1920, h: 85, f: 38 },
                { label: 'Tall (220)', w: 1920, h: 220, f: 54 },
                { label: '⛶ FULL 1080', w: 1920, h: 1080, f: 96, y: 0, x: 0 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() =>
                    updateCurrentTicker({
                      width: p.w,
                      height: p.h,
                      fontSize: p.f,
                      ...(p.y !== undefined ? { y: p.y, x: p.x } : {}),
                    })
                  }
                  className={`py-1 rounded font-bold border cursor-pointer ${
                    barHeight === p.h
                      ? 'bg-cyan-600 text-white border-cyan-400'
                      : 'bg-black text-zinc-400 border-zinc-700 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={28}
              max={1080}
              value={barHeight}
              onChange={(e) => updateCurrentTicker({ height: Number(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>

          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-300 font-bold flex items-center gap-1">
                <Type className="w-3 h-3 text-amber-400" /> FONT SIZE &amp; FAMILY:
              </span>
              <span className="text-amber-400 font-black">{fontSize}px</span>
            </div>
            <select
              value={fontFamily}
              onChange={(e) => updateCurrentTicker({ fontFamily: e.target.value })}
              className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-[11px] font-bold text-white mb-1.5"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  Font: {f}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={14}
              max={160}
              value={fontSize}
              onChange={(e) => updateCurrentTicker({ fontSize: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>
        </div>

        {/* 2. Font Color & Background Color */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] mb-1.5">
              <span className="text-zinc-300 font-bold flex items-center gap-1">
                <Palette className="w-3 h-3 text-emerald-400" /> FONT COLOR:
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => updateCurrentTicker({ textColor: e.target.value })}
                  className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[9px] text-zinc-400 uppercase">{textColor}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {TEXT_COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateCurrentTicker({ textColor: c })}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded border ${
                    textColor.toLowerCase() === c.toLowerCase()
                      ? 'border-white scale-110 ring-1 ring-cyan-400'
                      : 'border-zinc-600'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800">
            <div className="flex items-center justify-between text-[10px] mb-1.5">
              <span className="text-zinc-300 font-bold flex items-center gap-1">
                <Palette className="w-3 h-3 text-purple-400" /> BACKGROUND COLOR:
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => updateCurrentTicker({ bgColor: e.target.value })}
                  className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="text-[9px] text-zinc-400 uppercase">{bgColor}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {BG_COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateCurrentTicker({ bgColor: c })}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded border ${
                    bgColor.toLowerCase() === c.toLowerCase()
                      ? 'border-white scale-110 ring-1 ring-cyan-400'
                      : 'border-zinc-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 3. Speed & Direction */}
        <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-zinc-300 font-bold flex items-center gap-1">
              <Gauge className="w-3 h-3 text-rose-400" /> SCROLL SPEED: {speed}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => updateCurrentTicker({ direction: 'rtl' })}
                className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                  direction === 'rtl'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-black text-zinc-400 border border-zinc-700'
                }`}
              >
                ⬅ Right-to-Left
              </button>
              <button
                type="button"
                onClick={() => updateCurrentTicker({ direction: 'ltr' })}
                className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                  direction === 'ltr'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-black text-zinc-400 border border-zinc-700'
                }`}
              >
                Left-to-Right ➡
              </button>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={15}
            value={speed}
            onChange={(e) => updateCurrentTicker({ speed: Number(e.target.value) })}
            className="w-full accent-rose-500"
          />
        </div>
      </div>

      {/* Direct Top / Bottom Scroll SWF & Media Banner Upload (Real HD Vector Quality) */}
      {onUploadOverlayMedia && activeSwfOverlay && (
        <div className="bg-black/80 p-2.5 rounded-lg border border-amber-500/40 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-black text-amber-400 uppercase block">
                ⚡ {isTop ? 'TOP' : 'BOTTOM'} SCROLL SWF / FLASH &amp; VIDEO BANNER (REAL HD VECTOR QUALITY)
              </span>
              <span className="text-[9px] text-zinc-400">
                Upload .SWF Flash Scroll, MP4, GIF, or PNG directly for {isTop ? 'Top' : 'Bottom'} Scroll output
              </span>
            </div>
            {updateActiveSwfOverlay && (
              <button
                type="button"
                onClick={() =>
                  updateActiveSwfOverlay({ enabled: !activeSwfOverlay.enabled })
                }
                className={`px-2.5 py-1 rounded text-[10px] font-black cursor-pointer ${
                  activeSwfOverlay.enabled
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-700'
                }`}
              >
                {activeSwfOverlay.enabled ? '● SWF/BANNER ON AIR' : 'SWF/BANNER OFF'}
              </button>
            )}
          </div>

          <input
            key={`scroll-swf-file-${isTop ? 'top' : 'bottom'}`}
            ref={swfFileInputRef}
            type="file"
            multiple
            accept={ALL_CG_MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (selected.length > 0) {
                onUploadOverlayMedia(selected, isTop ? 'top' : 'bottom');
              }
            }}
          />
          <input
            key={`scroll-swf-folder-${isTop ? 'top' : 'bottom'}`}
            ref={(el) => {
              swfFolderInputRef.current = el;
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (selected.length > 0) {
                onUploadOverlayMedia(selected, isTop ? 'top' : 'bottom');
              }
            }}
          />

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => swfFileInputRef.current?.click()}
              className="py-1.5 px-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded text-[10px] font-black flex items-center justify-center gap-1.5 shadow cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>+ Upload {isTop ? 'Top' : 'Bottom'} SWF / Media File</span>
            </button>
            <button
              type="button"
              onClick={() => swfFolderInputRef.current?.click()}
              className="py-1.5 px-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-black flex items-center justify-center gap-1.5 shadow cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>+ Upload {isTop ? 'Top' : 'Bottom'} SWF Folder</span>
            </button>
          </div>

          {/* Direct Resize & Full Screen Controls for Top/Bottom SWF & Ad Banner */}
          {updateActiveSwfOverlay && (
            <div className="bg-zinc-900/90 p-2 rounded border border-amber-500/30 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-[9px] font-black text-amber-300 uppercase flex items-center gap-1">
                  <Maximize2 className="w-3 h-3 text-amber-400" />
                  RESIZE {isTop ? 'TOP' : 'BOTTOM'} AD BANNER / SWF (UP TO FULL SCREEN 1920×1080):
                </span>
                <span className="text-[9px] font-black text-emerald-400">
                  {activeSwfOverlay.width || 1920}W × {activeSwfOverlay.height || (isTop ? 90 : 200)}H px
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1 text-[9px] font-black">
                {[
                  { label: 'Sml (90H)', w: 1920, h: 90, x: 0, y: isTop ? 0 : 990 },
                  { label: 'Std (200H)', w: 1920, h: 200, x: 0, y: isTop ? 0 : 880 },
                  { label: 'Big (340H)', w: 1920, h: 340, x: 0, y: isTop ? 0 : 740 },
                  { label: 'Half (540H)', w: 1920, h: 540, x: 0, y: isTop ? 0 : 540 },
                  { label: '⛶ FULL 1080P', w: 1920, h: 1080, x: 0, y: 0 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      updateActiveSwfOverlay({
                        enabled: true,
                        width: preset.w,
                        height: preset.h,
                        x: preset.x,
                        y: preset.y,
                      })
                    }
                    className={`py-1 rounded border cursor-pointer ${
                      (activeSwfOverlay.width || 1920) === preset.w &&
                      (activeSwfOverlay.height || (isTop ? 90 : 200)) === preset.h
                        ? 'bg-amber-500 text-black border-amber-300'
                        : 'bg-black text-zinc-300 border-zinc-700 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div>
                  <div className="flex justify-between text-[9px] text-zinc-400 font-bold">
                    <span>BANNER WIDTH:</span>
                    <span className="text-amber-300">{activeSwfOverlay.width || 1920}px</span>
                  </div>
                  <input
                    type="range"
                    min={200}
                    max={1920}
                    step={10}
                    value={activeSwfOverlay.width || 1920}
                    onChange={(e) =>
                      updateActiveSwfOverlay({ width: Number(e.target.value) })
                    }
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[9px] text-zinc-400 font-bold">
                    <span>BANNER HEIGHT:</span>
                    <span className="text-amber-300">
                      {activeSwfOverlay.height || (isTop ? 90 : 200)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={1080}
                    step={5}
                    value={activeSwfOverlay.height || (isTop ? 90 : 200)}
                    onChange={(e) => {
                      const nextH = Number(e.target.value);
                      updateActiveSwfOverlay({
                        height: nextH,
                        ...(isTop ? {} : { y: Math.max(0, 1080 - nextH) }),
                      });
                    }}
                    className="w-full accent-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          {(activeSwfOverlay.playlist || []).filter(
            (it) => it.id !== 'bot-1' && it.id !== 'bot-2' && !String(it.url || '').startsWith('data:image/svg+xml')
          ).length > 0 && (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pt-1">
              {Array.from(
                new Set(
                  (activeSwfOverlay.playlist || [])
                    .map((it) => it.folderName)
                    .filter((f): f is string => Boolean(f))
                )
              ).map((folderName) => {
                const folderItems = (activeSwfOverlay.playlist || []).filter(
                  (it) => it.folderName === folderName
                );
                const enabledCount = folderItems.filter((it) => it.enabled !== false).length;
                const isFolderEnabled = enabledCount > 0;
                return (
                  <div
                    key={`ov-folder-${folderName}`}
                    className={`flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 rounded border text-[10px] ${
                      isFolderEnabled
                        ? 'bg-purple-950/60 border-purple-500/40'
                        : 'bg-zinc-950/80 border-rose-900/60 opacity-75'
                    }`}
                  >
                    <span
                      className={`font-bold truncate ${
                        isFolderEnabled ? 'text-purple-200' : 'text-zinc-500 line-through'
                      }`}
                    >
                      📁 {folderName} ({enabledCount}/{folderItems.length} files)
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex rounded overflow-hidden border border-zinc-700">
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay) return;
                            const nextList = (activeSwfOverlay.playlist || []).map((it) =>
                              it.folderName === folderName ? { ...it, enabled: true } : it
                            );
                            updateActiveSwfOverlay({ enabled: true, playlist: nextList });
                            fetch('/api/playout/toggle-enable', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelId: channel.id,
                                scope: isTop ? 'top_overlay' : 'bottom_overlay',
                                targetType: 'folder',
                                folderName,
                                enabled: true,
                              }),
                            }).catch(() => {});
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            isFolderEnabled
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                          }`}
                        >
                          Enable
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay) return;
                            const nextList = (activeSwfOverlay.playlist || []).map((it) =>
                              it.folderName === folderName ? { ...it, enabled: false } : it
                            );
                            updateActiveSwfOverlay({ playlist: nextList });
                            fetch('/api/playout/toggle-enable', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelId: channel.id,
                                scope: isTop ? 'top_overlay' : 'bottom_overlay',
                                targetType: 'folder',
                                folderName,
                                enabled: false,
                              }),
                            }).catch(() => {});
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            !isFolderEnabled
                              ? 'bg-rose-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                          }`}
                        >
                          Disable
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!updateActiveSwfOverlay) return;
                          const filtered = (activeSwfOverlay.playlist || []).filter(
                            (it) => it.folderName !== folderName
                          );
                          updateActiveSwfOverlay({
                            playlist: filtered,
                            currentIndex: 0,
                          });
                        }}
                        className="text-red-300 hover:text-red-200 text-[9px] font-bold ml-1 shrink-0 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}

              {(activeSwfOverlay.playlist || []).map((ovItem, ovIdx) => {
                if (
                  ovItem.id === 'bot-1' ||
                  ovItem.id === 'bot-2' ||
                  String(ovItem.url || '').startsWith('data:image/svg+xml')
                ) {
                  return null;
                }
                const isItemEnabled = ovItem.enabled !== false;
                const isPlayingSwf =
                  isItemEnabled &&
                  activeSwfOverlay.enabled &&
                  activeSwfOverlay.currentIndex === ovIdx;
                return (
                  <div
                    key={ovItem.id}
                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-[10px] ${
                      !isItemEnabled
                        ? 'bg-zinc-950/70 border-rose-950/60 text-zinc-500 opacity-75'
                        : isPlayingSwf
                        ? 'bg-amber-950/40 border-amber-400 text-white'
                        : 'bg-zinc-900/90 border-zinc-800 text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div
                        onClick={() => {
                          if (!updateActiveSwfOverlay || !isItemEnabled) return;
                          updateActiveSwfOverlay({
                            enabled: true,
                            isPlaying: true,
                            currentIndex: ovIdx,
                            currentTime: 0,
                          });
                        }}
                        className={`truncate flex-1 ${
                          isItemEnabled ? 'cursor-pointer' : 'line-through text-zinc-500'
                        }`}
                      >
                        <span className="font-bold text-amber-300 mr-1.5">
                          [{ovItem.mediaType.toUpperCase()} HD]
                        </span>
                        <span>{ovItem.fileName || ovItem.title}</span>
                        {ovItem.folderName && (
                          <span className="ml-1.5 px-1 py-0.2 rounded bg-purple-900/80 text-purple-200 text-[8px] font-bold">
                            📁 {ovItem.folderName}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Move First / Up / Down Reorder Controls */}
                      <div className="flex items-center gap-0.5 mr-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay || ovIdx === 0) return;
                            const oldList = [...(activeSwfOverlay.playlist || [])];
                            const [moved] = oldList.splice(ovIdx, 1);
                            oldList.unshift(moved);
                            const curIdx = activeSwfOverlay.currentIndex || 0;
                            const nextCurIdx =
                              curIdx === ovIdx
                                ? 0
                                : curIdx < ovIdx
                                ? curIdx + 1
                                : curIdx;
                            updateActiveSwfOverlay({
                              playlist: oldList,
                              currentIndex: nextCurIdx,
                            });
                          }}
                          disabled={ovIdx === 0}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black flex items-center gap-0.5 border ${
                            ovIdx === 0
                              ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed'
                              : 'bg-amber-600/90 hover:bg-amber-500 text-white border-amber-400 cursor-pointer'
                          }`}
                          title="Move to 1st position in banner playlist"
                        >
                          <ArrowUpToLine className="w-2.5 h-2.5" />
                          <span>1st</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay || ovIdx === 0) return;
                            const oldList = [...(activeSwfOverlay.playlist || [])];
                            const temp = oldList[ovIdx - 1];
                            oldList[ovIdx - 1] = oldList[ovIdx];
                            oldList[ovIdx] = temp;
                            const curIdx = activeSwfOverlay.currentIndex || 0;
                            const nextCurIdx =
                              curIdx === ovIdx
                                ? ovIdx - 1
                                : curIdx === ovIdx - 1
                                ? ovIdx
                                : curIdx;
                            updateActiveSwfOverlay({
                              playlist: oldList,
                              currentIndex: nextCurIdx,
                            });
                          }}
                          disabled={ovIdx === 0}
                          className={`p-1 rounded ${
                            ovIdx === 0
                              ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer'
                          }`}
                          title="Move Up"
                        >
                          <ArrowUp className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const oldList = [...(activeSwfOverlay.playlist || [])];
                            if (!updateActiveSwfOverlay || ovIdx >= oldList.length - 1) return;
                            const temp = oldList[ovIdx + 1];
                            oldList[ovIdx + 1] = oldList[ovIdx];
                            oldList[ovIdx] = temp;
                            const curIdx = activeSwfOverlay.currentIndex || 0;
                            const nextCurIdx =
                              curIdx === ovIdx
                                ? ovIdx + 1
                                : curIdx === ovIdx + 1
                                ? ovIdx
                                : curIdx;
                            updateActiveSwfOverlay({
                              playlist: oldList,
                              currentIndex: nextCurIdx,
                            });
                          }}
                          disabled={ovIdx >= (activeSwfOverlay.playlist || []).length - 1}
                          className={`p-1 rounded ${
                            ovIdx >= (activeSwfOverlay.playlist || []).length - 1
                              ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer'
                          }`}
                          title="Move Down"
                        >
                          <ArrowDown className="w-2.5 h-2.5" />
                        </button>
                      </div>
                      {/* Per-File Enable / Disable Buttons */}
                      <div className="flex rounded overflow-hidden border border-zinc-700">
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay) return;
                            const copy = [...(activeSwfOverlay.playlist || [])];
                            copy[ovIdx] = { ...copy[ovIdx], enabled: true };
                            updateActiveSwfOverlay({ enabled: true, playlist: copy });
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            isItemEnabled
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                          }`}
                        >
                          Enable
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!updateActiveSwfOverlay) return;
                            const copy = [...(activeSwfOverlay.playlist || [])];
                            copy[ovIdx] = { ...copy[ovIdx], enabled: false };
                            updateActiveSwfOverlay({ playlist: copy });
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            !isItemEnabled
                              ? 'bg-rose-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                          }`}
                        >
                          Disable
                        </button>
                      </div>
                      <span className="text-[9px] text-emerald-400 font-mono">
                        {ovItem.duration}s
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!updateActiveSwfOverlay) return;
                          const filtered = (activeSwfOverlay.playlist || []).filter(
                            (_, i) => i !== ovIdx
                          );
                          updateActiveSwfOverlay({
                            playlist: filtered,
                            currentIndex: 0,
                          });
                        }}
                        className="p-1 bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white rounded cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SCROLL DURATION & AUTO-EXPIRY TIMER (TOP & BOTTOM) */}
      <div className="bg-black/80 p-2.5 rounded-lg border border-amber-500/40 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-black text-amber-300 uppercase flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {isTop ? '▴ TOP SCROLL' : '▾ BOTTOM SCROLL'} DURATION &amp; EXPIRY TIMER
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-emerald-300 font-bold">
            {barDurationSec > 0 ? `Min Pass: ${barDurationSec}s` : 'Natural 1 Pass'} •{' '}
            {remainingExpirySec !== null
              ? `Expires in ${Math.floor(remainingExpirySec / 60)}m ${String(remainingExpirySec % 60).padStart(2, '0')}s`
              : 'No Auto-Expiry'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-bold">
              <span className="text-zinc-300">PER-SCROLL DURATION (EXTEND / HOLD):</span>
              <span className="text-cyan-400 font-black">{barDurationSec}s</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {[
                { label: 'Natural', val: 0 },
                { label: '30s', val: 30 },
                { label: '1m', val: 60 },
                { label: '2m', val: 120 },
                { label: '5m', val: 300 },
              ].map((preset) => (
                <button
                  key={`dur-${preset.val}`}
                  type="button"
                  onClick={() => updateCurrentTicker({ durationSec: preset.val })}
                  className={`px-2 py-1 rounded text-[9px] font-black border cursor-pointer ${
                    barDurationSec === preset.val
                      ? 'bg-cyan-600 border-cyan-400 text-white'
                      : 'bg-black border-zinc-700 text-zinc-300 hover:border-cyan-400'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <input
                type="number"
                min={0}
                max={3600}
                value={barDurationSec}
                onChange={(e) =>
                  updateCurrentTicker({
                    durationSec: Math.max(0, Math.min(3600, Number(e.target.value) || 0)),
                  })
                }
                aria-label="Scroll duration seconds"
                className="w-16 bg-black border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-white"
              />
            </div>
          </div>

          <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-bold">
              <span className="text-zinc-300">AUTO-EXPIRY TIMER (TURN OFF BAR AFTER):</span>
              <span className="text-amber-400 font-black">
                {remainingExpirySec !== null ? `${Math.ceil(remainingExpirySec / 60)}m left` : 'Never'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {[
                { label: 'No Expiry', mins: 0 },
                { label: '5m', mins: 5 },
                { label: '15m', mins: 15 },
                { label: '30m', mins: 30 },
                { label: '1h', mins: 60 },
                { label: '2h', mins: 120 },
              ].map((preset) => (
                <button
                  key={`exp-${preset.mins}`}
                  type="button"
                  onClick={() =>
                    updateCurrentTicker({
                      enabled: preset.mins > 0 ? true : undefined,
                      expiryMinutes: preset.mins,
                      expiresAt: preset.mins > 0 ? Date.now() + preset.mins * 60_000 : null,
                    })
                  }
                  className={`px-2 py-1 rounded text-[9px] font-black border cursor-pointer ${
                    (preset.mins === 0 && !barExpiresAt) ||
                    (preset.mins > 0 && barExpiresAt && (isTop ? g.topTickerExpiryMinutes : g.tickerExpiryMinutes) === preset.mins)
                      ? 'bg-amber-600 border-amber-400 text-white'
                      : 'bg-black border-zinc-700 text-zinc-300 hover:border-amber-400'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              {barExpiresAt && (
                <button
                  type="button"
                  onClick={() =>
                    updateCurrentTicker({
                      expiresAt: Math.max(Date.now(), barExpiresAt) + 15 * 60_000,
                    })
                  }
                  className="px-2 py-1 rounded text-[9px] font-black border bg-emerald-700 hover:bg-emerald-600 border-emerald-400 text-white cursor-pointer"
                >
                  +15m Extend
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add New Scroll Item with Per-Item Title (Shows ONLY in Flash/Breaking Badge Place) */}
      <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-amber-300 font-black uppercase">
            + ADD {isTop ? 'TOP' : 'BOTTOM'} TICKER ITEM (WITH CUSTOM BADGE TITLE):
          </label>
          <span className="text-[9px] text-zinc-400">
            Title only shows at Flash/Breaking place
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title (Flash/Breaking spot)"
            className="sm:col-span-3 bg-zinc-900 border border-amber-500/50 rounded px-2.5 py-1.5 text-xs text-amber-200 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
          />
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
            placeholder="Enter scrolling ticker text..."
            className="sm:col-span-5 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500"
          />
          <input
            type="number"
            min={0}
            max={3600}
            value={newItemDurationSec || ''}
            onChange={(e) => setNewItemDurationSec(Math.max(0, Number(e.target.value) || 0))}
            placeholder="Dur(s)"
            title="Optional per-item duration in seconds"
            className="sm:col-span-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-cyan-200 placeholder:text-zinc-500"
          />
          <input
            type="number"
            min={0}
            max={1440}
            value={newItemExpiryMin || ''}
            onChange={(e) => setNewItemExpiryMin(Math.max(0, Number(e.target.value) || 0))}
            placeholder="Exp(m)"
            title="Optional item expiry in minutes"
            className="sm:col-span-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-amber-200 placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={handleAddItem}
            className="sm:col-span-2 py-1.5 px-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-black flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Optional .TXT file & folder import */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
          <input
            ref={txtFileInputRef}
            type="file"
            accept=".txt"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (files.length === 0) return;
              const added: TickerScrollItem[] = [];
              for (const f of files) {
                const txt = await f.text();
                txt
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .forEach((line, idx) => {
                    added.push({
                      id: `txt-${Date.now()}-${idx}`,
                      title: newTitle.trim() || undefined,
                      text: line,
                      enabled: true,
                    });
                  });
              }
              if (added.length > 0) {
                updateCurrentTicker({
                  enabled: true,
                  items: [...items, ...added],
                });
              }
            }}
          />
          <input
            ref={(el) => {
              txtFolderInputRef.current = el;
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              const txtFiles = files.filter((f) => f.name.toLowerCase().endsWith('.txt'));
              if (txtFiles.length === 0) return;
              const added: TickerScrollItem[] = [];
              for (const f of txtFiles) {
                const rel = (f as any).webkitRelativePath as string | undefined;
                const folderName =
                  rel && rel.includes('/') ? rel.split('/').slice(0, -1).join(' / ') : undefined;
                const txt = await f.text();
                txt
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .forEach((line, idx) => {
                    added.push({
                      id: `txtf-${Date.now()}-${idx}`,
                      title: newTitle.trim() || undefined,
                      text: line,
                      folderName,
                      enabled: true,
                    });
                  });
              }
              if (added.length > 0) {
                updateCurrentTicker({
                  enabled: true,
                  items: [...items, ...added],
                });
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => txtFileInputRef.current?.click()}
              className="py-1 px-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3 h-3 text-cyan-400" />
              <span>+ Import .TXT File</span>
            </button>
            <button
              type="button"
              onClick={() => txtFolderInputRef.current?.click()}
              className="py-1 px-2.5 bg-purple-900/60 hover:bg-purple-800/70 text-purple-200 border border-purple-500/40 rounded text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3 h-3 text-purple-300" />
              <span>+ Import .TXT Folder</span>
            </button>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => updateCurrentTicker({ items: [] })}
              className="py-1 px-2 text-rose-400 hover:text-rose-300 text-[10px] font-bold cursor-pointer"
            >
              Clear All ({items.length})
            </button>
          )}
        </div>
      </div>

      {/* Ticker Items & Folders List */}
      <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
        {Array.from(
          new Set(
            items
              .map((it) => it.folderName)
              .filter((f): f is string => Boolean(f))
          )
        ).map((folderName) => {
          const folderItems = items.filter((it) => it.folderName === folderName);
          const enabledCount = folderItems.filter((it) => it.enabled !== false).length;
          const isFolderEnabled = enabledCount > 0;
          return (
            <div
              key={`ticker-folder-${folderName}`}
              className={`flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] ${
                isFolderEnabled
                  ? 'bg-purple-950/60 border-purple-500/40'
                  : 'bg-zinc-950/80 border-rose-900/60 opacity-75'
              }`}
            >
              <span
                className={`font-bold truncate ${
                  isFolderEnabled ? 'text-purple-200' : 'text-zinc-500 line-through'
                }`}
              >
                📁 {folderName} ({enabledCount}/{folderItems.length} items enabled)
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="flex rounded overflow-hidden border border-zinc-700">
                  <button
                    type="button"
                    onClick={() => {
                      const nextItems = items.map((it) =>
                        it.folderName === folderName ? { ...it, enabled: true } : it
                      );
                      updateCurrentTicker({ enabled: true, items: nextItems });
                      fetch('/api/playout/toggle-enable', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          channelId: channel.id,
                          scope: isTop ? 'top_ticker' : 'bottom_ticker',
                          targetType: 'folder',
                          folderName,
                          enabled: true,
                        }),
                      }).catch(() => {});
                    }}
                    className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                      isFolderEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                    }`}
                  >
                    Enable Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextItems = items.map((it) =>
                        it.folderName === folderName ? { ...it, enabled: false } : it
                      );
                      updateCurrentTicker({ items: nextItems });
                      fetch('/api/playout/toggle-enable', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          channelId: channel.id,
                          scope: isTop ? 'top_ticker' : 'bottom_ticker',
                          targetType: 'folder',
                          folderName,
                          enabled: false,
                        }),
                      }).catch(() => {});
                    }}
                    className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                      !isFolderEnabled
                        ? 'bg-rose-600 text-white'
                        : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                    }`}
                  >
                    Disable Folder
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateCurrentTicker({
                      items: items.filter((it) => it.folderName !== folderName),
                    })
                  }
                  className="text-rose-300 hover:text-rose-200 text-[9px] font-bold cursor-pointer"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 ? (
          <div className="text-center py-6 bg-black/40 rounded-lg border border-zinc-900 text-zinc-500 text-[11px]">
            No items in {isTop ? 'Top' : 'Bottom'} Ticker yet. Enter an optional Title &amp; Text above and click Add.
          </div>
        ) : (
          items.map((item, idx) => {
            const isEditing = editingIdx === idx;
            const isItemEnabled = item.enabled !== false;
            return (
              <div
                key={item.id}
                className={`p-2 rounded-lg border transition ${
                  isItemEnabled
                    ? 'bg-zinc-900/90 border-zinc-700'
                    : 'bg-zinc-950/60 border-rose-950/60 opacity-65'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title (Flash/Breaking spot)"
                        className="sm:col-span-3 bg-black border border-amber-500 rounded px-2 py-1 text-xs text-amber-200"
                      />
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        placeholder="Ticker scroll text..."
                        className="sm:col-span-7 bg-black border border-cyan-500 rounded px-2 py-1 text-xs text-white"
                      />
                      <input
                        type="number"
                        min={0}
                        max={3600}
                        value={editDurationSec || ''}
                        onChange={(e) => setEditDurationSec(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="Dur(s)"
                        className="sm:col-span-2 bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-cyan-200"
                      />
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingIdx(null)}
                        className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-[10px] font-bold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditItem(idx)}
                        className="px-2.5 py-1 bg-emerald-600 text-white rounded text-[10px] font-bold flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {item.title && item.title.trim().length > 0 && (
                        <span className="text-[9px] px-2 py-0.5 rounded font-black uppercase shrink-0 bg-red-600 text-white">
                          {item.title}
                        </span>
                      )}
                      <span
                        className={`text-xs truncate ${
                          isItemEnabled ? 'text-zinc-200' : 'text-zinc-500 line-through'
                        }`}
                      >
                        {item.text}
                      </span>
                      {typeof item.durationSec === 'number' && item.durationSec > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 text-[9px] font-mono shrink-0">
                          {item.durationSec}s
                        </span>
                      )}
                      {item.expiresAt && item.expiresAt > Date.now() && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-500/40 text-amber-300 text-[9px] font-mono shrink-0">
                          Exp {Math.ceil((item.expiresAt - Date.now()) / 60_000)}m
                        </span>
                      )}
                      {item.folderName && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-950 border border-purple-500/40 text-purple-300 text-[9px] font-mono shrink-0">
                          📁 {item.folderName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Per-Item Enable / Disable Buttons */}
                      <div className="flex rounded overflow-hidden border border-zinc-700 mr-1">
                        <button
                          type="button"
                          onClick={() => {
                            const copy = [...items];
                            copy[idx] = { ...copy[idx], enabled: true };
                            updateCurrentTicker({ enabled: true, items: copy });
                            fetch('/api/playout/toggle-enable', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelId: channel.id,
                                scope: isTop ? 'top_ticker' : 'bottom_ticker',
                                targetType: 'file',
                                itemId: item.id,
                                enabled: true,
                              }),
                            }).catch(() => {});
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            isItemEnabled
                              ? 'bg-emerald-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-emerald-300'
                          }`}
                        >
                          Enable
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const copy = [...items];
                            copy[idx] = { ...copy[idx], enabled: false };
                            updateCurrentTicker({ items: copy });
                            fetch('/api/playout/toggle-enable', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelId: channel.id,
                                scope: isTop ? 'top_ticker' : 'bottom_ticker',
                                targetType: 'file',
                                itemId: item.id,
                                enabled: false,
                              }),
                            }).catch(() => {});
                          }}
                          className={`px-2 py-0.5 text-[9px] font-bold cursor-pointer ${
                            !isItemEnabled
                              ? 'bg-rose-600 text-white'
                              : 'bg-zinc-900 text-zinc-400 hover:text-rose-300'
                          }`}
                        >
                          Disable
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditItem(idx)}
                        className="p-1 bg-zinc-800 hover:bg-cyan-600 text-zinc-300 hover:text-white rounded cursor-pointer"
                        title="Edit Title & Text"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveItem(idx, 'up')}
                        className="p-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveItem(idx, 'down')}
                        className="p-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(idx)}
                        className="p-1 bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white rounded cursor-pointer"
                        title="Delete Item"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
