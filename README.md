# UWebBrowser

The web browser for Unreal Engine developers. Open source, powered by [Tauri](https://tauri.app).

UWebBrowser is a real browser with tabs and an address bar, plus a dashboard wired
to the places an Unreal Engine developer actually works:

- **One-name setup.** Type your game's name. UWebBrowser checks Steam, Epic,
  Xbox, PlayStation, Nintendo, the App Store, Google Play, itch.io and Twitch,
  grabs your Steam App ID and wires the dashboard.
- **All your games.** Track as many games as you ship; switch between them on the
  dashboard.
- **Live Steam numbers.** Players right now, review score, positive %, price. No API key.
- **itch.io stats.** Views, downloads and purchases across your games, with your API key.
- **See your game out there.** Fresh Reddit mentions inline, one-click searches on
  YouTube, Twitch, TikTok, X and Bluesky.
- **Your work bar.** An editable sidebar of the links you actually use. Seeded with
  Unreal Engine essentials (docs, Fab, forums, source) plus curated
  ship/community/assets/news sections, then fully yours: add, remove, pin.
- **Discover.** A curated catalog of tools, assets, learning channels and
  communities for Unreal devs at `uwb://discover`. Pin anything to your work bar.

## Stack

- [Tauri 2](https://tauri.app): Rust core, one native window
- Multi-webview: the chrome UI is a React + Vite webview; every tab is its own
  native webview managed from Rust
- Steam / Reddit / itch.io calls happen in the Rust backend (no CORS, no proxies)

## Develop

Prerequisites: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20+,
and on Windows the WebView2 runtime (ships with Windows 11).

```sh
npm install
npm run tauri dev
```

## Build

```sh
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

## Create a widget

Dashboard tiles and work bar widgets are one spec file each, credited to
their creator and distributed through the in-app widget shop. The full
walkthrough — with a copy-paste template — is in
[docs/WIDGETS.md](docs/WIDGETS.md).

## Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+L` | Focus address bar |

## Notes

- The default search engine is Google; type anything without a dot in the
  address bar to search. You can switch engines in Settings.
- Your setup (game name, Steam App ID, itch.io API key) is stored locally and never
  leaves your machine.

## License

MIT
