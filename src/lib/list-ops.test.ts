import { describe, expect, it } from "vitest";
import { countByType, moveBy, moveTo, patchById, pickById, removeById } from "./list-ops";

const items = [
  { id: "a", type: "game" as const },
  { id: "b", type: "news" as const },
  { id: "c", type: "game" as const },
];
const ids = (list: { id: string }[]) => list.map((i) => i.id).join("");

describe("pickById", () => {
  it("follows a null or stale id to the first item", () => {
    expect(pickById(items, "b")?.id).toBe("b");
    expect(pickById(items, null)?.id).toBe("a");
    expect(pickById(items, "gone")?.id).toBe("a");
    expect(pickById([], "a")).toBeNull();
  });
});

describe("removeById", () => {
  it("drops one item and leaves the order alone", () => {
    expect(ids(removeById(items, "b"))).toBe("ac");
    expect(ids(removeById(items, "gone"))).toBe("abc");
  });
});

describe("moveTo / moveBy", () => {
  it("moves an item to an absolute index", () => {
    expect(ids(moveTo(items, "a", 2))).toBe("bca");
    expect(ids(moveTo(items, "c", 0))).toBe("cab");
  });

  it("returns the same array when the move would do nothing", () => {
    // Same reference, so a caller's `onChange` doesn't re-render for free.
    expect(moveTo(items, "a", 0)).toBe(items);
    expect(moveTo(items, "gone", 1)).toBe(items);
    expect(moveTo(items, "a", -1)).toBe(items);
    expect(moveTo(items, "a", 3)).toBe(items);
  });

  it("moves by a relative offset, and clamps at the ends by no-op", () => {
    expect(ids(moveBy(items, "b", -1))).toBe("bac");
    expect(ids(moveBy(items, "b", 1))).toBe("acb");
    expect(moveBy(items, "a", -1)).toBe(items);
    expect(moveBy(items, "c", 1)).toBe(items);
  });
});

describe("patchById", () => {
  it("shallow-merges into one item", () => {
    const next = patchById(items, "b", { type: "game" });
    expect(next[1]).toEqual({ id: "b", type: "game" });
    expect(next[0]).toBe(items[0]);
  });
});

describe("countByType", () => {
  it("counts each type, and knows nothing of types absent from the list", () => {
    const counts = countByType(items);
    expect(counts.get("game")).toBe(2);
    expect(counts.get("news")).toBe(1);
    expect(counts.size).toBe(2);
    expect(countByType([]).size).toBe(0);
  });
});
