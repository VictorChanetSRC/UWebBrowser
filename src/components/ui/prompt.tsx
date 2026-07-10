import { useRef, type ReactNode } from "react";
import { useEscape } from "@/hooks/use-escape";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { MODAL_SURFACE, SCRIM_CLASS, Z_MODAL } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** The square icon badge that leads every prompt, nudge and permission bubble.
 *  One source so the chip size, radius and fill can't drift between prompts. */
export function PromptIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-ink-800 text-ink-200 [&_svg]:size-4">
      {children}
    </span>
  );
}

/** The right-aligned action row (secondary + primary button) shared by every
 *  prompt and dialog. */
export function PromptActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-3 flex items-center justify-end gap-1.5", className)}>{children}</div>
  );
}

/**
 * A centered modal dialog: the scrim plus the lifted card. Used by the
 * basic-auth and external-link prompts so both share one backdrop and card
 * recipe (radius, border, elevation).
 *
 * It is a real modal — labelled, focus-trapped, and dismissible by Escape or a
 * click on the scrim, matching Chrome's equivalent prompts. `onDismiss` is the
 * cancelling action: closing by Escape or scrim must never be read as consent,
 * so callers pass the same handler as their Cancel button.
 */
export function PromptModal({
  children,
  className,
  label,
  onDismiss,
  onSubmit,
}: {
  children: ReactNode;
  className?: string;
  /** Names the dialog for assistive tech. */
  label: string;
  onDismiss: () => void;
  /** When set, the card is a <form> and submits on Enter. */
  onSubmit?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEscape(onDismiss);
  useFocusTrap(cardRef);

  return (
    <div
      className={cn("absolute inset-0 flex items-start justify-center p-16", Z_MODAL, SCRIM_CLASS)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(MODAL_SURFACE, "p-5", className)}
      >
        {/* `display: contents` keeps the form out of the layout, so the card
            stays the single styled box whether or not it submits. */}
        {onSubmit ? (
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {children}
          </form>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
