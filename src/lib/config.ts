import type { PlatformHit, PlatformKey } from "./platforms";
import { loadJson, saveJson } from "./storage";

export type Game = {
  id: string;
  name: string;
  steamAppId: string;
  /** Stores and channels where setup found the game. */
  platforms?: Partial<Record<PlatformKey, PlatformHit>>;
};

export type UwbConfig = {
  games: Game[];
  itchApiKey: string;
  done: boolean;
};

const KEY = "uwb.config";
// Pre-rename installs stored the config under this key.
const LEGACY_KEY = "gdb.config";

export const emptyConfig: UwbConfig = {
  games: [],
  itchApiKey: "",
  done: false,
};

export const newGame = (): Game => ({
  id: crypto.randomUUID(),
  name: "",
  steamAppId: "",
});

export function loadConfig(): UwbConfig {
  return loadJson(
    [KEY, LEGACY_KEY],
    (raw): UwbConfig | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const parsed = raw as {
        games?: unknown;
        itchApiKey?: unknown;
        done?: unknown;
        gameName?: unknown;
        steamAppId?: unknown;
      };
      const itchApiKey = typeof parsed.itchApiKey === "string" ? parsed.itchApiKey : "";
      const done = Boolean(parsed.done);
      if (Array.isArray(parsed.games)) {
        return { games: parsed.games as Game[], itchApiKey, done };
      }
      // v1 config held a single game inline; carry it over.
      const games: Game[] =
        parsed.gameName || parsed.steamAppId
          ? [
              {
                id: crypto.randomUUID(),
                name: String(parsed.gameName ?? ""),
                steamAppId: String(parsed.steamAppId ?? ""),
              },
            ]
          : [];
      return { games, itchApiKey, done };
    },
    () => ({ ...emptyConfig }),
  );
}

export function saveConfig(config: UwbConfig) {
  saveJson(KEY, config);
}
