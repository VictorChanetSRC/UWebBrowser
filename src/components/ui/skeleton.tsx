import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[10px] bg-ink-800 after:absolute after:inset-0 after:animate-shimmer after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.045),transparent)] after:content-['']",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
