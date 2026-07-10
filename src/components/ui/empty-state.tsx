import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The one designed empty / no-match state: a dashed box with muted copy, an
 * optional icon and title, and room for a secondary line or action. Shared so
 * every screen's "nothing here" reads the same (radius, border, padding,
 * colour) instead of each one hand-rolling its own box.
 *
 * `compact` is the side-rail variant: left-aligned and tight, because a
 * full-page empty state's centered 56px of padding doesn't fit a 220px rail.
 */
const emptyStateVariants = cva("flex flex-col border border-dashed border-ink-700 text-ink-400", {
  variants: {
    variant: {
      default: "items-center gap-3 rounded-xl px-6 py-14 text-center",
      compact: "items-start gap-2.5 rounded-[10px] p-3 text-left text-[12px] leading-[1.5]",
    },
  },
  defaultVariants: { variant: "default" },
});

export function EmptyState({
  icon,
  title,
  children,
  className,
  variant,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
} & VariantProps<typeof emptyStateVariants>) {
  return (
    <div className={cn(emptyStateVariants({ variant }), className)}>
      {icon}
      {title && (
        <p className={cn(variant === "compact" ? "text-inherit" : "text-sm text-ink-300")}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}
