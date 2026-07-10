import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The scroll shell every full-page view sits in: a fixed, scrollable container
 * query root, and a centered measure carrying the page's padding and entrance
 * animation. Each page used to repeat both divs verbatim, so page padding and
 * the `animate-rise` entrance lived in six files at once.
 *
 * `width` is the measure the content centers on (a Tailwind width class, so a
 * full-bleed page passes `w-full`); `gap` is the stack rhythm.
 */
export function PageShell({
  children,
  width = "max-w-[1100px]",
  gap = "gap-9",
  className,
}: {
  children: ReactNode;
  width?: string;
  gap?: "gap-7" | "gap-9";
  className?: string;
}) {
  return (
    <div className="absolute inset-0 @container overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex animate-rise flex-col px-10 pb-20 pt-14",
          width,
          gap,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
