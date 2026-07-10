import { useEffect, type RefObject } from "react";

/**
 * Closes a floating surface when the pointer goes down outside `ref`, while
 * `active`. The app had two idioms for this — a `fixed inset-0` click-catcher
 * div under some dropdowns, a `document` listener under others — which meant
 * two different answers to "does clicking the chrome close this?".
 *
 * Uses `pointerdown` in the capture phase so the surface closes before the
 * click lands on whatever is underneath.
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      const node = ref.current;
      if (node && !node.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref, onDismiss, active]);
}
