import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeNotesStoreContract,
  indexOf,
  notebookOf,
  pageOf,
} from "../../../test/contracts/notes-store.contract.js";
import { assetNameOf } from "../../core/model/ids.js";
import type { NotesStore } from "../../core/ports/notes-store.js";
import {
  BY_NOTEBOOK,
  DATABASE_VERSION,
  INDEX_KEY,
  LIBRARY_STORE,
  PAGE_TEXTS_STORE,
} from "./index-db.js";
import { toAssetFileName, toFileName } from "./opfs-names.js";
import {
  ASSETS_DIRECTORY,
  createOpfsNotesStore,
  NOTEBOOK_FILE,
  NOTEBOOKS_DIRECTORY,
  PAGES_DIRECTORY,
} from "./opfs-store.js";
import { missingStorageFeature } from "./storage-errors.js";

// The store against the browser's real file system, IndexedDB, locks and
// channels. Engines differ in what they give a test page, so the file first
// finds out which of three cases it's in, and each case has its own tests:
// a feature is missing, the storage is there but won't open, or it works.

const settled = (request: IDBOpenDBRequest): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const deleteDatabase = (name: string): Promise<unknown> => settled(indexedDB.deleteDatabase(name));

async function opens(open: () => Promise<unknown>): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

const missing = missingStorageFeature();
const filesOpen = missing === undefined && (await opens(() => navigator.storage.getDirectory()));
const databaseOpens =
  missing === undefined &&
  (await opens(async () => {
    (await settled(indexedDB.open("hm-notes-probe"))).close();
    await deleteDatabase("hm-notes-probe");
  }));
const usable = filesOpen && databaseOpens;

const SOME_ASSET = `sha256:${"0".repeat(64)}`;

describe.runIf(missing !== undefined)(`createOpfsNotesStore without ${missing}`, () => {
  it("rejects every storage call by naming the missing feature", async () => {
    const store = createOpfsNotesStore({ name: "hm-notes-unsupported" });
    const unsupported = { code: "UNSUPPORTED_ENVIRONMENT", details: { feature: missing } };
    await expect(store.readIndex()).rejects.toMatchObject(unsupported);
    await expect(store.updateIndex(() => indexOf())).rejects.toMatchObject(unsupported);
    await expect(store.listNotebooks()).rejects.toMatchObject(unsupported);
    await expect(store.readNotebook("n1")).rejects.toMatchObject(unsupported);
    await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject(unsupported);
    await expect(store.writePage("n1", pageOf("p1"))).rejects.toMatchObject(unsupported);
    await expect(store.readAsset("n1", SOME_ASSET)).rejects.toMatchObject(unsupported);
    await expect(store.readPageTexts()).rejects.toMatchObject(unsupported);
    store.close();
  });
});

describe.runIf(missing === undefined && !usable)(
  "createOpfsNotesStore where the browser gives the page no storage",
  () => {
    const unavailable = { code: "STORAGE_FAILED", details: { reason: "unavailable" } };

    it.runIf(!filesOpen)("rejects what needs the file system as unavailable storage", async () => {
      const store = createOpfsNotesStore({ name: "hm-notes-unavailable" });
      await expect(store.readNotebook("n1")).rejects.toMatchObject(unavailable);
      await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject(unavailable);
      await expect(store.listNotebooks()).rejects.toMatchObject(unavailable);
      store.close();
    });

    it.runIf(!databaseOpens)("rejects what needs the database as unavailable storage", async () => {
      const store = createOpfsNotesStore({ name: "hm-notes-unavailable" });
      await expect(store.readIndex()).rejects.toMatchObject(unavailable);
      await expect(store.updateIndex(() => indexOf())).rejects.toMatchObject(unavailable);
      await expect(store.readPageTexts()).rejects.toMatchObject(unavailable);
      store.close();
    });
  },
);

describe.runIf(usable)("createOpfsNotesStore on the browser's storage", () => {
  /** The storage name of the test that is running: each test has its own. */
  let name = "";
  const names: string[] = [];
  const stores: NotesStore[] = [];

  const newName = (): string => {
    const made = `hm-test-${crypto.randomUUID()}`;
    names.push(made);
    return made;
  };
  const openStore = (storage = name): NotesStore => {
    const store = createOpfsNotesStore({ name: storage });
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    name = newName();
    // Firefox asks the user before it answers persist(), and nobody answers
    // in a test. What the store does with each answer is tested below.
    vi.spyOn(navigator.storage, "persist").mockResolvedValue(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const store of stores.splice(0)) store.close();
    const root = await navigator.storage.getDirectory();
    for (const used of names.splice(0)) {
      await root.removeEntry(toFileName(used), { recursive: true }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      });
      await deleteDatabase(used);
    }
  });

  // What follows reaches into the storage directly, past the store, to see
  // what it left there or to leave what it must cope with.

  /** A folder of the running test's storage, made if it's missing. */
  async function folder(...path: string[]): Promise<FileSystemDirectoryHandle> {
    let directory = await navigator.storage.getDirectory();
    for (const part of [toFileName(name), NOTEBOOKS_DIRECTORY, ...path]) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    return directory;
  }

  async function putFile(
    directory: FileSystemDirectoryHandle,
    file: string,
    contents: string | Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    const handle = await directory.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
  }

  async function fileText(directory: FileSystemDirectoryHandle, file: string): Promise<string> {
    return (await (await directory.getFileHandle(file)).getFile()).text();
  }

  async function namesIn(directory: FileSystemDirectoryHandle): Promise<string[]> {
    const found: string[] = [];
    for await (const entry of directory.keys()) found.push(entry);
    return found.sort();
  }

  /** Puts a record into the store's database, which the store must have opened once. */
  async function putRecord(objectStore: string, value: unknown, key?: IDBValidKey): Promise<void> {
    const database = await settled(indexedDB.open(name));
    // Closed whatever happens: an open connection keeps the teardown from deleting the database.
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(objectStore, "readwrite");
        transaction.objectStore(objectStore).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  /** A record of the store's database, as it is there. */
  async function getRecord(objectStore: string, key: IDBValidKey): Promise<unknown> {
    const database = await settled(indexedDB.open(name));
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(objectStore).objectStore(objectStore).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  /** Makes every file write fail at the given step, after some of the data went out. */
  function failWrites(step: "write" | "close", error: unknown): { aborted: () => number } {
    let aborted = 0;
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    vi.spyOn(FileSystemFileHandle.prototype, "createWritable").mockImplementation(async function (
      this: FileSystemFileHandle,
      options,
    ) {
      const writable = await createWritable.call(this, options);
      const write = writable.write.bind(writable);
      const abort = writable.abort.bind(writable);
      if (step === "write") {
        writable.write = async () => {
          await write('{"format":"hm-no');
          throw error;
        };
      } else {
        writable.close = async () => {
          throw error;
        };
      }
      writable.abort = async (reason) => {
        aborted += 1;
        await abort(reason);
      };
      return writable;
    });
    return { aborted: () => aborted };
  }

  /**
   * Keeps every file write from starting until the function returned is
   * called, so a test can act while the store's writes are still queued.
   */
  function holdWrites(): () => void {
    let letGo: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    vi.spyOn(FileSystemFileHandle.prototype, "createWritable").mockImplementation(async function (
      this: FileSystemFileHandle,
      options,
    ) {
      await held;
      return createWritable.call(this, options);
    });
    return letGo;
  }

  /** Runs a test's steps as in a browser without the Web Locks API, and puts it back. */
  async function withoutWebLocks(steps: () => Promise<void>): Promise<void> {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
    try {
      await steps();
    } finally {
      Reflect.deleteProperty(navigator, "locks");
    }
    expect(navigator.locks).toBeDefined();
  }

  /** Takes a notebook as soon as its holder has let it go, which a store sees a moment later. */
  function taken(store: NotesStore, notebook: string): Promise<() => void> {
    return vi.waitFor(async () => {
      const lock = await store.lockNotebook(notebook);
      if (!lock) throw new Error("The notebook is still held.");
      return lock;
    });
  }

  /**
   * Resolves once every message sent so far on the running test's channel
   * has reached the stores, so a test can then count what they heard.
   *
   * It sends one more message and waits for it on a channel made here. A
   * browser delivers a channel's messages in the order they were sent, and
   * each to the older channels first: by the time this newest channel has
   * the last message, the stores' channels have had them all.
   */
  function delivered(): Promise<void> {
    return new Promise((resolve) => {
      const witness = new BroadcastChannel(name);
      const sender = new BroadcastChannel(name);
      witness.onmessage = (event) => {
        if (event.data !== "test-delivered") return;
        witness.close();
        sender.close();
        resolve();
      };
      sender.postMessage("test-delivered");
    });
  }

  /** Runs a test's steps with a property of the browser taken away, and puts it back. */
  async function without<Target extends object>(
    target: Target,
    property: keyof Target & string,
    steps: () => Promise<void>,
  ): Promise<void> {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    expect(descriptor, `${property} is the target's own`).toBeDefined();
    Reflect.deleteProperty(target, property);
    try {
      await steps();
    } finally {
      if (descriptor) Object.defineProperty(target, property, descriptor);
    }
  }

  const laterVersion = {
    code: "UNSUPPORTED_FORMAT",
    details: { reason: "unknown-format-version" },
  };
  const malformed = { code: "INVALID_DOCUMENT", details: { reason: "malformed-document" } };

  describeNotesStoreContract("createOpfsNotesStore", () => openStore(), { shared: true });

  describe("what it keeps", () => {
    it("is read by a store opened later, as after a reload", async () => {
      const bytes = new TextEncoder().encode("%PDF-1.7 and the rest");
      const asset = await assetNameOf(bytes);
      const first = openStore();
      await first.updateIndex(() => indexOf(notebookOf("n1")));
      await first.writeNotebook(notebookOf("n1"));
      await first.writePage("n1", pageOf("p1"));
      await first.writeAsset("n1", asset, new Blob([bytes]));
      await first.writePageText({ notebook: "n1", page: "p1", typed: "words", pdf: "more" });
      first.close();

      const second = openStore();
      await expect(second.readIndex()).resolves.toEqual(indexOf(notebookOf("n1")));
      await expect(second.listNotebooks()).resolves.toEqual(["n1"]);
      await expect(second.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
      await expect(second.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
      await expect(second.listAssets("n1")).resolves.toEqual([asset]);
      const read = await second.readAsset("n1", asset);
      expect(new Uint8Array((await read?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
      await expect(second.readPageTexts("n1")).resolves.toEqual([
        { notebook: "n1", page: "p1", typed: "words", pdf: "more" },
      ]);
    });

    it("is kept apart from a library of another name", async () => {
      const store = openStore();
      const other = openStore(newName());
      await store.updateIndex(() => indexOf(notebookOf("n1")));
      await store.writeNotebook(notebookOf("n1"));
      await store.writePageText({ notebook: "n1", page: "p1", typed: "words" });
      await expect(other.readIndex()).resolves.toBeUndefined();
      await expect(other.listNotebooks()).resolves.toEqual([]);
      await expect(other.readNotebook("n1")).resolves.toBeUndefined();
      await expect(other.readPageTexts()).resolves.toEqual([]);
      // And a notebook's lock is the library's own.
      const held = await store.lockNotebook("n1");
      const elsewhere = await other.lockNotebook("n1");
      expect(held).toBeTypeOf("function");
      expect(elsewhere).toBeTypeOf("function");
    });

    it("is laid out as documented", async () => {
      const bytes = new TextEncoder().encode("a file");
      const asset = await assetNameOf(bytes);
      const store = openStore();
      await store.writeNotebook(notebookOf("n1"));
      await store.writePage("n1", pageOf("p1"));
      await store.writePage("n1", pageOf("p2", []));
      await store.writeAsset("n1", asset, new Blob([bytes]));

      expect(await namesIn(await folder())).toEqual(["n1"]);
      expect(await namesIn(await folder("n1"))).toEqual(
        [ASSETS_DIRECTORY, NOTEBOOK_FILE, PAGES_DIRECTORY].sort(),
      );
      expect(await namesIn(await folder("n1", PAGES_DIRECTORY))).toEqual(["p1.json", "p2.json"]);
      expect(await namesIn(await folder("n1", ASSETS_DIRECTORY))).toEqual([toAssetFileName(asset)]);
      expect(JSON.parse(await fileText(await folder("n1"), NOTEBOOK_FILE))).toEqual({
        format: "hm-notes-notebook",
        version: 1,
        ...notebookOf("n1"),
      });
      expect(JSON.parse(await fileText(await folder("n1", PAGES_DIRECTORY), "p2.json"))).toEqual({
        format: "hm-notes-page",
        version: 1,
        id: "p2",
        items: [],
      });
      expect(await fileText(await folder("n1", ASSETS_DIRECTORY), toAssetFileName(asset))).toBe(
        "a file",
      );
    });

    it("names an id with uppercase letters so that no disk folds it into another", async () => {
      const store = openStore();
      await store.writeNotebook(notebookOf("Ab"));
      await store.writePage("Ab", pageOf("Pg"));
      expect(await namesIn(await folder())).toEqual(["~ab"]);
      expect(await namesIn(await folder("~ab", PAGES_DIRECTORY))).toEqual(["~pg.json"]);
    });

    it("has nothing left of a deleted notebook", async () => {
      const store = openStore();
      await store.writeNotebook(notebookOf("n1"));
      await store.writePage("n1", pageOf("p1"));
      await store.writeNotebook(notebookOf("n2"));
      await store.deleteNotebook("n1");
      expect(await namesIn(await folder())).toEqual(["n2"]);
    });

    it("doesn't write a file it already has", async () => {
      const bytes = new TextEncoder().encode("a large PDF");
      const asset = await assetNameOf(bytes);
      const store = openStore();
      const createWritable = vi.spyOn(FileSystemFileHandle.prototype, "createWritable");
      await store.writeAsset("n1", asset, new Blob([bytes]));
      expect(createWritable).toHaveBeenCalledTimes(1);
      await store.writeAsset("n1", asset, new Blob([bytes]));
      expect(createWritable).toHaveBeenCalledTimes(1);
    });

    it("writes again a file that was cut short", async () => {
      const bytes = new TextEncoder().encode("the whole file");
      const asset = await assetNameOf(bytes);
      await putFile(await folder("n1", ASSETS_DIRECTORY), toAssetFileName(asset), "the who");
      const store = openStore();
      await store.writeAsset("n1", asset, new Blob([bytes]));
      await expect((await store.readAsset("n1", asset))?.text()).resolves.toBe("the whole file");
    });
  });

  describe("what it finds on the disk", () => {
    it.each<[string, string | Uint8Array<ArrayBuffer>]>([
      ["isn't JSON", "not json {"],
      ["stops half way", '{"format":"hm-notes-notebook","version":1,"id":"n1","title":"No'],
      ["isn't UTF-8", new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])],
      ["is JSON of another shape", '{"format":"hm-notes-notebook","version":1,"id":"n1"}'],
      [
        "has a field too many",
        JSON.stringify({ format: "hm-notes-notebook", version: 1, ...notebookOf("n1"), extra: 1 }),
      ],
    ])("refuses a notebook that %s, and leaves it there", async (_, contents) => {
      await putFile(await folder("n1"), NOTEBOOK_FILE, contents);
      const store = openStore();
      await expect(store.readNotebook("n1")).rejects.toMatchObject({
        name: "NotesError",
        ...malformed,
      });
      // Still listed, and still on the disk: a later version may read what this one can't.
      await expect(store.listNotebooks()).resolves.toEqual(["n1"]);
      expect(await namesIn(await folder("n1"))).toEqual([NOTEBOOK_FILE]);
    });

    it("refuses a damaged page, and still reads the pages next to it", async () => {
      const store = openStore();
      await store.writePage("n1", pageOf("p1"));
      await putFile(await folder("n1", PAGES_DIRECTORY), "p2.json", "\u0000\u0000\u0000");
      await expect(store.readPage("n1", "p2")).rejects.toMatchObject(malformed);
      await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
    });

    it("refuses a notebook and a page of a later version of the format", async () => {
      const notebook = {
        format: "hm-notes-notebook",
        version: 2,
        ...notebookOf("n1"),
        sections: [],
      };
      const page = { format: "hm-notes-page", version: 2, id: "p1", layers: [] };
      await putFile(await folder("n1"), NOTEBOOK_FILE, JSON.stringify(notebook));
      await putFile(await folder("n1", PAGES_DIRECTORY), "p1.json", JSON.stringify(page));
      const store = openStore();
      await expect(store.readNotebook("n1")).rejects.toMatchObject({
        name: "NotesError",
        ...laterVersion,
      });
      await expect(store.readPage("n1", "p1")).rejects.toMatchObject(laterVersion);
      expect(JSON.parse(await fileText(await folder("n1"), NOTEBOOK_FILE))).toEqual(notebook);
    });

    it("refuses a document of another format", async () => {
      await putFile(
        await folder("n1"),
        NOTEBOOK_FILE,
        JSON.stringify({ format: "hm-notes-page", version: 1, id: "n1", items: [] }),
      );
      const store = openStore();
      await expect(store.readNotebook("n1")).rejects.toMatchObject({
        code: "UNSUPPORTED_FORMAT",
        details: { reason: "unknown-format" },
      });
    });

    it("refuses a document that belongs under another id", async () => {
      const store = openStore();
      await store.writeNotebook(notebookOf("n2"));
      await store.writePage("n2", pageOf("p2"));
      await putFile(
        await folder("n1"),
        NOTEBOOK_FILE,
        await fileText(await folder("n2"), NOTEBOOK_FILE),
      );
      await putFile(
        await folder("n1", PAGES_DIRECTORY),
        "p1.json",
        await fileText(await folder("n2", PAGES_DIRECTORY), "p2.json"),
      );
      const misplaced = { code: "INVALID_DOCUMENT", details: { reason: "invalid-id" } };
      await expect(store.readNotebook("n1")).rejects.toMatchObject(misplaced);
      await expect(store.readPage("n1", "p1")).rejects.toMatchObject(misplaced);
    });

    it("takes an empty file, left by a first write that never ended, for none", async () => {
      await putFile(await folder("n1"), NOTEBOOK_FILE, "");
      await putFile(await folder("n1", PAGES_DIRECTORY), "p1.json", "");
      const store = openStore();
      await expect(store.readNotebook("n1")).resolves.toBeUndefined();
      await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
      await expect(store.listNotebooks()).resolves.toEqual([]);
      await store.writeNotebook(notebookOf("n1"));
      await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
    });

    it("lists only what it could have written", async () => {
      const store = openStore();
      await store.writeNotebook(notebookOf("n1"));
      await store.writeAsset("n1", SOME_ASSET, new Blob(["x"]));
      // A folder and files that are no notebook's and no asset's, such as a browser's temporary file.
      await putFile(
        await folder("ABC"),
        NOTEBOOK_FILE,
        JSON.stringify({ format: "hm-notes-notebook" }),
      );
      await putFile(await folder("not an id"), NOTEBOOK_FILE, "{}");
      await putFile(await folder(), "stray.json", "{}");
      const assets = await folder("n1", ASSETS_DIRECTORY);
      await putFile(assets, `${toAssetFileName(SOME_ASSET)}.crswap`, "half");
      await putFile(assets, "readme.txt", "x");
      await expect(store.listNotebooks()).resolves.toEqual(["n1"]);
      await expect(store.listAssets("n1")).resolves.toEqual([SOME_ASSET]);
    });

    it.each<[string, unknown, object]>([
      ["of a later version", { format: "hm-notes-library", version: 2, shelves: [] }, laterVersion],
      ["that isn't a document", "not a document", malformed],
      ["of another shape", { format: "hm-notes-library", version: 1, folders: [] }, malformed],
    ])("refuses an index %s, and never replaces it", async (_, record, refusal) => {
      const store = openStore();
      await store.updateIndex(() => indexOf());
      await putRecord(LIBRARY_STORE, record, INDEX_KEY);
      await expect(store.readIndex()).rejects.toMatchObject({ name: "NotesError", ...refusal });
      // A change starts from the stored index: one that can't be read is left for a version that can.
      const change = vi.fn(() => indexOf(notebookOf("n1")));
      await expect(store.updateIndex(change)).rejects.toMatchObject({
        name: "NotesError",
        ...refusal,
      });
      expect(change).not.toHaveBeenCalled();
      await expect(getRecord(LIBRARY_STORE, INDEX_KEY)).resolves.toEqual(record);
    });

    it("refuses a page text that isn't one", async () => {
      const store = openStore();
      await store.writePageText({ notebook: "n1", page: "p1", typed: "words" });
      await putRecord(PAGE_TEXTS_STORE, { notebook: "n1", page: "p2", typed: 5 });
      await expect(store.readPageTexts("n1")).rejects.toMatchObject(malformed);
      // It's only search text: a field that isn't text counts as not stored, and writing puts it right.
      await store.writePageText({ notebook: "n1", page: "p2", pdf: "of the PDF" });
      await expect(store.readPageTexts("n1")).resolves.toEqual([
        { notebook: "n1", page: "p1", typed: "words" },
        { notebook: "n1", page: "p2", typed: "", pdf: "of the PDF" },
      ]);
      await putRecord(PAGE_TEXTS_STORE, { notebook: "n1", page: "p2", typed: "typed", pdf: 5 });
      await store.deletePage("n1", "p2");
      await expect(store.readPageTexts("n1")).resolves.toEqual([
        { notebook: "n1", page: "p1", typed: "words" },
      ]);
    });
  });

  describe("a write that fails", () => {
    const failed = new DOMException("The disk gave up.", "InvalidStateError");

    it.each(["write", "close"] as const)(
      "at %s leaves the earlier notebook and page as they were",
      async (step) => {
        const store = openStore();
        await store.writeNotebook(notebookOf("n1"));
        await store.writePage("n1", pageOf("p1"));
        const before = await fileText(await folder("n1"), NOTEBOOK_FILE);

        const writes = failWrites(step, failed);
        const rejection = { name: "NotesError", code: "STORAGE_FAILED", cause: failed };
        await expect(
          store.writeNotebook(notebookOf("n1", { title: "Lost" })),
        ).rejects.toMatchObject(rejection);
        await expect(store.writePage("n1", pageOf("p1", []))).rejects.toMatchObject(rejection);
        // Each temporary file was dropped, not left to replace the real one.
        expect(writes.aborted()).toBe(2);
        vi.restoreAllMocks();

        await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
        await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
        expect(await fileText(await folder("n1"), NOTEBOOK_FILE)).toBe(before);
        expect(await namesIn(await folder("n1", PAGES_DIRECTORY))).toEqual(["p1.json"]);

        // And the store still writes afterwards.
        await store.writeNotebook(notebookOf("n1", { title: "Kept" }));
        await expect(store.readNotebook("n1")).resolves.toEqual(
          notebookOf("n1", { title: "Kept" }),
        );
      },
    );

    it.each(["write", "close"] as const)(
      "at %s, as a document's first, leaves no document at all",
      async (step) => {
        const store = openStore();
        failWrites(step, failed);
        await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject({
          code: "STORAGE_FAILED",
        });
        await expect(store.writePage("n1", pageOf("p1"))).rejects.toMatchObject({
          code: "STORAGE_FAILED",
        });
        await expect(store.writeAsset("n1", SOME_ASSET, new Blob(["x"]))).rejects.toMatchObject({
          code: "STORAGE_FAILED",
        });
        vi.restoreAllMocks();
        await expect(store.readNotebook("n1")).resolves.toBeUndefined();
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.listNotebooks()).resolves.toEqual([]);
        await expect(store.listAssets("n1")).resolves.toEqual([]);
        // Not even the empty files the writes made, which would read as missing too.
        expect(await namesIn(await folder("n1"))).toEqual([ASSETS_DIRECTORY, PAGES_DIRECTORY]);
        expect(await namesIn(await folder("n1", PAGES_DIRECTORY))).toEqual([]);
        expect(await namesIn(await folder("n1", ASSETS_DIRECTORY))).toEqual([]);
      },
    );

    it("as a document's first, leaves what another writer stored there meanwhile", async () => {
      const store = openStore();
      const theirs = JSON.stringify({ format: "hm-notes-page", version: 1, id: "p1", items: [] });
      const createWritable = FileSystemFileHandle.prototype.createWritable;
      vi.spyOn(FileSystemFileHandle.prototype, "createWritable").mockImplementationOnce(
        async function (this: FileSystemFileHandle, options) {
          const writable = await createWritable.call(this, options);
          const abort = writable.abort.bind(writable);
          writable.write = async () => {
            throw failed;
          };
          // A writer the store can't keep out, because it takes no lock, stores
          // the page between the failure and the tidying up.
          writable.abort = async (reason) => {
            await abort(reason);
            await putFile(await folder("n1", PAGES_DIRECTORY), "p1.json", theirs);
          };
          return writable;
        },
      );
      await expect(store.writePage("n1", pageOf("p1"))).rejects.toMatchObject({
        code: "STORAGE_FAILED",
        cause: failed,
      });
      expect(await fileText(await folder("n1", PAGES_DIRECTORY), "p1.json")).toBe(theirs);
      await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1", []));
    });

    it("as a document's first, leaves an empty file where there is no Web Locks API", async () => {
      const store = openStore();
      await withoutWebLocks(async () => {
        failWrites("write", failed);
        await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject({
          code: "STORAGE_FAILED",
        });
        await expect(store.writePage("n1", pageOf("p1"))).rejects.toMatchObject({
          code: "STORAGE_FAILED",
        });
        vi.restoreAllMocks();
        // Another tab can't be kept out there, and could store its document between the look
        // at an empty file and its removal. So the files stay, and read as none.
        const pages = await folder("n1", PAGES_DIRECTORY);
        expect(await namesIn(await folder("n1"))).toEqual([NOTEBOOK_FILE, PAGES_DIRECTORY]);
        expect(await namesIn(pages)).toEqual(["p1.json"]);
        expect(await fileText(pages, "p1.json")).toBe("");
        await expect(store.readNotebook("n1")).resolves.toBeUndefined();
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.listNotebooks()).resolves.toEqual([]);
        // And the next write fills them.
        await store.writePage("n1", pageOf("p1"));
        await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
      });
    });

    it("of two stores' first writes of one page, made together, leaves the other's", async () => {
      const first = openStore();
      const second = openStore();
      let stored: () => void = () => {};
      const otherStored = new Promise<void>((resolve) => {
        stored = resolve;
      });
      let fail: () => void = () => {};
      const untilFailing = new Promise<void>((resolve) => {
        fail = resolve;
      });
      let failing = false;
      let opened = 0;
      let together = false;
      const createWritable = FileSystemFileHandle.prototype.createWritable;
      vi.spyOn(FileSystemFileHandle.prototype, "createWritable").mockImplementation(async function (
        this: FileSystemFileHandle,
        options,
      ) {
        const writable = await createWritable.call(this, options);
        if (this.name !== "p1.json") return writable;
        opened += 1;
        if (opened === 1) {
          // Whichever store gets to the page first fails, once the test says so.
          writable.write = async () => {
            await untilFailing;
            throw failed;
          };
        } else {
          together = !failing;
          const close = writable.close.bind(writable);
          writable.close = async () => {
            await close();
            stored();
          };
        }
        return writable;
      });

      const writes = [first.writePage("n1", pageOf("p1")), second.writePage("n1", pageOf("p1"))];
      // Time for the other store to store the page, were the two writing it
      // at once: the first then fails and tidies up after a page that is
      // stored. Kept apart, the other is still waiting when these are done.
      await Promise.race([
        otherStored,
        Promise.all([first.writePage("n2", pageOf("p2")), second.writePage("n2", pageOf("p2"))]),
      ]);
      failing = true;
      fail();
      const outcomes = (await Promise.allSettled(writes)).map((outcome) => outcome.status);

      expect(outcomes.sort()).toEqual(["fulfilled", "rejected"]);
      // One writer of a file at a time: the other began only when the first had failed.
      expect(together).toBe(false);
      await expect(first.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
      expect(await namesIn(await folder("n1", PAGES_DIRECTORY))).toEqual(["p1.json"]);
    });

    it("for want of room says the disk is full", async () => {
      const store = openStore();
      await store.writePage("n1", pageOf("p1"));
      const full = new DOMException("No room.", "QuotaExceededError");
      failWrites("write", full);
      await expect(store.writePage("n1", pageOf("p1", []))).rejects.toMatchObject({
        name: "NotesError",
        code: "STORAGE_FAILED",
        details: { reason: "quota" },
        cause: full,
      });
      vi.restoreAllMocks();
      await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
    });

    it.each<
      [string, (this: IDBObjectStore, value: unknown, key?: IDBValidKey) => IDBRequest<IDBValidKey>]
    >([
      [
        "can't start",
        () => {
          throw new DOMException("No.", "DataError");
        },
      ],
      [
        "is aborted",
        function (this: IDBObjectStore) {
          const request = this.get(INDEX_KEY) as IDBRequest<IDBValidKey>;
          this.transaction.abort();
          return request;
        },
      ],
    ])("of the index, because it %s, keeps the earlier index", async (_, put) => {
      const store = openStore();
      const other = openStore();
      const heard = vi.fn();
      other.subscribe(heard);
      await store.updateIndex(() => indexOf(notebookOf("n1")));
      vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(put);
      await expect(store.updateIndex(() => indexOf())).rejects.toMatchObject({
        name: "NotesError",
        code: "STORAGE_FAILED",
      });
      await expect(store.readIndex()).resolves.toEqual(indexOf(notebookOf("n1")));
      await store.updateIndex(() => indexOf(notebookOf("n2")));
      // Only the two writes that happened were announced to the other store.
      await delivered();
      expect(heard).toHaveBeenCalledTimes(2);
    });
  });

  describe("the database", () => {
    it("has the documented object stores", async () => {
      const store = openStore();
      await store.readIndex();
      const database = await settled(indexedDB.open(name));
      try {
        expect(database.version).toBe(DATABASE_VERSION);
        expect([...database.objectStoreNames].sort()).toEqual(
          [LIBRARY_STORE, PAGE_TEXTS_STORE].sort(),
        );
        const texts = database.transaction(PAGE_TEXTS_STORE).objectStore(PAGE_TEXTS_STORE);
        expect(texts.keyPath).toEqual(["notebook", "page"]);
        expect([...texts.indexNames]).toEqual([BY_NOTEBOOK]);
      } finally {
        database.close();
      }
    });

    it("lets go when another tab deletes it, and starts again", async () => {
      const store = openStore();
      await store.updateIndex(() => indexOf(notebookOf("n1")));
      await store.writePageText({ notebook: "n1", page: "p1", typed: "words" });
      // Resolves only once every connection has closed, the store's included.
      await deleteDatabase(name);
      await expect(store.readIndex()).resolves.toBeUndefined();
      await expect(store.readPageTexts()).resolves.toEqual([]);
      await store.updateIndex(() => indexOf());
      await expect(store.readIndex()).resolves.toEqual(indexOf());
    });

    it("lets a later release upgrade it, and then says it can't read it", async () => {
      const store = openStore();
      await store.updateIndex(() => indexOf());
      // What another tab running a later release does. It waits for the store's connection to close.
      (await settled(indexedDB.open(name, DATABASE_VERSION + 1))).close();
      await expect(store.readIndex()).rejects.toMatchObject({
        name: "NotesError",
        ...laterVersion,
      });
      await expect(store.updateIndex(() => indexOf())).rejects.toMatchObject(laterVersion);
    });
  });

  describe("without what it needs", () => {
    const unsupported = (feature: string) => ({
      name: "NotesError",
      code: "UNSUPPORTED_ENVIRONMENT",
      details: { feature },
    });

    it("names a missing file system", async () => {
      const store = openStore();
      await without(StorageManager.prototype, "getDirectory", async () => {
        await expect(store.readNotebook("n1")).rejects.toMatchObject(
          unsupported("navigator.storage.getDirectory"),
        );
        await expect(store.readIndex()).rejects.toMatchObject(
          unsupported("navigator.storage.getDirectory"),
        );
      });
      await expect(store.readNotebook("n1")).resolves.toBeUndefined();
    });

    it("names missing whole-file writes, and writes nothing in place", async () => {
      const store = openStore();
      await without(FileSystemFileHandle.prototype, "createWritable", async () => {
        const refusal = unsupported("FileSystemFileHandle.createWritable");
        await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject(refusal);
        await expect(store.readNotebook("n1")).rejects.toMatchObject(refusal);
        await expect(store.updateIndex(() => indexOf())).rejects.toMatchObject(refusal);
      });
      await expect(store.listNotebooks()).resolves.toEqual([]);
      await expect(store.readIndex()).resolves.toBeUndefined();
    });

    it("names a missing IndexedDB", async () => {
      const store = openStore();
      vi.stubGlobal("indexedDB", undefined);
      await expect(store.readIndex()).rejects.toMatchObject(unsupported("indexedDB"));
      await expect(store.writePage("n1", pageOf("p1"))).rejects.toMatchObject(
        unsupported("indexedDB"),
      );
      vi.unstubAllGlobals();
      await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
    });

    it.each(["SecurityError", "UnknownError"])(
      "says storage is unavailable when the file system won't open (%s), and tries again",
      async (error) => {
        const store = openStore();
        vi.spyOn(navigator.storage, "getDirectory").mockRejectedValueOnce(
          new DOMException("No.", error),
        );
        await expect(store.writeNotebook(notebookOf("n1"))).rejects.toMatchObject({
          name: "NotesError",
          code: "STORAGE_FAILED",
          details: { reason: "unavailable" },
        });
        await store.writeNotebook(notebookOf("n1"));
        await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
      },
    );

    it("says storage is unavailable when the database won't open, and tries again", async () => {
      const store = openStore();
      vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
        throw new DOMException("No.", "SecurityError");
      });
      await expect(store.readIndex()).rejects.toMatchObject({
        name: "NotesError",
        code: "STORAGE_FAILED",
        details: { reason: "unavailable" },
      });
      await expect(store.readIndex()).resolves.toBeUndefined();
    });

    it("keeps the page's other stores out of a notebook where there is no Web Locks API", async () => {
      const first = openStore();
      const second = openStore();
      const elsewhere = openStore(newName());
      await withoutWebLocks(async () => {
        const release = await first.lockNotebook("n1");
        expect(release).toBeTypeOf("function");
        await expect(first.lockNotebook("n1")).resolves.toBeUndefined();
        await expect(second.lockNotebook("n1")).resolves.toBeUndefined();
        expect(await second.lockNotebook("n2")).toBeTypeOf("function");
        expect(await elsewhere.lockNotebook("n1")).toBeTypeOf("function");
        release?.();
        const lock = await taken(second, "n1");
        await expect(first.lockNotebook("n1")).resolves.toBeUndefined();
        lock();
      });
    });

    it("still writes, from two stores at once, where there is no Web Locks API", async () => {
      const first = openStore();
      const second = openStore();
      await withoutWebLocks(async () => {
        await Promise.all([
          first.writePage("n1", pageOf("p1")),
          second.writePage("n1", pageOf("p1", [])),
          first.writeNotebook(notebookOf("n1")),
        ]);
        await expect(first.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
        const read = await second.readPage("n1", "p1");
        expect([pageOf("p1"), pageOf("p1", [])]).toContainEqual(read);
      });
    });

    it("never calls a listener where there is no BroadcastChannel", async () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      const store = openStore();
      const other = openStore();
      const heard = vi.fn();
      const stop = other.subscribe(heard);
      await store.updateIndex(() => indexOf());
      await expect(other.readIndex()).resolves.toEqual(indexOf());
      expect(heard).not.toHaveBeenCalled();
      stop();
    });
  });

  describe("across stores", () => {
    const failedChange = new Error("The change gave up.");

    it("hears only its own library, and only an index change", async () => {
      const listening = openStore();
      const sameLibrary = openStore();
      const otherLibrary = openStore(newName());
      const heard = vi.fn();
      listening.subscribe(heard);

      await otherLibrary.updateIndex(() => indexOf());
      const stranger = new BroadcastChannel(name);
      stranger.postMessage({ type: "something-else" });
      await sameLibrary.updateIndex(() => indexOf());
      await delivered();
      stranger.close();

      // Not the other library's change, and not the message that wasn't a store's.
      expect(heard).toHaveBeenCalledTimes(1);
    });

    it("isn't told of a change to the index that threw", async () => {
      const store = openStore();
      const other = openStore();
      const heard = vi.fn();
      other.subscribe(heard);
      await store.updateIndex(() => indexOf());
      await expect(
        store.updateIndex(() => {
          throw failedChange;
        }),
      ).rejects.toBe(failedChange);
      await delivered();
      expect(heard).toHaveBeenCalledTimes(1);
    });

    it("locks a notebook of a storage whose name starts with a hyphen", async () => {
      // The Web Locks API refuses a lock's name that starts with one.
      const hyphened = `-${newName()}`;
      names.push(hyphened);
      const first = openStore(hyphened);
      const second = openStore(hyphened);
      const release = await first.lockNotebook("n1");
      expect(release).toBeTypeOf("function");
      await expect(second.lockNotebook("n1")).resolves.toBeUndefined();
      await first.writePage("n1", pageOf("p1"));
      await expect(second.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
      release?.();
    });

    it("gives a notebook to another store once its holder lets it go", async () => {
      const first = openStore();
      const second = openStore();
      const release = await first.lockNotebook("n1");
      await expect(second.lockNotebook("n1")).resolves.toBeUndefined();
      release?.();
      const taken = await vi.waitFor(async () => {
        const lock = await second.lockNotebook("n1");
        if (!lock) throw new Error("The notebook is still held.");
        return lock;
      });
      // Now the first store is the one that has to wait.
      await expect(first.lockNotebook("n1")).resolves.toBeUndefined();
      taken();
    });
  });

  describe("closing", () => {
    it("finishes the calls already made, and refuses the ones made after", async () => {
      const first = openStore();
      const second = openStore();
      await first.writePage("n1", pageOf("p1"));
      await first.writePageText({ notebook: "n1", page: "p1", typed: "words" });
      const letWritesGo = holdWrites();
      const calls = [
        first.writePage("n1", pageOf("p2", [])),
        first.writeNotebook(notebookOf("n1")),
        // Queued behind the writes, and needs the database when its turn comes.
        first.deletePage("n1", "p1"),
        first.writePageText({ notebook: "n1", page: "p2", typed: "more words" }),
      ];
      const heard = vi.fn();
      second.subscribe(heard);
      const changing = first.updateIndex(() => indexOf(notebookOf("n1")));

      first.close();
      await expect(first.readPage("n1", "p2")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
      await expect(first.writePage("n1", pageOf("p3"))).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      });
      letWritesGo();
      await expect(Promise.all(calls)).resolves.toHaveLength(4);
      await expect(changing).resolves.toEqual(indexOf(notebookOf("n1")));

      await expect(second.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
      await expect(second.readPage("n1", "p2")).resolves.toEqual(pageOf("p2", []));
      await expect(second.readPage("n1", "p1")).resolves.toBeUndefined();
      await expect(second.readPage("n1", "p3")).resolves.toBeUndefined();
      await expect(second.readPageTexts("n1")).resolves.toEqual([
        { notebook: "n1", page: "p2", typed: "more words" },
      ]);
      // The change to the index that was under way was still announced.
      await delivered();
      expect(heard).toHaveBeenCalledTimes(1);
    });

    describe.each([
      ["with Web Locks", (steps: () => Promise<void>) => steps()],
      ["without Web Locks", withoutWebLocks],
    ])("%s", (_, inBrowser) => {
      it.each<[string, (store: NotesStore, release: () => void) => void]>([
        ["the store closes", (store) => store.close()],
        ["its function is called", (_store, release) => release()],
      ])("keeps a notebook, when %s, until the writes made on it have settled", (_how, giveBack) =>
        inBrowser(async () => {
          const first = openStore();
          const second = openStore();
          const release = await first.lockNotebook("n1");
          const letWritesGo = holdWrites();
          const writing = first.writePage("n1", pageOf("p1"));

          giveBack(first, () => release?.());
          // Still the first store's: its write would otherwise land on what the next holder wrote.
          await expect(second.lockNotebook("n1")).resolves.toBeUndefined();
          letWritesGo();
          await writing;
          const lock = await taken(second, "n1");
          await expect(second.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
          lock();
        }),
      );
    });
  });

  describe("persistence", () => {
    it("reports what the browser says", async () => {
      const store = openStore();
      vi.spyOn(navigator.storage, "persisted").mockResolvedValue(true);
      vi.spyOn(navigator.storage, "estimate").mockResolvedValue({ usage: 10, quota: 1_000 });
      await expect(store.persistence()).resolves.toEqual({
        persisted: true,
        usage: 10,
        quota: 1_000,
      });
    });

    it("leaves out what the browser doesn't say", async () => {
      const store = openStore();
      vi.spyOn(navigator.storage, "persisted").mockRejectedValue(
        new DOMException("No.", "SecurityError"),
      );
      vi.spyOn(navigator.storage, "estimate").mockResolvedValue({});
      await expect(store.persistence()).resolves.toEqual({ persisted: undefined });
      vi.spyOn(navigator.storage, "estimate").mockRejectedValue(new TypeError("No."));
      await expect(store.persistence()).resolves.toEqual({ persisted: undefined });
    });

    it("asks the browser to keep the storage, and passes on its answer", async () => {
      const store = openStore();
      const persist = vi.spyOn(navigator.storage, "persist").mockResolvedValue(true);
      await expect(store.requestPersistence()).resolves.toBe(true);
      persist.mockResolvedValue(false);
      await expect(store.requestPersistence()).resolves.toBe(false);
      persist.mockRejectedValue(new DOMException("No.", "NotAllowedError"));
      await expect(store.requestPersistence()).resolves.toBe(false);
      expect(persist).toHaveBeenCalledTimes(3);
    });
  });
});
