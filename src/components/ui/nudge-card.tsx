import { useId, type ReactNode } from "react";
import { Button } from "./button";
import { POPOVER_SURFACE, Z_POPOVER } from "./overlay";
import { PromptIcon, PromptActions } from "./prompt";
import { useEscape } from "../../hooks/use-escape";
import { cn } from "../../lib/utils";

/**
 * The bottom-right nudge bubble: an icon, a title, a line of body copy, and a
 * dismiss / primary action pair. Shared by the app's self-initiated prompts so
 * they can't drift on shell, spacing or buttons.
 *
 * A nudge appears on its own, without the user doing anything — the default-
 * browser prompt arrives 2.5 s after launch. That makes announcing it, and
 * letting Escape dismiss it, part of the contract rather than a nicety: nothing
 * else tells a screen-reader user it's there, and nothing else gets rid of it
 * without a mouse. It is not `aria-modal`: the page behind stays usable, which
 * is the point of a nudge.
 */
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
  const titleId = useId();
  const bodyId = useId();
  useEscape(onDismiss);

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // `assertive` would talk over whatever the user is doing; a nudge is by
      // definition interruptible, so it waits for a gap.
      aria-live="polite"
      className={cn(
        "absolute bottom-5 right-3 w-[360px] animate-rise p-4",
        Z_POPOVER,
        POPOVER_SURFACE,
      )}
    >
      <div className="flex items-start gap-3">
        <PromptIcon>{icon}</PromptIcon>
        <div className="min-w-0 flex-1">
          <div id={titleId} className="text-[13px] text-ink-100">
            {title}
          </div>
          <div id={bodyId} className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {body}
          </div>
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
