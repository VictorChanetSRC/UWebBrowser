# Creating widgets

UWebBrowser has two widget surfaces, both fed by the same in-app **widget
shop**:

- The **home board** (`uwb://home`) — a bento grid of resizable tiles.
- The **work bar** — a 220px rail that rides along the side while you browse,
  edited on `uwb://workbar`.

A widget is **one file**. It declares its stored shape, its shop listing
(with you credited as the creator), its icon, its live body, and — when it
has settings — its config UI. Register it in the surface's index and you're
done: the shop card, the live preview, the detail page, persistence,
add/remove/reorder, titles and icons all derive from the spec.

```text
src/widgets/
├── types.ts               WidgetCreator, VICTOR_CHANET, WidgetShopInfo
├── dashboard/             the home board
│   ├── define.ts          the spec contract (DashWidgetSpec) + tile spans
│   ├── shared.tsx         DataCard, Stat, FeedRow, ChipRow, ConfigStrip, …
│   ├── index.tsx          THE REGISTRY — union type + spec list
│   └── game.tsx …         one file per widget
└── workbar/               the side rail
    ├── define.ts          the spec contract (BarWidgetSpec)
    ├── shared.tsx         WidgetCard, WidgetHint
    ├── index.tsx          THE REGISTRY — union type + spec list
    └── links.tsx …        one file per widget
```

Storage and board/bar mutations live in `src/lib/dashboard.ts` and
`src/lib/workbar.ts`; they delegate everything widget-specific to the
registries. You should never need to touch them.

## Ground rules

1. **Persist settings, not data.** The stored instance carries an `id`, its
   `type`, and user choices (which game, which feed). Live data is fetched by
   the body and thrown away.
2. **Fetch with `usePolled`, gate on `active`.** Surfaces pass `active: false`
   when they're hidden — respect it or you'll poll forever in the background.
3. **Design to the brand.** Ink does the work; Signal appears at most once
   per screen (see `UWebBrowser-Brand-Guidelines.pdf`). Build bodies from the
   shared blocks (`DataCard`, `Stat`, `FeedRow`, `WidgetCard`) so tiles read
   as one system. Mono (`Label`, `font-mono`) for kickers and numerics.
4. **Handle the empty states.** No API key, no game, empty feed — every body
   ships a quiet `TileHint`/`WidgetHint` for each, in the app's lean voice.
5. **Credit yourself.** Every spec points at an author profile, and every
   author gets a page in the shop — see [Authors](#authors) below. Everything
   that ships with UWebBrowser is by Victor Chanet (`VICTOR_CHANET`).

## Walkthrough: a home-board widget

Say we're building a **Wishlist velocity** tile. Create
`src/widgets/dashboard/wishlist.tsx`:

```tsx
import { TrendingUp } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { fmtNumber } from "@/lib/format";
import { usePolled } from "@/hooks/use-polled";
import type { WidgetAuthor } from "../types";
import { defineDashWidget, type DashBodyProps, type TileSpan } from "./define";
import {
  DataCard,
  Stat,
  StatGrid,
  TileHint,
  TracksGameConfig,
  trackedGame,
} from "./shared";

/** 1 — The stored shape: id + type + span, plus your settings. */
export type WishlistWidget = {
  id: string;
  type: "wishlist";
  span: TileSpan;
  /** Which setup game to track; null falls back to the first game. */
  gameId: string | null;
};

/** Your author profile — define once, reuse across all your widgets. */
const YOU: WidgetAuthor = {
  id: "your-slug",
  name: "Your Name",
  tagline: "One line about you.",
  url: "https://your-site.dev",
};

/** 2 — The live body. Fetch here; never store fetched data. */
function WishlistBody({ widget, games, active }: DashBodyProps<WishlistWidget>) {
  const game = trackedGame(widget.gameId, games);
  const appid = game?.steamAppId?.trim() ?? "";
  const { data, error } = usePolled(
    () => ipc.wishlistStats(appid), // your data source
    [appid],
    300_000,                        // every 5 min
    !!appid && active,              // ALWAYS gate on `active`
  );

  if (!game) return <DataCard label="Wishlists"><TileHint>Set up a game first.</TileHint></DataCard>;

  return (
    <DataCard
      label="Wishlists"
      error={!data && error ? `Steam didn't answer: ${error}` : null}
      loading={!!appid && !data}
    >
      {data && (
        <StatGrid>
          <Stat label="Total" value={fmtNumber(data.total)} />
          <Stat label="This week" value={fmtNumber(data.delta)} />
        </StatGrid>
      )}
    </DataCard>
  );
}

/** 3 — The spec: everything the app needs, in one object. */
export default defineDashWidget<WishlistWidget>({
  type: "wishlist",
  icon: TrendingUp,
  creator: YOU,
  shop: {
    name: "Wishlist velocity",
    tagline: "How fast the wishlist is growing, at a glance.",
    description:
      "Total wishlists and the week-over-week delta for one of your games. " +
      "The number your publisher asks about, already on your home page.",
    category: "game",             // "game" | "pulse" | "tools"
    tags: ["steam", "wishlist", "marketing"],
    facts: [
      { label: "Source", value: "Steam Web API" },
      { label: "Refresh", value: "Every 5 min" },
      { label: "Needs", value: "A game with a Steam App ID" },
      { label: "Tile", value: "2×1 to start · resize freely" },
    ],
    repeatable: true,             // one per game makes sense
  },
  defaultSpan: { c: 2, r: 1 },
  create: (base) => ({ ...base, type: "wishlist", gameId: null }),
  title: (widget, games) => `Wishlists · ${trackedGame(widget.gameId, games)?.name ?? ""}`,
  Body: WishlistBody,
  Config: TracksGameConfig,       // free "which game?" chips; or write your own
  preview: { id: "preview-wishlist", type: "wishlist", span: { c: 2, r: 1 }, gameId: null },
});
```

Then register it in `src/widgets/dashboard/index.tsx` — two lines:

```tsx
import wishlist, { type WishlistWidget } from "./wishlist";

export type DashWidget =
  | GameWidget
  // …
  | WishlistWidget;              // ① add to the union

export const DASH_WIDGETS: readonly DashWidgetSpec<any>[] = [
  game,
  // …
  wishlist,                       // ② add to the shelf (order = shop order)
];
```

That's the whole job. Open the shop from **Customize** on the home page and
your widget is there — live preview, detail page, creator credit and all.

## Walkthrough: a work bar widget

Same idea, smaller canvas. Work bar widgets render at exactly **220px** wide,
have no spans, and use `WidgetCard`/`WidgetHint` from `workbar/shared.tsx`:

```tsx
import { Timer } from "lucide-react";
import { VICTOR_CHANET } from "../types";
import { defineBarWidget, type BarBodyProps } from "./define";
import { WidgetCard } from "./shared";

export type ClockWidget = { id: string; type: "clock" };

function ClockBody(_props: BarBodyProps<ClockWidget>) {
  return <WidgetCard>{/* keep rows tight; let text truncate */}</WidgetCard>;
}

export default defineBarWidget<ClockWidget>({
  type: "clock",
  icon: Timer,
  creator: VICTOR_CHANET,
  shop: { /* same shape as the dashboard example, minus the Tile fact */ },
  create: (base) => ({ ...base, type: "clock" }),
  title: () => "Clock",
  Body: ClockBody,
  preview: { id: "preview-clock", type: "clock" },
});
```

Register in `src/widgets/workbar/index.tsx` the same two-line way.

Work bar specs have two extra optional powers, both visible in `links.tsx`:

- **`Editor`** — a section rendered under the widget's row on the
  `uwb://workbar` page. This is where pickers and item lists live
  (`steam.tsx` has a minimal example). Receives `{ widget, games, onPatch }`;
  call `onPatch(partial)` to persist.
- **`rename`** — declare `{ value, patch }` and the row title becomes an
  in-place rename input for free.

Dashboard specs have the equivalent **`Config`** — a strip floated over the
tile in Customize mode. Wrap your rows in `ConfigStrip` + `ChipRow` from
`dashboard/shared.tsx`, and return `null` when there's nothing to choose.
If your widget just tracks one of the user's games, use the ready-made
`TracksGameConfig`.

## Authors

Authors are first-class in the shop. Your name on a card or detail page is a
link; it opens your **author page** — monogram, tagline, bio, a "Visit site"
button, your footprint on both surfaces, and every widget you ship on the
current shelf, live previews included.

An author is one object (`src/widgets/authors.ts`):

```ts
export type WidgetAuthor = {
  id: string;       // stable slug; this is what groups your widgets
  name: string;
  tagline?: string; // one line under your name
  bio?: string;     // short paragraph; two sentences, no résumé
  url?: string;     // "Visit site" opens this in a browser tab
};
```

Define your profile **once** — in `authors.ts` next to `VICTOR_CHANET`, or
as a module-level const in your widget file if you only ship one — and point
every spec's `creator` at the same object. The `id` is what ties your
widgets together across both surfaces, so never mint two ids for one person.

## Spec reference

Shared (`src/widgets/types.ts`):

| Field | What it is |
| --- | --- |
| `creator` | Your `WidgetAuthor` profile — the credit link and author page (see [Authors](#authors)) |
| `shop.name` / `tagline` / `description` | Listing copy. Lean voice: say what it does, what it needs, stop |
| `shop.category` | `"game"` (tracks your game) · `"pulse"` (news & market) · `"tools"` |
| `shop.tags` | Extra search terms beyond the visible copy |
| `shop.facts` | `{ label, value }[]` detail rows — Source, Refresh, Needs, Tile |
| `shop.repeatable` | `false` disables Add once one copy exists |

Dashboard (`dashboard/define.ts`) adds: `defaultSpan`, `create({id, span})`,
`title(widget, games)`, `Body`, `Config?`, `preview`.
Work bar (`workbar/define.ts`) adds: `create({id})`, `title(widget)`, `Body`,
`Editor?`, `rename?`, `preview`.

Body props (both surfaces): `widget` (narrowed to your type), `games`,
`itchApiKey`, `active`, `onOpen(url)` (opens a browser tab), `onUnreal`
(opens the Unreal hub); dashboards also get `onEditSetup`.

Data comes from the Rust backend via `src/lib/ipc.ts` — Steam, Reddit, RSS,
itch.io, system sensors and more are already there, CORS-free. A new external
source means a new command in `src-tauri/src` plus an `ipc.ts` wrapper.

## Preview

`preview` is a frozen instance the shop mounts for its live previews — real
body, real data. Use a stable `preview-…` id, your `defaultSpan`, and null/
default settings (previews fall back to the user's first game). Lists that
would be empty for a new user should carry believable sample items — see
`workbar/links.tsx`.

## Checklist before you PR

- [ ] Instance type carries settings only; body fetches everything else
- [ ] Polling gated on `active` (and on missing keys/ids)
- [ ] Empty, error and loading states all designed — no blank cards
- [ ] Shop copy in the house voice; facts cover Source / Refresh / Needs
- [ ] `creator` points at your one author profile — check your author page
- [ ] Registered in the union **and** the spec list in the surface's `index.tsx`
- [ ] Preview looks right in the shop at card *and* detail sizes
- [ ] `npm run build` is green
