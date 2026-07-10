import { memo, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/lib/format";
import { playerHistory, recordPlayers, type PlayerSample } from "@/lib/steam-players";
import { usePolled } from "@/hooks/use-polled";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Trace } from "@/components/ui/sparkline";
import { trackedAppId, trackedGame, VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { SteamState, TracksGameEditor, WidgetCard } from "./shared";

/** Live player count with a past-hour trace, remembered across restarts. */
export type SteamPlayersWidget = {
  id: string;
  type: "steam-players";
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
};

const POLL_MS = 30_000;
/** How long the dot stays Signal after an update lands. */
const BLINK_MS = 1_200;
/** The trace window. */
const HOUR_MS = 60 * 60_000;

function SteamPlayersBody({ widget, games, active, onOpen }: BarBodyProps<SteamPlayersWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = trackedAppId(widget.gameId, games);
  // Wrap the count in a fresh object so every poll — even one returning the
  // same number — lands as an update; the blink and the trace key off it.
  const { data, error } = usePolled(
    async () => ({ players: await ipc.steamPlayers(appid), at: Date.now() }),
    [appid],
    POLL_MS,
    !!appid && active,
    `players:${appid}`,
  );

  const [samples, setSamples] = useState<PlayerSample[]>([]);
  const [blink, setBlink] = useState(false);

  useEffect(() => setSamples(appid ? playerHistory(appid) : []), [appid]);

  useEffect(() => {
    if (!data || data.players === null) return;
    setSamples(recordPlayers(appid, data.players));
    setBlink(true);
    const timer = window.setTimeout(() => setBlink(false), BLINK_MS);
    return () => window.clearTimeout(timer);
  }, [data, appid]);

  return (
    <WidgetCard
      onClick={appid ? () => onOpen(`https://steamdb.info/app/${appid}/charts/`) : undefined}
      title={appid ? "Open SteamDB charts" : undefined}
    >
      <SteamState
        game={game}
        appid={appid}
        data={data}
        error={error}
        noGame="Add your game on the dashboard to track live players."
        skeleton={
          <>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-8 w-full rounded-[4px]" />
          </>
        }
      >
        {(live, tracked) => (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                <span
                  className={cn(
                    "size-2 flex-none rounded-full transition-colors duration-500",
                    blink ? "bg-signal-500" : "bg-ink-600",
                  )}
                  aria-hidden
                />
                {fmtNumber(live.players)}
              </span>
              <Label size="micro">Playing now</Label>
            </div>
            <HourTrace samples={samples} now={live.at} />
            <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-400">
              <span className="truncate">{tracked.name || `App ${appid}`}</span>
              <span className="flex-none">past hour</span>
            </div>
          </>
        )}
      </SteamState>
    </WidgetCard>
  );
}

/**
 * The past hour of counts as a filled trace. Unlike Sparkline, x is wall
 * clock — samples land where in the hour they happened — and y spans the
 * window's own min..max so small swings in a steady count stay visible.
 */
const HourTrace = memo(function HourTrace({
  samples,
  now,
}: {
  samples: PlayerSample[];
  now: number;
}) {
  const w = 100;
  const h = 32;
  const visible = samples.filter((s) => now - s.t <= HOUR_MS);

  let min = Infinity;
  let max = -Infinity;
  for (const s of visible) {
    min = Math.min(min, s.players);
    max = Math.max(max, s.players);
  }
  // Pad the range so the trace never rides the edges; the floor keeps a
  // dead-flat count from dividing by zero.
  const pad = Math.max((max - min) * 0.15, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;

  // x is wall clock within the hour; y spans the window's own min..max so
  // small swings in a steady count stay visible.
  const points = visible.map((s) => {
    const x = ((s.t - (now - HOUR_MS)) / HOUR_MS) * w;
    // Inset 1px top/bottom so the stroke isn't clipped at the extremes.
    const y = h - 1 - ((s.players - lo) / (hi - lo)) * (h - 2);
    return [x, y] as const;
  });

  return <Trace points={points} width={w} height={h} className="h-8" />;
});

export default defineBarWidget<SteamPlayersWidget>({
  type: "steam-players",
  icon: Activity,
  creator: VICTOR_CHANET,
  shop: {
    name: "Steam players",
    tagline: "Realtime player count with the past hour on a graph.",
    description:
      "The live player count for your game, refreshed every 30 seconds — " +
      "the dot blinks Signal each time a fresh number lands. Under it, the " +
      "past hour of counts as a trace, remembered across restarts.",
    category: "game",
    tags: ["steam", "players", "live", "realtime", "graph", "history"],
    facts: [
      { label: "Source", value: "Steam Web API" },
      { label: "Refresh", value: "Every 30 s" },
      { label: "History", value: "Past hour, saved in the browser" },
      { label: "Needs", value: "A game with a Steam App ID" },
    ],
    repeatable: true,
  },
  create: (base) => ({ ...base, type: "steam-players", gameId: null }),
  title: () => "Steam · Players",
  Body: SteamPlayersBody,
  Editor: TracksGameEditor,
  preview: { id: "preview-steam-players", type: "steam-players", gameId: null },
});
