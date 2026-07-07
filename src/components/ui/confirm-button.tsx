import { Button, type ButtonProps } from "./button";
import { useConfirm } from "@/hooks/use-confirm";
import { cn } from "@/lib/utils";

/** The one armed-state treatment for a two-step destructive confirm: a Signal
 *  tint that reads "this is the dangerous step". Shared so History, Settings and
 *  the board/bar resets can't drift on what "click again" looks like. */
export const ARMED_CLASS =
  "border-signal-600 bg-signal-600/15 text-signal-300 hover:border-signal-500 hover:bg-signal-600/25 hover:text-signal-200";

/**
 * A destructive-action button with the two-step confirm baked in: click once to
 * arm (label swaps to `confirmLabel` and the button turns Signal), click again
 * within the window to run `onConfirm`. The label change is announced politely
 * for screen readers.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Click again to confirm",
  className,
  ...props
}: Omit<ButtonProps, "onClick"> & {
  onConfirm: () => void;
  confirmLabel?: string;
}) {
  const { armed, trigger } = useConfirm(onConfirm);
  return (
    <Button
      {...props}
      onClick={trigger}
      aria-live="polite"
      className={cn(armed && ARMED_CLASS, className)}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
