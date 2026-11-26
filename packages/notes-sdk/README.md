# notes-sdk

A client-side SDK for handwritten notes: a library of notebooks kept on the device, an ink engine for a stylus, paper templates, PDFs to write on, search, sound recorded alongside the ink, and backup and restore. Nothing leaves the device. It offers a headless core, a React editor (`NotesEditor`) and a `<hm-notes-editor>` custom element.

It publishes **`@hussmartinez/notes-sdk`**, and follows the family standards in [`STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md). Its own decisions are in [`docs/adr`](docs/adr).

> Status: `0.x`. The API may still change between minor versions.

## The React editor

```tsx
import { NotesEditor } from "@hussmartinez/notes-sdk/react";
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/notes-sdk/styles.css";

<div style={{ height: "100dvh" }}>
  <NotesEditor onViewChange={({ view }) => setFullScreen(view === "notebook")} />
</div>;
```

The editor shows the library, and an open notebook once one is chosen. It has no `file` or `onChange`: its documents are the notebooks of its library, which it keeps itself and saves as you write ([ADR 0003](docs/adr/0003-a-library-on-the-device.md)).

- **Styles: ui's stylesheet is required.** Import `@hussmartinez/ui/styles.css` once in your application, before `@hussmartinez/notes-sdk/styles.css`. The editor is built from [`@hussmartinez/ui`](https://www.npmjs.com/package/@hussmartinez/ui)'s components, and their focus rings and target sizes live there.
- **One copy of ui, sdk-core and pdf-sdk.** The SDK depends on all three. If your application uses any of them itself, depend on the same minor versions, and check that `npm ls @hussmartinez/ui @hussmartinez/sdk-core @hussmartinez/pdf-sdk` lists one version of each.
- **A bounded height.** `NotesEditor` fills the height of its container, and its views scroll within it. Give it a fixed height, or a grid row such as `minmax(0, 1fr)`.
- **Text.** `messages` overrides any text the editor shows, by key, including ui's. `locale` formats numbers, dates and plurals.
- **Theme and density** are ui's: set `data-hm-theme` and `data-hm-density` on any ancestor. Paper is white in every theme.

### Props

| Prop | Purpose |
|---|---|
| `store` | Where the library is kept. Defaults to this device (`createOpfsNotesStore()`) |
| `pdfEngine`, `assetsUrl` | The PDF engine, or where you serve `@hussmartinez/pdf-sdk`'s `dist/assets/` for the default one |
| `recorder` | What records sound. Defaults to the browser's microphone |
| `filePolicy` | Limits on files, pages and backups ([ADR 0004](docs/adr/0004-notes-limits.md)) |
| `onViewChange` | Called with `{ view: "library" }` or `{ view: "notebook", notebook }` |
| `onSaveFile` | Receives an exported PDF or a backup, in place of a browser download |
| `onEvent` | Anonymous usage events. They never carry titles, text, ink or file names |
| `initialSettings`, `onSettingsChange` | The tool in hand, colours and sizes, to start with and to keep |
| `tools`, `toolbar` | Which notebook tools exist, and how they're grouped and placed |
| `preferences`, `defaultPreferences`, `onPreferencesChange` | The person's mode, theme, tools layout, panels, density, motion and tips, as ui's `EditorPreferences`. The editor never stores them: keep them where you like. Without them it starts in Advanced mode, with the tools in a dock |
| `theme` | `"light"`, `"dark"` or `"system"`, over the preferences' theme. Unset, the editor inherits the page's |
| `headingLevel` | The level of the editor's heading, 2 to 6, and 2 by default |
| `messages`, `locale`, `icons` | Text overrides, the formatting locale, and icon components by name |
| `className`, `classNames`, `unstyled` | Extra classes on the root and each part, or no visual styles |

A ref gives `NotesEditorHandle`: its `library`, `open(notebookId)` and `close()`.

### Writing

- **A pen or a mouse writes.** The pen's pressure sets the line's width, and its barrel button, or eraser end, erases while held.
- **Fingers pan and pinch to zoom,** and a resting palm does nothing. "Write with a finger" lets a finger write on devices without a pen.
- **Tools:** pen, highlighter, an eraser for whole strokes or parts of them, a lasso to move, resize, recolour, duplicate and delete, text boxes, pictures, and links between pages.
- **Shapes:** hold the pen still at the end of a stroke and a line, rectangle, ellipse or triangle is straightened. "Straighten shapes" does it for every stroke.
- **Pages:** add, reorder and delete them from the sidebar, which also holds the outline, search and recordings.
- **Undo and redo** cover every edit, 500 steps deep.

How the engine reads the pen is in [ADR 0002](docs/adr/0002-the-ink-engine.md).

### The notebook's frame

An open notebook renders through ui's editor frame ([ADR 0008](docs/adr/0008-the-notebook-on-ui-s-frame.md)): the blue top bar, the tools in a dock over the foot of the pages or in a sidebar, the tool's options in the properties panel, and the recording's transport at the foot. Easy, Advanced and Expert modes decide which tools are listed; the command palette (`Ctrl+K`, `⌘K`) reaches every one in every mode. In Easy mode, an empty notebook opens on start cards. Edits show a toast with Undo.

### Tools, the toolbar and shortcuts

The notebook's tools are in `notesTools`. Shortcuts work while focus is inside the notebook.

| Tool | Shortcut | What it does |
|---|---|---|
| `notes.close` | none | Saves, and goes back to the library |
| `notes.undo`, `notes.redo` | `Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y` (`⌘Z`, `⇧⌘Z`) | Undo and redo |
| `notes.pen`, `notes.highlighter`, `notes.eraser` | `P`, `H`, `E` | Put the tool in hand |
| `notes.lasso`, `notes.text`, `notes.link`, `notes.hand` | `L`, `T`, `K`, `V` | Select, type, link to a page, move the page |
| `notes.image` | none | Places a PNG, JPEG, WebP or GIF picture |
| `notes.straighten`, `notes.finger` | none | Straighten every shape; let a finger write |
| `notes.add-page`, `notes.delete-page` | none | Add a page after the current one; delete the current one |
| `notes.zoom-in`, `notes.zoom-out`, `notes.zoom-fit` | `+` or `=`, `-`, `0` | Zoom |
| `notes.sidebar`, `notes.search` | none, `Ctrl+F` (`⌘F`) | The sidebar, and its search |
| `notes.record` | none | Starts and stops recording sound |
| `notes.export-pdf` | none | Exports the notebook as a PDF |
| `notes.select-all`, `notes.delete-selection` | `Ctrl+A` (`⌘A`), `Delete` or `Backspace` | Select everything on the page; delete the selection |

Pass a subset's ids as `tools`, and arrange them with `toolbar`: back to the library, undo, redo, the sidebar, search, the zoom and Export as PDF go in the top bar and over the pages, and the rest in the tools panel. An unknown id throws when the editor renders.

## Where notes are kept

- **On the device,** in the browser's origin private file system, with an index in IndexedDB. There's no account and no server.
- **Saved as you write:** 400 milliseconds after a change, when the tab is hidden, and when the page goes away. The header says "Saved", "Saving…" or "Not saved", with a button to try again.
- **One tab per notebook.** A notebook open in another tab says so, instead of two tabs overwriting each other.
- **The browser can clear a site's data.** The library shows a notice until the browser has promised to keep it (`navigator.storage.persist()`), which an installed web app usually gets. Tell your users to back up.
- **Your own storage:** pass a `store` that implements `NotesStore`. `createMemoryNotesStore()` keeps nothing, for tests and demos.

### Backup and restore

- **A backup is a standard zip** of the library's own documents and files, which ordinary tools open. The library reminds when notebooks have changed and two weeks have passed without one.
- **Restore never overwrites.** A notebook the library doesn't have is added; one it has, unchanged, is left alone; one that has changed since is restored beside it. A backup with a fault is refused whole, with the library untouched.

The format and the rules are in [ADR 0005](docs/adr/0005-backup-and-restore.md) and [`docs/formats`](docs/formats).

## PDFs

- **Import a PDF** and it becomes a notebook, one page per PDF page, with its text searchable.
- **Export a notebook** and the ink is vector paths: sharp at any zoom, a few kilobytes a page. Pages over a PDF keep the original page, with the ink drawn on it.
- **Not exported yet:** links between pages and the outline.

PDFs are read and assembled by [`@hussmartinez/pdf-sdk`](https://www.npmjs.com/package/@hussmartinez/pdf-sdk), in workers ([ADR 0006](docs/adr/0006-pdfs-under-the-ink-and-as-export.md)).

## Content Security Policy

The SDK makes no request. With pdf-sdk's workers inlined, which is the default:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; style-src 'self'; media-src blob:
```

- **`worker-src blob:` and `'wasm-unsafe-eval'`** are pdf-sdk's, for importing and exporting PDFs. Serve its `dist/assets/` yourself and pass `assetsUrl` to use `worker-src 'self'` instead; see pdf-sdk's README.
- **`media-src blob:`** plays recordings.
- **The microphone** needs the browser's permission, and a `Permissions-Policy` that allows `microphone` for your origin if you set one.

## The custom element

```ts
import { defineNotesEditorElement } from "@hussmartinez/notes-sdk/element";
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/notes-sdk/styles.css";

defineNotesEditorElement();
```

```html
<hm-notes-editor theme="system" locale="en"></hm-notes-editor>
```

- **Attributes:** `theme`, `locale`, `tools` (ids separated by spaces) and `heading-level`.
- **Properties:** `store`, `pdfEngine`, `recorder`, `assetsUrl`, `filePolicy`, `messages`, `preferences` and `defaultPreferences`.
- **Methods:** `open(notebookId)` and `close()`.
- **Events:** `hm-notes-editor-view`, `hm-notes-editor-settings`, `hm-notes-editor-preferences` and `hm-notes-editor-event`, each with its value as `detail`.

It renders into the light DOM, so React and React DOM must be installed.

## The headless core

The `.` entry has no React and touches no browser API on import, so it runs on a server.

```ts
import {
  createNotesLibrary,
  createNotesPdfEngine,
  createOpfsNotesStore,
} from "@hussmartinez/notes-sdk";

const library = createNotesLibrary({ store: createOpfsNotesStore(), pdf: createNotesPdfEngine() });
await library.load();

const id = await library.createNotebook({ title: "Physics", template: "grid" });
const session = await library.open(id);
const [page] = session.getSnapshot().notebook.pages;
await session.loadPage(page.id);
session.execute({ type: "notes.addItems", page: page.id, items: [stroke] });
session.undo();
await session.close();

const backup = await library.backup();
```

- **`createNotesLibrary`** is the library: folders, notebooks, the bin, `importPdf`, `backup`, `restore`, `search` and `exportPdf`.
- **`openNotesSession`** is one open notebook: `execute`, `undo`, `redo`, `flush`, and a snapshot to subscribe to.
- **Commands** are plain data. `applyNotesCommand` returns the new state and the command that undoes it, and `readNotesCommandDocument` reads one from untrusted JSON.
- **Documents** are versioned JSON with strict readers: `readNotesNotebookDocument`, `readNotesPageDocument`, `readNotesLibraryDocument` and `readNotesBackupManifest`. Their JSON Schemas ship in `formats/`.
- **`writeNotesPdf`** writes pages as a PDF with the ink as vector paths.
- **Errors** are `NotesError`, with a stable `code` and `details`. Show users `messages.error(error)` from a catalogue built with `notesMessages`, never `error.message`.

### Units

Every position and length is an integer, 100 units to a PDF point (1/72 inch), from the page's top-left corner. A stroke's path is `x, y, pressure` triples, with pressure from 0 to 1000.

## Limits

| Limit | Default maximum |
|---|---|
| `maxFileSize` | 100 MB for an imported PDF or picture |
| `maxPages` | 5,000 pages in a notebook |
| `maxPageItems` | 50,000 items on a page |
| `maxImagePixels` | 50 megapixels in a picture |
| `maxBackupSize` | 4 GB for a backup, and for what it holds |
| `maxBackupEntries` | 500,000 files in a backup |

Change them with `filePolicy`. A violation is a `NotesError` whose `details` name the limit.

## Accessibility

- **The keyboard reaches everything but handwriting itself:** the library, dialogs, the tools as one tab stop, tool keys, the command palette, pages, the outline, search, text boxes, and moving or deleting a selection.
- **Pages are labelled regions.** Canvases are hidden from assistive technology, and a page's typed text is repeated as text.
- **Results are announced:** a notebook's edits, undo and redo, exports and recordings as toasts, through ui's announcer; selections, and the library's backups, as before.

## Browsers

The last two major versions of Chrome, Edge, Firefox and Safari. The first device is an Android tablet with a stylus, in Chrome. The store on the device needs the origin private file system with `createWritable()`, and IndexedDB; without them it fails with `UNSUPPORTED_ENVIRONMENT`, naming the feature.

## Development

```sh
pnpm install
pnpm --filter "@hussmartinez/notes-sdk^..." build   # the family's packages it builds on, once
pnpm --filter @hussmartinez/notes-sdk verify:fast   # types, unit tests, dependency rules, the API report
pnpm --filter @hussmartinez/notes-sdk verify        # everything CI runs; it needs Docker for the browser tests
```

Browser tests send real pen input, with pressure, through Chromium's protocol ([ADR 0002](docs/adr/0002-the-ink-engine.md)).

## Licence

[Apache-2.0](LICENSE).
