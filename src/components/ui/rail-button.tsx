import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A left-rail nav row: a label with a trailing count, pressed when active.
 *  Shared by Discover's category rail and the widget shop's shelf rail so the
 *  same control can't drift on radius, padding or the count treatment. */
export function RailButton({
  label,
  count,
  active,
  onClick,
  className,
}: {
  label: ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-[background-color,color] duration-[130ms] ease-brand",
        active
          ? "bg-ink-800 font-medium text-ink-100"
          : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-200",
        className,
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={cn(
          "flex-none font-mono text-[10.5px] tabular-nums",
          count === 0 ? "text-ink-600" : "text-ink-500",
        )}
      >
        {count}
      </span>
    </button>
  );
}
