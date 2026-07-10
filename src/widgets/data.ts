/**
 * One hook per live data source, shared by both widget surfaces.
 *
 * Every widget already polled with `usePolled`, but the three things *around*
 * the call — the interval, the `cacheKey` string, and the `!!id && active` gate
 * — were copied between each widget's dashboard tile and its work-bar twin. The
 * cache key in particular is a cross-file magic string: the two surfaces only
 * share a hydration slot (and so only show data instantly on remount) if they
 * spell it identically. Owning all three here means they can't drift.
 *
 * Intervals are deliberately per-source, not per-surface: they're a property of
 * how fast the upstream data can actually change, and the backend's TTL cache
 * already collapses anything faster.
 */
import { usePolled } from "@/hooks/use-polled";
import { ipc, type ItchEarnings, type ItchGame, type SalesSummary, type SteamStats } from "@/lib/ipc";

/** The Steam ledger settles once a day, and the backend won't resync inside
 *  30 minutes; this is just how fast a surface notices a sync that happened. */
const SALES_POLL_MS = 300_000;
/** Matches the backend's itch cache: every real fetch is also the snapshot that
 *  advances the ledger, so polling faster buys traffic and nothing else. */
const ITCH_POLL_MS = 300_000;
/** Key art, reviews and price barely move. */
const STEAM_STATS_POLL_MS = 300_000;
/** The one Steam number that moves in realtime. */
const PLAYERS_POLL_MS = 30_000;

type Polled<T> = { data: T | null; error: string | null };

export function useSteamSales(appid: string, active: boolean): Polled<SalesSummary> {
  return usePolled(
    () => ipc.steamSalesSummary(appid),
    [appid],
    SALES_POLL_MS,
    !!appid && active,
    `sales:${appid}`,
  );
}

/** Shares its in-flight call and TTL cache with every other players poll, so a
 *  surface carrying two Steam widgets still hits Steam once per tick. */
export function usePlayerCount(appid: string, active: boolean): Polled<number | null> {
  return usePolled(
    () => ipc.steamPlayers(appid),
    [appid],
    PLAYERS_POLL_MS,
    !!appid && active,
    `players:${appid}`,
  );
}

/** `intervalMs` is a surface's business — a big tile may want fresher reviews
 *  than a 220px rail — but the key and the gate are not. */
export function useSteamStats(
  appid: string,
  active: boolean,
  intervalMs: number = STEAM_STATS_POLL_MS,
): Polled<SteamStats> {
  return usePolled(
    () => ipc.steamStats(appid),
    [appid],
    intervalMs,
    !!appid && active,
    `game:${appid}`,
  );
}

export function useItchEarnings(apiKey: string, active: boolean): Polled<ItchEarnings> {
  const key = apiKey.trim();
  return usePolled(
    () => ipc.itchEarnings(key),
    [key],
    ITCH_POLL_MS,
    !!key && active,
    `itch-earnings:${key}`,
  );
}

export function useItchGames(apiKey: string, active: boolean): Polled<ItchGame[]> {
  const key = apiKey.trim();
  return usePolled(() => ipc.itchGames(key), [key], ITCH_POLL_MS, !!key && active, `itch:${key}`);
}
