import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Shield,
  Check,
  Sparkles,
  Lock,
  Unlock,
  Key,
  Calendar,
  UserCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  KANISHQ_MASTER_KEY,
  StationLicenseRecord,
  computeLicenseSignature,
  evaluateLicenseStatus,
  formatLicenseDateDisplay,
  generateClientLicenseKey,
} from '../utils/licenseCrypto';

interface LicenseActivationVfxModalProps {
  isLicensed: boolean;
  licenseRecord?: StationLicenseRecord | null;
  onActivateLicense: (active: boolean, updatedRecord?: StationLicenseRecord) => void;
  onUpdateWatermark: (enabled: boolean) => void;
  onSaveChannel?: () => void;
  onClose: () => void;
}

export const LicenseActivationVfxModal: React.FC<LicenseActivationVfxModalProps> = ({
  licenseRecord,
  onActivateLicense,
  onUpdateWatermark,
  onSaveChannel,
  onClose,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Kanishq Master Key Authentication State
  const [showKeyPrompt, setShowKeyPrompt] = useState<boolean>(false);
  const [masterKeyInput, setMasterKeyInput] = useState<string>('');
  const [showMasterPassword, setShowMasterPassword] = useState<boolean>(false);
  const [showClientLicenseKey, setShowClientLicenseKey] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isKanishqUnlocked, setIsKanishqUnlocked] = useState<boolean>(false);

  // Kanishq License Creation Form State (only accessible after entering Kanishq Master Key)
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextYearDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const [clientNameInput, setClientNameInput] = useState<string>(
    licenseRecord?.clientName || 'ASHOKA CABLE TV CLIENT'
  );
  const [startDateInput, setStartDateInput] = useState<string>(
    licenseRecord?.startDate || todayIso
  );
  const [expiryDateInput, setExpiryDateInput] = useState<string>(
    licenseRecord?.expiryDate || nextYearDate
  );
  const [createdLicenseKey, setCreatedLicenseKey] = useState<string>(
    licenseRecord?.licenseKey ||
      generateClientLicenseKey(
        licenseRecord?.clientName || 'ASHOKA CABLE TV CLIENT',
        licenseRecord?.expiryDate || nextYearDate
      )
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Real-time 1-second ticker to evaluate expiry date immediately
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const evaluated = evaluateLicenseStatus(licenseRecord, nowMs);

  const handleVerifyKanishqKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (masterKeyInput.trim() !== KANISHQ_MASTER_KEY) {
      setKeyError('Access Denied! Invalid Kanishq Master Key.');
      return;
    }
    setKeyError(null);
    setIsKanishqUnlocked(true);
    setShowKeyPrompt(false);
    setMasterKeyInput('');
    if (licenseRecord) {
      setClientNameInput(licenseRecord.clientName || '');
      setStartDateInput(licenseRecord.startDate || todayIso);
      setExpiryDateInput(licenseRecord.expiryDate || nextYearDate);
      setCreatedLicenseKey(
        licenseRecord.licenseKey ||
          generateClientLicenseKey(licenseRecord.clientName, licenseRecord.expiryDate)
      );
    }
  };

  const handleGenerateNewLicenseKey = () => {
    const generated = generateClientLicenseKey(clientNameInput, expiryDateInput);
    setCreatedLicenseKey(generated);
  };

  const applyQuickExpiryPreset = (daysToAdd: number) => {
    const base = new Date();
    base.setDate(base.getDate() + daysToAdd);
    const nextExp = base.toISOString().slice(0, 10);
    setExpiryDateInput(nextExp);
    setCreatedLicenseKey(generateClientLicenseKey(clientNameInput, nextExp));
  };

  const handleSaveAndActivateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanClient = clientNameInput.trim();
    const cleanStart = startDateInput.trim() || todayIso;
    const cleanExpiry = expiryDateInput.trim();

    if (!cleanClient) {
      setFormError('Please enter the Software Client Name.');
      return;
    }
    if (!cleanExpiry) {
      setFormError('Please select the Expiry Date (Till Date).');
      return;
    }

    setFormError(null);
    setIsSaving(true);

    const finalKey =
      createdLicenseKey.trim() || generateClientLicenseKey(cleanClient, cleanExpiry);

    const baseRecord = {
      clientName: cleanClient,
      licenseKey: finalKey,
      startDate: cleanStart,
      expiryDate: cleanExpiry,
      isLocked: true,
      activatedAt: new Date().toISOString(),
    };
    const signature = computeLicenseSignature(baseRecord);
    const signedRecord: StationLicenseRecord = {
      ...baseRecord,
      signature,
    };

    try {
      const resp = await fetch('/api/playout/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterKey: KANISHQ_MASTER_KEY,
          clientName: cleanClient,
          licenseKey: finalKey,
          startDate: cleanStart,
          expiryDate: cleanExpiry,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.licenseRecord) {
          const liveEval = evaluateLicenseStatus(data.licenseRecord);
          onActivateLicense(liveEval.isValidAndActive, data.licenseRecord);
          onUpdateWatermark(!liveEval.isValidAndActive);
        } else {
          const liveEval = evaluateLicenseStatus(signedRecord);
          onActivateLicense(liveEval.isValidAndActive, signedRecord);
          onUpdateWatermark(!liveEval.isValidAndActive);
        }
      } else {
        const liveEval = evaluateLicenseStatus(signedRecord);
        onActivateLicense(liveEval.isValidAndActive, signedRecord);
        onUpdateWatermark(!liveEval.isValidAndActive);
      }
    } catch {
      const liveEval = evaluateLicenseStatus(signedRecord);
      onActivateLicense(liveEval.isValidAndActive, signedRecord);
      onUpdateWatermark(!liveEval.isValidAndActive);
    } finally {
      setIsSaving(false);
      // Lock immediately so ONLY Client Name and Expiry Date are shown!
      setIsKanishqUnlocked(false);
      setShowKeyPrompt(false);
      if (onSaveChannel) onSaveChannel();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 select-none overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative z-10 w-full max-w-2xl bg-[#0b121e] border border-slate-700/80 rounded-xl flex flex-col overflow-hidden text-white shadow-2xl">
        {/* Top Status Accent Strip */}
        <div
          className={`h-1 w-full shrink-0 ${
            evaluated.isConfigured && evaluated.isExpired
              ? 'bg-rose-600'
              : evaluated.isConfigured && evaluated.isValidAndActive
              ? 'bg-emerald-500'
              : 'bg-amber-500'
          }`}
        />

        {/* Top Header */}
        <div className="px-5 py-3.5 bg-[#111a2a] border-b border-slate-700/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/assets/ashoka-icon.svg?v=2026.12"
              alt="Ashoka Playout"
              className="w-8 h-8 rounded-lg border border-slate-600 bg-black"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold tracking-wide text-white">
                  {evaluated.isConfigured && !isKanishqUnlocked
                    ? 'Software License Details'
                    : 'Kanishq License Studio'}
                </h2>
                {evaluated.isConfigured && evaluated.isValidAndActive && (
                  <span className="px-2 py-0.5 rounded bg-emerald-600/90 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>ACTIVE</span>
                  </span>
                )}
                {evaluated.isConfigured && evaluated.isExpired && (
                  <span className="px-2 py-0.5 rounded bg-rose-600/90 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>EXPIRED • DEMO MODE</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Kanishq Login button (requires Master Key to unlock) */}
            {!isKanishqUnlocked && (
              <button
                type="button"
                onClick={() => {
                  setShowKeyPrompt(!showKeyPrompt);
                  setKeyError(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow transition cursor-pointer"
              >
                <Key className="w-3.5 h-3.5 text-amber-300" />
                <span>Kanishq Login</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1 shadow transition cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto max-h-[80vh]">

          {/* ================================================================= */}
          {/* CASE 1: LOCKED CLIENT VIEW — ONLY SHOWS CLIENT NAME & EXPIRY DATE */}
          {/* ================================================================= */}
          {evaluated.isConfigured && !isKanishqUnlocked && (
            <div className="space-y-3">
              <div
                className={`rounded-xl p-5 border shadow-xl space-y-4 ${
                  evaluated.isExpired
                    ? 'bg-[#150d12] border-rose-800/80'
                    : 'bg-[#0d1624] border-slate-700/80'
                }`}
              >
                {/* 1. CLIENT NAME */}
                <div className="p-3.5 rounded-lg bg-[#070d18] border border-slate-700/60 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-sky-400 font-bold flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                      <span>CLIENT NAME</span>
                    </div>
                    <div className="text-lg sm:text-xl font-bold text-white tracking-wide mt-1">
                      {evaluated.clientName}
                    </div>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>

                {/* 2. EXPIRY DATE */}
                <div className="p-3.5 rounded-lg bg-[#070d18] border border-slate-700/60 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      <span>EXPIRY DATE</span>
                    </div>
                    <div
                      className={`text-lg sm:text-xl font-mono font-bold tracking-wide mt-1 ${
                        evaluated.isExpired ? 'text-rose-400' : 'text-emerald-300'
                      }`}
                    >
                      {formatLicenseDateDisplay(evaluated.expiryDate)}
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-mono text-xs font-bold ${
                        evaluated.isExpired
                          ? 'bg-rose-900/60 border border-rose-500/80 text-rose-200'
                          : 'bg-emerald-950/80 border border-emerald-500/60 text-emerald-300'
                      }`}
                    >
                      {evaluated.isExpired
                        ? 'EXPIRED • DEMO MODE'
                        : evaluated.remainingText}
                    </span>
                  </div>
                </div>

                {/* Immediate Expiry Alert if Expiry Date is Over */}
                {evaluated.isExpired && (
                  <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-700/80 text-rose-200 text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      License Expiry Date is over. Playout has switched to DEMO mode with watermark overlay.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* CASE 2: UNCONFIGURED & LOCKED — PROMPT FOR KANISHQ LOGIN          */}
          {/* ================================================================= */}
          {!evaluated.isConfigured && !isKanishqUnlocked && !showKeyPrompt && (
            <div className="rounded-xl bg-[#0d1624] border border-slate-700/80 p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-400/30 flex items-center justify-center mx-auto">
                <Shield className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Software Playout DEMO Mode
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Click <span className="text-amber-300 font-bold">Kanishq Login</span> and enter the Master Key to configure Client Name and Expiry Date.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowKeyPrompt(true);
                  setKeyError(null);
                }}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-indigo-400 text-white text-xs font-bold inline-flex items-center gap-2 shadow cursor-pointer transition"
              >
                <Key className="w-4 h-4 text-amber-300" />
                <span>Kanishq Login (Enter Key)</span>
              </button>
            </div>
          )}

          {/* ================================================================= */}
          {/* KANISHQ MASTER KEY PROMPT BOX                                     */}
          {/* ================================================================= */}
          {showKeyPrompt && !isKanishqUnlocked && (
            <form
              onSubmit={handleVerifyKanishqKey}
              className="rounded-xl bg-[#0c1422] border border-slate-700/80 p-4 space-y-3 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Kanishq Master Key Authentication
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  Protected System Security
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold text-slate-300 mb-1.5">
                  Enter Kanishq Master Key:
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showMasterPassword ? 'text' : 'password'}
                      value={masterKeyInput}
                      onChange={(e) => {
                        setMasterKeyInput(e.target.value);
                        setKeyError(null);
                      }}
                      autoFocus
                      placeholder="Enter Master Security Key..."
                      className="w-full bg-black/90 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-xs font-mono font-semibold text-emerald-300 focus:outline-none focus:border-emerald-500 tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMasterPassword(!showMasterPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      title={showMasterPassword ? 'Hide Key' : 'Show Key'}
                    >
                      {showMasterPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow cursor-pointer transition"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>Verify Key &amp; Unlock</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] pt-1.5 text-slate-400">
                  <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    Master Key Protected • Enter your authorized password to configure client station license.
                  </span>
                </div>
              </div>

              {keyError && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{keyError}</span>
                </div>
              )}
            </form>
          )}

          {/* ================================================================= */}
          {/* CASE 3: KANISHQ UNLOCKED STUDIO — FIX CLIENT NAME, CREATE LICENSE */}
          {/*         & SET START DATE TO EXPIRY DATE, THEN SAVE & LOCK         */}
          {/* ================================================================= */}
          {isKanishqUnlocked && (
            <form
              onSubmit={handleSaveAndActivateLicense}
              className="rounded-xl bg-[#0c1422] border border-slate-700/80 p-5 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-emerald-300">
                    Kanishq Verified — Set Client Name, License &amp; Expiry Date
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono font-bold">
                  MASTER UNLOCKED
                </span>
              </div>

              {/* 1. Fix Software Client Name */}
              <div>
                <label className="block text-[11px] font-mono uppercase text-sky-300 font-bold mb-1">
                  1. Software Client Name:
                </label>
                <input
                  type="text"
                  value={clientNameInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setClientNameInput(val);
                    setCreatedLicenseKey(generateClientLicenseKey(val, expiryDateInput));
                  }}
                  placeholder="Enter Client / Cable TV Channel Name..."
                  className="w-full bg-black/90 border border-slate-600 rounded-lg px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* 2. Create / Assign Client License Key */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-mono uppercase text-amber-300 font-bold">
                    2. Client License Key (Created):
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateNewLicenseKey}
                    className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Generate Client License</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showClientLicenseKey ? 'text' : 'password'}
                    value={createdLicenseKey}
                    onChange={(e) => setCreatedLicenseKey(e.target.value)}
                    className="w-full bg-black/90 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-xs font-mono font-bold text-amber-300 tracking-wider focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowClientLicenseKey(!showClientLicenseKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    title={showClientLicenseKey ? 'Hide License Key' : 'Show License Key'}
                  >
                    {showClientLicenseKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* 3. Start Date (From Date) to Expiry Date (Till Date) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-300 font-bold mb-1">
                    3. License Start Date (From Date):
                  </label>
                  <input
                    type="date"
                    value={startDateInput}
                    onChange={(e) => setStartDateInput(e.target.value)}
                    className="w-full bg-black/90 border border-slate-600 rounded-lg px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-emerald-300 font-bold mb-1">
                    4. License Expiry Date (Till Date):
                  </label>
                  <input
                    type="date"
                    value={expiryDateInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExpiryDateInput(val);
                      setCreatedLicenseKey(generateClientLicenseKey(clientNameInput, val));
                    }}
                    className="w-full bg-black/90 border border-emerald-600/70 rounded-lg px-3 py-2 text-xs font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Quick Till Date / Expiry Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-mono text-slate-400 mr-1">
                  Quick Expiry Presets:
                </span>
                {[
                  { label: '+30 Days', days: 30 },
                  { label: '+90 Days', days: 90 },
                  { label: '+6 Months', days: 180 },
                  { label: '+1 Year', days: 365 },
                  { label: '+3 Years', days: 1095 },
                  { label: 'Test Expired (Yesterday)', days: -1 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyQuickExpiryPreset(preset.days)}
                    className={`px-2 py-1 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                      preset.days < 0
                        ? 'bg-rose-950/70 hover:bg-rose-900 border-rose-600/60 text-rose-200'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {formError && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-semibold">
                  {formError}
                </div>
              )}

              {/* Save & Activate License Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 border border-emerald-400 text-white text-xs font-bold flex items-center justify-center gap-2 shadow cursor-pointer transition"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isSaving
                      ? 'Saving & Locking Client License...'
                      : 'Save & Activate License (Lock Client Name & Expiry Date)'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
