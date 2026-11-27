import { describe, expect, it } from "vitest";
import type { CardRecord } from "../model/progress.js";
import { dueItems } from "./due-items.js";

const card = (itemId: string, due: number): CardRecord => ({
  itemId,
  due,
  scheduling: { scheduler: "fake", model: "fake", version: 1, card: null },
});

describe("dueItems", () => {
  const cards = [card("later", 300), card("b", 100), card("oldest", 50), card("a", 100)];

  it("returns the cards due at or before now, longest overdue first", () => {
    expect(dueItems({ cards }, 100).map((due) => due.itemId)).toEqual(["oldest", "a", "b"]);
    expect(dueItems({ cards }, 49)).toEqual([]);
  });

  it("orders cards due at the same moment by id, whatever order they're stored in", () => {
    const reversed = [...cards].reverse();
    expect(dueItems({ cards: reversed }, 100)).toEqual(dueItems({ cards }, 100));
  });

  it("keeps to a limit, and leaves the progress as it was", () => {
    const before = [...cards];
    expect(dueItems({ cards }, 1000, { limit: 2 }).map((due) => due.itemId)).toEqual([
      "oldest",
      "a",
    ]);
    expect(dueItems({ cards }, 1000, { limit: 0 })).toEqual([]);
    expect(dueItems({ cards }, 1000, { limit: -1 })).toEqual([]);
    expect(cards).toEqual(before);
  });
});
