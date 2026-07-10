import { PiggyBank } from "lucide-react";
import { fmtCents, shortDate } from "@/lib/format";
import { ITCH_CAVEAT, ITCH_NO_EARNINGS, ITCH_NO_KEY, otherCurrencies } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { SparkTrace } from "@/components/ui/sparkline";
import { useItchEarnings } from "../data";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { CardLink, DataCard, Stat, StatGrid, StatGridSkeleton, TileHint } from "./shared";

/** What your itch.io account has earned — lifetime from itch, days from us. */
export type ItchRevenueWidget = {
  id: string;
  type: "itch-revenue";
  span: TileSpan;
};

function ItchRevenueBody({ itchApiKey, active, onOpen, onEditSetup }: DashBodyProps<ItchRevenueWidget>) {
  const key = itchApiKey.trim();
  const { data, error } = useItchEarnings(itchApiKey, active);

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
      source="itch.io"
      error={error}
      loading={!data}
      skeleton={<StatGridSkeleton count={4} />}
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

          {data.spark && <SparkTrace values={data.spark} className="h-10" />}

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
