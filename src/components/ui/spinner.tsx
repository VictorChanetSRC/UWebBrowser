import { cn } from "../../lib/utils";

/** The one ring spinner — a size-3 Ink ring with a lighter head. Used for tab
 *  loading, platform checks, and any inline "working" state. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-3 flex-none animate-spin rounded-full border-[1.5px] border-ink-700 border-t-ink-300 [animation-duration:700ms]",
        className,
      )}
      aria-hidden
    />
  );
}
