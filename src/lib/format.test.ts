import { describe, expect, it } from "vitest";
import {
  MISSING,
  fmtBytes,
  fmtCents,
  fmtChange,
  fmtDay,
  fmtNumber,
  fmtSpeed,
  fmtUsd,
  formatDuration,
  sourceError,
  usd,
} from "./format";

describe("fmtNumber", () => {
  it("separates thousands, and shows the missing glyph for no number", () => {
    expect(fmtNumber(1234567)).toBe("1,234,567");
    expect(fmtNumber(0)).toBe("0");
    expect(fmtNumber(null)).toBe(MISSING);
    expect(fmtNumber(undefined)).toBe(MISSING);
    expect(fmtNumber(NaN)).toBe(MISSING);
  });
});

describe("formatDuration", () => {
  it("drops the hour field under an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(3_599_000)).toBe("59:59");
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });

  it("floors a negative span at zero", () => {
    expect(formatDuration(-5000)).toBe("0:00");
  });
});

describe("fmtBytes", () => {
  it("climbs units and rounds from MB up", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(1023)).toBe("1023 B");
    expect(fmtBytes(1024)).toBe("1 KB");
    expect(fmtBytes(934 * 1024)).toBe("934 KB");
    expect(fmtBytes(1_468_006)).toBe("1.4 MB");
    expect(fmtBytes(2.1 * 1024 ** 3)).toBe("2.1 GB");
  });

  it("won't invent a size it doesn't have", () => {
    expect(fmtBytes(-1)).toBe(MISSING);
    expect(fmtBytes(NaN)).toBe(MISSING);
  });
});

describe("fmtSpeed", () => {
  it("is a byte size per second", () => {
    expect(fmtSpeed(1_468_006)).toBe("1.4 MB/s");
  });
});

describe("fmtChange", () => {
  it("signs the percentage", () => {
    expect(fmtChange(118, 100)).toBe("+18%");
    expect(fmtChange(96, 100)).toBe("-4%");
    expect(fmtChange(100, 100)).toBe("0%");
  });

  it("refuses to divide by a zero base — a jump from nothing has no percent", () => {
    expect(fmtChange(5, 0)).toBe(MISSING);
  });
});

describe("money", () => {
  it("prints cents only when there are cents", () => {
    expect(usd(1999)).toBe("$19.99");
    expect(usd(1000)).toBe("$10");
    expect(usd(0)).toBe("$0");
  });

  it("keeps cents below $100 and drops them above", () => {
    expect(fmtUsd(12.34)).toBe("$12.34");
    expect(fmtUsd(1240)).toBe("$1,240");
    expect(fmtUsd(null)).toBe(MISSING);
    expect(fmtUsd(NaN)).toBe(MISSING);
  });

  it("carries the currency code with the number", () => {
    expect(fmtCents(5047)).toBe("$50.47");
    expect(fmtCents(120_400, "EUR")).toBe("€1,204");
    expect(fmtCents(null)).toBe(MISSING);
  });

  it("falls back rather than throwing on a currency Intl won't take", () => {
    expect(fmtCents(100, "BITS")).toBe("1.00 BITS");
  });
});

describe("fmtDay", () => {
  it("reads a bare date as a calendar day, not a UTC instant", () => {
    // Parsed field by field, so this is "Jan 1" in every timezone.
    expect(fmtDay("2026-01-01")).toBe("Jan 1");
    expect(fmtDay("2026-07-09")).toBe("Jul 9");
  });

  it("passes an unparseable date through", () => {
    expect(fmtDay("soon")).toBe("soon");
    expect(fmtDay("")).toBe("");
  });
});

describe("sourceError", () => {
  it("phrases every widget's failure the same way", () => {
    expect(sourceError("Steam", "timed out")).toBe("Steam didn't answer: timed out");
  });
});
