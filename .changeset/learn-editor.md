---
"@hussmartinez/learn-sdk": patch
---

Add `LearnEditor`, the teacher's editor, to `@hussmartinez/learn-sdk/react` (ADR 0008).

- **`LearnEditor`** edits `hm-learn-content` on the editor session. It renders through ui's editor frame, with an outline of exercises, tools to add, remove and move them, undo and redo with toasts, and start cards. Every problem is shown at its field. Pass `single` to edit a document of exactly one exercise, for hosts that store exercises one by one.
- **Saving stays yours:** `onChange(draft, { issues, valid })` reports every edit, and the handle's `getContent()` returns validated content, or throws `INVALID_DOCUMENT`. It also has `flush()`, `undo()` and `redo()`.
- **Typing** is committed as one edit per burst, and never while an input method is composing, so Thai, Chinese and Japanese input stay whole. Fields in the taught language get its `lang` and `dir` from `profile`, with spellcheck and autocorrect off.
- **Editor blocks** for the built-in types: `multipleChoiceEditor`, `gapFillEditor` and `wordOrderEditor`. Give your own types one with `defineEditorBlock({ edit, create })` and the `blocks` prop.
- **The editor's text** is `learnEditorMessages`, from `./react`; `LearnEditorMessageCatalogue` types overrides. New tools from `.`: `addExerciseTool(type, create)`, `moveExerciseUpTool` and `moveExerciseDownTool`.
