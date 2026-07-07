import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Plus, Puzzle, Square, X } from "lucide-react";
import type { Tab } from "../App";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { faviconUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

/**
 * The UWebBrowser mark: a globe with a live marker. Geometry transcribed
 * from the brand guidelines PDF; never redraw it by hand. Ink parts follow
 * currentColor so the mark sits on any Ink surface; the Signal node never
 * recolors.
 */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.9" />
      <ellipse cx="12" cy="12" rx="4.05" ry="10" stroke="currentColor" strokeWidth="2.9" />
      <path d="M2 12h20" stroke="currentColor" strokeWidth="2.9" strokeLinecap="round" />
      <circle cx="19.7" cy="4.3" r="3.65" fill="#F24C3A" />
    </svg>
  );
}

type Props = {
  tabs: Tab[];
  activeId: string;
  onSelect: (tab: Tab) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onReorder: (from: number, to: number) => void;
  onToggleExtensions: () => void;
  extensionsActive: boolean;
};

const windowControl =
  "flex h-full w-[46px] items-center justify-center text-ink-400 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100";

const TAB_GAP = 5;
const TAB_MAX_WIDTH = 216;
const TAB_MIN_WIDTH = 64;
// Below this width a tab is too cramped for a close button (unless active).
const TAB_CLOSE_MIN = 92;
const NEW_TAB_SPACE = 28 + TAB_GAP;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function TitleBarImpl({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
  onToggleExtensions,
  extensionsActive,
}: Props) {
  const appWindow = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  const stripRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);
  // Chrome trick: after closing a tab with the mouse, widths hold still so
  // the next close button lands under the cursor; they relax on mouse-out.
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);

  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const dragRef = useRef<{ id: string; index: number; startX: number; moved: boolean } | null>(
    null,
  );
  const tabEls = useRef(new Map<string, HTMLDivElement>());
  const lastLeft = useRef(new Map<string, number>());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    appWindow.isMaximized().then((m) => !cancelled && setMaximized(m));
    appWindow
      .onResized(async () => {
        const m = await appWindow.isMaximized();
        if (!cancelled) setMaximized(m);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setStripWidth(
        el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const computedWidth = stripWidth
    ? clamp(
        Math.floor((stripWidth - NEW_TAB_SPACE - (tabs.length - 1) * TAB_GAP) / tabs.length),
        TAB_MIN_WIDTH,
        TAB_MAX_WIDTH,
      )
    : TAB_MAX_WIDTH;
  const tabWidth = frozenWidth === null ? computedWidth : Math.min(frozenWidth, computedWidth);
  const step = tabWidth + TAB_GAP;

  // FLIP: when a tab's slot moves (reorder, close, open), slide it from its
  // old position instead of teleporting. The dragged tab is exempt — its
  // position is driven directly by the pointer. Depends on [tabs, tabWidth] so
  // it only reads layout when slots can actually move, not on every parent
  // re-render (poll ticks, toasts). Honors reduced-motion.
  useLayoutEffect(() => {
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [id, el] of tabEls.current) {
      const left = el.offsetLeft;
      const prev = lastLeft.current.get(id);
      if (animate && prev !== undefined && prev !== left && id !== dragRef.current?.id) {
        el.animate(
          [{ transform: `translateX(${prev - left}px)` }, { transform: "translateX(0)" }],
          { duration: 140, easing: "cubic-bezier(0.2, 0, 0, 1)" },
        );
      }
      lastLeft.current.set(id, left);
    }
  }, [tabs, tabWidth]);

  const beginDrag = (e: React.PointerEvent<HTMLDivElement>, tab: Tab, index: number) => {
    if (e.button !== 0) return;
    onSelect(tab);
    dragRef.current = { id: tab.id, index, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < 4) return;
      d.moved = true;
    }
    // Crossing a neighbor's midpoint swaps places; startX shifts by the same
    // slot delta so the tab keeps tracking the pointer seamlessly.
    while (dx > step / 2 && d.index < tabs.length - 1) {
      onReorder(d.index, d.index + 1);
      d.index += 1;
      d.startX += step;
      dx -= step;
    }
    while (dx < -step / 2 && d.index > 0) {
      onReorder(d.index, d.index - 1);
      d.index -= 1;
      d.startX -= step;
      dx += step;
    }
    dx = clamp(dx, -d.index * step, (tabs.length - 1 - d.index) * step);
    setDrag({ id: d.id, dx });
  };

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <header className="flex min-w-0 items-center bg-background" data-tauri-drag-region>
      <div
        className="flex w-[46px] flex-none items-center justify-center text-ink-200"
        data-tauri-drag-region
      >
        <Mark />
      </div>

      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open tabs"
        className="flex h-full min-w-0 flex-1 items-center gap-[5px] overflow-hidden py-1.5 pr-2"
        data-tauri-drag-region
        onPointerLeave={() => setFrozenWidth(null)}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const dragging = drag?.id === tab.id;
          const showClose = active || tabWidth >= TAB_CLOSE_MIN;
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabEls.current.set(tab.id, el);
                else {
                  tabEls.current.delete(tab.id);
                  lastLeft.current.delete(tab.id);
                }
              }}
              data-active={active}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              style={{
                width: tabWidth,
                transform: dragging ? `translateX(${drag.dx}px)` : undefined,
              }}
              className={cn(
                "tab group relative flex h-8 min-w-0 flex-none animate-tab-in cursor-default items-center gap-2 rounded-lg pl-2.5 pr-1.5 transition-[width,background-color,color] duration-[130ms] ease-brand",
                active ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:bg-ink-900 hover:text-ink-200",
                dragging && "z-10 shadow-lg shadow-black/40 transition-[background-color,color]",
              )}
              onPointerDown={(e) => beginDrag(e, tab, index)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tab);
                } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const dir = e.key === "ArrowRight" ? 1 : -1;
                  const next = tabs[(index + dir + tabs.length) % tabs.length];
                  if (next) {
                    onSelect(next);
                    tabEls.current.get(next.id)?.focus();
                  }
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.id);
              }}
              title={tab.title}
            >
              {tab.loading ? (
                <Spinner />
              ) : tab.kind === "home" ? (
                <span className="size-1.5 flex-none rounded-full bg-ink-500" aria-hidden />
              ) : (
                <TabFavicon url={tab.url} realSrc={tab.favicon} />
              )}
              <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[12.5px] [mask-image:linear-gradient(to_right,black_calc(100%-12px),transparent)]">
                {tab.title || "New tab"}
              </span>
              {showClose && (
                <button
                  className="flex size-[18px] flex-none items-center justify-center rounded-[5px] text-ink-500 opacity-0 transition-[background-color,color,opacity] duration-[130ms] ease-brand hover:bg-ink-700 hover:text-ink-100 focus-visible:opacity-100 group-hover:opacity-100 group-data-[active=true]:opacity-100"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFrozenWidth(tabWidth);
                    onClose(tab.id);
                  }}
                  aria-label="Close tab"
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg"
          onClick={() => {
            setFrozenWidth(null);
            onNewTab();
          }}
          aria-label="New tab · Ctrl+T"
          title="New tab · Ctrl+T"
        >
          <Plus className="size-3" aria-hidden />
        </Button>
      </div>

      <div className="flex flex-none items-center px-1.5" data-tauri-drag-region>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 rounded-lg [&_svg]:size-4",
            extensionsActive && "bg-ink-800 text-ink-100",
          )}
          onClick={onToggleExtensions}
          aria-label="Extensions"
          aria-pressed={extensionsActive}
          title="Extensions"
        >
          <Puzzle aria-hidden />
        </Button>
      </div>

      <div className="flex h-full flex-none">
        <button className={windowControl} onClick={() => appWindow.minimize()} aria-label="Minimize">
          <Minus className="size-3" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          className={windowControl}
          onClick={() => appWindow.toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <Copy className="size-3" strokeWidth={1.5} aria-hidden />
          ) : (
            <Square className="size-3" strokeWidth={1.5} aria-hidden />
          )}
        </button>
        <button
          className={cn(windowControl, "hover:bg-signal-600 hover:text-paper")}
          onClick={() => appWindow.close()}
          aria-label="Close"
        >
          <X className="size-3" strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </header>
  );
}

/** Re-renders only when its props change — App re-renders on every poll tick
 *  and toast, but the tab strip only cares about tabs/activeId. */
export const TitleBar = memo(TitleBarImpl);

/** A tab's favicon, falling back to the neutral Ink dot when the favicon is
 *  blocked/offline or the URL has no host — no broken-image glyph. Prefers the
 *  page's real favicon (`realSrc`, captured natively) over the lookup service. */
function TabFavicon({ url, realSrc }: { url: string; realSrc?: string }) {
  const service = faviconUrl(url);
  const [realFailed, setRealFailed] = useState(false);
  const [serviceFailed, setServiceFailed] = useState(false);
  // Reset when the URL/favicon changes so a reused slot isn't stuck after a 404.
  useEffect(() => {
    setRealFailed(false);
    setServiceFailed(false);
  }, [realSrc, url]);
  const usingReal = !!realSrc && !realFailed;
  const src = usingReal ? realSrc! : serviceFailed ? "" : service;
  if (!src) {
    return <span className="size-1.5 flex-none rounded-full bg-ink-500" aria-hidden />;
  }
  return (
    <img
      className="size-3.5 flex-none rounded-[3px]"
      src={src}
      alt=""
      onError={() => (usingReal ? setRealFailed(true) : setServiceFailed(true))}
    />
  );
}
