export type LinkItem = {
  name: string;
  url: string;
  hint?: string;
};

export type LinkSection = {
  label: string;
  items: LinkItem[];
};

/** The Unreal Engine workspace. UWebBrowser is built for UE developers. */
export const unreal = {
  name: "Unreal Engine",
  tagline: "Docs, Fab, forums and source in one place.",
  links: [
    { name: "Documentation", url: "https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-5-documentation", hint: "Official UE5 docs" },
    { name: "Learning", url: "https://dev.epicgames.com/community/learning", hint: "Epic courses and samples" },
    { name: "Forums", url: "https://forums.unrealengine.com", hint: "Official community" },
    { name: "Fab", url: "https://www.fab.com", hint: "Marketplace for assets" },
    { name: "Source on GitHub", url: "https://github.com/EpicGames/UnrealEngine", hint: "Engine source access" },
    { name: "Unreal Source Discord", url: "https://unrealsource.com", hint: "Largest UE community" },
    { name: "r/unrealengine", url: "https://www.reddit.com/r/unrealengine/", hint: "Subreddit" },
    { name: "Issue tracker", url: "https://issues.unrealengine.com", hint: "Known engine bugs" },
  ] as LinkItem[],
};

export const shipAndTrack: LinkSection = {
  label: "Ship & track",
  items: [
    { name: "Steamworks", url: "https://partner.steamgames.com", hint: "Steam partner portal" },
    { name: "SteamDB", url: "https://steamdb.info", hint: "Steam data explorer" },
    { name: "Epic Dev Portal", url: "https://dev.epicgames.com/portal", hint: "Epic Games Store dashboard" },
    { name: "itch.io dashboard", url: "https://itch.io/dashboard", hint: "Your itch.io games" },
    { name: "Gamalytic", url: "https://gamalytic.com", hint: "Steam market analytics" },
    { name: "VG Insights", url: "https://vginsights.com", hint: "Game market research" },
  ],
};

export const community: LinkSection = {
  label: "Community",
  items: [
    { name: "r/gamedev", url: "https://www.reddit.com/r/gamedev/", hint: "The big one" },
    { name: "TIGSource forums", url: "https://forums.tigsource.com", hint: "Indie devlogs" },
    { name: "itch.io jams", url: "https://itch.io/jams", hint: "Game jams calendar" },
    { name: "Ludum Dare", url: "https://ldjam.com", hint: "The classic jam" },
    { name: "IndieDB", url: "https://www.indiedb.com", hint: "Indie game database" },
    { name: "GameDev.net", url: "https://www.gamedev.net", hint: "Forums and articles" },
  ],
};

export const assetsAndTools: LinkSection = {
  label: "Assets & tools",
  items: [
    { name: "Kenney", url: "https://kenney.nl/assets", hint: "Free game assets" },
    { name: "OpenGameArt", url: "https://opengameart.org", hint: "Free art and audio" },
    { name: "Poly Haven", url: "https://polyhaven.com", hint: "Free HDRIs, textures, models" },
    { name: "Mixamo", url: "https://www.mixamo.com", hint: "Character animation" },
    { name: "Freesound", url: "https://freesound.org", hint: "CC sound effects" },
    { name: "Blender", url: "https://www.blender.org", hint: "3D creation suite" },
    { name: "Krita", url: "https://krita.org", hint: "Digital painting" },
    { name: "Tiled", url: "https://www.mapeditor.org", hint: "Level editor" },
    { name: "Audacity", url: "https://www.audacityteam.org", hint: "Audio editor" },
  ],
};

export const newsAndMarketing: LinkSection = {
  label: "News & marketing",
  items: [
    { name: "Game Developer", url: "https://www.gamedeveloper.com", hint: "Industry news" },
    { name: "80 Level", url: "https://80.lv", hint: "Art and tech breakdowns" },
    { name: "GamesIndustry.biz", url: "https://www.gamesindustry.biz", hint: "Business of games" },
    { name: "How To Market A Game", url: "https://howtomarketagame.com", hint: "Chris Zukowski's playbook" },
    { name: "GameDiscoverCo", url: "https://newsletter.gamediscover.co", hint: "Discoverability newsletter" },
  ],
};

export const sidebarSections = (): LinkSection[] => [
  { label: unreal.name, items: unreal.links },
  shipAndTrack,
  community,
  assetsAndTools,
  newsAndMarketing,
];

export function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}

export function watchLinks(gameName: string): LinkItem[] {
  const q = encodeURIComponent(gameName);
  return [
    { name: "YouTube", url: `https://www.youtube.com/results?search_query=${q}` },
    { name: "Twitch", url: `https://www.twitch.tv/search?term=${q}` },
    { name: "TikTok", url: `https://www.tiktok.com/search?q=${q}` },
    { name: "X", url: `https://x.com/search?q=${q}` },
    { name: "Bluesky", url: `https://bsky.app/search?q=${q}` },
  ];
}
