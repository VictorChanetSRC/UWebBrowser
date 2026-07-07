import { loadJson, saveJson } from "./storage";

/**
 * Rolling player-count samples per Steam app, persisted in the browser so
 * the players widget's past-hour trace survives restarts. Live data stores
 * are the exception to "widgets persist settings, not data" — the whole
 * point of a history graph is remembering what the widget saw.
 */

export type PlayerSample = {
  /** When the count was read (ms epoch). */
  t: number;
  players: number;
};

const KEY = "uwb.steam.players";
/** A hair over the drawn hour so the trace still enters from the left edge. */
const WINDOW_MS = 65 * 60_000;
/** Samples closer than this are the same poll (remounts, duplicate widgets). */
const MIN_GAP_MS = 15_000;

type Store = Record<string, PlayerSample[]>;

let cache: Store | null = null;

function load(): Store {
  cache ??= loadJson(
    [KEY],
    (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Store) : null),
    () => ({}),
  );
  return cache;
}

const inWindow = (samples: PlayerSample[], now: number) =>
  samples.filter((s) => now - s.t <= WINDOW_MS);

/** The stored trace for one app, oldest → newest, already pruned. */
export function playerHistory(appid: string): PlayerSample[] {
  return inWindow(load()[appid] ?? [], Date.now());
}

/** Append a fresh count and return the app's pruned trace. Apps whose last
 *  sample aged out of the window are dropped so the store can't grow. */
export function recordPlayers(appid: string, players: number): PlayerSample[] {
  const store = load();
  const now = Date.now();
  // Track whether anything actually changed, so a steady 30 s poll that adds no
  // sample (inside MIN_GAP) doesn't re-stringify the whole store every tick.
  let changed = false;
  for (const [id, samples] of Object.entries(store)) {
    const kept = inWindow(samples, now);
    if (kept.length === 0) {
      delete store[id];
      changed = true;
    } else if (kept.length !== samples.length) {
      store[id] = kept;
      changed = true;
    }
  }
  const samples = store[appid] ?? [];
  const last = samples[samples.length - 1];
  if (!last || now - last.t >= MIN_GAP_MS) {
    samples.push({ t: now, players });
    changed = true;
  }
  store[appid] = samples;
  if (changed) saveJson(KEY, store);
  return samples;
}
