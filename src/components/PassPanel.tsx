import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Dices,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  loadNeverHosts,
  pass,
  removeNeverHost,
  setProvider,
  refreshProvider,
  strength,
  type CredentialSummary,
  type GenerateOptions,
  type NewCredential,
  type ProviderReport,
} from "../lib/passwords";
import { useProvider } from "@/hooks/use-provider";
import { copyText } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Favicon } from "@/components/ui/favicon";
import { IconButton } from "@/components/ui/icon-button";
import { LiveDot } from "@/components/ui/live-dot";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The active tab's current URL, or "" for an internal page. */
  activeUrl: string;
  /** The active web tab's id, or null when a fill has nowhere to land. */
  activeTabId: string | null;
  onProviderChange?: (id: string) => void;
  onToast?: (message: string) => void;
  /** Open a URL in a new browser tab (used for Proton help links). */
  onOpenUrl?: (url: string) => void;
};

type View = "main" | "add" | "edit" | "settings";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function PassPanel(props: Props) {
  const { open, onClose, activeUrl, activeTabId } = props;
  const { id: activeProviderId } = useProvider();
  const [report, setReport] = useState<ProviderReport | null>(null);
  const [view, setView] = useState<View>("main");
  const [items, setItems] = useState<CredentialSummary[]>([]);
  const [matches, setMatches] = useState<CredentialSummary[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CredentialSummary | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Stable ref so callbacks that live in effect deps don't churn each render.
  const toastRef = useRef(props.onToast);
  toastRef.current = props.onToast;

  const state = report?.status.state;

  const loadVault = useCallback(async () => {
    try {
      const [all, forSite] = await Promise.all([
        pass.list(),
        activeUrl ? pass.matches(activeUrl) : Promise.resolve([] as CredentialSummary[]),
      ]);
      setItems(all);
      setMatches(forSite);
    } catch (e) {
      setItems([]);
      setMatches([]);
      toastRef.current?.(String(e));
    }
  }, [activeUrl]);

  const refresh = useCallback(async () => {
    const next = await refreshProvider().catch(() => null);
    setReport(next);
    if (next?.status.state === "unlocked") await loadVault();
    else {
      setItems([]);
      setMatches([]);
    }
  }, [loadVault]);

  // Sync the Rust backend to the shared choice, then load, whenever opened.
  useEffect(() => {
    if (!open) return;
    setView("main");
    setQuery("");
    let cancelled = false;
    (async () => {
      const current = await pass.status().catch(() => null);
      if (current && current.id !== activeProviderId) {
        await setProvider(activeProviderId).catch(() => {});
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refresh, activeProviderId]);

  // Trap focus within the panel while open, and restore it on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusablesOf = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    // Don't steal focus from an inner field that autoFocused on mount.
    if (!panel?.contains(document.activeElement)) focusablesOf()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusablesOf();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const doFill = useCallback(
    async (item: CredentialSummary) => {
      if (!activeTabId) return;
      try {
        await pass.fill(activeTabId, item.id);
        props.onToast?.(`Filled ${item.title || item.host}`);
        onClose();
      } catch (e) {
        props.onToast?.(String(e));
      }
    },
    [activeTabId, onClose, props],
  );

  const copyValue = useCallback(async (text: string, what: string) => {
    const ok = await copyText(text);
    toastRef.current?.(ok ? `${what} copied` : "Couldn't write to the clipboard");
  }, []);

  const doCopyUsername = useCallback(
    (item: CredentialSummary) => copyValue(item.username, "Username"),
    [copyValue],
  );

  // The password is fetched only for this one action and handed straight to
  // the clipboard — never kept in component state.
  const doCopyPassword = useCallback(
    async (item: CredentialSummary) => {
      try {
        const secret = await pass.reveal(item.id);
        await copyValue(secret.password, "Password");
      } catch (e) {
        toastRef.current?.(String(e));
      }
    },
    [copyValue],
  );

  const doEdit = useCallback((item: CredentialSummary) => {
    setEditing(item);
    setView("edit");
  }, []);

  const doDelete = useCallback(
    async (item: CredentialSummary) => {
      try {
        await pass.delete(item.id);
        toastRef.current?.(`Deleted ${item.title || item.host || "login"}`);
        await loadVault();
      } catch (e) {
        toastRef.current?.(String(e));
      }
    },
    [loadVault],
  );

  const changeProvider = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const next = await setProvider(id);
        setReport(next);
        props.onProviderChange?.(id);
        setView("main");
        if (next.status.state === "unlocked") await loadVault();
        else {
          setItems([]);
          setMatches([]);
        }
      } finally {
        setBusy(false);
      }
    },
    [loadVault, props],
  );

  if (!open) return null;

  const filtered = query
    ? items.filter((i) =>
        `${i.title} ${i.username} ${i.host}`.toLowerCase().includes(query.toLowerCase()),
      )
    : items;
  const matchIds = new Set(matches.map((m) => m.id));
  const others = filtered.filter((i) => !matchIds.has(i.id));
  const shownMatches = query ? [] : matches;

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="Passwords">
      <div className="absolute inset-0 bg-ink-950/50" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute right-2 top-2 flex max-h-[calc(100%-16px)] w-[384px] animate-rise flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      >
        <Header
          report={report}
          view={view}
          onBack={() => setView("main")}
          onSettings={() => setView("settings")}
          onLock={
            state === "unlocked"
              ? async () => {
                  await pass.lock().catch(() => {});
                  await refresh();
                }
              : undefined
          }
          onClose={onClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!report ? (
            <Centered>
              <Spinner className="size-5" />
            </Centered>
          ) : view === "settings" ? (
            <SettingsView activeId={report.id} busy={busy} onSelect={changeProvider} />
          ) : state === "unavailable" ? (
            <UnavailableView
              report={report}
              onUseLocal={() => changeProvider("local")}
              onInstalled={async (next) => {
                setReport(next);
                if (next.status.state === "unlocked") await loadVault();
              }}
            />
          ) : state === "needs_setup" ? (
            <SetupView onDone={refresh} />
          ) : state === "locked" ? (
            <UnlockView report={report} onDone={refresh} onOpenUrl={props.onOpenUrl} />
          ) : view === "add" ? (
            <AddView
              report={report}
              defaultUrl={activeUrl}
              onCancel={() => setView("main")}
              onSaved={async () => {
                setView("main");
                await loadVault();
                props.onToast?.("Saved to your vault");
              }}
            />
          ) : view === "edit" && editing ? (
            <EditView
              report={report}
              item={editing}
              onCancel={() => setView("main")}
              onSaved={async () => {
                setView("main");
                setEditing(null);
                await loadVault();
                props.onToast?.("Login updated");
              }}
            />
          ) : (
            <VaultView
              query={query}
              onQuery={setQuery}
              matches={shownMatches}
              others={others}
              canFill={Boolean(activeTabId)}
              canAdd={report.capabilities.canSave}
              canEdit={report.capabilities.canEdit}
              canDelete={report.capabilities.canDelete}
              onFill={doFill}
              onAdd={() => setView("add")}
              onCopyUsername={doCopyUsername}
              onCopyPassword={doCopyPassword}
              onEdit={doEdit}
              onDelete={doDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- header -----------------------------------------------------------------

function Header(props: {
  report: ProviderReport | null;
  view: View;
  onBack: () => void;
  onSettings: () => void;
  onLock?: () => void;
  onClose: () => void;
}) {
  const unlocked = props.report?.status.state === "unlocked";
  const nested = props.view !== "main";
  return (
    <header className="flex h-14 flex-none items-center gap-2.5 border-b border-ink-800 px-3.5">
      {nested ? (
        <IconButton label="Back" onClick={props.onBack}>
          <ArrowLeft aria-hidden />
        </IconButton>
      ) : (
        <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200">
          <KeyRound className="size-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink-100">
          {props.view === "add"
            ? "Add login"
            : props.view === "edit"
              ? "Edit login"
              : props.view === "settings"
                ? "Backend"
                : "Passwords"}
        </div>
        {props.report && props.view === "main" && (
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
            {unlocked && props.report.capabilities.syncs && <LiveDot className="size-1.5" />}
            <span className="truncate">{props.report.capabilities.label}</span>
          </div>
        )}
      </div>
      {props.view === "main" && (
        <>
          {props.onLock && (
            <IconButton label="Lock" onClick={props.onLock}>
              <Lock aria-hidden />
            </IconButton>
          )}
          <IconButton label="Backend" onClick={props.onSettings}>
            <Settings2 aria-hidden />
          </IconButton>
        </>
      )}
      <IconButton label="Close" onClick={props.onClose}>
        <X aria-hidden />
      </IconButton>
    </header>
  );
}

// --- vault (unlocked) -------------------------------------------------------

type RowActions = {
  canFill: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onFill: (item: CredentialSummary) => void;
  onCopyUsername: (item: CredentialSummary) => void;
  onCopyPassword: (item: CredentialSummary) => void;
  onEdit: (item: CredentialSummary) => void;
  onDelete: (item: CredentialSummary) => void;
};

function VaultView(props: RowActions & {
  query: string;
  onQuery: (q: string) => void;
  matches: CredentialSummary[];
  others: CredentialSummary[];
  canAdd: boolean;
  onAdd: () => void;
}) {
  const empty = props.matches.length === 0 && props.others.length === 0;
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-ink-800 bg-ink-900 p-2.5">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-ink-800 bg-ink-950 px-3 focus-within:border-ink-600">
          <Search className="size-3.5 flex-none text-ink-500" aria-hidden />
          <input
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Search logins"
            spellCheck={false}
            autoFocus
            className="min-w-0 flex-1 select-text bg-transparent text-[12.5px] text-ink-200 outline-none placeholder:text-ink-500"
          />
        </div>
        {props.canAdd && (
          <Button size="icon" variant="outline" onClick={props.onAdd} aria-label="Add login" title="Add login">
            <Plus className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {empty ? (
        <EmptyState query={props.query} canAdd={props.canAdd} onAdd={props.onAdd} />
      ) : (
        <div className="p-2">
          {props.matches.length > 0 && (
            <Section label="For this site">
              {props.matches.map((item) => (
                <ItemRow key={item.id} item={item} actions={props} highlighted />
              ))}
            </Section>
          )}
          {props.others.length > 0 && (
            <Section label={props.matches.length > 0 ? "All logins" : undefined}>
              {props.others.map((item) => (
                <ItemRow key={item.id} item={item} actions={props} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section(props: { label?: string; children: React.ReactNode }) {
  return (
    <section className="mb-1.5">
      {props.label && <Label className="mb-1 block px-2 text-[10.5px]">{props.label}</Label>}
      <div className="flex flex-col gap-0.5">{props.children}</div>
    </section>
  );
}

function ItemRow(props: { item: CredentialSummary; actions: RowActions; highlighted?: boolean }) {
  const { item, actions } = props;
  // Deleting is two clicks on the same spot: the trash arms, "Delete?" commits.
  // Moving the pointer off the row disarms.
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div
      onMouseLeave={() => setConfirmDelete(false)}
      className={cn(
        "group flex items-center rounded-lg pr-1 transition-colors duration-[130ms] ease-brand focus-within:bg-ink-800 hover:bg-ink-800",
        props.highlighted && "bg-ink-800/40",
      )}
    >
      <button
        type="button"
        disabled={!actions.canFill}
        onClick={() => actions.onFill(item)}
        title={actions.canFill ? "Fill this login" : "Open a website to fill"}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left",
          !actions.canFill && "cursor-default opacity-70",
        )}
      >
        <span className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-md border border-ink-800 bg-ink-950">
          <Favicon
            url={item.host ? `https://${item.host}` : ""}
            size={64}
            className="size-4 rounded-[3px]"
            fallback={<Globe className="size-4 text-ink-600" aria-hidden />}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-100">
            {item.title || item.host || "Untitled"}
          </span>
          <span className="block truncate font-mono text-[11.5px] text-ink-500">
            {item.username || "·"}
          </span>
        </span>
      </button>
      <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity duration-[130ms] focus-within:opacity-100 group-hover:opacity-100">
        {item.username && (
          <IconButton label="Copy username" onClick={() => actions.onCopyUsername(item)}>
            <User aria-hidden />
          </IconButton>
        )}
        <IconButton label="Copy password" onClick={() => actions.onCopyPassword(item)}>
          <KeyRound aria-hidden />
        </IconButton>
        {actions.canEdit && (
          <IconButton label="Edit login" onClick={() => actions.onEdit(item)}>
            <Pencil aria-hidden />
          </IconButton>
        )}
        {actions.canDelete &&
          (confirmDelete ? (
            <Button
              size="sm"
              variant="outline"
              className="h-[26px] border-signal-500/60 px-2 text-[11px] text-signal-400 hover:border-signal-500 hover:bg-signal-500/10 hover:text-signal-300"
              onClick={() => actions.onDelete(item)}
            >
              Delete?
            </Button>
          ) : (
            <IconButton label="Delete login" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
            </IconButton>
          ))}
      </div>
    </div>
  );
}

function EmptyState(props: { query: string; canAdd: boolean; onAdd: () => void }) {
  return (
    <Centered>
      <ShieldCheck className="mb-3 size-7 text-ink-700" aria-hidden />
      <p className="text-[13px] text-ink-300">
        {props.query ? "No logins match your search." : "No logins saved yet."}
      </p>
      {!props.query && props.canAdd && (
        <Button className="mt-4" variant="primary" onClick={props.onAdd}>
          <Plus className="size-4" aria-hidden /> Add your first login
        </Button>
      )}
    </Centered>
  );
}

// --- add / edit ---------------------------------------------------------------

function AddView(props: {
  report: ProviderReport;
  defaultUrl: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  return (
    <LoginEditor
      report={props.report}
      initial={{
        title: hostOf(props.defaultUrl),
        username: "",
        password: "",
        url: props.defaultUrl,
      }}
      submitLabel="Save login"
      onCancel={props.onCancel}
      onSubmit={async (item) => {
        await pass.save(item);
        props.onSaved();
      }}
    />
  );
}

function EditView(props: {
  report: ProviderReport;
  item: CredentialSummary;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // The stored password is fetched once to prefill the form; the editor isn't
  // shown until it lands, so a save can never silently blank it.
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    pass
      .reveal(props.item.id)
      .then((secret) => {
        if (!cancelled) setPassword(secret.password);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [props.item.id]);

  if (error) {
    return (
      <Centered>
        <p className="max-w-[280px] text-[12px] text-signal-400">{error}</p>
        <Button className="mt-4" variant="ghost" onClick={props.onCancel}>
          Back
        </Button>
      </Centered>
    );
  }
  if (password === null) {
    return (
      <Centered>
        <Spinner className="size-5" />
      </Centered>
    );
  }
  return (
    <LoginEditor
      report={props.report}
      initial={{
        title: props.item.title,
        username: props.item.username,
        password,
        url: props.item.url || (props.item.host ? `https://${props.item.host}` : ""),
      }}
      submitLabel="Save changes"
      onCancel={props.onCancel}
      onSubmit={async (item) => {
        await pass.update(props.item.id, item);
        props.onSaved();
      }}
    />
  );
}

/** The login form shared by add and edit. Owns the field state; the caller
 *  owns what submitting means. `onSubmit` may throw — its message is shown. */
function LoginEditor(props: {
  report: ProviderReport;
  initial: NewCredential;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (item: NewCredential) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [username, setUsername] = useState(props.initial.username);
  const [password, setPassword] = useState(props.initial.password);
  const [url, setUrl] = useState(props.initial.url);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password) {
      setError("A password is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.onSubmit({ title: title || hostOf(url), username, password, url });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label="Website">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
      </Field>
      <Field label="Name">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Example" />
      </Field>
      <Field label="Username or email">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" />
      </Field>
      <Field label="Password">
        <PasswordField
          value={password}
          onChange={setPassword}
          canGenerate={props.report.capabilities.canGenerate}
        />
      </Field>

      {error && <p className="text-[12px] text-signal-400">{error}</p>}

      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" onClick={props.onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <Check className="size-4" aria-hidden />}
          {props.submitLabel}
        </Button>
      </div>
    </div>
  );
}

const DEFAULT_GEN: GenerateOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
};

function PasswordField(props: {
  value: string;
  onChange: (v: string) => void;
  canGenerate: boolean;
}) {
  const [opts, setOpts] = useState<GenerateOptions>(DEFAULT_GEN);
  const [showGen, setShowGen] = useState(false);
  const score = strength(props.value);

  const generate = useCallback(
    async (next: GenerateOptions) => {
      try {
        const value = await pass.generate(next);
        props.onChange(value);
      } catch {
        /* keep the current field on generator error */
      }
    },
    [props],
  );

  const toggle = (key: keyof GenerateOptions) => {
    const next = { ...opts, [key]: !opts[key] } as GenerateOptions;
    setOpts(next);
    generate(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="Password"
          className="font-mono text-[12.5px]"
          type="text"
          spellCheck={false}
        />
        {props.canGenerate && (
          <Button
            variant="outline"
            size="icon"
            className="h-[38px] w-[38px] flex-none"
            aria-label="Generate password"
            title="Generate password"
            onClick={() => {
              setShowGen((s) => !s);
              generate(opts);
            }}
          >
            <Dices className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      <StrengthMeter score={score} />

      {showGen && props.canGenerate && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-ink-800 bg-ink-950 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-[10.5px]">Length</Label>
            <span className="font-mono text-[12px] text-ink-300">{opts.length}</span>
          </div>
          <input
            type="range"
            min={8}
            max={48}
            value={opts.length}
            onChange={(e) => {
              const next = { ...opts, length: Number(e.target.value) };
              setOpts(next);
              generate(next);
            }}
            className="accent-signal-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["uppercase", "A-Z"],
                ["lowercase", "a-z"],
                ["digits", "0-9"],
                ["symbols", "#$&"],
              ] as [keyof GenerateOptions, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={Boolean(opts[key])}
                onClick={() => toggle(key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors duration-[130ms] ease-brand",
                  opts[key]
                    ? "border-ink-500 bg-ink-800 text-ink-100"
                    : "border-ink-800 text-ink-500 hover:border-ink-700",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrengthMeter(props: { score: number }) {
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-[130ms]",
              i < props.score ? (props.score >= 3 ? "bg-ink-300" : "bg-ink-500") : "bg-ink-800",
            )}
          />
        ))}
      </div>
      <span className="w-10 text-right font-mono text-[10.5px] text-ink-500">
        {labels[props.score]}
      </span>
    </div>
  );
}

// --- unlock / setup / unavailable -------------------------------------------

function UnlockView(props: {
  report: ProviderReport;
  onDone: () => void;
  onOpenUrl?: (url: string) => void;
}) {
  const isToken = props.report.capabilities.unlockSecret === "token";
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await pass.unlock(secret || null);
      props.onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-ink-800 text-ink-300">
          <Lock className="size-5" aria-hidden />
        </span>
        <p className="max-w-[240px] text-[13px] text-ink-400">{props.report.status.detail}</p>
      </div>

      <Field label={isToken ? "Access token" : "Master password"}>
        <Input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isToken ? "Paste your Proton Pass token" : "Master password"}
          autoFocus
        />
      </Field>

      {isToken && <TokenHelp onOpenUrl={props.onOpenUrl} />}
      {error && <p className="text-[12px] text-signal-400">{error}</p>}

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? <Spinner className="size-4" /> : <LockOpen className="size-4" aria-hidden />}
        Unlock
      </Button>
    </form>
  );
}

/** How to get a Proton Pass access token, with links into the web app. */
function TokenHelp(props: { onOpenUrl?: (url: string) => void }) {
  const steps = [
    "Open pass.proton.me, then Settings → Access tokens.",
    "New token. Name it, choose the vaults to autofill from, set an expiry.",
    "Copy it and paste it above. Proton shows it only once.",
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ink-800 bg-ink-950 p-3.5">
      <Label className="text-[10.5px]">Get a token</Label>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-px flex size-4 flex-none items-center justify-center rounded-full bg-ink-800 font-mono text-[10px] text-ink-300">
              {i + 1}
            </span>
            <span className="text-[12px] leading-snug text-ink-300">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink-800 pt-3">
        <LinkOut label="Open Proton Pass" onClick={() => props.onOpenUrl?.("https://pass.proton.me")} />
        <LinkOut
          label="How tokens work"
          onClick={() => props.onOpenUrl?.("https://proton.me/support/pass-access-tokens")}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-500">
        Access tokens need Pass Plus or a Proton bundle. Already ran{" "}
        <span className="font-mono text-ink-400">pass-cli login</span>? Leave the field blank and
        unlock.
      </p>
    </div>
  );
}

function LinkOut(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="inline-flex items-center gap-1 text-[12px] text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline"
    >
      {props.label}
      <ExternalLink className="size-3" aria-hidden />
    </button>
  );
}

function SetupView(props: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const score = strength(pw);

  const submit = async () => {
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError("");
    try {
      await pass.setup(pw);
      props.onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-ink-800 text-ink-300">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <p className="max-w-[260px] text-[13px] text-ink-400">
          Set a master password. It encrypts your vault on this device and is the one thing you
          can't recover. Pick something strong.
        </p>
      </div>

      <Field label="Master password">
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <div className="mt-2">
          <StrengthMeter score={score} />
        </div>
      </Field>
      <Field label="Confirm">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>

      {error && <p className="text-[12px] text-signal-400">{error}</p>}

      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? <Spinner className="size-4" /> : <ShieldCheck className="size-4" aria-hidden />}
        Create vault
      </Button>
    </form>
  );
}

function UnavailableView(props: {
  report: ProviderReport;
  onUseLocal: () => void;
  onInstalled: (report: ProviderReport) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canInstall = props.report.id === "proton";

  const install = async () => {
    setBusy(true);
    setError("");
    try {
      props.onInstalled(await pass.installCli());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-ink-800 text-ink-400">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <p className="max-w-[280px] text-[13px] text-ink-300">{props.report.status.detail}</p>

      {canInstall && (
        <Button className="mt-5" variant="primary" onClick={install} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <Download className="size-4" aria-hidden />}
          {busy ? "Installing…" : "Install Proton Pass CLI"}
        </Button>
      )}

      {error && <p className="mt-3 max-w-[280px] text-[12px] text-signal-400">{error}</p>}

      <button
        type="button"
        onClick={props.onUseLocal}
        className="mt-4 text-[12.5px] text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
      >
        Use the on-device vault instead
      </button>

      {canInstall && (
        <p className="mt-5 max-w-[280px] text-[11px] leading-relaxed text-ink-400">
          Installs Proton's official package with winget. Takes a moment. No restart needed.
        </p>
      )}
    </Centered>
  );
}

// --- backend picker ---------------------------------------------------------

function SettingsView(props: {
  activeId: string;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderReport[] | null>(null);

  useEffect(() => {
    pass.providers().then(setProviders).catch(() => setProviders([]));
  }, []);

  return (
    <div className="flex flex-col gap-2.5 p-4">
      <Label className="px-1 text-[10.5px]">Store passwords with</Label>
      {!providers ? (
        <Centered>
          <Spinner className="size-5" />
        </Centered>
      ) : (
        providers.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={props.busy}
            onClick={() => props.onSelect(p.id)}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors duration-[130ms] ease-brand",
              p.id === props.activeId
                ? "border-ink-500 bg-ink-800"
                : "border-ink-800 hover:border-ink-700 hover:bg-ink-800/50",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-medium text-ink-100">{p.capabilities.label}</span>
              {p.capabilities.syncs && (
                <span className="rounded-full border border-ink-700 px-1.5 py-px font-mono text-[9.5px] uppercase tracking-wider text-ink-400">
                  Sync
                </span>
              )}
              {p.id === props.activeId && (
                <Check className="ml-auto size-4 text-ink-200" aria-hidden />
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-ink-400">{p.capabilities.blurb}</p>
            <StatusLine status={p.status} />
          </button>
        ))
      )}
      <p className="mt-1 px-1 text-[11.5px] leading-relaxed text-ink-500">
        Switching backends changes where new logins are saved. Each keeps its own items.
      </p>
      <NeverList />
    </div>
  );
}

/** Sites the save prompt was told to stop asking about, with a way back. */
function NeverList() {
  const [hosts, setHosts] = useState<string[]>(() => loadNeverHosts());
  if (hosts.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Label className="px-1 text-[10.5px]">Never offer to save for</Label>
      <div className="flex flex-col gap-0.5">
        {hosts.map((host) => (
          <div
            key={host}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-800/50"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-300">
              {host}
            </span>
            <IconButton
              label={`Offer to save for ${host} again`}
              onClick={() => {
                removeNeverHost(host);
                setHosts(loadNeverHosts());
              }}
            >
              <X aria-hidden />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusLine(props: { status: ProviderReport["status"] }) {
  const tone =
    props.status.state === "unlocked"
      ? "text-ink-300"
      : props.status.state === "unavailable"
        ? "text-ink-500"
        : "text-ink-400";
  const dot =
    props.status.state === "unlocked"
      ? "bg-ink-300"
      : props.status.state === "unavailable"
        ? "bg-ink-600"
        : "bg-ink-500";
  return (
    <div className={cn("mt-0.5 flex items-center gap-1.5 font-mono text-[11px]", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      <span className="truncate">{props.status.detail}</span>
    </div>
  );
}

// --- shared bits ------------------------------------------------------------

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label className="text-[10.5px]">{props.label}</Label>
      {props.children}
    </label>
  );
}

function Centered(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
      {props.children}
    </div>
  );
}
