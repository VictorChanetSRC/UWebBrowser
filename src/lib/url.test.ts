import { describe, expect, it } from "vitest";
import {
  faviconUrl,
  formatBareUrl,
  hostOf,
  isNavigableUrl,
  storeExtensionId,
  tabLabelFor,
} from "./url";

describe("hostOf", () => {
  it("pulls the hostname out, and never throws", () => {
    expect(hostOf("https://www.example.com/a")).toBe("www.example.com");
    expect(hostOf("not a url")).toBe("not a url");
    expect(hostOf("")).toBe("");
  });
});

describe("tabLabelFor", () => {
  it("labels a web tab with its host", () => {
    expect(tabLabelFor("https://docs.unrealengine.com/5.4/")).toBe("docs.unrealengine.com");
  });

  it("labels a file tab with its file name, decoded", () => {
    expect(tabLabelFor("file:///C:/dev/page.html")).toBe("page.html");
    expect(tabLabelFor("file:///C:/dev/my%20page.html")).toBe("my page.html");
    expect(tabLabelFor("file:///")).toBe("Local file");
  });

  it("falls back to the raw string", () => {
    expect(tabLabelFor("nonsense")).toBe("nonsense");
  });
});

describe("isNavigableUrl", () => {
  it("allows the schemes a tab can actually load", () => {
    expect(isNavigableUrl("https://example.com")).toBe(true);
    expect(isNavigableUrl("http://localhost:5173")).toBe(true);
    expect(isNavigableUrl("file:///C:/a.html")).toBe(true);
    expect(isNavigableUrl("uwb://home")).toBe(true);
  });

  it("rejects the schemes a hostile link would reach for", () => {
    expect(isNavigableUrl("javascript:alert(1)")).toBe(false);
    expect(isNavigableUrl("data:text/html,<script>x</script>")).toBe(false);
    expect(isNavigableUrl("blob:https://example.com/abc")).toBe(false);
    expect(isNavigableUrl("about:blank")).toBe(false);
    expect(isNavigableUrl("JavaScript:alert(1)")).toBe(false);
  });

  it("lets a scheme-less omnibox fragment through to be normalized", () => {
    expect(isNavigableUrl("example.com")).toBe(true);
  });
});

describe("storeExtensionId", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, all a–p

  it("finds the id on both store layouts", () => {
    expect(storeExtensionId(`https://chromewebstore.google.com/detail/ublock/${id}`)).toBe(id);
    expect(
      storeExtensionId(`https://chrome.google.com/webstore/detail/ublock/${id}?hl=en`),
    ).toBe(id);
  });

  it("returns null off-store, or on a store page with no id", () => {
    expect(storeExtensionId(`https://evil.example.com/detail/x/${id}`)).toBeNull();
    expect(storeExtensionId("https://chromewebstore.google.com/category/extensions")).toBeNull();
    expect(storeExtensionId("not a url")).toBeNull();
  });
});

describe("formatBareUrl", () => {
  it("strips the scheme and a leading www.", () => {
    expect(formatBareUrl("https://www.example.com/a")).toBe("example.com/a");
    expect(formatBareUrl("http://example.com")).toBe("example.com");
    expect(formatBareUrl("HTTPS://WWW.example.com")).toBe("example.com");
    // Only a *leading* www., and only http(s).
    expect(formatBareUrl("file:///C:/a.html")).toBe("file:///C:/a.html");
  });
});

describe("faviconUrl", () => {
  it("asks Google for the host's icon", () => {
    expect(faviconUrl("https://example.com/a", 16)).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=16",
    );
  });

  it("returns nothing for a hostless or unparseable URL", () => {
    expect(faviconUrl("file:///C:/a.html")).toBe("");
    expect(faviconUrl("not a url")).toBe("");
  });
});
