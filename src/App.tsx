import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Discover } from "./components/Discover";
import { Settings } from "./components/Settings";
import { History } from "./components/History";
import { UnrealHub } from "./components/UnrealHub";
import { Workbar } from "./components/Workbar";
import { ExtensionBar, WEB_STORE_URL } from "./components/ExtensionBar";
import { FindBar } from "./components/FindBar";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { DevtoolsDock } from "./components/DevtoolsDock";
import { Button } from "./components/ui/button";
import { Z_STRIP, Z_TOAST } from "./components/ui/overlay";
import { StatusPage } from "./components/ui/status-page";
import { clamp, cn } from "./lib/utils";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { ExtInfo } from "./lib/ipc";
import { DefaultBrowserPrompt } from "./components/DefaultBrowserPrompt";
import {
  BasicAuthDialog,
  CertInterstitial,
  ExternalLinkConfirm,
  NavErrorPage,
  PermissionPrompt,
  type AuthReq,
  type CertReq,
  type PermissionReq,
} from "./components/BrowserPrompts";
import { GITHUB_REPO_URL } from "./lib/github";
// Lazy so xterm (one of the heaviest deps) and the terminal module split into
// their own chunk, loaded only when a terminal tab is actually opened — not in
// the cold-start bundle every launch pays for.
const TerminalView = lazy(() =>
  import("./components/TerminalView").then((m) => ({ default: m.TerminalView })),
);
import { fire, ipc, setIpcErrorReporter, silent } from "./lib/ipc";
import { loadConfig, saveConfig, type UwbConfig } from "./lib/config";
import {
  loadClosedTabs,
  loadSession,
  saveClosedTabs,
  saveSession,
  type ClosedTab,
} from "./lib/session";
import type { LinkItem } from "./lib/engines";
import { recordVisit, updateTitle } from "./lib/history";
import { hostOf, tabLabelFor, isNavigableUrl } from "./lib/url";
import {
  DISCOVER_URL,
  HISTORY_URL,
  HOME_URL,
  internalTitle,
  normalizeInput,
  SETTINGS_URL,
  TERMINAL_URL,
  UNREAL_URL,
  WORKBAR_URL,
} from "./lib/pages";
import { zoomFor, setZoomFor } from "./lib/zoom";
import {
  engineFor,
  loadSettings,
  saveSettings,
  type BrowserSettings,
} from "./lib/settings";
import {
  isPinned,
  loadWidgets,
  pinnedUrls as collectPinnedUrls,
  saveWidgets,
  seedWidgets,
  togglePin,
  type Widget,
} from "./lib/workbar";

export type Tab = {
  id: string;
  kind: "home" | "web";
  url: string;
  title: string;
  loading: boolean;
  /** Set when the tab's renderer process died; shows a recover panel. */
  crashed?: boolean;
  /** The page's real favicon URL, reported natively (privacy: avoids the
   *  third-party favicon service). Undefined falls back to that service. */
  favicon?: string;
  /** Session-history availability, from the engine, to grey the nav arrows. */
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Set when a main-frame navigation failed (DNS/refused/timeout); shows a
   *  branded error page. Cleared when a fresh load starts. */
  navError?: { code: number; url: string };
};

const DISCORD_INVITE_URL = "https://discord.gg/bAeGFv4VBB";
const TOP_INSET = 92; // 44px title bar + 48px toolbar
const EXT_BAR_HEIGHT = 34; // pinned extensions strip, when shown
const FIND_BAR_HEIGHT = 44; // reserved strip for the find-in-page bar
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 440;

/** One arrow-key press on the sidebar splitter. */
const SIDEBAR_KEY_STEP = 16;

const clampSidebarWidth = (width: number) =>
  clamp(Math.round(width), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
const DEFAULT_PROMPT_SNOOZE_KEY = "uwb.defaultBrowser.snoozeUntil";
const DEFAULT_PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_PROMPT_DELAY_MS = 2500;

const homeTab = (url: string = HOME_URL): Tab => ({
  id: crypto.randomUUID(),
  kind: "home",
  url,
  title: internalTitle(url),
  loading: false,
});

export default function App() {
  // Restore last session's tabs; webviews for web tabs are recreated below.
  const [restored] = useState(loadSession);
  const [tabs, setTabs] = useState<Tab[]>(() => restored?.tabs ?? [homeTab()]);
  const [activeId, setActiveId] = useState(() => restored?.activeId ?? tabs[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("uwb.sidebar") !== "0",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("uwb.sidebarWidth"));
    return Number.isFinite(stored) && stored > 0
      ? clampSidebarWidth(stored)
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [config, setConfig] = useState<UwbConfig>(loadConfig);
  const [widgets, setWidgets] = useState<Widget[]>(loadWidgets);
  const [settings, setSettings] = useState<BrowserSettings>(loadSettings);
  const [addressFocusSignal, setAddressFocusSignal] = useState(0);
  // While the omnibox suggestion list is showing, the native tab webview is
  // hidden — it would otherwise paint over the dropdown.
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState(false);
  const [extensions, setExtensions] = useState<ExtInfo[]>([]);
  const [openExtId, setOpenExtId] = useState<string | null>(null);
  const [extBarOpen, setExtBarOpen] = useState(
    () => localStorage.getItem("uwb.extBar") === "1",
  );
  const [findOpen, setFindOpen] = useState(false);
  // Bumped by every Ctrl+F so the bar re-focuses and selects its query even when
  // it's already open.
  const [findFocusSignal, setFindFocusSignal] = useState(0);
  // Docked DevTools: which tab the panel is inspecting (null = closed), which
  // edge it's docked to, and how much of the content area it takes. The panel
  // body is a native webview the backend lays out; only the resize/controls
  // strip lives in the chrome. `devtoolsResizing` mirrors the sidebar pattern —
  // the page webview is hidden while the splitter is dragged.
  const [devtoolsTabId, setDevtoolsTabId] = useState<string | null>(null);
  const [devtoolsDock, setDevtoolsDock] = useState<"bottom" | "right">(() =>
    localStorage.getItem("uwb.devtoolsDock") === "right" ? "right" : "bottom",
  );
  const [devtoolsSize, setDevtoolsSize] = useState(() => {
    const s = Number(localStorage.getItem("uwb.devtoolsSize"));
    return Number.isFinite(s) && s >= 0.15 && s <= 0.85 ? s : 0.35;
  });
  const [devtoolsResizing, setDevtoolsResizing] = useState(false);
  // The downloads panel drops into the content area; while it's open the active
  // page's webview is hidden so the dropdown isn't painted over (same as the
  // omnibox). Downloads state itself lives inside the self-contained component.
  const [downloadsPanelOpen, setDownloadsPanelOpen] = useState(false);
  // Bumped by Ctrl+J to toggle the downloads panel (which owns its open state).
  const [downloadsOpenSignal, setDownloadsOpenSignal] = useState(0);
  // Web-platform prompts raised natively for a tab (permission / basic-auth /
  // cert / deep-link). Each holds the originating tab id so it's shown only
  // while that tab is active, like Chrome.
  const [permissionReq, setPermissionReq] = useState<PermissionReq | null>(null);
  const [authReq, setAuthReq] = useState<AuthReq | null>(null);
  const [certReq, setCertReq] = useState<CertReq | null>(null);
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Recently-closed tabs, newest last. Seeded from disk so Ctrl+Shift+T works
  // after a restart, and written back whenever it changes.
  const closedTabs = useRef<ClosedTab[]>(loadClosedTabs());

  // Route every `fire()` failure into the toast. Without this a rejected
  // fire-and-forget command is a dead-end button: the click does nothing and
  // nothing says why.
  useEffect(() => setIpcErrorReporter(setToast), []);

  useEffect(() => saveWidgets(widgets), [widgets]);
  // Debounced session save: tab state churns rapidly (loading toggles, title and
  // SPA-URL updates, per-neighbour drag steps), and each write serializes the
  // whole session. Coalesce to a trailing write; flush immediately on pagehide
  // so a close never loses the final state.
  useEffect(() => {
    const timer = window.setTimeout(
      () => saveSession(tabsRef.current, activeIdRef.current),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [tabs, activeId]);
  useEffect(() => {
    const flush = () => saveSession(tabsRef.current, activeIdRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  // Restore the last session. Only the *active* web tab's webview is created at
  // boot; the rest are materialized lazily on first activation (see
  // ensureMaterialized) so restoring a big session doesn't spawn every renderer
  // at once — a large startup memory/CPU spike, à la Chrome's deferred restore.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Push the chrome layout to the native side before any webview exists:
      // createTab sizes the page from these insets, and at boot the layout
      // effect below hasn't reached the backend yet — without this the
      // restored page is created at 0,0 and covers the whole window.
      // Awaited (so it lands before createTab), but its failure is not fatal —
      // the layout effect below re-pushes these on the next render.
      await ipc.setContentInsets(TOP_INSET, sidebarOpen ? sidebarWidth : 0, 0).catch(() => {});
      if (cancelled) return;
      const active = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (active?.kind === "web") {
        materialized.current.add(active.id);
        await ipc
          .createTab(active.id, active.url)
          .catch((e) => setToast(`Couldn’t restore that tab: ${e}`));
        if (cancelled) return;
        silent(ipc.activateTab(active.id));
      } else {
        silent(ipc.activateTab(null));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot only. `sidebarOpen`/`sidebarWidth` are read for their *restored*
    // values; listing them would re-run session restore on every sidebar drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kill PTY sessions whose tab is gone (closed, or navigated away from
  // uwb://terminal). Creation happens in TerminalView on first mount. The
  // terminal module is imported lazily so xterm stays out of cold start until a
  // terminal has actually existed — before that there are no sessions to prune.
  const terminalLoaded = useRef(false);
  useEffect(() => {
    const termTabs = tabs.filter((t) => t.kind === "home" && t.url === TERMINAL_URL);
    if (termTabs.length === 0 && !terminalLoaded.current) return;
    terminalLoaded.current = true;
    const alive = new Set(termTabs.map((t) => t.id));
    import("./lib/terminal").then((m) => m.pruneTerminals(alive));
  }, [tabs]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  /** The active tab, read from refs so callers stay identity-stable. */
  const currentTab = useCallback(
    () => tabsRef.current.find((t) => t.id === activeIdRef.current),
    [],
  );
  const openExtIdRef = useRef(openExtId);
  openExtIdRef.current = openExtId;
  const devtoolsTabIdRef = useRef(devtoolsTabId);
  devtoolsTabIdRef.current = devtoolsTabId;
  // Web-tab ids whose native webview actually exists. Restored tabs are created
  // lazily on first activation (Chrome-style deferred restore), so this starts
  // empty and fills as tabs are opened or first shown.
  const materialized = useRef<Set<string>>(new Set());
  // Ensure a web tab's webview exists, creating it on demand. Returns true if
  // the tab is (now) materialized.
  const ensureMaterialized = useCallback((tab: Tab): boolean => {
    if (tab.kind !== "web") return false;
    if (!materialized.current.has(tab.id)) {
      materialized.current.add(tab.id);
      // A tab whose webview can't be created is a permanently blank page; say so
      // rather than leaving the user staring at nothing.
      fire(ipc.createTab(tab.id, tab.url), "Couldn’t open that page");
    }
    return true;
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // A native tab webview paints over every chrome overlay, so it must be hidden
  // whenever a full-bleed panel or modal for the active tab is showing (error
  // page, cert interstitial, or a permission / basic-auth / deep-link prompt).
  const certActive = certReq?.tabId === activeTab.id;
  const authActive = authReq?.tabId === activeTab.id;
  const permActive = permissionReq?.tabId === activeTab.id;
  const webviewBlocked =
    activeTab.navError != null ||
    certActive ||
    authActive ||
    permActive ||
    shortcutsOpen ||
    externalUrl != null;

  // The pinned extensions strip is a third chrome row; the content area (and
  // every tab webview) starts below it when shown.
  const showExtBar = extBarOpen;
  // The find bar reserves a strip at the top of the content area (a floating
  // overlay would be hidden behind the native tab webview), so the page shifts
  // down while it's open.
  const findActive = findOpen && activeTab.kind === "web" && !activeTab.crashed;
  const topInset =
    TOP_INSET + (showExtBar ? EXT_BAR_HEIGHT : 0) + (findActive ? FIND_BAR_HEIGHT : 0);

  // The DevTools strip shows only when its bound tab is the one on screen and
  // the page webview is actually visible. It stays up during our own splitter
  // drag (the page is hidden then, like the sidebar resize) but not while an
  // omnibox/downloads overlay, a modal, or the sidebar resize has hidden the
  // page — the native panel is hidden in all those cases too.
  const devtoolsVisible =
    devtoolsTabId != null &&
    devtoolsTabId === activeTab.id &&
    activeTab.kind === "web" &&
    !activeTab.crashed &&
    (devtoolsResizing ||
      !(omniboxOpen || downloadsPanelOpen || webviewBlocked || sidebarResizing));

  // Tell the native side where the content area starts. Pushes are skipped
  // mid-drag (the webview is hidden then); the final width lands here once the
  // drag ends.
  useEffect(() => {
    if (sidebarResizing) return;
    const left = sidebarOpen ? sidebarWidth : 0;
    silent(ipc.setContentInsets(topInset, left, 0));
    localStorage.setItem("uwb.sidebar", sidebarOpen ? "1" : "0");
    localStorage.setItem("uwb.sidebarWidth", String(sidebarWidth));
  }, [sidebarOpen, sidebarWidth, sidebarResizing, topInset]);

  // Resizing happens entirely in the chrome layer: the native tab webview is
  // hidden for the duration (it paints over the chrome and would swallow
  // pointer events once the cursor crossed onto it), then re-shown at the
  // final width on release.
  const startSidebarResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSidebarResizing(true);
    const tab = currentTab();
    if (tab?.kind === "web") silent(ipc.activateTab(null));
  };

  const moveSidebarResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setSidebarWidth(clampSidebarWidth(e.clientX));
  };

  const endSidebarResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const width = clampSidebarWidth(e.clientX);
    setSidebarWidth(width);
    setSidebarResizing(false);
    const tab = currentTab();
    if (tab?.kind !== "web") return;
    // Size the webview before showing it so it doesn't flash at the old width.
    // `finally`, not `then`: a failed resize must still re-show the page, or the
    // drag ends on a blank window.
    silent(ipc.setContentInsets(topInset, width, 0).finally(() => ipc.activateTab(tab.id)));
  };

  const openNewTab = useCallback(
    /** `at` places the tab at an exact strip index (reopening a closed tab);
     *  omitted, it lands just right of the active tab, as Chrome does. */
    (url?: string, at?: number) => {
      const tab = homeTab(url?.startsWith("uwb:") ? url : undefined);
      if (url && !url.startsWith("uwb:")) {
        // Reject javascript:/data:/blob: and other non-navigable links (the
        // backend would refuse them too, but silently) with a bit of feedback.
        if (!isNavigableUrl(url)) {
          setToast("That link can’t be opened here.");
          return;
        }
        tab.kind = "web";
        tab.url = url;
        tab.title = tabLabelFor(url);
        tab.loading = true;
        materialized.current.add(tab.id);
        fire(ipc.createTab(tab.id, url), "Couldn’t open that page");
      } else {
        // Internal pages render in the chrome; just clear the content area.
        silent(ipc.activateTab(null));
      }
      // Insert directly to the right of the active tab (Chrome/Firefox
      // behaviour), not at the very end of the strip.
      setTabs((prev) => {
        const next = [...prev];
        if (at !== undefined) {
          next.splice(Math.min(Math.max(at, 0), prev.length), 0, tab);
          return next;
        }
        const active = prev.findIndex((t) => t.id === activeIdRef.current);
        if (active === -1) return [...prev, tab];
        next.splice(active + 1, 0, tab);
        return next;
      });
      setActiveId(tab.id);
    },
    [],
  );

  // Title / URL / loading events flowing back from tab webviews.
  useEffect(() => {
    const unlisten = ipc.onTabEvent(({ id, kind, value }) => {
      if (kind === "new-tab") {
        // The page asked for a new window (window.open / target="_blank");
        // open it as a regular foreground tab.
        openNewTab(value);
        return;
      }
      if (kind === "shortcut") {
        // A browser accelerator pressed while the native page had OS keyboard
        // focus, forwarded from Rust because the chrome DOM never saw it.
        runActionRef.current(value);
        return;
      }
      if (kind === "zoom") {
        // Remember this host's zoom so it's restored on the next visit, like
        // Chrome's per-site zoom.
        const pct = Number(value);
        const tab = tabsRef.current.find((t) => t.id === id);
        if (pct && tab) setZoomFor(hostOf(tab.url), pct / 100);
        setToast(`Zoom ${value}%`);
        return;
      }
      if (kind === "favicon") {
        setTabs((prev) =>
          prev.map((tab) => (tab.id === id ? { ...tab, favicon: value } : tab)),
        );
        return;
      }
      if (kind === "download") {
        // Handled entirely by the self-contained <Downloads> component, which
        // keeps its own listener; nothing to do here.
        return;
      }
      if (kind === "external-url") {
        // The page tried to follow a deep link (mailto:, steam://, …); confirm
        // before handing it to the OS, like Chrome's external-protocol prompt.
        setExternalUrl(value);
        return;
      }
      if (kind === "permission") {
        const p = JSON.parse(value) as { id: string; kind: string; origin: string };
        setPermissionReq({ ...p, tabId: id });
        return;
      }
      if (kind === "basic-auth") {
        const a = JSON.parse(value) as { id: string; origin: string };
        setAuthReq({ id: a.id, origin: a.origin, tabId: id });
        return;
      }
      if (kind === "cert-error") {
        const c = JSON.parse(value) as { id: string; url: string; code: number };
        setCertReq({ id: c.id, url: c.url, code: c.code, tabId: id });
        return;
      }
      if (kind === "nav-error") {
        const e = JSON.parse(value) as { url: string; code: number };
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === id ? { ...tab, navError: e, loading: false } : tab,
          ),
        );
        return;
      }
      if (kind === "nav-state") {
        const s = JSON.parse(value) as { back: boolean; forward: boolean };
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === id ? { ...tab, canGoBack: s.back, canGoForward: s.forward } : tab,
          ),
        );
        return;
      }
      if (kind === "crashed") {
        // The renderer died; surface a recover panel and hide the (now blank)
        // native webview so the panel is visible.
        setTabs((prev) =>
          prev.map((tab) => (tab.id === id ? { ...tab, crashed: true } : tab)),
        );
        if (id === activeIdRef.current) silent(ipc.activateTab(null));
        return;
      }
      if (kind === "url" && (!value || value === "about:blank" || !isNavigableUrl(value))) {
        // A blank / non-navigable hop (a denied popup's leftover, an anti-embed
        // bounce). Don't record it in history or move the omnibox onto a white
        // page — the backend already refuses to drive the frame there.
        return;
      }
      const current = tabsRef.current.find((t) => t.id === id);
      if (current) {
        if (kind === "url") recordVisit(value, "");
        if (kind === "title") updateTitle(current.url, value);
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== id) return tab;
          if (kind === "title") return { ...tab, title: value };
          if (kind === "loading") {
            const loading = value === "true";
            // A fresh load clears a prior crash, error page and stale favicon.
            return loading
              ? { ...tab, loading, crashed: false, navError: undefined, favicon: undefined }
              : { ...tab, loading };
          }
          const title =
            tab.title === "New tab" || tab.title === ""
              ? tabLabelFor(value)
              : tab.title;
          return { ...tab, url: value, title };
        }),
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openNewTab]);

  const activate = useCallback(
    (tab: Tab) => {
      setActiveId(tab.id);
      if (tab.kind === "web" && !tab.crashed) {
        // Create the webview now if this is a restored tab being shown for the
        // first time.
        ensureMaterialized(tab);
        silent(ipc.activateTab(tab.id));
      } else {
        // Internal page, or a crashed tab whose dead surface we keep hidden so
        // the recover panel shows instead.
        silent(ipc.activateTab(null));
      }
    },
    [ensureMaterialized],
  );

  // Re-navigate a crashed tab to its URL, clearing the crash and re-showing the
  // (fresh) webview.
  const reloadCrashed = useCallback((tab: Tab) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, crashed: false, loading: true } : t)),
    );
    fire(ipc.navigateTab(tab.id, tab.url), "Couldn’t reload that page");
    silent(ipc.activateTab(tab.id));
  }, []);

  // Poll the active web tab's live URL. SPAs (the Chrome Web Store especially)
  // route via the History API, which raises no native navigation event — so
  // without this the omnibox and the store "Add to UWebBrowser" button would
  // never see that you've moved to an extension's detail page.
  useEffect(() => {
    const timer = window.setInterval(() => {
      // Idle when the window is hidden (tray/minimized) so a backgrounded
      // browser stops round-tripping to the engine every 700ms.
      if (document.hidden) return;
      const tab = currentTab();
      if (tab?.kind !== "web" || tab.crashed) return;
      silent(
        ipc.tabLiveUrl(tab.id).then((url) => {
          // Ignore a blank/non-navigable live URL: a page that briefly bounced
          // through about:blank (a denied popup's leftover, an anti-embed hop)
          // must not overwrite the tab's real address with a white page.
          if (!url || url === "about:blank" || !isNavigableUrl(url)) return;
          setTabs((prev) =>
            prev.map((t) => (t.id === tab.id && t.url !== url ? { ...t, url } : t)),
          );
        }),
      );
    }, 700);
    return () => window.clearInterval(timer);
  }, [currentTab]);

  // The native tab webview paints over any chrome overlay, so hide it while the
  // omnibox suggestions or the downloads panel are showing.
  useEffect(() => {
    const tab = currentTab();
    if (tab?.kind !== "web") return;
    const hide = omniboxOpen || downloadsPanelOpen || webviewBlocked;
    silent(ipc.activateTab(hide ? null : tab.id));
  }, [omniboxOpen, downloadsPanelOpen, webviewBlocked, currentTab]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Persist DevTools dock side and size so the panel restores where you left it.
  useEffect(() => {
    localStorage.setItem("uwb.devtoolsDock", devtoolsDock);
  }, [devtoolsDock]);
  useEffect(() => {
    localStorage.setItem("uwb.devtoolsSize", String(devtoolsSize));
  }, [devtoolsSize]);

  // Toggle the docked DevTools panel for the active web tab: close it if it's
  // already inspecting this tab, otherwise open/re-target it here. Bound to the
  // toolbar button, F12 and Ctrl+Shift+I (via runAction, so the native
  // accelerator path and the DOM keydown path behave identically).
  const toggleDevtools = useCallback(() => {
    const tab = currentTab();
    if (tab?.kind !== "web") return;
    if (devtoolsTabIdRef.current === tab.id) {
      setDevtoolsTabId(null);
      silent(ipc.devtoolsClose());
    } else {
      setDevtoolsTabId(tab.id);
      fire(ipc.devtoolsOpen(tab.id), "Couldn’t open DevTools");
    }
  }, [currentTab]);

  // Restore the active tab's per-site zoom, like Chrome. Keyed on host (not full
  // URL) so in-site navigation doesn't re-apply on every path change; the native
  // Ctrl+/- path persists via the "zoom" event above.
  //
  // It must also depend on the *tab*: zoom lives on the webview, and each tab has
  // its own. Without `activeTab.id` here, opening a second tab on a host you've
  // already zoomed leaves that tab at 100% — the host never changed, so the
  // effect never re-ran.
  const activeHost = activeTab.kind === "web" ? hostOf(activeTab.url) : "";
  const activeTabId = activeTab.id;
  useEffect(() => {
    if (!activeHost) return;
    // A fresh tab's webview is created by a separate, un-awaited `createTab`, so
    // the first zoom can race it ("tab webview not found"). Retry once rather
    // than silently dropping the user's remembered zoom.
    let timer: number | undefined;
    const apply = () => ipc.tabZoom(activeTabId, zoomFor(activeHost));
    apply().catch(() => {
      timer = window.setTimeout(() => silent(apply()), 120);
    });
    return () => window.clearTimeout(timer);
  }, [activeHost, activeTabId]);

  // Load installed extensions once. Auto-open the bar the first time any exist
  // (until the user makes their own choice, tracked in localStorage).
  useEffect(() => {
    silent(
      ipc.extList().then((list) => {
        setExtensions(list);
        if (list.length > 0 && localStorage.getItem("uwb.extBar") === null) {
          setExtBarOpen(true);
        }
      }),
    );
  }, []);

  // Persist the bar preference; hiding it also dismisses any floating popup.
  useEffect(() => {
    localStorage.setItem("uwb.extBar", extBarOpen ? "1" : "0");
    if (!extBarOpen && openExtIdRef.current) {
      silent(ipc.extClosePopup());
      setOpenExtId(null);
    }
  }, [extBarOpen]);

  // The floating popup paints over the page and doesn't follow tab switches, so
  // close it whenever the active tab changes.
  useEffect(() => {
    if (openExtIdRef.current) {
      silent(ipc.extClosePopup());
      setOpenExtId(null);
    }
    // The find bar is tied to the tab that was active when it opened.
    setFindOpen(false);
  }, [activeId]);

  // The popup is anchored to a fixed spot under its bar button; a window resize
  // moves that anchor out from under it (it's not repositioned), so dismiss it
  // rather than leave it floating over stale coordinates.
  useEffect(() => {
    const onResize = () => {
      if (!openExtIdRef.current) return;
      silent(ipc.extClosePopup());
      setOpenExtId(null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // URLs handed over by the OS (we're the default browser): the launch argv,
  // drained once, plus links clicked in other apps while we're running,
  // forwarded by the single-instance callback.
  useEffect(() => {
    silent(ipc.takeStartupUrls().then((urls) => urls.forEach((url) => openNewTab(url))));
    const unlisten = ipc.onOpenUrl((url) => openNewTab(url));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openNewTab]);

  // Offer to become the default browser shortly after launch, unless we
  // already are or the user snoozed the prompt recently.
  useEffect(() => {
    if (Date.now() < Number(localStorage.getItem(DEFAULT_PROMPT_SNOOZE_KEY) ?? 0)) {
      return;
    }
    const timer = window.setTimeout(() => {
      silent(ipc.isDefaultBrowser().then((isDefault) => setDefaultPrompt(!isDefault)));
    }, DEFAULT_PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The default is set in Windows Settings, not in-app — re-check when focus
  // comes back so the prompt closes itself once the choice sticks.
  useEffect(() => {
    if (!defaultPrompt) return;
    const onFocus = () => {
      silent(
        ipc.isDefaultBrowser().then((isDefault) => {
          if (isDefault) {
            setDefaultPrompt(false);
            setToast("UWebBrowser is now your default browser");
          }
        }),
      );
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [defaultPrompt]);

  const dismissDefaultPrompt = useCallback(() => {
    localStorage.setItem(
      DEFAULT_PROMPT_SNOOZE_KEY,
      String(Date.now() + DEFAULT_PROMPT_SNOOZE_MS),
    );
    setDefaultPrompt(false);
  }, []);

  // Open an internal page: repurpose the current tab if it's already
  // internal, otherwise open a new one next to the page being read.
  const goInternal = useCallback(
    (url: string) => {
      const tab = currentTab();
      if (tab?.kind === "home") {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, url, title: internalTitle(url) } : t,
          ),
        );
      } else {
        openNewTab(url);
      }
    },
    [openNewTab, currentTab],
  );

  const navigateActive = useCallback(
    (raw: string) => {
      const url = normalizeInput(raw, engineFor(settings.searchEngine).searchUrl);
      if (!url) return;
      const tab = currentTab();
      if (!tab) return;
      if (url.startsWith("uwb:")) {
        goInternal(url);
        return;
      }
      if (tab.kind === "home") {
        materialized.current.add(tab.id);
        fire(ipc.createTab(tab.id, url), "Couldn’t open that page");
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? { ...t, kind: "web", url, title: tabLabelFor(url), loading: true }
              : t,
          ),
        );
      } else {
        fire(ipc.navigateTab(tab.id, url), "Couldn’t open that page");
        setTabs((prev) =>
          prev.map((t) => (t.id === tab.id ? { ...t, url, loading: true } : t)),
        );
      }
    },
    [goInternal, settings, currentTab],
  );

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const closing = current.find((t) => t.id === id);
    if (!closing) return;

    // Remember every closed tab — internal pages included, so closing History or
    // Settings is as undoable as closing a web page — with the slot it sat in.
    closedTabs.current = [
      ...closedTabs.current,
      {
        url: closing.url,
        title: closing.title,
        kind: closing.kind,
        index: current.findIndex((t) => t.id === id),
      },
    ].slice(-10);
    saveClosedTabs(closedTabs.current);

    if (closing.kind === "web") {
      // Only a materialized tab has a webview to close.
      if (materialized.current.has(id)) silent(ipc.closeTab(id));
      materialized.current.delete(id);
      // The backend unbinds DevTools from a closed tab on its side; keep the
      // chrome state in step so the strip doesn't linger.
      if (devtoolsTabIdRef.current === id) setDevtoolsTabId(null);
    }

    const remaining = current.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const fresh = homeTab();
      setTabs([fresh]);
      setActiveId(fresh.id);
      silent(ipc.activateTab(null));
      return;
    }
    setTabs(remaining);
    if (activeIdRef.current === id) {
      const index = current.findIndex((t) => t.id === id);
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActiveId(next.id);
      if (next.kind === "web" && !next.crashed) {
        ensureMaterialized(next);
        silent(ipc.activateTab(next.id));
      } else {
        silent(ipc.activateTab(null));
      }
    }
  }, [ensureMaterialized]);

  const updateConfig = useCallback((next: UwbConfig) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  const updateSettings = useCallback((next: BrowserSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleTogglePin = useCallback((item: LinkItem) => {
    setWidgets((prev) => togglePin(prev, item));
  }, []);

  // Stable handlers so the memoized TitleBar/Toolbar/Sidebar don't re-render on
  // every poll tick or toast. The web-tab actions read refs, so they never need
  // to change identity.
  const withWebTab = useCallback(
    (fn: (id: string) => void) => {
      const tab = currentTab();
      if (tab?.kind === "web") fn(tab.id);
    },
    [currentTab],
  );
  const handleNewTab = useCallback(() => openNewTab(), [openNewTab]);
  const duplicateTab = useCallback((tab: Tab) => openNewTab(tab.url), [openNewTab]);
  const reopenClosedTab = useCallback(() => runActionRef.current("reopen-tab"), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const toggleExtensions = useCallback(() => setExtBarOpen((open) => !open), []);
  const installExtensionFromStore = useCallback(async (id: string) => {
    setToast("Installing extension…");
    try {
      const next = await ipc.extInstallFromStore(id);
      setExtensions(next);
      setExtBarOpen(true);
      setToast("Extension installed — reload the page to activate it");
    } catch (e) {
      setToast(String(e));
    }
  }, []);
  const goDiscover = useCallback(() => goInternal(DISCOVER_URL), [goInternal]);
  const goUnreal = useCallback(() => goInternal(UNREAL_URL), [goInternal]);
  const goWorkbar = useCallback(() => goInternal(WORKBAR_URL), [goInternal]);
  const goTerminal = useCallback(() => openNewTab(TERMINAL_URL), [openNewTab]);
  const goSettings = useCallback(() => goInternal(SETTINGS_URL), [goInternal]);
  const goHistory = useCallback(() => goInternal(HISTORY_URL), [goInternal]);
  const goHome = useCallback(() => goInternal(HOME_URL), [goInternal]);
  const goGithub = useCallback(() => openNewTab(GITHUB_REPO_URL), [openNewTab]);
  const goDiscord = useCallback(() => openNewTab(DISCORD_INVITE_URL), [openNewTab]);
  const onBack = useCallback(
    () => withWebTab((id) => silent(ipc.goBack(id))),
    [withWebTab],
  );
  const onForward = useCallback(
    () => withWebTab((id) => silent(ipc.goForward(id))),
    [withWebTab],
  );
  const onReload = useCallback(
    (hard = false) => withWebTab((id) => fire(ipc.reload(id, hard), "Couldn’t reload the page")),
    [withWebTab],
  );
  const onStop = useCallback(() => withWebTab((id) => silent(ipc.stop(id))), [withWebTab]);
  const onDevtools = toggleDevtools;

  // Re-request a download's source URL. In the active web tab, exactly as
  // re-clicking the original link would: the response is an attachment, so the
  // page stays put and the transfer restarts. With no page to ask, open a tab.
  const onRetryDownload = useCallback(
    (url: string) => {
      const tab = currentTab();
      if (tab?.kind === "web" && !tab.crashed) {
        fire(ipc.navigateTab(tab.id, url), "Couldn’t restart that download");
      } else {
        openNewTab(url);
      }
    },
    [currentTab, openNewTab],
  );

  const onTogglePin = useCallback(() => {
    const tab = currentTab();
    if (tab?.kind === "web") {
      handleTogglePin({ name: tab.title || hostOf(tab.url), url: tab.url });
    }
  }, [handleTogglePin, currentTab]);

  const cycleTabs = useCallback(
    (dir: 1 | -1) => {
      const list = tabsRef.current;
      const index = list.findIndex((t) => t.id === activeIdRef.current);
      const next = list[(index + dir + list.length) % list.length];
      if (next) activate(next);
    },
    [activate],
  );

  // One source of truth for every browser action, driven from two places: the
  // chrome DOM keydown listener (when an internal page/omnibox has focus) and
  // "shortcut" tab-events forwarded from Rust (when a native page has focus, so
  // the DOM listener never fires). Both must behave identically.
  const runAction = useCallback(
    (action: string) => {
      switch (action) {
        case "new-tab":
          openNewTab();
          break;
        case "reopen-tab": {
          const last = closedTabs.current.pop();
          if (last) {
            saveClosedTabs(closedTabs.current);
            openNewTab(last.url, last.index);
          }
          break;
        }
        case "close-tab":
          closeTab(activeIdRef.current);
          break;
        case "focus-omnibox":
          setAddressFocusSignal((n) => n + 1);
          break;
        case "find":
          if (currentTab()?.kind === "web") {
            // Bump even when already open: Ctrl+F must re-focus and select the
            // query, the way it does in Chrome.
            setFindOpen(true);
            setFindFocusSignal((n) => n + 1);
          }
          break;
        case "reload":
          onReload(false);
          break;
        case "hard-reload":
          onReload(true);
          break;
        case "devtools":
          toggleDevtools();
          break;
        case "shortcuts":
          setShortcutsOpen((open) => !open);
          break;
        case "print":
          withWebTab((id) => fire(ipc.tabPrint(id), "Couldn’t open the print dialog"));
          break;
        case "downloads":
          setDownloadsOpenSignal((n) => n + 1);
          break;
        case "pin":
          onTogglePin();
          break;
        case "clear-data":
          // Chrome opens a dedicated clear-data dialog; ours lives in Settings.
          goInternal(SETTINGS_URL);
          break;
        case "back":
          onBack();
          break;
        case "forward":
          onForward();
          break;
        case "next-tab":
          cycleTabs(1);
          break;
        case "prev-tab":
          cycleTabs(-1);
          break;
        case "history":
          goInternal(HISTORY_URL);
          break;
        case "settings":
          goInternal(SETTINGS_URL);
          break;
        case "terminal":
          openNewTab(TERMINAL_URL);
          break;
        default:
          if (action.startsWith("tab-")) {
            const n = Number(action.slice(4));
            const target = tabsRef.current[Math.min(n, tabsRef.current.length) - 1];
            if (target) activate(target);
          }
      }
    },
    [
      openNewTab,
      closeTab,
      withWebTab,
      cycleTabs,
      goInternal,
      activate,
      onTogglePin,
      toggleDevtools,
      currentTab,
      onReload,
      onBack,
      onForward,
    ],
  );
  // Ref so the tab-event listener can call the latest runAction without
  // re-subscribing on every identity change.
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;

  // Keyboard shortcuts, when the chrome UI has focus (internal page or omnibox).
  // The same actions arrive as forwarded "shortcut" tab-events when a native
  // page has focus; both funnel through runAction so behaviour can't diverge.
  useEffect(() => {
    // Map a keydown to a runAction name, or null if we don't own the chord.
    const actionForKey = (e: KeyboardEvent): string | null => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "ArrowLeft") return "back";
        if (e.key === "ArrowRight") return "forward";
        return null;
      }
      // F5 reloads; Ctrl+F5 bypasses the cache, like Chrome.
      if (e.key === "F5") return e.ctrlKey ? "hard-reload" : "reload";
      if (e.key === "F12") return "devtools";
      if (!e.ctrlKey && !e.metaKey) return null;
      // Ctrl+Shift+I — DevTools (checked before the lowercased single-key chords).
      if (e.shiftKey && e.key.toLowerCase() === "i") return "devtools";
      if (e.key === "Tab") return e.shiftKey ? "prev-tab" : "next-tab";
      if (e.key >= "1" && e.key <= "9") return `tab-${e.key}`;
      // Ctrl+Shift+Delete — clear browsing data (opens Settings).
      if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) return "clear-data";
      // Ctrl+/ — the shortcut cheat-sheet.
      if (e.key === "/") return "shortcuts";
      const key = e.key.toLowerCase();
      if (key === "t") return e.shiftKey ? "reopen-tab" : "new-tab";
      if (key === "w") return "close-tab";
      if (key === "l") return "focus-omnibox";
      if (key === "r") return e.shiftKey ? "hard-reload" : "reload";
      if (key === "f") return "find";
      if (key === "h") return "history";
      if (key === "p") return "print";
      if (key === "j") return "downloads";
      if (key === "d") return "pin";
      if (key === ",") return "settings";
      if (e.key === "`") return "terminal";
      return null;
    };

    const onKey = (e: KeyboardEvent) => {
      // While a terminal has focus the shell owns the keyboard (Ctrl+R is
      // history search, Ctrl+L clears, …); only tab cycling stays global.
      if ((e.target as HTMLElement | null)?.closest?.("[data-terminal]")) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
          e.preventDefault();
          cycleTabs(e.shiftKey ? -1 : 1);
        }
        return;
      }
      // Escape closes the find bar, then an open extension popup.
      if (e.key === "Escape") {
        if (findOpen) {
          e.preventDefault();
          setFindOpen(false);
          return;
        }
        if (openExtIdRef.current) {
          e.preventDefault();
          silent(ipc.extClosePopup());
          setOpenExtId(null);
          return;
        }
      }
      const action = actionForKey(e);
      if (action) {
        e.preventDefault();
        runAction(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAction, cycleTabs, findOpen]);

  const pinnedUrls = useMemo(() => collectPinnedUrls(widgets), [widgets]);

  return (
    <div
      className="grid h-screen grid-cols-[minmax(0,1fr)] overflow-hidden"
      style={{
        gridTemplateRows: showExtBar
          ? `44px 48px ${EXT_BAR_HEIGHT}px minmax(0,1fr)`
          : "44px 48px minmax(0,1fr)",
      }}
    >
      <TitleBar
        tabs={tabs}
        activeId={activeTab.id}
        onSelect={activate}
        onClose={closeTab}
        onNewTab={handleNewTab}
        onReorder={reorderTabs}
        onToggleExtensions={toggleExtensions}
        extensionsActive={showExtBar}
        onDuplicate={duplicateTab}
        onReopenClosed={reopenClosedTab}
      />
      <Toolbar
        tab={activeTab}
        focusSignal={addressFocusSignal}
        sidebarOpen={sidebarOpen}
        engine={engineFor(settings.searchEngine)}
        pinned={activeTab.kind === "web" && isPinned(widgets, activeTab.url)}
        onToggleSidebar={toggleSidebar}
        onNavigate={navigateActive}
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
        onStop={onStop}
        onHome={goHome}
        onDiscover={goDiscover}
        onUnreal={goUnreal}
        onTerminal={goTerminal}
        onHistory={goHistory}
        onSettings={goSettings}
        onTogglePin={onTogglePin}
        onSuggestionsOpen={setOmniboxOpen}
        onDevtools={onDevtools}
        devtoolsActive={devtoolsVisible}
        onDownloadsPanelOpen={setDownloadsPanelOpen}
        downloadsOpenSignal={downloadsOpenSignal}
        onRetryDownload={onRetryDownload}
        onGithub={goGithub}
        onDiscord={goDiscord}
        onInstallExtension={installExtensionFromStore}
      />
      {showExtBar && (
        <ExtensionBar
          extensions={extensions}
          openId={openExtId}
          onOpenChange={setOpenExtId}
          onExtensionsChange={setExtensions}
          onBrowseStore={() => openNewTab(WEB_STORE_URL)}
          onToast={setToast}
        />
      )}
      <div className="flex min-h-0">
        {/* Kept mounted and width-animated so toggling doesn't hard-jump the
            layout; polling is gated by `active` so a collapsed sidebar is idle.
            The width transition is dropped while dragging so the bar tracks
            the pointer instead of easing after it. */}
        <div
          className={`relative flex-none overflow-hidden ${
            sidebarResizing ? "" : "transition-[width] duration-[150ms] ease-brand"
          }`}
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          aria-hidden={!sidebarOpen}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>
            <Sidebar
              active={sidebarOpen}
              widgets={widgets}
              games={config.games}
              itchApiKey={config.itchApiKey}
              onOpen={openNewTab}
              onDiscover={goDiscover}
              onUnreal={goUnreal}
              onCustomize={goWorkbar}
            />
          </div>
          {/* Resize handle. Lives inside the bar's width — anything to the
              right is painted over by the native tab webview. */}
          {sidebarOpen && (
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize work bar"
              aria-valuenow={sidebarWidth}
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              title="Drag or use the arrow keys to resize · double-click to reset"
              className="group absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none"
              onPointerDown={startSidebarResize}
              onPointerMove={moveSidebarResize}
              onPointerUp={endSidebarResize}
              onPointerCancel={endSidebarResize}
              onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
              onKeyDown={(e) => {
                // A `role="separator"` that ignores the arrow keys is a lie.
                const step =
                  e.key === "ArrowRight"
                    ? SIDEBAR_KEY_STEP
                    : e.key === "ArrowLeft"
                      ? -SIDEBAR_KEY_STEP
                      : 0;
                if (step) {
                  e.preventDefault();
                  setSidebarWidth((w) => clampSidebarWidth(w + step));
                } else if (e.key === "Home" || e.key === "End") {
                  e.preventDefault();
                  setSidebarWidth(e.key === "Home" ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH);
                }
              }}
            >
              <div
                className={`absolute right-[3px] top-1/2 h-11 w-[3px] -translate-y-1/2 rounded-full transition-colors duration-[130ms] ease-brand ${
                  sidebarResizing ? "bg-ink-300" : "bg-ink-600 group-hover:bg-ink-300"
                }`}
              />
            </div>
          )}
        </div>
        <div className="relative min-w-0 flex-1 bg-background">
          {/* Isolate the internal-page render: a throw in a widget or hub
              shows a local fallback instead of blanking the whole browser.
              Keyed by url so navigating to another page clears a prior error. */}
          <ErrorBoundary key={activeTab.url}>
          {activeTab.kind === "home" ? (
            activeTab.url === DISCOVER_URL ? (
              <Discover
                pinnedUrls={pinnedUrls}
                onOpen={openNewTab}
                onTogglePin={handleTogglePin}
              />
            ) : activeTab.url === UNREAL_URL ? (
              <UnrealHub games={config.games} />
            ) : activeTab.url === SETTINGS_URL ? (
              <Settings
                settings={settings}
                onUpdate={updateSettings}
                onResetPins={() => setWidgets(seedWidgets())}
                onCustomizeWorkbar={goWorkbar}
                onOpen={openNewTab}
              />
            ) : activeTab.url === HISTORY_URL ? (
              <History onOpen={openNewTab} />
            ) : activeTab.url === TERMINAL_URL ? (
              /* Rendered by the keep-alive layer below. */
              <div className="h-full" />
            ) : activeTab.url === WORKBAR_URL ? (
              <Workbar
                widgets={widgets}
                games={config.games}
                itchApiKey={config.itchApiKey}
                onChange={setWidgets}
                onOpen={openNewTab}
              />
            ) : (
              <Dashboard
                config={config}
                onSave={updateConfig}
                onOpen={openNewTab}
                onSearch={navigateActive}
                onUnreal={() => goInternal(UNREAL_URL)}
                focusKey={activeTab.id}
              />
            )
          ) : (
            <div className="h-full" />
          )}
          </ErrorBoundary>

          {/* A crashed renderer left a blank native surface (now hidden);
              offer a recover panel in its place. */}
          {activeTab.kind === "web" && activeTab.crashed && (
            <StatusPage
              title="This page stopped responding"
              actions={
                <Button variant="outline" onClick={() => reloadCrashed(activeTab)}>
                  Reload page
                </Button>
              }
            >
              Its process crashed or ran out of memory. Reload to try again — you won’t lose
              your other tabs.
            </StatusPage>
          )}

          {/* Branded network-error page for a failed main-frame navigation. */}
          {activeTab.kind === "web" && activeTab.navError && (
            <NavErrorPage
              code={activeTab.navError.code}
              url={activeTab.navError.url}
              onReload={() => {
                if (activeTab.navError) {
                  fire(
                    ipc.navigateTab(activeTab.id, activeTab.navError.url),
                    "Couldn’t reach that page",
                  );
                }
              }}
            />
          )}

          {/* TLS certificate-error interstitial (proceed / back to safety). */}
          {certActive && certReq && (
            <CertInterstitial
              req={certReq}
              onProceed={(id) => {
                fire(ipc.certRespond(id, true), "Couldn’t continue to that site");
                setCertReq(null);
              }}
              onCancel={(id) => {
                silent(ipc.certRespond(id, false));
                setCertReq(null);
              }}
            />
          )}

          {/* HTTP basic-auth credentials dialog. */}
          {authActive && authReq && (
            <BasicAuthDialog
              req={authReq}
              onSubmit={(id, u, p) => {
                fire(ipc.basicAuthRespond(id, u, p), "Couldn’t send those credentials");
                setAuthReq(null);
              }}
              onCancel={(id) => {
                silent(ipc.basicAuthRespond(id, null, null));
                setAuthReq(null);
              }}
            />
          )}

          {/* Permission bubble (camera/mic/geolocation/notifications/clipboard). */}
          {permActive && permissionReq && (
            <PermissionPrompt
              req={permissionReq}
              onRespond={(id, decision) => {
                // A dropped response leaves the page waiting on a deferral
                // forever — this is not a failure the user can be spared.
                fire(
                  ipc.permissionRespond(id, decision),
                  "Couldn’t answer that permission request",
                );
                setPermissionReq(null);
              }}
            />
          )}

          {/* Deep-link confirmation before handing a URL to another app. */}
          {externalUrl && (
            <ExternalLinkConfirm
              url={externalUrl}
              onOpen={() => {
                fire(ipc.openExternal(externalUrl), "No app is registered to open that link");
                setExternalUrl(null);
              }}
              onCancel={() => setExternalUrl(null)}
            />
          )}

          {/* Find-in-page, in the strip reserved by `findActive` above. */}
          {findActive && (
            <div className={cn("absolute right-4 top-1", Z_STRIP)}>
              <FindBar
                tabId={activeTab.id}
                pageUrl={activeTab.url}
                focusSignal={findFocusSignal}
                onClose={() => setFindOpen(false)}
              />
            </div>
          )}

          {/* Docked DevTools control strip (the inspector itself is the native
              panel webview the backend lays out beside/below it). */}
          {devtoolsVisible && (
            <DevtoolsDock
              dock={devtoolsDock}
              size={devtoolsSize}
              topOffset={findActive ? FIND_BAR_HEIGHT : 0}
              onResizeStart={() => {
                setDevtoolsResizing(true);
                // Hide the page while dragging, like the sidebar resize.
                silent(ipc.activateTab(null));
              }}
              onResize={setDevtoolsSize}
              onResizeEnd={(f) => {
                setDevtoolsSize(f);
                setDevtoolsResizing(false);
                // Commit the size, then re-show the page at the new split —
                // `finally` so a failed commit still leaves the page visible.
                silent(
                  ipc.devtoolsSetSize(f).finally(() => ipc.activateTab(activeTab.id)),
                );
              }}
              onToggleDock={() => {
                const next = devtoolsDock === "bottom" ? "right" : "bottom";
                setDevtoolsDock(next);
                silent(ipc.devtoolsSetDock(next));
              }}
              onClose={toggleDevtools}
            />
          )}

          {/* Terminal tabs stay mounted while hidden so their shell keeps
              running and scrollback survives tab switches. Suspense covers the
              lazy chunk's first load. */}
          <Suspense fallback={null}>
            {tabs
              .filter((t) => t.kind === "home" && t.url === TERMINAL_URL)
              .map((t) => (
                <div
                  key={t.id}
                  className="absolute inset-0"
                  style={{ display: t.id === activeTab.id ? "block" : "none" }}
                >
                  <TerminalView id={t.id} active={t.id === activeTab.id} />
                </div>
              ))}
          </Suspense>

          {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

          {defaultPrompt && <DefaultBrowserPrompt onDismiss={dismissDefaultPrompt} />}

          {/* Always-mounted live region so the toast is announced when it
              appears; the inner node carries the entrance animation. */}
          <div
            className={cn("pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2", Z_TOAST)}
            role="status"
            aria-live="polite"
          >
            {toast && (
              <div className="animate-rise rounded-lg border border-ink-800 bg-ink-900 px-4 py-2 text-[12.5px] text-ink-200 shadow-popover">
                {toast}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
