import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_PCT, SHARE_OPTIONS, otherCurrencies, share, shareLabel } from "./sales";

describe("shareLabel", () => {
  it("never says '100% share' — at 100% there is no share", () => {
    expect(shareLabel(100)).toBe("Net sales");
    expect(shareLabel(70)).toBe("70% share");
    expect(shareLabel(DEFAULT_SHARE_PCT)).toBe("70% share");
  });

  it("labels every option the chips offer", () => {
    expect(SHARE_OPTIONS.map(shareLabel)).toEqual([
      "70% share",
      "75% share",
      "80% share",
      "Net sales",
    ]);
  });
});

describe("share", () => {
  it("takes a percentage of a net figure", () => {
    expect(share(1000, 70)).toBe(700);
    expect(share(1000, 100)).toBe(1000);
    expect(share(0, 70)).toBe(0);
  });
});

describe("otherCurrencies", () => {
  it("counts the currencies it isn't showing, and says nothing when there are none", () => {
    expect(otherCurrencies(0)).toBeNull();
    expect(otherCurrencies(1)).toBeNull();
    expect(otherCurrencies(2)).toBe("1 other currency not shown.");
    expect(otherCurrencies(3)).toBe("2 other currencies not shown.");
  });
});
