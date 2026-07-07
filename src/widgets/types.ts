import type { Game } from "@/lib/config";
import type { ShopCategoryKey, ShopFact } from "@/lib/widget-shop";

/**
 * Shared vocabulary for every widget spec, regardless of surface. The
 * surface-specific spec shapes build on these — see dashboard/define.ts and
 * workbar/define.ts. New to widgets? Start with docs/WIDGETS.md.
 */

// Author profiles live in ./authors.ts; re-exported here so widget files
// have one import point for spec vocabulary.
export { VICTOR_CHANET } from "./authors";
export type { WidgetAuthor } from "./authors";

/**
 * A widget's shop listing. This is pure storefront copy — keep the voice
 * lean: say what it does, what it needs, and stop.
 */
export type WidgetShopInfo = {
  /** Display name, e.g. "Steam players". */
  name: string;
  /** One line on the shop card; the pitch. */
  tagline: string;
  /** The detail-page paragraph; two or three sentences, no fluff. */
  description: string;
  category: ShopCategoryKey;
  /** Extra search bait beyond the visible text. */
  tags: string[];
  /** Label/value rows on the detail page: source, cadence, requirements. */
  facts: ShopFact[];
  /** Whether a second copy makes sense on one surface. */
  repeatable: boolean;
};

/** The game a widget tracks: its explicit pick, or the first game on the setup
 *  (so a fresh, gameId:null widget follows the primary game for free). Shared
 *  by every game-tracking widget on both surfaces. */
export function trackedGame(gameId: string | null, games: Game[]): Game | null {
  return games.find((g) => g.id === gameId) ?? games[0] ?? null;
}
