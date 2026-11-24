# @hussmartinez/notes-sdk

## 0.1.1

### Patch Changes

- [#215](https://github.com/ie-huss-martinez/sdk-core/pull/215) [`cf42776`](https://github.com/ie-huss-martinez/sdk-core/commit/cf42776a15b41cd168fb00cd234d9695f75a9930) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Redraw the library and the open notebook. The library has a rail of places beside a grid of notebook covers and folders drawn in CSS. An open notebook has the notebook's title on a tab over a blue bar of tools. Undo and redo, the tool's options (three widths and a palette, with any colour and width a tap away), the page number and the zoom float over the pages. Covers deal in, lift on hover, and tools spring into place. Every motion stops when the device asks for less. The new design values are `--hm-notes-*` tokens a host can override on the editor.
- Updated dependencies [[`32ce51f`](https://github.com/ie-huss-martinez/sdk-core/commit/32ce51f5cf8d7fcfb3edf0ef42162f81e0fdf067), [`32ce51f`](https://github.com/ie-huss-martinez/sdk-core/commit/32ce51f5cf8d7fcfb3edf0ef42162f81e0fdf067)]:
  - @hussmartinez/pdf-sdk@0.7.1
  - @hussmartinez/ui@0.16.7

## 0.1.0

### Minor Changes

- [#210](https://github.com/ie-huss-martinez/sdk-core/pull/210) [`b87a8f8`](https://github.com/ie-huss-martinez/sdk-core/commit/b87a8f8ff0101671b203aa8b1372a15fe2567506) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The first release of `@hussmartinez/notes-sdk`: handwritten notes kept on the device.
  
  - **`NotesEditor`**, from `./react`, is the whole editor: a library of notebooks and folders and, once one is open, pages to write on with a stylus. `defineNotesEditorElement()`, from `./element`, registers it as `<hm-notes-editor>`. Import `@hussmartinez/ui/styles.css`, then `@hussmartinez/notes-sdk/styles.css`.
  - **Writing:** a pen with pressure, a highlighter, an eraser for whole strokes or parts of them, a lasso to move, resize and recolour, shapes that straighten, text boxes, pictures, and links between pages, with undo and redo. The pen writes while fingers pan and zoom, and a resting palm does nothing.
  - **Notebooks:** blank, lined, grid and dotted paper; pages to add, reorder and delete; an outline; search in typed text and in PDFs' text; sound recorded alongside the ink.
  - **PDFs:** `library.importPdf(file)` makes a notebook to write on, and `library.exportPdf(id)` writes one with the ink as vector paths.
  - **Storage:** `createOpfsNotesStore()` keeps the library in the browser's private file system, saved as you write. `library.backup()` writes a standard zip, and `library.restore(file)` reads one without ever overwriting a notebook.
  - **The headless core,** from `.`, runs on a server: `createNotesLibrary`, `openNotesSession`, `applyNotesCommand`, the strict readers of the `hm-notes-*` formats, and `writeNotesPdf`.

### Patch Changes

- Updated dependencies [[`b87a8f8`](https://github.com/ie-huss-martinez/sdk-core/commit/b87a8f8ff0101671b203aa8b1372a15fe2567506), [`4c7b4b6`](https://github.com/ie-huss-martinez/sdk-core/commit/4c7b4b63e49f18ec57934267c02d46c10d5b65b5), [`4c7b4b6`](https://github.com/ie-huss-martinez/sdk-core/commit/4c7b4b63e49f18ec57934267c02d46c10d5b65b5)]:
  - @hussmartinez/pdf-sdk@0.7.0
  - @hussmartinez/ui@0.16.6
