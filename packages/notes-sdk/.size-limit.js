/**
 * Size budgets, of two kinds (sdk-core ADR 0055 and ADR 0056), in brotli.
 *
 * Entry budgets (`entryBudget`) are ceilings: the size of each built entry
 * with the chunks it loads statically, as built, unminified. They cover
 * everything in an entry, including code no scenario imports.
 *
 * Import budgets (`importBudget`) are what an application ships when it
 * imports part of an entry: bundled and minified with esbuild, without React
 * and the family's packages. Each entry whose exports can be used apart has:
 * - a floor, the cheapest import a host would really make, which catches
 *   code that leaks into every import. Its limit is the measurement rounded
 *   up to the next 0.1 kB, and a floor that moves is a leak to fix, never a
 *   budget to raise;
 * - each export over about 2 kB on its own;
 * - what a typical application imports.
 * Other limits are the measurement rounded up to the next 0.5 kB.
 * `pnpm exec hm-size --exports dist/index.js` lists every export's cost.
 *
 * perfect-freehand is a runtime dependency of about 2 kB, so every scenario
 * that draws a stroke's outline counts it: `strokeOutline`, the PDF writer,
 * and everything built on them.
 *
 * This SDK has no worker and no lazy chunks: PDFs are read and assembled by
 * `@hussmartinez/pdf-sdk`, which has budgets of its own.
 */
import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";

const core = "dist/index.js";
const react = "dist/react.js";

/** A budget measured on the built files, not bundled by esbuild. */
const built = (budget) => ({ ...budget, brotli: true, disablePlugins: ["@size-limit/esbuild"] });

export default [
  // The server-safe core (.).
  entryBudget({ name: "Core (.), as built", entry: core, limit: "37 kB" }),
  importBudget({
    // The floor: the error class, which a host uses to show the library's errors.
    name: "Core: the floor, NotesError",
    entry: core,
    imports: "{ NotesError }",
    limit: "0.2 kB",
  }),
  importBudget({
    name: "Core: applyNotesCommand",
    entry: core,
    imports: "{ applyNotesCommand }",
    limit: "2.5 kB",
  }),
  importBudget({
    name: "Core: readNotesCommandDocument",
    entry: core,
    imports: "{ readNotesCommandDocument }",
    limit: "3 kB",
  }),
  importBudget({
    name: "Core: strokeOutline, with perfect-freehand",
    entry: core,
    imports: "{ strokeOutline }",
    limit: "3 kB",
  }),
  importBudget({
    name: "Core: createMemoryNotesStore",
    entry: core,
    imports: "{ createMemoryNotesStore }",
    limit: "4 kB",
  }),
  importBudget({
    name: "Core: openNotesSession",
    entry: core,
    imports: "{ openNotesSession }",
    limit: "4.5 kB",
  }),
  importBudget({
    name: "Core: createOpfsNotesStore",
    entry: core,
    imports: "{ createOpfsNotesStore }",
    limit: "6 kB",
  }),
  importBudget({
    name: "Core: writeNotesPdf",
    entry: core,
    imports: "{ writeNotesPdf }",
    limit: "8.5 kB",
  }),
  importBudget({
    // The library brings the sessions, backup and restore, and the PDF writer.
    name: "Core: createNotesLibrary",
    entry: core,
    imports: "{ createNotesLibrary }",
    limit: "22.5 kB",
  }),
  importBudget({
    // What a headless application uses together: a library on the device, with PDFs.
    name: "Core: a headless app's set",
    entry: core,
    imports: "{ createNotesLibrary, createOpfsNotesStore, createNotesPdfEngine }",
    limit: "26 kB",
  }),

  // The React entry (./react).
  entryBudget({ name: "React (./react), as built", entry: react, limit: "70 kB" }),
  importBudget({
    // The floor: the components' catalogue, which every component reads.
    name: "React: the floor, notesEditorMessages",
    entry: react,
    imports: "{ notesEditorMessages }",
    limit: "3.2 kB",
  }),
  importBudget({
    name: "React: NotesLibraryView",
    entry: react,
    imports: "{ NotesLibraryView }",
    limit: "5.5 kB",
  }),
  importBudget({
    // The open notebook: the ink engine, the canvas painting, the tools and the sidebar.
    name: "React: NotesNotebook",
    entry: react,
    imports: "{ NotesNotebook }",
    limit: "23.5 kB",
  }),
  importBudget({
    // The provider brings the library and the stores.
    name: "React: NotesProvider",
    entry: react,
    imports: "{ NotesProvider }",
    limit: "31 kB",
  }),
  importBudget({
    // What a typical application imports: the whole editor.
    name: "React: NotesEditor",
    entry: react,
    imports: "{ NotesEditor }",
    limit: "53 kB",
  }),

  // The element entry (./element) mounts the whole editor, so it has only a ceiling.
  entryBudget({ name: "Element (./element), as built", entry: "dist/element.js", limit: "71 kB" }),

  built({ name: "Stylesheet (./styles.css)", path: "dist/styles.css", limit: "4 kB" }),
];
