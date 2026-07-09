import type { ReactNode } from "react";
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

/** A centered modal dialog: the scrim plus the lifted card. Used by the
 *  basic-auth and external-link prompts so both share one backdrop and card
 *  recipe (radius, border, elevation). */
export function PromptModal({
  children,
  className,
  onSubmit,
}: {
  children: ReactNode;
  className?: string;
  /** When set, the card is a <form> and submits on Enter. */
  onSubmit?: () => void;
}) {
  const cardClass = cn(
    "animate-rise rounded-xl border border-border bg-popover p-5 shadow-modal",
    className,
  );
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 p-16">
      {onSubmit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className={cardClass}
        >
          {children}
        </form>
      ) : (
        <div className={cardClass}>{children}</div>
      )}
    </div>
  );
}
