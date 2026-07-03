export type SearchEngineKey = "duckduckgo" | "google" | "bing" | "brave";

export type SearchEngine = {
  key: SearchEngineKey;
  label: string;
  host: string;
  searchUrl: (query: string) => string;
};

export const searchEngines: SearchEngine[] = [
  {
    key: "duckduckgo",
    label: "DuckDuckGo",
    host: "duckduckgo.com",
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  {
    key: "google",
    label: "Google",
    host: "google.com",
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    key: "bing",
    label: "Bing",
    host: "bing.com",
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    key: "brave",
    label: "Brave Search",
    host: "search.brave.com",
    searchUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  },
];

export type BrowserSettings = {
  searchEngine: SearchEngineKey;
};

const KEY = "uwb.settings";

export const defaultSettings: BrowserSettings = {
  searchEngine: "duckduckgo",
};

export function engineFor(key: SearchEngineKey): SearchEngine {
  return searchEngines.find((engine) => engine.key === key) ?? searchEngines[0];
}

export function loadSettings(): BrowserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return {
      searchEngine: searchEngines.some((engine) => engine.key === parsed.searchEngine)
        ? parsed.searchEngine
        : defaultSettings.searchEngine,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: BrowserSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
