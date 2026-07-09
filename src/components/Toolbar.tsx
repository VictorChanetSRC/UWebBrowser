import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Compass,
  Copy,
  Download,
  Globe,
  Hammer,
  History as HistoryIcon,
  House,
  Lock,
  LockOpen,
  PanelLeft,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Star,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import type { Tab } from "../App";
import { HOME_URL } from "../App";
import { suggestFromHistory, type HistoryEntry } from "../lib/history";
import type { SearchEngine } from "../lib/settings";
import { Favicon } from "@/components/ui/favicon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Downloads } from "@/components/Downloads";
import { usePolled } from "@/hooks/use-polled";
import { fmtNumber } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { copyText, hostOf, storeExtensionId } from "@/lib/url";
import { cn } from "@/lib/utils";

type Props = {
  tab: Tab;
  focusSignal: number;
  sidebarOpen: boolean;
  engine: SearchEngine;
  pinned: boolean;
  onToggleSidebar: () => void;
  onNavigate: (input: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onHome: () => void;
  onDiscover: () => void;
  onUnreal: () => void;
  onTerminal: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onTogglePin: () => void;
  onSuggestionsOpen: (open: boolean) => void;
  /** Toggle the docked DevTools panel for the active web tab. */
  onDevtools: () => void;
  /** Whether the docked DevTools panel is currently open for the active tab. */
  devtoolsActive: boolean;
  /** The downloads panel opened/closed; the app hides the page webview while
   *  it's open so the dropdown isn't painted over. */
  onDownloadsPanelOpen: (open: boolean) => void;
  downloadsOpenSignal: number;
  /** Opens the UWebBrowser repo — the toolbar's standing ask for a star. */
  onGithub: () => void;
  /** Opens the community Discord invite in a new tab. */
  onDiscord: () => void;
  /** Install the extension the current Web Store page is showing. */
  onInstallExtension: (id: string) => Promise<void>;
};

type Row =
  | { kind: "action"; input: string; isUrl: boolean }
  | { kind: "history"; entry: HistoryEntry };

const looksLikeUrl = (input: string) =>
  /^https?:\/\//i.test(input) ||
  input.startsWith("uwb:") ||
  (!input.includes(" ") && input.includes("."));

function ToolbarImpl(props: Props) {
  const { tab, focusSignal, engine } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [pageInfo, setPageInfo] = useState(false);
  const storeId = tab.kind === "web" ? storeExtensionId(tab.url) : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-opt-${index}`;

  const shown = draft ?? (tab.url === HOME_URL ? "" : tab.url);
  const typed = (draft ?? "").trim();

  // Reset any half-typed URL when switching tabs.
  useEffect(() => {
    setDraft(null);
    setEditing(false);
    setPageInfo(false);
  }, [tab.id]);

  // The page-info bubble makes no sense while typing a new address.
  useEffect(() => {
    if (editing) setPageInfo(false);
  }, [editing]);

  useEffect(() => {
    if (focusSignal > 0) setEditing(true);
  }, [focusSignal]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const suggestions = useMemo(
    () => (editing && typed ? suggestFromHistory(typed, 5) : []),
    [editing, typed],
  );
  const rows: Row[] = useMemo(() => {
    if (!editing || !typed) return [];
    return [
      { kind: "action", input: typed, isUrl: looksLikeUrl(typed) },
      ...suggestions
        .filter((entry) => entry.url !== typed)
        .map((entry): Row => ({ kind: "history", entry })),
    ];
  }, [editing, typed, suggestions]);
  const open = rows.length > 0;

  // The native tab webview sits on top of the chrome below the toolbar, so
  // the app hides it while the suggestion list is showing.
  useEffect(() => {
    props.onSuggestionsOpen(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setHighlight(0), [typed]);

  const close = () => {
    setDraft(null);
    setEditing(false);
    inputRef.current?.blur();
  };

  const choose = (row: Row) => {
    props.onNavigate(row.kind === "history" ? row.entry.url : row.input);
    close();
  };

  const submit = () => {
    const row = rows[highlight];
    if (row) {
      choose(row);
    } else if (draft !== null && draft.trim()) {
      props.onNavigate(draft);
      close();
    }
  };

  const copyUrl = async () => {
    await copyText(tab.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  // Parsing runs on every render; the 700ms live-URL poll feeds an unchanged
  // string most ticks, so memoize on the URL.
  const parsed = useMemo(() => parseUrl(tab.url), [tab.url]);
  const secure = tab.kind === "web" && parsed?.protocol === "https:";
  const insecure = tab.kind === "web" && parsed?.protocol === "http:";
  // The formatted URL is shown until the user clicks in; then the raw
  // editable URL takes over. No overlay, no transparent-text tricks.
  const showInput = editing || tab.kind === "home" || parsed === null;

  return (
    <div className="relative flex min-w-0 items-center gap-2.5 border-b border-border bg-background px-3">
      <IconButton
        label="Toggle sidebar"
        onClick={props.onToggleSidebar}
        aria-pressed={props.sidebarOpen}
      >
        <PanelLeft aria-hidden />
      </IconButton>

      <div className="flex gap-0.5">
        <IconButton
          label="Back · Alt+←"
          onClick={props.onBack}
          disabled={tab.kind === "home" || tab.canGoBack === false}
        >
          <ArrowLeft aria-hidden />
        </IconButton>
        <IconButton
          label="Forward · Alt+→"
          onClick={props.onForward}
          disabled={tab.kind === "home" || tab.canGoForward === false}
        >
          <ArrowRight aria-hidden />
        </IconButton>
        {tab.loading && tab.kind === "web" ? (
          <IconButton label="Stop loading" onClick={props.onStop}>
            <X aria-hidden />
          </IconButton>
        ) : (
          <IconButton label="Reload · Ctrl+R" onClick={props.onReload} disabled={tab.kind === "home"}>
            <RotateCw aria-hidden />
          </IconButton>
        )}
        <IconButton label="Dashboard" onClick={props.onHome}>
          <House aria-hidden />
        </IconButton>
        <IconButton label="Discover" onClick={props.onDiscover}>
          <Compass aria-hidden />
        </IconButton>
        <IconButton label="Unreal toolbench" onClick={props.onUnreal}>
          <Hammer aria-hidden />
        </IconButton>
        <IconButton label="Terminal · Ctrl+`" onClick={props.onTerminal}>
          <TerminalIcon aria-hidden />
        </IconButton>
        <IconButton label="History · Ctrl+H" onClick={props.onHistory}>
          <HistoryIcon aria-hidden />
        </IconButton>
      </div>

      <form
        className={cn(
          "relative flex h-9 min-w-0 flex-1 items-center gap-[9px] rounded-full border bg-ink-900 pl-3.5 pr-2 transition-[border-color,background-color] duration-[130ms] ease-brand",
          editing ? "border-ink-500 bg-background" : "border-border hover:border-ink-700",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {tab.kind === "web" && !editing && (secure || insecure) ? (
          <div className="relative flex-none">
            <button
              type="button"
              onClick={() => setPageInfo((v) => !v)}
              aria-label="Connection info"
              aria-expanded={pageInfo}
              className="flex items-center gap-1.5 rounded text-ink-500 transition-colors hover:text-ink-300"
            >
              {secure ? (
                <Lock className="size-3" strokeWidth={1.8} />
              ) : (
                <>
                  <LockOpen className="size-3" strokeWidth={1.8} />
                  <span className="text-[11px] text-ink-400">Not secure</span>
                  <span className="h-3.5 w-px bg-ink-800" />
                </>
              )}
            </button>
            {pageInfo && (
              <>
                {/* Click-away backdrop. */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setPageInfo(false)}
                />
                <div className="absolute left-0 top-7 z-50 w-72 animate-rise rounded-xl border border-ink-700 bg-ink-900 p-3.5 shadow-popover">
                  <div className="flex items-center gap-2">
                    {secure ? (
                      <Lock className="size-4 text-ink-300" strokeWidth={1.8} aria-hidden />
                    ) : (
                      <LockOpen className="size-4 text-signal-400" strokeWidth={1.8} aria-hidden />
                    )}
                    <span className="text-[13px] text-ink-100">
                      {secure ? "Connection is secure" : "Not secure"}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-snug text-ink-500">
                    {secure
                      ? `Your connection to ${parsed?.hostname ?? "this site"} is encrypted with TLS.`
                      : `This site uses HTTP. Data sent to ${parsed?.hostname ?? "it"} isn’t encrypted and could be read or changed.`}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPageInfo(false);
                      props.onSettings();
                    }}
                    className="mt-3 w-full rounded-lg border border-ink-800 px-2.5 py-1.5 text-left text-[12px] text-ink-200 transition-colors hover:bg-ink-800"
                  >
                    Site & privacy settings
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="flex flex-none items-center gap-1.5 text-ink-500" aria-hidden>
            <Search className="size-3" strokeWidth={1.8} />
          </span>
        )}

        {showInput ? (
          <input
            ref={inputRef}
            value={shown}
            spellCheck={false}
            placeholder={`Search ${engine.label} or enter address`}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open ? optionId(highlight) : undefined}
            aria-label="Address and search"
            className="min-w-0 flex-1 select-text bg-transparent font-mono text-[12.5px] text-ink-200 outline-none placeholder:font-sans placeholder:text-ink-500"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.target.select();
            }}
            onBlur={() => {
              setEditing(false);
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(null);
                inputRef.current?.blur();
              } else if (e.key === "ArrowDown" && open) {
                e.preventDefault();
                setHighlight((h) => (h + 1) % rows.length);
              } else if (e.key === "ArrowUp" && open) {
                e.preventDefault();
                setHighlight((h) => (h - 1 + rows.length) % rows.length);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 cursor-text items-center overflow-hidden whitespace-nowrap rounded text-left font-mono text-[12.5px]"
            onMouseDown={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
            onKeyDown={(e) => {
              // Keyboard users land here via Tab; Enter/Space opens edit mode
              // (matching the mouse) instead of doing nothing.
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }}
            aria-label={`Edit address${insecure ? ", current page is not secure" : secure ? ", current page is secure" : ""}`}
          >
            <span className="flex-none text-ink-200">{parsed!.hostname}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis text-ink-500">{pathOf(parsed!)}</span>
          </button>
        )}

        {tab.kind === "web" && !editing && (
          <span className="flex flex-none items-center gap-0.5">
            <PillButton label={copied ? "Copied" : "Copy address"} onClick={copyUrl}>
              {copied ? (
                <Check className="size-3 text-ink-100" aria-hidden />
              ) : (
                <Copy className="size-3" aria-hidden />
              )}
            </PillButton>
            <PillButton
              label={props.pinned ? "Unpin from work bar" : "Pin to work bar"}
              onClick={props.onTogglePin}
            >
              <Star
                className={cn("size-3", props.pinned && "fill-current text-ink-100")}
                aria-hidden
              />
            </PillButton>
          </span>
        )}

        {open && (
          <div
            id={listId}
            className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 py-1.5 shadow-popover"
            role="listbox"
          >
            {rows.map((row, index) => (
              <button
                key={row.kind === "history" ? row.entry.url : "action"}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3.5 py-[7px] text-left text-[12.5px]",
                  index === highlight ? "bg-ink-800 text-ink-100" : "text-ink-300",
                )}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(row);
                }}
              >
                {row.kind === "action" ? (
                  <>
                    <span className="flex size-5 flex-none items-center justify-center text-ink-500">
                      {row.isUrl ? (
                        <Globe className="size-3" strokeWidth={1.8} aria-hidden />
                      ) : (
                        <Search className="size-3" strokeWidth={1.8} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.input}
                      <span className="text-ink-500">
                        {" · "}
                        {row.isUrl ? "Open" : `Search ${engine.label}`}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex size-5 flex-none items-center justify-center">
                      <Favicon url={row.entry.url} className="size-3.5 rounded-[3px]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.entry.title || hostOf(row.entry.url)}
                      <span className="font-mono text-[12px] text-ink-500">
                        {" · "}
                        {row.entry.url.replace(/^https?:\/\/(www\.)?/i, "")}
                      </span>
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </form>

      {storeId && (
        <Button
          variant="ghost"
          size="pill"
          disabled={installing}
          className="flex-none border border-ink-700 px-2.5 text-[11.5px] text-ink-200 hover:bg-ink-800 disabled:opacity-60"
          onClick={async () => {
            setInstalling(true);
            try {
              await props.onInstallExtension(storeId);
            } finally {
              setInstalling(false);
            }
          }}
          title="Install this extension into UWebBrowser"
        >
          <Download aria-hidden className={installing ? "animate-pulse" : undefined} />
          {installing ? "Adding…" : "Add to UWebBrowser"}
        </Button>
      )}

      <Downloads
        onPanelOpenChange={props.onDownloadsPanelOpen}
        openSignal={props.downloadsOpenSignal}
      />

      <GithubStars onClick={props.onGithub} />

      <DiscordButton onClick={props.onDiscord} />

      <IconButton
        label="Developer tools · F12"
        onClick={props.onDevtools}
        disabled={tab.kind !== "web"}
        aria-pressed={props.devtoolsActive}
      >
        <Code2 aria-hidden />
      </IconButton>

      <IconButton label="Settings · Ctrl+," onClick={props.onSettings}>
        <SettingsIcon aria-hidden />
      </IconButton>

      {tab.loading && (
        /* The one Signal moment while browsing: page load in flight. */
        <div className="pointer-events-none absolute inset-x-0 -bottom-px z-[2] h-0.5 overflow-hidden" aria-hidden>
          <span className="loadbar block h-full w-[36%] animate-loadslide rounded-sm bg-signal-500" />
        </div>
      )}

      {/* Screen-reader announcement of load + security state — the visual
          loading bar and lock/"Not secure" glyphs are aria-hidden. */}
      <span className="sr-only" role="status" aria-live="polite">
        {tab.kind === "web"
          ? tab.loading
            ? `Loading ${parsed?.hostname ?? tab.title}`
            : `${tab.title || parsed?.hostname || "Page"} loaded${insecure ? ", not secure" : secure ? ", secure connection" : ""}`
          : ""}
      </span>
    </div>
  );
}

/** Re-renders only when its props change (tab, pinned, sidebarOpen, engine) —
 *  not on every unrelated App state change. */
export const Toolbar = memo(ToolbarImpl);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function pathOf(url: URL): string {
  const path = url.pathname + url.search + url.hash;
  return path === "/" ? "" : path;
}

/**
 * Live star count for the app's own repo, one click from the repo page.
 * The backend caches stats for 15 minutes, so this poll rides the same
 * fetch as the HQ widget and Settings. Until the first answer (or when
 * GitHub is unreachable) it's just the star glyph — never a broken number.
 */
function GithubStars({ onClick }: { onClick: () => void }) {
  const { data: stats } = usePolled(() => ipc.githubRepoStats(), [], 900_000, true, "github_stats");
  return (
    <Button
      variant="ghost"
      size="pill"
      className="px-2 text-ink-400"
      onClick={onClick}
      aria-label="Star UWebBrowser on GitHub"
      title="Star UWebBrowser on GitHub"
    >
      <Star aria-hidden />
      {stats !== null && (
        <span className="font-mono text-[11.5px] leading-none">
          {fmtNumber(stats.stars)}
        </span>
      )}
    </Button>
  );
}

/** One-click invite to the community Discord, sat beside the GitHub star. */
function DiscordButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="pill"
      className="px-2 text-ink-400"
      onClick={onClick}
      aria-label="Join the UWebBrowser Discord"
      title="Join the UWebBrowser Discord"
    >
      <DiscordIcon aria-hidden />
    </Button>
  );
}

function DiscordIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.291a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function PillButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex size-6 items-center justify-center rounded-full text-ink-500 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {props.children}
    </button>
  );
}
