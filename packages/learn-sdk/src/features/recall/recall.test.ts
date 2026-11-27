import { describe, expect, it } from "vitest";
import { isLearnError } from "../../core/errors/learn-error.js";
import { createExerciseTypes } from "../../core/model/exercise-type.js";
import { englishProfile, spanishProfile } from "../../core/model/language-profiles.js";
import { gradeAnswer } from "../../core/operations/grade-answer.js";
import { parseContent } from "../../core/operations/parse-content.js";
import { DEFAULT_MATCH_DISTANCE } from "../../core/operations/tolerant-match.js";
import { createRecallType, recall } from "./recall.js";

const types = createExerciseTypes([recall]);
const tolerant = createExerciseTypes([createRecallType({ tolerance: DEFAULT_MATCH_DISTANCE })]);
const item = (overrides: Record<string, unknown> = {}) => ({
  id: "vault:keys",
  cue: "Where are the keys?",
  answers: ["In the drawer"],
  ...overrides,
});
const content = (items: unknown[]) => ({
  format: "hm-learn-content",
  version: 1,
  exercises: [{ id: "r", type: "recall", payload: { items } }],
});
const exercise = (items: unknown[], set = types) =>
  parseContent(content(items), { types: set }).exercises[0] as never;
const issuesOf = (items: unknown[]) => {
  try {
    parseContent(content(items), { types });
  } catch (error) {
    if (isLearnError(error)) {
      const { issues } = error.details as unknown as {
        issues: { path: unknown[]; code: string }[];
      };
      return issues.map((issue) => [issue.path.slice(4).join("."), issue.code]);
    }
    throw error;
  }
  throw new Error("expected a LearnError");
};

describe("recall: content", () => {
  it("reads items, with or without choices, and returns them rebuilt", () => {
    const withChoices = item({ id: "b", choices: ["In the drawer", "On the table"] });
    const read = parseContent(content([item(), withChoices]), { types });
    expect(read.exercises[0]?.payload).toEqual({ items: [item(), withChoices] });
  });

  it.each([
    ["an item without an id", [item({ id: undefined })], [["0.id", "required"]]],
    ["two items with one id", [item(), item()], [["1.id", "duplicate-id"]]],
    ["no accepted answer", [item({ answers: [] })], [["0.answers", "too-few"]]],
    ["one choice", [item({ choices: ["In the drawer"] })], [["0.choices", "too-few"]]],
    [
      "two choices that read the same",
      [item({ choices: ["In the drawer", " In the drawer ", "x"] })],
      [["0.choices.1", "duplicate-choice"]],
    ],
    [
      "choices without an accepted answer",
      [item({ choices: ["On the table", "In the car"] })],
      [["0.choices", "answer-not-in-options"]],
    ],
    ["a field it doesn't have", [item({ hint: "h" })], [["0.hint", "unknown-field"]]],
  ])("refuses %s", (_case, items, issues) => {
    expect(issuesOf(items)).toEqual(issues);
  });
});

describe("recall: grading", () => {
  it("is exact after the language profile's rules, unless a host asks otherwise", () => {
    const one = exercise([item()]);
    const grade = (recalled: (string | null)[]) =>
      gradeAnswer(one, { recalled }, { types, profile: englishProfile });
    expect(grade(["in the DRAWER!"])).toEqual({ score: 1, max: 1, items: [true] });
    expect(grade(["in the drawers"]).score).toBe(0);
    expect(grade([null]).score).toBe(0);
    expect(grade([""]).score).toBe(0);
  });

  it("forgives a plural, an article, a slip and a sentence around it when tolerant", () => {
    const one = exercise([item({ answers: ["drawer"] })], tolerant);
    const grade = (text: string) =>
      gradeAnswer(one, { recalled: [text] }, { types: tolerant, profile: englishProfile }).score;
    expect(grade("the drawers")).toBe(1);
    expect(grade("I think they're in the drawer")).toBe(1);
    expect(grade("drawr")).toBe(1);
    expect(grade("the table")).toBe(0);
  });

  it("doesn't take a pick that's nearer another choice for the right one", () => {
    const one = exercise(
      [item({ cue: "Which?", answers: ["carta"], choices: ["carta", "cara", "casa"] })],
      tolerant,
    );
    const grade = (text: string) =>
      gradeAnswer(one, { recalled: [text] }, { types: tolerant, profile: spanishProfile }).score;
    expect(grade("carta")).toBe(1);
    // One letter from "carta", and exactly another choice.
    expect(grade("cara")).toBe(0);
  });

  it("refuses an answer of the wrong shape or length", () => {
    const one = exercise([item()]);
    for (const answer of [
      { recalled: [] },
      { recalled: [1] },
      { recalled: ["a"], extra: 1 },
      "a",
    ]) {
      expect(() => gradeAnswer(one, answer, { types })).toThrow(
        expect.objectContaining({ code: "INVALID_ANSWER" }),
      );
    }
  });

  it("refuses a tolerance that isn't one", () => {
    expect(() => createRecallType({ tolerance: 2 })).toThrow(TypeError);
    expect(() => createRecallType({ tolerance: "0.25" as never })).toThrow(TypeError);
  });
});

describe("recall: review", () => {
  it("rates each item good when it was remembered and again when it wasn't", () => {
    const payload = { items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })] };
    const answer = { recalled: ["in the drawer", "elsewhere", null] };
    const grade = recall.grade(payload, answer, englishProfile);
    expect(recall.reviewItems?.(payload, answer, grade)).toEqual([
      { itemId: "a", rating: "good" },
      { itemId: "b", rating: "again" },
      { itemId: "c", rating: "again" },
    ]);
  });
});
