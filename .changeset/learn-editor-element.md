---
"@hussmartinez/learn-sdk": patch
---

Add `<hm-learn-editor>`, `LearnEditor` as a custom element, to `@hussmartinez/learn-sdk/element` (ADR 0009).

- **`defineLearnEditorElement()`** registers it; importing the entry registers nothing, and is safe on a server. It renders the editor into its light DOM.
- **Attributes** `theme`, `locale`, `heading-level` and `single`; **properties** `initialContent`, `types`, `blocks`, `profile`, `limits`, `newId`, `messages`, `preferences` and `defaultPreferences`. Setting `initialContent`, `single`, `types`, `limits` or `newId` again opens the editor afresh, as a new React `key` does.
- **Methods** `getContent()`, which returns a promise that waits for the editor's first render, `flush()`, `undo()` and `redo()`.
- **Events** `hm-learn-editor-change` with `{ draft, issues, valid }`, `-event`, `-error` with `{ code, details }`, and `-preferences`.
- The entry also exports `learnEditorMessages`.
