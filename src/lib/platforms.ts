/** Everywhere a game can live. Order is the order checks render in setup. */
export const PLATFORMS = [
  { key: "steam", label: "Steam" },
  { key: "epic", label: "Epic Games Store" },
  { key: "xbox", label: "Xbox" },
  { key: "playstation", label: "PlayStation" },
  { key: "nintendo", label: "Nintendo eShop" },
  { key: "appstore", label: "App Store" },
  { key: "googleplay", label: "Google Play" },
  { key: "itch", label: "itch.io" },
  { key: "twitch", label: "Twitch category" },
] as const;

export type PlatformKey = (typeof PLATFORMS)[number]["key"];

/** One store's answer: found (with name/link) or not. */
export type PlatformHit = {
  found: boolean;
  name?: string;
  url?: string;
  id?: string;
};
