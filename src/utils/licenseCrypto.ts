export const KANISHQ_MASTER_KEY = 'ASHOKA_CABILTV-KANISHQ_36137';

export interface StationLicenseRecord {
  clientName: string;
  licenseKey: string;
  startDate: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  expiryDate: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  isLocked: boolean;
  activatedAt: string;
  signature: string;
}

/**
 * Computes a tamper-proof cryptographic signature bound to KANISHQ_MASTER_KEY.
 * Works identically in Node.js backend and browser frontend.
 */
export function computeLicenseSignature(
  record: Pick<
    StationLicenseRecord,
    'clientName' | 'licenseKey' | 'startDate' | 'expiryDate' | 'isLocked'
  >
): string {
  const raw = [
    KANISHQ_MASTER_KEY,
    (record.clientName || '').trim(),
    (record.licenseKey || '').trim(),
    (record.startDate || '').trim(),
    (record.expiryDate || '').trim(),
    record.isLocked ? 'LOCKED_ACTIVE_1' : 'UNLOCKED_0',
    'ASHOKA_TAMPER_SEAL_2026',
  ].join('||');

  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ ((i + 17) * 31);
    h2 = Math.imul(h2, 0x1000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return `ASHOKA-SIG-${hex1}-${hex2}`;
}

export function verifyLicenseSignature(record?: StationLicenseRecord | null): boolean {
  if (!record || typeof record !== 'object') return false;
  if (!record.clientName || !record.expiryDate || !record.signature) return false;
  const expected = computeLicenseSignature(record);
  return record.signature === expected;
}

export function generateClientLicenseKey(clientName: string, expiryDate: string): string {
  const cleanClient =
    (clientName || 'CLIENT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'CLIENT';
  const cleanExp = (expiryDate || '').replace(/[^0-9]/g, '').slice(0, 8) || '20271231';
  const sigPart = computeLicenseSignature({
    clientName,
    licenseKey: cleanClient,
    startDate: '',
    expiryDate,
    isLocked: true,
  }).slice(-6);
  return `ASHOKA-${cleanClient}-${cleanExp}-${sigPart}`;
}

export function parseExpiryEndTimestampMs(expiryDate: string): number {
  const trimmed = (expiryDate || '').trim();
  if (!trimmed) return 0;
  // If YYYY-MM-DD (date only), expire at 23:59:59.999 local time on that date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
    return dt.getTime();
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseStartTimestampMs(startDate: string): number {
  const trimmed = (startDate || '').trim();
  if (!trimmed) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return dt.getTime();
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface EvaluatedLicenseStatus {
  isValidAndActive: boolean;
  isExpired: boolean;
  isTampered: boolean;
  isConfigured: boolean;
  clientName: string;
  licenseKey: string;
  startDate: string;
  expiryDate: string;
  remainingDays: number;
  remainingText: string;
}

export function evaluateLicenseStatus(
  record?: StationLicenseRecord | null,
  nowMs: number = Date.now()
): EvaluatedLicenseStatus {
  if (!record || !record.isLocked || !record.clientName || !record.expiryDate) {
    return {
      isValidAndActive: false,
      isExpired: false,
      isTampered: false,
      isConfigured: false,
      clientName: record?.clientName || '',
      licenseKey: record?.licenseKey || '',
      startDate: record?.startDate || '',
      expiryDate: record?.expiryDate || '',
      remainingDays: 0,
      remainingText: 'Unlicensed (Demo Mode)',
    };
  }

  const sigOk = verifyLicenseSignature(record);
  if (!sigOk) {
    return {
      isValidAndActive: false,
      isExpired: false,
      isTampered: true,
      isConfigured: false,
      clientName: record.clientName,
      licenseKey: record.licenseKey,
      startDate: record.startDate,
      expiryDate: record.expiryDate,
      remainingDays: 0,
      remainingText: 'Tampered License (Demo Mode)',
    };
  }

  const expiryMs = parseExpiryEndTimestampMs(record.expiryDate);
  if (!expiryMs || nowMs > expiryMs) {
    return {
      isValidAndActive: false,
      isExpired: true,
      isTampered: false,
      isConfigured: true,
      clientName: record.clientName,
      licenseKey: record.licenseKey,
      startDate: record.startDate,
      expiryDate: record.expiryDate,
      remainingDays: 0,
      remainingText: 'EXPIRED — DEMO MODE ACTIVE',
    };
  }

  const diffMs = Math.max(0, expiryMs - nowMs);
  const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const remainingMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  const remainingText =
    remainingDays > 1
      ? `${remainingDays} Days Remaining`
      : remainingDays === 1 && remainingHours > 0
      ? `1 Day ${remainingHours}h Remaining`
      : `${remainingHours}h ${remainingMinutes}m Remaining`;

  return {
    isValidAndActive: true,
    isExpired: false,
    isTampered: false,
    isConfigured: true,
    clientName: record.clientName,
    licenseKey: record.licenseKey,
    startDate: record.startDate,
    expiryDate: record.expiryDate,
    remainingDays,
    remainingText,
  };
}

export function formatLicenseDateDisplay(dateStr?: string): string {
  if (!dateStr) return '—';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${String(d).padStart(2, '0')} ${months[(m || 1) - 1] || ''} ${y}`;
  }
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return trimmed;
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
