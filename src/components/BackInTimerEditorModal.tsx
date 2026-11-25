import React, { useState } from 'react';
import {
  X,
  Clock,
  Sparkles,
  Sliders,
  Type,
  Palette,
  Check,
  Save,
  RotateCcw,
  Eye,
} from 'lucide-react';
import { BackInTimerConfig, BackInTimerStyle } from '../types/playout';

interface BackInTimerEditorModalProps {
  config?: BackInTimerConfig;
  onSave: (updated: BackInTimerConfig) => void;
  onClose: () => void;
}

export const DEFAULT_BACK_IN_TIMER_CONFIG: BackInTimerConfig = {
  enabled: true,
  style: 'split_badge',
  labelText: 'BACK IN',
  position: 'top-left',
  offsetX: 36,
  offsetY: 36,
  fontSize: 26,
  fontFamily: 'Impact, Arial Black, sans-serif',
  labelBgColor: '#cc0000',
  labelTextColor: '#ffffff',
  timerBgColor: '#ffffff',
  timerTextColor: '#000000',
  borderColor: '#ffffff',
  showBorder: true,
  showShadow: true,
  timeFormat: 'mm_ss',
  showDuringAds: true,
  showDuringPrograms: false,
  scale: 1,
};

const FONT_OPTIONS = [
  { label: 'Impact (TV Broadcast Standard)', value: 'Impact, Arial Black, sans-serif' },
  { label: 'Arial Black (Heavy Sans)', value: '"Arial Black", Gadget, sans-serif' },
  { label: 'System UI / Inter (Modern Clean)', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Monospace / Digital Clock', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'Oswald / Condensed Display', value: '"Oswald", "Arial Narrow", sans-serif' },
  { label: 'Trebuchet MS / Dynamic Broadcast', value: '"Trebuchet MS", sans-serif' },
];

export const BackInTimerEditorModal: React.FC<BackInTimerEditorModalProps> = ({
  config,
  onSave,
  onClose,
}) => {
  const [local, setLocal] = useState<BackInTimerConfig>(() => ({
    ...DEFAULT_BACK_IN_TIMER_CONFIG,
    ...(config || {}),
  }));
  const [testTimeSec, setTestTimeSec] = useState<number>(57);
  const [savedToast, setSavedToast] = useState(false);

  const mins = Math.floor(testTimeSec / 60);
  const secs = testTimeSec % 60;
  const timeFormatted =
    local.timeFormat === 'seconds_only'
      ? `${testTimeSec}s`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const handleSave = () => {
    onSave(local);
    setSavedToast(true);
    setTimeout(() => {
      setSavedToast(false);
      onClose();
    }, 600);
  };

  const handleResetDefaults = () => {
    setLocal(DEFAULT_BACK_IN_TIMER_CONFIG);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/90 animate-fade-in font-sans">
      <div className="bg-[#0b0f19] border border-[#233148] w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-xs text-white">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#1c283c] flex items-center justify-between bg-[#0e1422]">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30">
              <Clock className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase flex items-center gap-2">
                <span>BACK IN [00:57] Commercial &amp; Program Countdown Badge</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-600 text-white font-bold">
                  TV BROADCAST
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Calculates total commercial break seconds across all queued ads and displays live countdown at top
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 bg-[#070b14]">
          {/* Live Preview Box */}
          <div className="bg-black/90 border border-[#1e2a40] rounded-xl p-4 flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden shadow-inner">
            <div className="absolute top-2 left-2 text-[10px] font-mono text-slate-500 flex items-center gap-1">
              <Eye className="w-3 h-3 text-slate-400" />
              <span>LIVE OUTPUT PREVIEW (1920×1080 SCALED)</span>
            </div>

            {/* Test Time Adjuster */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 font-mono">Test Seconds:</span>
              <input
                type="number"
                min={1}
                max={600}
                value={testTimeSec}
                onChange={(e) => setTestTimeSec(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-xs text-amber-300 font-mono font-bold"
              />
            </div>

            {/* Render Selected Style in Preview */}
            <div className="my-5 flex items-center justify-center">
              {local.style === 'split_badge' && (
                <div
                  className="inline-flex items-stretch overflow-hidden rounded shadow-2xl transition"
                  style={{
                    border: local.showBorder ? `2px solid ${local.borderColor || '#ffffff'}` : 'none',
                    boxShadow: local.showShadow ? '0 8px 24px rgba(0,0,0,0.85)' : 'none',
                    transform: `scale(${local.scale || 1})`,
                  }}
                >
                  <div
                    className="px-3 py-1 font-black flex items-center justify-center uppercase tracking-wider"
                    style={{
                      backgroundColor: local.labelBgColor || '#cc0000',
                      color: local.labelTextColor || '#ffffff',
                      fontSize: `${local.fontSize || 26}px`,
                      fontFamily: local.fontFamily || 'Impact, sans-serif',
                    }}
                  >
                    {local.labelText || 'BACK IN'}
                  </div>
                  <div
                    className="px-3 py-1 font-black flex items-center justify-center font-mono tracking-tight"
                    style={{
                      backgroundColor: local.timerBgColor || '#ffffff',
                      color: local.timerTextColor || '#000000',
                      fontSize: `${local.fontSize || 26}px`,
                      fontFamily: local.fontFamily || 'Impact, sans-serif',
                    }}
                  >
                    {timeFormatted}
                  </div>
                </div>
              )}

              {local.style === 'glass_pill' && (
                <div
                  className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border shadow-2xl transition"
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.88)',
                    borderColor: local.borderColor || '#38bdf8',
                    boxShadow: local.showShadow ? '0 8px 24px rgba(0,0,0,0.85)' : 'none',
                    transform: `scale(${local.scale || 1})`,
                  }}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span
                    className="font-bold tracking-wider uppercase"
                    style={{
                      color: local.labelTextColor || '#ffffff',
                      fontSize: `${(local.fontSize || 26) * 0.85}px`,
                      fontFamily: local.fontFamily || 'system-ui, sans-serif',
                    }}
                  >
                    {local.labelText || 'BACK IN'}
                  </span>
                  <span
                    className="font-black font-mono tracking-tight"
                    style={{
                      color: local.timerTextColor || '#38bdf8',
                      fontSize: `${local.fontSize || 26}px`,
                      fontFamily: local.fontFamily || 'system-ui, sans-serif',
                    }}
                  >
                    {timeFormatted}
                  </span>
                </div>
              )}

              {local.style === 'news_box' && (
                <div
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md border shadow-2xl transition"
                  style={{
                    backgroundColor: local.labelBgColor || '#1e1b4b',
                    borderColor: local.borderColor || '#a855f7',
                    boxShadow: local.showShadow ? '0 8px 24px rgba(0,0,0,0.85)' : 'none',
                    transform: `scale(${local.scale || 1})`,
                  }}
                >
                  <span className="text-amber-400 font-bold">⏱️</span>
                  <span
                    className="font-black uppercase tracking-wider"
                    style={{
                      color: local.labelTextColor || '#ffffff',
                      fontSize: `${(local.fontSize || 26) * 0.85}px`,
                      fontFamily: local.fontFamily || 'system-ui, sans-serif',
                    }}
                  >
                    {local.labelText || 'PROGRAM RESUMES IN'}
                  </span>
                  <span
                    className="font-black font-mono px-2 py-0.5 rounded bg-black/60"
                    style={{
                      color: local.timerTextColor || '#fbbf24',
                      fontSize: `${local.fontSize || 26}px`,
                      fontFamily: local.fontFamily || 'system-ui, sans-serif',
                    }}
                  >
                    {timeFormatted}
                  </span>
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400">
              Style: <strong className="text-white">{local.style.replace('_', ' ').toUpperCase()}</strong> • Position:{' '}
              <strong className="text-amber-300">{local.position}</strong> (X: {local.offsetX}px, Y: {local.offsetY}px)
            </div>
          </div>

          {/* 1. Design Selector (3 Designs / Styles) */}
          <div className="space-y-2">
            <div className="font-bold text-xs uppercase text-slate-300 flex items-center justify-between">
              <span>1. Choose Badge Design / Style (3 Broadcast Designs)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                {
                  id: 'split_badge' as BackInTimerStyle,
                  title: 'TV Broadcast Split Box',
                  badge: 'AS IN PHOTO',
                  desc: 'Exact match to reference photo: red label box + white timer block with clean border',
                  preview: '[ BACK IN | 00:57 ]',
                },
                {
                  id: 'glass_pill' as BackInTimerStyle,
                  title: 'Modern Neon Glass Pill',
                  badge: 'PREMIUM',
                  desc: 'Rounded dark glass pill with pulsing live red dot and cyan/gold timer readout',
                  preview: '● BACK IN 00:57',
                },
                {
                  id: 'news_box' as BackInTimerStyle,
                  title: 'News / Sports Channel Bar',
                  badge: 'BOLD',
                  desc: 'High-contrast channel banner with timer box: PROGRAM RESUMES IN 00:57',
                  preview: '⏱️ RESUMES IN 00:57',
                },
              ].map((styleOpt) => {
                const isSelected = local.style === styleOpt.id;
                return (
                  <button
                    key={styleOpt.id}
                    type="button"
                    onClick={() => {
                      if (styleOpt.id === 'split_badge') {
                        setLocal((prev) => ({
                          ...prev,
                          style: 'split_badge',
                          labelBgColor: '#cc0000',
                          labelTextColor: '#ffffff',
                          timerBgColor: '#ffffff',
                          timerTextColor: '#000000',
                          borderColor: '#ffffff',
                        }));
                      } else if (styleOpt.id === 'glass_pill') {
                        setLocal((prev) => ({
                          ...prev,
                          style: 'glass_pill',
                          labelTextColor: '#ffffff',
                          timerTextColor: '#38bdf8',
                          borderColor: '#38bdf8',
                        }));
                      } else {
                        setLocal((prev) => ({
                          ...prev,
                          style: 'news_box',
                          labelBgColor: '#1e1b4b',
                          labelTextColor: '#ffffff',
                          timerTextColor: '#fbbf24',
                          borderColor: '#a855f7',
                        }));
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-red-950/40 border-red-500 shadow-lg'
                        : 'bg-[#0f1422] border-[#222e44] hover:border-slate-500 text-slate-300'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-white">{styleOpt.title}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-600 text-white">
                          {styleOpt.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug">{styleOpt.desc}</p>
                    </div>
                    <div className="mt-2 text-center py-1 rounded bg-black/60 font-mono font-bold text-[11px] text-amber-300 border border-slate-800">
                      {styleOpt.preview}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Color Controls & Text Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#0c1220] border border-[#1b263b] rounded-xl p-3">
            {/* Left: Label Settings */}
            <div className="space-y-2.5">
              <div className="font-bold text-slate-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-red-400" />
                <span>Label Box Colors &amp; Text</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400">Badge Text (e.g. BACK IN / PROGRAM IN):</label>
                <input
                  type="text"
                  value={local.labelText}
                  onChange={(e) => setLocal((prev) => ({ ...prev, labelText: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white font-bold"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Label Background:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.labelBgColor || '#cc0000'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, labelBgColor: e.target.value }))}
                      className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={local.labelBgColor || '#cc0000'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, labelBgColor: e.target.value }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] font-mono text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Label Text Color:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.labelTextColor || '#ffffff'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, labelTextColor: e.target.value }))}
                      className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={local.labelTextColor || '#ffffff'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, labelTextColor: e.target.value }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] font-mono text-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Timer Box Colors */}
            <div className="space-y-2.5">
              <div className="font-bold text-slate-300 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-sky-400" />
                <span>Timer Box Colors &amp; Format</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Timer Background:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.timerBgColor || '#ffffff'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, timerBgColor: e.target.value }))}
                      className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={local.timerBgColor || '#ffffff'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, timerBgColor: e.target.value }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] font-mono text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Timer Text Color:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={local.timerTextColor || '#000000'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, timerTextColor: e.target.value }))}
                      className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={local.timerTextColor || '#000000'}
                      onChange={(e) => setLocal((prev) => ({ ...prev, timerTextColor: e.target.value }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] font-mono text-white"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Time Format:</label>
                <div className="flex rounded border border-slate-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setLocal((prev) => ({ ...prev, timeFormat: 'mm_ss' }))}
                    className={`flex-1 py-1 text-[10px] font-bold ${
                      local.timeFormat === 'mm_ss' ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-300'
                    }`}
                  >
                    MM:SS (00:57)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocal((prev) => ({ ...prev, timeFormat: 'seconds_only' }))}
                    className={`flex-1 py-1 text-[10px] font-bold ${
                      local.timeFormat === 'seconds_only' ? 'bg-red-600 text-white' : 'bg-slate-900 text-slate-300'
                    }`}
                  >
                    Seconds Only (57s)
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Font Family, Font Size & Scale Slider */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#0c1220] border border-[#1b263b] rounded-xl p-3">
            <div className="space-y-2">
              <div className="font-bold text-slate-300 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-purple-400" />
                <span>Font Family Selection</span>
              </div>
              <select
                value={local.fontFamily}
                onChange={(e) => setLocal((prev) => ({ ...prev, fontFamily: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="font-bold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Font Size &amp; Badge Scale</span>
                </span>
                <span className="text-[11px] font-mono text-amber-300">
                  {local.fontSize}px ({Math.round((local.scale || 1) * 100)}%)
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-14">Font Size:</span>
                  <input
                    type="range"
                    min={16}
                    max={52}
                    value={local.fontSize}
                    onChange={(e) => setLocal((prev) => ({ ...prev, fontSize: parseInt(e.target.value, 10) }))}
                    className="flex-1 accent-red-500 cursor-pointer"
                  />
                  <span className="w-8 text-right font-mono text-slate-200">{local.fontSize}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-14">Zoom Scale:</span>
                  <input
                    type="range"
                    min={60}
                    max={200}
                    value={Math.round((local.scale || 1) * 100)}
                    onChange={(e) =>
                      setLocal((prev) => ({ ...prev, scale: parseInt(e.target.value, 10) / 100 }))
                    }
                    className="flex-1 accent-amber-500 cursor-pointer"
                  />
                  <span className="w-8 text-right font-mono text-slate-200">
                    {Math.round((local.scale || 1) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Position & Offset Adjustments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#0c1220] border border-[#1b263b] rounded-xl p-3">
            <div className="space-y-2">
              <label className="text-[10px] text-slate-400 block mb-1">Screen Position Corner:</label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  ['top-left', '↖ Top-Left (TV Photo Standard)'],
                  ['top-right', '↗ Top-Right'],
                  ['bottom-left', '↙ Bottom-Left'],
                  ['bottom-right', '↘ Bottom-Right'],
                ].map(([posKey, posLabel]) => (
                  <button
                    key={posKey}
                    type="button"
                    onClick={() => setLocal((prev) => ({ ...prev, position: posKey as any }))}
                    className={`py-1.5 px-2 rounded border text-left text-[10px] font-bold ${
                      local.position === posKey
                        ? 'bg-red-600 text-white border-red-400'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
                    }`}
                  >
                    {posLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] text-slate-400 block mb-1">Fine-tune Offset Margin (Pixels):</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400">Offset X (px):</span>
                  <input
                    type="number"
                    value={local.offsetX}
                    onChange={(e) => setLocal((prev) => ({ ...prev, offsetX: parseInt(e.target.value, 10) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Offset Y (px):</span>
                  <input
                    type="number"
                    value={local.offsetY}
                    onChange={(e) => setLocal((prev) => ({ ...prev, offsetY: parseInt(e.target.value, 10) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 5. Toggles: Show during Ads / Programs */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#0c1220] border border-[#1b263b]">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={local.enabled}
                  onChange={(e) => setLocal((prev) => ({ ...prev, enabled: e.target.checked }))}
                  className="rounded border-slate-700 text-red-600 w-4 h-4 cursor-pointer"
                />
                <span className="font-bold text-white">Enable Countdown Badge on Broadcast</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={local.showDuringAds !== false}
                  onChange={(e) => setLocal((prev) => ({ ...prev, showDuringAds: e.target.checked }))}
                  className="rounded border-slate-700 text-red-600 w-4 h-4 cursor-pointer"
                />
                <span className="text-slate-300">Show during Commercial Ads (Every N Min)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(local.showDuringPrograms)}
                  onChange={(e) => setLocal((prev) => ({ ...prev, showDuringPrograms: e.target.checked }))}
                  className="rounded border-slate-700 text-red-600 w-4 h-4 cursor-pointer"
                />
                <span className="text-slate-300">Show during Programs</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#1c283c] flex items-center justify-between bg-[#0e1422]">
          <div className="flex items-center gap-2 text-slate-400 text-[11px]">
            <span>Status:</span>
            <span className={`font-bold ${local.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
              {local.enabled ? '● ACTIVE ON BROADCAST' : '○ DISABLED'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition cursor-pointer ${
                savedToast ? 'bg-emerald-500 text-black' : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savedToast ? '✓ SAVED!' : 'SAVE BADGE SETTINGS'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
