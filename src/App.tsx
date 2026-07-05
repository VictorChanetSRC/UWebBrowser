import {
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
import { PassPanel } from "./components/PassPanel";
import { PassSaveBanner, type Capture } from "./components/PassSaveBanner";
import { ExtensionBar, WEB_STORE_URL } from "./components/ExtensionBar";
import type { ExtInfo } from "./lib/ipc";
import { DefaultBrowserPrompt } from "./components/DefaultBrowserPrompt";
import { GITHUB_REPO_URL } from "./lib/github";
import { TerminalView } from "./components/TerminalView";
import { pruneTerminals } from "./lib/terminal";
import { initProvider, isNeverHost, pass } from "./lib/passwords";
import { ipc } from "./lib/ipc";
import { loadConfig, saveConfig, type UwbConfig } from "./lib/config";
import { loadSession, saveSession } from "./lib/session";
import type { LinkItem } from "./lib/engines";
import { recordVisit, updateTitle } from "./lib/history";
import { hostOf, tabLabelFor } from "./lib/url";
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
};

export const HOME_URL = "uwb://home";
export const DISCOVER_URL = "uwb://discover";
export const UNREAL_URL = "uwb://unreal";
export const SETTINGS_URL = "uwb://settings";
export const WORKBAR_URL = "uwb://workbar";
export const TERMINAL_URL = "uwb://terminal";
export const HISTORY_URL = "uwb://history";
const TOP_INSET = 92; // 44px title bar + 48px toolbar
const EXT_BAR_HEIGHT = 34; // pinned extensions strip, when shown
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 440;

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
// Panel is 384px wide at right-2 (8px); reserve it plus an 8px gap so the
// page shrinks beside the password panel instead of being hidden behind it.
const PASS_PANEL_RESERVE = 400;
const DEFAULT_PROMPT_SNOOZE_KEY = "uwb.defaultBrowser.snoozeUntil";
const DEFAULT_PROMPT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_PROMPT_DELAY_MS = 2500;

const internalTitle = (url: string) =>
  url === DISCOVER_URL
    ? "Discover"
    : url === UNREAL_URL
      ? "Unreal"
      : url === SETTINGS_URL
        ? "Settings"
        : url === WORKBAR_URL
          ? "Work bar"
          : url === TERMINAL_URL
            ? "Terminal"
            : url === HISTORY_URL
              ? "History"
              : "New tab";

const homeTab = (url: string = HOME_URL): Tab => ({
  id: crypto.randomUUID(),
  kind: "home",
  url,
  title: internalTitle(url),
  loading: false,
});

function normalizeInput(raw: string, searchUrl: (query: string) => string): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (input.startsWith("uwb:") || input.startsWith("gdb:")) {
    if (input.includes("discover")) return DISCOVER_URL;
    if (input.includes("unreal")) return UNREAL_URL;
    if (input.includes("settings")) return SETTINGS_URL;
    if (input.includes("workbar") || input.includes("widget")) return WORKBAR_URL;
    if (input.includes("term")) return TERMINAL_URL;
    if (input.includes("history")) return HISTORY_URL;
    return HOME_URL;
  }
  if (/^(https?|file):\/\//i.test(input)) return input;
  // A local path typed or pasted into the omnibox (C:\dev\page.html). encodeURI
  // covers spaces etc.; # is legal in Windows file names but not in URLs.
  if (/^[a-zA-Z]:[\\/]/.test(input)) {
    return encodeURI(`file:///${input.replace(/\\/g, "/")}`).replace(/#/g, "%23");
  }
  if (!input.includes(" ") && input.includes(".")) return `https://${input}`;
  return searchUrl(input);
}

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
  const [passOpen, setPassOpen] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [toast, setToast] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState(false);
  const [extensions, setExtensions] = useState<ExtInfo[]>([]);
  const [openExtId, setOpenExtId] = useState<string | null>(null);
  const [extBarOpen, setExtBarOpen] = useState(
    () => localStorage.getItem("uwb.extBar") === "1",
  );
  const closedUrls = useRef<string[]>([]);

  useEffect(() => saveWidgets(widgets), [widgets]);
  useEffect(() => saveSession(tabs, activeId), [tabs, activeId]);

  // Recreate the native webviews for web tabs restored from the last session,
  // then show the one that was active. createTab stacks each new webview on
  // top, so activation waits until all of them exist.
  useEffect(() => {
    const webTabs = tabsRef.current.filter((t) => t.kind === "web");
    if (webTabs.length === 0) return;
    let cancelled = false;
    (async () => {
      // Push the chrome layout to the native side before any webview exists:
      // createTab sizes the page from these insets, and at boot the layout
      // effect below hasn't reached the backend yet — without this the
      // restored page is created at 0,0 and covers the whole window.
      await ipc
        .setContentInsets(TOP_INSET, sidebarOpen ? sidebarWidth : 0, 0)
        .catch(() => {});
      for (const tab of webTabs) {
        // Fails harmlessly if the webview already exists (dev double-mount).
        await ipc.createTab(tab.id, tab.url).catch(() => {});
      }
      if (cancelled) return;
      const active = tabsRef.current.find((t) => t.id === activeIdRef.current);
      ipc.activateTab(active?.kind === "web" ? active.id : null).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kill PTY sessions whose tab is gone (closed, or navigated away from
  // uwb://terminal). Creation happens in TerminalView on first mount.
  useEffect(() => {
    const alive = new Set(
      tabs.filter((t) => t.kind === "home" && t.url === TERMINAL_URL).map((t) => t.id),
    );
    pruneTerminals(alive);
  }, [tabs]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const openExtIdRef = useRef(openExtId);
  openExtIdRef.current = openExtId;

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // The pinned extensions strip is a third chrome row; the content area (and
  // every tab webview) starts below it when shown.
  const showExtBar = extBarOpen;
  const topInset = TOP_INSET + (showExtBar ? EXT_BAR_HEIGHT : 0);

  // Tell the native side where the content area starts. While the password
  // panel is open the page shrinks to leave it room, staying visible. Pushes
  // are skipped mid-drag (the webview is hidden then); the final width lands
  // here once the drag ends.
  useEffect(() => {
    if (sidebarResizing) return;
    const left = sidebarOpen ? sidebarWidth : 0;
    const right = passOpen ? PASS_PANEL_RESERVE : 0;
    ipc.setContentInsets(topInset, left, right).catch(() => {});
    localStorage.setItem("uwb.sidebar", sidebarOpen ? "1" : "0");
    localStorage.setItem("uwb.sidebarWidth", String(sidebarWidth));
  }, [sidebarOpen, passOpen, sidebarWidth, sidebarResizing, topInset]);

  // Resizing happens entirely in the chrome layer: the native tab webview is
  // hidden for the duration (it paints over the chrome and would swallow
  // pointer events once the cursor crossed onto it), then re-shown at the
  // final width on release.
  const startSidebarResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSidebarResizing(true);
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab?.kind === "web") ipc.activateTab(null).catch(() => {});
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
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab?.kind !== "web") return;
    // Size the webview before showing it so it doesn't flash at the old width.
    ipc
      .setContentInsets(topInset, width, passOpen ? PASS_PANEL_RESERVE : 0)
      .catch(() => {})
      .then(() => ipc.activateTab(tab.id))
      .catch(() => {});
  };

  const openNewTab = useCallback(
    (url?: string) => {
      const tab = homeTab(url?.startsWith("uwb:") ? url : undefined);
      if (url && !url.startsWith("uwb:")) {
        tab.kind = "web";
        tab.url = url;
        tab.title = tabLabelFor(url);
        tab.loading = true;
        ipc.createTab(tab.id, url).catch(() => {});
      } else {
        // Internal pages render in the chrome; just clear the content area.
        ipc.activateTab(null).catch(() => {});
      }
      setTabs((prev) => [...prev, tab]);
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
      const current = tabsRef.current.find((t) => t.id === id);
      if (current) {
        if (kind === "url") recordVisit(value, "");
        if (kind === "title") updateTitle(current.url, value);
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== id) return tab;
          if (kind === "title") return { ...tab, title: value };
          if (kind === "loading") return { ...tab, loading: value === "true" };
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

  const activate = useCallback((tab: Tab) => {
    setActiveId(tab.id);
    ipc.activateTab(tab.kind === "web" ? tab.id : null).catch(() => {});
  }, []);

  // Poll the active web tab's live URL. SPAs (the Chrome Web Store especially)
  // route via the History API, which raises no native navigation event — so
  // without this the omnibox and the store "Add to UWebBrowser" button would
  // never see that you've moved to an extension's detail page.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (tab?.kind !== "web") return;
      ipc
        .tabLiveUrl(tab.id)
        .then((url) => {
          if (!url) return;
          setTabs((prev) =>
            prev.map((t) => (t.id === tab.id && t.url !== url ? { ...t, url } : t)),
          );
        })
        .catch(() => {});
    }, 700);
    return () => window.clearInterval(timer);
  }, []);

  // The native tab webview paints over any chrome overlay, so hide it while
  // the omnibox suggestions are showing. (The password panel instead reserves
  // a right inset above, so the page stays visible beside it.)
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab?.kind !== "web") return;
    ipc.activateTab(omniboxOpen ? null : tab.id).catch(() => {});
  }, [omniboxOpen]);

  // Sync the native backend to the user's saved choice on boot, then listen for
  // events from the injected content script (inline fill click, save prompt).
  useEffect(() => {
    initProvider();
    const unlisten = pass.onBridge((event) => {
      if (event.kind === "fill") {
        setPassOpen(true);
      } else if (event.kind === "capture") {
        // Honor "never for this site": drop the pending capture silently.
        if (isNeverHost(event.host)) {
          pass.dismissCapture(event.tabId).catch(() => {});
          return;
        }
        setCapture({
          tabId: event.tabId,
          host: event.host,
          username: event.username,
          mode: event.mode === "update" ? "update" : "new",
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Load installed extensions once. Auto-open the bar the first time any exist
  // (until the user makes their own choice, tracked in localStorage).
  useEffect(() => {
    ipc
      .extList()
      .then((list) => {
        setExtensions(list);
        if (list.length > 0 && localStorage.getItem("uwb.extBar") === null) {
          setExtBarOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  // Persist the bar preference; hiding it also dismisses any floating popup.
  useEffect(() => {
    localStorage.setItem("uwb.extBar", extBarOpen ? "1" : "0");
    if (!extBarOpen && openExtIdRef.current) {
      ipc.extClosePopup().catch(() => {});
      setOpenExtId(null);
    }
  }, [extBarOpen]);

  // The floating popup paints over the page and doesn't follow tab switches, so
  // close it whenever the active tab changes.
  useEffect(() => {
    if (!openExtIdRef.current) return;
    ipc.extClosePopup().catch(() => {});
    setOpenExtId(null);
  }, [activeId]);

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
    ipc
      .takeStartupUrls()
      .then((urls) => urls.forEach((url) => openNewTab(url)))
      .catch(() => {});
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
      ipc
        .isDefaultBrowser()
        .then((isDefault) => setDefaultPrompt(!isDefault))
        .catch(() => {});
    }, DEFAULT_PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The default is set in Windows Settings, not in-app — re-check when focus
  // comes back so the prompt closes itself once the choice sticks.
  useEffect(() => {
    if (!defaultPrompt) return;
    const onFocus = () => {
      ipc
        .isDefaultBrowser()
        .then((isDefault) => {
          if (isDefault) {
            setDefaultPrompt(false);
            setToast("UWebBrowser is now your default browser");
          }
        })
        .catch(() => {});
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
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
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
    [openNewTab],
  );

  const navigateActive = useCallback(
    (raw: string) => {
      const url = normalizeInput(raw, engineFor(settings.searchEngine).searchUrl);
      if (!url) return;
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!tab) return;
      if (url.startsWith("uwb:")) {
        goInternal(url);
        return;
      }
      if (tab.kind === "home") {
        ipc.createTab(tab.id, url).catch(() => {});
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? { ...t, kind: "web", url, title: tabLabelFor(url), loading: true }
              : t,
          ),
        );
      } else {
        ipc.navigateTab(tab.id, url).catch(() => {});
        setTabs((prev) =>
          prev.map((t) => (t.id === tab.id ? { ...t, url, loading: true } : t)),
        );
      }
    },
    [goInternal, settings],
  );

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const closing = current.find((t) => t.id === id);
    if (!closing) return;
    if (closing.kind === "web") {
      closedUrls.current.push(closing.url);
      ipc.closeTab(id).catch(() => {});
    }

    const remaining = current.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const fresh = homeTab();
      setTabs([fresh]);
      setActiveId(fresh.id);
      ipc.activateTab(null).catch(() => {});
      return;
    }
    setTabs(remaining);
    if (activeIdRef.current === id) {
      const index = current.findIndex((t) => t.id === id);
      const next = remaining[Math.min(index, remaining.length - 1)];
      setActiveId(next.id);
      ipc.activateTab(next.kind === "web" ? next.id : null).catch(() => {});
    }
  }, []);

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
  const withWebTab = useCallback((fn: (id: string) => void) => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab?.kind === "web") fn(tab.id);
  }, []);
  const handleNewTab = useCallback(() => openNewTab(), [openNewTab]);
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
  const openPasswords = useCallback(() => setPassOpen(true), []);
  const goGithub = useCallback(() => openNewTab(GITHUB_REPO_URL), [openNewTab]);
  const onBack = useCallback(() => withWebTab((id) => ipc.goBack(id)), [withWebTab]);
  const onForward = useCallback(() => withWebTab((id) => ipc.goForward(id)), [withWebTab]);
  const onReload = useCallback(() => withWebTab((id) => ipc.reload(id)), [withWebTab]);
  const onStop = useCallback(() => withWebTab((id) => ipc.stop(id)), [withWebTab]);
  const onTogglePin = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab?.kind === "web") {
      handleTogglePin({ name: tab.title || hostOf(tab.url), url: tab.url });
    }
  }, [handleTogglePin]);

  // Keyboard shortcuts (active while the chrome UI has focus).
  useEffect(() => {
    const currentTab = () =>
      tabsRef.current.find((t) => t.id === activeIdRef.current);

    const cycleTabs = (dir: 1 | -1) => {
      const list = tabsRef.current;
      const index = list.findIndex((t) => t.id === activeIdRef.current);
      const next = list[(index + dir + list.length) % list.length];
      if (next) activate(next);
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
      // Escape dismisses an open extension popup before anything else.
      if (e.key === "Escape" && openExtIdRef.current) {
        e.preventDefault();
        ipc.extClosePopup().catch(() => {});
        setOpenExtId(null);
        return;
      }
      const tab = currentTab();
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        if (tab?.kind === "web") ipc.goBack(tab.id);
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        if (tab?.kind === "web") ipc.goForward(tab.id);
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        if (tab?.kind === "web") ipc.reload(tab.id);
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "Tab") {
        e.preventDefault();
        cycleTabs(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const target = tabsRef.current[Math.min(Number(e.key), tabsRef.current.length) - 1];
        if (target) {
          e.preventDefault();
          activate(target);
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "l" && e.shiftKey) {
        e.preventDefault();
        setPassOpen((open) => !open);
        return;
      }
      if (key === "t" && e.shiftKey) {
        e.preventDefault();
        const url = closedUrls.current.pop();
        if (url) openNewTab(url);
        return;
      }
      if (key === ",") {
        e.preventDefault();
        goInternal(SETTINGS_URL);
        return;
      }
      if (key === "h") {
        e.preventDefault();
        goInternal(HISTORY_URL);
        return;
      }
      if (e.key === "`") {
        e.preventDefault();
        openNewTab(TERMINAL_URL);
        return;
      }
      if (key === "t") {
        e.preventDefault();
        openNewTab();
      } else if (key === "w") {
        e.preventDefault();
        closeTab(activeIdRef.current);
      } else if (key === "l") {
        e.preventDefault();
        setAddressFocusSignal((n) => n + 1);
      } else if (key === "r") {
        e.preventDefault();
        if (tab?.kind === "web") ipc.reload(tab.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewTab, closeTab, activate, goInternal]);

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
        onPasswords={openPasswords}
        onTogglePin={onTogglePin}
        onSuggestionsOpen={setOmniboxOpen}
        onGithub={goGithub}
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
              aria-orientation="vertical"
              aria-label="Resize work bar"
              title="Drag to resize · double-click to reset"
              className="group absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none"
              onPointerDown={startSidebarResize}
              onPointerMove={moveSidebarResize}
              onPointerUp={endSidebarResize}
              onPointerCancel={endSidebarResize}
              onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
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

          {/* Terminal tabs stay mounted while hidden so their shell keeps
              running and scrollback survives tab switches. */}
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

          {defaultPrompt && <DefaultBrowserPrompt onDismiss={dismissDefaultPrompt} />}

          {capture && (
            <PassSaveBanner
              capture={capture}
              onDone={(saved) => {
                setCapture(null);
                if (saved)
                  setToast(capture.mode === "update" ? "Password updated" : "Saved to your vault");
              }}
            />
          )}

          <PassPanel
            open={passOpen}
            onClose={() => setPassOpen(false)}
            activeUrl={activeTab.kind === "web" ? activeTab.url : ""}
            activeTabId={activeTab.kind === "web" ? activeTab.id : null}
            onToast={setToast}
            onOpenUrl={(url) => {
              setPassOpen(false);
              openNewTab(url);
            }}
          />

          {/* Always-mounted live region so the toast is announced when it
              appears; the inner node carries the entrance animation. */}
          <div
            className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2"
            role="status"
            aria-live="polite"
          >
            {toast && (
              <div className="animate-rise rounded-lg border border-ink-800 bg-ink-900 px-4 py-2 text-[12.5px] text-ink-200 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
                {toast}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
