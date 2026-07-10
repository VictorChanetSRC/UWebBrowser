/**
 * The internal `uwb://` pages, and the rule that turns whatever a user typed
 * into the omnibox into something to load.
 *
 * This lives outside `App.tsx` so it can be tested without mounting a browser:
 * `normalizeInput` decides between "navigate" and "search" on every single
 * address-bar submit, and getting it wrong either sends a private query to a
 * search engine or refuses to open a real host.
 */

export const HOME_URL = "uwb://home";
export const DISCOVER_URL = "uwb://discover";
export const UNREAL_URL = "uwb://unreal";
export const SETTINGS_URL = "uwb://settings";
export const WORKBAR_URL = "uwb://workbar";
export const TERMINAL_URL = "uwb://terminal";
export const HISTORY_URL = "uwb://history";

/**
 * The `uwb://` pages, in one place. Title, omnibox keywords and render were
 * previously three parallel lists in `App.tsx`, which is exactly the shape that
 * lets a new page get a title but no address, or an address but no tab label.
 *
 * `keywords` are what a typed `uwb://…` is matched against, in list order, so
 * `widget` can alias the work bar. Keep any keyword that is a prefix of another
 * page's keyword *after* that page.
 */
export const INTERNAL_PAGES: { url: string; title: string; keywords: string[] }[] = [
  { url: DISCOVER_URL, title: "Discover", keywords: ["discover"] },
  { url: UNREAL_URL, title: "Unreal", keywords: ["unreal"] },
  { url: SETTINGS_URL, title: "Settings", keywords: ["settings"] },
  { url: WORKBAR_URL, title: "Work bar", keywords: ["workbar", "widget"] },
  { url: TERMINAL_URL, title: "Terminal", keywords: ["term"] },
  { url: HISTORY_URL, title: "History", keywords: ["history"] },
];

/** Tab label for an internal page. Unknown `uwb://` URLs read as a new tab. */
export const internalTitle = (url: string): string =>
  INTERNAL_PAGES.find((page) => page.url === url)?.title ?? "New tab";

/**
 * What the omnibox should load for `raw`: a URL to navigate to, a search URL,
 * or `null` when there's nothing to do. `searchUrl` is injected so this stays
 * independent of the user's engine choice.
 */
export function normalizeInput(raw: string, searchUrl: (query: string) => string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (input.startsWith("uwb:") || input.startsWith("gdb:")) {
    const page = INTERNAL_PAGES.find((p) => p.keywords.some((k) => input.includes(k)));
    return page?.url ?? HOME_URL;
  }
  if (/^(https?|file):\/\//i.test(input)) return input;
  // A local path typed or pasted into the omnibox (C:\dev\page.html). encodeURI
  // covers spaces etc.; # is legal in Windows file names but not in URLs.
  if (/^[a-zA-Z]:[\\/]/.test(input)) {
    return encodeURI(`file:///${input.replace(/\\/g, "/")}`).replace(/#/g, "%23");
  }
  // Dev hosts with no dot — localhost / IP, optionally with a port and path.
  // These would otherwise fall through to search.
  if (
    /^localhost(:\d+)?(\/.*)?$/i.test(input) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(input)
  ) {
    return `http://${input}`;
  }
  // A space-free token that looks like a domain (a dotted name with a letter
  // TLD, optionally a port/path) navigates; otherwise search.
  if (!input.includes(" ") && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(input)) {
    return `https://${input}`;
  }
  return searchUrl(input);
}
