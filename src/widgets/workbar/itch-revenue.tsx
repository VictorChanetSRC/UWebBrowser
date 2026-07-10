import { Wallet } from "lucide-react";
import { fmtCents, shortDate } from "@/lib/format";
import { ITCH_NO_EARNINGS, ITCH_NO_KEY } from "@/lib/sales";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SparkTrace } from "@/components/ui/sparkline";
import { useItchEarnings } from "../data";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { KeyedState, WidgetCard, WidgetHint } from "./shared";

/** itch.io earnings in the rail: today's take over the lifetime total. */
export type ItchRevenueWidget = { id: string; type: "itch-revenue" };

function ItchRevenueBody({ itchApiKey, active, onOpen }: BarBodyProps<ItchRevenueWidget>) {
  const { data, error } = useItchEarnings(itchApiKey, active);

  return (
    <KeyedState
      hasKey={!!itchApiKey.trim()}
      noKey={ITCH_NO_KEY}
      source="itch.io"
      data={data}
      error={error}
      skeleton={
        <>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-6 w-full rounded-[4px]" />
        </>
      }
    >
      {(earnings) => (
        <WidgetCard
          onClick={() => onOpen("https://itch.io/dashboard")}
          title="Open itch.io dashboard"
        >
          {!earnings.hasData ? (
            <WidgetHint>{ITCH_NO_EARNINGS}</WidgetHint>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                <span className="text-[22px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
                  {fmtCents(earnings.todayCents, earnings.currency)}
                </span>
                <Label size="micro">Today</Label>
              </div>

              {earnings.spark && <SparkTrace values={earnings.spark} className="h-6" />}

              <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-400">
                <span className="truncate">Lifetime</span>
                <span className="flex-none">
                  {fmtCents(earnings.lifetimeCents, earnings.currency)}
                </span>
              </div>

              {earnings.trackingSince > 0 && (
                <div className="border-t border-border pt-2 text-[11px] text-ink-400">
                  <span className="truncate">
                    Measured since {shortDate(earnings.trackingSince)}
                  </span>
                </div>
              )}
            </>
          )}
        </WidgetCard>
      )}
    </KeyedState>
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
