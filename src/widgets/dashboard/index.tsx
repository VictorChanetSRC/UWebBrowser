import type { LucideIcon } from "lucide-react";
import type { Game } from "@/lib/config";
import type { ShopEntry } from "@/lib/widget-shop";
import type { DashBodyProps, DashConfigProps, DashWidgetSpec, TileSpan } from "./define";
import game, { type GameWidget } from "./game";
import build, { type BuildWidget } from "./build";
import buzz, { type BuzzWidget } from "./buzz";
import itch, { type ItchWidget } from "./itch";
import news, { type NewsWidget } from "./news";
import steamList, { type SteamListWidget } from "./steam-list";
import epicFree, { type EpicFreeWidget } from "./epic-free";
import workspace, { type WorkspaceWidget } from "./workspace";

/**
 * The home-board widget registry. A widget exists once someone (1) writes a
 * spec file next to this one, (2) adds its instance type to the union below,
 * and (3) adds the spec to the list. Everything else — the shop listing, the
 * tile body, icons, titles, config strips, previews — derives from here.
 * Full walkthrough: docs/WIDGETS.md.
 */

export type DashWidget =
  | GameWidget
  | BuildWidget
  | BuzzWidget
  | ItchWidget
  | NewsWidget
  | SteamListWidget
  | EpicFreeWidget
  | WorkspaceWidget;

export type DashWidgetType = DashWidget["type"];

/**
 * Ordered as they appear in the shop. Each spec is precisely typed in its own
 * file; the registry views them through the loose base shape — the dispatch
 * helpers below are the only places that cross that line.
 */
export const DASH_WIDGETS: readonly DashWidgetSpec<any>[] = [
  game,
  build,
  buzz,
  itch,
  news,
  steamList,
  epicFree,
  workspace,
];

export const DASH_SPECS = Object.fromEntries(
  DASH_WIDGETS.map((spec) => [spec.type, spec]),
) as Record<DashWidgetType, DashWidgetSpec<any>>;

/** Every registered type, for storage validation. */
export const DASH_WIDGET_TYPES = DASH_WIDGETS.map((spec) => spec.type) as DashWidgetType[];

export const DASH_ICONS: Record<DashWidgetType, LucideIcon> = Object.fromEntries(
  DASH_WIDGETS.map((spec) => [spec.type, spec.icon]),
) as Record<DashWidgetType, LucideIcon>;

/** The shop shelf: every widget's listing plus identity and credit. */
export const DASH_SHOP: ShopEntry<DashWidgetType>[] = DASH_WIDGETS.map((spec) => ({
  type: spec.type as DashWidgetType,
  creator: spec.creator,
  ...spec.shop,
}));

/** The footprint a widget is born with; every tile can be resized later. */
export function defaultTileSpan(type: DashWidgetType): TileSpan {
  return DASH_SPECS[type].defaultSpan;
}

/** A fresh instance of a widget, ready to drop on the board. */
export function newDashWidget(type: DashWidgetType): DashWidget {
  const spec = DASH_SPECS[type];
  return spec.create({ id: crypto.randomUUID(), span: spec.defaultSpan });
}

/** A stable instance for live previews; poll state survives re-renders. */
export function dashPreview(type: DashWidgetType): DashWidget {
  return DASH_SPECS[type].preview;
}

export function dashWidgetTitle(widget: DashWidget, games: Game[]): string {
  return DASH_SPECS[widget.type].title(widget, games);
}

/** The display body for any tile, dispatched off the widget's type. */
export function DashWidgetBody(props: DashBodyProps<DashWidget>) {
  const Body = DASH_SPECS[props.widget.type].Body;
  return <Body {...props} />;
}

/** A tile's Customize-mode settings strip, or nothing if it has none. */
export function DashWidgetConfig(props: DashConfigProps<DashWidget>) {
  const Config = DASH_SPECS[props.widget.type].Config;
  return Config ? <Config {...props} /> : null;
}

/* Convenience re-exports so surfaces and libs have one import point. */
export {
  cycleSpan,
  MAX_SPAN,
  SPAN_PRESETS,
  spanLabel,
  type DashBodyProps,
  type DashConfigProps,
  type DashWidgetSpec,
  type TileSpan,
} from "./define";
export { Stat, StatGrid } from "./shared";
