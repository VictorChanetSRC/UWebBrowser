import type { WidgetAuthor, WidgetShopInfo } from "@/widgets/types";

/**
 * The widget shop's vocabulary: categories, the entry shape, and search.
 * The entries themselves live with the widgets — each spec carries its own
 * shop listing, and the surface registries assemble the shelves
 * (DASH_SHOP in src/widgets/dashboard, BAR_SHOP in src/widgets/workbar).
 */

export type ShopCategoryKey = "game" | "pulse" | "tools";

export type ShopCategory = {
  key: ShopCategoryKey;
  label: string;
  /** One line under the grid header when the category is selected. */
  blurb: string;
};

export const SHOP_CATEGORIES: ShopCategory[] = [
  {
    key: "game",
    label: "Your game",
    blurb: "Everything that tracks the thing you're shipping.",
  },
  {
    key: "pulse",
    label: "News & market",
    blurb: "What the rest of the industry is doing.",
  },
  {
    key: "tools",
    label: "Toolkit",
    blurb: "Links, monitors and workspace utilities.",
  },
];

export const shopCategory = (key: ShopCategoryKey): ShopCategory =>
  SHOP_CATEGORIES.find((c) => c.key === key)!;

/** A label/value row on the detail page: source, cadence, requirements. */
export type ShopFact = { label: string; value: string };

/** One shelf item: a widget's listing plus its identity and credit. */
export type ShopEntry<T extends string = string> = WidgetShopInfo & {
  type: T;
  creator: WidgetAuthor;
};

/* -------------------------------- search --------------------------------- */

/** Category first, then a query across everything a card shows (and its tags). */
export function filterShop<T extends string>(
  entries: ShopEntry<T>[],
  category: ShopCategoryKey | "all",
  query: string,
): ShopEntry<T>[] {
  const scoped =
    category === "all" ? entries : entries.filter((e) => e.category === category);
  const q = query.trim().toLowerCase();
  if (!q) return scoped;
  return scoped.filter((e) =>
    [
      e.name,
      e.tagline,
      e.description,
      e.creator.name,
      shopCategory(e.category).label,
      ...e.tags,
    ]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}
