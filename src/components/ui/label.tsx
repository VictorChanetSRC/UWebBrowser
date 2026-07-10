import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The brand's mono kicker: uppercase, tracked-out, Ink-500.
 *
 * Two sizes, because the role appears at two scales: `default` heads a section
 * or page, `micro` labels a tile, stat or row. They used to be spelled as
 * ad-hoc `text-[10px]` / `text-[10.5px]` overrides at the call sites, which is
 * how the same kicker ended up at three sizes and three trackings.
 */
const labelVariants = cva("font-mono font-medium uppercase tracking-[0.16em] text-ink-500", {
  variants: {
    size: {
      default: "text-xs",
      micro: "text-[10px]",
    },
  },
  defaultVariants: { size: "default" },
});

type LabelProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof labelVariants>;

function Label({ className, size, ...props }: LabelProps) {
  return <span className={cn(labelVariants({ size }), className)} {...props} />;
}

export { Label, labelVariants };
