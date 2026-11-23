import { describe, expect, it } from "vitest";
import { createMemoryNotesStore } from "../../src/adapters/memory-store/memory-store.js";
import type { NotesStore } from "../../src/core/ports/notes-store.js";
import { createNotesLibrary, type NotesLibraryEvent } from "../../src/core/session/library.js";
import { createFakePdfEngine, fakePdf } from "../fixtures/fake-pdf.js";
import { countingIds, stroke, text, tickingClock } from "../fixtures/notes.js";

function setup(store: NotesStore = createMemoryNotesStore()) {
  const events: NotesLibraryEvent[] = [];
  const pdf = createFakePdfEngine();
  const library = createNotesLibrary({
    store,
    pdf,
    now: tickingClock(),
    newId: countingIds(),
    saveDelay: 60_000,
    onEvent: (event) => events.push(event),
  });
  return { store, pdf, library, events };
}

const titles = (library: ReturnType<typeof setup>["library"]) =>
  library.getSnapshot().index.notebooks.map((notebook) => notebook.title);

describe("createNotesLibrary", () => {
  it("starts empty and ready once loaded", async () => {
    const { library } = setup();
    expect(library.getSnapshot().status).toBe("loading");
    await library.load();
    expect(library.getSnapshot()).toMatchObject({
      status: "ready",
      index: { folders: [], notebooks: [], lastBackupAt: null },
      persistence: { persisted: false },
    });
  });

  it("creates a notebook with one page, listed in the index and stored", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "  Physics  ", template: "grid" });
    const [summary] = library.getSnapshot().index.notebooks;
    expect(summary).toMatchObject({
      id,
      title: "Physics",
      template: "grid",
      cover: "blue",
      folder: null,
      pageCount: 1,
      deletedAt: null,
    });
    const stored = await store.readNotebook(id);
    expect(stored?.pages).toEqual([
      expect.objectContaining({ width: 59_500, height: 84_200, template: "grid" }),
    ]);
    expect((await store.readIndex())?.notebooks).toHaveLength(1);
  });

  it("refuses an empty or over-long title", async () => {
    const { library } = setup();
    await library.load();
    await expect(library.createNotebook({ title: "   " })).rejects.toMatchObject({
      code: "INVALID_COMMAND",
    });
    await expect(library.createNotebook({ title: "x".repeat(201) })).rejects.toMatchObject({
      code: "INVALID_COMMAND",
    });
  });

  it("rebuilds a lost index from the notebooks the store holds", async () => {
    const first = setup();
    await first.library.load();
    await first.library.createNotebook({ title: "Kept" });
    // The index is lost, as if the browser cleared IndexedDB but not the files.
    const { store } = first;
    const lost: NotesStore = { ...store, readIndex: async () => undefined };
    const { library } = setup(lost);
    await library.load();
    expect(titles(library)).toEqual(["Kept"]);
  });

  it("keeps the index up to date as an open notebook is saved", async () => {
    const { library } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const session = await library.open(id);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    session.execute({
      type: "notes.addPages",
      at: 1,
      pages: [{ info: { ...page, id: "second" }, items: [stroke("s1")] }],
    });
    session.execute({ type: "notes.rename", title: "Mechanics" });
    await session.close();
    expect(library.getSnapshot().index.notebooks[0]).toMatchObject({
      title: "Mechanics",
      pageCount: 2,
    });
  });

  it("moves a notebook to the bin and back, and deletes it for good", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    await library.binNotebook(id);
    expect(library.getSnapshot().index.notebooks[0]?.deletedAt).toBeTypeOf("number");
    expect(await store.readNotebook(id)).toBeDefined();
    await library.restoreNotebook(id);
    expect(library.getSnapshot().index.notebooks[0]?.deletedAt).toBeNull();
    await library.deleteNotebook(id);
    expect(library.getSnapshot().index.notebooks).toEqual([]);
    expect(await store.readNotebook(id)).toBeUndefined();
    await expect(library.binNotebook(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("nests folders, and moves a removed folder's contents up a level", async () => {
    const { library } = setup();
    await library.load();
    const school = await library.createFolder("School");
    const physics = await library.createFolder("Physics", school);
    const id = await library.createNotebook({ title: "Waves", folder: physics });
    await library.renameFolder(physics, "Physics 101");
    expect(library.getSnapshot().index.folders).toEqual([
      expect.objectContaining({ id: school, parent: null }),
      expect.objectContaining({ id: physics, name: "Physics 101", parent: school }),
    ]);
    await library.deleteFolder(physics);
    expect(library.getSnapshot().index.notebooks[0]).toMatchObject({ id, folder: school });
    await expect(library.moveNotebook(id, "nowhere")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await library.moveNotebook(id, null);
    expect(library.getSnapshot().index.notebooks[0]?.folder).toBeNull();
  });

  it("renames, recolours and duplicates a notebook", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const session = await library.open(id);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    session.execute({ type: "notes.addItems", page: page.id, items: [text("t1", "Entropy")] });
    await session.close();

    await library.renameNotebook(id, "Thermodynamics");
    await library.setNotebookCover(id, "red");
    const copy = await library.duplicateNotebook(id, "Thermodynamics (copy)");
    expect(titles(library)).toEqual(["Thermodynamics", "Thermodynamics (copy)"]);
    expect((await store.readNotebook(id))?.cover).toBe("red");
    expect((await store.readPage(copy, page.id))?.items).toHaveLength(1);
    expect(await library.search("entropy")).toHaveLength(2);
  });

  it("imports a PDF as a notebook, one page per PDF page, with its text indexed", async () => {
    const { library, store, events } = setup();
    await library.load();
    const file = new File([fakePdf(["First page", "Second page"])], "Lecture 3.pdf");
    const progress: number[] = [];
    const id = await library.importPdf(file, {
      title: "Imported PDF",
      onProgress: ({ fraction }) => progress.push(fraction),
    });
    const stored = await store.readNotebook(id);
    expect(stored?.title).toBe("Lecture 3");
    expect(stored?.pages).toHaveLength(2);
    expect(stored?.pages[1]).toMatchObject({
      width: 61_200,
      height: 79_200,
      template: "blank",
      background: { pageIndex: 1, pdf: { mediaType: "application/pdf", size: file.size } },
    });
    expect(await store.listAssets(id)).toHaveLength(1);
    expect(progress.at(-1)).toBe(1);
    const [hit] = await library.search("second");
    expect(hit).toMatchObject({ notebook: id, source: "pdf" });
    // The file's name names the notebook, and never reaches an event.
    expect(events).toContainEqual({ type: "pdf_imported", pageCount: 2 });
    expect(JSON.stringify(events)).not.toContain("Lecture");
  });

  it("refuses a file that isn't a PDF, and stores nothing", async () => {
    const { library, store, events } = setup();
    await library.load();
    await expect(
      library.importPdf(new Blob(["just some text"]), { title: "Imported PDF" }),
    ).rejects.toMatchObject({ code: "INVALID_PDF" });
    expect(library.getSnapshot().index.notebooks).toEqual([]);
    expect(await store.listNotebooks()).toEqual([]);
    expect(events).toContainEqual({ type: "failed", operation: "import", code: "INVALID_PDF" });
  });

  it("leaves binned notebooks out of search", async () => {
    const { library } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const session = await library.open(id);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    session.execute({ type: "notes.addItems", page: page.id, items: [text("t1", "Entropy")] });
    await session.close();
    expect(await library.search("entropy")).toHaveLength(1);
    await library.binNotebook(id);
    expect(await library.search("entropy")).toEqual([]);
  });

  it("backs up and restores into another library, keeping folders and ink", async () => {
    const source = setup();
    await source.library.load();
    const folder = await source.library.createFolder("School");
    const id = await source.library.createNotebook({ title: "Physics", folder });
    const session = await source.library.open(id);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    session.execute({
      type: "notes.addItems",
      page: page.id,
      items: [stroke("s1"), text("t1", "Entropy")],
    });
    // Not closed: a backup saves what's open first.
    const backup = await source.library.backup();
    expect(source.library.getSnapshot().index.lastBackupAt).toBeTypeOf("number");
    expect(source.events).toContainEqual({ type: "backup_created", notebooks: 1 });

    const target = setup();
    await target.library.load();
    const report = await target.library.restore(backup);
    expect(report.restored).toHaveLength(1);
    expect(target.library.getSnapshot().index.folders).toEqual([
      expect.objectContaining({ name: "School" }),
    ]);
    expect(target.library.getSnapshot().index.notebooks[0]).toMatchObject({
      id,
      title: "Physics",
      folder,
    });
    expect((await target.store.readPage(id, page.id))?.items.map((item) => item.id)).toEqual([
      "s1",
      "t1",
    ]);
    expect(await target.library.search("entropy")).toHaveLength(1);

    // The same backup again changes nothing.
    const again = await target.library.restore(backup);
    expect(again).toMatchObject({ restored: [], unchanged: [id] });
    expect(target.library.getSnapshot().index.notebooks).toHaveLength(1);
    await session.close();
  });

  it("takes a binned notebook out of the bin when a backup that holds it is restored", async () => {
    const { library } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const backup = await library.backup();
    await library.binNotebook(id);
    const report = await library.restore(backup);
    expect(report).toMatchObject({ restored: [], unchanged: [id] });
    expect(library.getSnapshot().index.notebooks).toEqual([
      expect.objectContaining({ id, deletedAt: null }),
    ]);
  });

  it("reads a notebook's file without opening it", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const asset = `sha256:${"a".repeat(64)}`;
    await store.writeAsset(id, asset, new Blob(["picture"]));
    await expect((await library.readAsset(id, asset)).text()).resolves.toBe("picture");
    await expect(library.readAsset(id, `sha256:${"b".repeat(64)}`)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { kind: "asset" },
    });
  });

  it("refuses a file that isn't a backup, and leaves the library as it was", async () => {
    const { library, events } = setup();
    await library.load();
    await library.createNotebook({ title: "Physics" });
    await expect(library.restore(new Blob(["not a zip"]))).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "malformed-archive" },
    });
    expect(titles(library)).toEqual(["Physics"]);
    expect(events).toContainEqual({
      type: "failed",
      operation: "restore",
      code: "INVALID_DOCUMENT",
    });
  });

  it("exports a notebook of plain pages as a PDF it writes itself", async () => {
    const { library, pdf } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const bytes = await library.exportPdf(id);
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.7");
    expect(pdf.assemblies).toEqual([]);
  });

  it("exports pages over a PDF by drawing the ink over the PDF's own pages", async () => {
    const { library, pdf } = setup();
    await library.load();
    const id = await library.importPdf(new Blob([fakePdf(["One", "Two"])]), { title: "Imported" });
    const bytes = await library.exportPdf(id);
    expect(new TextDecoder().decode(bytes)).toBe("assembled:2");
    const [assembly] = pdf.assemblies;
    expect(assembly?.sources.map((source) => source.id)).toEqual([
      "ink",
      expect.stringMatching(/^pdf-[0-9a-f]{64}$/),
    ]);
    expect(assembly?.pages).toEqual([
      { source: assembly?.sources[1]?.id, pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } },
      { source: assembly?.sources[1]?.id, pageIndex: 1, overlay: { source: "ink", pageIndex: 1 } },
    ]);
  });

  it("reads the text of PDF pages that weren't indexed, such as a restored notebook's", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.importPdf(new Blob([fakePdf(["Alpha", "Beta"])]), {
      title: "Imported",
    });
    const notebook = await store.readNotebook(id);
    // As after a restore: typed text only, with the PDF's own text still to read.
    for (const page of notebook?.pages ?? []) {
      await store.writePageText({ notebook: id, page: page.id, typed: "" });
    }
    expect(await library.search("beta")).toEqual([]);
    await library.indexPdfText(id);
    expect(await library.search("beta")).toHaveLength(1);
  });
});
