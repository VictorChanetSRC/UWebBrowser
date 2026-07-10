import { useEffect, useMemo, useState } from "react";
import { Ban, Download, FileDown, FolderOpen, Trash2, TriangleAlert, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import {
  activeProgress,
  applyDownloadEvent,
  countActive,
  loadDownloads,
  parseDownloadEvent,
  saveDownloads,
  type DownloadRec,
} from "../lib/downloads";
import { fmtBytes, fmtSpeed } from "../lib/format";
import { Button } from "./ui/button";
import { DismissLayer } from "./ui/dismiss-layer";
import { IconButton } from "./ui/icon-button";
import { POPOVER_SURFACE, Z_POPOVER } from "./ui/overlay";
import { Spinner } from "./ui/spinner";
import { useEscape } from "../hooks/use-escape";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { cn } from "../lib/utils";

/**
 * The downloads system: a top-bar button whose ring tracks live aggregate
 * progress (Chrome-style), plus a dropdown panel listing every download with
 * per-item progress, speed and actions. Self-contained — it owns its state and
 * subscribes to `download` tab-events directly, so progress ticks re-render
 * only this component, not the memoized toolbar around it.
 *
 * The one thing it can't do alone: the panel drops into the content area, which
 * the native tab webview paints over. `onPanelOpenChange` lets the app hide the
 * active page's webview while the panel is open (same trick the omnibox uses).
 */
export function Downloads({
  onPanelOpenChange,
  openSignal = 0,
}: {
  onPanelOpenChange: (open: boolean) => void;
  /** Bumped by the app to toggle the panel from the Ctrl+J shortcut. */
  openSignal?: number;
}) {
  const [items, setItems] = useState<DownloadRec[]>(loadDownloads);
  const [open, setOpen] = useState(false);
  const [pulse, firePulse] = useTimedFlag(1200);

  // Fold incoming download events into the list. A separate listener from the
  // app's — each `listen` is independent, so this stays fully local.
  useEffect(() => {
    const unlisten = ipc.onTabEvent(({ kind, value }) => {
      if (kind !== "download") return;
      const raw = parseDownloadEvent(value);
      if (!raw) return;
      // Draw the eye to the button without stealing the page (no auto-open).
      if (raw.state === "start") firePulse();
      setItems((prev) => applyDownloadEvent(prev, raw, performance.now()));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [firePulse]);

  // Persist history (debounced — progress churns fast).
  useEffect(() => {
    const t = window.setTimeout(() => saveDownloads(items), 400);
    return () => window.clearTimeout(t);
  }, [items]);

  useEffect(() => onPanelOpenChange(open), [open, onPanelOpenChange]);

  // Ctrl+J toggles the panel (the app bumps openSignal).
  useEffect(() => {
    if (openSignal > 0) setOpen((o) => !o);
  }, [openSignal]);

  useEscape((e) => {
    e.preventDefault();
    setOpen(false);
  }, open);

  const active = useMemo(() => countActive(items), [items]);
  const progress = useMemo(() => activeProgress(items), [items]);

  const remove = (id: string) => setItems((prev) => prev.filter((d) => d.id !== id));
  const clearFinished = () => setItems((prev) => prev.filter((d) => d.state === "active"));
  const mostRecent = items[0];

  // Nothing downloaded yet → no button at all (Chrome shows it after the first).
  if (items.length === 0) return null;

  return (
    <div className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          active > 0
            ? `Downloads — ${active} in progress`
            : "Downloads"
        }
        aria-expanded={open}
        title="Downloads"
        className={cn(
          "relative flex size-8 items-center justify-center rounded-full text-ink-300 transition-colors duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100",
          open && "bg-ink-800 text-ink-100",
          pulse && "animate-pulse",
        )}
      >
        {active > 0 && <Ring progress={progress} />}
        <Download className="size-4" aria-hidden />
        {active > 1 && (
          <span className="absolute -bottom-0.5 -right-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-signal-500 px-1 text-[9px] font-semibold leading-[13px] text-paper">
            {active}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away. The active page's webview is hidden while the panel is
              open (see onPanelOpenChange), so this backdrop is reachable. */}
          <DismissLayer onDismiss={() => setOpen(false)} />
          <div
            className={cn(
              "absolute right-0 top-[calc(100%+8px)] w-[360px] overflow-hidden",
              Z_POPOVER,
              POPOVER_SURFACE,
            )}
            role="dialog"
            aria-label="Downloads"
          >
            <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
              <span className="text-[12.5px] font-medium text-ink-100">Downloads</span>
              <span className="flex-1" />
              {items.some((d) => d.state !== "active") && (
                <Button
                  variant="ghost"
                  size="none"
                  onClick={clearFinished}
                  className="rounded px-1.5 py-0.5 text-[11px] font-normal"
                >
                  Clear finished
                </Button>
              )}
              <IconButton label="Close" className="size-6" onClick={() => setOpen(false)}>
                <X className="size-3.5" aria-hidden />
              </IconButton>
            </div>

            <div className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
              {items.map((d) => (
                <DownloadRow key={d.id} item={d} onRemove={() => remove(d.id)} />
              ))}
            </div>

            {mostRecent && (
              <div className="border-t border-border px-3.5 py-2">
                <Button
                  variant="ghost"
                  size="none"
                  onClick={() => ipc.downloadShow(mostRecent.path).catch(() => {})}
                  className="gap-1.5 rounded px-1.5 py-0.5 text-[11.5px] font-normal"
                >
                  <FolderOpen className="size-3.5" aria-hidden />
                  Open downloads folder
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The progress ring behind the button icon. Determinate while total is known,
 *  a spinning arc otherwise. */
function Ring({ progress }: { progress: number | null }) {
  const R = 15;
  const C = 2 * Math.PI * R;
  const indeterminate = progress === null;
  const frac = indeterminate ? 0.25 : progress;
  return (
    <svg
      viewBox="0 0 36 36"
      className={cn("absolute inset-0 size-full -rotate-90", indeterminate && "animate-spin")}
      aria-hidden
    >
      <circle cx="18" cy="18" r={R} fill="none" strokeWidth="2.5" className="stroke-ink-700" />
      <circle
        cx="18"
        cy="18"
        r={R}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-signal-500 transition-[stroke-dashoffset] duration-200 ease-linear"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - frac)}
      />
    </svg>
  );
}

function DownloadRow({ item, onRemove }: { item: DownloadRec; onRemove: () => void }) {
  const active = item.state === "active";
  const frac = item.total > 0 ? Math.min(1, item.received / item.total) : null;

  const status = active
    ? `${fmtBytes(item.received)}${item.total > 0 ? ` / ${fmtBytes(item.total)}` : ""}${
        item.speed > 0 ? ` · ${fmtSpeed(item.speed)}` : ""
      }`
    : item.state === "done"
      ? `${fmtBytes(item.total > 0 ? item.total : item.received)} · Done`
      : item.state === "cancel"
        ? "Canceled"
        : "Failed";

  const openFile = () => {
    if (item.state === "done") ipc.downloadOpen(item.path).catch(() => {});
  };

  return (
    <div className="group flex items-center gap-3 px-3.5 py-2 hover:bg-ink-800">
      <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-300">
        {active ? (
          <Spinner />
        ) : item.state === "done" ? (
          <FileDown className="size-4 text-ink-100" aria-hidden />
        ) : item.state === "cancel" ? (
          <Ban className="size-4 text-ink-400" aria-hidden />
        ) : (
          <TriangleAlert className="size-4 text-signal-500" aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={openFile}
          disabled={item.state !== "done"}
          title={item.state === "done" ? "Open file" : item.name}
          className={cn(
            "block w-full truncate text-left text-[12.5px] text-ink-100",
            item.state === "done" && "hover:text-paper hover:underline",
          )}
        >
          {item.name}
        </button>

        {active && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
            {frac === null ? (
              <span className="loadbar block h-full w-[36%] animate-loadslide rounded-full bg-signal-500" />
            ) : (
              <span
                className="block h-full rounded-full bg-signal-500 transition-[width] duration-200 ease-linear"
                style={{ width: `${Math.round(frac * 100)}%` }}
              />
            )}
          </div>
        )}

        <div className={cn("truncate text-[11px] text-ink-400", active && "mt-0.5")}>
          {status}
        </div>
      </div>

      <div className="flex flex-none items-center gap-0.5">
        {active ? (
          <IconButton
            label="Cancel download"
            className="size-7"
            onClick={() => ipc.downloadCancel(item.id).catch(() => {})}
          >
            <X className="size-3.5" aria-hidden />
          </IconButton>
        ) : (
          <>
            {item.state === "done" && (
              <IconButton
                label="Show in folder"
                className="size-7 opacity-0 group-hover:opacity-100"
                onClick={() => ipc.downloadShow(item.path).catch(() => {})}
              >
                <FolderOpen className="size-3.5" aria-hidden />
              </IconButton>
            )}
            <IconButton
              label="Remove from list"
              className="size-7 opacity-0 group-hover:opacity-100"
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
