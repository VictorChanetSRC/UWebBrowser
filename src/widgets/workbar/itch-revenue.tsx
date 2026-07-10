import { Wallet } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtCents, shortDate, sourceError } from "@/lib/format";
import { ITCH_NO_EARNINGS, ITCH_NO_KEY } from "@/lib/sales";
import { usePolled } from "@/hooks/use-polled";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { WidgetCard, WidgetHint } from "./shared";

/** itch.io earnings in the rail: today's take over the lifetime total. */
export type ItchRevenueWidget = { id: string; type: "itch-revenue" };

const POLL_MS = 300_000;

function ItchRevenueBody({ itchApiKey, active, onOpen }: BarBodyProps<ItchRevenueWidget>) {
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
      <WidgetCard>
        <WidgetHint>{ITCH_NO_KEY}</WidgetHint>
      </WidgetCard>
    );
  }
  if (!data && error) {
    return (
      <WidgetCard>
        <WidgetHint>{sourceError("itch.io", error)}</WidgetHint>
      </WidgetCard>
    );
  }
  if (!data) {
    return (
      <WidgetCard>
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-6 w-full rounded-[4px]" />
      </WidgetCard>
    );
  }

  const currency = data.currency;

  return (
    <WidgetCard onClick={() => onOpen("https://itch.io/dashboard")} title="Open itch.io dashboard">
      {!data.hasData ? (
        <WidgetHint>{ITCH_NO_EARNINGS}</WidgetHint>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
              {fmtCents(data.todayCents, currency)}
            </span>
            <Label size="micro">Today</Label>
          </div>

          {data.spark && data.spark.length > 1 && (
            <Sparkline
              values={data.spark}
              capacity={data.spark.length}
              max={Math.max(...data.spark, 1)}
              className="h-6"
            />
          )}

          <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-400">
            <span className="truncate">Lifetime</span>
            <span className="flex-none">{fmtCents(data.lifetimeCents, currency)}</span>
          </div>

          {data.trackingSince > 0 && (
            <div className="border-t border-border pt-2 text-[11px] text-ink-400">
              <span className="truncate">Measured since {shortDate(data.trackingSince)}</span>
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export default defineBarWidget<ItchRevenueWidget>({
  type: "itch-revenue",
  icon: Wallet,
  creator: VICTOR_CHANET,
  shop: {
    name: "itch.io revenue",
    tagline: "Today's earnings over the lifetime total.",
    description:
      "What came in on itch.io today, the last 30 days as a trace, and the " +
      "lifetime total under it. itch publishes no sales history, so the daily " +
      "figures are measured here by watching its running total move — the " +
      "trace begins the day you add your key.",
    category: "game",
    tags: ["itch", "indie", "revenue", "earnings", "money"],
    facts: [
      { label: "Source", value: "itch.io server API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "History", value: "Measured locally, from first sync" },
      { label: "Needs", value: "Your itch.io API key" },
    ],
    repeatable: false,
  },
  create: (base) => ({ ...base, type: "itch-revenue" }),
  title: () => "itch.io · Revenue",
  Body: ItchRevenueBody,
  preview: { id: "preview-itch-revenue", type: "itch-revenue" },
});
