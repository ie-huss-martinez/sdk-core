# 0001. A familiar layout, with assets of our own

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** in sdk-core, [ADR 0003](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0003-hm-namespace.md) (names), [ADR 0006](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0006-design-tokens-and-theming.md) (tokens), [ADR 0014](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md) (accessibility), [ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md) (tools) and [ADR 0058](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0058-heading-levels-in-editors.md) (heading levels)

## Context

`notes-sdk` is the editor behind a handwriting notes app. People who write by hand on a tablet already know how such an app is laid out: a library of notebook covers, a toolbar across the top of an open notebook, and a sidebar of page thumbnails. Those are conventions of the category, like a word processor's ruler. Someone switching apps expects them.

The products that set those conventions also have distinctive looks: their names, icons, paper templates, cover art, fonts and colours. Copying any of that into a public repository invites a takedown, and makes the app a clone instead of a member of this family.

The other editors of the family open one file and export it. This one shows a library and, inside it, a notebook, so the standard editor props don't all fit.

## Decision

### The layout follows the category

- **The library** is a grid of folders and notebook covers, with a header of actions, a search field and the trail of folders. The bin is a view of the same grid.
- **An open notebook** has one toolbar across the top, built from the registered tools (sdk-core ADR 0030), a row of options for the tool in hand, and the pages in a scrolling column. The sidebar shows the pages as thumbnails, the outline, search and recordings, and is closed until asked for, so the page gets the width.
- **`NotesEditor` is both views.** It reports which one shows through `onViewChange`, so a host can change what's around it. A host that wants only one of them uses `NotesLibraryView` or `NotesNotebook` inside a `NotesProvider`.

### Every asset is our own

- **Icons** come from `@hussmartinez/ui`. For the nine it has no glyph for (eraser, lasso, link, microphone, folder, folder with a plus, bookmark, a touching finger, shapes) the SDK draws its own, in `src/react/icons.tsx`, the way ui's are drawn: a 24-unit grid, a stroke of 2 with round caps and joins, in `currentColor`. A host's `icons` prop replaces any of them. They can move to ui when a second package needs them.
- **Paper templates** are four, drawn by one function, `templateMarks`: blank, lined (a rule every 24 points), grid and dotted (every 15 points), in one quiet blue-grey. The same marks are drawn on screen and written to an exported PDF.
- **Paper is white in every theme.** Ink colours are chosen against it, and a page that changed colour with the theme would change what was written on it.
- **Covers** are drawn in CSS from the design system's tokens: a board in one of five semantic colours, a darker spine, and a label plate ruled like the notebook's paper, with its title.
- **Colours, type and spacing** are ui's tokens. The pen's and the highlighter's colour sets are our own choice of six and five.
- **Nothing is copied** from another product: no name, logo, icon, illustration, template, font, style or screenshot.

### Where the standard props differ

- **No `file`, `onChange` or `initialFile`.** The editor's documents are the notebooks of its library, which it keeps and saves itself ([ADR 0003](0003-a-library-on-the-device.md)).
- **`store`, `pdfEngine` and `recorder`** take the place of `engine` and `processor`: the ports this SDK has.
- **`onSaveFile`** receives an exported PDF or a backup in place of a browser download.
- **`headingLevel`** sets the level of the editor's one heading: the library's title, or the open notebook's (sdk-core ADR 0058).
- **Theme and density** are ui's attributes on any ancestor, as in the other editors.

### Accessibility

- **Handwriting needs a pointer.** Everything else works from the keyboard: the library, dialogs, the toolbar as one tab stop, tool keys, undo and redo, pages (ui's reorderable list moves them with Alt and the arrow keys), the outline, search, text boxes, selecting everything on a page, moving a selection with the arrow keys, and deleting it.
- **The canvases are hidden from assistive technology.** Each page is a labelled region, and its typed text is repeated as real text.
- **Results are announced** through ui's announcer: undo, redo, pages added and deleted, selections, exports and backups.

## Alternatives considered

- **A layout of our own invention:** it would cost every new user the habits they bring, for no gain.
- **A close copy of one product's look:** it risks a takedown of the app or of this repository.
- **Adding the nine icons to ui now:** right in the long run, but it would put a ui release in the way of this package's first one. The glyphs follow ui's drawing rules so the move is a rename.
- **Paper that follows the theme:** dark paper needs every ink colour remapped, and exported PDFs would no longer match the screen.

## Consequences

- People who know the category find their way at once, and nothing in the repository belongs to anyone else.
- The SDK carries nine glyphs and four templates of its own to maintain.
- A host that needs the library and the notebook in different places composes the building blocks itself.
