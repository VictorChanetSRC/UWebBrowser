import * as React from "react";
import { cn } from "@/lib/utils";

/** The brand's mono kicker: uppercase, tracked-out, Ink-500. */
function Label({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "font-mono text-xs font-medium uppercase tracking-[0.16em] text-ink-500",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
