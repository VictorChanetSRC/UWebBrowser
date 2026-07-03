import { cn } from "@/lib/utils";

/** Thin determinate bar, Ink on Ink. `value` is 0..1. */
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-ink-800", className)}>
      <div
        className="h-full rounded-full bg-ink-300 transition-[width] duration-500 ease-brand"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}
