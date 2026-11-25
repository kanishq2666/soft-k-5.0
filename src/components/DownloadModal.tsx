import React, { useEffect, useState } from 'react';
import {
  X,
  Check,
  Copy,
  Download,
  ShieldCheck,
  Trash2,
  MonitorDown,
  Link2,
} from 'lucide-react';
import { TVChannel } from '../types/playout';

interface DownloadModalProps {
  channels: TVChannel[];
  onClose: () => void;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({ onClose }) => {
  const [copiedInstaller, setCopiedInstaller] = useState(false);
  const [copiedUninstaller, setCopiedUninstaller] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const installerPath = '/download/ashokacabletvplayout.settop.exe';
  const uninstallerPath = '/download/Uninstall.exe';
  const installerFullUrl = `${origin}${installerPath}`;
  const uninstallerFullUrl = `${origin}${uninstallerPath}`;

  const copyText = (text: string, setter: (v: boolean) => void) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setter(true);
      setTimeout(() => setter(false), 2200);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Download Windows Software — ashokacabletvplayout.settop.exe"
        className="bg-[#0b111e] border border-slate-700/80 rounded-xl max-w-2xl w-full shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="h-1 w-full bg-gradient-to-r from-sky-600 via-amber-500 to-emerald-500" />

        {/* Header */}
        <div className="px-5 py-3.5 bg-[#101728] border-b border-slate-700/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/assets/ashoka-icon.svg?v=2026.12"
              alt="Ashoka Cable TV Playout Icon"
              className="w-10 h-10 rounded-lg border border-amber-500/60 bg-slate-950 p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white font-mono truncate">
                ashokacabletvplayout.settop.exe
              </h2>
              <p className="text-[11px] text-slate-400">
                Windows Setup Package with Embedded Icon, Desktop App &amp; Uninstaller
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Primary Windows Installer */}
          <div className="rounded-xl bg-[#0f172a] border border-amber-500/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <MonitorDown className="w-4 h-4" />
                <span>Windows Software Installer (.exe with Ashoka Icon)</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">
                Windows 10 / 11 (x64 &amp; x86)
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <a
                href={installerPath}
                download="ashokacabletvplayout.settop.exe"
                className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download ashokacabletvplayout.settop.exe</span>
              </a>

              <button
                type="button"
                onClick={() => copyText(installerFullUrl, setCopiedInstaller)}
                className={`px-3.5 py-2.5 rounded-lg font-mono font-bold border flex items-center justify-center gap-1.5 cursor-pointer transition ${
                  copiedInstaller
                    ? 'bg-emerald-700 border-emerald-500 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                }`}
              >
                {copiedInstaller ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedInstaller ? 'Copied' : 'Copy URL'}</span>
              </button>
            </div>

            <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-amber-300 flex items-center gap-2 overflow-hidden">
              <Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{installerFullUrl}</span>
            </div>
          </div>

          {/* Standalone Windows Uninstaller */}
          <div className="rounded-xl bg-[#0e1422] border border-slate-700/80 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-rose-300">
                <Trash2 className="w-4 h-4" />
                <span>Windows Uninstaller (Included &amp; Standalone)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Removes app, shortcuts &amp; Control Panel entry cleanly
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <a
                href={uninstallerPath}
                download="Uninstall.exe"
                className="flex-1 px-3.5 py-2 rounded-lg bg-rose-700/80 hover:bg-rose-600 border border-rose-500/50 text-white font-bold flex items-center justify-center gap-2 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Uninstall.exe</span>
              </a>

              <a
                href="/download/uninstall.bat"
                download="uninstall.bat"
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-mono font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>uninstall.bat</span>
              </a>

              <button
                type="button"
                onClick={() => copyText(uninstallerFullUrl, setCopiedUninstaller)}
                className={`px-3 py-2 rounded-lg font-mono font-bold border flex items-center justify-center gap-1.5 cursor-pointer transition ${
                  copiedUninstaller
                    ? 'bg-emerald-700 border-emerald-500 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                }`}
              >
                {copiedUninstaller ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUninstaller ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Install / Uninstall Steps */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="font-bold text-white mb-1">1. Download</div>
              <p className="text-slate-400">
                Save <span className="text-amber-300 font-mono break-all">ashokacabletvplayout.settop.exe</span> with embedded Ashoka broadcast icon.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="font-bold text-white mb-1">2. Install</div>
              <p className="text-slate-400">
                Run setup to install locally, create Desktop &amp; Start Menu shortcuts, and launch Ashoka Cable TV Playout.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="font-bold text-white mb-1">3. Uninstall Anytime</div>
              <p className="text-slate-400">
                Uninstall cleanly from Windows Settings / Control Panel, Start Menu, or <span className="text-rose-300 font-mono">Uninstall.exe</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#0a0e18] border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            Ashoka Media Technology • N. N. Kanishq Kumar
          </span>
          <span className="font-mono">© 2026 All Rights Reserved</span>
        </div>
      </div>
    </div>
  );
};
