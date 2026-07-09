import { Store } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtNumber, sourceError } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { RowSkeletons, WidgetCard, WidgetHint } from "./shared";

/** Account-wide itch.io totals, riding along in the rail. */
export type ItchWidget = { id: string; type: "itch" };

function ItchBody({ itchApiKey, active, onOpen }: BarBodyProps<ItchWidget>) {
  const key = itchApiKey.trim();
  // Aggregate counts move slowly; refresh every 5 minutes.
  const { data, error } = usePolled(
    () => ipc.itchGames(key),
    [key],
    300_000,
    !!key && active,
    `itch:${key}`,
  );

  if (!key) {
    return (
      <WidgetCard>
        <WidgetHint>Add your itch.io API key in the dashboard setup.</WidgetHint>
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
        <RowSkeletons count={3} className="h-4 rounded-md" />
      </WidgetCard>
    );
  }

  const totals = data.reduce(
    (acc, game) => ({
      views: acc.views + (game.views_count ?? 0),
      downloads: acc.downloads + (game.downloads_count ?? 0),
      purchases: acc.purchases + (game.purchases_count ?? 0),
    }),
    { views: 0, downloads: 0, purchases: 0 },
  );

  return (
    <WidgetCard onClick={() => onOpen("https://itch.io/dashboard")} title="Open itch.io dashboard">
      {data.length === 0 ? (
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
