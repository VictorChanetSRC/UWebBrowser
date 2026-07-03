import { Activity } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtNumber } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps, type BarEditorProps } from "./define";
import { WidgetCard, WidgetHint } from "./shared";

/** A pocket ticker: live players and review score for one of your games. */
export type SteamWidget = {
  id: string;
  type: "steam";
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
};

function SteamBody({ widget, games, active, onOpen }: BarBodyProps<SteamWidget>) {
  const game = games.find((g) => g.id === widget.gameId) ?? games[0] ?? null;
  const appid = game?.steamAppId?.trim() ?? "";
  const { data, error } = usePolled(() => ipc.steamStats(appid), [appid], 60_000, !!appid && active);

  const positive =
    data?.reviews?.total_reviews && data.reviews.total_positive !== undefined
      ? Math.round((data.reviews.total_positive / data.reviews.total_reviews) * 100)
      : null;

  return (
    <WidgetCard
      onClick={appid ? () => onOpen(`https://steamdb.info/app/${appid}/charts/`) : undefined}
      title={appid ? "Open SteamDB charts" : undefined}
    >
      {!game ? (
        <WidgetHint>Add your game on the dashboard to track live players.</WidgetHint>
      ) : !appid ? (
        <WidgetHint>{game.name || "This game"} has no Steam App ID yet.</WidgetHint>
      ) : !data && !error ? (
        <>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3.5 w-32" />
        </>
      ) : !data ? (
        <WidgetHint>Steam didn't answer. Retrying shortly.</WidgetHint>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="text-[24px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
              {fmtNumber(data.players)}
            </span>
            <Label className="text-[10px]">Playing now</Label>
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-400">
            {game.name || data.details?.name || `App ${appid}`}
            {positive !== null && ` · ${positive}% positive`}
          </div>
        </>
      )}
    </WidgetCard>
  );
}

/** Pick which game the ticker follows; hidden until there's a real choice. */
function SteamEditor({ widget, games, onPatch }: BarEditorProps<SteamWidget>) {
  if (games.length < 2) return null;
  const selected = games.find((g) => g.id === widget.gameId) ?? games[0] ?? null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border p-2.5 pl-3.5">
      <Label className="mr-1 text-[10px]">Tracks</Label>
      {games.map((game) => (
        <Button
          key={game.id}
          variant="chip"
          size="chip"
          className="h-[24px] px-2.5 text-[11px]"
          aria-pressed={game.id === selected?.id}
          onClick={() => onPatch({ gameId: game.id })}
        >
          {game.name || "Untitled"}
        </Button>
      ))}
    </div>
  );
}

export default defineBarWidget<SteamWidget>({
  type: "steam",
  icon: Activity,
  creator: VICTOR_CHANET,
  shop: {
    name: "Steam players",
    tagline: "Live player count and review score for your game.",
    description:
      "A pocket ticker for your game: live players and review score in the " +
      "corner of your eye while you browse. Add one per game if you're " +
      "juggling several.",
    category: "game",
    tags: ["steam", "players", "reviews", "live", "ticker"],
    facts: [
      { label: "Source", value: "Steam Web API" },
      { label: "Refresh", value: "Every 60 s" },
      { label: "Needs", value: "A game with a Steam App ID" },
    ],
    repeatable: true,
  },
  create: (base) => ({ ...base, type: "steam", gameId: null }),
  title: () => "Steam · Live",
  Body: SteamBody,
  Editor: SteamEditor,
  preview: { id: "preview-steam", type: "steam", gameId: null },
});
