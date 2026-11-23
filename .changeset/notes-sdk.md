---
"@hussmartinez/notes-sdk": minor
---

The first release of `@hussmartinez/notes-sdk`: handwritten notes kept on the device.

- **`NotesEditor`**, from `./react`, is the whole editor: a library of notebooks and folders and, once one is open, pages to write on with a stylus. `defineNotesEditorElement()`, from `./element`, registers it as `<hm-notes-editor>`. Import `@hussmartinez/ui/styles.css`, then `@hussmartinez/notes-sdk/styles.css`.
- **Writing:** a pen with pressure, a highlighter, an eraser for whole strokes or parts of them, a lasso to move, resize and recolour, shapes that straighten, text boxes, pictures, and links between pages, with undo and redo. The pen writes while fingers pan and zoom, and a resting palm does nothing.
- **Notebooks:** blank, lined, grid and dotted paper; pages to add, reorder and delete; an outline; search in typed text and in PDFs' text; sound recorded alongside the ink.
- **PDFs:** `library.importPdf(file)` makes a notebook to write on, and `library.exportPdf(id)` writes one with the ink as vector paths.
- **Storage:** `createOpfsNotesStore()` keeps the library in the browser's private file system, saved as you write. `library.backup()` writes a standard zip, and `library.restore(file)` reads one without ever overwriting a notebook.
- **The headless core,** from `.`, runs on a server: `createNotesLibrary`, `openNotesSession`, `applyNotesCommand`, the strict readers of the `hm-notes-*` formats, and `writeNotesPdf`.
