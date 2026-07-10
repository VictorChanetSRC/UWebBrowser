import { useRef, type ReactNode, type RefObject } from "react";
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

/** Where the card sits inside the scrim. `omnibox` anchors it under the address
 *  bar, the way Chrome drops a permission bubble. */
const PLACEMENT = {
  top: "items-start justify-center p-16",
  center: "items-center justify-center",
  omnibox: "items-start justify-start px-4 pt-1",
} as const;

/**
 * A modal dialog: the scrim plus the lifted card. Every dialog in the app is
 * built from this — basic-auth, external links, permission bubbles, feedback —
 * so none of them can drift on the things that are easy to forget.
 *
 * It is a real modal: labelled, focus-trapped, focus-restoring, and dismissible
 * by Escape or a click on the scrim, matching Chrome's equivalent prompts.
 * `onDismiss` is the *cancelling* action — closing by Escape or scrim must never
 * be read as consent, so callers pass the same handler as their Cancel button.
 */
export function PromptModal({
  children,
  className,
  label,
  onDismiss,
  onSubmit,
  placement = "top",
  role = "dialog",
  initialFocus,
  anchor = "content",
}: {
  children: ReactNode;
  className?: string;
  /** Names the dialog for assistive tech. */
  label: string;
  onDismiss: () => void;
  /** When set, the card is a <form> and submits on Enter. */
  onSubmit?: () => void;
  placement?: keyof typeof PLACEMENT;
  /** `alertdialog` for prompts that interrupt with a decision to make; screen
   *  readers announce their content immediately rather than just the label. */
  role?: "dialog" | "alertdialog";
  /** Element to focus on open. Defaults to the first focusable in the card —
   *  for a consent prompt, pass the *safe* choice, never the one that grants. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** `window` covers the whole app (a dialog raised from an internal page);
   *  `content` covers only the page area it's rendered into. */
  anchor?: "content" | "window";
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEscape(onDismiss);
  useFocusTrap(cardRef, true, initialFocus);

  return (
    <div
      className={cn(
        anchor === "window" ? "fixed inset-0" : "absolute inset-0",
        "flex",
        PLACEMENT[placement],
        Z_MODAL,
        SCRIM_CLASS,
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={cardRef}
        role={role}
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
