/**
 * Windows-only: paint the native title bar (caption + min/max/close) dark so the
 * window follows the OS dark theme.
 *
 * Electrobun 1.18.1 has no API for this — its titlebar/styleMask surface is
 * macOS-only and it never exposes the native HWND. So we reach the window the
 * standard Win32 way: find it by its (unique) title with `FindWindowW`, then set
 * `DWMWA_USE_IMMERSIVE_DARK_MODE` via dwmapi. Everything is wrapped so any
 * failure (non-Windows, missing DLL/symbol, window not found) is a silent no-op
 * and never blocks app startup — worst case the caption stays light.
 *
 * The native window is created asynchronously after `new BrowserWindow`, so we
 * retry the lookup for a couple of seconds until it exists.
 */

// DWMWA_USE_IMMERSIVE_DARK_MODE — attribute id on Windows 10 20H1+ / Windows 11.
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

export function applyWindowsDarkTitleBar(windowTitle: string): void {
  if (process.platform !== 'win32') return;

  try {
    // Imported lazily so non-Windows builds never touch bun:ffi.
    const { dlopen, ptr } = require('bun:ffi');

    const user32 = dlopen('user32.dll', {
      FindWindowW: { args: ['ptr', 'ptr'], returns: 'ptr' },
    });
    const dwmapi = dlopen('dwmapi.dll', {
      DwmSetWindowAttribute: { args: ['ptr', 'u32', 'ptr', 'u32'], returns: 'i32' },
    });

    // Win32 wide-string window title, NUL-terminated (UTF-16LE).
    const titleBuf = Buffer.from(windowTitle + '\0', 'utf16le');
    // A DWORD TRUE (little-endian).
    const enable = new Uint8Array([1, 0, 0, 0]);

    let attempts = 0;
    const tryApply = () => {
      attempts++;
      // lpClassName = NULL, lpWindowName = our title.
      const hwnd = user32.symbols.FindWindowW(null, ptr(titleBuf));
      if (hwnd) {
        dwmapi.symbols.DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ptr(enable), 4);
        return;
      }
      if (attempts < 20) setTimeout(tryApply, 100);
    };
    tryApply();
  } catch (err) {
    console.warn(`dark title bar not applied: ${err instanceof Error ? err.message : String(err)}`);
  }
}
