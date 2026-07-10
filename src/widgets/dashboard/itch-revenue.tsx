import { PiggyBank } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtCents, shortDate, sourceError } from "@/lib/format";
import { ITCH_CAVEAT, ITCH_NO_EARNINGS, ITCH_NO_KEY, otherCurrencies } from "@/lib/sales";
import { usePolled } from "@/hooks/use-polled";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { CardLink, DataCard, Stat, StatGrid, TileHint } from "./shared";

/** What your itch.io account has earned — lifetime from itch, days from us. */
export type ItchRevenueWidget = {
  id: string;
  type: "itch-revenue";
  span: TileSpan;
};

/** Matches the backend's 5-minute cache: every real fetch is also the snapshot
 *  that advances the ledger, so polling faster buys nothing but traffic. */
const POLL_MS = 300_000;

function ItchRevenueBody({ itchApiKey, active, onOpen, onEditSetup }: DashBodyProps<ItchRevenueWidget>) {
  const key = itchApiKey.trim();
  const { data, error } = usePolled(
    () => ipc.itchEarnings(key),
    [key],
    POLL_MS,
    !!key && active,
    `itch-earnings:${key}`,
  );

  if (!key) {
    return (
      <DataCard label="itch.io revenue">
        <TileHint>{ITCH_NO_KEY}</TileHint>
        <div>
          <Button onClick={onEditSetup}>Open setup</Button>
        </div>
      </DataCard>
    );
  }

  const currency = data?.currency;
  const others = data ? otherCurrencies(data.currencies) : null;

  return (
    <DataCard
      label="itch.io revenue"
      error={!data && error ? sourceError("itch.io", error) : null}
      loading={!data}
      skeleton={
        <StatGrid>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[78px]" />
          ))}
        </StatGrid>
      }
      links={
        <CardLink onClick={() => onOpen("https://itch.io/dashboard")}>Dashboard</CardLink>
      }
    >
      {data && !data.hasData && <TileHint>{ITCH_NO_EARNINGS}</TileHint>}

      {data?.hasData && (
        <>
          <StatGrid>
            <Stat label="Lifetime" value={fmtCents(data.lifetimeCents, currency)} />
            <Stat label="Today" value={fmtCents(data.todayCents, currency)} />
            <Stat label="Last 7 days" value={fmtCents(data.last7Cents, currency)} />
            <Stat label="Last 30 days" value={fmtCents(data.last30Cents, currency)} />
          </StatGrid>

          {data.spark && data.spark.length > 1 && (
            <Sparkline
              values={data.spark}
              capacity={data.spark.length}
              // Fixed 0..max: a day with no sales should sit on the floor, not
              // be rescaled into looking like one.
              max={Math.max(...data.spark, 1)}
              className="h-10"
            />
          )}

          <p className="text-[12.5px] leading-[1.5] text-ink-500">
            {ITCH_CAVEAT}{" "}
            {data.trackingSince
              ? `Tracking since ${shortDate(data.trackingSince)}.`
              : "Tracking starts with the first sync."}{" "}
            {others}
          </p>
        </>
      )}
    </DataCard>
  );
}

export default defineDashWidget<ItchRevenueWidget>({
  type: "itch-revenue",
  icon: PiggyBank,
  creator: VICTOR_CHANET,
  shop: {
    name: "itch.io revenue",
    tagline: "Lifetime earnings, and what came in today.",
    description:
      "What your itch.io account has earned, across every project on it. The " +
      "lifetime total comes from itch; itch publishes no history, so the daily " +
      "and weekly figures are measured here by watching that total move. The " +
      "chart therefore starts the day you add your key, and can't be backfilled.",
    category: "game",
    tags: ["itch", "indie", "revenue", "earnings", "sales", "money"],
    facts: [
      { label: "Source", value: "itch.io server API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "History", value: "Measured locally, from first sync" },
      { label: "Needs", value: "Your itch.io API key" },
      { label: "Tile", value: "2×1 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 2, r: 1 },
  create: (base) => ({ ...base, type: "itch-revenue" }),
  title: () => "itch.io revenue",
  Body: ItchRevenueBody,
  preview: { id: "preview-itch-revenue", type: "itch-revenue", span: { c: 2, r: 1 } },
});
