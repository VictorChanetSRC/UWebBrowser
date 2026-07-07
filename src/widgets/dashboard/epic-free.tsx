import { Gift } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { shortDate, usd } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { CardLink, DataCard, FeedRow, RowSkeletons, TileHint } from "./shared";

/** Epic's giveaway rotation: free right now, and what's queued next. */
export type EpicFreeWidget = { id: string; type: "epicFree"; span: TileSpan };

function EpicFreeBody({ active, onOpen }: DashBodyProps<EpicFreeWidget>) {
  const { data: games, error } = usePolled(
    () => ipc.epicFreeGames(),
    [],
    1_800_000,
    active,
    "epic",
  );

  return (
    <DataCard
      label="Epic · Free games"
      error={!games && error ? `Epic didn't answer: ${error}` : null}
      loading={!games}
      skeleton={<RowSkeletons count={4} className="h-12" />}
      links={
        <CardLink onClick={() => onOpen("https://store.epicgames.com/en-US/free-games")}>
          All free games
        </CardLink>
      }
    >
      {games?.length === 0 && <TileHint>Nothing in the giveaway rotation right now.</TileHint>}
      {games && games.length > 0 && (
        <ul className="flex list-none flex-col">
          {games.slice(0, 6).map((game, index) => (
            <FeedRow
              key={`${game.url}-${index}`}
              index={index}
              onClick={() => onOpen(game.url)}
              className="items-center gap-3"
            >
              {game.image && (
                <img
                  src={game.image}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-[74px] flex-none rounded bg-ink-800 object-cover"
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-ink-200">
                  {game.title}
                </span>
                <span className="font-mono text-[11px] text-ink-500">
                  {game.status === "free"
                    ? `Free now${game.endDate ? ` · until ${shortDate(game.endDate)}` : ""}`
                    : game.startDate
                      ? `Free ${shortDate(game.startDate)}${
                          game.endDate ? ` – ${shortDate(game.endDate)}` : ""
                        }`
                      : "Coming up"}
                </span>
              </span>
              {game.originalPrice != null && game.originalPrice > 0 && (
                <span className="flex-none font-mono text-[11px] tabular-nums text-ink-500 line-through">
                  {usd(game.originalPrice)}
                </span>
              )}
            </FeedRow>
          ))}
        </ul>
      )}
    </DataCard>
  );
}

export default defineDashWidget<EpicFreeWidget>({
  type: "epicFree",
  icon: Gift,
  creator: VICTOR_CHANET,
  shop: {
    name: "Epic free games",
    tagline: "The giveaway rotation: free right now, and what's queued next.",
    description:
      "Epic's weekly giveaways, current and upcoming. Useful market intel — " +
      "and the occasional free game never hurt anyone.",
    category: "pulse",
    tags: ["epic", "free", "giveaway", "store"],
    facts: [
      { label: "Source", value: "Epic Games Store" },
      { label: "Refresh", value: "Every 30 min" },
      { label: "Tile", value: "1×2 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 1, r: 2 },
  create: (base) => ({ ...base, type: "epicFree" }),
  title: () => "Epic free games",
  Body: EpicFreeBody,
  preview: { id: "preview-epicfree", type: "epicFree", span: { c: 1, r: 2 } },
});
