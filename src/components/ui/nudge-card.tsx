import type { ReactNode } from "react";
import { Button } from "./button";
import { PromptIcon, PromptActions } from "./prompt";

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
    <div className="absolute bottom-5 right-3 z-40 w-[360px] animate-rise rounded-xl border border-border bg-popover p-4 shadow-modal">
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
