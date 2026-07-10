import { useEffect } from "react";

/**
 * Runs `onEscape` when Escape is pressed, while `active`. One home for the
 * "Escape closes this" listener so overlays can't disagree on whether they
 * honour the key — several used to hand-roll this effect, and the prompt
 * modals simply forgot it.
 *
 * The handler receives the event so a layered overlay can `stopPropagation()`
 * and peel one level instead of closing outright.
 */
export function useEscape(onEscape: (e: KeyboardEvent) => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}
