import { useEffect, useState } from "react";

type AsyncState<T> = { data: T | null; error: string | null };

/**
 * Run an async fetch tied to `deps`, resetting to a loading state whenever
 * they change. Late responses from a superseded run are dropped.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null });

  useEffect(() => {
    let stale = false;
    setState({ data: null, error: null });
    fn()
      .then((data) => !stale && setState({ data, error: null }))
      .catch((e) => !stale && setState({ data: null, error: String(e) }));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
