// Browser storage is a per-viewer convenience only; every access is guarded.
export function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}
