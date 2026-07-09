import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The one designed empty / no-match state: a dashed box with centered muted
 *  copy, optional icon and title, and room for a secondary line or action.
 *  Shared so every screen's "nothing here" reads the same (radius, border,
 *  padding, colour) instead of each one hand-rolling its own box. */
export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink-700 px-6 py-14 text-center text-ink-400",
        className,
      )}
    >
      {icon}
      {title && <p className="text-sm text-ink-300">{title}</p>}
      {children}
    </div>
  );
}
