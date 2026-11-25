export interface SystemDisplayInfo {
  index: number;
  id: string;
  name: string;
  shortLabel: string;
  resolution: string;
  isPrimary: boolean;
  connected: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  nativeScreen?: any;
}

const FIXED_DISPLAY_STORAGE_KEY = 'ashoka_fixed_display_index_v1';
const CACHED_DISPLAYS_STORAGE_KEY = 'ashoka_cached_displays_v1';

let cachedSystemDisplays: SystemDisplayInfo[] = [];

function loadCachedDisplays(): SystemDisplayInfo[] {
  if (cachedSystemDisplays.length > 0) return cachedSystemDisplays;
  try {
    const raw = localStorage.getItem(CACHED_DISPLAYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedSystemDisplays = parsed;
        return cachedSystemDisplays;
      }
    }
  } catch {}
  return [];
}

function saveCachedDisplays(displays: SystemDisplayInfo[]) {
  cachedSystemDisplays = displays;
  try {
    localStorage.setItem(CACHED_DISPLAYS_STORAGE_KEY, JSON.stringify(displays));
  } catch {}
}

export function getCachedDisplayBounds(displayIndex: number): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const safeIdx = Math.max(1, Math.round(displayIndex || 2));
  const win = typeof window !== 'undefined' ? (window as any) : null;
  const screens: any[] = Array.isArray(win?.__ashokaDetectedScreens)
    ? win.__ashokaDetectedScreens
    : [];

  if (screens.length > 0) {
    const scr = screens[Math.min(screens.length - 1, safeIdx - 1)];
    if (scr) {
      return {
        left: typeof scr.availLeft === 'number' ? scr.availLeft : Number(scr.left) || 0,
        top: typeof scr.availTop === 'number' ? scr.availTop : Number(scr.top) || 0,
        width: Number(scr.width) || 1920,
        height: Number(scr.height) || 1080,
      };
    }
  }

  const cached = loadCachedDisplays();
  if (cached.length > 0) {
    const d =
      cached.find((item) => item.index === safeIdx) ||
      cached[Math.min(cached.length - 1, safeIdx - 1)];
    if (d) {
      return {
        left: Number.isFinite(d.left) ? d.left : safeIdx === 1 ? 0 : window.screen?.width || 1920,
        top: Number.isFinite(d.top) ? d.top : 0,
        width: d.width || 1920,
        height: d.height || 1080,
      };
    }
  }

  const primaryW = (typeof window !== 'undefined' && window.screen?.width) || 1920;
  const primaryH = (typeof window !== 'undefined' && window.screen?.height) || 1080;
  return {
    left: safeIdx === 1 ? 0 : primaryW,
    top: 0,
    width: primaryW,
    height: primaryH,
  };
}

export function getSavedFixedDisplayIndex(): number {
  try {
    const raw = localStorage.getItem(FIXED_DISPLAY_STORAGE_KEY);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 8) {
        return parsed;
      }
    }
  } catch {}
  return 2;
}

export function saveFixedDisplayIndex(displayIndex: number): number {
  const clamped = Math.max(1, Math.min(8, Math.round(displayIndex || 2)));
  try {
    localStorage.setItem(FIXED_DISPLAY_STORAGE_KEY, String(clamped));
  } catch {}
  return clamped;
}

/**
 * Builds the 4-Display (or N-Display) list combining OS-level detected displays
 * (/api/system/displays) and Browser Multi-Screen API (window.getScreenDetails).
 */
export async function scanSystemDisplays(
  requestBrowserPermission: boolean = false
): Promise<{
  detectedCount: number;
  displays: SystemDisplayInfo[];
}> {
  let browserScreens: any[] = [];
  let apiDisplays: any[] = [];

  // 1. Query OS-level connected displays from backend (/api/system/displays)
  try {
    const res = await fetch('/api/system/displays');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.displays) && data.displays.length > 0) {
        apiDisplays = data.displays;
      }
    }
  } catch {}

  // 2. Query Browser Window Management / Multi-Screen API (window.getScreenDetails)
  try {
    const win = window as any;
    if (typeof win.getScreenDetails === 'function') {
      let canQuery = requestBrowserPermission;
      if (!canQuery && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'window-management' as PermissionName,
          });
          if (status.state === 'granted') {
            canQuery = true;
          }
        } catch {
          try {
            const statusLegacy = await navigator.permissions.query({
              name: 'window-placement' as any,
            });
            if (statusLegacy.state === 'granted') {
              canQuery = true;
            }
          } catch {}
        }
      }

      if (canQuery) {
        const details = await win.getScreenDetails();
        if (details && Array.isArray(details.screens) && details.screens.length > 0) {
          browserScreens = details.screens;
          win.__ashokaDetectedScreens = details.screens;
        }
      } else if (Array.isArray(win.__ashokaDetectedScreens) && win.__ashokaDetectedScreens.length > 0) {
        browserScreens = win.__ashokaDetectedScreens;
      }
    }
  } catch {}

  const isScreenExtended = Boolean((window.screen as any)?.isExtended);
  const rawDetectedCount = Math.max(
    browserScreens.length,
    apiDisplays.length,
    isScreenExtended ? 2 : 1
  );

  // Always show at least 4 selectable Display Output slots (Display 1, Display 2, Display 3, Display 4)
  // so systems with 2, 3, or 4 display outputs can select & fix any display immediately.
  const totalSlots = Math.max(4, rawDetectedCount);
  const primaryW = window.screen?.width || 1920;
  const primaryH = window.screen?.height || 1080;

  const displays: SystemDisplayInfo[] = [];

  for (let i = 0; i < totalSlots; i++) {
    const num = i + 1;
    const bScr = browserScreens[i];
    const aScr = apiDisplays[i];

    const width = Number(bScr?.width || aScr?.width || (i === 0 ? primaryW : 1920));
    const height = Number(bScr?.height || aScr?.height || (i === 0 ? primaryH : 1080));
    const left =
      typeof bScr?.availLeft === 'number'
        ? bScr.availLeft
        : typeof bScr?.left === 'number'
        ? bScr.left
        : typeof aScr?.left === 'number'
        ? aScr.left
        : i * width;
    const top =
      typeof bScr?.availTop === 'number'
        ? bScr.availTop
        : typeof bScr?.top === 'number'
        ? bScr.top
        : typeof aScr?.top === 'number'
        ? aScr.top
        : 0;
    const isPrimary =
      bScr !== undefined
        ? Boolean(bScr.isPrimary)
        : aScr !== undefined
        ? Boolean(aScr.isPrimary)
        : i === 0;
    const connected = i < rawDetectedCount;

    const customHardwareLabel = bScr?.label ? ` (${bScr.label})` : '';
    const roleDesc =
      num === 1
        ? `Primary Studio Operator Monitor${customHardwareLabel}`
        : `External HDMI / TV Playout Out #${num - 1}${customHardwareLabel}`;

    displays.push({
      index: num,
      id: `display-${num}`,
      name: `Display ${num} — ${roleDesc}`,
      shortLabel: `DISPLAY ${num}`,
      resolution: `${width}×${height}`,
      isPrimary,
      connected,
      left,
      top,
      width,
      height,
      nativeScreen: bScr || undefined,
    });
  }

  saveCachedDisplays(
    displays.map(({ nativeScreen: _ns, ...rest }) => rest)
  );

  return {
    detectedCount: rawDetectedCount,
    displays,
  };
}

/**
 * Requests fullscreen on the specified Fixed Display (Display 1, Display 2, Display 3, or Display 4).
 */
export async function requestFullscreenOnDisplay(
  element: HTMLElement | null,
  displayIndex: number
): Promise<boolean> {
  const targetEl = element || document.documentElement;
  if (!targetEl) return false;

  try {
    const win = window as any;
    let screens: any[] = Array.isArray(win.__ashokaDetectedScreens)
      ? win.__ashokaDetectedScreens
      : [];

    if (screens.length === 0 && typeof win.getScreenDetails === 'function') {
      try {
        let canQuery = false;
        if (navigator.permissions?.query) {
          const st = await navigator.permissions
            .query({ name: 'window-management' as PermissionName })
            .catch(() => null);
          canQuery = st?.state === 'granted';
        }
        if (canQuery) {
          const details = await win.getScreenDetails();
          if (details && Array.isArray(details.screens) && details.screens.length > 0) {
            screens = details.screens;
            win.__ashokaDetectedScreens = screens;
          }
        }
      } catch {}
    }

    if (screens.length > 0) {
      const targetIdx = Math.max(0, Math.min(screens.length - 1, (displayIndex || 1) - 1));
      const targetScreen = screens[targetIdx];
      if (targetScreen) {
        if (document.fullscreenElement && document.fullscreenElement !== targetEl) {
          await document.exitFullscreen().catch(() => {});
        }
        if (!document.fullscreenElement) {
          await (targetEl as any).requestFullscreen({ screen: targetScreen });
        }
        return true;
      }
    }
  } catch {}

  try {
    if (!document.fullscreenElement) {
      await targetEl.requestFullscreen();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a dedicated, clean, standalone fullscreen broadcast output window on a 2nd (or Nth) Display
 * synchronously inside the click gesture so Chrome/Edge never drop user activation.
 */
export async function openDisplayOutputWindow(
  displayIndex: number = 2,
  fitMode: 'fill' | 'contain' = 'fill',
  cleanMode: boolean = false
): Promise<Window | null> {
  // When running inside the installed Windows Desktop Software, launch Monitor 2 natively in borderless --kiosk fullscreen
  // so there is ZERO top browser bar / ZERO tab strip!
  if (
    (window as any).__ASHOKA_INSTALLED_SOFTWARE__ === true ||
    window.location.port === '38550'
  ) {
    try {
      const res = await fetch('/api/display/open-fullscreen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayIndex, fitMode, cleanMode }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          return window;
        }
      }
    } catch {}
  }

  const bounds = getCachedDisplayBounds(displayIndex);
  const { left, top, width, height } = bounds;

  const url = `${window.location.origin}${window.location.pathname}?output=true&display=${displayIndex}&fit=${fitMode}&fullscreen=1${
    cleanMode ? '&clean=true' : ''
  }`;
  const winFeatures = `popup=yes,left=${Math.round(left)},top=${Math.round(top)},width=${Math.round(width)},height=${Math.round(height)},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`;
  const winName = `AshokaDisplayOut_${displayIndex}`;

  const newWin = window.open(url, winName, winFeatures);
  if (newWin) {
    try {
      newWin.moveTo(Math.round(left), Math.round(top));
      newWin.resizeTo(Math.round(width), Math.round(height));
      newWin.focus();
      newWin.addEventListener(
        'load',
        () => {
          try {
            newWin.moveTo(Math.round(left), Math.round(top));
            newWin.resizeTo(Math.round(width), Math.round(height));
            newWin.postMessage({ type: 'ASHOKA_TRY_FULLSCREEN', displayIndex }, window.location.origin);
          } catch {}
        },
        { once: true }
      );
    } catch {}

    // Refresh exact screen bounds in the background (and request permission if needed on extended display)
    scanSystemDisplays(Boolean((window.screen as any)?.isExtended))
      .then(({ displays }) => {
        const targetDisp =
          displays.find((d) => d.index === displayIndex) ||
          displays[Math.min(displays.length - 1, displayIndex - 1)];
        if (targetDisp && !newWin.closed) {
          try {
            newWin.moveTo(Math.round(targetDisp.left), Math.round(targetDisp.top));
            newWin.resizeTo(Math.round(targetDisp.width), Math.round(targetDisp.height));
            newWin.postMessage(
              { type: 'ASHOKA_TRY_FULLSCREEN', displayIndex },
              window.location.origin
            );
          } catch {}
        }
      })
      .catch(() => {});
  }
  return newWin;
}
