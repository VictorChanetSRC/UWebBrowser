import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlatformHit } from "./platforms";

export type TabEventPayload = {
  id: string;
  /** "new-tab" carries a URL the page asked to open in a new tab
   *  (window.open / target="_blank"); `id` is the opener tab. */
  kind: "title" | "url" | "loading" | "new-tab";
  value: string;
};

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
  /** The tab's live document URL — tracks History-API (SPA) navigations that
   *  fire no page-load event. */
  tabLiveUrl: (id: string) => invoke<string>("tab_live_url", { id }),
  setContentInsets: (top: number, left: number, right: number) =>
    invoke("set_content_insets", { top, left, right }),
  clearBrowsingData: () => invoke("clear_browsing_data"),
  /** Installed Chrome extensions, for the pinned bar (Windows/WebView2 only). */
  extList: () => invoke<ExtInfo[]>("ext_list"),
  /** Copy an unpacked extension folder into the store and install it live. */
  extImport: (source: string) => invoke<ExtInfo[]>("ext_import", { source }),
  /** Install straight from the Chrome Web Store by extension id. */
  extInstallFromStore: (id: string) => invoke<ExtInfo[]>("ext_install_from_store", { id }),
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
  steamStats: (appid: string) => invoke<SteamStats>("steam_stats", { appid }),
  steamPlayers: (appid: string) => invoke<number | null>("steam_players", { appid }),
  redditSearch: (query: string) => invoke<RedditPost[]>("reddit_search", { query }),
  itchGames: (apiKey: string) => invoke<ItchGame[]>("itch_games", { apiKey }),
  fetchFeed: (url: string) => invoke<FeedItem[]>("fetch_feed", { url }),
  steamFeatured: (category: string) =>
    invoke<SteamFeaturedItem[]>("steam_featured", { category }),
  epicFreeGames: () => invoke<EpicFreeGame[]>("epic_free_games"),
  checkPlatform: (platform: string, query: string) =>
    invoke<PlatformHit>("check_platform", { platform, query }),
  githubRepoStats: () => invoke<GithubRepoStats>("github_repo_stats"),
  githubReleases: () => invoke<GithubRelease[]>("github_releases"),
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
  detectEngines: () => invoke<EngineInstall[]>("detect_engines"),
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
  enabled: boolean;
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
