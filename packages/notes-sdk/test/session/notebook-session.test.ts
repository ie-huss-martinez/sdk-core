import { describe, expect, it } from "vitest";
import { createMemoryNotesStore } from "../../src/adapters/memory-store/memory-store.js";
import type { NotesStore } from "../../src/core/ports/notes-store.js";
import {
  type NotesSessionEvent,
  openNotesSession,
} from "../../src/core/session/notebook-session.js";
import { notebook, stroke, text, tickingClock } from "../fixtures/notes.js";

async function seeded(): Promise<NotesStore> {
  const store = createMemoryNotesStore();
  await store.writeNotebook(notebook("book", ["p1", "p2"]));
  return store;
}

const open = (store: NotesStore, events?: NotesSessionEvent[]) =>
  openNotesSession({
    store,
    notebook: "book",
    now: tickingClock(),
    // Saves are asked for with flush(), so no test waits on a timer.
    saveDelay: 60_000,
    ...(events ? { onEvent: (event) => events.push(event) } : {}),
  });

describe("openNotesSession", () => {
  it("opens a stored notebook, with no page loaded yet", async () => {
    const session = await open(await seeded());
    const snapshot = session.getSnapshot();
    expect(snapshot.notebook.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
    expect(snapshot.pages.size).toBe(0);
    expect(snapshot.saveState).toBe("saved");
    expect(snapshot.canUndo).toBe(false);
  });

  it("refuses a notebook the store doesn't have, and gives its lock back", async () => {
    const store = createMemoryNotesStore();
    await expect(openNotesSession({ store, notebook: "book" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { kind: "notebook" },
    });
    await expect(store.lockNotebook("book")).resolves.toBeTypeOf("function");
  });

  it("refuses a notebook another session holds, until that one closes", async () => {
    const store = await seeded();
    const first = await open(store);
    await expect(open(store)).rejects.toMatchObject({ code: "NOTEBOOK_IN_USE" });
    await first.close();
    await expect(open(store)).resolves.toBeDefined();
  });
});

describe("a notebook session", () => {
  it("loads a page once, and treats a page never written on as empty", async () => {
    const store = await seeded();
    await store.writePage("book", { id: "p2", items: [stroke("s1")] });
    const session = await open(store);
    await expect(session.loadPage("p1")).resolves.toEqual({ id: "p1", items: [] });
    const loaded = await session.loadPage("p2");
    expect(loaded.items).toHaveLength(1);
    expect(await session.loadPage("p2")).toBe(loaded);
    await expect(session.loadPage("nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { kind: "page" },
    });
  });

  it("saves what was written, and reads it back in a new session", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    session.execute({
      type: "notes.addItems",
      page: "p1",
      items: [stroke("s1"), text("t1", "Hello")],
    });
    expect(session.getSnapshot().saveState).toBe("pending");
    await session.flush();
    expect(session.getSnapshot().saveState).toBe("saved");
    await session.close();

    const again = await open(store);
    const page = await again.loadPage("p1");
    expect(page.items.map((item) => item.id)).toEqual(["s1", "t1"]);
  });

  it("stores the notebook with a later time after each save", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await session.flush();
    const stored = await store.readNotebook("book");
    expect(stored?.updatedAt).toBeGreaterThan(1_700_000_000_000);
    expect(session.getSnapshot().notebook.updatedAt).toBe(stored?.updatedAt);
  });

  it("undoes and redoes, and saves the page as it is afterwards", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s2")] });
    session.undo();
    expect(
      session
        .getSnapshot()
        .pages.get("p1")
        ?.items.map((item) => item.id),
    ).toEqual(["s1"]);
    expect(session.getSnapshot().canRedo).toBe(true);
    await session.flush();
    expect((await store.readPage("book", "p1"))?.items.map((item) => item.id)).toEqual(["s1"]);
    session.redo();
    await session.flush();
    expect((await store.readPage("book", "p1"))?.items.map((item) => item.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("makes several commands one step when they're executed together or grouped", async () => {
    const session = await open(await seeded());
    await session.loadPage("p1");
    session.execute([
      { type: "notes.addItems", page: "p1", items: [stroke("s1")] },
      { type: "notes.addItems", page: "p1", items: [stroke("s2")] },
    ]);
    session.group(() => {
      session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s3")] });
      session.execute({ type: "notes.removeItems", page: "p1", ids: ["s1"] });
    });
    session.undo();
    expect(
      session
        .getSnapshot()
        .pages.get("p1")
        ?.items.map((item) => item.id),
    ).toEqual(["s1", "s2"]);
    session.undo();
    expect(session.getSnapshot().pages.get("p1")?.items).toEqual([]);
  });

  it("changes nothing when a command doesn't apply", async () => {
    const session = await open(await seeded());
    await session.loadPage("p1");
    const before = session.getSnapshot();
    expect(() =>
      session.execute({ type: "notes.removeItems", page: "p1", ids: ["missing"] }),
    ).toThrow(expect.objectContaining({ code: "INVALID_COMMAND" }));
    expect(() =>
      session.execute({ type: "notes.addItems", page: "p2", items: [stroke("s1")] }),
    ).toThrow(expect.objectContaining({ details: { reason: "page-not-loaded" } }));
    expect(session.getSnapshot()).toBe(before);
  });

  it("deletes a removed page's file, and brings the page back on undo", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p2");
    session.execute({ type: "notes.addItems", page: "p2", items: [stroke("s1")] });
    await session.flush();
    session.execute({ type: "notes.removePages", pages: ["p2"] });
    await session.flush();
    expect(await store.readPage("book", "p2")).toBeUndefined();
    expect((await store.readNotebook("book"))?.pages.map((page) => page.id)).toEqual(["p1"]);

    session.undo();
    await session.flush();
    expect((await store.readPage("book", "p2"))?.items.map((item) => item.id)).toEqual(["s1"]);
    expect((await store.readNotebook("book"))?.pages.map((page) => page.id)).toEqual(["p1", "p2"]);
  });

  it("indexes typed text for search when it saves, and keeps a PDF page's own text", async () => {
    const store = await seeded();
    await store.writePageText({ notebook: "book", page: "p1", typed: "", pdf: "Printed words" });
    const session = await open(store);
    await session.loadPage("p1");
    session.execute({ type: "notes.addItems", page: "p1", items: [text("t1", "Typed words")] });
    await session.flush();
    expect(await store.readPageTexts("book")).toEqual([
      { notebook: "book", page: "p1", typed: "Typed words", pdf: "Printed words" },
    ]);
  });

  it("stores a file under its hash, and reads it back", async () => {
    const session = await open(await seeded());
    const data = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const reference = await session.addAsset(data, "image/png");
    expect(reference).toEqual({
      asset: "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      mediaType: "image/png",
      size: 3,
    });
    const read = await session.readAsset(reference);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await expect(session.readAsset(`sha256:${"0".repeat(64)}`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps the changes and says so when a save fails, then saves them when it can", async () => {
    const store = await seeded();
    const events: NotesSessionEvent[] = [];
    const session = await open(store, events);
    await session.loadPage("p1");
    const writePage = store.writePage.bind(store);
    let failing = true;
    store.writePage = async (book, page) => {
      if (failing) throw new Error("The disk is full.");
      await writePage(book, page);
    };
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await expect(session.flush()).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(session.getSnapshot().saveState).toBe("failed");
    expect(session.getSnapshot().error).toBeDefined();
    expect(events).toContainEqual({ type: "failed", operation: "save", code: "UNKNOWN" });
    // The ink is still there, and still due.
    expect(session.getSnapshot().pages.get("p1")?.items).toHaveLength(1);

    failing = false;
    await session.flush();
    expect(session.getSnapshot().saveState).toBe("saved");
    expect(session.getSnapshot().error).toBeUndefined();
    expect((await store.readPage("book", "p1"))?.items).toHaveLength(1);
  });

  it("saves on close, and reports only anonymous events", async () => {
    const store = await seeded();
    const events: NotesSessionEvent[] = [];
    const session = await open(store, events);
    await session.loadPage("p1");
    session.execute({
      type: "notes.addItems",
      page: "p1",
      items: [text("t1", "A private thought")],
    });
    session.execute({ type: "notes.rename", title: "My secret diary" });
    session.undo();
    await session.close();
    expect((await store.readPage("book", "p1"))?.items).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      "notebook_opened",
      "command",
      "command",
      "undo",
      "notebook_closed",
    ]);
    const sent = JSON.stringify(events);
    expect(sent).not.toContain("private thought");
    expect(sent).not.toContain("secret diary");
    expect(sent).not.toContain("Physics");
  });
});

describe("closing a notebook session", () => {
  const failingPages = (store: NotesStore) => {
    const writePage = store.writePage.bind(store);
    const control = { failing: true };
    store.writePage = async (book, page) => {
      if (control.failing) throw new Error("The disk is full.");
      await writePage(book, page);
    };
    return control;
  };

  it("stays open, holding the notebook, when the last save fails, and closes once it works", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    const disk = failingPages(store);
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await expect(session.close()).rejects.toMatchObject({ code: "UNKNOWN" });
    // Still this session's: nobody else may write it, and the ink is still here.
    await expect(open(store)).rejects.toMatchObject({ code: "NOTEBOOK_IN_USE" });
    expect(session.getSnapshot().pages.get("p1")?.items).toHaveLength(1);
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s2")] });

    disk.failing = false;
    await session.close();
    const again = await open(store);
    expect((await again.loadPage("p1")).items.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  it("closes without what couldn't be saved, when asked to discard it", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    failingPages(store);
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await session.close({ discard: true });
    expect(() => session.undo()).toThrow();
    store.writePage = async () => undefined;
    const again = await open(store);
    expect((await again.loadPage("p1")).items).toEqual([]);
  });

  it("saves an edit made while it closes, and writes nothing once the notebook is given back", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    const writePage = store.writePage.bind(store);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    store.writePage = async (book, page) => {
      writes += 1;
      if (writes === 1) await held;
      await writePage(book, page);
    };
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    const closing = session.close();
    // The first save is on its way to the disk when the next stroke lands.
    await Promise.resolve();
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s2")] });
    release();
    await closing;
    expect((await store.readPage("book", "p1"))?.items.map((item) => item.id)).toEqual([
      "s1",
      "s2",
    ]);
    const written = writes;
    await session.flush();
    expect(writes).toBe(written);
  });

  it("holds the notebook until a file being stored has landed", async () => {
    const store = await seeded();
    const session = await open(store);
    const writeAsset = store.writeAsset.bind(store);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.writeAsset = async (book, asset, data) => {
      await held;
      await writeAsset(book, asset, data);
    };
    const adding = session.addAsset(new Blob(["sound"]), "audio/webm");
    const closing = session.close();
    await expect(open(store)).rejects.toMatchObject({ code: "NOTEBOOK_IN_USE" });
    release();
    const reference = await adding;
    await closing;
    expect(await store.listAssets("book")).toEqual([reference.asset]);
    await expect(session.addAsset(new Blob(["more"]), "audio/webm")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is never failed by what a host's analytics throws", async () => {
    const store = await seeded();
    const session = await openNotesSession({
      store,
      notebook: "book",
      saveDelay: 60_000,
      onEvent: () => {
        throw new Error("The analytics library broke.");
      },
    });
    await session.loadPage("p1");
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await session.close();
    // The notebook was given back, with its ink stored.
    const again = await open(store);
    expect((await again.loadPage("p1")).items).toHaveLength(1);
  });
});

describe("a notebook session's search text", () => {
  it("leaves alone the PDF text indexed while the notebook is open", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    // As the library does once it has read the PDF, after the session opened.
    await store.writePageText({ notebook: "book", page: "p1", pdf: "Printed words" });
    session.execute({ type: "notes.addItems", page: "p1", items: [text("t1", "Typed words")] });
    await session.flush();
    expect(await store.readPageTexts("book")).toEqual([
      { notebook: "book", page: "p1", typed: "Typed words", pdf: "Printed words" },
    ]);
  });

  it("gives a PDF page its text back when an undo restores the page", async () => {
    const store = await seeded();
    await store.writePageText({ notebook: "book", page: "p1", pdf: "Printed words" });
    const session = await open(store);
    await session.loadPage("p1");
    session.execute({ type: "notes.removePages", pages: ["p1"] });
    await session.flush();
    expect(await store.readPageTexts("book")).toEqual([]);
    session.undo();
    await session.flush();
    expect(await store.readPageTexts("book")).toEqual([
      { notebook: "book", page: "p1", typed: "", pdf: "Printed words" },
    ]);
  });
});

describe("a notebook session's snapshot", () => {
  it("shows a save's error only until the next change waits for its own save", async () => {
    const store = await seeded();
    const session = await open(store);
    await session.loadPage("p1");
    store.writePage = async () => {
      throw new Error("The disk is full.");
    };
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s1")] });
    await expect(session.flush()).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(session.getSnapshot()).toMatchObject({ saveState: "failed" });
    expect(session.getSnapshot().error).toBeDefined();
    session.execute({ type: "notes.addItems", page: "p1", items: [stroke("s2")] });
    expect(session.getSnapshot().saveState).toBe("pending");
    expect(session.getSnapshot().error).toBeUndefined();
  });

  it("doesn't change when a flush has nothing to save", async () => {
    const session = await open(await seeded());
    let published = 0;
    session.subscribe(() => {
      published += 1;
    });
    const before = session.getSnapshot();
    await session.flush();
    await session.flush();
    expect(published).toBe(0);
    expect(session.getSnapshot()).toBe(before);
  });
});
