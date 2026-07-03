import type { ReactNode } from "react";
import { Label } from "./label";

/** A page section: a top hairline, a Label kicker, then content. Shared by the
 *  dashboard, settings, discover and the Unreal hub so screens read as one. */
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
    <section className={`flex flex-col gap-3.5 border-t border-border pt-[30px] ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </section>
  );
}
