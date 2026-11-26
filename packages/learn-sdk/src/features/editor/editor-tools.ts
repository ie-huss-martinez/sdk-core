import { defineTool, type Tool } from "@hussmartinez/sdk-core";
import type { LearnEditor, LearnEditorSnapshot } from "../../core/session/editor.js";

/**
 * What an editor tool reads: the editor's snapshot, and the exercise the
 * teacher has selected, which the editor component keeps.
 *
 * @public
 */
export interface LearnEditorToolState {
  readonly snapshot: LearnEditorSnapshot;
  readonly selected: string | null;
}

/**
 * What an editor tool acts on.
 *
 * @public
 */
export interface LearnEditorToolContext {
  readonly editor: LearnEditor;
  readonly selected: string | null;
}

/**
 * One of the editor's actions as a tool (ADR 0007, sdk-core ADR 0030).
 *
 * @public
 */
export type LearnEditorTool = Tool<LearnEditorToolState, LearnEditorToolContext, undefined>;

/**
 * Undoes the last step.
 *
 * @public
 */
export const undoTool: LearnEditorTool = /* @__PURE__ */ defineTool({
  id: "learn.undo",
  label: "tools.undo",
  icon: "undo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canUndo,
  run: ({ editor }) => {
    editor.undo();
  },
  shortcuts: "undo",
});

/**
 * Redoes the last undone step.
 *
 * @public
 */
export const redoTool: LearnEditorTool = /* @__PURE__ */ defineTool({
  id: "learn.redo",
  label: "tools.redo",
  icon: "redo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canRedo,
  run: ({ editor }) => {
    editor.redo();
  },
  shortcuts: "redo",
});

/**
 * Removes the selected exercise at once; undo brings it back (ADR 0007).
 *
 * @public
 */
export const removeExerciseTool: LearnEditorTool = /* @__PURE__ */ defineTool({
  id: "learn.remove-exercise",
  label: "tools.remove-exercise",
  icon: "delete",
  group: "exercises",
  isEnabled: ({ snapshot, selected }) =>
    selected !== null && snapshot.draft.exercises.some((exercise) => exercise.id === selected),
  run: ({ editor, selected }) => {
    if (selected !== null) {
      editor.execute({ type: "learn.removeExercise", exerciseId: selected });
    }
  },
  shortcuts: "delete",
});

/** Where the selected exercise is, or -1. */
const selectedIndex = (snapshot: LearnEditorSnapshot, selected: string | null) =>
  selected === null
    ? -1
    : snapshot.draft.exercises.findIndex((exercise) => exercise.id === selected);

/**
 * Moves the selected exercise one place earlier (ADR 0008).
 *
 * @public
 */
export const moveExerciseUpTool: LearnEditorTool = /* @__PURE__ */ defineTool({
  id: "learn.move-exercise-up",
  label: "tools.move-exercise-up",
  icon: "move-up",
  group: "exercises",
  isEnabled: ({ snapshot, selected }) => selectedIndex(snapshot, selected) > 0,
  run: ({ editor, selected }) => {
    const index = selectedIndex(editor.getSnapshot(), selected);
    if (selected !== null && index > 0) {
      editor.execute({ type: "learn.moveExercise", exerciseId: selected, to: index - 1 });
    }
  },
});

/**
 * Moves the selected exercise one place later (ADR 0008).
 *
 * @public
 */
export const moveExerciseDownTool: LearnEditorTool = /* @__PURE__ */ defineTool({
  id: "learn.move-exercise-down",
  label: "tools.move-exercise-down",
  icon: "move-down",
  group: "exercises",
  isEnabled: ({ snapshot, selected }) => {
    const index = selectedIndex(snapshot, selected);
    return index >= 0 && index < snapshot.draft.exercises.length - 1;
  },
  run: ({ editor, selected }) => {
    const snapshot = editor.getSnapshot();
    const index = selectedIndex(snapshot, selected);
    if (selected !== null && index >= 0 && index < snapshot.draft.exercises.length - 1) {
      editor.execute({ type: "learn.moveExercise", exerciseId: selected, to: index + 1 });
    }
  },
});

/**
 * A tool that adds an exercise of one type after the selected one, or at the
 * end (ADR 0008), from its editor block's new payload. Its id is
 * `learn.add-<type>`, and its label `tools.add.<type>`.
 *
 * @example
 * ```ts
 * const addFlashcard = addExerciseTool("flashcard", () => ({ cards: [] }));
 * ```
 *
 * @public
 */
export function addExerciseTool(type: string, create: () => unknown): LearnEditorTool {
  return defineTool({
    id: `learn.add-${type}`,
    label: `tools.add.${type}`,
    icon: "add",
    group: "add",
    level: "easy",
    run: ({ editor, selected }) => {
      const snapshot = editor.getSnapshot();
      const index = selectedIndex(snapshot, selected);
      const at = index < 0 ? snapshot.draft.exercises.length : index + 1;
      editor.execute({
        type: "learn.addExercise",
        exercise: { id: editor.newExerciseId(), type, payload: create() as object },
        at,
      });
    },
  });
}

/**
 * The editor's tools that need no more than a selection: undo, redo, and
 * removing and moving the selected exercise. Adding needs a type's new
 * payload, so each type's add tool is made with {@link addExerciseTool}.
 *
 * @public
 */
export const learnEditorTools: readonly LearnEditorTool[] = [
  undoTool,
  redoTool,
  removeExerciseTool,
  moveExerciseUpTool,
  moveExerciseDownTool,
];
