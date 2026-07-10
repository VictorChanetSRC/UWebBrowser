import type { ReactNode } from "react";
import { Button } from "./button";
import { POPOVER_SURFACE, Z_POPOVER } from "./overlay";
import { PromptIcon, PromptActions } from "./prompt";
import { cn } from "../../lib/utils";

/** The bottom-right nudge bubble: an icon, a title, a line of body copy, and a
 *  dismiss / primary action pair. Shared by the star nudge and the default-
 *  browser prompt so the two can't drift on shell, spacing or buttons. */
export function NudgeCard({
  icon,
  title,
  body,
  primaryLabel,
  onPrimary,
  onDismiss,
  dismissLabel = "Not now",
}: {
  icon: ReactNode;
  title: ReactNode;
  body: ReactNode;
  primaryLabel: ReactNode;
  onPrimary: () => void;
  onDismiss: () => void;
  dismissLabel?: string;
}) {
  return (
    <div
      className={cn(
        "absolute bottom-5 right-3 w-[360px] animate-rise p-4",
        Z_POPOVER,
        POPOVER_SURFACE,
      )}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>{icon}</PromptIcon>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-100">{title}</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{body}</div>
        </div>
      </div>
      <PromptActions>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {dismissLabel}
        </Button>
        <Button size="sm" variant="primary" onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </PromptActions>
    </div>
  );
}
