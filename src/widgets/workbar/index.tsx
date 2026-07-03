import type { LucideIcon } from "lucide-react";
import type { ShopEntry } from "@/lib/widget-shop";
import type { BarBodyProps, BarEditorProps, BarWidgetSpec } from "./define";
import steam, { type SteamWidget } from "./steam";
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

export type Widget = LinksWidget | SteamWidget | BuildWidget | SystemWidget | ItchWidget;

export type WidgetType = Widget["type"];

/**
 * Ordered as they appear in the shop. Each spec is precisely typed in its own
 * file; the registry views them through the loose base shape — the dispatch
 * helpers below are the only places that cross that line.
 */
export const BAR_WIDGETS: readonly BarWidgetSpec<any>[] = [steam, build, itch, system, links];

export const BAR_SPECS = Object.fromEntries(
  BAR_WIDGETS.map((spec) => [spec.type, spec]),
) as Record<WidgetType, BarWidgetSpec<any>>;

/** Every registered type, for storage validation. */
export const BAR_WIDGET_TYPES = BAR_WIDGETS.map((spec) => spec.type) as WidgetType[];

export const BAR_ICONS: Record<WidgetType, LucideIcon> = Object.fromEntries(
  BAR_WIDGETS.map((spec) => [spec.type, spec.icon]),
) as Record<WidgetType, LucideIcon>;

/** The shop shelf: every widget's listing plus identity and credit. */
export const BAR_SHOP: ShopEntry<WidgetType>[] = BAR_WIDGETS.map((spec) => ({
  type: spec.type as WidgetType,
  creator: spec.creator,
  ...spec.shop,
}));

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
