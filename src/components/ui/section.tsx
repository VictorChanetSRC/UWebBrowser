import type { ReactNode } from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

/** The section separator — a top hairline and the standard lead spacing. Shared
 *  so a section that needs its own layout (Settings' two-column rows, the
 *  dashboard's customize bar) can borrow the exact divider without hand-copying
 *  the literal. */
export const SECTION_HAIRLINE = "border-t border-border pt-[30px]";

/** A page section: a top hairline, a Label kicker, then content. Shared by the
 *  dashboard, settings, discover and the Unreal hub so screens read as one.
 *  Routes className through cn() so callers can override the layout utilities. */
export function Section({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3.5", SECTION_HAIRLINE, className)}>
      <Label>{label}</Label>
      {children}
    </section>
  );
}
