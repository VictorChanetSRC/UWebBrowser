/**
 * Per-site zoom memory, like Chrome. WebView2 zoom is per-webview and resets on
 * navigation, so we persist the user's choice keyed by host and re-apply it when
 * a tab loads that host. Values are zoom factors (1 == 100%).
 */
import { loadJson, saveJson } from "./storage";

const KEY = "uwb.zoom";

function load(): Record<string, number> {
  return loadJson(
    [KEY],
    (raw) =>
      raw && typeof raw === "object" ? (raw as Record<string, number>) : null,
    () => ({}),
  );
}

/** The remembered zoom factor for a host, or 1 (100%) if none. */
export function zoomFor(host: string): number {
  if (!host) return 1;
  return load()[host] ?? 1;
}

/** Remember (or, at 100%, forget) a host's zoom factor. */
export function setZoomFor(host: string, factor: number): void {
  if (!host) return;
  const map = load();
  if (Math.abs(factor - 1) < 0.001) {
    delete map[host];
  } else {
    map[host] = factor;
  }
  saveJson(KEY, map);
}
