import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step confirm for a destructive action. The first `trigger()` arms it (the
 * UI should read "Click again to confirm"); a second `trigger()` within
 * `timeoutMs` runs the action. It disarms itself after the timeout, and cleans
 * up its timer on unmount. One source so every confirm across the app behaves
 * identically instead of each screen re-implementing the state + timer.
 */
export function useConfirm(action: () => void, timeoutMs = 4000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const reset = useCallback(() => {
    clear();
    setArmed(false);
  }, [clear]);

  const trigger = useCallback(() => {
    if (armed) {
      reset();
      action();
      return;
    }
    setArmed(true);
    clear();
    timer.current = window.setTimeout(() => setArmed(false), timeoutMs);
  }, [armed, action, reset, clear, timeoutMs]);

  useEffect(() => clear, [clear]);

  return { armed, trigger, reset } as const;
}
