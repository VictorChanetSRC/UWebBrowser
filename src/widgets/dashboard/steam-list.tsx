import { CalendarClock } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { sourceError, usd } from "@/lib/format";
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
  FeedList,
  FeedRow,
  RowSkeletons,
  TileHint,
} from "./shared";

export type SteamCategoryKey = "coming_soon" | "new_releases" | "top_sellers" | "specials";

export const STEAM_CATEGORIES: Record<SteamCategoryKey, { label: string; url: string }> = {
  coming_soon: { label: "Coming soon", url: "https://store.steampowered.com/explore/upcoming/" },
  new_releases: { label: "New releases", url: "https://store.steampowered.com/explore/new/" },
  top_sellers: { label: "Top sellers", url: "https://store.steampowered.com/search/?filter=topsellers" },
  specials: { label: "Specials", url: "https://store.steampowered.com/specials" },
};

/** One Steam storefront list per tile: what's coming, new, charting or on sale. */
export type SteamListWidget = {
  id: string;
  type: "steamList";
  span: TileSpan;
  category: SteamCategoryKey;
};

function SteamListBody({ widget, active, onOpen }: DashBodyProps<SteamListWidget>) {
  const category = STEAM_CATEGORIES[widget.category];
  const { data: items, error } = usePolled(
    () => ipc.steamFeatured(widget.category),
    [widget.category],
    1_800_000,
    active,
    `featured:${widget.category}`,
  );

  return (
    <DataCard
      label={`Steam · ${category.label}`}
      error={!items && error ? sourceError("Steam", error) : null}
      loading={!items}
      skeleton={<RowSkeletons count={5} className="h-10" />}
      links={<CardLink onClick={() => onOpen(category.url)}>Open Steam</CardLink>}
    >
      {items?.length === 0 && <TileHint>Steam sent back an empty list. It happens.</TileHint>}
      {/* Coming soon is about what a game looks like and when it lands, so
          those rows get the big key art; the other lists stay dense. */}
      {items && items.length > 0 && widget.category === "coming_soon" && (
        <FeedList>
          {items.slice(0, 8).map((item, index) => (
            <FeedRow
              key={`${item.appid}-${index}`}
              index={index}
              onClick={() => onOpen(`https://store.steampowered.com/app/${item.appid}`)}
              className="items-center gap-3.5"
            >
              <img
                src={item.largeImage || item.image}
                alt=""
                loading="lazy"
                className="aspect-[616/353] w-[132px] flex-none rounded-md bg-ink-800 object-cover"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 text-sm font-medium leading-[1.35] text-ink-100">
                  {item.name}
                </span>
                <span className="font-mono text-[11px] text-ink-500">
                  {item.release ?? "Date TBA"}
                </span>
              </span>
            </FeedRow>
          ))}
        </FeedList>
      )}
      {items && items.length > 0 && widget.category !== "coming_soon" && (
        <FeedList>
          {items.slice(0, 8).map((item, index) => (
            <FeedRow
              key={`${item.appid}-${index}`}
              index={index}
              onClick={() => onOpen(`https://store.steampowered.com/app/${item.appid}`)}
              className="items-center gap-3"
            >
              <img
                src={item.image}
                alt=""
                loading="lazy"
                className="aspect-[184/69] w-[74px] flex-none rounded bg-ink-800 object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
                {item.name}
              </span>
              <span className="flex-none font-mono text-[11px] tabular-nums text-ink-500">
                {item.discounted && item.discountPercent > 0 && (
                  <span className="text-ink-300">-{item.discountPercent}% · </span>
                )}
                {item.finalPrice ? usd(item.finalPrice) : ""}
              </span>
            </FeedRow>
          ))}
        </FeedList>
      )}
    </DataCard>
  );
}

function SteamListConfig({ widget, onPatch }: DashConfigProps<SteamListWidget>) {
  return (
    <ConfigStrip>
      <ChipRow
        label="List"
        options={(Object.keys(STEAM_CATEGORIES) as SteamCategoryKey[]).map((key) => ({
          key,
          label: STEAM_CATEGORIES[key].label,
        }))}
        selected={widget.category}
        onPick={(category) => onPatch({ category: category as SteamCategoryKey })}
      />
    </ConfigStrip>
  );
}

export default defineDashWidget<SteamListWidget>({
  type: "steamList",
  icon: CalendarClock,
  creator: VICTOR_CHANET,
  shop: {
    name: "Steam releases",
    tagline: "What's coming soon, newly out, topping the charts or on sale.",
    description:
      "The storefront pulse without opening the storefront. Pick the list on " +
      "the tile — coming soon, new releases, top sellers or specials — and see " +
      "where your next launch window sits.",
    category: "pulse",
    tags: ["steam", "releases", "charts", "sales", "market", "upcoming"],
    facts: [
      { label: "Source", value: "Steam storefront" },
      { label: "Refresh", value: "Every 30 min" },
      { label: "Tile", value: "1×2 to start · resize freely" },
    ],
    repeatable: true,
  },
  defaultSpan: { c: 1, r: 2 },
  create: (base) => ({ ...base, type: "steamList", category: "coming_soon" }),
  title: (widget) => `Steam · ${STEAM_CATEGORIES[widget.category].label}`,
  Body: SteamListBody,
  Config: SteamListConfig,
  preview: {
    id: "preview-steamlist",
    type: "steamList",
    span: { c: 1, r: 2 },
    category: "coming_soon",
  },
});
