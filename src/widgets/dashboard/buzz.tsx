import { MessagesSquare } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { watchLinks } from "@/lib/engines";
import { ago } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { Button } from "@/components/ui/button";
import { VICTOR_CHANET } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import {
  CardLink,
  DataCard,
  FeedList,
  FeedRow,
  RowSkeletons,
  TileHint,
  TracksGameConfig,
  trackedGame,
} from "./shared";

/** Fresh Reddit posts naming your game, plus watch links for the socials. */
export type BuzzWidget = {
  id: string;
  type: "buzz";
  span: TileSpan;
  /** Which setup game to listen for; null falls back to the first game. */
  gameId: string | null;
};

function BuzzBody({ widget, games, active, onOpen }: DashBodyProps<BuzzWidget>) {
  const game = trackedGame(widget.gameId, games);
  const name = game?.name?.trim() ?? "";
  const { data: posts, error } = usePolled(
    () => ipc.redditSearch(`"${name}"`),
    [name],
    300_000,
    !!name && active,
    `buzz:${name}`,
  );

  return (
    <DataCard
      label="Community buzz"
      source="Reddit"
      error={error}
      loading={!!name && !posts}
      skeleton={<RowSkeletons count={4} />}
      links={
        name ? (
          <CardLink
            onClick={() => onOpen(`https://www.reddit.com/search/?q=${encodeURIComponent(name)}`)}
          >
            Open search
          </CardLink>
        ) : undefined
      }
    >
      {!name ? (
        <TileHint>Name your game in setup to track the chatter.</TileHint>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {watchLinks(name).map((link) => (
              <Button key={link.name} size="sm" onClick={() => onOpen(link.url)}>
                {link.name}
              </Button>
            ))}
          </div>
          {posts?.length === 0 && (
            <TileHint>No recent posts mention "{name}". Time to make noise.</TileHint>
          )}
          {posts && posts.length > 0 && (
            <FeedList>
              {posts.slice(0, 6).map((post, index) => (
                <FeedRow
                  key={post.url}
                  index={index}
                  onClick={() => onOpen(post.url)}
                  className="flex-col gap-1"
                >
                  <span className="font-mono text-[11px] text-ink-500">
                    {post.subreddit ?? "reddit"}
                    {post.createdUtc !== null && ` · ${ago(post.createdUtc)}`}
                  </span>
                  <span className="text-sm leading-[1.4] text-ink-200">{post.title}</span>
                </FeedRow>
              ))}
            </FeedList>
          )}
        </>
      )}
    </DataCard>
  );
}

export default defineDashWidget<BuzzWidget>({
  type: "buzz",
  icon: MessagesSquare,
  creator: VICTOR_CHANET,
  shop: {
    name: "Community buzz",
    tagline: "Fresh Reddit posts naming your game, plus watch links for the socials.",
    description:
      "Reddit posts that mention your game by name, caught while the thread is " +
      "still warm. Watch links for the rest of the socials ride along " +
      "underneath.",
    category: "game",
    tags: ["reddit", "social", "mentions", "community", "posts"],
    facts: [
      { label: "Source", value: "Reddit search" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "Needs", value: "A game name on your setup" },
      { label: "Tile", value: "1×2 to start · resize freely" },
    ],
    repeatable: true,
  },
  defaultSpan: { c: 1, r: 2 },
  create: (base) => ({ ...base, type: "buzz", gameId: null }),
  title: () => "Community buzz",
  Body: BuzzBody,
  Config: TracksGameConfig,
  preview: { id: "preview-buzz", type: "buzz", span: { c: 1, r: 2 }, gameId: null },
});
