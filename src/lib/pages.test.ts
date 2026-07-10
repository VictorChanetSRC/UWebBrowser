import { describe, expect, it } from "vitest";
import {
  HOME_URL,
  HISTORY_URL,
  SETTINGS_URL,
  TERMINAL_URL,
  UNREAL_URL,
  WORKBAR_URL,
  internalTitle,
  normalizeInput,
} from "./pages";

/** Stand-in for the user's search engine, so a search result is unmistakable. */
const search = (query: string) => `https://search.test/?q=${encodeURIComponent(query)}`;
const norm = (raw: string) => normalizeInput(raw, search);

describe("normalizeInput", () => {
  it("has nothing to do with an empty submit", () => {
    expect(norm("")).toBeNull();
    expect(norm("   ")).toBeNull();
  });

  it("resolves internal pages by keyword, and unknown ones to home", () => {
    expect(norm("uwb://settings")).toBe(SETTINGS_URL);
    expect(norm("uwb://unreal")).toBe(UNREAL_URL);
    expect(norm("uwb://terminal")).toBe(TERMINAL_URL);
    expect(norm("uwb://history")).toBe(HISTORY_URL);
    expect(norm("uwb://nowhere")).toBe(HOME_URL);
    // `gdb:` is the pre-rename scheme; old bookmarks still carry it.
    expect(norm("gdb://settings")).toBe(SETTINGS_URL);
  });

  it("aliases `widget` onto the work bar", () => {
    expect(norm("uwb://workbar")).toBe(WORKBAR_URL);
    expect(norm("uwb://widget")).toBe(WORKBAR_URL);
  });

  it("passes real URLs through untouched", () => {
    expect(norm("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
    expect(norm("http://example.com")).toBe("http://example.com");
    expect(norm("HTTPS://Example.com")).toBe("HTTPS://Example.com");
    expect(norm("file:///C:/dev/page.html")).toBe("file:///C:/dev/page.html");
    expect(norm("  https://example.com  ")).toBe("https://example.com");
  });

  it("turns a Windows path into a file URL", () => {
    expect(norm("C:\\dev\\page.html")).toBe("file:///C:/dev/page.html");
    expect(norm("C:/dev/page.html")).toBe("file:///C:/dev/page.html");
    expect(norm("C:\\my docs\\a b.html")).toBe("file:///C:/my%20docs/a%20b.html");
    // `#` is legal in a Windows file name but would truncate the URL.
    expect(norm("C:\\notes\\draft#2.html")).toBe("file:///C:/notes/draft%232.html");
  });

  it("navigates to dotless dev hosts over http", () => {
    expect(norm("localhost")).toBe("http://localhost");
    expect(norm("localhost:5173")).toBe("http://localhost:5173");
    expect(norm("localhost:5173/dash")).toBe("http://localhost:5173/dash");
    expect(norm("127.0.0.1")).toBe("http://127.0.0.1");
    expect(norm("192.168.1.4:8080/x")).toBe("http://192.168.1.4:8080/x");
  });

  it("navigates to anything that looks like a domain", () => {
    expect(norm("example.com")).toBe("https://example.com");
    expect(norm("sub.example.co.uk/path")).toBe("https://sub.example.co.uk/path");
    expect(norm("example.com:8080/a?b=c")).toBe("https://example.com:8080/a?b=c");
  });

  it("searches for everything else", () => {
    expect(norm("hello world")).toBe(search("hello world"));
    // A number is not a domain, however dotted.
    expect(norm("3.14")).toBe(search("3.14"));
    // A dotted phrase with a space is a question, not a host.
    expect(norm("what is 2.5 kg")).toBe(search("what is 2.5 kg"));
    // A bare path is not a host either.
    expect(norm("/usr/local/bin")).toBe(search("/usr/local/bin"));
    expect(norm("unreal engine 5")).toBe(search("unreal engine 5"));
  });
});

describe("internalTitle", () => {
  it("names every internal page", () => {
    expect(internalTitle(WORKBAR_URL)).toBe("Work bar");
    expect(internalTitle(HISTORY_URL)).toBe("History");
  });

  it("falls back for home and for anything unknown", () => {
    expect(internalTitle(HOME_URL)).toBe("New tab");
    expect(internalTitle("uwb://nowhere")).toBe("New tab");
  });
});
