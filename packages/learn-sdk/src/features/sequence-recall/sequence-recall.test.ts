import { describe, expect, it } from "vitest";
import { isLearnError } from "../../core/errors/learn-error.js";
import { createExerciseTypes } from "../../core/model/exercise-type.js";
import { gradeAnswer } from "../../core/operations/grade-answer.js";
import { parseContent } from "../../core/operations/parse-content.js";
import { expectedTaps, sequenceRecall } from "./sequence-recall.js";

const types = createExerciseTypes([sequenceRecall]);
const content = (payload: unknown) => ({
  format: "hm-learn-content",
  version: 1,
  exercises: [{ id: "s", type: "sequence-recall", payload }],
});
const exercise = (payload: unknown) =>
  parseContent(content(payload), { types }).exercises[0] as never;
const refusal = (payload: unknown) => {
  try {
    parseContent(content(payload), { types });
  } catch (error) {
    if (isLearnError(error)) {
      const issues = (error.details as unknown as { issues?: { path: unknown[]; code: string }[] })
        .issues;
      return issues
        ? issues.map((issue) => [issue.path.slice(3).join("."), issue.code])
        : error.code;
    }
    throw error;
  }
  throw new Error("expected a LearnError");
};

describe("sequence-recall: content", () => {
  it("reads a board and a sequence, forwards or backwards", () => {
    const forward = { tiles: 9, sequence: [4, 0, 7] };
    expect(parseContent(content(forward), { types }).exercises[0]?.payload).toEqual(forward);
    const backward = { ...forward, backward: true };
    expect(parseContent(content(backward), { types }).exercises[0]?.payload).toEqual(backward);
    expect(expectedTaps(forward)).toEqual([4, 0, 7]);
    expect(expectedTaps(backward)).toEqual([7, 0, 4]);
    expect(backward.sequence).toEqual([4, 0, 7]);
  });

  it.each([
    ["a board of one tile", { tiles: 1, sequence: [0] }, [["tiles", "too-few"]]],
    [
      "a board that isn't a count",
      { tiles: 2.5, sequence: [0] },
      [["tiles", "expected-whole-number"]],
    ],
    ["an empty sequence", { tiles: 9, sequence: [] }, [["sequence", "too-few"]]],
    [
      "a tile the board doesn't have",
      { tiles: 4, sequence: [0, 4] },
      [["sequence.1", "out-of-range"]],
    ],
    ["a tile lit twice", { tiles: 9, sequence: [2, 5, 2] }, [["sequence.2", "repeated-tile"]]],
    [
      "a direction that isn't yes or no",
      { tiles: 9, sequence: [1], backward: "yes" },
      [["backward", "expected-yes-no"]],
    ],
    [
      "a field it doesn't have",
      { tiles: 9, sequence: [1], speed: 2 },
      [["speed", "unknown-field"]],
    ],
  ])("refuses %s", (_case, payload, issues) => {
    expect(refusal(payload)).toEqual(issues);
  });

  it("holds a board to the tile limit before anything is made of it", () => {
    expect(refusal({ tiles: 31, sequence: [0] })).toBe("TOO_MANY_TILES");
    expect(refusal({ tiles: Number.MAX_SAFE_INTEGER, sequence: [0] })).toBe("TOO_MANY_TILES");
  });
});

describe("sequence-recall: grading", () => {
  const forward = exercise({ tiles: 9, sequence: [4, 0, 7] });
  const backward = exercise({ tiles: 9, sequence: [4, 0, 7], backward: true });
  const grade = (of: never, taps: unknown) => gradeAnswer(of, { taps }, { types });

  it("scores each tap in the right place", () => {
    expect(grade(forward, [4, 0, 7])).toEqual({ score: 3, max: 3, items: [true, true, true] });
    expect(grade(forward, [4, 0, 2])).toEqual({ score: 2, max: 3, items: [true, true, false] });
    expect(grade(forward, [0, 4, 7]).items).toEqual([false, false, true]);
  });

  it("wants the reverse order when backward", () => {
    expect(grade(backward, [7, 0, 4]).score).toBe(3);
    expect(grade(backward, [4, 0, 7]).items).toEqual([false, true, false]);
  });

  it("counts taps that weren't made as wrong", () => {
    expect(grade(forward, [4])).toEqual({ score: 1, max: 3, items: [true, false, false] });
    expect(grade(forward, [])).toEqual({ score: 0, max: 3, items: [false, false, false] });
  });

  it("refuses more taps than the sequence, a tile off the board, and other shapes", () => {
    for (const taps of [[4, 0, 7, 1], [9], [-1], [1.5], "4,0,7", null]) {
      expect(() => grade(forward, taps)).toThrow(
        expect.objectContaining({ code: "INVALID_ANSWER" }),
      );
    }
  });

  it("rates no items: it trains a span, and holds nothing to remember later", () => {
    expect(sequenceRecall.reviewItems).toBeUndefined();
  });
});
