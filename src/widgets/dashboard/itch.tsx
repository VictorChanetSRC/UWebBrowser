import { Store } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtNumber } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import { CardLink, DataCard, RowSkeletons, TileHint } from "./shared";

/** Per-game itch.io numbers for every project on the account. */
export type ItchWidget = { id: string; type: "itch"; span: TileSpan };

function ItchBody({ itchApiKey, active, onOpen }: DashBodyProps<ItchWidget>) {
  const key = itchApiKey.trim();
  const { data: games, error } = usePolled(
    () => ipc.itchGames(key),
    [key],
    300_000,
    !!key && active,
    `itch:${key}`,
  );
  const numeric = "font-mono text-[12.5px] tabular-nums text-ink-300";

  return (
    <DataCard
      label="itch.io"
      error={!!key && !games && error ? `itch.io didn't answer: ${error}` : null}
      loading={!!key && !games}
      skeleton={<RowSkeletons />}
      links={<CardLink onClick={() => onOpen("https://itch.io/dashboard")}>Dashboard</CardLink>}
    >
      {!key && <TileHint>Add your itch.io API key in setup to see your numbers.</TileHint>}
      {games?.length === 0 && <TileHint>No games on this account yet.</TileHint>}
      {games && games.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game</TableHead>
              <TableHead>Views</TableHead>
              <TableHead>Downloads</TableHead>
              <TableHead>Purchases</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {games.map((game) => (
              <TableRow
                key={game.url}
                className="cursor-pointer [&:hover_td]:bg-ink-800"
                onClick={() => onOpen(game.url)}
              >
                <TableCell>{game.title}</TableCell>
                <TableCell className={numeric}>{fmtNumber(game.views_count)}</TableCell>
                <TableCell className={numeric}>{fmtNumber(game.downloads_count)}</TableCell>
                <TableCell className={numeric}>{fmtNumber(game.purchases_count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DataCard>
  );
}

export default defineDashWidget<ItchWidget>({
  type: "itch",
  icon: Store,
  creator: VICTOR_CHANET,
  shop: {
    name: "itch.io stats",
    tagline: "Views, downloads and purchases across your itch.io games.",
    description:
      "Your itch.io dashboard, condensed: views, downloads and purchases " +
      "across every project on the account, without opening a single " +
      "analytics page.",
    category: "game",
    tags: ["itch", "indie", "downloads", "sales", "analytics"],
    facts: [
      { label: "Source", value: "itch.io server API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "Needs", value: "Your itch.io API key" },
      { label: "Tile", value: "2×1 to start · resize freely" },
    ],
    repeatable: false,
  },
  defaultSpan: { c: 2, r: 1 },
  create: (base) => ({ ...base, type: "itch" }),
  title: () => "itch.io",
  Body: ItchBody,
  preview: { id: "preview-itch", type: "itch", span: { c: 2, r: 1 } },
});
