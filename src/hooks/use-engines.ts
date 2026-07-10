import { useEffect, useState } from "react";
import { ipc, silent, type EngineInstall } from "@/lib/ipc";
import { mergeEngines } from "@/lib/unreal";

/**
 * The set of Unreal engines available to a widget: auto-detected installs
 * (scanned off disk/registry, only while `active` so an inert shop preview
 * doesn't touch the disk) merged with the user's manually-linked ones. Shared
 * by both build widgets so the detection effect lives once.
 */
export function useEngines(active: boolean, manualEngines: EngineInstall[]): EngineInstall[] {
  const [detected, setDetected] = useState<EngineInstall[]>([]);
  useEffect(() => {
    if (!active) return;
    // A failed scan is not actionable: the user's manually-linked engines still
    // come through, and the widget's own empty state covers finding none.
    silent(ipc.detectEngines().then(setDetected));
  }, [active]);
  return mergeEngines(detected, manualEngines);
}
