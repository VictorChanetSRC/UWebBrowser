import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A value that reverts to `null` after `ms`. Backs every transient
 * "copied / added / pulse" affordance, so the timer is cleared on unmount in
 * one place instead of being leaked by whichever copy forgot to.
 */
export function useTimedValue<T>(
  ms = 1400,
): [T | null, (value: T) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    setValue(null);
  }, []);

  const fire = useCallback(
    (next: T) => {
      setValue(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setValue(null), ms);
    },
    [ms],
  );

  return [value, fire, clear];
}

/** `useTimedValue` for the common boolean case: `fire()` flips it true for `ms`. */
export function useTimedFlag(ms = 1400): [boolean, () => void] {
  const [value, fire] = useTimedValue<true>(ms);
  const set = useCallback(() => fire(true), [fire]);
  return [value === true, set];
}

