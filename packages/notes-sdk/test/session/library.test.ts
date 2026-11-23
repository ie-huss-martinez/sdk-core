import { describe, expect, it, vi } from "vitest";
import { createMemoryNotesStore } from "../../src/adapters/memory-store/memory-store.js";
import type { NotesStore } from "../../src/core/ports/notes-store.js";
import { createNotesLibrary, type NotesLibraryEvent } from "../../src/core/session/library.js";
import { createFakePdfEngine, fakePdf } from "../fixtures/fake-pdf.js";
import { countingIds, notebook, stroke, text, tickingClock } from "../fixtures/notes.js";

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
    const source = setup();
    await source.library.load();
    await source.library.importPdf(new Blob([fakePdf(["Alpha", "Beta"])]), { title: "Imported" });
    const target = setup();
    await target.library.load();
    const { restored } = await target.library.restore(await source.library.backup());
    const id = restored[0]?.id ?? "";
    // A backup holds the PDF, not its text: that's read again where it's restored.
    expect(await target.library.search("beta")).toEqual([]);
    await target.library.indexPdfText(id);
    expect(await target.library.search("beta")).toHaveLength(1);
  });

  it("keeps what's typed on a page when it reads the PDF's text", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.importPdf(new Blob([fakePdf(["Alpha"])]), { title: "Imported" });
    const page = (await store.readNotebook(id))?.pages[0]?.id ?? "";
    await store.deletePage(id, page);
    await store.writePageText({ notebook: id, page, typed: "Margin note" });
    await library.indexPdfText(id);
    expect(await store.readPageTexts(id)).toEqual([
      { notebook: id, page, typed: "Margin note", pdf: "Alpha" },
    ]);
  });
});

describe("a library in two tabs", () => {
  /** Two libraries over one store, each with its own copy of the index, as two tabs have. */
  async function tabs() {
    const store = createMemoryNotesStore();
    const first = setup(store).library;
    const second = createNotesLibrary({ store, newId: countingIds("other"), saveDelay: 60_000 });
    await first.load();
    await second.load();
    return { store, first, second };
  }

  it("keeps both tabs' changes, each made from what's stored and not from the tab's own copy", async () => {
    const { store, first, second } = await tabs();
    await first.createFolder("School");
    await second.createFolder("Work");
    await first.createNotebook({ title: "Physics" });
    await second.createNotebook({ title: "Minutes" });
    const stored = await store.readIndex();
    expect(stored?.folders.map((folder) => folder.name)).toEqual(["School", "Work"]);
    expect(stored?.notebooks.map((notebook) => notebook.title)).toEqual(["Physics", "Minutes"]);
    // Each tab shows what's stored after its own change.
    expect(second.getSnapshot().index).toEqual(stored);
  });

  it("puts a notebook at the top when its folder was removed in the other tab meanwhile", async () => {
    const { store, first, second } = await tabs();
    const folder = await first.createFolder("School");
    await second.createFolder("Work");
    await first.deleteFolder(folder);
    // The second tab still shows the folder: its copy is from before.
    const id = await second.createNotebook({ title: "Physics", folder });
    const stored = await store.readIndex();
    expect(stored?.notebooks).toEqual([expect.objectContaining({ id, folder: null })]);
  });

  it("refuses to delete, rename or recolour a notebook that's open, and changes nothing", async () => {
    const { store, first, second } = await tabs();
    const id = await first.createNotebook({ title: "Physics" });
    // The second tab learns of the notebook with its own next change.
    await second.createFolder("Work");
    const session = await first.open(id);
    const inUse = { code: "NOTEBOOK_IN_USE" };
    // From the tab that has it open, and from the other, which only the store's lock stops.
    for (const library of [first, second]) {
      await expect(library.deleteNotebook(id)).rejects.toMatchObject(inUse);
      await expect(library.renameNotebook(id, "Chemistry")).rejects.toMatchObject(inUse);
      await expect(library.setNotebookCover(id, "red")).rejects.toMatchObject(inUse);
    }
    expect(await store.readNotebook(id)).toMatchObject({ title: "Physics", cover: "blue" });
    expect(first.getSnapshot().index.notebooks[0]).toMatchObject({ deletedAt: null });
    await session.close();
    await first.deleteNotebook(id);
    expect(await store.readNotebook(id)).toBeUndefined();
  });
});

describe("a library when something fails", () => {
  it("leaves a notebook in the bin when deleting its storage fails, so it can be deleted again", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const deleteNotebook = store.deleteNotebook.bind(store);
    let failing = true;
    store.deleteNotebook = async (notebook) => {
      if (failing) throw new Error("The disk won't answer.");
      await deleteNotebook(notebook);
    };
    await expect(library.deleteNotebook(id)).rejects.toMatchObject({ code: "UNKNOWN" });
    // Never among the others while half deleted, and still there to try again.
    expect(library.getSnapshot().index.notebooks).toEqual([
      expect.objectContaining({ id, deletedAt: expect.any(Number) }),
    ]);
    failing = false;
    await library.deleteNotebook(id);
    expect(library.getSnapshot().index.notebooks).toEqual([]);
    expect(await store.listNotebooks()).toEqual([]);
  });

  it("refuses to take a notebook out of the bin while it's being deleted for good", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    await library.binNotebook(id);
    let fail: (error: Error) => void = () => undefined;
    store.deleteNotebook = () =>
      new Promise<void>((_, reject) => {
        fail = reject;
      });
    const deleting = library.deleteNotebook(id);
    // The deletion has the notebook by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(library.restoreNotebook(id)).rejects.toMatchObject({ code: "NOTEBOOK_IN_USE" });
    fail(new Error("The disk won't answer."));
    await expect(deleting).rejects.toMatchObject({ code: "UNKNOWN" });
    // Half deleted, so still in the bin, where the deletion can be made again.
    expect(library.getSnapshot().index.notebooks).toEqual([
      expect.objectContaining({ id, deletedAt: expect.any(Number) }),
    ]);
  });

  it("backs up the library without saving a notebook in the bin that can't be saved", async () => {
    const { library, store } = setup();
    await library.load();
    await library.createNotebook({ title: "Physics" });
    const binned = await library.createNotebook({ title: "Chemistry" });
    const session = await library.open(binned);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    await library.binNotebook(binned);
    store.writePage = async () => {
      throw new Error("The disk is full.");
    };
    session.execute({ type: "notes.addItems", page: page.id, items: [stroke("s1")] });
    // The bin isn't in a backup of the library, so its notebook can't fail one.
    await expect(library.backup()).resolves.toBeInstanceOf(Blob);
    await expect(library.backup({ notebooks: [binned] })).rejects.toMatchObject({
      code: "UNKNOWN",
    });
    await session.close({ discard: true });
  });

  it("stores nothing of an import that fails part way", async () => {
    const { library, store } = setup();
    await library.load();
    store.writeNotebook = async () => {
      throw new Error("The disk is full.");
    };
    await expect(
      library.importPdf(new Blob([fakePdf(["Needle one", "Needle two"])]), { title: "Imported" }),
    ).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(await store.readPageTexts()).toEqual([]);
    expect(await library.search("needle")).toEqual([]);
    expect(library.getSnapshot().index.notebooks).toEqual([]);
  });

  it("finds no text that belongs to no listed notebook", async () => {
    const { library, store } = setup();
    await library.load();
    await store.writePageText({ notebook: "ghost", page: "p1", typed: "needle" });
    expect(await library.search("needle")).toEqual([]);
  });

  it("is never failed by what a host's analytics throws", async () => {
    const store = createMemoryNotesStore();
    const library = createNotesLibrary({
      store,
      onEvent: () => {
        throw new Error("The analytics library broke.");
      },
    });
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const session = await library.open(id);
    await session.close();
    expect(await store.listNotebooks()).toEqual([id]);
  });

  it("backs up or exports one notebook without saving another that can't be saved", async () => {
    const { library, store } = setup();
    await library.load();
    const wanted = await library.createNotebook({ title: "Physics" });
    const broken = await library.createNotebook({ title: "Chemistry" });
    const session = await library.open(broken);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    const writePage = store.writePage.bind(store);
    store.writePage = async (notebook, written) => {
      if (notebook === broken) throw new Error("The disk is full.");
      await writePage(notebook, written);
    };
    session.execute({ type: "notes.addItems", page: page.id, items: [stroke("s1")] });
    await expect(library.backup({ notebooks: [wanted] })).resolves.toBeInstanceOf(Blob);
    await expect(library.exportPdf(wanted)).resolves.toBeInstanceOf(Uint8Array);
    // The whole library does include it, and says why it can't.
    await expect(library.backup()).rejects.toMatchObject({ code: "UNKNOWN" });
    await session.close({ discard: true });
  });
});

describe("a library's backup reminder", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("counts from when the backup began, so an edit saved while it's written still needs one", async () => {
    const store = createMemoryNotesStore();
    let time = 1_800_000_000_000;
    const library = createNotesLibrary({ store, now: () => time });
    await library.load();
    await library.createNotebook({ title: "Physics" });
    const began = time;
    const readNotebook = store.readNotebook.bind(store);
    store.readNotebook = async (id) => {
      // The archive takes a while to write.
      time += 60_000;
      return readNotebook(id);
    };
    await library.backup();
    expect(library.getSnapshot().index.lastBackupAt).toBe(began);
  });

  it("keeps counting from the backup before when a notebook left the bin while one was written", async () => {
    const store = createMemoryNotesStore();
    let time = 1_800_000_000_000;
    const library = createNotesLibrary({ store, now: () => time });
    await library.load();
    await library.createNotebook({ title: "Physics" });
    const binned = await library.createNotebook({ title: "Chemistry" });
    await library.binNotebook(binned);
    const readNotebook = store.readNotebook.bind(store);
    let restored: Promise<void> | undefined;
    store.readNotebook = async (id) => {
      // While the archive is written, the other notebook comes out of the bin.
      restored ??= library.restoreNotebook(binned);
      return readNotebook(id);
    };
    time += 1_000;
    const backup = await library.backup();
    await restored;
    // It isn't in the archive, so the library isn't taken for backed up.
    const other = createNotesLibrary({ store: createMemoryNotesStore() });
    await other.load();
    expect((await other.restore(backup)).restored).toHaveLength(1);
    expect(library.getSnapshot().index.lastBackupAt).toBeNull();
  });

  it("rebuilds when the notebooks last changed along with a lost index", async () => {
    const store = createMemoryNotesStore();
    const written = 1_800_000_000_000;
    await store.writeNotebook({
      ...notebook("book", ["p1"]),
      createdAt: written,
      updatedAt: written,
    });
    const library = createNotesLibrary({ store, now: () => written + 21 * DAY });
    await library.load();
    expect(library.getSnapshot().index.lastChangeAt).toBe(written);
    expect(library.getSnapshot().backupDue).toBe(true);
  });

  it("falls due while the library is open, without a change to say so", async () => {
    vi.useFakeTimers();
    try {
      const library = createNotesLibrary({ store: createMemoryNotesStore() });
      await library.load();
      await library.createNotebook({ title: "Physics" });
      expect(library.getSnapshot().backupDue).toBe(false);
      await vi.advanceTimersByTimeAsync(14 * DAY + 1_000);
      expect(library.getSnapshot().backupDue).toBe(true);
      await library.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("closing a library", () => {
  it("saves and gives back the notebooks still open, and opens no more", async () => {
    const { library, store } = setup();
    await library.load();
    const id = await library.createNotebook({ title: "Physics" });
    const session = await library.open(id);
    const [page] = session.getSnapshot().notebook.pages;
    if (!page) throw new Error("A new notebook has a page.");
    await session.loadPage(page.id);
    session.execute({ type: "notes.addItems", page: page.id, items: [stroke("s1")] });
    await library.close();
    expect((await store.readPage(id, page.id))?.items).toHaveLength(1);
    expect(await store.lockNotebook(id)).toBeTypeOf("function");
    await expect(library.load()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("waits for an import under way, and refuses what's asked of it afterwards", async () => {
    const { library, store } = setup();
    await library.load();
    const writeAsset = store.writeAsset.bind(store);
    let land: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    store.writeAsset = async (notebook, asset, data) => {
      await held;
      await writeAsset(notebook, asset, data);
    };
    const importing = library.importPdf(new Blob([fakePdf(["Alpha"])]), { title: "Imported" });
    let closed = false;
    const closing = library.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The store is still being written to, so close() hasn't resolved.
    expect(closed).toBe(false);
    land();
    const id = await importing;
    await closing;
    expect(await store.readNotebook(id)).toBeDefined();
    expect((await store.readIndex())?.notebooks).toHaveLength(1);
    await expect(library.createNotebook({ title: "Late" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("tells every caller it has closed only once nothing is left to write", async () => {
    const { library, store } = setup();
    await library.load();
    const writeAsset = store.writeAsset.bind(store);
    let land: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    store.writeAsset = async (notebook, asset, data) => {
      await held;
      await writeAsset(notebook, asset, data);
    };
    const importing = library.importPdf(new Blob([fakePdf(["Alpha"])]), { title: "Imported" });
    const settled: string[] = [];
    const first = library.close().then(() => settled.push("first"));
    const second = library.close().then(() => settled.push("second"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toEqual([]);
    land();
    await importing;
    await Promise.all([first, second]);
    expect(settled).toHaveLength(2);
  });

  it("restores one backup at a time, so two never restore the same notebook twice", async () => {
    const source = setup();
    await source.library.load();
    await source.library.createNotebook({ title: "Physics" });
    const backup = await source.library.backup();
    const { library } = setup();
    await library.load();
    const [first, second] = await Promise.all([library.restore(backup), library.restore(backup)]);
    expect(first.restored).toHaveLength(1);
    expect(second).toMatchObject({ restored: [], unchanged: [first.restored[0]?.id] });
    expect(library.getSnapshot().index.notebooks).toHaveLength(1);
  });
});
