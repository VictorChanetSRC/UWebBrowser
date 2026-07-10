import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab focus inside `ref` while `active`, and restores focus to whatever
 * was focused before on unmount. Every `aria-modal` surface must use this —
 * without it Tab walks straight out of the dialog into the chrome behind the
 * scrim, which is what `FeedbackDialog` used to do.
 *
 * `initialFocus` names the element to focus on open; when omitted (or already
 * containing focus) the first focusable in the panel wins.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active = true,
  initialFocus?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    // `offsetParent === null` drops elements hidden by an ancestor's display:none.
    const focusablesOf = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];

    if (!panel?.contains(document.activeElement)) {
      (initialFocus?.current ?? focusablesOf()[0])?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusablesOf();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [ref, active, initialFocus]);
}
