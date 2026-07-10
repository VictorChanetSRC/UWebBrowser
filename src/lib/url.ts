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

/** Human label for a tab URL: the hostname, or the file name for file: URLs
 *  (which have no host). Falls back to the raw string. Never throws. */
export function tabLabelFor(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "file:") {
      const name = url.pathname.split("/").pop() ?? "";
      try {
        return decodeURIComponent(name) || "Local file";
      } catch {
        return name || "Local file";
      }
    }
    return url.hostname;
  } catch {
    return raw;
  }
}

/** Whether a URL is safe to hand to the tab engine: only real navigable
 *  schemes plus our internal `uwb:`. Mirrors the backend's `check_scheme` so
 *  javascript:/data:/blob: links (e.g. from a feed) are rejected in the UI too
 *  — defence in depth, and it lets us tell the user instead of the backend
 *  silently dropping the request. A bare host / typed fragment with no scheme
 *  is allowed through; the omnibox normalizes those before this is reached. */
export function isNavigableUrl(raw: string): boolean {
  let scheme: string;
  try {
    scheme = new URL(raw).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    return true;
  }
  return scheme === "http" || scheme === "https" || scheme === "file" || scheme === "uwb";
}

/** The Chrome Web Store extension id for a detail-page URL, or null. Works for
 *  both the classic (`chrome.google.com/webstore/detail/…`) and current
 *  (`chromewebstore.google.com/detail/…`) stores by pulling the 32-char id
 *  segment out of the path, so it survives the store redesign. */
export function storeExtensionId(url: string): string | null {
  try {
    const u = new URL(url);
    const store =
      u.hostname === "chromewebstore.google.com" || u.hostname === "chrome.google.com";
    if (!store) return null;
    const seg = u.pathname.split("/").find((s) => /^[a-p]{32}$/.test(s));
    return seg ?? null;
  } catch {
    return null;
  }
}

/** A URL stripped of its scheme and leading `www.`, the way Chrome shows it in
 *  the omnibox and history. One regex, so the two lists can't format it
 *  differently. */
export function formatBareUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "");
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
