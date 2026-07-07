/** Derivations over the `SteamStats` payload, shared by every widget that shows
 *  Steam numbers (the dashboard game tile and the work-bar store card) so the
 *  percentage/price/release rules live in one place instead of drifting. */

import { MISSING } from "./format";
import type { SteamStats } from "./ipc";

type Details = SteamStats["details"] | undefined;
type Reviews = SteamStats["reviews"] | undefined;

/** Positive-review percentage (0–100 integer), or null with no reviews yet. */
export function positivePct(reviews: Reviews): number | null {
  if (!reviews?.total_reviews || reviews.total_positive === undefined) return null;
  return Math.round((reviews.total_positive / reviews.total_reviews) * 100);
}

/** Selling price: "Free", the store's formatted price, or the missing marker. */
export function priceLabel(details: Details): string {
  if (details?.is_free) return "Free";
  return details?.price_overview?.final_formatted ?? MISSING;
}

/** Release date, or "Coming soon" for a game that hasn't shipped. */
export function releaseLabel(details: Details): string {
  if (details?.release_date?.coming_soon) return "Coming soon";
  return details?.release_date?.date ?? MISSING;
}
