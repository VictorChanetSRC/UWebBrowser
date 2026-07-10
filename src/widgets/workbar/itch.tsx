import { Store } from "lucide-react";
import { fmtNumber } from "@/lib/format";
import { useItchGames } from "../data";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { KeyedState, RowSkeletons, WidgetCard, WidgetHint } from "./shared";

/** Account-wide itch.io totals, riding along in the rail. */
export type ItchWidget = { id: string; type: "itch" };

function ItchBody({ itchApiKey, active, onOpen }: BarBodyProps<ItchWidget>) {
  const { data, error } = useItchGames(itchApiKey, active);

  return (
    <KeyedState
      hasKey={!!itchApiKey.trim()}
      // Not ITCH_NO_KEY: that one talks about earnings, and this widget shows
      // views, downloads and purchases.
      noKey="Add your itch.io API key in the dashboard setup."
      source="itch.io"
      data={data}
      error={error}
      skeleton={<RowSkeletons count={3} className="h-4 rounded-md" />}
    >
      {(games) => {
        const totals = games.reduce(
          (acc, game) => ({
            views: acc.views + (game.views_count ?? 0),
            downloads: acc.downloads + (game.downloads_count ?? 0),
            purchases: acc.purchases + (game.purchases_count ?? 0),
          }),
          { views: 0, downloads: 0, purchases: 0 },
        );
        return (
          <WidgetCard
            onClick={() => onOpen("https://itch.io/dashboard")}
            title="Open itch.io dashboard"
          >
            {games.length === 0 ? (
              <WidgetHint>No games on this account yet.</WidgetHint>
            ) : (
              <>
                <ItchRow name="Views" value={totals.views} />
                <ItchRow name="Downloads" value={totals.downloads} />
                <ItchRow name="Purchases" value={totals.purchases} />
              </>
            )}
          </WidgetCard>
        );
      }}
    </KeyedState>
  );
}

function ItchRow({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11.5px] text-ink-300">{name}</span>
      <span className="font-mono text-[11px] tabular-nums text-ink-400">{fmtNumber(value)}</span>
    </div>
  );
}

export default defineBarWidget<ItchWidget>({
  type: "itch",
  icon: Store,
  creator: VICTOR_CHANET,
  shop: {
    name: "itch.io stats",
    tagline: "Views, downloads and purchases across your itch.io games.",
    description:
      "Your itch.io dashboard, condensed: views, downloads and purchases " +
      "across every project on the account, riding along in the rail.",
    category: "game",
    tags: ["itch", "indie", "downloads", "sales", "analytics"],
    facts: [
      { label: "Source", value: "itch.io server API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "Needs", value: "Your itch.io API key" },
    ],
    repeatable: false,
  },
  create: (base) => ({ ...base, type: "itch" }),
  title: () => "itch.io",
  Body: ItchBody,
  preview: { id: "preview-itch", type: "itch" },
});
