import * as React from "react";
import { cn } from "@/lib/utils";

const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative overflow-hidden rounded-[10px] bg-ink-800 after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,var(--shimmer-highlight),transparent)] after:content-['']",
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

export { Skeleton };
