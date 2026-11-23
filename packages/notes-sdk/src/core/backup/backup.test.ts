import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NotesError } from "../errors/notes-error.js";
import { type NotesFilePolicyOverrides, notesLimits } from "../errors/notes-limits.js";
import { toNotesNotebookDocument, toNotesPageDocument } from "../format/documents.js";
import { assetNameOf } from "../model/ids.js";
import type { NotesAssetReference } from "../model/items.js";
import {
  EMPTY_LIBRARY,
  type NotesFolder,
  type NotesLibraryIndex,
  type NotesNotebookSummary,
} from "../model/library.js";
import type { NotesNotebook, NotesPage } from "../model/notebook.js";
import type { NotesPageText, NotesStore } from "../ports/notes-store.js";
import type { NotesProgress } from "../ports/options.js";
import { createNotesBackup, type NotesRestoreOptions, restoreNotesBackup } from "./backup.js";
import {
  LIBRARY_V1_PICTURE_NAME,
  LIBRARY_V1_TIME,
  libraryV1Index,
  libraryV1Notebooks,
  libraryV1Pages,
  libraryV1Picture,
} from "./fixtures/library-v1.js";
import { createZipWriter, readZip } from "./zip.js";

type Bytes = Uint8Array<ArrayBuffer>;

const T0 = 1_767_225_600_000;
const NOW = T0 + 86_400_000;
const LIMITS = { maxEntries: 10_000, maxSize: 100_000_000 };
const A4 = { width: 59_500, height: 84_200 };

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const bytesOf = async (blob: Blob): Promise<Bytes> => new Uint8Array(await blob.arrayBuffer());

/** What a store holds, and every write it was asked for. */
interface FakeStore {
  readonly store: NotesStore;
  readonly notebooks: Map<string, NotesNotebook>;
  /** Pages, files and search text, each by `<notebook>/<page or file>`. */
  readonly pages: Map<string, NotesPage>;
  readonly assets: Map<string, Blob>;
  readonly texts: Map<string, NotesPageText>;
  /** Each write, as `<kind> <key>`, in order. */
  readonly writes: string[];
  /** Called after each write. */
  afterWrite: (write: string) => void;
  /** Makes `readNotebook` of an id reject. */
  readonly unreadable: Map<string, NotesError>;
}

/** A store in memory that keeps what it's given, and remembers every write. */
function createFakeStore(): FakeStore {
  const notebooks = new Map<string, NotesNotebook>();
  const pages = new Map<string, NotesPage>();
  const assets = new Map<string, Blob>();
  const texts = new Map<string, NotesPageText>();
  const writes: string[] = [];
  const unreadable = new Map<string, NotesError>();
  let index: NotesLibraryIndex | undefined;
  const fake: FakeStore = {
    notebooks,
    pages,
    assets,
    texts,
    writes,
    unreadable,
    afterWrite: () => undefined,
    store: {
      readIndex: async () => index,
      writeIndex: async (value) => {
        index = structuredClone(value);
        wrote("index");
      },
      listNotebooks: async () => [...notebooks.keys()],
      readNotebook: async (id) => {
        const failure = unreadable.get(id);
        if (failure) throw failure;
        return structuredClone(notebooks.get(id));
      },
      writeNotebook: async (notebook) => {
        notebooks.set(notebook.id, structuredClone(notebook));
        wrote(`notebook ${notebook.id}`);
      },
      deleteNotebook: async (id) => {
        notebooks.delete(id);
        wrote(`delete ${id}`);
      },
      readPage: async (notebook, page) => structuredClone(pages.get(`${notebook}/${page}`)),
      writePage: async (notebook, page) => {
        pages.set(`${notebook}/${page.id}`, structuredClone(page));
        wrote(`page ${notebook}/${page.id}`);
      },
      deletePage: async (notebook, page) => {
        pages.delete(`${notebook}/${page}`);
        wrote(`delete ${notebook}/${page}`);
      },
      listAssets: async (notebook) =>
        [...assets.keys()]
          .filter((key) => key.startsWith(`${notebook}/`))
          .map((key) => key.slice(notebook.length + 1)),
      readAsset: async (notebook, asset) => assets.get(`${notebook}/${asset}`),
      writeAsset: async (notebook, asset, data) => {
        assets.set(`${notebook}/${asset}`, data);
        wrote(`asset ${notebook}/${asset}`);
      },
      deleteAsset: async (notebook, asset) => {
        assets.delete(`${notebook}/${asset}`);
        wrote(`delete ${notebook}/${asset}`);
      },
      writePageText: async (entry) => {
        texts.set(`${entry.notebook}/${entry.page}`, structuredClone(entry));
        wrote(`text ${entry.notebook}/${entry.page}`);
      },
      readPageTexts: async (notebook) =>
        [...texts.values()].filter(
          (entry) => notebook === undefined || entry.notebook === notebook,
        ),
      lockNotebook: async () => () => undefined,
      persistence: async () => ({ persisted: false }),
      requestPersistence: async () => false,
      subscribe: () => () => undefined,
      close: () => undefined,
    },
  };
  function wrote(write: string): void {
    writes.push(write);
    fake.afterWrite(write);
  }
  return fake;
}

async function referenceTo(data: Bytes, mediaType: string): Promise<NotesAssetReference> {
  return { asset: await assetNameOf(data), mediaType, size: data.length };
}

const PICTURE = utf8("not really a PNG, but bytes all the same");
const PDF = utf8("%PDF-1.7 and nothing else");
const SOUND = new Uint8Array([0, 255, 1, 254, 2, 253, 3, 252]);

const school: NotesFolder = { id: "school", name: "School", parent: null, createdAt: T0 };
const science: NotesFolder = {
  id: "science",
  name: "Science",
  parent: "school",
  createdAt: T0 + 1,
};
const spare: NotesFolder = { id: "spare", name: "Spare", parent: null, createdAt: T0 + 2 };

function summaryOf(
  notebook: NotesNotebook,
  folder: string | null,
  deletedAt: number | null = null,
): NotesNotebookSummary {
  return {
    id: notebook.id,
    title: notebook.title,
    cover: notebook.cover,
    template: notebook.pages[0]?.template ?? "blank",
    folder,
    pageCount: notebook.pages.length,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    deletedAt,
  };
}

/**
 * A library of three notebooks: one of three pages with a PDF, a recording
 * and a picture, in a folder inside a folder; one at the top that shares
 * the picture; and one in the bin.
 */
async function createLibrary() {
  const fake = createFakeStore();
  const picture = await referenceTo(PICTURE, "image/png");
  const pdf = await referenceTo(PDF, "application/pdf");
  const sound = await referenceTo(SOUND, "audio/webm");

  const maths: NotesNotebook = {
    id: "maths",
    title: "Maths",
    cover: "blue",
    createdAt: T0,
    updatedAt: T0 + 5000,
    pages: [
      { id: "m1", ...A4, template: "lined" },
      { id: "m2", ...A4, template: "blank", background: { pdf, pageIndex: 0 } },
      { id: "m3", ...A4, template: "grid" },
    ],
    outline: [{ id: "o1", title: "Start", page: "m1" }],
    recordings: [{ id: "r1", audio: sound, startedAt: T0, duration: 1000 }],
  };
  const m1: NotesPage = {
    id: "m1",
    items: [
      {
        id: "s1",
        type: "stroke",
        tool: "pen",
        color: "#1d4ed8",
        size: 200,
        points: [1000, 1000, 500, 2000, 1500, 700, 3000, 1200, 300],
      },
      {
        id: "t1",
        type: "text",
        x: 100,
        y: 200,
        width: 30_000,
        text: "First line",
        size: 1200,
        color: "#111827",
      },
      { id: "i1", type: "image", x: 0, y: 0, width: 5000, height: 5000, image: picture },
      {
        id: "t2",
        type: "text",
        x: 100,
        y: 4000,
        width: 30_000,
        text: "Se\u00f1al \u65e5\u672c\u8a9e",
        size: 1200,
        color: "#111827",
      },
    ],
  };
  const m2: NotesPage = {
    id: "m2",
    items: [
      { id: "l1", type: "link", x: 0, y: 0, width: 1000, height: 1000, page: "m1" },
      {
        id: "s2",
        type: "stroke",
        tool: "highlighter",
        color: "#facc15",
        size: 2000,
        points: [0, 0, 1000, 500, 500, 1000],
        uniform: true,
        audio: { recording: "r1", at: 250 },
      },
    ],
  };
  const history: NotesNotebook = {
    id: "history",
    title: "History",
    cover: "green",
    createdAt: T0 + 10,
    updatedAt: T0 + 20,
    pages: [{ id: "h1", width: 61_200, height: 79_200, template: "dotted" }],
    outline: [],
    recordings: [],
  };
  const h1: NotesPage = {
    id: "h1",
    items: [
      {
        id: "t1",
        type: "text",
        x: 0,
        y: 0,
        width: 9000,
        text: "Rome",
        size: 1200,
        color: "#000000",
      },
      { id: "i1", type: "image", x: 0, y: 0, width: 5000, height: 5000, image: picture },
    ],
  };
  const binned: NotesNotebook = {
    id: "binned",
    title: "Old",
    cover: "gray",
    createdAt: T0,
    updatedAt: T0,
    pages: [{ id: "b1", ...A4, template: "blank" }],
    outline: [],
    recordings: [],
  };

  for (const notebook of [maths, history, binned]) fake.notebooks.set(notebook.id, notebook);
  // m3 was never written on, so the store has no page for it.
  fake.pages.set("maths/m1", m1);
  fake.pages.set("maths/m2", m2);
  fake.pages.set("history/h1", h1);
  fake.pages.set("binned/b1", { id: "b1", items: [] });
  fake.assets.set(`maths/${picture.asset}`, new Blob([PICTURE]));
  fake.assets.set(`maths/${pdf.asset}`, new Blob([PDF]));
  fake.assets.set(`maths/${sound.asset}`, new Blob([SOUND]));
  fake.assets.set(`history/${picture.asset}`, new Blob([PICTURE]));

  const index: NotesLibraryIndex = {
    folders: [school, science, spare],
    notebooks: [
      summaryOf(maths, "science"),
      summaryOf(history, null),
      summaryOf(binned, "school", T0 + 99),
    ],
    lastBackupAt: null,
    lastChangeAt: T0 + 5000,
  };
  return {
    fake,
    store: fake.store,
    index,
    maths,
    history,
    binned,
    m1,
    m2,
    h1,
    picture,
    pdf,
    sound,
  };
}

type Library = Awaited<ReturnType<typeof createLibrary>>;

const hex = (reference: NotesAssetReference): string => reference.asset.slice("sha256:".length);

function restoreOptions(overrides: NotesFilePolicyOverrides = {}): NotesRestoreOptions {
  let copies = 0;
  return {
    policy: notesLimits.resolve(overrides),
    now: () => NOW,
    newId: () => {
      copies += 1;
      return `copy-${copies}`;
    },
  };
}

/** A backup with some of its entries changed, added or removed. */
async function repacked(
  backup: Blob,
  change: (entries: Map<string, Bytes>) => void,
): Promise<Blob> {
  const archive = await readZip(backup, LIMITS);
  const entries = new Map<string, Bytes>();
  for (const name of archive.entries.keys()) entries.set(name, await archive.read(name));
  change(entries);
  const zip = createZipWriter();
  for (const [name, data] of entries) await zip.add(name, data);
  return zip.finish();
}

/** Changes one JSON document of a backup. */
const editing =
  (name: string, edit: (document: Record<string, unknown>) => unknown) =>
  (entries: Map<string, Bytes>): void => {
    const data = entries.get(name);
    if (!data) throw new Error(`The backup has no ${name}.`);
    const document = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
    entries.set(name, utf8(JSON.stringify(edit(document))));
  };

async function jsonOf(backup: Blob, name: string): Promise<unknown> {
  const archive = await readZip(backup, LIMITS);
  return JSON.parse(new TextDecoder().decode(await archive.read(name)));
}

/** Whether progress only ever went forwards, and ended at the end. */
function expectProgress(reports: readonly NotesProgress[]): void {
  expect(reports.length).toBeGreaterThan(0);
  let last = 0;
  for (const { fraction } of reports) {
    expect(fraction).toBeGreaterThanOrEqual(last);
    expect(fraction).toBeLessThanOrEqual(1);
    last = fraction;
  }
  expect(last).toBe(1);
}

describe("createNotesBackup", () => {
  it("writes the manifest first, then each notebook's document, pages and files", async () => {
    const { store, index, maths, history, m1, m2, h1, picture, pdf, sound } = await createLibrary();
    const backup = await createNotesBackup(store, index, { now: () => NOW });
    const archive = await readZip(backup, LIMITS);

    expect([...archive.entries.keys()]).toEqual([
      "backup.json",
      "notebooks/maths/notebook.json",
      "notebooks/maths/pages/m1.json",
      "notebooks/maths/pages/m2.json",
      "notebooks/maths/pages/m3.json",
      `notebooks/maths/assets/${hex(pdf)}`,
      `notebooks/maths/assets/${hex(sound)}`,
      `notebooks/maths/assets/${hex(picture)}`,
      "notebooks/history/notebook.json",
      "notebooks/history/pages/h1.json",
      `notebooks/history/assets/${hex(picture)}`,
    ]);
    // The whole library is what isn't in the bin, with the folders it's in.
    expect(await jsonOf(backup, "backup.json")).toEqual({
      format: "hm-notes-backup",
      version: 1,
      createdAt: NOW,
      scope: "library",
      folders: [school, science],
      notebooks: [
        { id: "maths", folder: "science" },
        { id: "history", folder: null },
      ],
    });
    expect(await jsonOf(backup, "notebooks/maths/notebook.json")).toEqual(
      toNotesNotebookDocument(maths),
    );
    expect(await jsonOf(backup, "notebooks/history/notebook.json")).toEqual(
      toNotesNotebookDocument(history),
    );
    expect(await jsonOf(backup, "notebooks/maths/pages/m1.json")).toEqual(toNotesPageDocument(m1));
    expect(await jsonOf(backup, "notebooks/maths/pages/m2.json")).toEqual(toNotesPageDocument(m2));
    expect(await jsonOf(backup, "notebooks/history/pages/h1.json")).toEqual(
      toNotesPageDocument(h1),
    );
    expect(await archive.read(`notebooks/maths/assets/${hex(pdf)}`)).toEqual(PDF);
    expect(await archive.read(`notebooks/maths/assets/${hex(sound)}`)).toEqual(SOUND);
    expect(await archive.read(`notebooks/history/assets/${hex(picture)}`)).toEqual(PICTURE);
    // Files are stored as they are.
    expect(archive.entries.get(`notebooks/maths/assets/${hex(pdf)}`)).toMatchObject({
      size: PDF.length,
      compressedSize: PDF.length,
    });
  });

  it("writes a page the store doesn't have as an empty page", async () => {
    const { store, index } = await createLibrary();
    const backup = await createNotesBackup(store, index, { now: () => NOW });
    expect(await jsonOf(backup, "notebooks/maths/pages/m3.json")).toEqual({
      format: "hm-notes-page",
      version: 1,
      id: "m3",
      items: [],
    });
  });

  it("backs up the notebooks named, once each, with only the folders they're in", async () => {
    const { store, index } = await createLibrary();
    const backup = await createNotesBackup(store, index, {
      now: () => NOW,
      notebooks: ["binned", "history", "binned"],
    });
    expect(await jsonOf(backup, "backup.json")).toMatchObject({
      scope: "notebooks",
      folders: [school],
      notebooks: [
        { id: "binned", folder: "school" },
        { id: "history", folder: null },
      ],
    });
    const archive = await readZip(backup, LIMITS);
    expect([...archive.entries.keys()].filter((name) => name.endsWith("notebook.json"))).toEqual([
      "notebooks/binned/notebook.json",
      "notebooks/history/notebook.json",
    ]);

    const empty = await createNotesBackup(store, EMPTY_LIBRARY, { now: () => NOW });
    expect(await jsonOf(empty, "backup.json")).toMatchObject({ folders: [], notebooks: [] });
  });

  it("writes a manifest that can be read even when the index names folders it doesn't list", async () => {
    const { store, index } = await createLibrary();
    const broken: NotesLibraryIndex = {
      ...index,
      folders: [{ ...science, parent: "gone" }],
      notebooks: index.notebooks.map((summary) =>
        summary.id === "history" ? { ...summary, folder: "nowhere" } : summary,
      ),
    };
    const backup = await createNotesBackup(store, broken, { now: () => NOW });
    expect(await jsonOf(backup, "backup.json")).toMatchObject({
      folders: [{ ...science, parent: null }],
      notebooks: [
        { id: "maths", folder: "science" },
        { id: "history", folder: null },
      ],
    });
    const target = createFakeStore();
    const report = await restoreNotesBackup(target.store, EMPTY_LIBRARY, backup, restoreOptions());
    expect(report.restored.map((summary) => summary.id)).toEqual(["maths", "history"]);
  });

  it("fails with NOT_FOUND for a notebook the library doesn't have", async () => {
    const { fake, store, index } = await createLibrary();
    const missing = { code: "NOT_FOUND", details: { kind: "notebook" } };
    await expect(
      createNotesBackup(store, index, { now: () => NOW, notebooks: ["maths", "unknown"] }),
    ).rejects.toMatchObject(missing);
    // Listed, but gone from the store.
    fake.notebooks.delete("history");
    await expect(createNotesBackup(store, index, { now: () => NOW })).rejects.toMatchObject(
      missing,
    );
  });

  it("fails with NOT_FOUND for a file the store doesn't have, never leaving it out", async () => {
    const { fake, store, index, sound } = await createLibrary();
    fake.assets.delete(`maths/${sound.asset}`);
    await expect(createNotesBackup(store, index, { now: () => NOW })).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { kind: "asset" },
    });
  });

  it("refuses a stored file that isn't the one its name and size say", async () => {
    const mismatch = { code: "INVALID_DOCUMENT", details: { reason: "asset-mismatch" } };
    const changed = await createLibrary();
    const damaged = PICTURE.slice();
    damaged[3] = (damaged[3] as number) ^ 1;
    changed.fake.assets.set(`history/${changed.picture.asset}`, new Blob([damaged]));
    await expect(
      createNotesBackup(changed.store, changed.index, { now: () => NOW }),
    ).rejects.toMatchObject(mismatch);

    const cut = await createLibrary();
    cut.fake.assets.set(`maths/${cut.pdf.asset}`, new Blob([PDF.subarray(0, 10)]));
    await expect(createNotesBackup(cut.store, cut.index, { now: () => NOW })).rejects.toMatchObject(
      mismatch,
    );
  });

  it("reports progress for each entry written, up to the end", async () => {
    const { store, index } = await createLibrary();
    const reports: NotesProgress[] = [];
    const backup = await createNotesBackup(store, index, {
      now: () => NOW,
      onProgress: (progress) => reports.push(progress),
    });
    const archive = await readZip(backup, LIMITS);
    expect(reports).toHaveLength(archive.entries.size);
    expectProgress(reports);
  });

  it("rejects with ABORTED when aborted, before or part of the way through", async () => {
    const { store, index } = await createLibrary();
    await expect(
      createNotesBackup(store, index, { now: () => NOW, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "NotesError", code: "ABORTED" });

    const controller = new AbortController();
    const reports: NotesProgress[] = [];
    await expect(
      createNotesBackup(store, index, {
        now: () => NOW,
        signal: controller.signal,
        onProgress: (progress) => {
          reports.push(progress);
          if (reports.length === 4) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "NotesError", code: "ABORTED" });
    expect(reports).toHaveLength(4);
  });
});

describe("restoreNotesBackup", () => {
  async function backedUp(): Promise<Library & { readonly backup: Blob }> {
    const library = await createLibrary();
    const backup = await createNotesBackup(library.store, library.index, { now: () => NOW });
    // Only what restore writes counts from here on.
    library.fake.writes.length = 0;
    return { ...library, backup };
  }

  /** Expects a restore to be refused, having written nothing at all. */
  async function expectRefused(
    backup: Blob,
    expected: Record<string, unknown>,
    overrides: NotesFilePolicyOverrides = {},
  ): Promise<void> {
    const target = createFakeStore();
    await expect(
      restoreNotesBackup(target.store, EMPTY_LIBRARY, backup, restoreOptions(overrides)),
    ).rejects.toMatchObject(expected);
    expect(target.writes).toEqual([]);
    expect(target.notebooks.size + target.pages.size + target.assets.size + target.texts.size).toBe(
      0,
    );
  }

  it("gives back equal notebooks, pages and files in an empty store", async () => {
    const source = await backedUp();
    const target = createFakeStore();
    const report = await restoreNotesBackup(
      target.store,
      EMPTY_LIBRARY,
      source.backup,
      restoreOptions(),
    );

    expect(report).toEqual({
      restored: [summaryOf(source.maths, "science"), summaryOf(source.history, null)],
      unchanged: [],
      folders: [school, science],
    });
    expect(target.notebooks).toEqual(
      new Map([
        ["maths", source.maths],
        ["history", source.history],
      ]),
    );
    expect(target.pages).toEqual(
      new Map<string, NotesPage>([
        ["maths/m1", source.m1],
        ["maths/m2", source.m2],
        ["maths/m3", { id: "m3", items: [] }],
        ["history/h1", source.h1],
      ]),
    );
    expect([...target.assets.keys()].sort()).toEqual(
      [
        `maths/${source.pdf.asset}`,
        `maths/${source.sound.asset}`,
        `maths/${source.picture.asset}`,
        `history/${source.picture.asset}`,
      ].sort(),
    );
    for (const [key, data] of target.assets) {
      expect(await bytesOf(data)).toEqual(await bytesOf(source.fake.assets.get(key) as Blob));
    }
    // The index is the caller's to write.
    expect(target.writes).not.toContain("index");
  });

  it("writes each page's typed text for search", async () => {
    const source = await backedUp();
    const target = createFakeStore();
    await restoreNotesBackup(target.store, EMPTY_LIBRARY, source.backup, restoreOptions());
    expect(target.texts).toEqual(
      new Map<string, NotesPageText>([
        [
          "maths/m1",
          { notebook: "maths", page: "m1", typed: "First line\nSe\u00f1al \u65e5\u672c\u8a9e" },
        ],
        ["maths/m2", { notebook: "maths", page: "m2", typed: "" }],
        ["maths/m3", { notebook: "maths", page: "m3", typed: "" }],
        ["history/h1", { notebook: "history", page: "h1", typed: "Rome" }],
      ]),
    );
  });

  it("writes a notebook's files, then its pages, and its document last", async () => {
    const source = await backedUp();
    const target = createFakeStore();
    await restoreNotesBackup(target.store, EMPTY_LIBRARY, source.backup, restoreOptions());
    expect(target.writes).toEqual([
      `asset maths/${source.pdf.asset}`,
      `asset maths/${source.sound.asset}`,
      `asset maths/${source.picture.asset}`,
      "page maths/m1",
      "text maths/m1",
      "page maths/m2",
      "text maths/m2",
      "page maths/m3",
      "text maths/m3",
      "notebook maths",
      `asset history/${source.picture.asset}`,
      "page history/h1",
      "text history/h1",
      "notebook history",
    ]);
  });

  it("leaves every notebook alone in the library the backup came from", async () => {
    const { fake, store, index, backup } = await backedUp();
    const report = await restoreNotesBackup(store, index, backup, restoreOptions());
    expect(report).toEqual({ restored: [], unchanged: ["maths", "history"], folders: [] });
    expect(fake.writes).toEqual([]);
  });

  it("keeps both when the library's notebook changed since the backup", async () => {
    const { fake, store, index, backup, maths, history, m1, picture } = await backedUp();
    const edited: NotesNotebook = { ...maths, title: "Maths, edited", updatedAt: T0 + 9000 };
    const editedPage: NotesPage = { id: "m1", items: [] };
    fake.notebooks.set("maths", edited);
    fake.pages.set("maths/m1", editedPage);
    // The same time, but a page more.
    const twoPages: NotesNotebook = {
      ...history,
      pages: [...history.pages, { id: "h2", ...A4, template: "blank" }],
    };
    fake.notebooks.set("history", twoPages);

    const report = await restoreNotesBackup(store, index, backup, restoreOptions());

    expect(report).toEqual({
      restored: [
        { ...summaryOf(maths, "science"), id: "copy-1" },
        { ...summaryOf(history, null), id: "copy-2" },
      ],
      unchanged: [],
      folders: [],
    });
    // The library's own are untouched.
    expect(fake.notebooks.get("maths")).toEqual(edited);
    expect(fake.pages.get("maths/m1")).toEqual(editedPage);
    expect(fake.notebooks.get("history")).toEqual(twoPages);
    // The backup's are beside them, with their pages and items as they were.
    expect(fake.notebooks.get("copy-1")).toEqual({ ...maths, id: "copy-1" });
    expect(fake.pages.get("copy-1/m1")).toEqual(m1);
    expect(await bytesOf(fake.assets.get(`copy-1/${picture.asset}`) as Blob)).toEqual(PICTURE);
    expect(fake.texts.get("copy-1/m1")?.notebook).toBe("copy-1");
    expect(fake.notebooks.get("copy-2")).toEqual({ ...history, id: "copy-2" });
    expect(fake.writes.every((write) => /^\w+ copy-[12](\/|$)/.test(write))).toBe(true);

    // The same time and the same pages, in another order, is a change too.
    const again = await backedUp();
    again.fake.notebooks.set("maths", {
      ...again.maths,
      pages: [...again.maths.pages].reverse(),
    });
    const second = await restoreNotesBackup(
      again.store,
      again.index,
      again.backup,
      restoreOptions(),
    );
    expect(second.restored.map((summary) => summary.id)).toEqual(["copy-1"]);
    expect(second.unchanged).toEqual(["history"]);
  });

  it("lists a notebook the store has but the index doesn't, without writing it again", async () => {
    const { fake, store, index, backup, maths } = await backedUp();
    const withoutMaths = {
      ...index,
      notebooks: index.notebooks.filter((summary) => summary.id !== "maths"),
      folders: [school],
    };
    const report = await restoreNotesBackup(store, withoutMaths, backup, restoreOptions());
    expect(report).toEqual({
      restored: [summaryOf(maths, "science")],
      unchanged: ["history"],
      folders: [science],
    });
    expect(fake.writes).toEqual([]);
  });

  it("never restores under an id the index lists, even when the store has lost the notebook", async () => {
    const { fake, store, index, backup, history } = await backedUp();
    fake.notebooks.delete("history");
    const report = await restoreNotesBackup(store, index, backup, restoreOptions());
    expect(report.restored).toEqual([{ ...summaryOf(history, null), id: "copy-1" }]);
    expect(report.unchanged).toEqual(["maths"]);
    expect(fake.notebooks.has("history")).toBe(false);
    expect(fake.notebooks.get("copy-1")).toEqual({ ...history, id: "copy-1" });
  });

  it("restores beside a notebook the store can't read, and fails when the store itself does", async () => {
    const damaged = await backedUp();
    damaged.fake.unreadable.set(
      "maths",
      new NotesError("INVALID_DOCUMENT", "damaged", { details: { reason: "malformed-document" } }),
    );
    const report = await restoreNotesBackup(
      damaged.store,
      damaged.index,
      damaged.backup,
      restoreOptions(),
    );
    expect(report.restored.map((summary) => summary.id)).toEqual(["copy-1"]);
    expect(damaged.fake.notebooks.get("copy-1")).toEqual({ ...damaged.maths, id: "copy-1" });

    const failing = await backedUp();
    failing.fake.unreadable.set(
      "history",
      new NotesError("STORAGE_FAILED", "no storage", { details: { reason: "unavailable" } }),
    );
    await expect(
      restoreNotesBackup(failing.store, failing.index, failing.backup, restoreOptions()),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    expect(failing.fake.writes).toEqual([]);
  });

  it("asks for another id when the new one is taken, and gives up if they all are", async () => {
    const { fake, store, index, backup, maths } = await backedUp();
    fake.notebooks.set("maths", { ...maths, updatedAt: T0 + 9000 });
    const offered = ["history", "maths", "not an id", "free"];
    const report = await restoreNotesBackup(store, index, backup, {
      ...restoreOptions(),
      newId: () => offered.shift() ?? "none-left",
    });
    expect(report.restored.map((summary) => summary.id)).toEqual(["free"]);

    const stuck = await backedUp();
    stuck.fake.notebooks.set("maths", { ...stuck.maths, updatedAt: T0 + 9000 });
    await expect(
      restoreNotesBackup(stuck.store, stuck.index, stuck.backup, {
        ...restoreOptions(),
        newId: () => "history",
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(stuck.fake.writes).toEqual([]);
  });

  it("returns only the folders the library lacks, and keeps the library's own", async () => {
    const source = await backedUp();
    const target = createFakeStore();
    // The library has a folder of the same id under another name, and none of the other.
    const renamed: NotesFolder = { id: "school", name: "Escuela", parent: null, createdAt: 5 };
    const library: NotesLibraryIndex = { ...EMPTY_LIBRARY, folders: [renamed] };
    const report = await restoreNotesBackup(target.store, library, source.backup, restoreOptions());
    expect(report.folders).toEqual([science]);
    expect(report.restored.map((summary) => summary.folder)).toEqual(["science", null]);

    // With the inner folder already there, its parent isn't needed at all.
    const inner = createFakeStore();
    const moved: NotesFolder = { ...science, parent: null };
    const second = await restoreNotesBackup(
      inner.store,
      { ...EMPTY_LIBRARY, folders: [moved] },
      source.backup,
      restoreOptions(),
    );
    expect(second.folders).toEqual([]);
    expect(second.restored.map((summary) => summary.folder)).toEqual(["science", null]);
  });

  it("ignores entries the manifest doesn't lead to", async () => {
    const source = await backedUp();
    const extra = await repacked(source.backup, (entries) => {
      entries.set("__MACOSX/notebooks/._maths", utf8("resource fork"));
      entries.set("notebooks/stray/notebook.json", utf8("{}"));
      entries.set(`notebooks/maths/assets/${"0".repeat(64)}`, utf8("unreferenced"));
    });
    const target = createFakeStore();
    const report = await restoreNotesBackup(target.store, EMPTY_LIBRARY, extra, restoreOptions());
    expect(report.restored.map((summary) => summary.id)).toEqual(["maths", "history"]);
    expect([...target.notebooks.keys()]).toEqual(["maths", "history"]);
    expect(target.assets.size).toBe(4);
  });

  it("reports progress through both passes, up to the end", async () => {
    const source = await backedUp();
    const fresh: NotesProgress[] = [];
    await restoreNotesBackup(createFakeStore().store, EMPTY_LIBRARY, source.backup, {
      ...restoreOptions(),
      onProgress: (progress) => fresh.push(progress),
    });
    expectProgress(fresh);
    // Each entry is checked, and each but the manifest is written.
    expect(fresh).toHaveLength(11 + 10);

    const unchanged: NotesProgress[] = [];
    await restoreNotesBackup(source.store, source.index, source.backup, {
      ...restoreOptions(),
      onProgress: (progress) => unchanged.push(progress),
    });
    expectProgress(unchanged);
  });

  describe("refuses, having written nothing,", () => {
    // Each fault is in the last notebook, so the first has already been found sound.
    const HISTORY = "notebooks/history";

    it("a file that isn't an archive", async () => {
      await expectRefused(new Blob(["not a backup"]), {
        code: "INVALID_DOCUMENT",
        details: { reason: "malformed-archive" },
      });
    });

    it("a backup with a tampered file", async () => {
      const { backup, picture } = await backedUp();
      const mismatch = { code: "INVALID_DOCUMENT", details: { reason: "asset-mismatch" } };
      const tampered = PICTURE.slice();
      tampered[0] = (tampered[0] as number) ^ 0x20;
      await expectRefused(
        await repacked(backup, (entries) =>
          entries.set(`${HISTORY}/assets/${hex(picture)}`, tampered),
        ),
        mismatch,
      );
      // The right start of the file, but not all of it.
      await expectRefused(
        await repacked(backup, (entries) =>
          entries.set(`${HISTORY}/assets/${hex(picture)}`, PICTURE.slice(0, 20)),
        ),
        mismatch,
      );
      // A reference that gives another size for the same file.
      await expectRefused(
        await repacked(
          backup,
          editing(`${HISTORY}/pages/h1.json`, (page) => {
            const items = page["items"] as { image?: { size: number } }[];
            for (const item of items) if (item.image) item.image.size += 1;
            return page;
          }),
        ),
        mismatch,
      );
    });

    it("a backup with an entry missing", async () => {
      const { backup, picture } = await backedUp();
      const missing = { code: "INVALID_DOCUMENT", details: { reason: "missing-entry" } };
      for (const name of [
        `${HISTORY}/pages/h1.json`,
        `${HISTORY}/notebook.json`,
        `${HISTORY}/assets/${hex(picture)}`,
        "backup.json",
      ]) {
        await expectRefused(await repacked(backup, (entries) => entries.delete(name)), missing);
      }
    });

    it("a document with a field the format doesn't have", async () => {
      const { backup } = await backedUp();
      const malformed = { code: "INVALID_DOCUMENT", details: { reason: "malformed-document" } };
      for (const name of [`${HISTORY}/pages/h1.json`, `${HISTORY}/notebook.json`, "backup.json"]) {
        await expectRefused(
          await repacked(
            backup,
            editing(name, (document) => ({ ...document, extra: true })),
          ),
          malformed,
        );
      }
      // Inside an item, too.
      await expectRefused(
        await repacked(
          backup,
          editing(`${HISTORY}/pages/h1.json`, (page) => {
            (page["items"] as Record<string, unknown>[])[0] = {
              ...(page["items"] as Record<string, unknown>[])[0],
              script: "alert(1)",
            };
            return page;
          }),
        ),
        malformed,
      );
    });

    it("a document of a later version, or of another format", async () => {
      const { backup } = await backedUp();
      for (const name of [`${HISTORY}/pages/h1.json`, `${HISTORY}/notebook.json`, "backup.json"]) {
        await expectRefused(
          await repacked(
            backup,
            editing(name, (document) => ({ ...document, version: 2 })),
          ),
          { code: "UNSUPPORTED_FORMAT", details: { reason: "unknown-format-version" } },
        );
        await expectRefused(
          await repacked(
            backup,
            editing(name, (document) => ({ ...document, format: "hm-notes-other" })),
          ),
          { code: "UNSUPPORTED_FORMAT", details: { reason: "unknown-format" } },
        );
      }
    });

    it("a document that isn't JSON, or isn't valid", async () => {
      const { backup } = await backedUp();
      const malformed = { code: "INVALID_DOCUMENT", details: { reason: "malformed-document" } };
      for (const data of [
        utf8("{ not json"),
        new Uint8Array([0xff, 0xfe, 0x00]),
        utf8("[".repeat(200_000)),
      ]) {
        await expectRefused(
          await repacked(backup, (entries) => entries.set(`${HISTORY}/pages/h1.json`, data)),
          malformed,
        );
      }
      await expectRefused(
        await repacked(
          backup,
          editing(`${HISTORY}/pages/h1.json`, (page) => {
            (page["items"] as { color?: string }[])[0] = {
              ...(page["items"] as { color?: string }[])[0],
              color: "red",
            };
            return page;
          }),
        ),
        {
          code: "INVALID_DOCUMENT",
          // Which document, by its place in the backup, and where in it.
          details: { reason: "invalid-color", at: "notebooks[1]/pages[0]:$.items[0].color" },
        },
      );
    });

    it("a notebook or a page filed under another id", async () => {
      const { backup } = await backedUp();
      const malformed = { code: "INVALID_DOCUMENT", details: { reason: "malformed-document" } };
      await expectRefused(
        await repacked(
          backup,
          editing(`${HISTORY}/notebook.json`, (notebook) => ({ ...notebook, id: "maths" })),
        ),
        malformed,
      );
      await expectRefused(
        await repacked(
          backup,
          editing(`${HISTORY}/pages/h1.json`, (page) => ({ ...page, id: "other" })),
        ),
        malformed,
      );
    });

    it("a backup over the file policy's limits", async () => {
      const { backup } = await backedUp();
      await expectRefused(
        backup,
        { code: "TOO_MANY_PAGES", details: { limit: "maxPages", maximum: 2, actual: 3 } },
        { maxPages: 2 },
      );
      await expectRefused(
        backup,
        { code: "TOO_MANY_ITEMS", details: { limit: "maxPageItems", maximum: 3, actual: 4 } },
        { maxPageItems: 3 },
      );
      await expectRefused(
        backup,
        {
          code: "TOO_MANY_BACKUP_ENTRIES",
          details: { limit: "maxBackupEntries", maximum: 10, actual: 11 },
        },
        { maxBackupEntries: 10 },
      );
      await expectRefused(
        backup,
        { code: "BACKUP_TOO_LARGE", details: { limit: "maxBackupSize", maximum: 500 } },
        { maxBackupSize: 500 },
      );
      await expectRefused(
        backup,
        { code: "DECODED_SIZE_TOO_LARGE", details: { limit: "maxDecodedSize", maximum: 100 } },
        { maxDecodedSize: 100 },
      );
    });
  });

  it("rejects with ABORTED and writes nothing when aborted while checking", async () => {
    const { backup } = await backedUp();
    const target = createFakeStore();
    await expect(
      restoreNotesBackup(target.store, EMPTY_LIBRARY, backup, {
        ...restoreOptions(),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "NotesError", code: "ABORTED" });

    const controller = new AbortController();
    let reports = 0;
    await expect(
      restoreNotesBackup(target.store, EMPTY_LIBRARY, backup, {
        ...restoreOptions(),
        signal: controller.signal,
        onProgress: () => {
          reports += 1;
          if (reports === 5) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "NotesError", code: "ABORTED" });
    expect(reports).toBe(5);
    expect(target.writes).toEqual([]);
  });

  it("can be run again after being aborted while writing, and then finishes the job", async () => {
    const source = await backedUp();
    const target = createFakeStore();
    const controller = new AbortController();
    target.afterWrite = (write) => {
      if (write === "notebook maths") controller.abort();
    };
    await expect(
      restoreNotesBackup(target.store, EMPTY_LIBRARY, source.backup, {
        ...restoreOptions(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "NotesError", code: "ABORTED" });
    // One notebook is whole, and nothing of the next was started.
    expect([...target.notebooks.keys()]).toEqual(["maths"]);
    expect(target.writes.at(-1)).toBe("notebook maths");

    target.afterWrite = () => undefined;
    target.writes.length = 0;
    const report = await restoreNotesBackup(
      target.store,
      EMPTY_LIBRARY,
      source.backup,
      restoreOptions(),
    );
    expect(report).toEqual({
      restored: [summaryOf(source.maths, "science"), summaryOf(source.history, null)],
      unchanged: [],
      folders: [school, science],
    });
    expect(target.writes.every((write) => /^\w+ history(\/|$)/.test(write))).toBe(true);
    expect([...target.notebooks.keys()]).toEqual(["maths", "history"]);

    // A page that was half-written is written again, whole.
    const halfway = createFakeStore();
    const stop = new AbortController();
    halfway.afterWrite = (write) => {
      if (write === "page maths/m1") stop.abort();
    };
    await expect(
      restoreNotesBackup(halfway.store, EMPTY_LIBRARY, source.backup, {
        ...restoreOptions(),
        signal: stop.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(halfway.notebooks.size).toBe(0);
    halfway.afterWrite = () => undefined;
    const retried = await restoreNotesBackup(
      halfway.store,
      EMPTY_LIBRARY,
      source.backup,
      restoreOptions(),
    );
    expect(retried.restored.map((summary) => summary.id)).toEqual(["maths", "history"]);
    expect(halfway.pages.get("maths/m2")).toEqual(source.m2);
  });
});

describe("library-v1.zip, a backup written by version 1 of the format", () => {
  const file = new Blob([
    new Uint8Array(readFileSync(new URL("./fixtures/library-v1.zip", import.meta.url))),
  ]);

  it("holds version 1 documents, in the layout of version 1", async () => {
    const archive = await readZip(file, LIMITS);
    expect([...archive.entries.keys()]).toEqual([
      "backup.json",
      "notebooks/notebook-maths/notebook.json",
      "notebooks/notebook-maths/pages/page-1.json",
      "notebooks/notebook-maths/pages/page-2.json",
      `notebooks/notebook-maths/assets/${LIBRARY_V1_PICTURE_NAME.slice("sha256:".length)}`,
      "notebooks/notebook-history/notebook.json",
      "notebooks/notebook-history/pages/page-1.json",
    ]);
    expect(await jsonOf(file, "backup.json")).toEqual({
      format: "hm-notes-backup",
      version: 1,
      createdAt: LIBRARY_V1_TIME,
      scope: "library",
      folders: libraryV1Index.folders,
      notebooks: [
        { id: "notebook-maths", folder: "folder-school" },
        { id: "notebook-history", folder: "folder-school" },
      ],
    });
    expect(await jsonOf(file, "notebooks/notebook-maths/notebook.json")).toMatchObject({
      format: "hm-notes-notebook",
      version: 1,
    });
    expect(await jsonOf(file, "notebooks/notebook-maths/pages/page-1.json")).toMatchObject({
      format: "hm-notes-page",
      version: 1,
    });
  });

  it("still restores, to exactly the library it was made from", async () => {
    const target = createFakeStore();
    const report = await restoreNotesBackup(target.store, EMPTY_LIBRARY, file, restoreOptions());

    expect(report).toEqual({
      restored: libraryV1Index.notebooks,
      unchanged: [],
      folders: libraryV1Index.folders,
    });
    expect([...target.notebooks.values()]).toEqual(libraryV1Notebooks);
    expect(target.pages).toEqual(
      new Map<string, NotesPage>([
        ["notebook-maths/page-1", libraryV1Pages["notebook-maths"]?.[0] as NotesPage],
        ["notebook-maths/page-2", libraryV1Pages["notebook-maths"]?.[1] as NotesPage],
        ["notebook-history/page-1", { id: "page-1", items: [] }],
      ]),
    );
    // Spelt out as well, so a change to the shared values can't hide a change in reading.
    expect(target.pages.get("notebook-maths/page-1")?.items).toEqual([
      {
        id: "stroke-1",
        type: "stroke",
        tool: "pen",
        color: "#1d4ed8",
        size: 200,
        points: [10_000, 12_000, 400, 14_000, 12_500, 700, 18_000, 11_800, 1000, 21_000, 12_200, 0],
      },
      {
        id: "text-1",
        type: "text",
        x: 6000,
        y: 20_000,
        width: 30_000,
        text: "Pythagoras: a\u00b2 + b\u00b2 = c\u00b2\nSecond line",
        size: 1200,
        color: "#111827",
      },
    ]);
    expect([...target.assets.keys()]).toEqual([`notebook-maths/${LIBRARY_V1_PICTURE_NAME}`]);
    const [picture] = [...target.assets.values()];
    expect(await bytesOf(picture as Blob)).toEqual(libraryV1Picture);
    expect(await assetNameOf(libraryV1Picture)).toBe(LIBRARY_V1_PICTURE_NAME);
    expect(target.texts.get("notebook-maths/page-1")?.typed).toBe(
      "Pythagoras: a\u00b2 + b\u00b2 = c\u00b2\nSecond line",
    );
  });
});
