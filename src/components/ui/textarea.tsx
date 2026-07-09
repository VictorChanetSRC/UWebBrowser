import * as React from "react";
import { cn } from "@/lib/utils";
import { FIELD_CLASS } from "./input";

/** The multi-line counterpart to `Input`, sharing its exact field skin so a
 *  textarea and an input focus and hover identically. */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(FIELD_CLASS, "resize-none p-3", className)} {...props} />
));
Textarea.displayName = "Textarea";

export { Textarea };
