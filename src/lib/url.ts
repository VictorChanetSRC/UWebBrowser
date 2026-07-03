/** URL helpers shared by the tab strip, omnibox, work bar and password panel,
 *  so host parsing and favicon URLs are spelled one way. */

/** Hostname of a URL, or the raw string if it won't parse (bare hosts, typed
 *  fragments). Never throws. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

/** Google's favicon service for a site, or `""` if the URL has no host.
 *  Callers render a neutral glyph on `onError` — the service can be blocked
 *  offline, and it reveals the host to Google. */
export function faviconUrl(url: string, size = 32): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (!host) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/** Copy text to the clipboard, falling back to a hidden textarea for WebView2,
 *  which can refuse the async clipboard API without focus. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.top = "-9999px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
