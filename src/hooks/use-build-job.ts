import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getBuildJob,
  jobRunning,
  subscribeBuildJob,
  type BuildJob,
} from "../lib/build-job";

/**
 * The current build job from the external store, re-rendering once a second
 * while it runs so elapsed time and ETA stay live. Replaces the copy-pasted
 * `useSyncExternalStore` + 1s tick effect that lived in three components.
 */
export function useBuildJob(): BuildJob | null {
  const job = useSyncExternalStore(subscribeBuildJob, getBuildJob);
  const running = job !== null && jobRunning(job);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return job;
}
