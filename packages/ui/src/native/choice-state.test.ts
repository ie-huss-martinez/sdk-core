import { describe, expect, it } from "vitest";
import { CHOICE_VARIANTS, choiceState } from "./choice-state.js";

const states = (picked: string | null, correctKey?: string) =>
  ["a", "b", "c"].map((key) => choiceState(key, picked, correctKey));

describe("choiceState", () => {
  it("is idle for every choice until one is picked, even with an answer", () => {
    expect(states(null)).toEqual(["idle", "idle", "idle"]);
    expect(states(null, "b")).toEqual(["idle", "idle", "idle"]);
  });

  it("marks only the pick when no answer is shown, so it can still change", () => {
    expect(states("a")).toEqual(["selected", "idle", "idle"]);
  });

  it("shows a right pick as correct, and dims the rest", () => {
    expect(states("b", "b")).toEqual(["dimmed", "correct", "dimmed"]);
  });

  it("shows a wrong pick as a hint, beside the right choice", () => {
    expect(states("a", "b")).toEqual(["hint", "correct", "dimmed"]);
  });

  it("draws a wrong pick with the hint variant, never an error's", () => {
    expect(CHOICE_VARIANTS.hint).toBe("hint");
    expect(CHOICE_VARIANTS.correct).toBe("success");
    expect(Object.values(CHOICE_VARIANTS)).not.toContain("danger");
  });
});
