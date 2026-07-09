import * as React from "react";
import { cn } from "@/lib/utils";

/** The shared field skin — border, fill, focus/hover, placeholder — for every
 *  text control. `Input` and `Textarea` add only their own sizing so the two
 *  can't drift on how a field looks or focuses. */
export const FIELD_CLASS =
  "w-full min-w-0 select-text rounded-lg border border-input bg-ink-900 font-sans text-sm text-ink-100 outline-none transition-[border-color] duration-[130ms] ease-brand placeholder:text-ink-500 hover:border-ink-600 focus:border-ink-400";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(FIELD_CLASS, "h-[38px] px-3", className)} {...props} />
  ),
);
Input.displayName = "Input";

export { Input };
