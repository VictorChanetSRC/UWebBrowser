import { useCallback } from "react";
import { Plus, Puzzle } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc, type ExtInfo } from "@/lib/ipc";
import { cn } from "@/lib/utils";

const POPUP_WIDTH = 400;
const POPUP_MAX_HEIGHT = 620;

type Props = {
  extensions: ExtInfo[];
  /** id of the extension whose popup is currently floating, or null. */
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  onExtensionsChange: (next: ExtInfo[]) => void;
  onToast: (message: string) => void;
};

/**
 * The pinned extensions strip. Each entry is a real installed extension; the
 * engine draws no toolbar of its own, so this is the only way to reach an
 * extension's popup (how you sign in to Proton Pass and drive it).
 */
export function ExtensionBar({
  extensions,
  openId,
  onOpenChange,
  onExtensionsChange,
  onToast,
}: Props) {
  const toggle = useCallback(
    (ext: ExtInfo, anchor: HTMLElement) => {
      // Clicking the open extension again dismisses it.
      if (openId === ext.id) {
        ipc.extClosePopup().catch(() => {});
        onOpenChange(null);
        return;
      }
      if (!ext.popup) {
        onToast(`${ext.name} has no popup window`);
        return;
      }
      // Anchor the popup under the button. The chrome webview fills the window
      // at (0,0), so client coords are already window-logical coords.
      const r = anchor.getBoundingClientRect();
      const width = POPUP_WIDTH;
      const x = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const y = r.bottom + 4;
      const height = Math.min(POPUP_MAX_HEIGHT, window.innerHeight - y - 12);
      ipc
        .extOpenPopup(ext.id, ext.popup, x, y, width, height)
        .then(() => onOpenChange(ext.id))
        .catch((e) => onToast(String(e)));
    },
    [openId, onOpenChange, onToast],
  );

  const loadUnpacked = useCallback(async () => {
    const picked = await open({
      directory: true,
      title: "Select an unpacked extension folder",
    }).catch(() => null);
    if (typeof picked !== "string") return;
    try {
      const next = await ipc.extImport(picked);
      onExtensionsChange(next);
      onToast("Extension loaded");
    } catch (e) {
      onToast(String(e));
    }
  }, [onExtensionsChange, onToast]);

  return (
    <div className="flex h-full min-w-0 items-center gap-1 border-b border-border bg-background px-3">
      <Puzzle className="size-3.5 flex-none text-ink-600" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {extensions.length === 0 ? (
          <span className="px-1 text-[12px] text-ink-500">No extensions loaded</span>
        ) : (
          extensions.map((ext) => (
            <button
              key={ext.id}
              type="button"
              aria-label={ext.name}
              aria-pressed={openId === ext.id}
              title={ext.name}
              onClick={(e) => toggle(ext, e.currentTarget)}
              className={cn(
                "flex size-7 flex-none items-center justify-center rounded-md text-ink-400 transition-[background-color,color] duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100",
                openId === ext.id && "bg-ink-800 text-ink-100 ring-1 ring-ink-600",
              )}
            >
              {ext.icon ? (
                <img src={ext.icon} alt="" className="size-4 rounded-[3px]" />
              ) : (
                <Puzzle className="size-4" aria-hidden />
              )}
            </button>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={loadUnpacked}
        aria-label="Load unpacked extension"
        title="Load unpacked extension"
        className="flex flex-none items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-400 transition-colors duration-[130ms] ease-brand hover:bg-ink-800 hover:text-ink-100"
      >
        <Plus className="size-3.5" aria-hidden />
        Load unpacked
      </button>
    </div>
  );
}
