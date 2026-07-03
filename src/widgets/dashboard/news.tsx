import { Newspaper } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { feedDate } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import { VICTOR_CHANET } from "../types";
import {
  defineDashWidget,
  type DashBodyProps,
  type DashConfigProps,
  type TileSpan,
} from "./define";
import {
  CardLink,
  ChipRow,
  ConfigStrip,
  DataCard,
  FeedRow,
  RowSkeletons,
  TileHint,
} from "./shared";

export type NewsSourceKey =
  | "unreal"
  | "gamedeveloper"
  | "gamesindustry"
  | "steamnews"
  | "eightylevel";

export type NewsSource = {
  label: string;
  feed: string;
  /** Where the header link goes; the feed itself is machine-only. */
  home: string;
};

export const NEWS_SOURCES: Record<NewsSourceKey, NewsSource> = {
  unreal: {
    label: "Unreal Engine",
    feed: "https://www.unrealengine.com/en-US/rss",
    home: "https://www.unrealengine.com/en-US/news",
  },
  gamedeveloper: {
    label: "Game Developer",
    feed: "https://www.gamedeveloper.com/rss.xml",
    home: "https://www.gamedeveloper.com",
  },
  gamesindustry: {
    label: "GamesIndustry.biz",
    feed: "https://www.gamesindustry.biz/feed",
    home: "https://www.gamesindustry.biz",
  },
  steamnews: {
    label: "Steam news",
    feed: "https://store.steampowered.com/feeds/news.xml",
    home: "https://store.steampowered.com/news/",
  },
  eightylevel: {
    label: "80 Level",
    feed: "https://80.lv/feed/",
    home: "https://80.lv",
  },
};

/** One RSS feed per tile; stack a few and skip the morning tab parade. */
export type NewsWidget = {
  id: string;
  type: "news";
  span: TileSpan;
  source: NewsSourceKey;
};

function NewsBody({ widget, active, onOpen }: DashBodyProps<NewsWidget>) {
  const source = NEWS_SOURCES[widget.source];
  const { data: items, error } = usePolled(
    () => ipc.fetchFeed(source.feed),
    [source.feed],
    900_000,
    active,
  );

  return (
    <DataCard
      label={source.label}
      error={!items && error ? `${source.label} didn't answer: ${error}` : null}
      loading={!items}
      skeleton={<RowSkeletons count={5} className="h-9" />}
      links={<CardLink onClick={() => onOpen(source.home)}>Open site</CardLink>}
    >
      {items?.length === 0 && <TileHint>The feed came back empty. It happens.</TileHint>}
      {items && items.length > 0 && (
        <ul className="flex list-none flex-col">
          {items.slice(0, 8).map((item, index) => (
            <FeedRow
              key={item.url}
              index={index}
              onClick={() => onOpen(item.url)}
              className="flex-col gap-1"
            >
              <span className="line-clamp-2 text-sm leading-[1.4] text-ink-200">
                {item.title}
              </span>
              {item.date !== null && (
                <span className="font-mono text-[11px] text-ink-500">{feedDate(item.date)}</span>
              )}
            </FeedRow>
          ))}
        </ul>
      )}
    </DataCard>
  );
}

function NewsConfig({ widget, onPatch }: DashConfigProps<NewsWidget>) {
  return (
    <ConfigStrip>
      <ChipRow
        label="Source"
        options={(Object.keys(NEWS_SOURCES) as NewsSourceKey[]).map((key) => ({
          key,
          label: NEWS_SOURCES[key].label,
        }))}
        selected={widget.source}
        onPick={(source) => onPatch({ source: source as NewsSourceKey })}
      />
    </ConfigStrip>
  );
}

export default defineDashWidget<NewsWidget>({
  type: "news",
  icon: Newspaper,
  creator: VICTOR_CHANET,
  shop: {
    name: "News feed",
    tagline: "Headlines from the outlets that matter to a working dev.",
    description:
      "One tile per source: Unreal Engine, Game Developer, GamesIndustry.biz, " +
      "Steam news or 80 Level. Stack a couple and the morning read takes care " +
      "of itself.",
    category: "pulse",
    tags: ["rss", "headlines", "press", "industry", "unreal", "80 level"],
    facts: [
      { label: "Source", value: "Official RSS feeds" },
      { label: "Refresh", value: "Every 15 min" },
      { label: "Tile", value: "1×2 to start · resize freely" },
    ],
    repeatable: true,
  },
  defaultSpan: { c: 1, r: 2 },
  create: (base) => ({ ...base, type: "news", source: "gamedeveloper" }),
  title: (widget) => NEWS_SOURCES[widget.source].label,
  Body: NewsBody,
  Config: NewsConfig,
  preview: {
    id: "preview-news",
    type: "news",
    span: { c: 1, r: 2 },
    source: "gamedeveloper",
  },
});
