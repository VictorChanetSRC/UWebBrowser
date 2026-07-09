import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/** A small pill: mono, hairline border, quiet by default. `tone="signal"` is
 *  the rare accent variant (a failed state) — use it at most once per view.
 *  Variants live in `cva` like the button primitive, so tones are authored one
 *  way across the design system. */
const tagVariants = cva("flex-none rounded-full border px-2 py-0.5 font-mono text-[10.5px]", {
  variants: {
    tone: {
      default: "border-border text-ink-500",
      signal: "border-signal-500/30 bg-signal-500/10 text-signal-400",
    },
  },
  defaultVariants: { tone: "default" },
});

export function Tag({
  children,
  tone,
  className,
}: VariantProps<typeof tagVariants> & {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn(tagVariants({ tone }), className)}>{children}</span>;
}
