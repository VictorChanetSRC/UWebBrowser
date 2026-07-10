import { Coins } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtChange, fmtDay, fmtNumber, fmtUsd } from "@/lib/format";
import {
  DEFAULT_SHARE_PCT,
  NO_SALES_YET,
  NOT_CONNECTED,
  SHARE_OPTIONS,
  share,
} from "@/lib/sales";
import { usePolled } from "@/hooks/use-polled";
import { Label } from "@/components/ui/label";
import { LiveDot } from "@/components/ui/live-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { TracksGameChips } from "../shared";
import { trackedAppId, trackedGame, VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps, type BarEditorProps } from "./define";
import { ChipRow, SteamState, WidgetCard, WidgetHint } from "./shared";

/**
 * Yesterday's takings in the rail, next to the one number about your game that
 * *is* live. Steam has no realtime revenue feed, so pairing the settled day
 * with the live player count is the honest way to give this widget a pulse.
 */
export type RevenueWidget = {
  id: string;
  type: "revenue";
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
  /** Your cut of net sales; see DEFAULT_SHARE_PCT for why this is a setting. */
  sharePct: number;
};

const SALES_POLL_MS = 300_000;
const PLAYERS_POLL_MS = 30_000;

function RevenueBody({ widget, games, active, onOpen }: BarBodyProps<RevenueWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = trackedAppId(widget.gameId, games);

  const { data, error } = usePolled(
    () => ipc.steamSalesSummary(appid),
    [appid],
    SALES_POLL_MS,
    !!appid && active,
    `sales:${appid}`,
  );
  // Shares its inflight call and TTL cache with the Steam players widget, so a
  // rail carrying both still hits Steam once per tick.
  const { data: players } = usePolled(
    () => ipc.steamPlayers(appid),
    [appid],
    PLAYERS_POLL_MS,
    !!appid && active,
    `players:${appid}`,
  );

  const pct = widget.sharePct;

  return (
    <WidgetCard
      onClick={() => onOpen("https://partner.steampowered.com/")}
      title="Open Steamworks"
    >
      <SteamState
        game={game}
        appid={appid}
        data={data}
        error={error}
        noGame="Add your game on the dashboard to track revenue."
        skeleton={
          <>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-6 w-full rounded-[4px]" />
          </>
        }
      >
        {(sales) => {
          if (!sales.connected) return <WidgetHint>{NOT_CONNECTED}</WidgetHint>;
          if (!sales.hasData || !sales.latest) return <WidgetHint>{NO_SALES_YET}</WidgetHint>;

          return (
            <>
              <div className="flex flex-col gap-0.5">
                <span className="text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                  {fmtUsd(share(sales.latest.netUsd, pct))}
                </span>
                <Label size="micro">{fmtDay(sales.latest.date)} · {pct}% share</Label>
              </div>

              {sales.spark && sales.spark.length > 1 && (
                <Sparkline
                  values={sales.spark}
                  capacity={sales.spark.length}
                  max={Math.max(...sales.spark, 1)}
                  className="h-6"
                />
              )}

              <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-400">
                <span className="truncate">
                  {sales.previous
                    ? `${fmtChange(sales.latest.netUsd, sales.previous.netUsd)} vs. day before`
                    : "30 days"}
                </span>
                <span className="flex-none">{fmtUsd(share(sales.last30?.netUsd ?? 0, pct))}</span>
              </div>

              {players !== null && players !== undefined && (
                <div className="flex items-center gap-2 border-t border-border pt-2 text-[11px] text-ink-400">
                  <LiveDot />
                  <span className="truncate">{fmtNumber(players)} playing now</span>
                </div>
              )}
            </>
          );
        }}
      </SteamState>
    </WidgetCard>
  );
}

/** Which game, and which slice of it is yours. */
function RevenueEditor({ widget, games, onPatch }: BarEditorProps<RevenueWidget>) {
  return (
    <div className="border-t border-border">
      <TracksGameChips widget={widget} games={games} onPatch={onPatch} className="p-2.5 pl-3.5" />
      <ChipRow
        label="Your cut"
        className={games.length > 1 ? "border-t border-border p-2.5 pl-3.5" : "p-2.5 pl-3.5"}
        options={SHARE_OPTIONS.map((pct) => ({ key: String(pct), label: `${pct}%` }))}
        selected={String(widget.sharePct)}
        onPick={(pct) => onPatch({ sharePct: Number(pct) })}
      />
    </div>
  );
}

export default defineBarWidget<RevenueWidget>({
  type: "revenue",
  icon: Coins,
  creator: VICTOR_CHANET,
  shop: {
    name: "Steam revenue",
    tagline: "Yesterday's takings, and who's playing right now.",
    description:
      "Your real Steam sales in the rail: the latest settled day scaled to " +
      "your revenue split, its change on the day before, and the last 30 days " +
      "as a trace. Under it, the live player count — because Steam settles " +
      "money daily, and this is the one number that moves in realtime.",
    category: "game",
    tags: ["steam", "steamworks", "revenue", "sales", "money", "players"],
    facts: [
      { label: "Source", value: "Steamworks partner API" },
      { label: "Refresh", value: "Daily · players every 30 s" },
      { label: "Needs", value: "A publisher key with Sales Data" },
    ],
    repeatable: true,
  },
  create: (base) => ({ ...base, type: "revenue", gameId: null, sharePct: DEFAULT_SHARE_PCT }),
  title: () => "Steam · Revenue",
  Body: RevenueBody,
  Editor: RevenueEditor,
  preview: { id: "preview-revenue", type: "revenue", gameId: null, sharePct: DEFAULT_SHARE_PCT },
});
