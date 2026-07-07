/** The open-tab session, persisted across launches. App saves it on every
 *  tab change and recreates the web tabs' webviews at boot. Lives in the
 *  chrome webview's own profile, so clearing site data never drops it. */

import type { Tab } from "../App";
import { loadJson, saveJson } from "./storage";

const KEY = "uwb.session";

type SavedTab = Pick<Tab, "id" | "kind" | "url" | "title">;
type SavedSession = { tabs: SavedTab[]; activeId: string };

export function saveSession(tabs: Tab[], activeId: string) {
  const session: SavedSession = {
    tabs: tabs.map(({ id, kind, url, title }) => ({ id, kind, url, title })),
    activeId,
  };
  saveJson(KEY, session);
}

export function loadSession(): { tabs: Tab[]; activeId: string } | null {
  return loadJson<{ tabs: Tab[]; activeId: string } | null>(
    [KEY],
    (raw) => {
      const saved = raw as SavedSession;
      const tabs: Tab[] = (Array.isArray(saved?.tabs) ? saved.tabs : [])
        .filter(
          (t) =>
            t &&
            typeof t.id === "string" &&
            typeof t.url === "string" &&
            (t.kind === "web" || t.kind === "home"),
        )
        .map((t) => ({
          id: t.id,
          kind: t.kind,
          url: t.url,
          title: typeof t.title === "string" ? t.title : "",
          // Restored web tabs are created lazily on first activation, so they
          // aren't loading yet — the one that gets materialized will emit its own
          // loading events.
          loading: false,
        }));
      if (tabs.length === 0) return null;
      const activeId = tabs.some((t) => t.id === saved.activeId)
        ? saved.activeId
        : tabs[0].id;
      return { tabs, activeId };
    },
    () => null,
  );
}
