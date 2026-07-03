import { useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { PLATFORMS, type PlatformHit, type PlatformKey } from "../lib/platforms";

export type CheckStatus = "checking" | "found" | "missing" | "failed";
export type CheckRow = { status: CheckStatus; hit?: PlatformHit };
export type CheckRows = Partial<Record<PlatformKey, CheckRow>>;

/**
 * One name in, every storefront checked. Each platform resolves
 * independently so results fill in live while slower stores answer.
 * Re-running the search drops stragglers from the previous run.
 */
export function usePlatformCheck() {
  const [rows, setRows] = useState<CheckRows | null>(null);
  const runId = useRef(0);

  const done =
    rows !== null && PLATFORMS.every((p) => rows[p.key]?.status !== "checking");
  const searching = rows !== null && !done;
  const foundCount = rows
    ? PLATFORMS.filter((p) => rows[p.key]?.status === "found").length
    : 0;

  const search = (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || searching) return;
    const run = ++runId.current;
    setRows(Object.fromEntries(PLATFORMS.map((p) => [p.key, { status: "checking" }])));
    for (const p of PLATFORMS) {
      ipc
        .checkPlatform(p.key, query)
        .then(
          (hit) =>
            run === runId.current &&
            setRows((r) => ({
              ...r,
              [p.key]: { status: hit.found ? "found" : "missing", hit },
            })),
        )
        .catch(
          () =>
            run === runId.current &&
            setRows((r) => ({ ...r, [p.key]: { status: "failed" } })),
        );
    }
  };

  /** The hits worth keeping, in the shape Game.platforms stores. */
  const foundPlatforms = (): Partial<Record<PlatformKey, PlatformHit>> =>
    Object.fromEntries(
      PLATFORMS.filter((p) => rows?.[p.key]?.status === "found").map((p) => [
        p.key,
        rows![p.key]!.hit!,
      ]),
    );

  return { rows, searching, done, foundCount, search, foundPlatforms };
}
