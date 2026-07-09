import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Store, X } from "lucide-react";
import type { Game, UwbConfig } from "../lib/config";
import {
  addDashWidget,
  cycleSpan,
  loadDashboard,
  MAX_SPAN,
  moveDashWidget,
  moveDashWidgetTo,
  reconcileDashboard,
  removeDashWidget,
  saveDashboard,
  seedDashboard,
  spanLabel,
  updateDashWidget,
  type DashWidget,
} from "../lib/dashboard";
import { Setup } from "./Setup";
import { SearchField } from "./SearchField";
import {
  DASH_ICONS,
  dashWidgetTitle,
  DashWidgetBody,
  DashWidgetConfig,
} from "@/widgets/dashboard";
import { DashboardShop } from "./WidgetShop";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/hooks/use-confirm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Section, SECTION_HAIRLINE } from "@/components/ui/section";

// UnrealHub builds its sections and stat tiles from these.
export { Stat, StatGrid } from "@/widgets/dashboard";

export function DashSection({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <Section label={label}>{children}</Section>;
}

type Props = {
  config: UwbConfig;
  onSave: (config: UwbConfig) => void;
  onOpen: (url: string) => void;
  onSearch: (input: string) => void;
  onUnreal: () => void;
  focusKey: string;
};

/** Lean, time-aware, and done with it. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late.";
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

/**
 * Grid geometry, shared between the class maps below and the resize math.
 * Keep in sync with the grid's `auto-rows-[…]` and `gap-…` classes.
 */
const ROW_PX = 200;
const GAP_PX = 16;

/**
 * The bento footprint classes per span axis. Column spans collapse when the
 * board is too narrow to hold them so a wide tile can't blow out a small
 * window; row spans are always safe. Static strings, so Tailwind sees them.
 */
const COL_CLASSES: Record<number, string> = {
  1: "",
  2: "@min-[648px]:col-span-2",
  3: "@min-[648px]:col-span-2 @min-[980px]:col-span-3",
};
const ROW_CLASSES: Record<number, string> = {
  1: "",
  2: "row-span-2",
  3: "row-span-3",
};

/** Reorders faster than this read as flicker, not feedback. */
const SWAP_COOLDOWN_MS = 120;

export function Dashboard({ config, onSave, onOpen, onSearch, onUnreal, focusKey }: Props) {
  const [editing, setEditing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashWidget[]>(() => loadDashboard(config.games));
  // Persist debounced: a drag or edge-resize mutates `widgets` many times per
  // gesture, and each save stringifies the whole layout. Coalesce to a trailing
  // write, and flush on unmount so switching tabs mid-gesture never loses it.
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  useEffect(() => {
    const t = window.setTimeout(() => saveDashboard(widgetsRef.current), 400);
    return () => window.clearTimeout(t);
  }, [widgets]);
  useEffect(() => () => saveDashboard(widgetsRef.current), []);

  const resetLayout = useConfirm(() => setWidgets(seedDashboard(config.games)));

  const setup = !config.done || editing;

  // Computed once per mount (not every render, which is frequent during drag).
  // The dashboard remounts on navigation, so this still rolls past midnight.
  const greetingText = useMemo(() => greeting(), []);
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [],
  );

  /* ------------------------------ drag state ------------------------------ */

  const [dragId, setDragId] = useState<string | null>(null);
  const lastSwapAt = useRef(0);
  const tileEls = useRef(new Map<string, HTMLDivElement>());
  const lastSpots = useRef(new Map<string, { left: number; top: number }>());

  // FLIP: when a tile's slot moves (drag reorder, resize, add/remove), slide
  // it from its old spot instead of teleporting. Offsets are layout-relative,
  // so scrolling between changes doesn't fake a move. Honors reduced-motion.
  useLayoutEffect(() => {
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spots = new Map<string, { left: number; top: number }>();
    for (const [id, el] of tileEls.current) {
      spots.set(id, { left: el.offsetLeft, top: el.offsetTop });
    }
    if (animate) {
      for (const [id, el] of tileEls.current) {
        const prev = lastSpots.current.get(id);
        const next = spots.get(id);
        if (!prev || !next) continue;
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (dx || dy) {
          el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
            { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          );
        }
      }
    }
    lastSpots.current = spots;
  }, [widgets]);

  /** Live reorder: dragging over a sibling takes its slot immediately. */
  const dragEnterTile = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const now = performance.now();
    if (now - lastSwapAt.current < SWAP_COOLDOWN_MS) return;
    setWidgets((prev) => {
      const to = prev.findIndex((w) => w.id === overId);
      const next = moveDashWidgetTo(prev, dragId, to);
      if (next !== prev) lastSwapAt.current = now;
      return next;
    });
  };

  const startDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    // Some engines won't start a drag with an empty data store.
    e.dataTransfer.setData("text/plain", id);
    // Ghost the whole tile, not just the transparent drag surface.
    const el = tileEls.current.get(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      e.dataTransfer.setDragImage(el, e.clientX - rect.left, e.clientY - rect.top);
    }
    // Defer the dimmed style one frame so the ghost is captured undimmed.
    requestAnimationFrame(() => setDragId(id));
  };

  return (
    <>
      <div className="absolute inset-0 @container overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex animate-rise flex-col gap-9 px-10 pb-20 pt-14",
            setup ? "max-w-[960px]" : "w-full",
          )}
        >
          <div className={cn("w-full", !setup && "max-w-[860px] self-center")}>
            <SearchField
              onSubmit={onSearch}
              inputKey={focusKey}
              autoFocus={config.done}
              placeholder="Search the web or paste a link"
            />
          </div>
          {setup ? (
            <Setup
              config={config}
              firstRun={!config.done}
              onOpen={onOpen}
              onSave={(next) => {
                onSave({ ...next, done: true });
                // New games earn a tile the moment they exist.
                setWidgets((prev) => reconcileDashboard(prev, next.games));
                setEditing(false);
              }}
              onCancel={config.done ? () => setEditing(false) : undefined}
            />
          ) : (
            <>
              <PageHeader
                kicker={`Home · ${todayLabel}`}
                title={greetingText}
                actions={
                  <div className="flex gap-2.5">
                    <Button
                      variant={customizing ? "primary" : "outline"}
                      onClick={() => setCustomizing((v) => !v)}
                    >
                      {customizing ? "Done" : "Customize"}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(true)}>
                      Edit setup
                    </Button>
                  </div>
                }
              />

              {customizing && (
                <section
                  className={cn(
                    "flex animate-rise flex-wrap items-center justify-between gap-x-6 gap-y-3",
                    SECTION_HAIRLINE,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <Button onClick={() => setShopOpen(true)}>
                      <Store className="size-3.5" aria-hidden />
                      Browse widgets
                    </Button>
                    <span className="text-[12px] text-ink-500">
                      Drag tiles to rearrange · drag their edges to resize
                    </span>
                  </div>
                  <Button
                    variant="link"
                    size="none"
                    className={cn(
                      "text-[12px] font-normal",
                      resetLayout.armed && "text-signal-300 hover:text-signal-200",
                    )}
                    onClick={resetLayout.trigger}
                    aria-live="polite"
                  >
                    {resetLayout.armed ? "Click again to reset" : "Reset layout"}
                  </Button>
                </section>
              )}

              {widgets.length === 0 ? (
                <EmptyState title="A blank home page. Build yours from the widget shop.">
                  <Button
                    onClick={() => {
                      setCustomizing(true);
                      setShopOpen(true);
                    }}
                  >
                    <Store className="size-3.5" aria-hidden />
                    Browse widgets
                  </Button>
                </EmptyState>
              ) : (
                <div
                  className="grid grid-flow-dense grid-cols-[repeat(auto-fill,minmax(300px,1fr))] auto-rows-[200px] gap-4"
                  onDragOver={customizing ? (e) => e.preventDefault() : undefined}
                  onDrop={customizing ? (e) => e.preventDefault() : undefined}
                >
                  {widgets.map((widget, index) => (
                    <BentoTile
                      key={widget.id}
                      widget={widget}
                      dragging={dragId === widget.id}
                      customizing={customizing}
                      games={config.games}
                      itchApiKey={config.itchApiKey}
                      tileRef={(el) => {
                        if (el) tileEls.current.set(widget.id, el);
                        else {
                          tileEls.current.delete(widget.id);
                          lastSpots.current.delete(widget.id);
                        }
                      }}
                      onOpen={onOpen}
                      onUnreal={onUnreal}
                      onEditSetup={() => setEditing(true)}
                      onDragStart={(e) => startDrag(e, widget.id)}
                      onDragEnd={() => setDragId(null)}
                      onDragEnterTile={() => dragEnterTile(widget.id)}
                      onNudge={(dir) => setWidgets((prev) => moveDashWidget(prev, widget.id, dir))}
                      onRemove={() => setWidgets((prev) => removeDashWidget(prev, widget.id))}
                      onPatch={(patch) =>
                        setWidgets((prev) => updateDashWidget(prev, widget.id, patch))
                      }
                      index={index}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DashboardShop
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        widgets={widgets}
        games={config.games}
        itchApiKey={config.itchApiKey}
        onAdd={(type) => setWidgets((prev) => addDashWidget(prev, type))}
        onOpenUrl={onOpen}
      />
    </>
  );
}

/* --------------------------------- tiles ---------------------------------- */

type ResizeAxis = "x" | "y" | "xy";

const RESIZE_CURSORS: Record<ResizeAxis, string> = {
  x: "ew-resize",
  y: "ns-resize",
  xy: "nwse-resize",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function BentoTile({
  widget,
  index,
  dragging,
  customizing,
  games,
  itchApiKey,
  tileRef,
  onOpen,
  onUnreal,
  onEditSetup,
  onDragStart,
  onDragEnd,
  onDragEnterTile,
  onNudge,
  onRemove,
  onPatch,
}: {
  widget: DashWidget;
  index: number;
  dragging: boolean;
  customizing: boolean;
  games: Game[];
  itchApiKey: string;
  tileRef: (el: HTMLDivElement | null) => void;
  onOpen: (url: string) => void;
  onUnreal: () => void;
  onEditSetup: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragEnterTile: () => void;
  onNudge: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPatch: (patch: Partial<DashWidget>) => void;
}) {
  const Icon = DASH_ICONS[widget.type];
  const title = dashWidgetTitle(widget, games);

  const wrapperEl = useRef<HTMLDivElement | null>(null);
  /** Frozen at pointer-down: one column's pitch and how many columns exist. */
  const resizeRef = useRef<{ axis: ResizeAxis; colUnit: number; maxC: number } | null>(null);

  // If the tile disappears mid-gesture, don't leave the cursor pinned.
  useEffect(() => {
    return () => {
      if (resizeRef.current) document.body.style.cursor = "";
    };
  }, []);

  const beginResize = (e: React.PointerEvent<HTMLDivElement>, axis: ResizeAxis) => {
    const el = wrapperEl.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const colWidth = (rect.width - (widget.span.c - 1) * GAP_PX) / widget.span.c;
    const gridWidth = el.parentElement?.clientWidth ?? rect.width;
    const maxC = clamp(Math.floor((gridWidth + GAP_PX) / (colWidth + GAP_PX)), 1, MAX_SPAN);
    resizeRef.current = { axis, colUnit: colWidth + GAP_PX, maxC };
    e.currentTarget.setPointerCapture(e.pointerId);
    // The pointer leaves the thin handle constantly while dragging; pin the
    // cursor for the whole gesture.
    document.body.style.cursor = RESIZE_CURSORS[axis];
  };

  const moveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    const el = wrapperEl.current;
    if (!resize || !el) return;
    // Live rect, not a frozen one: dense packing may relocate the tile as it
    // grows, and the thresholds must follow it.
    const rect = el.getBoundingClientRect();
    let { c, r } = widget.span;
    if (resize.axis !== "y") {
      c = clamp(Math.round((e.clientX - rect.left + GAP_PX / 2) / resize.colUnit), 1, resize.maxC);
    }
    if (resize.axis !== "x") {
      r = clamp(Math.round((e.clientY - rect.top + GAP_PX / 2) / (ROW_PX + GAP_PX)), 1, MAX_SPAN);
    }
    if (c !== widget.span.c || r !== widget.span.r) onPatch({ span: { c, r } });
  };

  const endResize = () => {
    resizeRef.current = null;
    document.body.style.cursor = "";
  };

  const handleShared =
    "absolute z-10 touch-none rounded-full transition-[background-color] duration-[130ms] ease-brand hover:bg-ink-500/60 active:bg-ink-400/70";

  return (
    <div
      ref={(el) => {
        wrapperEl.current = el;
        tileRef(el);
      }}
      className={cn(
        "relative min-w-0 transition-opacity duration-[130ms] ease-brand",
        COL_CLASSES[widget.span.c],
        ROW_CLASSES[widget.span.r],
        dragging && "opacity-40",
      )}
      onDragEnter={customizing ? onDragEnterTile : undefined}
      onDragOver={customizing ? (e) => e.preventDefault() : undefined}
    >
      {/* The live widget; inert while the board is being rearranged. */}
      <div className={cn("h-full", customizing && "pointer-events-none select-none")}>
        <DashWidgetBody
          widget={widget}
          games={games}
          itchApiKey={itchApiKey}
          active
          onOpen={onOpen}
          onUnreal={onUnreal}
          onEditSetup={onEditSetup}
        />
      </div>

      {customizing && (
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="absolute inset-0 cursor-grab rounded-[18px] ring-1 ring-inset ring-ink-600 active:cursor-grabbing"
        >
          <div
            role="group"
            aria-label={`${title} tile controls`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                onNudge(-1);
              } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                onNudge(1);
              }
            }}
            className="absolute inset-x-2 top-2 flex items-center gap-2 rounded-[10px] border border-border bg-ink-900/95 py-1 pl-2.5 pr-1 shadow-strip backdrop-blur"
          >
            <span className="w-5 flex-none font-mono text-[10.5px] tabular-nums text-ink-500">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Icon className="size-3.5 flex-none text-ink-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-200">
              {title}
            </span>
            <Button
              variant="ghost"
              size="none"
              className="h-6 flex-none rounded-md px-2 font-mono text-[10.5px] tabular-nums text-ink-400"
              onClick={() => onPatch({ span: cycleSpan(widget.span) })}
              title={`Resize · now ${spanLabel(widget.span)} · or drag the tile's edges`}
              aria-label={`Resize ${title}, currently ${spanLabel(widget.span)}`}
            >
              {spanLabel(widget.span)}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 flex-none rounded-md text-ink-500"
              onClick={onRemove}
              aria-label={`Remove ${title}`}
            >
              <X className="size-2.5" aria-hidden />
            </Button>
          </div>

          <DashWidgetConfig widget={widget} games={games} onPatch={onPatch} />
        </div>
      )}

      {/* Resize handles: siblings of the drag surface, so grabbing an edge
          never starts an HTML5 drag. Snaps to whole grid cells. */}
      {customizing && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            className={cn(handleShared, "-right-[7px] inset-y-4 w-[10px] cursor-ew-resize")}
            onPointerDown={(e) => beginResize(e, "x")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize"
            className={cn(handleShared, "-bottom-[7px] inset-x-4 h-[10px] cursor-ns-resize")}
            onPointerDown={(e) => beginResize(e, "y")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          <div
            title="Drag to resize"
            className="absolute -bottom-[7px] -right-[7px] z-10 flex size-[22px] cursor-nwse-resize touch-none items-end justify-end"
            onPointerDown={(e) => beginResize(e, "xy")}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          >
            {/* The visible grip: a corner bracket that says "pull here". */}
            <span
              aria-hidden
              className="mb-[7px] mr-[7px] block size-2.5 rounded-br-[7px] border-b-2 border-r-2 border-ink-500"
            />
          </div>
        </>
      )}
    </div>
  );
}
