import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Copy,
  Download,
  Globe,
  Hammer,
  History as HistoryIcon,
  House,
  KeyRound,
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
  onPasswords: () => void;
  onTogglePin: () => void;
  onSuggestionsOpen: (open: boolean) => void;
  /** Opens the UWebBrowser repo — the toolbar's standing ask for a star. */
  onGithub: () => void;
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
  }, [tab.id]);

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

  const parsed = parseUrl(tab.url);
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
        <IconButton label="Back · Alt+←" onClick={props.onBack} disabled={tab.kind === "home"}>
          <ArrowLeft aria-hidden />
        </IconButton>
        <IconButton label="Forward · Alt+→" onClick={props.onForward} disabled={tab.kind === "home"}>
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
        <span className="flex flex-none items-center gap-1.5 text-ink-500" aria-hidden>
          {editing || tab.kind === "home" ? (
            <Search className="size-3" strokeWidth={1.8} />
          ) : secure ? (
            <Lock className="size-3" strokeWidth={1.8} />
          ) : insecure ? (
            <>
              <LockOpen className="size-3" strokeWidth={1.8} />
              <span className="text-[11px] text-ink-400">Not secure</span>
              <span className="h-3.5 w-px bg-ink-800" />
            </>
          ) : (
            <Search className="size-3" strokeWidth={1.8} />
          )}
        </span>

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
            className="flex h-full min-w-0 flex-1 cursor-text items-center overflow-hidden whitespace-nowrap text-left font-mono text-[12.5px] focus-visible:outline-none"
            onMouseDown={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
            aria-label="Edit address"
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
            className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 py-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
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
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
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
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
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
          size="none"
          disabled={installing}
          className="h-[30px] flex-none gap-1.5 rounded-[7px] border border-ink-700 px-2.5 text-[11.5px] text-ink-200 hover:bg-ink-800 disabled:opacity-60 [&_svg]:size-3.5"
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

      <GithubStars onClick={props.onGithub} />

      <IconButton label="Passwords · Ctrl+Shift+L" onClick={props.onPasswords}>
        <KeyRound aria-hidden />
      </IconButton>

      <IconButton label="Settings · Ctrl+," onClick={props.onSettings}>
        <SettingsIcon aria-hidden />
      </IconButton>

      {tab.loading && (
        /* The one Signal moment while browsing: page load in flight. */
        <div className="pointer-events-none absolute inset-x-0 -bottom-px z-[2] h-0.5 overflow-hidden" aria-hidden>
          <span className="block h-full w-[36%] animate-loadslide rounded-sm bg-signal-500" />
        </div>
      )}
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
  const { data: stats } = usePolled(() => ipc.githubRepoStats(), [], 900_000);
  return (
    <Button
      variant="ghost"
      size="none"
      className="h-[30px] gap-1.5 rounded-[7px] px-2 text-ink-400 [&_svg]:size-3.5"
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
