import { forwardRef, type ComponentProps } from "react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type Props = Omit<ComponentProps<typeof Button>, "aria-label"> & {
  /** Required — sets both the accessible name and the hover tooltip. */
  label: string;
};

/** A ghost icon button with a mandatory accessible label. Replaces the
 *  hand-rolled copies in the toolbar and password panel. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, className, children, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={cn("[&_svg]:size-4", className)}
      {...props}
    >
      {children}
    </Button>
  ),
);
IconButton.displayName = "IconButton";
