import { usePolled } from "./use-polled";
import { ipc } from "../lib/ipc";

/** Refresh window. The backend caches repo stats for 15 minutes anyway. */
const POLL_MS = 900_000;
/** Shared with every caller, so the second one hydrates from the first's result
 *  instead of round-tripping. Namespaced like every other `usePolled` key. */
const CACHE_KEY = "github_stats";

/**
 * The app's own repo star count, or `null` until the first answer lands (and
 * whenever GitHub is unreachable — callers render the bare glyph rather than a
 * broken number).
 *
 * One hook so the toolbar badge and the Settings page can't disagree about the
 * interval or the cache key: sharing `CACHE_KEY` is what lets whichever mounts
 * second show a number immediately.
 */
export function useGithubStars(): number | null {
  const { data } = usePolled(() => ipc.githubRepoStats(), [], POLL_MS, true, CACHE_KEY);
  return data?.stars ?? null;
}
