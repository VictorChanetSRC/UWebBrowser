import { cn } from "../../lib/utils";

/**
 * The single Signal pulse that marks a live moment — players online, a build in
 * flight, a sync running. Brand rule: at most one on screen at a time, so this
 * is the only place the pulse dot is spelled.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-2 flex-none animate-live-pulse rounded-full bg-signal-500",
        className,
      )}
      aria-hidden
    />
  );
}
