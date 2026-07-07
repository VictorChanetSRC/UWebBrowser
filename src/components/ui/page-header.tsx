import type { ReactNode } from "react";
import { Label } from "./label";
import { cn } from "@/lib/utils";

/** The page hero every internal screen opens with: a mono kicker, the 40px
 *  title, and an optional lead paragraph. Pass `actions` to float controls to
 *  the right (the work bar's "Browse widgets" / "Reset"). One source so the
 *  kicker/title/spacing can't drift screen to screen. */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
  className,
}: {
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        actions && "flex flex-wrap items-end justify-between gap-x-6 gap-y-4",
        className,
      )}
    >
      <div className="max-w-[68ch]">
        <Label>{kicker}</Label>
        <h1 className="my-2.5 text-[40px] font-semibold leading-[1.1] tracking-[-0.025em]">
          {title}
        </h1>
        {description && <p className="text-ink-400">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
