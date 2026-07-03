import { useSyncExternalStore } from "react";

import {
  getUnrealState,
  subscribeUnrealState,
  updateUnrealState,
  type UnrealState,
} from "../lib/unreal";

/**
 * The shared Unreal state and its updater. Both the dashboard build section and
 * the Unreal hub read through this, so an engine or project linked on one shows
 * up on the other without a remount.
 */
export function useUnrealState(): [
  UnrealState,
  (next: UnrealState | ((prev: UnrealState) => UnrealState)) => void,
] {
  const state = useSyncExternalStore(subscribeUnrealState, getUnrealState);
  return [state, updateUnrealState];
}
