import React, { useState } from 'react';
import {
  Clock,
  Save,
  Palette,
  Type,
  Sparkles,
  EyeOff,
  Eye,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Layers
} from 'lucide-react';
import { TVChannel, BottomScrollConfig, LogoCornerPosition } from '../types/playout';

interface ClockStudioPanelProps {
  channel: TVChannel;
  onUpdateGraphics: (partial: Partial<BottomScrollConfig>) => void;
  onSaveChannel?: () => void;
}

const CLOCK_FONTS = [
  'JetBrains Mono',
  'Courier New',
  'Inter',
  'Arial Black',
  'Impact',
  'Montserrat',
  'Oswald',
  'Roboto',
  'Verdana',
  'Georgia',
];

const TEXT_COLORS = [
  '#FBBF24',
  '#FFFFFF',
  '#38BDF8',
  '#4ADE80',
  '#F87171',
  '#E879F9',
  '#FB923C',
  '#000000',
];

const DEPTH_3D_COLORS = [
  '#000000',
  '#991B1B',
  '#1E3A8A',
  '#065F46',
  '#581C87',
  '#78350F',
  '#0F172A',
  '#DC2626',
];

const BG_COLORS = [
  '#05070C',
  '#7F1D1D',
  '#1E3A8A',
  '#064E3B',
  '#4C1D95',
  '#78350F',
  '#18181B',
  '#000000',
];

export const ClockStudioPanel: React.FC<ClockStudioPanelProps> = ({
  channel,
  onUpdateGraphics,
  onSaveChannel,
}) => {
  const g = channel.graphics;
  const [savedToast, setSavedToast] = useState(false);

  const clockEnabled = g.clockEnabled !== false;
  const clockFormat = g.clockFormat || (g.clockShowDate === false ? 'time_only' : 'full_day_date_time');
  const clockUse12Hour = !!g.clockUse12Hour;
  const clockShowSeconds = g.clockShowSeconds !== false;
  const clockPosition: LogoCornerPosition = g.clockPosition || 'top-right';
  const clockOffsetX = g.clockOffsetX || 0;
  const clockOffsetY = g.clockOffsetY || 0;
  const clockFontSize = g.clockFontSize || 22;
  const clockFontFamily = g.clockFontFamily || 'JetBrains Mono';
  const clockTextColor = g.clockTextColor || '#FBBF24';
  const clockTextOpacity = g.clockTextOpacity ?? 1;
  const clockIs3D = g.clockIs3D ?? true;
  const clock3DColor = g.clock3DColor || '#000000';
  const clock3DDepth = g.clock3DDepth ?? 3;
  const clockTransparentBg = !!g.clockTransparentBg;
  const clockBgColor = g.clockBgColor || '#05070C';
  const clockBgOpacity = g.clockBgOpacity ?? 0.88;
  const clockShowBorder = g.clockShowBorder !== false;
  const clockBorderColor = g.clockBorderColor || '#FBBF24';
  const clockSpecialStyle = g.clockSpecialStyle || 'standard';

  const handleApplySpecialPreset = (
    style: 'standard' | 'glass_3d' | 'neon_glow' | 'news_badge' | 'gold_3d' | 'minimal_clean'
  ) => {
    if (style === 'minimal_clean') {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'minimal_clean',
        clockTransparentBg: true,
        clockShowBorder: false,
        clockIs3D: true,
        clock3DColor: '#000000',
        clock3DDepth: 4,
        clockTextColor: '#FFFFFF',
      });
    } else if (style === 'glass_3d') {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'glass_3d',
        clockTransparentBg: false,
        clockBgColor: '#090D16',
        clockBgOpacity: 0.85,
        clockShowBorder: true,
        clockBorderColor: '#38BDF8',
        clockIs3D: true,
        clock3DColor: '#082F49',
        clock3DDepth: 3,
        clockTextColor: '#E0F2FE',
      });
    } else if (style === 'neon_glow') {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'neon_glow',
        clockTransparentBg: false,
        clockBgColor: '#05050A',
        clockBgOpacity: 0.9,
        clockShowBorder: true,
        clockBorderColor: '#22D3EE',
        clockIs3D: true,
        clock3DColor: '#0E7490',
        clock3DDepth: 4,
        clockTextColor: '#67E8F9',
      });
    } else if (style === 'news_badge') {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'news_badge',
        clockTransparentBg: false,
        clockBgColor: '#991B1B',
        clockBgOpacity: 0.95,
        clockShowBorder: true,
        clockBorderColor: '#FCA5A5',
        clockIs3D: true,
        clock3DColor: '#450A0A',
        clock3DDepth: 3,
        clockTextColor: '#FFFFFF',
      });
    } else if (style === 'gold_3d') {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'gold_3d',
        clockTransparentBg: false,
        clockBgColor: '#1C1917',
        clockBgOpacity: 0.92,
        clockShowBorder: true,
        clockBorderColor: '#F59E0B',
        clockIs3D: true,
        clock3DColor: '#78350F',
        clock3DDepth: 4,
        clockTextColor: '#FDE047',
      });
    } else {
      onUpdateGraphics({
        clockEnabled: true,
        clockSpecialStyle: 'standard',
        clockTransparentBg: false,
        clockBgColor: '#05070C',
        clockBgOpacity: 0.88,
        clockShowBorder: true,
        clockBorderColor: '#FBBF24',
        clockIs3D: true,
        clock3DColor: '#000000',
        clock3DDepth: 2,
        clockTextColor: '#FBBF24',
      });
    }
  };

  return (
    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 shadow-lg space-y-3 font-mono text-xs text-white">
      {/* Header + ON/OFF + Save */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <div>
            <h3 className="text-xs font-black text-white uppercase">
              CG BROADCAST CLOCK STUDIO (TIME • DATE • DAY • 3D • BG REMOVE)
            </h3>
            <p className="text-[10px] text-zinc-400 font-sans">
              Show Time Only, Date Only, Time &amp; Date, 3D Text, Remove Background &amp; Special CG Styles
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockEnabled: !clockEnabled })}
            className={`px-3 py-1 rounded text-[10px] font-black transition cursor-pointer ${
              clockEnabled
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-700'
            }`}
          >
            {clockEnabled ? '● CLOCK ON AIR' : 'CLOCK OFF'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (onSaveChannel) onSaveChannel();
              setSavedToast(true);
              setTimeout(() => setSavedToast(false), 2000);
            }}
            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-black flex items-center gap-1 shadow cursor-pointer"
          >
            <Save className="w-3 h-3" />
            <span>{savedToast ? '✓ SAVED' : 'SAVE CLOCK'}</span>
          </button>
        </div>
      </div>

      {/* 1. DISPLAY FORMAT: ONLY TIME / TIME & DATE / ONLY DATE / DATE & DAY / DAY & TIME / FULL */}
      <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-amber-400 uppercase">
            1. CLOCK DISPLAY FORMAT (TIME / DATE / DAY OPTIONS):
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onUpdateGraphics({ clockUse12Hour: !clockUse12Hour })}
              className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                clockUse12Hour
                  ? 'bg-amber-600 text-white border-amber-400'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700'
              }`}
            >
              {clockUse12Hour ? '12-Hour (AM/PM)' : '24-Hour'}
            </button>
            <button
              type="button"
              onClick={() => onUpdateGraphics({ clockShowSeconds: !clockShowSeconds })}
              className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                clockShowSeconds
                  ? 'bg-emerald-700 text-white border-emerald-500'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700'
              }`}
            >
              {clockShowSeconds ? 'Seconds: ON' : 'Seconds: OFF'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px]">
          {[
            { id: 'time_only', label: '🕒 Only Time', sub: '18:30:45' },
            { id: 'time_date', label: '🕒📅 Time & Date', sub: '18:30:45 • 27 Sept 2026' },
            { id: 'only_date', label: '📅 Only Date', sub: '27 Sept 2026' },
            { id: 'date_day', label: '📅🗓 Date & Day', sub: 'Sun, 27 Sept 2026' },
            { id: 'day_time', label: '🗓🕒 Day & Time', sub: 'Sun • 18:30:45' },
            { id: 'full_day_date_time', label: '📺 Day, Date & Time', sub: 'Sun, 27 Sept 2026 - 18:30:45' },
          ].map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() =>
                onUpdateGraphics({
                  clockEnabled: true,
                  clockFormat: fmt.id as any,
                  clockShowDate: fmt.id !== 'time_only',
                })
              }
              className={`p-2 rounded border text-left transition cursor-pointer ${
                clockFormat === fmt.id
                  ? 'bg-amber-500/20 border-amber-400 text-white shadow'
                  : 'bg-zinc-900/90 border-zinc-800 text-zinc-300 hover:text-white'
              }`}
            >
              <div className="font-black text-[10px]">{fmt.label}</div>
              <div className="text-[9px] text-zinc-400 truncate mt-0.5">{fmt.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. SPECIAL CLOCK CG STYLES & REMOVE BACKGROUND (TRANSPARENT) */}
      <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-[10px] font-black text-cyan-400 uppercase flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> 2. SPECIAL CLOCK STYLES &amp; REMOVE BACKGROUND:
          </span>

          {/* One-Click Remove Background (Transparent Background) Button */}
          <button
            type="button"
            onClick={() =>
              onUpdateGraphics({
                clockTransparentBg: !clockTransparentBg,
              })
            }
            className={`px-2.5 py-1 rounded text-[10px] font-black flex items-center gap-1 border transition cursor-pointer ${
              clockTransparentBg
                ? 'bg-rose-600 text-white border-rose-400 shadow'
                : 'bg-emerald-700 text-white border-emerald-500'
            }`}
          >
            {clockTransparentBg ? (
              <>
                <EyeOff className="w-3 h-3" />
                <span>✓ BACKGROUND REMOVED (TRANSPARENT)</span>
              </>
            ) : (
              <>
                <Eye className="w-3 h-3" />
                <span>REMOVE BACKGROUND (MAKE TRANSPARENT)</span>
              </>
            )}
          </button>
        </div>

        {/* 6 Special Clock Preset Styles */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-[9px]">
          {[
            { id: 'standard', label: 'Standard Box' },
            { id: 'minimal_clean', label: 'No BG (3D Clean)' },
            { id: 'glass_3d', label: '3D Glass' },
            { id: 'neon_glow', label: 'Neon Glow' },
            { id: 'news_badge', label: 'News Red' },
            { id: 'gold_3d', label: 'Gold 3D' },
          ].map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => handleApplySpecialPreset(st.id as any)}
              className={`py-1.5 px-1 rounded font-bold border transition cursor-pointer ${
                clockSpecialStyle === st.id
                  ? 'bg-cyan-600 text-white border-cyan-300'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. 3D TEXT OPTION, 3D COLOR, TRANSPARENT TEXT & BACKGROUND COLOR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* 3D Text & 3D Color Card */}
        <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-purple-400 uppercase flex items-center gap-1">
              <Layers className="w-3 h-3" /> 3. 3D TEXT &amp; 3D COLOR:
            </span>
            <button
              type="button"
              onClick={() => onUpdateGraphics({ clockIs3D: !clockIs3D })}
              className={`px-2 py-0.5 rounded text-[9px] font-black border cursor-pointer ${
                clockIs3D
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700'
              }`}
            >
              {clockIs3D ? '3D TEXT: ON' : '3D TEXT: OFF'}
            </button>
          </div>

          {/* Text Color */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-300 font-bold">CLOCK TEXT COLOR:</span>
              <input
                type="color"
                value={clockTextColor}
                onChange={(e) => onUpdateGraphics({ clockTextColor: e.target.value })}
                className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateGraphics({ clockTextColor: c })}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded border cursor-pointer ${
                    clockTextColor.toLowerCase() === c.toLowerCase()
                      ? 'border-white scale-110 ring-1 ring-amber-400'
                      : 'border-zinc-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 3D Extrusion / Shadow Color */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-300 font-bold">3D DEPTH / SHADOW COLOR:</span>
              <input
                type="color"
                value={clock3DColor}
                onChange={(e) =>
                  onUpdateGraphics({ clockIs3D: true, clock3DColor: e.target.value })
                }
                className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {DEPTH_3D_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateGraphics({ clockIs3D: true, clock3DColor: c })}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded border cursor-pointer ${
                    clock3DColor.toLowerCase() === c.toLowerCase()
                      ? 'border-white scale-110 ring-1 ring-purple-400'
                      : 'border-zinc-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 3D Depth Slider & Transparent Text Opacity */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <span className="text-[9px] text-zinc-400 block">
                3D Depth: {clock3DDepth}px
              </span>
              <input
                type="range"
                min={1}
                max={8}
                value={clock3DDepth}
                onChange={(e) =>
                  onUpdateGraphics({
                    clockIs3D: true,
                    clock3DDepth: Number(e.target.value),
                  })
                }
                className="w-full accent-purple-500"
              />
            </div>
            <div>
              <span className="text-[9px] text-zinc-400 block">
                Text Transparency: {Math.round(clockTextOpacity * 100)}%
              </span>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(clockTextOpacity * 100)}
                onChange={(e) =>
                  onUpdateGraphics({
                    clockTextOpacity: Number(e.target.value) / 100,
                  })
                }
                className="w-full accent-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Background Color, Remove BG & Font Size Card */}
        <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-emerald-400 uppercase flex items-center gap-1">
              <Palette className="w-3 h-3" /> 4. BACKGROUND &amp; FONT:
            </span>
            <button
              type="button"
              onClick={() => onUpdateGraphics({ clockShowBorder: !clockShowBorder })}
              className={`px-2 py-0.5 rounded text-[9px] font-bold border cursor-pointer ${
                clockShowBorder && !clockTransparentBg
                  ? 'bg-emerald-700 text-white border-emerald-500'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700'
              }`}
            >
              {clockShowBorder ? 'Border: ON' : 'Border: OFF'}
            </button>
          </div>

          {/* Background Color */}
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-zinc-300 font-bold">
                BACKGROUND COLOR {clockTransparentBg ? '(TRANSPARENT)' : ''}:
              </span>
              <input
                type="color"
                value={clockBgColor}
                onChange={(e) =>
                  onUpdateGraphics({
                    clockTransparentBg: false,
                    clockBgColor: e.target.value,
                  })
                }
                className="w-6 h-5 rounded cursor-pointer bg-transparent border-0"
              />
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    onUpdateGraphics({
                      clockTransparentBg: false,
                      clockBgColor: c,
                    })
                  }
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded border cursor-pointer ${
                    !clockTransparentBg && clockBgColor.toLowerCase() === c.toLowerCase()
                      ? 'border-white scale-110 ring-1 ring-emerald-400'
                      : 'border-zinc-700'
                  }`}
                />
              ))}
              <button
                type="button"
                onClick={() => onUpdateGraphics({ clockTransparentBg: true })}
                className={`px-1.5 py-0.5 rounded text-[9px] font-black border cursor-pointer ${
                  clockTransparentBg
                    ? 'bg-rose-600 text-white border-rose-300'
                    : 'bg-zinc-900 text-zinc-300 border-zinc-700'
                }`}
              >
                ✕ No BG
              </button>
            </div>
          </div>

          {/* BG Opacity & Font Family */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-zinc-400 block">
                BG Opacity: {clockTransparentBg ? '0% (No BG)' : `${Math.round(clockBgOpacity * 100)}%`}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={clockTransparentBg ? 0 : Math.round(clockBgOpacity * 100)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdateGraphics({
                    clockTransparentBg: val === 0,
                    clockBgOpacity: val / 100,
                  });
                }}
                className="w-full accent-emerald-500"
              />
            </div>

            <div>
              <span className="text-[9px] text-zinc-400 block">
                Font Size: {clockFontSize}px
              </span>
              <input
                type="range"
                min={14}
                max={52}
                value={clockFontSize}
                onChange={(e) =>
                  onUpdateGraphics({ clockFontSize: Number(e.target.value) })
                }
                className="w-full accent-cyan-500"
              />
            </div>
          </div>

          <div>
            <span className="text-[9px] text-zinc-400 block mb-1 flex items-center gap-1">
              <Type className="w-3 h-3 text-cyan-400" /> CLOCK FONT FAMILY:
            </span>
            <select
              value={clockFontFamily}
              onChange={(e) => onUpdateGraphics({ clockFontFamily: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] font-bold text-white"
            >
              {CLOCK_FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 4. 8-SIDE CLOCK PLACEMENT & MOVE NUDGE */}
      <div className="bg-black/70 p-2.5 rounded-lg border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-blue-400 uppercase">
            5. 8-SIDE CLOCK PLACEMENT &amp; MOVE:
          </span>
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockOffsetX: 0, clockOffsetY: 0 })}
            className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reset X:0, Y:0
          </button>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 text-[9px]">
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
            ] as [LogoCornerPosition, string][]
          ).map(([pos, label]) => (
            <button
              key={pos}
              type="button"
              onClick={() =>
                onUpdateGraphics({
                  clockEnabled: true,
                  clockPosition: pos,
                  clockOffsetX: 0,
                  clockOffsetY: 0,
                })
              }
              className={`py-1.5 rounded font-bold border transition cursor-pointer ${
                clockPosition === pos
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockOffsetX: clockOffsetX - 10 })}
            className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold text-[10px] cursor-pointer"
          >
            ⬅ Move Left
          </button>
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockOffsetY: clockOffsetY - 10 })}
            className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
          >
            <ArrowUp className="w-3 h-3" /> Move Up
          </button>
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockOffsetY: clockOffsetY + 10 })}
            className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" /> Move Down
          </button>
          <button
            type="button"
            onClick={() => onUpdateGraphics({ clockOffsetX: clockOffsetX + 10 })}
            className="py-1 bg-zinc-900 hover:bg-zinc-800 rounded border border-zinc-700 font-bold text-[10px] cursor-pointer"
          >
            Move Right ➡
          </button>
        </div>
      </div>
    </div>
  );
};
