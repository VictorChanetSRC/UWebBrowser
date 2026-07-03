import type { PlatformHit, PlatformKey } from "./platforms";

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
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return { ...emptyConfig };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.games)) {
      return {
        games: parsed.games,
        itchApiKey: parsed.itchApiKey ?? "",
        done: Boolean(parsed.done),
      };
    }
    // v1 config held a single game inline; carry it over.
    const games =
      parsed.gameName || parsed.steamAppId
        ? [
            {
              id: crypto.randomUUID(),
              name: parsed.gameName ?? "",
              steamAppId: parsed.steamAppId ?? "",
            },
          ]
        : [];
    return {
      games,
      itchApiKey: parsed.itchApiKey ?? "",
      done: Boolean(parsed.done),
    };
  } catch {
    return { ...emptyConfig };
  }
}

export function saveConfig(config: UwbConfig) {
  localStorage.setItem(KEY, JSON.stringify(config));
}
