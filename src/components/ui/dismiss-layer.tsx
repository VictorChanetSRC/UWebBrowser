import { Z_STRIP } from "./overlay";
import { cn } from "@/lib/utils";

/**
 * The transparent click-catcher under a floating surface: one click anywhere
 * outside closes it, and that click is swallowed rather than landing on
 * whatever it hit. Used by the dropdowns that float over the page (downloads,
 * page-info, the extension menu) — they sit above the native tab webview, so
 * they need a real element to catch the click.
 *
 * An inline control inside scrollable content wants `useDismissable` instead: a
 * full-screen layer would also swallow the page's scroll.
 */
export function DismissLayer({
  onDismiss,
  className,
}: {
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("fixed inset-0", Z_STRIP, className)}
      onClick={onDismiss}
      onContextMenu={(e) => {
        e.preventDefault();
        onDismiss();
      }}
    />
  );
}
