import { Gamepad2 } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { PLATFORMS } from "@/lib/platforms";
import { fmtNumber, MISSING } from "@/lib/format";
import { positivePct, priceLabel, releaseLabel } from "@/lib/steam";
import { jobRunning } from "@/lib/build-job";
import { usePolled } from "@/hooks/use-polled";
import { useBuildJob } from "@/hooks/use-build-job";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import {
  CardLink,
  DataCard,
  Stat,
  StatGrid,
  TileHint,
  TracksGameConfig,
  trackedGame,
} from "./shared";

/** The flagship tile: live Steam numbers for one of your games. */
export type GameWidget = {
  id: string;
  type: "game";
  span: TileSpan;
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
};

function GameBody({ widget, games, active, onOpen, onEditSetup }: DashBodyProps<GameWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = game?.steamAppId?.trim() ?? "";
  const { data: stats, error } = usePolled(
    () => ipc.steamStats(appid),
    [appid],
    60_000,
    !!appid && active,
    `game:${appid}`,
  );

  // A build in flight owns the one Signal pulse; mute the players dot to match.
  const job = useBuildJob();
  const buildRunning = job !== null && jobRunning(job);

  if (!game) {
    return (
      <DataCard label="Your game">
        <TileHint>No game on file yet. Set one up and it lands here.</TileHint>
        <div>
          <Button onClick={onEditSetup}>Open setup</Button>
        </div>
      </DataCard>
    );
  }

  const positive = positivePct(stats?.reviews);

  const platforms = PLATFORMS.filter((p) => game.platforms?.[p.key]?.url);

  return (
    <DataCard
      label="Your game"
      error={!!appid && !stats && error ? `Steam didn't answer: ${error}` : null}
      loading={!!appid && !stats}
      skeleton={
        <StatGrid>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[78px]" />
          ))}
        </StatGrid>
      }
      links={
        appid ? (
          <>
            <CardLink onClick={() => onOpen(`https://store.steampowered.com/app/${appid}`)}>
              Store page
            </CardLink>
            <CardLink onClick={() => onOpen(`https://steamdb.info/app/${appid}/charts/`)}>
              SteamDB
            </CardLink>
          </>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4">
        {stats?.details?.header_image && (
          <img
            src={stats.details.header_image}
            alt=""
            className="aspect-[460/215] w-[154px] flex-none rounded-md bg-ink-800"
          />
        )}
        <h2 className="text-[28px] font-semibold tracking-[-0.02em]">
          {game.name || stats?.details?.name || "Untitled project"}
        </h2>
      </div>
      {appid ? (
        stats && (
          <StatGrid>
            <Stat
              label="Playing now"
              value={fmtNumber(stats.players)}
              live={!!stats.players}
              muted={buildRunning}
            />
            <Stat label="Review score" value={stats.reviews?.review_score_desc ?? MISSING} />
            <Stat label="Positive" value={positive !== null ? `${positive}%` : MISSING} />
            <Stat label="Reviews" value={fmtNumber(stats.reviews?.total_reviews)} />
            <Stat label="Price" value={priceLabel(stats.details)} />
            <Stat label="Release" value={releaseLabel(stats.details)} />
          </StatGrid>
        )
      ) : (
        <TileHint>Add a Steam App ID in setup to see live numbers here.</TileHint>
      )}
      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {platforms.map((p) => (
            <Button key={p.key} size="sm" onClick={() => onOpen(game.platforms![p.key]!.url!)}>
              {p.label}
            </Button>
          ))}
        </div>
      )}
    </DataCard>
  );
}

export default defineDashWidget<GameWidget>({
  type: "game",
  icon: Gamepad2,
  creator: VICTOR_CHANET,
  shop: {
    name: "Your game",
    tagline: "Live Steam numbers, stores and links for one of your games.",
    description:
      "The tile your day starts on. Current players, review score and follower " +
      "count straight from Steam, with your store pages one click away. Add a " +
      "tile per game and keep the whole slate in view.",
    category: "game",
    tags: ["steam", "players", "reviews", "followers", "stats", "store"],
    facts: [
      { label: "Source", value: "Steam Web API" },
      { label: "Refresh", value: "Every 60 s" },
      { label: "Needs", value: "A game with a Steam App ID" },
      { label: "Tile", value: "2×2 to start · resize freely" },
    ],
    repeatable: true,
  },
  defaultSpan: { c: 2, r: 2 },
  create: (base) => ({ ...base, type: "game", gameId: null }),
  title: (widget, games) => trackedGame(widget.gameId, games)?.name || "Your game",
  Body: GameBody,
  Config: TracksGameConfig,
  preview: { id: "preview-game", type: "game", span: { c: 2, r: 2 }, gameId: null },
});
