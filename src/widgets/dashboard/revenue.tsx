import { Banknote } from "lucide-react";
import { fmtChange, fmtDay, fmtNumber, fmtUsd, MISSING } from "@/lib/format";
import {
  DEFAULT_SHARE_PCT,
  NO_SALES_YET,
  NOT_CONNECTED,
  SALES_CAVEAT,
  share,
  shareLabel,
} from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { SparkTrace } from "@/components/ui/sparkline";
import { useSteamSales } from "../data";
import { ShareChips, TracksGameChips } from "../shared";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type DashConfigProps, type TileSpan } from "./define";
import {
  CardLink,
  ConfigStrip,
  DataCard,
  Stat,
  StatGrid,
  StatGridSkeleton,
  TileHint,
  trackedAppId,
  trackedGame,
} from "./shared";

/** What one of your games earned, from the Steamworks financial API. */
export type RevenueWidget = {
  id: string;
  type: "revenue";
  span: TileSpan;
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
  /** Your cut of net sales; see DEFAULT_SHARE_PCT for why this is a setting. */
  sharePct: number;
};

function RevenueBody({ widget, games, active, onOpen, onEditSetup }: DashBodyProps<RevenueWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = trackedAppId(widget.gameId, games);
  const { data, error } = useSteamSales(appid, active);

  if (!game) {
    return (
      <DataCard label="Revenue">
        <TileHint>No game on file yet. Set one up and its sales land here.</TileHint>
        <div>
          <Button onClick={onEditSetup}>Open setup</Button>
        </div>
      </DataCard>
    );
  }
  if (!appid) {
    return (
      <DataCard label="Revenue">
        <TileHint>
          {game.name || "This game"} has no Steam App ID. Sales are keyed on it.
        </TileHint>
      </DataCard>
    );
  }

  const pct = widget.sharePct;
  const mine = (netUsd: number | undefined) => fmtUsd(share(netUsd ?? 0, pct));

  return (
    <DataCard
      label={`Revenue · ${shareLabel(pct)}`}
      source="Steamworks"
      error={error}
      loading={!data}
      skeleton={<StatGridSkeleton count={6} />}
      links={
        data?.connected ? (
          <CardLink onClick={() => onOpen("https://partner.steampowered.com/")}>
            Steamworks
          </CardLink>
        ) : undefined
      }
    >
      {data && !data.connected && (
        <>
          <TileHint>{NOT_CONNECTED}</TileHint>
          <div>
            <Button onClick={onEditSetup}>Connect Steamworks</Button>
          </div>
        </>
      )}

      {data?.connected && !data.hasData && <TileHint>{NO_SALES_YET}</TileHint>}

      {data?.connected && data.hasData && data.latest && (
        <>
          <StatGrid>
            <Stat label={`Latest day · ${fmtDay(data.latest.date)}`} value={mine(data.latest.netUsd)} />
            <Stat
              label="Day over day"
              value={
                data.previous ? fmtChange(data.latest.netUsd, data.previous.netUsd) : MISSING
              }
            />
            <Stat label="Last 7 days" value={mine(data.last7?.netUsd)} />
            <Stat label="Last 30 days" value={mine(data.last30?.netUsd)} />
            <Stat label="Month to date" value={mine(data.monthToDate?.netUsd)} />
            <Stat
              label="Top country · 30 d"
              value={data.topCountry ? data.topCountry.code : MISSING}
            />
          </StatGrid>

          {data.spark && (
            <SparkTrace
              values={data.spark.map((netUsd) => share(netUsd, pct))}
              className="h-10"
            />
          )}

          <p className="text-[12.5px] leading-[1.5] text-ink-500">
            {fmtNumber(data.last30?.units)} units in 30 days. {SALES_CAVEAT}
          </p>
        </>
      )}
    </DataCard>
  );
}

/** Which game, and which slice of it is yours. */
function RevenueConfig({ widget, games, onPatch }: DashConfigProps<RevenueWidget>) {
  return (
    <ConfigStrip>
      <TracksGameChips widget={widget} games={games} onPatch={onPatch} />
      <ShareChips
        value={widget.sharePct}
        onPick={(sharePct) => onPatch({ sharePct })}
        className={games.length > 1 ? "border-t border-border" : undefined}
      />
    </ConfigStrip>
  );
}

export default defineDashWidget<RevenueWidget>({
  type: "revenue",
  icon: Banknote,
  creator: VICTOR_CHANET,
  shop: {
    name: "Revenue",
    tagline: "What your game earned yesterday, this week, this month.",
    description:
      "Your real Steam sales, pulled straight from the Steamworks financial " +
      "API with your publisher key: the latest settled day, the last 7 and 30, " +
      "and the month so far, scaled to your revenue split. Steam reports one " +
      "day at a time in Pacific time, so this is never a live ticker — and it " +
      "never pretends to be.",
    category: "game",
    tags: ["steam", "steamworks", "revenue", "sales", "money", "units", "finance"],
    facts: [
      { label: "Source", value: "Steamworks partner API" },
      { label: "Refresh", value: "Daily · synced every 30 min" },
      { label: "Needs", value: "A publisher key with Sales Data" },
      { label: "Tile", value: "2×2 to start · resize freely" },
    ],
    repeatable: true,
  },
  defaultSpan: { c: 2, r: 2 },
  create: (base) => ({ ...base, type: "revenue", gameId: null, sharePct: DEFAULT_SHARE_PCT }),
  title: (widget, games) =>
    `Revenue · ${trackedGame(widget.gameId, games)?.name || "your game"}`,
  Body: RevenueBody,
  Config: RevenueConfig,
  preview: {
    id: "preview-revenue",
    type: "revenue",
    span: { c: 2, r: 2 },
    gameId: null,
    sharePct: DEFAULT_SHARE_PCT,
  },
});
