# 0009. The `<hm-learn-editor>` element: LearnEditor on the family's element base

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

`LearnEditor` exists ([ADR 0008](0008-learn-editor.md)), and ADR 0008 says its element follows on the same component. Hosts without React, and hosts that embed the editor in another framework's page, need one tag with properties, methods and events, like the family's other editors.

[ADR 0001](0001-package-shape-props-and-ports.md) planned the `./element` entry for `defineLearnPlayerElement()` and `<hm-learn-player>`. The family's base, `createEditorElement` ([sdk-core ADR 0040](../../../../docs/adr/0040-editor-element-base.md)), names its tag `hm-<kind>-editor` and its events `hm-<kind>-editor-<name>`, so it can make the editor's element but not the player's.

Two things differ from the file editors' elements, which open a file by a property and have no content of their own:

1. **The editor reads its content once.** `initialContent`, `single` and `types` are read when the session opens; in React, a new `key` opens other content.
2. **Saving is the host's.** The React handle's `getContent()` is synchronous, but the element renders without `flushSync`, because it may connect during a host's React commit, so the editor may not have rendered when a host calls it.

## Decision

### `defineLearnEditorElement()` in `./element`, on `createEditorElement`

`./element` exports `defineLearnEditorElement()`, which registers `<hm-learn-editor>` on `createEditorElement`, and `learnEditorMessages`, as image-sdk's element entry exports its catalogue. Importing it registers nothing, and it's safe on a server. The element renders `LearnEditor` into its light DOM, so the package's styles apply, and the stylesheet makes the element a block, which the host sizes.

| Kind | Members |
|---|---|
| Attributes | `theme`, `locale`, `heading-level` (property `headingLevel`), and `single`, a boolean attribute |
| Properties | `initialContent`, `types`, `blocks`, `profile`, `limits`, `newId`, `messages`, `preferences`, `defaultPreferences` |
| Methods | `getContent()`, `flush()`, `undo()`, `redo()` |
| Events | `hm-learn-editor-change` (`{ draft, issues, valid }`), `-event`, `-error` (`{ code, details }`), `-preferences` |

- **`theme`** is the colour mode the host forces. It sets ui's `data-hm-theme` on the element, and the editor then offers no theme toggle, as in notes-sdk's element.
- **`preferences`** follow sdk-core ADR 0067: a host that keeps them sets `preferences` again from the `preferences` event; otherwise the element keeps its own.
- **`error`** carries the code and details, never the error object: details hold no content text ([ADR 0002](0002-content-as-hostile-input.md)).

### Another content opens a new editor

Setting `initialContent`, `single` or `types` to another value opens the editor afresh, with that content and no history: the mount function gives `LearnEditor` a new `key`. It's the element's version of React's `key`, and the only way to load other content, since the editor reads it once. Other properties update the editor in place.

### `getContent()` is asynchronous

`getContent()` returns a promise. It waits for the editor's first render, and for the editor that replaces the old one when content was just set, then commits typing and resolves with the content. It rejects as the handle throws: `INVALID_DOCUMENT` or a limit's code while the draft isn't valid, the error that kept the content from opening, and `ABORTED` if the element is removed first. `flush()`, `undo()` and `redo()` stay synchronous: before the first render there's no typing and no history, so they do nothing.

### The player's element is still to come

`<hm-learn-player>` needs either an option on `createEditorElement` for a tag that isn't an editor, or a base of its own in sdk-core. That's a decision for sdk-core, and the player's element waits for it; it will be exported from `./element` beside this one. This refines ADR 0001's `./element` row.

## Alternatives considered

- **A synchronous `getContent()`, as in React.** Rejected: it would throw for a host that sets content and saves at once, or calls it before React's first render, which a page without React can't see happen.
- **`content` as a live property, reloaded on every set.** Rejected: it would look like a controlled property, but edits don't flow back into it. Keeping React's name, `initialContent`, with the element's own `key` rule, says what it does.
- **A `load(content)` method instead of reloading on a new value.** Rejected: setting a property is how the family's elements take their inputs, and it works before the element is upgraded.
- **Waiting for the player's element, for one entry with both.** Rejected: the editor is what the first host, the school app, needs next, and the player's base needs its own decision.

## Consequences

- A host without React can author and save content with one tag and three lines of script; the Vite example's `element.html` shows it under a strict Content Security Policy.
- The element entry bundles the whole editor: 21.76 kB, with a ceiling of 23 kB.
- The element's methods differ from the React handle in one way, `getContent()` returning a promise; the API report and the README say so.
- The editor gets its first release with the element, as ADR 0008 planned.
