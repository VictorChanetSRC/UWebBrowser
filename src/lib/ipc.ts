import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlatformHit } from "./platforms";

export type TabEventPayload = {
  id: string;
  /** - "new-tab": a URL the page asked to open in a new tab
   *    (window.open / target="_blank"); `id` is the opener tab.
   *  - "shortcut": a browser accelerator (Ctrl+T, F5, …) pressed while the
   *    native page had focus; `value` is the action name (see App.tsx).
   *  - "zoom": the page zoom changed natively; `value` is the percent.
   *  - "crashed": the tab's renderer process died (show a reload panel).
   *  - "favicon": the page's real favicon URL.
   *  - "download": JSON `{ id, state: "start"|"progress"|"done"|"fail"|
   *    "cancel", name, path, url, received, total }` — `total` is -1 when the
   *    server sent no content length.
   *  - "external-url": a deep link (mailto:, steam://, …) the page tried to
   *    open; `value` is the URL. Confirm, then `openExternal`.
   *  - "permission": JSON `{ id, kind: "camera"|"microphone"|"geolocation"|
   *    "notifications"|"clipboard", origin }` — answer with `permissionRespond`.
   *  - "basic-auth": JSON `{ id, origin, challenge }` — answer with
   *    `basicAuthRespond` (omit creds to cancel).
   *  - "cert-error": JSON `{ id, url, code }` — a TLS cert error; answer with
   *    `certRespond`.
   *  - "nav-error": JSON `{ url, code }` — a failed main-frame navigation
   *    (DNS/refused/timeout); draw a branded error page.
   *  - "nav-state": JSON `{ back, forward }` — session-history availability, to
   *    grey the toolbar arrows. */
  kind:
    | "title"
    | "url"
    | "loading"
    | "new-tab"
    | "shortcut"
    | "zoom"
    | "crashed"
    | "favicon"
    | "download"
    | "external-url"
    | "permission"
    | "basic-auth"
    | "cert-error"
    | "nav-error"
    | "nav-state";
  value: string;
};

/**
 * Coalesce concurrent identical calls: while a request for `key` is in flight,
 * later callers share the same promise instead of issuing a duplicate. Combined
 * with the backend TTL caches, co-mounted widgets that poll the same data
 * (e.g. a Game tile and a Steam sidebar widget for one app) hit the network
 * once per tick rather than N times.
 */
const inflight = new Map<string, Promise<unknown>>();
function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** A chunk of PTY output for one terminal session. */
export type TermOutputPayload = { id: string; data: string };

/** The shell of a terminal session exited; `code` is null if unknowable. */
export type TermExitPayload = { id: string; code: number | null };

export const ipc = {
  createTab: (id: string, url: string) => invoke("create_tab", { id, url }),
  navigateTab: (id: string, url: string) => invoke("navigate_tab", { id, url }),
  closeTab: (id: string) => invoke("close_tab", { id }),
  activateTab: (id: string | null) => invoke("activate_tab", { id }),
  goBack: (id: string) => invoke("tab_eval", { id, js: "history.back()" }),
  goForward: (id: string) => invoke("tab_eval", { id, js: "history.forward()" }),
  reload: (id: string) => invoke("tab_eval", { id, js: "location.reload()" }),
  stop: (id: string) => invoke("tab_eval", { id, js: "window.stop()" }),
  /** Find-in-page via Chromium's window.find; steps matches as the bar is used. */
  tabFind: (id: string, query: string, forward: boolean, fromStart: boolean) =>
    invoke("tab_find", { id, query, forward, fromStart }),
  /** Set a tab's zoom factor (1.0 == 100%). */
  tabZoom: (id: string, factor: number) => invoke("tab_zoom", { id, factor }),
  /** Open the native (floating) Chromium DevTools window — internal fallback. */
  tabDevtools: (id: string) => invoke("tab_devtools", { id }),
  /** Open/re-target the *docked* DevTools panel over a tab (the real inspector). */
  devtoolsOpen: (id: string) => invoke("devtools_open", { id }),
  /** Hide the docked DevTools panel; the page reclaims the full area. */
  devtoolsClose: () => invoke("devtools_close"),
  /** Dock the panel to the "bottom" or "right" edge. */
  devtoolsSetDock: (dock: "bottom" | "right") => invoke("devtools_set_dock", { dock }),
  /** Resize the panel to a fraction (0.15–0.85) of the content area. */
  devtoolsSetSize: (size: number) => invoke("devtools_set_size", { size }),
  /** Open WebView2's built-in print preview for a tab (Ctrl+P). */
  tabPrint: (id: string) => invoke("tab_print", { id }),
  /** Hand a deep link (mailto:, steam://, …) to the OS after the user confirms. */
  openExternal: (url: string) => invoke("open_external", { url }),
  /** Answer a permission prompt (camera/mic/geo/notifications/clipboard). */
  permissionRespond: (id: string, allow: boolean) =>
    invoke("permission_respond", { id, allow }),
  /** Answer an HTTP basic-auth prompt; omit creds to cancel the load. */
  basicAuthRespond: (id: string, username: string | null, password: string | null) =>
    invoke("basic_auth_respond", { id, username, password }),
  /** Resolve a certificate-error interstitial: proceed anyway, or cancel. */
  certRespond: (id: string, proceed: boolean) => invoke("cert_respond", { id, proceed }),
  /** The tab's live document URL — tracks History-API (SPA) navigations that
   *  fire no page-load event. */
  tabLiveUrl: (id: string) => invoke<string>("tab_live_url", { id }),
  /** Cancel an in-progress download by its id. */
  downloadCancel: (id: string) => invoke("download_cancel", { id }),
  /** Open a finished download with its default application. */
  downloadOpen: (path: string) => invoke("download_open", { path }),
  /** Reveal a finished download in the file manager, selected. */
  downloadShow: (path: string) => invoke("download_show", { path }),
  setContentInsets: (top: number, left: number, right: number) =>
    invoke("set_content_insets", { top, left, right }),
  clearBrowsingData: () => invoke("clear_browsing_data"),
  /** Installed Chrome extensions, for the pinned bar (Windows/WebView2 only). */
  extList: () => invoke<ExtInfo[]>("ext_list"),
  /** Copy an unpacked extension folder into the store and install it live. */
  extImport: (source: string) => invoke<ExtInfo[]>("ext_import", { source }),
  /** Install straight from the Chrome Web Store by extension id. */
  extInstallFromStore: (id: string) => invoke<ExtInfo[]>("ext_install_from_store", { id }),
  /** Uninstall an extension by runtime id (removes it and deletes its folder). */
  extUninstall: (id: string) => invoke<ExtInfo[]>("ext_uninstall", { id }),
  /** Float an extension's popup as a child webview (logical px coordinates). */
  extOpenPopup: (
    id: string,
    popup: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => invoke("ext_open_popup", { id, popup, x, y, width, height }),
  extClosePopup: () => invoke("ext_close_popup"),
  steamStats: (appid: string) =>
    coalesce(`steam_stats:${appid}`, () => invoke<SteamStats>("steam_stats", { appid })),
  steamPlayers: (appid: string) =>
    coalesce(`steam_players:${appid}`, () =>
      invoke<number | null>("steam_players", { appid }),
    ),
  redditSearch: (query: string) =>
    coalesce(`reddit:${query}`, () => invoke<RedditPost[]>("reddit_search", { query })),
  itchGames: (apiKey: string) =>
    coalesce(`itch:${apiKey}`, () => invoke<ItchGame[]>("itch_games", { apiKey })),
  /** Lifetime earnings from itch, plus the daily history we measure ourselves. */
  itchEarnings: (apiKey: string) =>
    coalesce(`itch-earnings:${apiKey}`, () => invoke<ItchEarnings>("itch_earnings", { apiKey })),
  /** Whether a Steamworks publisher key is on file. Never returns the key. */
  steamSalesStatus: () => invoke<SalesStatus>("steam_sales_status"),
  /** Store the publisher key in the OS credential store, after proving it works. */
  steamSalesConnect: (key: string) => invoke<SalesStatus>("steam_sales_connect", { key }),
  /** Forget the key and delete the ledger it filled. */
  steamSalesDisconnect: () => invoke<SalesStatus>("steam_sales_disconnect"),
  /** One game's sales from the local ledger; the backend resyncs when stale. */
  steamSalesSummary: (appid: string) =>
    coalesce(`sales:${appid}`, () => invoke<SalesSummary>("steam_sales_summary", { appid })),
  fetchFeed: (url: string) =>
    coalesce(`feed:${url}`, () => invoke<FeedItem[]>("fetch_feed", { url })),
  steamFeatured: (category: string) =>
    coalesce(`featured:${category}`, () =>
      invoke<SteamFeaturedItem[]>("steam_featured", { category }),
    ),
  epicFreeGames: () => coalesce("epic", () => invoke<EpicFreeGame[]>("epic_free_games")),
  checkPlatform: (platform: string, query: string) =>
    invoke<PlatformHit>("check_platform", { platform, query }),
  githubRepoStats: () =>
    coalesce("github_stats", () => invoke<GithubRepoStats>("github_repo_stats")),
  githubReleases: () =>
    coalesce("github_releases", () => invoke<GithubRelease[]>("github_releases")),
  onTabEvent: (handler: (payload: TabEventPayload) => void): Promise<UnlistenFn> =>
    listen<TabEventPayload>("tab-event", (event) => handler(event.payload)),
  termCreate: (id: string, cols: number, rows: number) =>
    invoke("term_create", { id, cols, rows }),
  termWrite: (id: string, data: string) => invoke("term_write", { id, data }),
  termResize: (id: string, cols: number, rows: number) =>
    invoke("term_resize", { id, cols, rows }),
  termClose: (id: string) => invoke("term_close", { id }),
  onTermOutput: (handler: (payload: TermOutputPayload) => void): Promise<UnlistenFn> =>
    listen<TermOutputPayload>("term-output", (event) => handler(event.payload)),
  onTermExit: (handler: (payload: TermExitPayload) => void): Promise<UnlistenFn> =>
    listen<TermExitPayload>("term-exit", (event) => handler(event.payload)),
  isDefaultBrowser: () => invoke<boolean>("is_default_browser"),
  openDefaultBrowserSettings: () => invoke("open_default_browser_settings"),
  /** URLs the OS launched us with (we're someone's default browser). */
  takeStartupUrls: () => invoke<string[]>("take_startup_urls"),
  /** A URL forwarded from a second app launch while we're already running. */
  onOpenUrl: (handler: (url: string) => void): Promise<UnlistenFn> =>
    listen<string>("open-url", (event) => handler(event.payload)),
  detectEngines: () => coalesce("detect_engines", () => invoke<EngineInstall[]>("detect_engines")),
  validateEngine: (path: string) => invoke<EngineInstall>("validate_engine", { path }),
  readUproject: (path: string) => invoke<UProjectInfo>("read_uproject", { path }),
  /** Open a .uproject in the Unreal editor; `enginePath` picks the binary,
   *  null falls back to the OS file association. */
  openUproject: (uproject: string, enginePath: string | null) =>
    invoke("open_uproject", { uproject, enginePath }),
  startBuild: (req: BuildRequest) => invoke("start_build", { req }),
  cancelBuild: (jobId: string) => invoke("cancel_build", { jobId }),
  buildHistory: () => invoke<BuildRecord[]>("build_history"),
  buildLog: (id: string, onlyIssues: boolean) =>
    invoke<BuildLogLine[]>("build_log", { id, onlyIssues }),
  clearBuildHistory: () => invoke("clear_build_history"),
  launchPackaged: (dir: string, project: string) =>
    invoke<string>("launch_packaged", { dir, project }),
  revealInExplorer: (path: string) => invoke("reveal_in_explorer", { path }),
  systemStats: () => invoke<SystemStats>("system_stats"),
  onBuildEvent: (handler: (payload: BuildEventPayload) => void): Promise<UnlistenFn> =>
    listen<BuildEventPayload>("build-event", (event) => handler(event.payload)),
};

/** One installed browser extension. `popup` is the action popup page (null if
 *  the extension has none); `icon` is a ready-to-render data: URI. */
export type ExtInfo = {
  id: string;
  name: string;
  popup: string | null;
  icon: string | null;
};

export type SteamStats = {
  details: {
    name?: string;
    header_image?: string;
    is_free?: boolean;
    price_overview?: { final_formatted?: string };
    release_date?: { date?: string; coming_soon?: boolean };
  } | null;
  reviews: {
    review_score_desc?: string;
    total_positive?: number;
    total_negative?: number;
    total_reviews?: number;
  } | null;
  players: number | null;
};

/** Steamworks connection state. The publisher key itself never crosses this
 *  boundary — it lives in the OS credential store and is read only by Rust. */
export type SalesStatus = {
  connected: boolean;
  /** Unix seconds of the last successful sync; 0 when never synced. */
  lastSyncedAt: number;
  syncing: boolean;
};

/** One Pacific day of sales for one app. `netUsd` is gross less returns and
 *  tax, and still *before* Valve's revenue split. */
export type SalesDay = {
  /** `YYYY-MM-DD`, Pacific — a calendar day, not an instant. */
  date: string;
  netUsd: number;
  grossUsd: number;
  units: number;
};

/** A rolling total over `days` days ending on the newest day on file. */
export type SalesWindow = {
  netUsd: number;
  grossUsd: number;
  units: number;
  days: number;
};

/**
 * One game's sales, summarised from the local ledger. Every window is anchored
 * on `latest` — the newest day Steam has settled — rather than on the wall
 * clock, because Valve reports in Pacific days and recalculates them for a
 * while afterwards. There is no realtime revenue feed to ask for.
 */
export type SalesSummary = {
  connected: boolean;
  hasData: boolean;
  lastSyncedAt: number;
  syncing: boolean;
  latest?: SalesDay | null;
  /** The day before `latest`, when we have it; a gap leaves this null. */
  previous?: SalesDay | null;
  last7?: SalesWindow;
  last30?: SalesWindow;
  monthToDate?: SalesWindow;
  /** 30 daily net-sales figures, oldest first, zero-filled across gaps. */
  spark?: number[];
  topCountry?: { code: string; netUsd: number } | null;
};

/** One search hit from Reddit's RSS mirror; vote/comment counts aren't in
 *  the feed, and some URLs live outside a subreddit. */
export type RedditPost = {
  title: string;
  subreddit: string | null;
  createdUtc: number | null;
  url: string;
};

/** One RSS/Atom headline; `date` is unix seconds or null when unparseable. */
export type FeedItem = {
  title: string;
  url: string;
  date: number | null;
};

/** One row of a Steam front-page category. Prices are USD cents; `release`
 *  (the planned date, e.g. "Q4 2026") is filled for coming-soon lists only. */
export type SteamFeaturedItem = {
  appid: number;
  name: string;
  image: string;
  largeImage: string;
  discounted: boolean;
  discountPercent: number;
  finalPrice: number | null;
  originalPrice: number | null;
  release: string | null;
};

/** One Epic giveaway slot; dates are ISO strings from the storefront. */
export type EpicFreeGame = {
  title: string;
  url: string;
  image: string | null;
  status: "free" | "upcoming";
  startDate: string | null;
  endDate: string | null;
  originalPrice: number | null;
};

/** Public counters for the UWebBrowser repo; cached 15 min on the backend. */
export type GithubRepoStats = {
  stars: number;
  forks: number;
  /** GitHub counts open pull requests in this number too. */
  openIssues: number;
};

/** One GitHub release; `published` is unix seconds, `notes` is markdown. */
export type GithubRelease = {
  name: string;
  tag: string;
  url: string;
  published: number | null;
  notes: string;
};

export type ItchGame = {
  title: string;
  url: string;
  views_count: number;
  downloads_count: number;
  purchases_count: number;
  published: boolean;
  /** Cumulative lifetime earnings, one entry per currency the game has earned
   *  in. `amount` is minor units (cents). itch reports no history, only this
   *  running total — see ItchEarnings for where the daily figures come from. */
  earnings?: { currency: string; amount: number; amount_formatted: string }[];
};

/**
 * itch.io earnings. `lifetimeCents` comes straight from itch; every other
 * figure is measured locally, by diffing that running total between polls,
 * because itch exposes no purchase feed and no time series. History therefore
 * begins at `trackingSince` and cannot be backfilled.
 *
 * Figures are in `currency` — the account's dominant one. Other currencies are
 * counted in `currencies` but never summed in: 100 JPY is not 100 USD.
 */
export type ItchEarnings = {
  hasData: boolean;
  currency?: string;
  /** How many currencies the account has earned in, dominant one included. */
  currencies: number;
  lifetimeCents?: number;
  todayCents?: number;
  last7Cents?: number;
  last30Cents?: number;
  /** 30 daily figures in minor units, oldest first, zero-filled across gaps. */
  spark?: number[];
  /** Unix seconds of our first snapshot; 0 before we've ever reached itch. */
  trackingSince: number;
};

export type EngineInstall = {
  id: string;
  version: string;
  path: string;
  source: "launcher" | "source" | "manual";
};

export type UProjectInfo = {
  name: string;
  dir: string;
  engineAssociation: string;
  hasCode: boolean;
};

export type BuildAction = "build" | "cook" | "package";

export type BuildRequest = {
  jobId: string;
  enginePath: string;
  uproject: string;
  action: BuildAction;
  config: string;
  platform: string;
  /** Where packaged builds land; omitted means <project>\Packaged\<platform>. */
  archiveDir?: string;
};

export type BuildEventPayload = {
  id: string;
  kind: "line" | "lines" | "stage" | "done";
  value: string;
  /** Present only on `kind: "lines"` — a batch of streamed output lines. */
  lines?: string[];
};

/** One recorded build, as saved by the backend when a job exits. */
export type BuildRecord = {
  id: string;
  project: string;
  action: BuildAction;
  config: string;
  platform: string;
  archiveDir: string | null;
  startedAt: number;
  durationMs: number;
  exitCode: number;
  /** True when the user cancelled; absent on records from older versions. */
  cancelled?: boolean;
  warnings: number;
  errors: number;
  stages: { name: string; atMs: number }[];
};

/** 0 = info, 1 = warning, 2 = error; t is ms since the build started. */
export type BuildLogLine = { t: number; sev: 0 | 1 | 2; text: string };

export type SystemStats = {
  cpuName: string;
  cpuUsage: number;
  coreCount: number;
  cpuTempC: number | null;
  memUsed: number;
  memTotal: number;
  disks: { name: string; mount: string; total: number; available: number }[];
  gpu: {
    name: string;
    usage: number;
    memUsed: number;
    memTotal: number;
    tempC: number | null;
    powerW: number | null;
  } | null;
};
