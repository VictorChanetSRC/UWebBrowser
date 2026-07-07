import { useEffect } from "react";
import { Check, FolderOpen, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { IconButton } from "./ui/icon-button";
import { Spinner } from "./ui/spinner";

export type DownloadItem = {
  path: string;
  name: string;
  state: "start" | "done" | "fail";
};

/** Parent folder of a Windows/Unix path, for "show in folder". */
function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/**
 * A small downloads shelf stacked bottom-right — WebView2's own download flyout
 * is suppressed (see webext.rs), so this is the only download UI. Shows live
 * progress state and a "show in folder" action; completed rows auto-dismiss.
 */
export function DownloadShelf({
  items,
  onDismiss,
}: {
  items: DownloadItem[];
  onDismiss: (path: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-50 flex flex-col gap-2">
      {items.map((d) => (
        <DownloadRow key={d.path} item={d} onDismiss={() => onDismiss(d.path)} />
      ))}
    </div>
  );
}

function DownloadRow({ item, onDismiss }: { item: DownloadItem; onDismiss: () => void }) {
  // Auto-dismiss finished rows so the shelf doesn't accumulate.
  useEffect(() => {
    if (item.state === "start") return;
    const t = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.state]);

  return (
    <div className="pointer-events-auto flex w-72 items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)] animate-rise">
      <span className="flex size-5 flex-none items-center justify-center text-ink-400">
        {item.state === "start" ? (
          <Spinner />
        ) : item.state === "done" ? (
          <Check className="size-4 text-ink-100" aria-hidden />
        ) : (
          <X className="size-4 text-signal-500" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-ink-100">
          {item.name}
        </div>
        <div className="text-[11px] text-ink-400">
          {item.state === "start"
            ? "Downloading…"
            : item.state === "done"
              ? "Downloaded"
              : "Failed"}
        </div>
      </div>
      {item.state === "done" && (
        <IconButton
          label="Show in folder"
          onClick={() => ipc.revealInExplorer(parentDir(item.path)).catch(() => {})}
        >
          <FolderOpen className="size-4" aria-hidden />
        </IconButton>
      )}
      <IconButton label="Dismiss" onClick={onDismiss}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
