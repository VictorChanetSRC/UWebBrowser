import { Gamepad2 } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { MISSING } from "@/lib/format";
import { positivePct, priceLabel } from "@/lib/steam";
import { usePolled } from "@/hooks/use-polled";
import { Skeleton } from "@/components/ui/skeleton";
import { trackedAppId, trackedGame, VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { SteamState, TracksGameEditor, WidgetCard } from "./shared";

/** A storefront card for one of your games: key art, review score, price. */
export type SteamGameWidget = {
  id: string;
  type: "steam-game";
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
};

function SteamGameBody({ widget, games, active, onOpen }: BarBodyProps<SteamGameWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = trackedAppId(widget.gameId, games);
  // Key art, reviews and price barely move; 5 minutes is plenty.
  const { data, error } = usePolled(
    () => ipc.steamStats(appid),
    [appid],
    300_000,
    !!appid && active,
    `game:${appid}`,
  );

  const positive = positivePct(data?.reviews);
  // The compact card has no separate release row, so fold "Coming soon" into
  // the price slot when there's no price yet.
  const price =
    priceLabel(data?.details) === MISSING && data?.details?.release_date?.coming_soon
      ? "Coming soon"
      : priceLabel(data?.details);

  return (
    <WidgetCard
      onClick={appid ? () => onOpen(`https://store.steampowered.com/app/${appid}`) : undefined}
      title={appid ? "Open the Steam store page" : undefined}
    >
      <SteamState
        game={game}
        appid={appid}
        data={data}
        error={error}
        noGame="Add your game on the dashboard to see its store card."
        skeleton={
          <>
            <Skeleton className="aspect-[460/215] w-full rounded-md" />
            <Skeleton className="h-3.5 w-32" />
          </>
        }
      >
        {(stats, tracked) => (
          <>
            {stats.details?.header_image && (
              <img
                src={stats.details.header_image}
                alt=""
                className="aspect-[460/215] w-full rounded-md bg-ink-800"
              />
            )}
            <div className="truncate text-[13px] font-semibold">
              {tracked.name || stats.details?.name || `App ${appid}`}
            </div>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate text-ink-400">
                {stats.reviews?.review_score_desc ?? "No reviews yet"}
                {positive !== null && ` · ${positive}%`}
              </span>
              <span className="flex-none font-semibold tabular-nums">{price}</span>
            </div>
          </>
        )}
      </SteamState>
    </WidgetCard>
  );
}

export default defineBarWidget<SteamGameWidget>({
  type: "steam-game",
  icon: Gamepad2,
  creator: VICTOR_CHANET,
  shop: {
    name: "Steam game",
    tagline: "Key art, review score and current price for your game.",
    description:
      "Your game's storefront at a glance: key art, review score and the " +
      "price it's selling at right now, one click from its Steam page. " +
      "Add one per game if you're juggling several.",
    category: "game",
    tags: ["steam", "store", "price", "reviews", "key art", "card"],
    facts: [
      { label: "Source", value: "Steam Web API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "Needs", value: "A game with a Steam App ID" },
    ],
    repeatable: true,
  },
  create: (base) => ({ ...base, type: "steam-game", gameId: null }),
  title: () => "Steam · Game",
  Body: SteamGameBody,
  Editor: TracksGameEditor,
  preview: { id: "preview-steam-game", type: "steam-game", gameId: null },
});
