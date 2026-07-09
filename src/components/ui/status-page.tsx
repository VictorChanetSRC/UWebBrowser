import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A full-bleed status screen that fills the content area: an optional icon, a
 *  title, a muted body, and an action row. Shared by the crashed-tab panel, the
 *  TLS interstitial and the network-error page so the three can't drift on
 *  spacing, width or elevation. */
export function StatusPage({
  icon,
  title,
  children,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center",
        className,
      )}
    >
      {icon}
      <div className="text-[15px] font-medium text-ink-100">{title}</div>
      {children && (
        <div className="max-w-md text-[13px] leading-relaxed text-ink-400">{children}</div>
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
