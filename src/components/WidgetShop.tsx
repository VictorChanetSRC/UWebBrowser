import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { authorInitials, type WidgetAuthor } from "@/widgets/authors";
import type { Game } from "../lib/config";
import {
  filterShop,
  SHOP_CATEGORIES,
  shopCategory,
  type ShopCategoryKey,
  type ShopEntry,
} from "../lib/widget-shop";
import {
  DASH_ICONS,
  DASH_SHOP,
  dashPreview,
  DashWidgetBody,
  type DashWidget,
  type DashWidgetType,
} from "@/widgets/dashboard";
import {
  BAR_ICONS,
  BAR_SHOP,
  barPreview,
  BarWidgetBody,
  type Widget,
  type WidgetType,
} from "@/widgets/workbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RailButton } from "@/components/ui/rail-button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/**
 * The widget shop: one browse-and-add overlay shared by every surface that
 * takes widgets. A surface hands it a shelf of entries, an icon map, live
 * counts and a preview renderer; the shop does the rest — categories, search,
 * detail pages with a live preview, and add with feedback.
 */

const noop = () => {};

/** Dotted "drafting paper" backdrop shared by every preview frame. */
const DOTTED = {
  backgroundImage: "radial-gradient(var(--color-ink-800) 1px, transparent 1px)",
  backgroundSize: "14px 14px",
};

type ShopProps<T extends string> = {
  open: boolean;
  onClose: () => void;
  /** Where the widgets land, e.g. "Home board". */
  surface: string;
  /** The word in copy: "board" or "bar". */
  noun: string;
  entries: ShopEntry<T>[];
  icons: Record<T, LucideIcon>;
  /** How many of each type the surface holds right now. */
  counts: Map<T, number>;
  /** Total widgets on the surface, for the rail summary. */
  total: number;
  onAdd: (type: T) => void;
  /** A widget body at its natural size; the shop scales it to fit. `live` is
   *  true only for the single focused detail preview — grid cards render inert
   *  so opening the shop doesn't spin up a poll per card. */
  renderPreview: (type: T, live: boolean) => ReactNode;
  /** Stage heights for the live previews, per placement. */
  previewHeights: { card: number; detail: number };
  /** Mono line under the detail preview frame. */
  previewCaption: string;
  /** Opens a URL in a browser tab; powers the author page's site link. */
  onOpenUrl?: (url: string) => void;
  /** What an author has on the *other* surface, e.g. "5 more on the work bar". */
  authorElsewhere?: (authorId: string) => string | null;
};

/**
 * Where the browsing pane is: the shelf grid, one widget's detail page, or
 * an author's page. Detail and author remember where they were opened from,
 * so Back (and Escape) walk out the way you came in.
 */
type ShopView<T extends string> =
  | { kind: "grid" }
  | { kind: "detail"; type: T; fromAuthor?: string }
  | { kind: "author"; id: string; fromType?: T };

/** One step back: to the page a view was opened from, or the grid. */
function backOf<T extends string>(view: ShopView<T>): ShopView<T> {
  if (view.kind === "detail" && view.fromAuthor) return { kind: "author", id: view.fromAuthor };
  if (view.kind === "author" && view.fromType) return { kind: "detail", type: view.fromType };
  return { kind: "grid" };
}

export function WidgetShop<T extends string>({
  open,
  onClose,
  surface,
  noun,
  entries,
  icons,
  counts,
  total,
  onAdd,
  renderPreview,
  previewHeights,
  previewCaption,
  onOpenUrl,
  authorElsewhere,
}: ShopProps<T>) {
  const [category, setCategory] = useState<ShopCategoryKey | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ShopView<T>>({ kind: "grid" });
  /** The type whose Add just fired; its button reads "Added" for a beat. */
  const [justAdded, setJustAdded] = useState<T | null>(null);
  const addedTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // A fresh visit starts at the front of the shop.
  useEffect(() => {
    if (!open) return;
    setCategory("all");
    setQuery("");
    setView({ kind: "grid" });
    setJustAdded(null);
  }, [open]);

  useEffect(() => () => window.clearTimeout(addedTimer.current), []);

  // Trap focus within the panel while open, and restore it on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusablesOf = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    if (!panel?.contains(document.activeElement)) searchRef.current?.focus();
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

  // Escape peels one layer: author/detail pages walk back out the way they
  // were opened, and only the front of the shop closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setView((current) => {
        if (current.kind === "grid") {
          onClose();
          return current;
        }
        return backOf(current);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(
    () => filterShop(entries, category, query),
    [entries, category, query],
  );

  if (!open) return null;

  const add = (type: T) => {
    onAdd(type);
    setJustAdded(type);
    window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(null), 1400);
  };

  const browse = (next: ShopCategoryKey | "all") => {
    setCategory(next);
    setView({ kind: "grid" });
  };

  const goBack = () => setView((current) => backOf(current));

  /** The Back button names the page it returns to. */
  const backLabel = (target: ShopView<T>): string => {
    if (target.kind === "author") {
      return entries.find((e) => e.creator.id === target.id)?.creator.name ?? "Back";
    }
    if (target.kind === "detail") {
      return entries.find((e) => e.type === target.type)?.name ?? "Back";
    }
    return "All widgets";
  };

  const detailEntry =
    view.kind === "detail" ? entries.find((e) => e.type === view.type) : undefined;
  const author =
    view.kind === "author"
      ? entries.find((e) => e.creator.id === view.id)?.creator
      : undefined;

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="Widget shop">
      <div
        ref={panelRef}
        className="flex h-full animate-rise flex-col overflow-hidden bg-background"
      >
        <header className="flex flex-none items-center gap-3 border-b border-border py-3 pl-6 pr-3">
          <Store className="size-4 flex-none text-ink-300" aria-hidden />
          <span className="text-[13.5px] font-semibold text-ink-100">Widget shop</span>
          <Tag>{surface}</Tag>
          <div className="relative ml-auto w-[300px] max-w-[40%]">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-500"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={query}
              placeholder="Search widgets"
              aria-label="Search widgets"
              className="h-8 rounded-md pl-8 text-[12.5px]"
              onChange={(e) => {
                setQuery(e.target.value);
                setView({ kind: "grid" });
              }}
              onKeyDown={(e) => {
                // Escape clears the query first; a second press closes.
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[210px] flex-none flex-col border-r border-border p-3.5" aria-label="Widget categories">
            <RailButton
              label="All widgets"
              count={entries.length}
              active={category === "all" && view.kind === "grid"}
              onClick={() => browse("all")}
            />
            {SHOP_CATEGORIES.map((c) => {
              const size = entries.filter((e) => e.category === c.key).length;
              if (size === 0) return null;
              return (
                <RailButton
                  key={c.key}
                  label={c.label}
                  count={size}
                  active={category === c.key && view.kind === "grid"}
                  onClick={() => browse(c.key)}
                />
              );
            })}
            <div className="mt-auto border-t border-border px-2.5 pb-1 pt-3.5">
              <Label className="text-[10px]">On your {noun}</Label>
              <p className="mt-1.5 font-mono text-[22px] leading-none tabular-nums text-ink-200">
                {total}
              </p>
              <p className="mt-1.5 text-[11px] leading-[1.5] text-ink-500">
                widgets right now. All of these are free — it's your browser.
              </p>
            </div>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {view.kind === "author" && author ? (
              <AuthorPage
                author={author}
                noun={noun}
                widgetCount={entries.filter((e) => e.creator.id === author.id).length}
                installedCount={entries
                  .filter((e) => e.creator.id === author.id)
                  .reduce((n, e) => n + (counts.get(e.type) ?? 0), 0)}
                elsewhere={authorElsewhere?.(author.id) ?? null}
                backLabel={backLabel(backOf(view))}
                onBack={goBack}
                onOpenUrl={onOpenUrl}
              >
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                  {entries
                    .filter((e) => e.creator.id === author.id)
                    .map((entry) => (
                      <ShopCard
                        key={entry.type}
                        entry={entry}
                        Icon={icons[entry.type]}
                        count={counts.get(entry.type) ?? 0}
                        noun={noun}
                        justAdded={justAdded === entry.type}
                        onOpen={() =>
                          setView({ kind: "detail", type: entry.type, fromAuthor: author.id })
                        }
                        onAdd={() => add(entry.type)}
                        preview={renderPreview(entry.type, false)}
                        previewHeight={previewHeights.card}
                      />
                    ))}
                </div>
              </AuthorPage>
            ) : detailEntry ? (
              <ShopDetail
                entry={detailEntry}
                Icon={icons[detailEntry.type]}
                count={counts.get(detailEntry.type) ?? 0}
                noun={noun}
                justAdded={justAdded === detailEntry.type}
                backLabel={backLabel(backOf(view))}
                onBack={goBack}
                onAuthor={() =>
                  setView({
                    kind: "author",
                    id: detailEntry.creator.id,
                    fromType: detailEntry.type,
                  })
                }
                onAdd={() => add(detailEntry.type)}
                preview={renderPreview(detailEntry.type, true)}
                previewHeight={previewHeights.detail}
                previewCaption={previewCaption}
              />
            ) : (
              <div className="flex flex-col gap-4 p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-3">
                    <Label>
                      {query
                        ? "Results"
                        : category === "all"
                          ? "All widgets"
                          : shopCategory(category).label}
                    </Label>
                    <span className="text-[12px] text-ink-500">
                      {query
                        ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
                        : category === "all"
                          ? "Browse the shelf, or open a widget for the full story."
                          : shopCategory(category).blurb}
                    </span>
                  </div>
                </div>

                {results.length === 0 ? (
                  <EmptyState
                    title={
                      <span className="font-mono text-[12px] text-ink-400">
                        Nothing matches &ldquo;{query}&rdquo;.
                      </span>
                    }
                  >
                    <Button variant="link" size="none" className="text-[12.5px]" onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                    {results.map((entry) => (
                      <ShopCard
                        key={entry.type}
                        entry={entry}
                        Icon={icons[entry.type]}
                        count={counts.get(entry.type) ?? 0}
                        noun={noun}
                        justAdded={justAdded === entry.type}
                        onOpen={() => setView({ kind: "detail", type: entry.type })}
                        onAuthor={() => setView({ kind: "author", id: entry.creator.id })}
                        onAdd={() => add(entry.type)}
                        preview={renderPreview(entry.type, false)}
                        previewHeight={previewHeights.card}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- previews -------------------------------- */

/**
 * A preview stage: fixed height, dotted backdrop, the live widget centered at
 * its natural size and scaled down (never up) to fit. Bodies keep their real
 * layout — what scales is only the rendering — so the preview stays honest
 * while the stage holds the grid's rhythm.
 */
function PreviewFit({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const inner = innerRef.current;
    if (!frame || !inner) return;
    // Breathing room so a preview never kisses the frame.
    const PAD = 28;
    const fit = () => {
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !h) return;
      setScale(Math.min(1, (frame.clientWidth - PAD) / w, (height - PAD) / h));
    };
    fit();
    // Refit when the card resizes or the live body grows into its data.
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [height]);

  return (
    <div
      ref={frameRef}
      className={cn("flex items-center justify-center overflow-hidden", className)}
      style={{ height, ...DOTTED }}
    >
      <div ref={innerRef} className="flex-none" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- cards ---------------------------------- */

function ShopCard<T extends string>({
  entry,
  Icon,
  count,
  noun,
  justAdded,
  onOpen,
  onAuthor,
  onAdd,
  preview,
  previewHeight,
}: {
  entry: ShopEntry<T>;
  Icon: LucideIcon;
  count: number;
  noun: string;
  justAdded: boolean;
  onOpen: () => void;
  /** Opens the creator's author page; omit where that's where you already are. */
  onAuthor?: () => void;
  onAdd: () => void;
  preview: ReactNode;
  previewHeight: number;
}) {
  const maxed = !entry.repeatable && count > 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-ink-900 transition-[border-color] duration-[130ms] ease-brand hover:border-ink-600">
      {/* The whole card opens the detail page; real controls sit above it. */}
      <button className="absolute inset-0" onClick={onOpen} aria-label={`View ${entry.name}`} />
      <div className="pointer-events-none flex items-center gap-2.5 p-3.5 pb-2.5">
        <div className="flex size-8 flex-none items-center justify-center rounded-lg border border-border bg-background">
          <Icon className="size-3.5 text-ink-300" aria-hidden />
        </div>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-100">
          {entry.name}
        </span>
        {count > 0 && <Tag>{count > 1 ? `×${count}` : "Added"}</Tag>}
        <ChevronRight
          className="size-3.5 flex-none text-ink-600 opacity-0 transition-opacity duration-[130ms] ease-brand group-hover:opacity-100"
          aria-hidden
        />
      </div>
      <p className="pointer-events-none min-h-[36px] px-3.5 pb-3 text-[12px] leading-[1.5] text-ink-400">
        {entry.tagline}
      </p>
      <PreviewFit
        height={previewHeight}
        className="pointer-events-none mt-auto border-t border-border"
      >
        {preview}
      </PreviewFit>
      <div className="pointer-events-none flex items-center justify-between gap-3 border-t border-border py-2 pl-3.5 pr-2">
        <span className="min-w-0 truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-600">
          {shopCategory(entry.category).label} ·{" "}
          {onAuthor ? (
            <button
              className="pointer-events-auto relative underline-offset-2 transition-[color] duration-[130ms] ease-brand hover:text-ink-300 hover:underline"
              onClick={onAuthor}
              aria-label={`View widgets by ${entry.creator.name}`}
            >
              {entry.creator.name}
            </button>
          ) : (
            entry.creator.name
          )}
        </span>
        <Button
          size="sm"
          className="pointer-events-auto relative flex-none"
          disabled={maxed}
          title={maxed ? `Already on your ${noun}` : undefined}
          aria-label={`Add ${entry.name}`}
          onClick={onAdd}
        >
          {justAdded ? <Check className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
          {justAdded ? "Added" : "Add"}
        </Button>
      </div>
    </article>
  );
}

/* --------------------------------- detail --------------------------------- */

function ShopDetail<T extends string>({
  entry,
  Icon,
  count,
  noun,
  justAdded,
  backLabel,
  onBack,
  onAuthor,
  onAdd,
  preview,
  previewHeight,
  previewCaption,
}: {
  entry: ShopEntry<T>;
  Icon: LucideIcon;
  count: number;
  noun: string;
  justAdded: boolean;
  backLabel: string;
  onBack: () => void;
  onAuthor: () => void;
  onAdd: () => void;
  preview: ReactNode;
  previewHeight: number;
  previewCaption: string;
}) {
  const maxed = !entry.repeatable && count > 0;

  return (
    <div className="flex animate-rise flex-col gap-6 p-6">
      <div>
        <Button variant="link" size="none" className="gap-1.5 text-[12.5px] font-normal" onClick={onBack}>
          <ArrowLeft className="size-3" aria-hidden />
          {backLabel}
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-10 gap-y-8">
        <div className="min-w-[280px] max-w-[420px] flex-1 basis-[300px]">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 flex-none items-center justify-center rounded-xl border border-border bg-ink-900">
              <Icon className="size-5 text-ink-200" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-100">
                {entry.name}
              </h2>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-500">
                {shopCategory(entry.category).label} · by{" "}
                <button
                  className="underline-offset-2 transition-[color] duration-[130ms] ease-brand hover:text-ink-200 hover:underline"
                  onClick={onAuthor}
                  aria-label={`View widgets by ${entry.creator.name}`}
                >
                  {entry.creator.name}
                </button>
              </span>
            </div>
          </div>

          <p className="mt-4 text-[13.5px] leading-[1.65] text-ink-300">{entry.description}</p>

          <dl className="mt-5 flex flex-col">
            {entry.facts.map((fact) => (
              <div
                key={fact.label}
                className="flex items-baseline justify-between gap-6 border-t border-border py-2.5"
              >
                <dt>
                  <Label className="text-[10px]">{fact.label}</Label>
                </dt>
                <dd className="text-right text-[12.5px] text-ink-300">{fact.value}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-6 border-t border-border py-2.5">
              <dt>
                <Label className="text-[10px]">Stacking</Label>
              </dt>
              <dd className="text-right text-[12.5px] text-ink-300">
                {entry.repeatable ? "Add as many as you like" : `One per ${noun}`}
              </dd>
            </div>
          </dl>

          <div className="mt-5 flex items-center gap-3">
            <Button
              variant="primary"
              disabled={maxed}
              title={maxed ? `Already on your ${noun}` : undefined}
              onClick={onAdd}
            >
              {justAdded ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
              {justAdded ? "Added" : maxed ? `On your ${noun}` : `Add to ${noun}`}
            </Button>
            {count > 0 && <Tag>{count > 1 ? `On your ${noun} ×${count}` : `On your ${noun}`}</Tag>}
          </div>
        </div>

        <figure className="min-w-[300px] flex-[1.3] basis-[360px]">
          <PreviewFit height={previewHeight} className="rounded-xl border border-border">
            {preview}
          </PreviewFit>
          <figcaption className="mt-2.5 font-mono text-[10.5px] leading-[1.6] text-ink-500">
            {previewCaption}
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

/* --------------------------------- author ---------------------------------- */

/**
 * An author's page: monogram, profile, credit line, and every widget they
 * ship on this shelf (the caller passes the card grid as children so all
 * card wiring stays in one place).
 */
function AuthorPage({
  author,
  noun,
  widgetCount,
  installedCount,
  elsewhere,
  backLabel,
  onBack,
  onOpenUrl,
  children,
}: {
  author: WidgetAuthor;
  noun: string;
  widgetCount: number;
  installedCount: number;
  /** The author's footprint on the other surface, or null. */
  elsewhere: string | null;
  backLabel: string;
  onBack: () => void;
  onOpenUrl?: (url: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex animate-rise flex-col gap-6 p-6">
      <div>
        <Button variant="link" size="none" className="gap-1.5 text-[12.5px] font-normal" onClick={onBack}>
          <ArrowLeft className="size-3" aria-hidden />
          {backLabel}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div
          className="flex size-14 flex-none items-center justify-center rounded-2xl border border-border bg-ink-900 font-mono text-[17px] font-medium tracking-[0.08em] text-ink-200"
          aria-hidden
        >
          {authorInitials(author.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-100">
            {author.name}
          </h2>
          <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-500">
            {widgetCount} {widgetCount === 1 ? "widget" : "widgets"} · {installedCount} on your{" "}
            {noun}
            {elsewhere && ` · ${elsewhere}`}
          </p>
        </div>
        {author.url && onOpenUrl && (
          <Button size="sm" className="flex-none" onClick={() => onOpenUrl(author.url!)}>
            <ExternalLink className="size-3" aria-hidden />
            Visit site
          </Button>
        )}
      </div>

      {(author.tagline || author.bio) && (
        <div className="max-w-[70ch]">
          {author.tagline && (
            <p className="text-[13.5px] font-medium text-ink-200">{author.tagline}</p>
          )}
          {author.bio && (
            <p
              className={cn(
                "text-[13.5px] leading-[1.65] text-ink-400",
                author.tagline && "mt-1.5",
              )}
            >
              {author.bio}
            </p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3.5 border-t border-border pt-5">
        <Label>Widgets by {author.name}</Label>
        {children}
      </section>
    </div>
  );
}

/* ----------------------- the home board's shopfront ----------------------- */

/** Bento cell metrics; mirrors the home board's grid so previews are honest. */
const TILE_COL_PX = 300;
const TILE_ROW_PX = 200;
const TILE_GAP_PX = 16;

export function DashboardShop({
  open,
  onClose,
  widgets,
  games,
  itchApiKey,
  onAdd,
  onOpenUrl,
}: {
  open: boolean;
  onClose: () => void;
  widgets: DashWidget[];
  games: Game[];
  itchApiKey: string;
  onAdd: (type: DashWidgetType) => void;
  /** Opens a URL in a browser tab; powers author-page site links. */
  onOpenUrl?: (url: string) => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<DashWidgetType, number>();
    for (const widget of widgets) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return map;
  }, [widgets]);

  return (
    <WidgetShop<DashWidgetType>
      open={open}
      onClose={onClose}
      surface="Home board"
      noun="board"
      entries={DASH_SHOP}
      icons={DASH_ICONS}
      counts={counts}
      total={widgets.length}
      onAdd={onAdd}
      onOpenUrl={onOpenUrl}
      authorElsewhere={(id) => {
        const n = BAR_SHOP.filter((e) => e.creator.id === id).length;
        return n > 0 ? `${n} more on the work bar` : null;
      }}
      previewHeights={{ card: 220, detail: 448 }}
      previewCaption="Live preview at the tile's starting size · resize freely on the board"
      renderPreview={(type, live) => {
        // Stable spec instances, so poll state survives re-renders.
        const widget = dashPreview(type);
        return (
          <div
            className="pointer-events-none select-none"
            style={{
              width: widget.span.c * TILE_COL_PX + (widget.span.c - 1) * TILE_GAP_PX,
              height: widget.span.r * TILE_ROW_PX + (widget.span.r - 1) * TILE_GAP_PX,
            }}
            aria-hidden
          >
            <DashWidgetBody
              widget={widget}
              games={games}
              itchApiKey={itchApiKey}
              active={live}
              onOpen={noop}
              onUnreal={noop}
              onEditSetup={noop}
            />
          </div>
        );
      }}
    />
  );
}

/* ------------------------ the work bar's shopfront ------------------------ */

export function WorkbarShop({
  open,
  onClose,
  widgets,
  games,
  itchApiKey,
  onAdd,
  onOpenUrl,
}: {
  open: boolean;
  onClose: () => void;
  widgets: Widget[];
  games: Game[];
  itchApiKey: string;
  onAdd: (type: WidgetType) => void;
  /** Opens a URL in a browser tab; powers author-page site links. */
  onOpenUrl?: (url: string) => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<WidgetType, number>();
    for (const widget of widgets) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return map;
  }, [widgets]);

  return (
    <WidgetShop<WidgetType>
      open={open}
      onClose={onClose}
      surface="Work bar"
      noun="bar"
      entries={BAR_SHOP}
      icons={BAR_ICONS}
      counts={counts}
      total={widgets.length}
      onAdd={onAdd}
      onOpenUrl={onOpenUrl}
      authorElsewhere={(id) => {
        const n = DASH_SHOP.filter((e) => e.creator.id === id).length;
        return n > 0 ? `${n} more on the home board` : null;
      }}
      previewHeights={{ card: 220, detail: 360 }}
      previewCaption="Live preview at the exact width of your side rail"
      renderPreview={(type, live) => (
        <div className="pointer-events-none w-[220px] select-none" aria-hidden>
          {/* Stable spec instances, so poll state survives re-renders. */}
          <BarWidgetBody
            widget={barPreview(type)}
            games={games}
            itchApiKey={itchApiKey}
            active={live}
            onOpen={noop}
            onUnreal={noop}
          />
        </div>
      )}
    />
  );
}
