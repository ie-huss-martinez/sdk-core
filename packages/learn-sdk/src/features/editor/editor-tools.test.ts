import { describe, expect, it } from "vitest";
import { createExerciseTypes } from "../../core/model/exercise-type.js";
import { createLearnEditor } from "../../core/session/editor.js";
import { shortAnswer } from "../../test/test-types.js";
import { learnEditorMessages } from "./editor-messages.js";
import {
  addExerciseTool,
  learnEditorTools,
  moveExerciseDownTool,
  moveExerciseUpTool,
  redoTool,
  removeExerciseTool,
  undoTool,
} from "./editor-tools.js";

const types = createExerciseTypes([shortAnswer]);
const payload = { questions: [{ prompt: "eat", accepted: ["กิน"] }] };
const initialContent = {
  format: "hm-learn-content",
  version: 1,
  exercises: [{ id: "a", type: "short-answer", payload }],
};

describe("learnEditorTools", () => {
  it("are labelled from the editor's catalogue, with the family's undo, redo and delete shortcuts", () => {
    for (const tool of learnEditorTools) {
      expect(Object.hasOwn(learnEditorMessages, tool.label), tool.label).toBe(true);
    }
    expect([undoTool.shortcuts, redoTool.shortcuts, removeExerciseTool.shortcuts]).toEqual([
      "undo",
      "redo",
      "delete",
    ]);
  });

  it("remove the selected exercise, which undo brings back", () => {
    const editor = createLearnEditor({ types, initialContent });
    const state = (selected: string | null) => ({ snapshot: editor.getSnapshot(), selected });
    expect(removeExerciseTool.isEnabled?.(state(null))).toBe(false);
    expect(removeExerciseTool.isEnabled?.(state("missing"))).toBe(false);
    expect([removeExerciseTool.isEnabled?.(state("a")), undoTool.isEnabled?.(state(null))]).toEqual(
      [true, false],
    );
    void removeExerciseTool.run({ editor, selected: "a" });
    expect(editor.getSnapshot().draft.exercises).toEqual([]);
    expect(undoTool.isEnabled?.(state(null))).toBe(true);
    void undoTool.run({ editor, selected: null });
    expect(editor.getSnapshot().draft.exercises).toHaveLength(1);
    expect(redoTool.isEnabled?.(state(null))).toBe(true);
    void redoTool.run({ editor, selected: null });
    expect(editor.getSnapshot().draft.exercises).toEqual([]);
  });

  it("move the selected exercise, and only where there's room", () => {
    const two = {
      ...initialContent,
      exercises: [...initialContent.exercises, { id: "b", type: "short-answer", payload }],
    };
    const editor = createLearnEditor({ types, initialContent: two });
    const state = (selected: string | null) => ({ snapshot: editor.getSnapshot(), selected });
    expect([
      moveExerciseUpTool.isEnabled?.(state("a")),
      moveExerciseDownTool.isEnabled?.(state("a")),
    ]).toEqual([false, true]);
    void moveExerciseDownTool.run({ editor, selected: "a" });
    expect(editor.getSnapshot().draft.exercises.map((exercise) => exercise.id)).toEqual(["b", "a"]);
    expect([
      moveExerciseUpTool.isEnabled?.(state("a")),
      moveExerciseDownTool.isEnabled?.(state("a")),
    ]).toEqual([true, false]);
    void moveExerciseUpTool.run({ editor, selected: "a" });
    expect(editor.getSnapshot().draft.exercises.map((exercise) => exercise.id)).toEqual(["a", "b"]);
  });

  it("add an exercise of a type after the selected one, or at the end", () => {
    let next = 0;
    const editor = createLearnEditor({ types, initialContent, newId: () => `new-${++next}` });
    const add = addExerciseTool("short-answer", () => ({ questions: [] }));
    expect([add.id, add.label]).toEqual(["learn.add-short-answer", "tools.add.short-answer"]);
    void add.run({ editor, selected: null });
    void add.run({ editor, selected: "a" });
    expect(editor.getSnapshot().draft.exercises.map((exercise) => exercise.id)).toEqual([
      "a",
      "new-2",
      "new-1",
    ]);
  });
});
