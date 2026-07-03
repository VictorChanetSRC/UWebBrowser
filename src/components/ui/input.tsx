import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-[38px] w-full min-w-0 select-text rounded-lg border border-input bg-ink-900 px-3 font-sans text-sm text-ink-100 outline-none transition-[border-color] duration-[130ms] ease-brand placeholder:text-ink-500 hover:border-ink-600 focus:border-ink-400",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
