import { checkFile, cleanFileName, createStore } from "@hussmartinez/sdk-core";
import {
  createNotesBackup,
  type NotesRestoreReport,
  restoreNotesBackup,
} from "../backup/backup.js";
import { asNotesError, throwIfAborted } from "../errors/abort.js";
import { NotesError } from "../errors/notes-error.js";
import {
  type NotesFilePolicy,
  type NotesFilePolicyOverrides,
  notesLimits,
} from "../errors/notes-limits.js";
import { NOTES_PDF_TYPE } from "../format/items.js";
import { pointsToUnits } from "../model/geometry.js";
import { assetNameOf, createNotesId, isAssetName } from "../model/ids.js";
import type { NotesAssetReference } from "../model/items.js";
import {
  EMPTY_LIBRARY,
  type NotesFolder,
  type NotesLibraryIndex,
  type NotesNotebookSummary,
} from "../model/library.js";
import {
  NOTES_PAGE_SIZES,
  type NotesCover,
  type NotesNotebook,
  type NotesPage,
  type NotesPageInfo,
  type NotesTemplate,
} from "../model/notebook.js";
import {
  NOTES_MAX_PAGE_SIDE,
  NOTES_MAX_TITLE_LENGTH,
  NOTES_MIN_PAGE_SIDE,
} from "../model/portable.js";
import { type NotesPdfExportPorts, writeNotesPdf } from "../pdf/export.js";
import type { NotesPdfAssemblyPage, NotesPdfEngine } from "../ports/notes-pdf.js";
import type { NotesPersistence, NotesStore } from "../ports/notes-store.js";
import type { NotesCallOptions, NotesProgressOptions } from "../ports/options.js";
import { type NotesSession, type NotesSessionEvent, openNotesSession } from "./notebook-session.js";
import { type NotesSearchHit, searchPageTexts } from "./search.js";

/**
 * The state of a library.
 *
 * @public
 */
export interface NotesLibrarySnapshot {
  /** `loading` until the index has been read, then `ready`, or `error`. */
  readonly status: "loading" | "ready" | "error";
  readonly index: NotesLibraryIndex;
  /** Whether the browser keeps the storage, once it has said. */
  readonly persistence: NotesPersistence | undefined;
  /** Why the library couldn't load, while `status` is `error`. */
  readonly error: NotesError | undefined;
  /**
   * Whether a backup is overdue: notebooks changed since the last backup,
   * and that was more than two weeks ago, or there never was one.
   */
  readonly backupDue: boolean;
}

/**
 * Anonymous events of a library, for a host's analytics: a notebook
 * session's own, and the library's. They never carry a title, a folder's
 * name, text, ink or a file's name.
 *
 * @public
 */
export type NotesLibraryEvent =
  | NotesSessionEvent
  | { readonly type: "notebook_created"; readonly template: NotesTemplate }
  | { readonly type: "pdf_imported"; readonly pageCount: number }
  | { readonly type: "notebook_binned" }
  | { readonly type: "notebook_restored" }
  | { readonly type: "notebook_deleted" }
  | { readonly type: "folder_created" }
  | { readonly type: "backup_created"; readonly notebooks: number }
  | { readonly type: "backup_restored"; readonly notebooks: number }
  | { readonly type: "pdf_exported"; readonly pageCount: number }
  | {
      readonly type: "failed";
      readonly operation: "library" | "import" | "backup" | "restore" | "export";
      readonly code: string;
    };

/**
 * Options for {@link createNotesLibrary}.
 *
 * @public
 */
export interface NotesLibraryOptions {
  readonly store: NotesStore;
  /** The PDF engine, needed to import PDFs and to export pages written over one. */
  readonly pdf?: NotesPdfEngine;
  readonly filePolicy?: NotesFilePolicyOverrides;
  readonly onEvent?: (event: NotesLibraryEvent) => void;
  /** The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Makes identifiers. Defaults to `createNotesId`. */
  readonly newId?: () => string;
  /** Passed to each notebook session: see `NotesSessionOptions.saveDelay`. */
  readonly saveDelay?: number;
}

/**
 * What a new notebook starts with.
 *
 * @public
 */
export interface NotesNewNotebook {
  readonly title: string;
  /** Defaults to `lined`. */
  readonly template?: NotesTemplate;
  /** Defaults to `blue`. */
  readonly cover?: NotesCover;
  /** The folder to create it in. Defaults to the top. */
  readonly folder?: string | null;
  /** The page size, in units. Defaults to A4, upright. */
  readonly size?: { readonly width: number; readonly height: number };
}

/**
 * Options for importing a PDF as a notebook.
 *
 * @public
 */
export interface NotesImportOptions extends NotesProgressOptions {
  /** The title when the file has no usable name of its own. */
  readonly title: string;
  readonly folder?: string | null;
}

/**
 * Options for a backup.
 *
 * @public
 */
export interface NotesLibraryBackupOptions extends NotesProgressOptions {
  /** The notebooks to back up. Every notebook outside the bin, when omitted. */
  readonly notebooks?: readonly string[];
}

/**
 * A library of notebooks kept in a {@link NotesStore} (docs/adr/0003):
 * folders, notebooks, the bin, import, backup and restore, search, and
 * export. It's framework-agnostic: React binds to `subscribe` and
 * `getSnapshot`.
 *
 * Every method that changes the library resolves once the change is stored,
 * and rejects with `NotesError`.
 *
 * @public
 */
export interface NotesLibrary {
  getSnapshot(): NotesLibrarySnapshot;
  subscribe(listener: () => void): () => void;
  /** Reads the index, rebuilding it from the notebooks if it's missing. */
  load(): Promise<void>;

  /** Creates a notebook with one page, and resolves to its id. */
  createNotebook(notebook: NotesNewNotebook): Promise<string>;
  /** Imports a PDF as a notebook with one page per PDF page, and resolves to its id. */
  importPdf(file: Blob, options: NotesImportOptions): Promise<string>;
  /** Copies a notebook, with its pages and files, and resolves to the copy's id. */
  duplicateNotebook(id: string, title: string): Promise<string>;
  renameNotebook(id: string, title: string): Promise<void>;
  setNotebookCover(id: string, cover: NotesCover): Promise<void>;
  moveNotebook(id: string, folder: string | null): Promise<void>;
  /** Moves a notebook to the bin, from where it can be restored. */
  binNotebook(id: string): Promise<void>;
  restoreNotebook(id: string): Promise<void>;
  /** Deletes a notebook for good. This can't be undone. */
  deleteNotebook(id: string): Promise<void>;

  /** Creates a folder, and resolves to its id. */
  createFolder(name: string, parent?: string | null): Promise<string>;
  renameFolder(id: string, name: string): Promise<void>;
  /** Removes a folder. What it held moves to the folder it was in. */
  deleteFolder(id: string): Promise<void>;

  /** Opens a notebook for editing. Its saves keep the library's index up to date. */
  open(id: string): Promise<NotesSession>;
  /** Reads a file of a notebook, without opening it. Rejects with `NOT_FOUND` if it's gone. */
  readAsset(notebook: string, asset: NotesAssetReference | string): Promise<Blob>;

  /** Writes a backup: a zip of the notebooks' documents and files. */
  backup(options?: NotesLibraryBackupOptions): Promise<Blob>;
  /**
   * Restores a backup. It never overwrites: a notebook the library already
   * has, changed since, is kept beside the backup's copy. A notebook the
   * backup holds that's in the bin, unchanged, comes out of the bin.
   */
  restore(file: Blob, options?: NotesProgressOptions): Promise<NotesRestoreReport>;

  /** Finds text in typed text and in PDFs' text, in one notebook or in all outside the bin. */
  search(query: string, options?: { readonly notebook?: string }): Promise<NotesSearchHit[]>;
  /** Reads the text of a notebook's PDF pages that haven't been read yet, for search. */
  indexPdfText(notebook: string, options?: NotesCallOptions): Promise<void>;

  /** Writes a notebook as a PDF, with the ink as vector paths. */
  exportPdf(
    notebook: string,
    ports?: NotesPdfExportPorts,
    options?: NotesProgressOptions,
  ): Promise<Uint8Array>;

  /** Asks the browser to keep the storage, and resolves to whether it will. */
  requestPersistence(): Promise<boolean>;
  /** Stops listening to the store. Open sessions are closed by their owners. */
  close(): void;
}

/** How long notebooks may go without a backup before the library says so: two weeks. */
const BACKUP_REMINDER = 14 * 24 * 60 * 60 * 1000;

const notFound = (kind: "notebook" | "folder") =>
  new NotesError("NOT_FOUND", `The library has no such ${kind}.`, { details: { kind } });

/** A title or a name within the model's length, or a refusal. */
function titled(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || [...trimmed].length > NOTES_MAX_TITLE_LENGTH) {
    throw new NotesError("INVALID_COMMAND", "A title has 1 to 200 characters.", {
      details: { reason: "text-too-long" },
    });
  }
  return trimmed;
}

/** A file's own name as a title: cleaned, without its extension, and cut to length. */
function titleFromFile(file: Blob, fallback: string): string {
  const name = "name" in file ? cleanFileName((file as File).name) : undefined;
  const base = name?.replace(/\.[^.]{1,8}$/, "").trim();
  if (!base) return fallback;
  return [...base].slice(0, NOTES_MAX_TITLE_LENGTH).join("");
}

const summaryOf = (
  notebook: NotesNotebook,
  folder: string | null,
  deletedAt: number | null,
): NotesNotebookSummary => ({
  id: notebook.id,
  title: notebook.title,
  cover: notebook.cover,
  template: notebook.pages[0]?.template ?? "blank",
  folder,
  pageCount: notebook.pages.length,
  createdAt: notebook.createdAt,
  updatedAt: notebook.updatedAt,
  deletedAt,
});

const clampSide = (units: number) =>
  Math.min(NOTES_MAX_PAGE_SIDE, Math.max(NOTES_MIN_PAGE_SIDE, units));

/**
 * Creates a library over a store. Nothing is read until `load()`.
 *
 * @example
 * ```ts
 * const library = createNotesLibrary({ store: createOpfsNotesStore(), pdf: createNotesPdfEngine() });
 * await library.load();
 * const id = await library.createNotebook({ title: "Physics", template: "grid" });
 * const session = await library.open(id);
 * ```
 *
 * @public
 */
export function createNotesLibrary(options: NotesLibraryOptions): NotesLibrary {
  const { store, pdf, onEvent } = options;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? createNotesId;
  const policy: NotesFilePolicy = notesLimits.resolve(options.filePolicy);

  const state = createStore<NotesLibrarySnapshot>({
    status: "loading",
    index: EMPTY_LIBRARY,
    persistence: undefined,
    error: undefined,
    backupDue: false,
  });

  /** Whether notebooks have gone without a backup for longer than the reminder waits. */
  const backupDue = (current: NotesLibraryIndex): boolean => {
    const live = current.notebooks.filter((notebook) => notebook.deletedAt === null);
    if (live.length === 0 || current.lastChangeAt === null) return false;
    if (current.lastBackupAt === null) {
      const oldest = Math.min(...live.map((notebook) => notebook.createdAt));
      return now() - oldest > BACKUP_REMINDER;
    }
    return (
      current.lastChangeAt > current.lastBackupAt && now() - current.lastBackupAt > BACKUP_REMINDER
    );
  };
  const sessions = new Set<NotesSession>();
  let writes: Promise<void> = Promise.resolve();
  let loaded: Promise<void> | undefined;

  const index = () => state.getSnapshot().index;

  /** Changes the index and stores it. Changes are written in the order they're made. */
  const update = (change: (index: NotesLibraryIndex) => NotesLibraryIndex): Promise<void> => {
    const next = change(index());
    state.set((current) => ({ ...current, index: next, backupDue: backupDue(next) }));
    const write = writes.then(() => store.writeIndex(next));
    writes = write.catch(() => undefined);
    return write.catch((error: unknown) => {
      throw asNotesError(error);
    });
  };

  const touched = (current: NotesLibraryIndex): NotesLibraryIndex => ({
    ...current,
    lastChangeAt: now(),
  });

  const summary = (id: string): NotesNotebookSummary => {
    const found = index().notebooks.find((notebook) => notebook.id === id);
    if (!found) throw notFound("notebook");
    return found;
  };

  const patchNotebook = (id: string, patch: Partial<NotesNotebookSummary>) =>
    update((current) =>
      touched({
        ...current,
        notebooks: current.notebooks.map((notebook) =>
          notebook.id === id ? { ...notebook, ...patch } : notebook,
        ),
      }),
    );

  const folderOrTop = (folder: string | null | undefined): string | null => {
    if (folder === null || folder === undefined) return null;
    if (!index().folders.some((entry) => entry.id === folder)) throw notFound("folder");
    return folder;
  };

  const fail = (
    operation: "library" | "import" | "backup" | "restore" | "export",
    error: unknown,
  ) => {
    const failure = asNotesError(error);
    if (failure.code !== "ABORTED") onEvent?.({ type: "failed", operation, code: failure.code });
    return failure;
  };

  const requirePdf = (): NotesPdfEngine => {
    if (!pdf) {
      throw new NotesError(
        "UNSUPPORTED_ENVIRONMENT",
        "The library was created without a PDF engine.",
        {
          details: { feature: "pdf" },
        },
      );
    }
    return pdf;
  };

  /** The index as the store's notebooks say it should be: none missing, each up to date. */
  const reconcile = async (read: NotesLibraryIndex | undefined): Promise<NotesLibraryIndex> => {
    const known = new Map((read?.notebooks ?? []).map((notebook) => [notebook.id, notebook]));
    const missing = (await store.listNotebooks()).filter((id) => !known.has(id));
    if (read && missing.length === 0) return read;
    const found: NotesNotebookSummary[] = [];
    for (const id of missing) {
      try {
        const notebook = await store.readNotebook(id);
        if (notebook) found.push(summaryOf(notebook, null, null));
      } catch {
        // A notebook that can't be read stays where it is, out of the index:
        // deleting it here could destroy what a later version can read.
      }
    }
    const base = read ?? EMPTY_LIBRARY;
    const next = { ...base, notebooks: [...base.notebooks, ...found] };
    if (found.length > 0 || !read) await store.writeIndex(next);
    return next;
  };

  const unsubscribe = store.subscribe(() => {
    // Another tab changed the library: show what it stored.
    void store
      .readIndex()
      .then((read) => {
        if (read) state.set((current) => ({ ...current, index: read, backupDue: backupDue(read) }));
      })
      .catch(() => undefined);
  });

  const library: NotesLibrary = {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,

    load() {
      loaded ??= (async () => {
        try {
          const next = await reconcile(await store.readIndex());
          const persistence = await store.persistence().catch(() => undefined);
          state.set({
            status: "ready",
            index: next,
            persistence,
            error: undefined,
            backupDue: backupDue(next),
          });
        } catch (error) {
          loaded = undefined;
          const failure = fail("library", error);
          state.set((current) => ({ ...current, status: "error", error: failure }));
          throw failure;
        }
      })();
      return loaded;
    },

    async createNotebook(input) {
      const title = titled(input.title);
      const folder = folderOrTop(input.folder);
      const size = input.size ?? NOTES_PAGE_SIZES.a4;
      const time = now();
      const template = input.template ?? "lined";
      const notebook: NotesNotebook = {
        id: newId(),
        title,
        cover: input.cover ?? "blue",
        createdAt: time,
        updatedAt: time,
        pages: [
          { id: newId(), width: clampSide(size.width), height: clampSide(size.height), template },
        ],
        outline: [],
        recordings: [],
      };
      try {
        await store.writeNotebook(notebook);
      } catch (error) {
        throw fail("library", error);
      }
      await update((current) =>
        touched({
          ...current,
          notebooks: [...current.notebooks, summaryOf(notebook, folder, null)],
        }),
      );
      onEvent?.({ type: "notebook_created", template });
      return notebook.id;
    },

    async importPdf(file, input) {
      const engine = requirePdf();
      const folder = folderOrTop(input.folder);
      const { signal, onProgress } = input;
      try {
        throwIfAborted(signal);
        checkFile(policy, file);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const document = await engine.open(bytes, signal ? { signal } : {});
        try {
          policy.check("maxPages", document.pageCount);
          const reference = {
            asset: await assetNameOf(bytes),
            mediaType: NOTES_PDF_TYPE,
            size: bytes.byteLength,
          };
          const id = newId();
          const pages: NotesPageInfo[] = [];
          const texts: string[] = [];
          for (let pageIndex = 0; pageIndex < document.pageCount; pageIndex += 1) {
            throwIfAborted(signal);
            const size = await document.pageSize(pageIndex, signal ? { signal } : {});
            pages.push({
              id: newId(),
              width: clampSide(pointsToUnits(size.width)),
              height: clampSide(pointsToUnits(size.height)),
              template: "blank",
              background: { pdf: reference, pageIndex },
            });
            texts.push(await document.pageText(pageIndex, signal ? { signal } : {}));
            onProgress?.({ fraction: (pageIndex + 1) / (document.pageCount + 1) });
          }
          const time = now();
          const notebook: NotesNotebook = {
            id,
            title: titled(titleFromFile(file, input.title)),
            cover: "gray",
            createdAt: time,
            updatedAt: time,
            pages,
            outline: [],
            recordings: [],
          };
          throwIfAborted(signal);
          await store.writeAsset(id, reference.asset, new Blob([bytes], { type: NOTES_PDF_TYPE }));
          for (const [pageIndex, page] of pages.entries()) {
            await store.writePageText({
              notebook: id,
              page: page.id,
              typed: "",
              pdf: texts[pageIndex] ?? "",
            });
          }
          await store.writeNotebook(notebook);
          await update((current) =>
            touched({
              ...current,
              notebooks: [...current.notebooks, summaryOf(notebook, folder, null)],
            }),
          );
          onProgress?.({ fraction: 1 });
          onEvent?.({ type: "pdf_imported", pageCount: pages.length });
          return id;
        } finally {
          await document.destroy().catch(() => undefined);
        }
      } catch (error) {
        throw fail("import", error);
      }
    },

    async duplicateNotebook(id, title) {
      const original = summary(id);
      try {
        const notebook = await store.readNotebook(id);
        if (!notebook) throw notFound("notebook");
        const time = now();
        const copy: NotesNotebook = {
          ...notebook,
          id: newId(),
          title: titled(title),
          createdAt: time,
          updatedAt: time,
        };
        for (const asset of await store.listAssets(id)) {
          const data = await store.readAsset(id, asset);
          if (data) await store.writeAsset(copy.id, asset, data);
        }
        for (const info of notebook.pages) {
          const page = await store.readPage(id, info.id);
          if (page) await store.writePage(copy.id, page);
        }
        for (const text of await store.readPageTexts(id)) {
          await store.writePageText({ ...text, notebook: copy.id });
        }
        await store.writeNotebook(copy);
        await update((current) =>
          touched({
            ...current,
            notebooks: [...current.notebooks, summaryOf(copy, original.folder, null)],
          }),
        );
        onEvent?.({ type: "notebook_created", template: copy.pages[0]?.template ?? "blank" });
        return copy.id;
      } catch (error) {
        throw fail("library", error);
      }
    },

    async renameNotebook(id, title) {
      summary(id);
      const next = titled(title);
      try {
        const notebook = await store.readNotebook(id);
        if (!notebook) throw notFound("notebook");
        const updatedAt = Math.max(now(), notebook.updatedAt);
        await store.writeNotebook({ ...notebook, title: next, updatedAt });
        await patchNotebook(id, { title: next, updatedAt });
      } catch (error) {
        throw fail("library", error);
      }
    },

    async setNotebookCover(id, cover) {
      summary(id);
      try {
        const notebook = await store.readNotebook(id);
        if (!notebook) throw notFound("notebook");
        const updatedAt = Math.max(now(), notebook.updatedAt);
        await store.writeNotebook({ ...notebook, cover, updatedAt });
        await patchNotebook(id, { cover, updatedAt });
      } catch (error) {
        throw fail("library", error);
      }
    },

    async moveNotebook(id, folder) {
      summary(id);
      await patchNotebook(id, { folder: folderOrTop(folder) });
    },

    async binNotebook(id) {
      summary(id);
      await patchNotebook(id, { deletedAt: now() });
      onEvent?.({ type: "notebook_binned" });
    },

    async restoreNotebook(id) {
      summary(id);
      await patchNotebook(id, { deletedAt: null });
      onEvent?.({ type: "notebook_restored" });
    },

    async deleteNotebook(id) {
      summary(id);
      // Out of the index first: a notebook half deleted is never listed.
      await update((current) =>
        touched({
          ...current,
          notebooks: current.notebooks.filter((notebook) => notebook.id !== id),
        }),
      );
      try {
        await store.deleteNotebook(id);
      } catch (error) {
        throw fail("library", error);
      }
      onEvent?.({ type: "notebook_deleted" });
    },

    async createFolder(name, parent) {
      const folder: NotesFolder = {
        id: newId(),
        name: titled(name),
        parent: folderOrTop(parent),
        createdAt: now(),
      };
      await update((current) => ({ ...current, folders: [...current.folders, folder] }));
      onEvent?.({ type: "folder_created" });
      return folder.id;
    },

    async renameFolder(id, name) {
      folderOrTop(id);
      const next = titled(name);
      await update((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === id ? { ...folder, name: next } : folder,
        ),
      }));
    },

    async deleteFolder(id) {
      const folder = index().folders.find((entry) => entry.id === id);
      if (!folder) throw notFound("folder");
      await update((current) => ({
        ...current,
        folders: current.folders
          .filter((entry) => entry.id !== id)
          .map((entry) => (entry.parent === id ? { ...entry, parent: folder.parent } : entry)),
        notebooks: current.notebooks.map((notebook) =>
          notebook.folder === id ? { ...notebook, folder: folder.parent } : notebook,
        ),
      }));
    },

    async open(id) {
      summary(id);
      const session = await openNotesSession({
        store,
        notebook: id,
        now,
        ...(options.filePolicy ? { filePolicy: options.filePolicy } : {}),
        ...(options.saveDelay === undefined ? {} : { saveDelay: options.saveDelay }),
        ...(onEvent ? { onEvent } : {}),
        onSaved: (notebook) =>
          update((current) =>
            touched({
              ...current,
              notebooks: current.notebooks.map((entry) =>
                entry.id === id ? summaryOf(notebook, entry.folder, entry.deletedAt) : entry,
              ),
            }),
          ),
      });
      sessions.add(session);
      const close = session.close.bind(session);
      // The library forgets a session once it's closed.
      const tracked: NotesSession = {
        ...session,
        async close() {
          try {
            await close();
          } finally {
            sessions.delete(session);
          }
        },
      };
      return tracked;
    },

    async readAsset(notebook, asset) {
      const name = typeof asset === "string" ? asset : asset.asset;
      const data = isAssetName(name) ? await store.readAsset(notebook, name) : undefined;
      if (!data) {
        throw new NotesError("NOT_FOUND", "The notebook has no such file.", {
          details: { kind: "asset" },
        });
      }
      return data;
    },

    async backup(input = {}) {
      try {
        // What's open is saved first, so the backup holds the latest ink.
        for (const session of sessions) await session.flush();
        const blob = await createNotesBackup(store, index(), {
          now,
          ...(input.notebooks ? { notebooks: input.notebooks } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        });
        const count =
          input.notebooks?.length ??
          index().notebooks.filter((notebook) => notebook.deletedAt === null).length;
        if (!input.notebooks) await update((current) => ({ ...current, lastBackupAt: now() }));
        onEvent?.({ type: "backup_created", notebooks: count });
        return blob;
      } catch (error) {
        throw fail("backup", error);
      }
    },

    async restore(file, input = {}) {
      try {
        const report = await restoreNotesBackup(store, index(), file, {
          policy,
          now,
          newId,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        });
        // Asking for a notebook back takes it out of the bin, even when nothing in it changed.
        const unchanged = new Set(report.unchanged);
        const binned = index().notebooks.some(
          (notebook) => unchanged.has(notebook.id) && notebook.deletedAt !== null,
        );
        if (report.restored.length > 0 || report.folders.length > 0 || binned) {
          await update((current) =>
            touched({
              ...current,
              folders: [...current.folders, ...report.folders],
              notebooks: [
                ...current.notebooks.map((notebook) =>
                  unchanged.has(notebook.id) ? { ...notebook, deletedAt: null } : notebook,
                ),
                ...report.restored,
              ],
            }),
          );
        }
        onEvent?.({ type: "backup_restored", notebooks: report.restored.length });
        return report;
      } catch (error) {
        throw fail("restore", error);
      }
    },

    async search(query, input = {}) {
      const binned = new Set(
        index()
          .notebooks.filter((notebook) => notebook.deletedAt !== null)
          .map((notebook) => notebook.id),
      );
      const texts = await store.readPageTexts(input.notebook);
      return searchPageTexts(
        texts.filter((entry) => !binned.has(entry.notebook)),
        query,
      );
    },

    async indexPdfText(id, input = {}) {
      if (!pdf) return;
      const notebook = await store.readNotebook(id);
      if (!notebook) return;
      const texts = new Map((await store.readPageTexts(id)).map((entry) => [entry.page, entry]));
      const pending = notebook.pages.filter(
        (page) => page.background && texts.get(page.id)?.pdf === undefined,
      );
      const open = new Map<string, Awaited<ReturnType<NotesPdfEngine["open"]>>>();
      try {
        for (const page of pending) {
          throwIfAborted(input.signal);
          const background = page.background;
          if (!background) continue;
          let document = open.get(background.pdf.asset);
          if (!document) {
            const data = await store.readAsset(id, background.pdf.asset);
            if (!data) continue;
            document = await pdf.open(new Uint8Array(await data.arrayBuffer()), input);
            open.set(background.pdf.asset, document);
          }
          const text =
            background.pageIndex < document.pageCount
              ? await document.pageText(background.pageIndex, input)
              : "";
          await store.writePageText({
            notebook: id,
            page: page.id,
            typed: texts.get(page.id)?.typed ?? "",
            pdf: text,
          });
        }
      } finally {
        for (const document of open.values()) await document.destroy().catch(() => undefined);
      }
    },

    async exportPdf(id, ports = {}, input = {}) {
      const { signal, onProgress } = input;
      try {
        for (const session of sessions) await session.flush();
        const notebook = await store.readNotebook(id);
        if (!notebook) throw notFound("notebook");
        const pages: NotesPage[] = [];
        for (const info of notebook.pages) {
          throwIfAborted(signal);
          pages.push((await store.readPage(id, info.id)) ?? { id: info.id, items: [] });
        }
        const overPdf = notebook.pages.some((page) => page.background);
        // Writing the ink is the first half of the work when a PDF is assembled after it.
        const share = overPdf ? 0.5 : 1;
        const ink = await writeNotesPdf(
          notebook.pages.map((info, pageIndex) => ({
            info,
            items: pages[pageIndex]?.items ?? [],
            paper: !info.background,
          })),
          ports,
          {
            title: notebook.title,
            ...(signal ? { signal } : {}),
            ...(onProgress
              ? { onProgress: ({ fraction }) => onProgress({ fraction: fraction * share }) }
              : {}),
          },
        );
        let result = ink;
        if (overPdf) {
          const engine = requirePdf();
          const sources = new Map<string, Uint8Array>([["ink", ink]]);
          const assembly: NotesPdfAssemblyPage[] = [];
          for (const [pageIndex, info] of notebook.pages.entries()) {
            if (!info.background) {
              assembly.push({ source: "ink", pageIndex });
              continue;
            }
            const asset = info.background.pdf.asset;
            // "sha256:…" isn't a safe source name everywhere, so only its digits are used.
            const source = `pdf-${asset.slice(7)}`;
            if (!sources.has(source)) {
              const data = await store.readAsset(id, asset);
              if (!data) {
                throw new NotesError("NOT_FOUND", "The notebook's PDF is missing.", {
                  details: { kind: "asset" },
                });
              }
              sources.set(source, new Uint8Array(await data.arrayBuffer()));
            }
            assembly.push({
              source,
              pageIndex: info.background.pageIndex,
              overlay: { source: "ink", pageIndex },
            });
          }
          result = await engine.assemble(
            {
              sources: [...sources].map(([source, bytes]) => ({ id: source, bytes })),
              pages: assembly,
            },
            {
              ...(signal ? { signal } : {}),
              ...(onProgress
                ? {
                    onProgress: ({ fraction }) =>
                      onProgress({ fraction: share + fraction * share }),
                  }
                : {}),
            },
          );
        }
        onEvent?.({ type: "pdf_exported", pageCount: notebook.pages.length });
        return result;
      } catch (error) {
        throw fail("export", error);
      }
    },

    async requestPersistence() {
      const granted = await store.requestPersistence().catch(() => false);
      const persistence = await store.persistence().catch(() => undefined);
      state.set((current) => ({ ...current, persistence }));
      return granted;
    },

    close() {
      unsubscribe();
    },
  };

  return library;
}
