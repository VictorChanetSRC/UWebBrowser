import { PanelBottom, PanelRight, X } from "lucide-react";
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Z_CONTENT } from "@/components/ui/overlay";
import { clamp, cn } from "@/lib/utils";

/** Thickness (px) of the control strip. Mirrors `DEVTOOLS_STRIP` in tabs.rs —
 *  the backend reserves exactly this band (the native inspector sits past it),
 *  so the two must stay in step. */
export const DEVTOOLS_STRIP = 30;

const MIN_FRAC = 0.15;
const MAX_FRAC = 0.85;
/** One arrow-key press. Coarse enough to cross the range in a few taps. */
const KEY_STEP = 0.05;

const clampFrac = (f: number) => clamp(f, MIN_FRAC, MAX_FRAC);

type Dock = "bottom" | "right";

/**
 * The chrome-drawn control strip for the docked DevTools panel: the resize
 * handle plus the dock-toggle and close buttons. The panel body itself is a
 * *native* webview positioned by the backend; this only paints the thin band
 * the backend reserves for us (which no native webview covers, so it shows
 * through). The wrapper overlays the whole native content region so the drag
 * math can measure it, but only the strip is interactive.
 */
export function DevtoolsDock({
  dock,
  size,
  topOffset,
  onResizeStart,
  onResize,
  onResizeEnd,
  onToggleDock,
  onClose,
}: {
  dock: Dock;
  /** Fraction (0.15–0.85) of the content region the panel occupies. */
  size: number;
  /** px offset from the content area's top (reserves the find-bar strip). */
  topOffset: number;
  onResizeStart: () => void;
  onResize: (fraction: number) => void;
  onResizeEnd: (fraction: number) => void;
  onToggleDock: () => void;
  onClose: () => void;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Fraction of the region taken up by the panel, from the pointer position.
  const fractionAt = (e: ReactPointerEvent) => {
    const r = regionRef.current?.getBoundingClientRect();
    if (!r) return size;
    return clampFrac(
      dock === "bottom" ? (r.bottom - e.clientY) / r.height : (r.right - e.clientX) / r.width,
    );
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    onResizeStart();
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onResize(fractionAt(e));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onResizeEnd(fractionAt(e));
  };

  // Sizing the panel was pointer-only; a splitter that reports `role="separator"`
  // should also answer the arrow keys. Home/End jump to the extremes.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const grow = dock === "bottom" ? "ArrowUp" : "ArrowLeft";
    const shrink = dock === "bottom" ? "ArrowDown" : "ArrowRight";
    let next: number | null = null;
    if (e.key === grow) next = size + KEY_STEP;
    else if (e.key === shrink) next = size - KEY_STEP;
    else if (e.key === "Home") next = MIN_FRAC;
    else if (e.key === "End") next = MAX_FRAC;
    if (next === null) return;
    e.preventDefault();
    // Commit straight away: there's no drag in flight to end.
    onResizeEnd(clampFrac(next));
  };

  const bottom = dock === "bottom";
  const stripStyle = bottom
    ? { top: `${(1 - size) * 100}%`, left: 0, right: 0, height: DEVTOOLS_STRIP }
    : { left: `${(1 - size) * 100}%`, top: 0, bottom: 0, width: DEVTOOLS_STRIP };

  // Keep a button press from starting a drag.
  const swallow = (e: ReactPointerEvent) => e.stopPropagation();

  const btn =
    "grid size-[22px] place-items-center rounded-md text-ink-400 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100";

  return (
    <div
      ref={regionRef}
      className={cn("pointer-events-none absolute inset-x-0 bottom-0", Z_CONTENT)}
      style={{ top: topOffset }}
      aria-hidden={false}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={bottom ? "horizontal" : "vertical"}
        aria-label="Resize developer tools"
        aria-valuenow={Math.round(size * 100)}
        aria-valuemin={Math.round(MIN_FRAC * 100)}
        aria-valuemax={Math.round(MAX_FRAC * 100)}
        title="Drag, or focus and use the arrow keys, to resize"
        className={`pointer-events-auto absolute flex touch-none select-none bg-ink-900 ${
          bottom
            ? "cursor-row-resize flex-row items-center gap-2 border-t border-ink-700 px-2"
            : "cursor-col-resize flex-col items-center gap-1.5 border-l border-ink-700 py-2"
        }`}
        style={stripStyle}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
      >
        {/* Drag affordance. */}
        <div
          className={`rounded-full bg-ink-600 ${bottom ? "h-[3px] w-9" : "h-9 w-[3px]"}`}
          aria-hidden
        />
        <div className={`flex ${bottom ? "ml-auto flex-row" : "mt-auto flex-col"} items-center gap-1`}>
          <button
            type="button"
            className={btn}
            title={bottom ? "Dock to right" : "Dock to bottom"}
            aria-label={bottom ? "Dock to right" : "Dock to bottom"}
            onPointerDown={swallow}
            onClick={onToggleDock}
          >
            {bottom ? <PanelRight size={14} /> : <PanelBottom size={14} />}
          </button>
          <button
            type="button"
            className={btn}
            title="Close developer tools"
            aria-label="Close developer tools"
            onPointerDown={swallow}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
