import { createWidgetRegistry } from "../registry";
import type { BarBodyProps, BarEditorProps, BarWidgetSpec } from "./define";
import steamGame, { type SteamGameWidget } from "./steam-game";
import steamPlayers, { type SteamPlayersWidget } from "./steam-players";
import build, { type BuildWidget } from "./build";
import system, { type SystemWidget } from "./system";
import itch, { type ItchWidget } from "./itch";
import links, { type LinksWidget } from "./links";

/**
 * The work bar widget registry. A widget exists once someone (1) writes a
 * spec file next to this one, (2) adds its instance type to the union below,
 * and (3) adds the spec to the list. Everything else — the shop listing, the
 * rail body, icons, titles, row editors, previews — derives from here.
 * Full walkthrough: docs/WIDGETS.md.
 */

export type Widget =
  | LinksWidget
  | SteamGameWidget
  | SteamPlayersWidget
  | BuildWidget
  | SystemWidget
  | ItchWidget;

export type WidgetType = Widget["type"];

/**
 * Ordered as they appear in the shop. Each spec is precisely typed in its own
 * file; the registry views them through the loose base shape — the dispatch
 * helpers below are the only places that cross that line.
 */
export const BAR_WIDGETS: readonly BarWidgetSpec<any>[] = [
  steamGame,
  steamPlayers,
  build,
  itch,
  system,
  links,
];

const registry = createWidgetRegistry<WidgetType, BarWidgetSpec<any>>(BAR_WIDGETS);

export const BAR_SPECS = registry.specs;
/** Every registered type, for storage validation. */
export const BAR_WIDGET_TYPES = registry.types;
export const BAR_ICONS = registry.icons;
/** The shop shelf: every widget's listing plus identity and credit. */
export const BAR_SHOP = registry.shop;

/** A fresh instance of a widget, ready to drop on the bar. */
export function newBarWidget(type: WidgetType): Widget {
  return BAR_SPECS[type].create({ id: crypto.randomUUID() });
}

/** A stable instance for live previews; poll state survives re-renders. */
export function barPreview(type: WidgetType): Widget {
  return BAR_SPECS[type].preview;
}

export function barWidgetTitle(widget: Widget): string {
  return BAR_SPECS[widget.type].title(widget);
}

/** The display body for any rail widget, dispatched off the widget's type. */
export function BarWidgetBody(props: BarBodyProps<Widget>) {
  const Body = BAR_SPECS[props.widget.type].Body;
  return <Body {...props} />;
}

/** A widget's row editor on the work bar page, or nothing if it has none. */
export function BarWidgetEditor(props: BarEditorProps<Widget>) {
  const Editor = BAR_SPECS[props.widget.type].Editor;
  return Editor ? <Editor {...props} /> : null;
}

/* Convenience re-exports so surfaces and libs have one import point. */
export {
  type BarBodyProps,
  type BarEditorProps,
  type BarWidgetSpec,
} from "./define";
export type { LinksWidget } from "./links";
