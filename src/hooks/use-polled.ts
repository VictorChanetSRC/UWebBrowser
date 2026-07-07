import { useEffect, useState } from "react";

type PolledState<T> = { data: T | null; error: string | null };

/**
 * Last-good results, keyed by an explicit `cacheKey`. Lets a widget rehydrate
 * instantly on remount instead of flashing a skeleton and refetching — the
 * dashboard fully unmounts on every tab switch, so without this, returning home
 * blanks every tile. Module-scoped so it survives unmount; opt-in so hooks
 * without a key behave exactly as before (no cross-widget collisions).
 */
const resultCache = new Map<string, unknown>();

/**
 * Like useAsync, but refetches every `intervalMs` while mounted *and visible*.
 * Polling pauses when the window is hidden (minimized or occluded) and resumes
 * with an immediate fetch when it returns — a browser that sits in the tray all
 * day shouldn't be hammering Steam/itch/WMI in the background. On refresh
 * errors the last good data is kept so live widgets don't flicker to empty.
 *
 * Pass a stable `cacheKey` (namespaced by fetch + args, e.g. `game:${appid}`)
 * to hydrate instantly from the last good result across remounts.
 */
export function usePolled<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  intervalMs: number,
  enabled = true,
  cacheKey?: string,
): PolledState<T> {
  const [state, setState] = useState<PolledState<T>>(() => ({
    data: cacheKey && resultCache.has(cacheKey) ? (resultCache.get(cacheKey) as T) : null,
    error: null,
  }));

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    let running = false;
    let timer: number | undefined;

    const run = async () => {
      try {
        const data = await fn();
        if (cacheKey) resultCache.set(cacheKey, data);
        if (!stale) setState({ data, error: null });
      } catch (e) {
        if (!stale) setState((prev) => ({ data: prev.data, error: String(e) }));
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      // Paused while hidden; visibilitychange re-arms us.
      if (document.hidden) return;
      timer = window.setTimeout(tick, intervalMs);
    };

    const tick = async () => {
      if (stale || running) return;
      running = true;
      await run();
      running = false;
      if (!stale) schedule();
    };

    const onVisibility = () => {
      if (!stale && !document.hidden) tick();
    };

    // Reset for the new deps — but keep any cached last-good value so a keyed
    // widget shows data immediately instead of a skeleton.
    setState({
      data: cacheKey && resultCache.has(cacheKey) ? (resultCache.get(cacheKey) as T) : null,
      error: null,
    });
    if (!document.hidden) tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stale = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, intervalMs, cacheKey]);

  return state;
}
