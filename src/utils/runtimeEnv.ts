/**
 * Runtime Environment Helper
 * Detects whether Ashoka MSO Playlist is running as the Installed Windows Desktop Software
 * vs. the Web Browser Preview.
 */

export function isInstalledDesktopSoftware(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__ASHOKA_INSTALLED_SOFTWARE__ === true) return true;
  if (window.location.protocol === 'file:') return true;
  if (window.location.search.includes('desktop=1')) return true;
  return false;
}
