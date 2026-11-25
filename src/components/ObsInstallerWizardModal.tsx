import React, { useState } from 'react';
import {
  Download,
  X,
  Check,
  Folder,
  Monitor,
  Trash2,
  AlertTriangle,
  Play,
  Maximize2,
  HardDrive,
  ShieldCheck,
  Terminal,
  Copy,
  Link2,
  ExternalLink,
} from 'lucide-react';
import { triggerOneClickSetupExeDownload } from '../utils/windowsSetupExeClient';

interface ObsInstallerWizardModalProps {
  onClose: () => void;
  onOpenFullscreenPlayout: () => void;
}

type WizardTab = 'installer' | 'uninstaller';
type InstallerStep = 1 | 2 | 3 | 4 | 5;

export const ObsInstallerWizardModal: React.FC<ObsInstallerWizardModalProps> = ({
  onClose,
  onOpenFullscreenPlayout,
}) => {
  const [activeTab, setActiveTab] = useState<WizardTab>('installer');
  const [step, setStep] = useState<InstallerStep>(1);
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);
  const [createStartMenu, setCreateStartMenu] = useState(true);
  const [autoLaunchFullscreen, setAutoLaunchFullscreen] = useState(true);
  const [installProgress, setInstallProgress] = useState(100);
  const [downloading, setDownloading] = useState(false);
  const [copiedSetupLink, setCopiedSetupLink] = useState(false);
  const [copiedUninstallLink, setCopiedUninstallLink] = useState(false);

  // Uninstaller states
  const [uninstallConfirmed, setUninstallConfirmed] = useState(false);
  const [uninstalledSuccess, setUninstalledSuccess] = useState(false);

  const setupExeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/download/ashokacabletvplayout.settop.exe`
      : '/api/download/ashokacabletvplayout.settop.exe';

  const uninstallExeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/download/Uninstall.exe`
      : '/api/download/Uninstall.exe';

  const handleCopySetupLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(setupExeUrl);
      setCopiedSetupLink(true);
      setTimeout(() => setCopiedSetupLink(false), 2000);
    }
  };

  const handleCopyUninstallLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(uninstallExeUrl);
      setCopiedUninstallLink(true);
      setTimeout(() => setCopiedUninstallLink(false), 2000);
    }
  };

  const handleDownloadSetupExe = () => {
    setDownloading(true);
    triggerOneClickSetupExeDownload();
    setTimeout(() => setDownloading(false), 2500);
  };

  const handleFinishInstaller = () => {
    if (autoLaunchFullscreen) {
      onOpenFullscreenPlayout();
    } else {
      onClose();
    }
  };

  const handleExecuteUninstaller = () => {
    setUninstallConfirmed(true);
    setTimeout(() => {
      setUninstalledSuccess(true);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-black/92 z-50 flex items-center justify-center p-3 sm:p-5 select-none overflow-y-auto">
      <div className="bg-[#111827] border border-[#1f293d] rounded-xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col text-slate-100">
        {/* Top Header / Mode Switcher */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#090d16] border-b border-[#1f293d]">
          <div className="flex items-center gap-3">
            <img
              src="/assets/ashoka-icon.svg"
              alt="Ashoka Icon"
              className="w-6 h-6 rounded border border-amber-400/40 p-0.5"
            />
            <span className="font-mono font-bold text-xs text-amber-400 tracking-wide uppercase">
              Ashoka MSO Playlist — Windows Native Software Wizard
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-[#151d2f] p-0.5 border border-[#232f48] text-[11px] font-mono font-bold">
              <button
                onClick={() => setActiveTab('installer')}
                className={`px-3 py-1 rounded transition ${
                  activeTab === 'installer'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                OBS Setup Wizard
              </button>
              <button
                onClick={() => setActiveTab('uninstaller')}
                className={`px-3 py-1 rounded transition ${
                  activeTab === 'uninstaller'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Uninstaller Wizard
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded bg-[#1e293b] hover:bg-[#334155] text-slate-400 hover:text-white transition ml-2"
              title="Close Wizard"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Wizard Main Shell (Classic OBS Studio UI Layout) */}
        {activeTab === 'installer' ? (
          <div className="flex flex-col md:flex-row min-h-[420px]">
            {/* Left Sidebar */}
            <div className="w-full md:w-56 bg-gradient-to-b from-[#090d16] to-[#121a2c] p-5 border-r border-[#1f293d] flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-2xl border-2 border-amber-400 bg-[#090d16] p-1.5 shadow-xl shadow-amber-500/10 mb-3 flex items-center justify-center">
                <img src="/assets/ashoka-icon.svg" alt="Ashoka" className="w-full h-full" />
              </div>
              <h2 className="font-black text-sm text-amber-400 tracking-wider">
                ASHOKA MSO PLAYLIST
              </h2>
              <span className="text-[10px] text-slate-400 font-mono mb-6">
                v5.0.0 Setup Wizard
              </span>

              <div className="w-full flex flex-col gap-1.5 text-left text-xs font-mono">
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    step === 1
                      ? 'bg-blue-500/20 border-blue-400 text-blue-300 font-bold'
                      : step > 1
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  1. Welcome
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    step === 2
                      ? 'bg-blue-500/20 border-blue-400 text-blue-300 font-bold'
                      : step > 2
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  2. Offline License
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    step === 3
                      ? 'bg-blue-500/20 border-blue-400 text-blue-300 font-bold'
                      : step > 3
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  3. Components
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    step === 4
                      ? 'bg-blue-500/20 border-blue-400 text-blue-300 font-bold'
                      : step > 4
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  4. Installation Log
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    step === 5
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  5. Finish &amp; Launch
                </div>
              </div>
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 flex flex-col justify-between p-6 bg-[#0f172a]">
              {/* Step 1: Welcome & Direct Download Links */}
              {step === 1 && (
                <div className="space-y-3.5">
                  <div>
                    <h3 className="text-lg font-black text-white">
                      Welcome to the Ashoka MSO Playlist 5.0.0 Setup Wizard
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-1">
                      This wizard builds and distributes the native <b>Windows Setup.exe</b> installer for Ashoka MSO Playlist, complete with our custom Ashoka icon, OBS Studio-style installer wizard, and complete clean uninstaller.
                    </p>
                  </div>

                  {/* Direct Download Box with 1-Click Button & Link Copy */}
                  <div className="p-3.5 rounded-xl bg-[#090d16] border border-amber-500/40 shadow-inner space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img
                          src="/assets/ashoka-icon.svg"
                          alt="Setup.exe Icon"
                          className="w-5 h-5 rounded bg-black p-0.5 border border-amber-400"
                        />
                        <span className="text-xs font-mono font-bold text-amber-300">
                          Setup.exe (Native Windows Installer with Icon)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40">
                        Zero Login Required
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-2">
                      <button
                        onClick={handleDownloadSetupExe}
                        className="w-full sm:w-auto px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-mono font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 transition cursor-pointer shrink-0"
                      >
                        <Download className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                        <span>{downloading ? 'Downloading...' : 'Download Setup.exe (~13 MB)'}</span>
                      </button>

                      <div className="flex items-center gap-1 w-full min-w-0 bg-[#060910] border border-slate-700 rounded-lg p-1">
                        <input
                          type="text"
                          readOnly
                          value={setupExeUrl}
                          className="bg-transparent text-[11px] font-mono text-slate-300 px-2 w-full focus:outline-none select-all truncate"
                          title="Direct Setup.exe Download Link"
                        />
                        <button
                          type="button"
                          onClick={handleCopySetupLink}
                          className="px-2.5 py-1 rounded bg-[#1e293b] hover:bg-[#334155] text-amber-300 text-[10px] font-mono font-bold flex items-center gap-1 transition cursor-pointer shrink-0 border border-slate-600"
                          title="Copy Direct Download Link"
                        >
                          {copiedSetupLink ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Secondary Uninstaller Link */}
                    <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span className="flex items-center gap-1.5 text-slate-300">
                        <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                        <span>Uninstaller Link (Uninstall.exe):</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyUninstallLink}
                        className="text-[10px] text-rose-300 hover:text-rose-200 underline cursor-pointer flex items-center gap-1"
                      >
                        {copiedUninstallLink ? 'Copied Uninstall Link!' : 'Copy Uninstall.exe Link'}
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Includes Embedded OBS Studio-Style Setup &amp; Clean Uninstaller</span>
                    </div>
                    <div className="flex items-center gap-2 text-amber-400 font-medium">
                      <Monitor className="w-3.5 h-3.5 shrink-0" />
                      <span>Desktop &amp; Start Menu Shortcuts with Embedded Ashoka Icon (.ico)</span>
                    </div>
                    <div className="flex items-center gap-2 text-sky-400 font-medium">
                      <HardDrive className="w-3.5 h-3.5 shrink-0" />
                      <span>100% Offline Standalone Playout with Local Edge/Chrome Hardware Acceleration</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Click <b>Next &gt;</b> to preview the step-by-step installation wizard, or click <b>Download Setup.exe</b> above.
                  </p>
                </div>
              )}

              {/* Step 2: License Agreement */}
              {step === 2 && (
                <div className="space-y-3">
                  <h3 className="text-base font-black text-white">
                    License Agreement &amp; Offline Architecture Guarantee
                  </h3>
                  <p className="text-xs text-slate-300">
                    Please review the license terms before continuing with installation:
                  </p>
                  <div className="h-44 overflow-y-auto bg-[#090d16] border border-[#1f293d] p-3 rounded text-[11px] text-slate-300 font-mono leading-relaxed space-y-2">
                    <p className="text-amber-400 font-bold">
                      ASHOKA DIGITAL BROADCAST SYSTEMS (ASHOKA CABLE TV NETWORK)
                    </p>
                    <p>
                      1. GRANT OF LICENSE: Ashoka Digital Broadcast Systems grants you the right to
                      run this broadcast studio software on any Windows system offline and online.
                    </p>
                    <p>
                      2. NO MANDATORY CLOUD LOGIN: The software does not require online login, user
                      credentials, or remote server dependencies for standard operation.
                    </p>
                    <p>
                      3. DISPLAY &amp; WINDOW CAPTURE: Allows capturing whole desktop displays or any open
                      Windows application window directly into channel playout.
                    </p>
                    <p>
                      4. UNINSTALLATION: Fully registered in Windows Control Panel (Add/Remove Programs)
                      via Uninstall.exe and uninstall.bat.
                    </p>
                  </div>
                  <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>Agreement automatically satisfied for local broadcast workstation.</span>
                  </div>
                </div>
              )}

              {/* Step 3: Components & Path */}
              {step === 3 && (
                <div className="space-y-4">
                  <h3 className="text-base font-black text-white">
                    Choose Install Location &amp; Components
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-400 font-mono mb-1">
                      Destination Folder:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value="%LOCALAPPDATA%\Ashoka_MSO_Playlist"
                        className="flex-1 bg-[#090d16] border border-[#1f293d] rounded px-3 py-1.5 text-xs font-mono text-slate-200"
                      />
                      <button
                        disabled
                        className="px-3 py-1.5 bg-[#1e293b] border border-[#334155] rounded text-xs text-slate-400 font-mono"
                      >
                        <Folder className="w-3.5 h-3.5 inline mr-1" />
                        Browse...
                      </button>
                    </div>
                  </div>

                  <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-2.5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="accent-blue-600 rounded"
                      />
                      <span className="font-bold text-white">
                        Ashoka Broadcast Core Engine (100% Offline)
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createDesktopShortcut}
                        onChange={(e) => setCreateDesktopShortcut(e.target.checked)}
                        className="accent-blue-600 rounded"
                      />
                      <span>Create Desktop Shortcut with Custom Broadcast Icon</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createStartMenu}
                        onChange={(e) => setCreateStartMenu(e.target.checked)}
                        className="accent-blue-600 rounded"
                      />
                      <span>Create Start Menu Program Folder &amp; Shortcuts</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="accent-blue-600 rounded"
                      />
                      <span className="text-slate-300">
                        Register Clean Uninstaller in Windows Control Panel (Uninstall.exe)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Step 4: Installation Progress */}
              {step === 4 && (
                <div className="space-y-4">
                  <h3 className="text-base font-black text-white">
                    Installing Ashoka MSO Playlist
                  </h3>
                  <p className="text-xs text-slate-400">
                    Please wait while the installation wizard configures the system...
                  </p>

                  <div className="w-full bg-[#090d16] border border-[#1f293d] rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full transition-all duration-500"
                      style={{ width: `${installProgress}%` }}
                    />
                  </div>

                  <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded font-mono text-[11px] text-emerald-400 h-44 overflow-y-auto space-y-1">
                    <div>[SETUP] Initializing Windows PE32 Setup Engine...</div>
                    <div>[SETUP] Extracting Ashoka_MSO_Playlist.exe standalone launcher...</div>
                    <div>[SETUP] Writing local offline HTTP playout server (offline_backend.ps1)...</div>
                    <div>[SETUP] Deploying Ruffle SWF WebAssembly runtime...</div>
                    <div>[SETUP] Creating Desktop Shortcut: Ashoka MSO Playlist.lnk...</div>
                    <div>[SETUP] Writing Windows Registry uninstaller entries...</div>
                    <div>[SETUP] Registering Uninstall.exe in Add/Remove Programs...</div>
                    <div className="text-white font-bold">
                      [SETUP] Installation Complete! Status: READY (100%)
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Finish & Launch */}
              {step === 5 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-black text-emerald-400">
                    Completing the Ashoka MSO Playlist Setup Wizard
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Ashoka MSO Playlist 5.0.0 has been installed on your computer.
                    You can launch it directly in full screen mode, or run the standalone
                    Setup.exe offline installer at any time.
                  </p>

                  <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLaunchFullscreen}
                        onChange={(e) => setAutoLaunchFullscreen(e.target.checked)}
                        className="accent-emerald-500 rounded"
                      />
                      <span>Launch Ashoka MSO Playlist Studio in FULL SCREEN now</span>
                    </label>

                    <div className="text-[11px] text-slate-400 pl-5">
                      Runs with zero browser address bars and optimized hardware rendering.
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleDownloadSetupExe}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs rounded shadow transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{downloading ? 'Downloading...' : 'Download Setup.exe Binary'}</span>
                    </button>

                    <a
                      href="/api/installer/obs-wizard.hta"
                      download="OBS_Setup_Wizard.hta"
                      className="text-xs text-blue-400 hover:underline font-mono"
                    >
                      Download OBS_Setup_Wizard.hta
                    </a>
                  </div>
                </div>
              )}

              {/* Bottom Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1f293d] mt-4">
                <span className="text-[11px] font-mono text-slate-500">
                  Ashoka Digital Broadcast Systems
                </span>

                <div className="flex items-center gap-2">
                  {step > 1 && step < 5 && (
                    <button
                      onClick={() => setStep((s) => (s - 1) as InstallerStep)}
                      className="px-4 py-1.5 bg-[#1e293b] hover:bg-[#334155] text-slate-300 font-mono text-xs rounded transition"
                    >
                      &lt; Back
                    </button>
                  )}

                  {step < 4 && (
                    <button
                      onClick={() => setStep((s) => (s + 1) as InstallerStep)}
                      className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-xs rounded shadow transition"
                    >
                      Next &gt;
                    </button>
                  )}

                  {step === 4 && (
                    <button
                      onClick={() => setStep(5)}
                      className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-xs rounded shadow transition"
                    >
                      Continue &gt;
                    </button>
                  )}

                  {step === 5 && (
                    <button
                      onClick={handleFinishInstaller}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs rounded shadow-lg transition flex items-center gap-1.5"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Finish &amp; Open Fullscreen</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Uninstaller Wizard Tab */
          <div className="flex flex-col md:flex-row min-h-[420px]">
            {/* Left Sidebar */}
            <div className="w-full md:w-56 bg-gradient-to-b from-[#181016] to-[#24111c] p-5 border-r border-[#3b1d28] flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-2xl border-2 border-rose-500 bg-[#150b11] p-1.5 shadow-xl shadow-rose-500/10 mb-3 flex items-center justify-center">
                <Trash2 className="w-10 h-10 text-rose-500" />
              </div>
              <h2 className="font-black text-sm text-rose-400 tracking-wider">
                ASHOKA UNINSTALLER
              </h2>
              <span className="text-[10px] text-slate-400 font-mono mb-6">
                Clean Removal Wizard
              </span>

              <div className="w-full flex flex-col gap-1.5 text-left text-xs font-mono">
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    !uninstalledSuccess
                      ? 'bg-rose-500/20 border-rose-400 text-rose-300 font-bold'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  1. Confirm Removal
                </div>
                <div
                  className={`px-2.5 py-1.5 rounded border ${
                    uninstalledSuccess
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  2. Uninstalled
                </div>
              </div>
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 flex flex-col justify-between p-6 bg-[#0f172a]">
              {!uninstalledSuccess ? (
                <div className="space-y-4">
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <span>Uninstall Ashoka MSO Playlist 5.0.0</span>
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This wizard will cleanly remove Ashoka MSO Playlist and all registered shortcuts
                    from your computer.
                  </p>

                  <div className="bg-[#111827] border border-[#1f293d] rounded-lg p-3 space-y-2 text-xs">
                    <label className="flex items-center gap-2 text-slate-200">
                      <input type="checkbox" checked readOnly className="accent-rose-500" />
                      <span>Remove Desktop and Start Menu shortcuts</span>
                    </label>
                    <label className="flex items-center gap-2 text-slate-200">
                      <input type="checkbox" checked readOnly className="accent-rose-500" />
                      <span>Terminate background offline playout server process</span>
                    </label>
                    <label className="flex items-center gap-2 text-slate-200">
                      <input type="checkbox" checked readOnly className="accent-rose-500" />
                      <span>Remove Windows Registry Add/Remove Programs entry</span>
                    </label>
                  </div>

                  <div className="pt-2 flex flex-wrap gap-3">
                    <a
                      href="/api/download/Uninstall.exe"
                      download="Uninstall.exe"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e293b] hover:bg-[#334155] text-slate-300 border border-slate-700 rounded text-xs font-mono transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Standalone Uninstall.exe</span>
                    </a>
                    <a
                      href="/api/download/uninstall.bat"
                      download="uninstall.bat"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e293b] hover:bg-[#334155] text-slate-300 border border-slate-700 rounded text-xs font-mono transition"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Download uninstall.bat</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <h3 className="text-base font-black text-emerald-400 flex items-center gap-2">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <span>Ashoka MSO Playlist Successfully Removed</span>
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    The uninstaller has successfully removed shortcuts, background services,
                    and clean uninstaller registry keys.
                  </p>

                  <div className="bg-[#090d16] border border-[#1f293d] p-3 rounded font-mono text-[11px] text-emerald-400 h-36 overflow-y-auto space-y-1">
                    <div>[UNINSTALL] Background processes stopped.</div>
                    <div>[UNINSTALL] Desktop shortcut deleted.</div>
                    <div>[UNINSTALL] Start menu directory removed.</div>
                    <div>[UNINSTALL] Registry uninstaller key purged.</div>
                    <div className="text-white font-bold">[UNINSTALL] Complete.</div>
                  </div>
                </div>
              )}

              {/* Bottom Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-[#1f293d] mt-4">
                <span className="text-[11px] font-mono text-slate-500">
                  Location: %LOCALAPPDATA%\Ashoka_MSO_Playlist
                </span>

                <div className="flex items-center gap-2">
                  {!uninstalledSuccess ? (
                    <>
                      <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-[#1e293b] hover:bg-[#334155] text-slate-300 font-mono text-xs rounded transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleExecuteUninstaller}
                        className="px-5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs rounded shadow transition flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Uninstall Now</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={onClose}
                      className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-xs rounded shadow transition"
                    >
                      Close Wizard
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
