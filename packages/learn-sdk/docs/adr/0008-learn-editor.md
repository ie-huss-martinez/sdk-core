# 0008. LearnEditor: the teacher's editor, in the family's frame, on the editor session

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

The editor session exists ([ADR 0007](0007-player-and-editor-sessions.md)): `createLearnEditor` holds a draft that may be invalid, reports its `issues`, keeps history, and takes every edit as an `hm-learn-command`. Teachers still have nothing to type into. The first host, a school app, now plays exercises with `LearnPlayer` and has to author them somewhere; its maintainer chose an editor in the SDK over one in the app (2026-11-23).

What the host needs:

1. **The three built-in types:** add, remove and reorder exercises; edit a title and instructions; edit each type's payload.
2. **Problems at their fields,** and a way for the host to know the draft is valid before it saves.
3. **Persistence stays the host's.** The school stores one exercise per row, so editing a document of one exercise must be a first-class case, not only whole courses.
4. **Thai text:** input methods compose characters in several keystrokes, and autocorrect or spellcheck in the wrong language gets in the way.
5. **Keyboard and screen reader:** the same bar as the player ([ADR 0005](0005-accessible-exercise-types.md)), with undo and redo.

The family's rules shape the rest: every editor renders through `ui`'s frame and keeps no preferences of its own ([sdk-core ADR 0067](../../../../docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md)); interface text stays out of the server-safe entry ([ADR 0059](../../../../docs/adr/0059-interface-text-outside-the-server-safe-entry.md)); React components pass the React lint with every rule on ([ADR 0063](../../../../docs/adr/0063-a-lint-for-what-react-components-do-while-rendering.md)); announcements are tested with a virtual screen reader ([ADR 0065](../../../../docs/adr/0065-screen-reader-tests-with-a-virtual-screen-reader.md)).

## Decision

### One component on the session, from `./react`

`LearnEditor` wraps `createLearnEditor`. It adds no state of its own that the session should hold: the draft, its issues and the history stay the session's, and every edit is one of the five commands. The `<hm-learn-editor>` element follows in its own pull request, on the same component.

**Props:**

| Prop | What it does |
|---|---|
| `initialContent` | `hm-learn-content`, read with `parseContent` as the session does. Read once: changing it later doesn't reload the editor (a `key` does) |
| `single` | Edit a document of exactly one exercise ([below](#one-exercise-as-a-first-class-case)) |
| `types`, `blocks` | The exercise types, and an editor block per type beside the built-in ones |
| `profile` | The language being taught: `lang` and `dir` for its fields |
| `limits`, `newId` | Passed to the session |
| `onChange` | `(draft, { issues, valid })` after every edit, undo and redo, as the session's, with `valid` added |
| `onEvent`, `onError` | The session's events, and `LearnError`s the editor can't show itself |
| `preferences`, `defaultPreferences`, `onPreferencesChange` | The frame's preferences, controlled or not, as every family editor takes them (ADR 0067) |
| `messages`, `locale`, `className`, `headingLevel` | As `LearnPlayer` takes them |

**The handle** (a ref) has `getContent()`, `undo()`, `redo()` and `flush()`. `getContent()` flushes typing first, then returns the session's `getContent()`: validated content, or `INVALID_DOCUMENT` with every issue. A host saves through it, so it never publishes a draft.

**Validity reaches the host twice:** as `valid` in each `onChange`, for enabling a Save button, and as `getContent()`'s result at the moment of saving. `valid` is `issues.length === 0` with no other error, the same test `getContent()` makes.

### One exercise as a first-class case

With `single`, the editor edits `exercises[0]` of a one-exercise document and nothing else:

- no exercise list, and no adding, removing or reordering, so no command can make a second exercise;
- if `initialContent` is absent or empty, it opens on the start cards, one per type, and the card chosen adds the one exercise;
- `initialContent` with more than one exercise is refused with `INVALID_DOCUMENT` (reason `malformed-document`), as content that doesn't fit is refused elsewhere, rather than editing one of them silently.

A host that stores one exercise per row wraps its row in a one-exercise document, edits it with `single`, and stores `getContent().exercises[0]`.

### In the frame

The editor renders through `ui`'s `EditorFrame`, as the other editors do, and takes the frame's preferences as props (ADR 0067). Its regions:

- **Top bar:** undo and redo, the mode switch and settings.
- **Tools** (`ToolList`, the tab bar on a phone): add one of each type, remove, move up and down, undo, redo. Adding is `easy`; moving and removing are `advanced`.
- **Stage:** the selected exercise: its title, its instructions, then its type's editor block.
- **Properties:** the outline of the document, a `ReorderableList` of exercises with each one's title, type and number of problems. Choosing one selects it in the stage. Reordering there is `learn.moveExercise`. With `single` there's no outline, and no properties region.
- **Start cards** in Easy mode: one per type, as "Write a multiple-choice question". Each adds an exercise of its type and selects its first field.
- **Toasts** for every edit, with Undo, as ADR 0067 asks ("Exercise removed", Undo). Their text reaches screen readers through `ui`'s announcer.

Each family editor has the same 35-line `useEditorPreferences` hook today. learn-sdk takes a copy for now. The shared editor code, this hook among it, is moving into `ui` with notes-sdk's frame work; whichever of the two changes lands second switches LearnEditor to `ui`'s version, so the copy doesn't stay.

### Editor blocks

An exercise type's editor is an `EditorBlock`, as its player is a `PlayerBlock`:

```ts
interface EditorBlockProps<Payload> {
  readonly exercise: Exercise<Payload>;
  readonly onPayload: (payload: Payload) => void;
  readonly issues: readonly LearnIssue[]; // paths relative to the payload
  readonly profile: LanguageProfile;
  readonly messages: LearnEditorMessages;
  readonly announce: Announce;
}
```

- A block builds the whole new payload and calls `onPayload`, which becomes one `learn.setPayload`: types never add commands (ADR 0007).
- A type with no block shows its payload as "can't be edited here", and the rest of the exercise stays editable.
- The built-in blocks:
  - **Multiple choice:** questions, each with a prompt, two to six choices, which one is right (radio buttons in a group, one Tab stop), and an optional explanation. Add and remove questions and choices; the right answer follows its choice when choices are removed.
  - **Gap fill:** items, each a sentence written with `___`, its accepted answers, optional choices, and an optional translation.
  - **Word order:** items, each its tiles in the right order (a `ReorderableList`), other orders that are also right (each a `ReorderableList` of the same tiles, started from the right order), and an optional translation.
- Items, questions, choices, answers and tiles are added and removed with buttons, never only by drag ([ADR 0005](0005-accessible-exercise-types.md)).

### Typing: one undo step per burst, and never mid-composition

- A text field keeps what's typed and commits it as one command when it loses focus, on Enter in a one-line field, or after 700 ms without typing. A burst of typing is one undo step, as ADR 0007 asks.
- **Nothing commits while an input method is composing** (between `compositionstart` and `compositionend`). Thai, Chinese and Japanese input methods build a character in several steps, and committing halfway would put half-built text into the history. If the 700 ms pause ends during a composition, the field commits on `compositionend` instead.
- Undo, redo, adding, removing, moving, `flush()`, `getContent()` and unmounting commit pending typing first, so nothing typed is lost or applied out of order.
- **Fields in the taught language** (prompts, choices, sentences, answers, tiles) get `lang` and `dir` from the profile, with `spellcheck`, `autocorrect` and `autocapitalize` off: a browser checking Thai against an English dictionary only gets in the way. **Fields in the teacher's language** (titles, instructions, explanations, translations) take the page's language and the browser's defaults.

### Problems at their fields

- After each edit the session's `issues` are matched to fields by path. A field with an issue gets `aria-invalid` and its message, from `learnMessages`' `validation.<code>`, through `Field`'s `error`, which ties them with `aria-describedby`.
- An issue with no field on screen (a missing payload, an unknown field) shows in a list at the top of the exercise.
- The outline shows each exercise's number of problems, in text, not by colour alone.
- **Issues are shown, never blocking:** a teacher can leave a field empty and come back. A new exercise starts with its required fields empty, which is a draft's normal state.
- The number of problems is announced politely when it changes after an edit, not on every keystroke.

### Keyboard and screen reader

- Every action is a tool with a shortcut from the family registry ([sdk-core ADR 0030](../../../../docs/adr/0030-tools-and-keyboard-shortcuts.md)), listened for on the editor's root, never while typing a field's own keys. The session's `learn.undo`, `learn.redo` and `learn.remove-exercise` gain `learn.add-exercise`, `learn.move-exercise-up` and `learn.move-exercise-down`.
- **Focus is never lost:** after adding, focus goes to the new exercise's first field; after removing, to the outline's next exercise, or the previous one at the end; undo and redo keep focus where it is, unless its element went away, and then it goes to the outline.
- Lists use `ui`'s `ReorderableList`, with its keyboard moves and announcements.
- Headings follow `headingLevel` (sdk-core ADR 0058): the stage's exercise title is a heading at that level, and a block's sections nest below it.

### React lint

learn-sdk adopts `hm-lint-react` with every rule on, in this change ([ADR 0063](../../../../docs/adr/0063-a-lint-for-what-react-components-do-while-rendering.md)), and fixes the player's existing findings, so the package isn't left half-adopted.

### Text

- Interface text is in `src/messages/editor-en.ts`. `learnEditorMessages`, from `./react`, is the editor's one catalogue (ADR 0059): `learnMessages`, `uiMessages` and the editor's own text. Its type, `LearnEditorMessageCatalogue`, is exported from `.`.
- learn-sdk's adoption of ADR 0059 for what exists today (moving `tools.*` and `content.*` out of `learnMessages`, and renaming `playerCatalogue`) stays its own change, because it breaks hosts that override those keys. Until then the editor's tool labels come from `learnMessages` like the player's, and the editor's new catalogue already follows ADR 0059's names, so it won't need renaming.

### What stays out

- **Opening invalid content** to repair it (ADR 0007): the editor opens valid content or nothing.
- **Editing exercise ids,** which would cut exercises off from learners' progress (ADR 0007).
- **Rich text, images and audio** in exercises: the content format holds plain text.
- **Storage, autosave and drafts kept across visits:** the host's, through `onChange` and `getContent()`.
- **Courses, vocabulary and enrolments:** the host's own pages.
- **Drag and drop beyond `ReorderableList`'s own.**

### How it's tested

- Browser tests, in all three engines in CI: authoring each type with the keyboard only; every problem tied to its field; typing as one undo step; a Thai input-method composition, driven with composition events, that commits nothing until it ends, including when the pause ends mid-composition; pending typing committed on unmount; `single` refusing a second exercise; focus after adding, removing, undo and redo.
- axe with the WCAG 2.2 AA rules, in the empty, open, invalid and `single` states.
- Virtual screen-reader tests (ADR 0065) for adding, removing with its toast, moving in the outline, undo and redo, and the problem count.
- Screenshots per [ADR 0068](../../../../docs/adr/0068-a-faster-pull-request-loop.md): the frame's main states in every variant, each type's block in one.
- The Vite and Next examples get an editor page, under their strict CSP, with an end-to-end test.
- Size budgets for `./react` with and without the editor, in the pull request's table.

## Alternatives considered

- **An editor in each app:** the first host would have had one sooner, but every app would build and test its own, and the player and editor would drift apart. The maintainer chose the SDK.
- **A form outside the frame,** without tools, outline or modes: smaller, but every other family editor renders through the frame (ADR 0067), and teachers would meet a different editor here.
- **Committing every keystroke as a command:** simpler, but every character would be its own undo step, and an input method's half-built characters would enter the history.
- **Per-field commands** (`learn.setChoice`): rejected in ADR 0007, and still rejected; blocks build whole payloads.
- **A `valid` field in the session's snapshot:** the issues already decide it; adding it to the component's `onChange` keeps the session's API as it is.
- **A separate one-exercise component:** two components to keep in step, for what is the same editor with fewer tools.

## Consequences

- Hosts get authoring without writing an editor, and a school can store one exercise per row.
- learn-sdk's React entry grows by an editor; hosts that only play exercises pay for it only if their bundler can't drop it, which the size budgets measure.
- Each new exercise type needs an editor block as well as a player block, with its tests.
- The editor adds API only, so its changeset is a patch under the family's 0.x rule.
- The element comes next, and the editor gets its first release with it.
