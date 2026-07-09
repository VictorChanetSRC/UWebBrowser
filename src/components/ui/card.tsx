import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn("flex flex-col gap-4 rounded-xl border border-border bg-card p-5", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center justify-between", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export { Card, CardHeader };
