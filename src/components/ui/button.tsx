import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity,transform] duration-[130ms] ease-brand disabled:cursor-default disabled:opacity-30",
  {
    variants: {
      variant: {
        outline:
          "border border-ink-700 text-ink-200 hover:border-ink-600 hover:bg-ink-800 enabled:active:scale-[0.98]",
        primary:
          "border border-primary bg-primary text-primary-foreground hover:border-signal-500 hover:bg-signal-500 enabled:active:scale-[0.98]",
        ghost:
          "text-ink-400 hover:bg-ink-800 hover:text-ink-100 aria-pressed:text-ink-200",
        link: "text-ink-300 hover:text-ink-100 hover:underline",
        chip: "rounded-full border border-ink-700 text-ink-300 hover:border-ink-600 hover:bg-ink-800 aria-pressed:border-ink-200 aria-pressed:bg-ink-800 aria-pressed:text-ink-100",
      },
      size: {
        default: "h-[34px] rounded-lg px-3.5 text-[13px]",
        sm: "h-7 rounded-md px-2.5 text-xs",
        chip: "h-[30px] px-[13px] text-[12.5px]",
        icon: "size-[30px] rounded-[7px] enabled:active:scale-[0.92]",
        // A text+icon pill at icon height — the toolbar's star / Discord / "Add
        // to UWebBrowser" affordances. Shares the icon size's 30px/7px metric.
        pill: "h-[30px] gap-1.5 rounded-[7px] [&_svg]:size-3.5",
        none: "",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
