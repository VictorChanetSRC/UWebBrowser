import type { LucideIcon } from "lucide-react";
import type { ShopEntry } from "@/lib/widget-shop";
import type { WidgetAuthor, WidgetShopInfo } from "./types";

/**
 * The fields every widget spec carries, regardless of surface. The surface
 * spec shapes (DashWidgetSpec, BarWidgetSpec) add their own on top — span +
 * Config for the board, rename + Editor for the work bar.
 */
export type WidgetSpecBase<T extends string = string> = {
  type: T;
  icon: LucideIcon;
  creator: WidgetAuthor;
  shop: WidgetShopInfo;
};

/**
 * Build the derived lookup tables every widget surface needs from its ordered
 * spec list: the by-type index, the type list (for storage validation), the
 * icon map, and the shop shelf. Both the dashboard and the work bar registries
 * are the same maps over different specs — this owns that construction so the
 * two index.tsx files don't each hand-roll it. The surface-specific dispatch
 * (create / title / Body / Config-or-Editor) stays in each index because those
 * signatures genuinely differ.
 */
export function createWidgetRegistry<T extends string, S extends WidgetSpecBase<T>>(
  widgets: readonly S[],
) {
  return {
    specs: Object.fromEntries(widgets.map((s) => [s.type, s])) as Record<T, S>,
    types: widgets.map((s) => s.type) as T[],
    icons: Object.fromEntries(widgets.map((s) => [s.type, s.icon])) as Record<T, LucideIcon>,
    shop: widgets.map((s) => ({ type: s.type, creator: s.creator, ...s.shop })) as ShopEntry<T>[],
  };
}
