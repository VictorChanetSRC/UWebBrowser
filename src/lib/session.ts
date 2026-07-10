/** The open-tab session, persisted across launches. App saves it on every
 *  tab change and recreates the web tabs' webviews at boot. Lives in the
 *  chrome webview's own profile, so clearing site data never drops it. */

import type { Tab } from "../App";
import { loadJson, saveJson } from "./storage";

const KEY = "uwb.session";
const CLOSED_KEY = "uwb.session.closed";
/** How many closed tabs Ctrl+Shift+T can walk back through. Chrome keeps ~25;
 *  ten is plenty for a browser you don't live in all day, and keeps the list
 *  (which holds URLs) small. */
const MAX_CLOSED = 10;

type SavedTab = Pick<Tab, "id" | "kind" | "url" | "title">;
type SavedSession = { tabs: SavedTab[]; activeId: string };

/** A tab the user closed, with enough to put it back where it was. */
export type ClosedTab = { url: string; title: string; kind: Tab["kind"]; index: number };

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

/**
 * The recently-closed stack behind Ctrl+Shift+T. Persisted, so reopening
 * survives a restart the way it does in Chrome, and it records internal pages
 * (History, Settings, …) too — closing one used to be un-undoable.
 */
export function loadClosedTabs(): ClosedTab[] {
  return loadJson<ClosedTab[]>(
    [CLOSED_KEY],
    (raw) =>
      Array.isArray(raw)
        ? (raw as ClosedTab[]).filter(
            (t) => t && typeof t.url === "string" && (t.kind === "web" || t.kind === "home"),
          )
        : null,
    () => [],
  );
}

export function saveClosedTabs(closed: ClosedTab[]) {
  saveJson(CLOSED_KEY, closed.slice(-MAX_CLOSED));
}
