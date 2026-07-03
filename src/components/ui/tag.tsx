import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** A small pill: mono, hairline border, quiet by default. `tone="signal"` is
 *  the rare accent variant (a failed state) — use it at most once per view. */
export function Tag({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "signal";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex-none rounded-full border px-2 py-0.5 font-mono text-[10.5px]",
        tone === "signal"
          ? "border-signal-500/30 bg-signal-500/10 text-signal-400"
          : "border-border text-ink-500",
        className,
      )}
    >
      {children}
    </span>
  );
}
