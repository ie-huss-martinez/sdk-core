import { afterEach, describe, expect, it, vi } from "vitest";
import { assetNameOf } from "../../src/core/model/ids.js";
import type { NotesItem } from "../../src/core/model/items.js";
import type { NotesLibraryIndex } from "../../src/core/model/library.js";
import type { NotesNotebook, NotesPage } from "../../src/core/model/notebook.js";
import type { NotesPageText, NotesStore } from "../../src/core/ports/notes-store.js";

/** Options of {@link describeNotesStoreContract}. */
export interface NotesStoreContractOptions {
  /**
   * Whether a second store made by `create()` sees the first one's data
   * (true for a store on real storage, where each call opens the same named
   * storage).
   */
  readonly shared?: boolean;
}

/** A valid notebook with two pages, an outline entry and a recording. */
export function notebookOf(id: string, changes: Partial<NotesNotebook> = {}): NotesNotebook {
  return {
    id,
    title: `Notebook ${id}`,
    cover: "blue",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    pages: [
      { id: "p1", width: 59_500, height: 84_200, template: "lined" },
      {
        id: "p2",
        width: 61_200,
        height: 79_200,
        template: "blank",
        background: {
          pdf: { asset: `sha256:${"ab".repeat(32)}`, mediaType: "application/pdf", size: 1_234 },
          pageIndex: 3,
        },
      },
    ],
    outline: [{ id: "o1", title: "Chapter one", page: "p2" }],
    recordings: [
      {
        id: "r1",
        audio: { asset: `sha256:${"cd".repeat(32)}`, mediaType: "audio/webm", size: 99 },
        startedAt: 1_700_000_100_000,
        duration: 61_000,
      },
    ],
    ...changes,
  };
}

/** A valid page holding one item of each kind, unless given others. */
export function pageOf(id: string, items?: readonly NotesItem[]): NotesPage {
  return {
    id,
    items: items ?? [
      {
        id: "s1",
        type: "stroke",
        tool: "pen",
        color: "#1a2b3c",
        size: 250,
        points: [1_000, 2_000, 500, 1_100, 2_050, 620, -40, 2_300, 0],
        audio: { recording: "r1", at: 1_500 },
      },
      {
        id: "s2",
        type: "stroke",
        tool: "highlighter",
        color: "#ffee00",
        size: 1_800,
        points: [0, 0, 1_000],
        uniform: true,
      },
      // Text beyond ASCII and beyond the basic plane, which storage must keep as it is.
      {
        id: "t1",
        type: "text",
        x: 500,
        y: 700,
        width: 20_000,
        text: "caf\u00e9 \u{1F58A}\n<b>plain</b>",
        size: 1_200,
        color: "#000000",
      },
      {
        id: "i1",
        type: "image",
        x: 0,
        y: 10_000,
        width: 30_000,
        height: 20_000,
        image: { asset: `sha256:${"ef".repeat(32)}`, mediaType: "image/png", size: 4_096 },
      },
      { id: "l1", type: "link", x: 100, y: 100, width: 5_000, height: 1_000, page: "p2" },
    ],
  };
}

/** A one-stroke page that differs by where its stroke starts. */
function strokePage(id: string, x: number): NotesPage {
  return pageOf(id, [
    { id: "s1", type: "stroke", tool: "pen", color: "#000000", size: 200, points: [x, 0, 500] },
  ]);
}

/** A valid index listing the notebooks given, in one folder inside another. */
export function indexOf(...notebooks: readonly NotesNotebook[]): NotesLibraryIndex {
  return {
    folders: [
      { id: "f1", name: "School", parent: null, createdAt: 1_700_000_000_000 },
      { id: "f2", name: "Maths", parent: "f1", createdAt: 1_700_000_000_001 },
    ],
    notebooks: notebooks.map((notebook, position) => ({
      id: notebook.id,
      title: notebook.title,
      cover: notebook.cover,
      template: notebook.pages[0]?.template ?? "blank",
      folder: position % 2 === 0 ? "f2" : null,
      pageCount: notebook.pages.length,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt,
      deletedAt: position % 2 === 0 ? null : 1_700_000_900_000,
    })),
    lastBackupAt: null,
    lastChangeAt: notebooks.length === 0 ? null : 1_700_000_500_000,
  };
}

/** A file and the name its bytes give it. */
async function assetOf(bytes: Uint8Array<ArrayBuffer>): Promise<{ name: string; data: Blob }> {
  return { name: await assetNameOf(bytes), data: new Blob([bytes], { type: "application/pdf" }) };
}

const textBytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

const bytesOf = async (blob: Blob | undefined): Promise<number[] | undefined> =>
  blob ? [...new Uint8Array(await blob.arrayBuffer())] : undefined;

const sorted = (values: readonly string[]): string[] => [...values].sort();

const sortedTexts = (texts: readonly NotesPageText[]): NotesPageText[] =>
  [...texts].sort((a, b) => `${a.notebook}/${a.page}`.localeCompare(`${b.notebook}/${b.page}`));

/** What an unsafe id or asset name must be refused with. */
const refusal = (reason: "invalid-id" | "invalid-asset") => ({
  name: "NotesError",
  code: "INVALID_DOCUMENT",
  details: { reason },
});

/**
 * Ids that would leave a store's folder, name something else in it, or
 * aren't ids at all. The last isn't even a string: `null`, because
 * `readPageTexts(undefined)` asks for every notebook's.
 */
const UNSAFE_IDS: readonly string[] = [
  "",
  ".",
  "..",
  "../x",
  "a/b",
  "a\\b",
  "a b",
  "a.json",
  "a\u0000",
  "caf\u00e9",
  "x".repeat(65),
  null as unknown as string,
];

const SAFE_ASSET = `sha256:${"0".repeat(64)}`;

const UNSAFE_ASSETS: readonly string[] = [
  "",
  "0".repeat(64),
  "sha256:",
  `sha256:${"0".repeat(63)}`,
  `sha256:${"0".repeat(65)}`,
  `sha256:${"A".repeat(64)}`,
  `sha256:../${"0".repeat(61)}`,
  `../${SAFE_ASSET}`,
  null as unknown as string,
];

type StoreCall = (store: NotesStore, value: string) => Promise<unknown>;

/** Every call that takes an id, with the id in each place it can go. */
const CALLS_WITH_AN_ID: Readonly<Record<string, StoreCall>> = {
  readNotebook: (store, id) => store.readNotebook(id),
  writeNotebook: (store, id) => store.writeNotebook(notebookOf(id)),
  deleteNotebook: (store, id) => store.deleteNotebook(id),
  "readPage, as the notebook": (store, id) => store.readPage(id, "p1"),
  "readPage, as the page": (store, id) => store.readPage("n1", id),
  "writePage, as the notebook": (store, id) => store.writePage(id, pageOf("p1")),
  "writePage, as the page": (store, id) => store.writePage("n1", pageOf(id)),
  "deletePage, as the notebook": (store, id) => store.deletePage(id, "p1"),
  "deletePage, as the page": (store, id) => store.deletePage("n1", id),
  listAssets: (store, id) => store.listAssets(id),
  readAsset: (store, id) => store.readAsset(id, SAFE_ASSET),
  writeAsset: (store, id) => store.writeAsset(id, SAFE_ASSET, new Blob(["x"])),
  deleteAsset: (store, id) => store.deleteAsset(id, SAFE_ASSET),
  "writePageText, as the notebook": (store, id) =>
    store.writePageText({ notebook: id, page: "p1", typed: "" }),
  "writePageText, as the page": (store, id) =>
    store.writePageText({ notebook: "n1", page: id, typed: "" }),
  readPageTexts: (store, id) => store.readPageTexts(id),
  lockNotebook: (store, id) => store.lockNotebook(id),
};

const CALLS_WITH_AN_ASSET: Readonly<Record<string, StoreCall>> = {
  readAsset: (store, asset) => store.readAsset("n1", asset),
  writeAsset: (store, asset) => store.writeAsset("n1", asset, new Blob(["x"])),
  deleteAsset: (store, asset) => store.deleteAsset("n1", asset),
};

/** Every call that returns a promise, which a closed store must reject. */
const ASYNC_CALLS: Readonly<Record<string, (store: NotesStore) => Promise<unknown>>> = {
  readIndex: (store) => store.readIndex(),
  writeIndex: (store) => store.writeIndex(indexOf()),
  listNotebooks: (store) => store.listNotebooks(),
  readNotebook: (store) => store.readNotebook("n1"),
  writeNotebook: (store) => store.writeNotebook(notebookOf("n1")),
  deleteNotebook: (store) => store.deleteNotebook("n1"),
  readPage: (store) => store.readPage("n1", "p1"),
  writePage: (store) => store.writePage("n1", pageOf("p1")),
  deletePage: (store) => store.deletePage("n1", "p1"),
  listAssets: (store) => store.listAssets("n1"),
  readAsset: (store) => store.readAsset("n1", SAFE_ASSET),
  writeAsset: (store) => store.writeAsset("n1", SAFE_ASSET, new Blob(["x"])),
  deleteAsset: (store) => store.deleteAsset("n1", SAFE_ASSET),
  writePageText: (store) => store.writePageText({ notebook: "n1", page: "p1", typed: "" }),
  readPageTexts: (store) => store.readPageTexts(),
  lockNotebook: (store) => store.lockNotebook("n1"),
  persistence: (store) => store.persistence(),
  requestPersistence: (store) => store.requestPersistence(),
};

/** Counts a store's notifications, and lets a test wait for the next one. */
function listenTo(store: NotesStore) {
  let calls = 0;
  const waiting: (() => void)[] = [];
  const stop = store.subscribe(() => {
    calls += 1;
    for (const resolve of waiting.splice(0)) resolve();
  });
  return {
    calls: () => calls,
    next: () => new Promise<void>((resolve) => waiting.push(resolve)),
    stop,
  };
}

/**
 * The behaviour every {@link NotesStore} must have (sdk-core ADR 0008):
 * the SDK's own stores run it, and a host's store can.
 *
 * @param name - The store's name, for the suite's title.
 * @param create - Makes a store. Each test asks for its own.
 * @param options - What kind of store it is.
 */
export function describeNotesStoreContract(
  name: string,
  create: () => Promise<NotesStore> | NotesStore,
  options: NotesStoreContractOptions = {},
): void {
  describe(`${name}: the NotesStore contract`, () => {
    const opened: NotesStore[] = [];
    const open = async (): Promise<NotesStore> => {
      const store = await create();
      opened.push(store);
      return store;
    };
    afterEach(() => {
      for (const store of opened.splice(0)) store.close();
    });

    describe("an empty store", () => {
      it("has nothing to read", async () => {
        const store = await open();
        await expect(store.readIndex()).resolves.toBeUndefined();
        await expect(store.listNotebooks()).resolves.toEqual([]);
        await expect(store.readNotebook("n1")).resolves.toBeUndefined();
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.listAssets("n1")).resolves.toEqual([]);
        await expect(store.readAsset("n1", SAFE_ASSET)).resolves.toBeUndefined();
        await expect(store.readPageTexts()).resolves.toEqual([]);
        await expect(store.readPageTexts("n1")).resolves.toEqual([]);
      });

      it("resolves when asked to delete what it doesn't have", async () => {
        const store = await open();
        await expect(store.deleteNotebook("n1")).resolves.toBeUndefined();
        await expect(store.deletePage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.deleteAsset("n1", SAFE_ASSET)).resolves.toBeUndefined();
        // And the same in a notebook that exists.
        await store.writeNotebook(notebookOf("n1"));
        await expect(store.deletePage("n1", "p9")).resolves.toBeUndefined();
        await expect(store.deleteAsset("n1", SAFE_ASSET)).resolves.toBeUndefined();
        await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
      });
    });

    describe("the index", () => {
      it("reads back what was written", async () => {
        const store = await open();
        const index = indexOf(notebookOf("n1"), notebookOf("n2"));
        await store.writeIndex(index);
        await expect(store.readIndex()).resolves.toEqual(index);
      });

      it("replaces the earlier index as a whole", async () => {
        const store = await open();
        await store.writeIndex(indexOf(notebookOf("n1"), notebookOf("n2")));
        const emptied: NotesLibraryIndex = {
          folders: [],
          notebooks: [],
          lastBackupAt: 5,
          lastChangeAt: null,
        };
        await store.writeIndex(emptied);
        await expect(store.readIndex()).resolves.toEqual(emptied);
      });

      it("keeps the last of two writes made together", async () => {
        const store = await open();
        const first = indexOf(notebookOf("n1"));
        const second = indexOf(notebookOf("n2"));
        await Promise.all([store.writeIndex(first), store.writeIndex(second)]);
        await expect(store.readIndex()).resolves.toEqual(second);
      });
    });

    describe("notebooks", () => {
      it("reads back what was written", async () => {
        const store = await open();
        const notebook = notebookOf("n1");
        await store.writeNotebook(notebook);
        await expect(store.readNotebook("n1")).resolves.toEqual(notebook);
        await expect(store.readNotebook("n2")).resolves.toBeUndefined();
      });

      it("replaces the earlier notebook as a whole", async () => {
        const store = await open();
        await store.writeNotebook(notebookOf("n1"));
        const smaller = notebookOf("n1", {
          title: "Renamed",
          pages: [{ id: "p7", width: 59_500, height: 84_200, template: "grid" }],
          outline: [],
          recordings: [],
        });
        await store.writeNotebook(smaller);
        await expect(store.readNotebook("n1")).resolves.toEqual(smaller);
      });

      it("keeps the last of two writes made together", async () => {
        const store = await open();
        const first = notebookOf("n1", { title: "First" });
        const second = notebookOf("n1", { title: "Second" });
        await Promise.all([store.writeNotebook(first), store.writeNotebook(second)]);
        await expect(store.readNotebook("n1")).resolves.toEqual(second);
      });

      it("keeps ids that differ only by case apart", async () => {
        const store = await open();
        const lower = notebookOf("abc", { title: "Lower" });
        const upper = notebookOf("ABC", { title: "Upper" });
        await store.writeNotebook(lower);
        await store.writeNotebook(upper);
        await store.writePage("abc", strokePage("pa", 1));
        await store.writePage("abc", strokePage("PA", 2));
        await expect(store.readNotebook("abc")).resolves.toEqual(lower);
        await expect(store.readNotebook("ABC")).resolves.toEqual(upper);
        await expect(store.readPage("abc", "pa")).resolves.toEqual(strokePage("pa", 1));
        await expect(store.readPage("abc", "PA")).resolves.toEqual(strokePage("PA", 2));
        expect(sorted(await store.listNotebooks())).toEqual(["ABC", "abc"]);
      });

      it("lists the notebooks it holds", async () => {
        const store = await open();
        await store.writeNotebook(notebookOf("n1"));
        await store.writeNotebook(notebookOf("n2"));
        await store.writeNotebook(notebookOf("n2", { title: "Again" }));
        await store.writeNotebook(notebookOf("with-dash_and_underscore"));
        expect(sorted(await store.listNotebooks())).toEqual([
          "n1",
          "n2",
          "with-dash_and_underscore",
        ]);
      });

      it("lists a notebook only once it has a document", async () => {
        const store = await open();
        const asset = await assetOf(textBytes("a file"));
        await store.writePage("n1", pageOf("p1"));
        await store.writeAsset("n1", asset.name, asset.data);
        await store.writePageText({ notebook: "n1", page: "p1", typed: "words" });
        await expect(store.listNotebooks()).resolves.toEqual([]);
        await store.writeNotebook(notebookOf("n1"));
        await expect(store.listNotebooks()).resolves.toEqual(["n1"]);
      });
    });

    describe("pages", () => {
      it("reads back what was written", async () => {
        const store = await open();
        const page = pageOf("p1");
        await store.writePage("n1", page);
        await expect(store.readPage("n1", "p1")).resolves.toEqual(page);
        await expect(store.readPage("n1", "p2")).resolves.toBeUndefined();
      });

      it("reads back an empty page", async () => {
        const store = await open();
        await store.writePage("n1", pageOf("p1", []));
        await expect(store.readPage("n1", "p1")).resolves.toEqual({ id: "p1", items: [] });
      });

      it("replaces the earlier page as a whole", async () => {
        const store = await open();
        await store.writePage("n1", pageOf("p1"));
        await store.writePage("n1", strokePage("p1", 7));
        await expect(store.readPage("n1", "p1")).resolves.toEqual(strokePage("p1", 7));
      });

      it("keeps the last of two writes made together", async () => {
        const store = await open();
        await Promise.all([
          store.writePage("n1", strokePage("p1", 1)),
          store.writePage("n1", strokePage("p1", 2)),
        ]);
        await expect(store.readPage("n1", "p1")).resolves.toEqual(strokePage("p1", 2));
      });

      it("deletes one page and leaves the others", async () => {
        const store = await open();
        await store.writePage("n1", strokePage("p1", 1));
        await store.writePage("n1", strokePage("p2", 2));
        await store.deletePage("n1", "p1");
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.readPage("n1", "p2")).resolves.toEqual(strokePage("p2", 2));
      });

      it("never shows a page of one notebook in another", async () => {
        const store = await open();
        await store.writePage("n1", strokePage("p1", 1));
        await expect(store.readPage("n2", "p1")).resolves.toBeUndefined();
        await store.writePage("n2", strokePage("p1", 2));
        await expect(store.readPage("n1", "p1")).resolves.toEqual(strokePage("p1", 1));
        await store.deletePage("n2", "p1");
        await expect(store.readPage("n1", "p1")).resolves.toEqual(strokePage("p1", 1));
      });
    });

    describe("assets", () => {
      it("reads back the bytes that were written", async () => {
        const store = await open();
        // Every byte value, many times over, so nothing is taken for text.
        const bytes = Uint8Array.from({ length: 300_000 }, (_, position) => (position * 7) % 256);
        const asset = await assetOf(bytes);
        await store.writeAsset("n1", asset.name, asset.data);
        const read = await store.readAsset("n1", asset.name);
        expect(read?.size).toBe(bytes.length);
        expect(await bytesOf(read)).toEqual([...bytes]);
      });

      it("reads back a file with no bytes", async () => {
        const store = await open();
        const asset = await assetOf(new Uint8Array(0));
        await store.writeAsset("n1", asset.name, asset.data);
        await expect(store.listAssets("n1")).resolves.toEqual([asset.name]);
        expect((await store.readAsset("n1", asset.name))?.size).toBe(0);
      });

      it("lists a notebook's files, and keeps one of a name written twice", async () => {
        const store = await open();
        const first = await assetOf(textBytes("first"));
        const second = await assetOf(textBytes("second"));
        await store.writeAsset("n1", first.name, first.data);
        await store.writeAsset("n1", second.name, second.data);
        await store.writeAsset("n1", first.name, first.data);
        expect(sorted(await store.listAssets("n1"))).toEqual(sorted([first.name, second.name]));
        expect(await bytesOf(await store.readAsset("n1", first.name))).toEqual([
          ...textBytes("first"),
        ]);
      });

      it("deletes one file and leaves the others", async () => {
        const store = await open();
        const first = await assetOf(textBytes("first"));
        const second = await assetOf(textBytes("second"));
        await store.writeAsset("n1", first.name, first.data);
        await store.writeAsset("n1", second.name, second.data);
        await store.deleteAsset("n1", first.name);
        await expect(store.readAsset("n1", first.name)).resolves.toBeUndefined();
        await expect(store.listAssets("n1")).resolves.toEqual([second.name]);
        expect(await bytesOf(await store.readAsset("n1", second.name))).toEqual([
          ...textBytes("second"),
        ]);
      });

      it("never shows a file of one notebook in another", async () => {
        const store = await open();
        const asset = await assetOf(textBytes("only in n1"));
        await store.writeAsset("n1", asset.name, asset.data);
        await expect(store.readAsset("n2", asset.name)).resolves.toBeUndefined();
        await expect(store.listAssets("n2")).resolves.toEqual([]);
      });
    });

    describe("page texts", () => {
      const first: NotesPageText = { notebook: "n1", page: "p1", typed: "typed words" };
      const second: NotesPageText = {
        notebook: "n1",
        page: "p2",
        typed: "",
        pdf: "words of the PDF",
      };
      const other: NotesPageText = { notebook: "n2", page: "p1", typed: "elsewhere", pdf: "" };

      it("reads them back, for one notebook and for all", async () => {
        const store = await open();
        for (const entry of [first, second, other]) await store.writePageText(entry);
        expect(sortedTexts(await store.readPageTexts("n1"))).toEqual([first, second]);
        expect(sortedTexts(await store.readPageTexts("n2"))).toEqual([other]);
        expect(sortedTexts(await store.readPageTexts())).toEqual([first, second, other]);
        await expect(store.readPageTexts("n3")).resolves.toEqual([]);
      });

      it("replaces a page's text as a whole", async () => {
        const store = await open();
        await store.writePageText(second);
        const replaced: NotesPageText = { notebook: "n1", page: "p2", typed: "now typed" };
        await store.writePageText(replaced);
        const read = await store.readPageTexts("n1");
        expect(read).toEqual([replaced]);
        expect(read[0]).not.toHaveProperty("pdf");
      });

      it("drops a page's text with the page", async () => {
        const store = await open();
        for (const entry of [first, second, other]) await store.writePageText(entry);
        await store.deletePage("n1", "p1");
        expect(sortedTexts(await store.readPageTexts())).toEqual([second, other]);
      });

      it("drops a notebook's texts with the notebook", async () => {
        const store = await open();
        for (const entry of [first, second, other]) await store.writePageText(entry);
        await store.deleteNotebook("n1");
        await expect(store.readPageTexts("n1")).resolves.toEqual([]);
        await expect(store.readPageTexts()).resolves.toEqual([other]);
      });
    });

    describe("deleteNotebook", () => {
      it("removes the document, pages, files and texts, and nothing of another notebook", async () => {
        const store = await open();
        const asset = await assetOf(textBytes("a file"));
        for (const id of ["n1", "n2"]) {
          await store.writeNotebook(notebookOf(id));
          await store.writePage(id, pageOf("p1"));
          await store.writeAsset(id, asset.name, asset.data);
          await store.writePageText({ notebook: id, page: "p1", typed: `text of ${id}` });
        }

        await store.deleteNotebook("n1");

        await expect(store.readNotebook("n1")).resolves.toBeUndefined();
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
        await expect(store.listAssets("n1")).resolves.toEqual([]);
        await expect(store.readAsset("n1", asset.name)).resolves.toBeUndefined();
        await expect(store.readPageTexts("n1")).resolves.toEqual([]);
        await expect(store.listNotebooks()).resolves.toEqual(["n2"]);

        await expect(store.readNotebook("n2")).resolves.toEqual(notebookOf("n2"));
        await expect(store.readPage("n2", "p1")).resolves.toEqual(pageOf("p1"));
        await expect(store.listAssets("n2")).resolves.toEqual([asset.name]);
        expect(await bytesOf(await store.readAsset("n2", asset.name))).toEqual([
          ...textBytes("a file"),
        ]);
        await expect(store.readPageTexts("n2")).resolves.toEqual([
          { notebook: "n2", page: "p1", typed: "text of n2" },
        ]);
      });

      it("leaves a notebook that can be written again", async () => {
        const store = await open();
        await store.writeNotebook(notebookOf("n1"));
        await store.writePage("n1", pageOf("p1"));
        await store.deleteNotebook("n1");
        await store.writeNotebook(notebookOf("n1", { title: "New" }));
        await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1", { title: "New" }));
        await expect(store.readPage("n1", "p1")).resolves.toBeUndefined();
      });
    });

    describe("what a caller holds", () => {
      it("isn't what the store keeps of an index", async () => {
        const store = await open();
        const index = indexOf(notebookOf("n1"));
        const writing = store.writeIndex(index);
        // Changed before the write has even finished.
        (index.notebooks as unknown[]).length = 0;
        await writing;
        const read = await store.readIndex();
        expect(read).toEqual(indexOf(notebookOf("n1")));
        (read?.folders as unknown[]).length = 0;
        await expect(store.readIndex()).resolves.toEqual(indexOf(notebookOf("n1")));
      });

      it("isn't what the store keeps of a notebook", async () => {
        const store = await open();
        const notebook = notebookOf("n1");
        const writing = store.writeNotebook(notebook);
        (notebook as { title: string }).title = "Changed after writing";
        (notebook.pages as unknown[]).length = 0;
        await writing;
        const read = await store.readNotebook("n1");
        expect(read).toEqual(notebookOf("n1"));
        expect(read).not.toBe(notebook);
        (read as { title: string }).title = "Changed after reading";
        (read?.pages as unknown[]).length = 0;
        const again = await store.readNotebook("n1");
        expect(again).toEqual(notebookOf("n1"));
        expect(again).not.toBe(read);
      });

      it("isn't what the store keeps of a page", async () => {
        const store = await open();
        const page = pageOf("p1");
        const writing = store.writePage("n1", page);
        const stroke = page.items[0];
        if (stroke?.type === "stroke") (stroke.points as number[])[0] = 99;
        (page.items as unknown[]).length = 1;
        await writing;
        const read = await store.readPage("n1", "p1");
        expect(read).toEqual(pageOf("p1"));
        (read?.items as unknown[]).length = 0;
        await expect(store.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
      });

      it("isn't what the store keeps of a page's text", async () => {
        const store = await open();
        const entry: NotesPageText = { notebook: "n1", page: "p1", typed: "words", pdf: "more" };
        const writing = store.writePageText(entry);
        (entry as { typed: string }).typed = "changed after writing";
        await writing;
        const read = await store.readPageTexts("n1");
        expect(read).toEqual([{ notebook: "n1", page: "p1", typed: "words", pdf: "more" }]);
        (read[0] as { typed: string }).typed = "changed after reading";
        await expect(store.readPageTexts("n1")).resolves.toEqual([
          { notebook: "n1", page: "p1", typed: "words", pdf: "more" },
        ]);
      });
    });

    describe("lockNotebook", () => {
      it("refuses a second lock until the first is given back", async () => {
        const store = await open();
        const release = await store.lockNotebook("n1");
        expect(release).toBeTypeOf("function");
        await expect(store.lockNotebook("n1")).resolves.toBeUndefined();
        await expect(store.lockNotebook("n1")).resolves.toBeUndefined();
        release?.();
        const again = await store.lockNotebook("n1");
        expect(again).toBeTypeOf("function");
        again?.();
      });

      it("locks each notebook on its own", async () => {
        const store = await open();
        const first = await store.lockNotebook("n1");
        const second = await store.lockNotebook("n2");
        expect(first).toBeTypeOf("function");
        expect(second).toBeTypeOf("function");
        first?.();
        await expect(store.lockNotebook("n2")).resolves.toBeUndefined();
        second?.();
      });

      it("gives a lock back once, however often its function is called", async () => {
        const store = await open();
        const first = await store.lockNotebook("n1");
        first?.();
        const second = await store.lockNotebook("n1");
        expect(second).toBeTypeOf("function");
        // The first holder's function no longer has anything to give back.
        first?.();
        await expect(store.lockNotebook("n1")).resolves.toBeUndefined();
        second?.();
      });

      it("doesn't keep a locked notebook from being read or written", async () => {
        const store = await open();
        const release = await store.lockNotebook("n1");
        await store.writeNotebook(notebookOf("n1"));
        await expect(store.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
        release?.();
      });
    });

    describe("subscribe", () => {
      it("doesn't tell a store of its own writes", async () => {
        const store = await open();
        const listener = vi.fn();
        const stop = store.subscribe(listener);
        await store.writeIndex(indexOf());
        await store.writeNotebook(notebookOf("n1"));
        expect(listener).not.toHaveBeenCalled();
        stop();
        stop();
      });

      it.runIf(options.shared)(
        "tells a store when another writes the index, and only then",
        async () => {
          const first = await open();
          const second = await open();
          const heardByFirst = listenTo(first);
          const heardBySecond = listenTo(second);

          const secondHears = heardBySecond.next();
          await first.writeIndex(indexOf(notebookOf("n1")));
          await secondHears;

          const firstHears = heardByFirst.next();
          await second.writeIndex(indexOf(notebookOf("n1"), notebookOf("n2")));
          await firstHears;

          // Its own write was announced before the other's, so it would have been heard by now.
          expect(heardByFirst.calls()).toBe(1);
          await expect(first.readIndex()).resolves.toEqual(
            indexOf(notebookOf("n1"), notebookOf("n2")),
          );
        },
      );

      it.runIf(options.shared)("stops telling a listener that unsubscribed", async () => {
        const first = await open();
        const second = await open();
        const stopped = listenTo(first);
        const kept = listenTo(first);
        stopped.stop();

        const heard = kept.next();
        await second.writeIndex(indexOf());
        await heard;

        expect(stopped.calls()).toBe(0);
        expect(kept.calls()).toBe(1);
      });
    });

    describe.runIf(options.shared)("a second store on the same storage", () => {
      it("reads what the first wrote", async () => {
        const first = await open();
        const second = await open();
        const asset = await assetOf(textBytes("a file"));
        await first.writeIndex(indexOf(notebookOf("n1")));
        await first.writeNotebook(notebookOf("n1"));
        await first.writePage("n1", pageOf("p1"));
        await first.writeAsset("n1", asset.name, asset.data);
        await first.writePageText({ notebook: "n1", page: "p1", typed: "words" });

        await expect(second.readIndex()).resolves.toEqual(indexOf(notebookOf("n1")));
        await expect(second.listNotebooks()).resolves.toEqual(["n1"]);
        await expect(second.readNotebook("n1")).resolves.toEqual(notebookOf("n1"));
        await expect(second.readPage("n1", "p1")).resolves.toEqual(pageOf("p1"));
        expect(await bytesOf(await second.readAsset("n1", asset.name))).toEqual([
          ...textBytes("a file"),
        ]);
        await expect(second.readPageTexts()).resolves.toEqual([
          { notebook: "n1", page: "p1", typed: "words" },
        ]);
      });

      it("can't take a notebook the first holds", async () => {
        const first = await open();
        const second = await open();
        const release = await first.lockNotebook("n1");
        expect(release).toBeTypeOf("function");
        await expect(second.lockNotebook("n1")).resolves.toBeUndefined();
        const other = await second.lockNotebook("n2");
        expect(other).toBeTypeOf("function");
        other?.();
        release?.();
      });
    });

    describe("persistence", () => {
      it("says whether the storage is kept, and how full it is when it knows", async () => {
        const store = await open();
        const persistence = await store.persistence();
        expect(persistence).toBeTypeOf("object");
        expect(["boolean", "undefined"]).toContain(typeof persistence.persisted);
        if (persistence.usage !== undefined) expect(persistence.usage).toBeGreaterThanOrEqual(0);
        if (persistence.quota !== undefined) expect(persistence.quota).toBeGreaterThanOrEqual(0);
      });

      it("answers a request to keep the storage with yes or no", async () => {
        const store = await open();
        expect(await store.requestPersistence()).toBeTypeOf("boolean");
      });
    });

    describe("unsafe ids", () => {
      it.each(Object.entries(CALLS_WITH_AN_ID))("%s refuses them", async (_, call) => {
        const store = await open();
        for (const id of UNSAFE_IDS) {
          await expect(call(store, id), `the id ${JSON.stringify(id)}`).rejects.toMatchObject(
            refusal("invalid-id"),
          );
        }
        await expect(store.listNotebooks()).resolves.toEqual([]);
        await expect(store.readPageTexts()).resolves.toEqual([]);
      });

      it.each(Object.entries(CALLS_WITH_AN_ASSET))(
        "%s refuses an unsafe file name",
        async (_, call) => {
          const store = await open();
          for (const asset of UNSAFE_ASSETS) {
            await expect(
              call(store, asset),
              `the name ${JSON.stringify(asset)}`,
            ).rejects.toMatchObject(refusal("invalid-asset"));
          }
          await expect(store.listAssets("n1")).resolves.toEqual([]);
        },
      );
    });

    describe("close", () => {
      it.each(Object.entries(ASYNC_CALLS))("makes %s reject", async (_, call) => {
        const store = await open();
        await store.writeNotebook(notebookOf("n1"));
        store.close();
        await expect(call(store)).rejects.toMatchObject({
          name: "NotesError",
          code: "STORAGE_FAILED",
        });
      });

      it("can be called twice, and leaves subscribe and a lock's function harmless", async () => {
        const store = await open();
        const release = await store.lockNotebook("n1");
        store.close();
        store.close();
        expect(() => release?.()).not.toThrow();
        const stop = store.subscribe(() => {});
        expect(() => stop()).not.toThrow();
      });

      it.runIf(options.shared)("gives back the notebooks the store held", async () => {
        const first = await open();
        const second = await open();
        await first.lockNotebook("n1");
        first.close();
        // The lock is given back as the store closes, which another store sees a moment later.
        const release = await vi.waitFor(async () => {
          const taken = await second.lockNotebook("n1");
          if (!taken) throw new Error("The notebook is still held.");
          return taken;
        });
        release();
      });
    });
  });
}
