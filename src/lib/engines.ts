export type LinkItem = {
  name: string;
  url: string;
  hint?: string;
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
