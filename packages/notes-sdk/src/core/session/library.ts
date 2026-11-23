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
  /**
   * Renames a notebook that isn't open. Rejects with `NOTEBOOK_IN_USE` while
   * it is: an open notebook is renamed with the `notes.rename` command.
   */
  renameNotebook(id: string, title: string): Promise<void>;
  /** Changes a notebook's cover. Rejects with `NOTEBOOK_IN_USE` while it's open. */
  setNotebookCover(id: string, cover: NotesCover): Promise<void>;
  moveNotebook(id: string, folder: string | null): Promise<void>;
  /** Moves a notebook to the bin, from where it can be restored. */
  binNotebook(id: string): Promise<void>;
  restoreNotebook(id: string): Promise<void>;
  /**
   * Deletes a notebook for good. This can't be undone. Rejects with
   * `NOTEBOOK_IN_USE` while it's open, here or in another tab. If the
   * storage fails part way, the notebook stays in the bin, and the call can
   * be made again.
   */
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
  /**
   * Stops listening to the store, after what's under way has finished and
   * the notebooks still open are closed: each is saved, and given back even
   * if its save fails. Resolves once the store is no longer written to.
   * Every method that changes the library rejects with `NOT_FOUND` from
   * then on.
   */
  close(): Promise<void>;
}

/** How long notebooks may go without a backup before the library says so: two weeks. */
const BACKUP_REMINDER = 14 * 24 * 60 * 60 * 1000;

/** The longest a timer can wait, in milliseconds. */
const MAX_TIMER_DELAY = 0x7fffffff;

const notFound = (kind: "notebook" | "folder") =>
  new NotesError("NOT_FOUND", `The library has no such ${kind}.`, { details: { kind } });

const inUse = () => new NotesError("NOTEBOOK_IN_USE", "The notebook is open.");

/** `folder` if the index still has it, and the top if it's gone. */
const folderIn = (index: NotesLibraryIndex, folder: string | null): string | null =>
  folder !== null && index.folders.some((entry) => entry.id === folder) ? folder : null;

/** The index with a notebook listed once, in the folder asked for if it's still there. */
const withNotebook = (
  index: NotesLibraryIndex,
  summary: NotesNotebookSummary,
): NotesLibraryIndex => ({
  ...index,
  notebooks: [
    ...index.notebooks.filter((notebook) => notebook.id !== summary.id),
    { ...summary, folder: folderIn(index, summary.folder) },
  ],
});

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
 * Creates a library over a store. Nothing is read or listened to until
 * `load()`.
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
  const { store, pdf } = options;
  /** Tells the host. What its analytics throws never fails what was done. */
  const emit = (event: NotesLibraryEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // An analytics failure isn't the library's.
    }
  };
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

  /**
   * When notebooks changed since the last backup will have gone without one
   * for as long as the reminder waits. `undefined` when nothing waits for a
   * backup.
   */
  const backupDueAt = (current: NotesLibraryIndex): number | undefined => {
    const live = current.notebooks.filter((notebook) => notebook.deletedAt === null);
    if (live.length === 0 || current.lastChangeAt === null) return undefined;
    if (current.lastBackupAt === null) {
      return Math.min(...live.map((notebook) => notebook.createdAt)) + BACKUP_REMINDER;
    }
    return current.lastChangeAt > current.lastBackupAt
      ? current.lastBackupAt + BACKUP_REMINDER
      : undefined;
  };
  const backupDue = (current: NotesLibraryIndex): boolean => {
    const at = backupDueAt(current);
    return at !== undefined && now() > at;
  };

  /** The open notebooks, by notebook id. */
  const sessions = new Map<string, NotesSession>();
  let writes: Promise<void> = Promise.resolve();
  let restores: Promise<unknown> = Promise.resolve();
  let loaded: Promise<void> | undefined;
  let reminder: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;

  const index = () => state.getSnapshot().index;

  /** Shows an index, and wakes up when its backup reminder falls due. */
  const show = (next: NotesLibraryIndex, more: Partial<NotesLibrarySnapshot> = {}): void => {
    state.set((current) => ({ ...current, ...more, index: next, backupDue: backupDue(next) }));
    if (reminder !== undefined) clearTimeout(reminder);
    reminder = undefined;
    const at = backupDueAt(next);
    if (closed || at === undefined || now() > at) return;
    // An editor left open across the threshold says so without an edit.
    reminder = setTimeout(() => show(index()), Math.min(at - now() + 1, MAX_TIMER_DELAY));
    // In Node, the wait never keeps a process alive.
    (reminder as { unref?: () => void }).unref?.();
  };

  /**
   * Changes the index where it's stored: from what's stored now, not from
   * this tab's copy, so two tabs' changes both hold. Changes are made in the
   * order they're asked for.
   */
  const update = (change: (index: NotesLibraryIndex) => NotesLibraryIndex): Promise<void> => {
    const write = writes.then(async () => {
      show(await store.updateIndex((stored) => change(stored ?? index())));
    });
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

  /** Removes what a failed creation stored, so nothing unlisted is found later. */
  const discard = (id: string) => store.deleteNotebook(id).catch(() => undefined);

  /** Runs `work` holding the notebook, and refuses while a session has it open. */
  const holding = async <Result>(id: string, work: () => Promise<Result>): Promise<Result> => {
    const release = await store.lockNotebook(id);
    if (!release) throw inUse();
    try {
      return await work();
    } finally {
      release();
    }
  };

  /** Replaces fields of a closed notebook's document, and of its summary. */
  const rewrite = async (id: string, patch: { title: string } | { cover: NotesCover }) => {
    summary(id);
    try {
      await holding(id, async () => {
        const notebook = await store.readNotebook(id);
        if (!notebook) throw notFound("notebook");
        const updatedAt = Math.max(now(), notebook.updatedAt);
        await store.writeNotebook({ ...notebook, ...patch, updatedAt });
        await patchNotebook(id, { ...patch, updatedAt });
      });
    } catch (error) {
      throw fail("library", error);
    }
  };

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
    if (failure.code !== "ABORTED") emit({ type: "failed", operation, code: failure.code });
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

  /** The index as the store's notebooks say it should be: none missing. */
  const reconcile = async (): Promise<NotesLibraryIndex> => {
    const read = await store.readIndex();
    const known = new Set((read?.notebooks ?? []).map((notebook) => notebook.id));
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
    return store.updateIndex((stored) => {
      const base = stored ?? EMPTY_LIBRARY;
      const listed = new Set(base.notebooks.map((notebook) => notebook.id));
      const added = found.filter((notebook) => !listed.has(notebook.id));
      // A rebuilt index says when its notebooks last changed, so the backup
      // reminder still counts from there.
      const lastChangeAt =
        base.lastChangeAt ??
        (added.length > 0 ? Math.max(...added.map((notebook) => notebook.updatedAt)) : null);
      return { ...base, notebooks: [...base.notebooks, ...added], lastChangeAt };
    });
  };

  let unsubscribe: (() => void) | undefined;
  /** Another tab changed the library: show what it stored, after this tab's own changes. */
  const follow = () => {
    writes = writes
      .then(() => store.readIndex())
      .then((read) => {
        if (read && !closed) show(read);
      })
      .catch(() => undefined);
  };

  /** What the library is in the middle of: `close()` waits for it. */
  const running = new Set<Promise<unknown>>();
  /** Makes a method refuse once the library is closed, and be waited for when it closes. */
  const tracked =
    <Args extends unknown[], Result>(method: (...args: Args) => Promise<Result>) =>
    (...args: Args): Promise<Result> => {
      if (closed) return Promise.reject(new NotesError("NOT_FOUND", "The library is closed."));
      const run = method(...args);
      running.add(run);
      const done = () => running.delete(run);
      run.then(done, done);
      return run;
    };

  const library: NotesLibrary = {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,

    load() {
      if (closed) return Promise.reject(new NotesError("NOT_FOUND", "The library is closed."));
      // Listening starts here, not at creation: a library made and never
      // loaded, as React's development mode makes one, holds nothing.
      unsubscribe ??= store.subscribe(follow);
      loaded ??= (async () => {
        try {
          const persistence = await store.persistence().catch(() => undefined);
          // In turn with what other tabs' changes show, so an index read
          // earlier never replaces a newer one.
          const reading = writes.then(async () => {
            show(await reconcile(), { status: "ready", persistence, error: undefined });
          });
          writes = reading.catch(() => undefined);
          await reading;
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
        await update((current) =>
          touched(withNotebook(current, summaryOf(notebook, folder, null))),
        );
      } catch (error) {
        // The caller is told it failed, so nothing of it may turn up later.
        await discard(notebook.id);
        throw fail("library", error);
      }
      emit({ type: "notebook_created", template });
      return notebook.id;
    },

    async importPdf(file, input) {
      const engine = requirePdf();
      const folder = folderOrTop(input.folder);
      const { signal, onProgress } = input;
      let staged: string | undefined;
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
          staged = id;
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
            touched(withNotebook(current, summaryOf(notebook, folder, null))),
          );
          staged = undefined;
          onProgress?.({ fraction: 1 });
          emit({ type: "pdf_imported", pageCount: pages.length });
          return id;
        } finally {
          await document.destroy().catch(() => undefined);
        }
      } catch (error) {
        // The PDF and the search text stored so far go with the import.
        if (staged !== undefined) await discard(staged);
        throw fail("import", error);
      }
    },

    async duplicateNotebook(id, title) {
      const original = summary(id);
      let staged: string | undefined;
      try {
        // What's open is saved first, so the copy holds the latest ink.
        await sessions.get(id)?.flush();
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
        staged = copy.id;
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
          touched(withNotebook(current, summaryOf(copy, original.folder, null))),
        );
        staged = undefined;
        emit({ type: "notebook_created", template: copy.pages[0]?.template ?? "blank" });
        return copy.id;
      } catch (error) {
        if (staged !== undefined) await discard(staged);
        throw fail("library", error);
      }
    },

    renameNotebook(id, title) {
      return rewrite(id, { title: titled(title) });
    },

    setNotebookCover(id, cover) {
      return rewrite(id, { cover });
    },

    async moveNotebook(id, folder) {
      summary(id);
      const target = folderOrTop(folder);
      await update((current) =>
        touched({
          ...current,
          notebooks: current.notebooks.map((notebook) =>
            notebook.id === id ? { ...notebook, folder: folderIn(current, target) } : notebook,
          ),
        }),
      );
    },

    async binNotebook(id) {
      summary(id);
      await patchNotebook(id, { deletedAt: now() });
      emit({ type: "notebook_binned" });
    },

    async restoreNotebook(id) {
      summary(id);
      const restore = () => patchNotebook(id, { deletedAt: null });
      try {
        // Never while it's being deleted for good, here or in another tab:
        // a deletion holds the notebook, so a failed one leaves it in the
        // bin. A session of this library holding it is no deletion.
        if (sessions.has(id)) await restore();
        else await holding(id, restore);
      } catch (error) {
        throw fail("library", error);
      }
      emit({ type: "notebook_restored" });
    },

    async deleteNotebook(id) {
      const listed = summary(id);
      try {
        // Held throughout, so no save of an open notebook writes it back.
        await holding(id, async () => {
          // In the bin until its storage is gone: a notebook half deleted is
          // never listed among the others, and the deletion can be made again.
          if (listed.deletedAt === null) await patchNotebook(id, { deletedAt: now() });
          await store.deleteNotebook(id);
          await update((current) =>
            touched({
              ...current,
              notebooks: current.notebooks.filter((notebook) => notebook.id !== id),
            }),
          );
        });
      } catch (error) {
        throw fail("library", error);
      }
      emit({ type: "notebook_deleted" });
    },

    async createFolder(name, parent) {
      const folder: NotesFolder = {
        id: newId(),
        name: titled(name),
        parent: folderOrTop(parent),
        createdAt: now(),
      };
      await update((current) => ({
        ...current,
        folders: [...current.folders, { ...folder, parent: folderIn(current, folder.parent) }],
      }));
      emit({ type: "folder_created" });
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
      if (!index().folders.some((entry) => entry.id === id)) throw notFound("folder");
      await update((current) => {
        const folder = current.folders.find((entry) => entry.id === id);
        if (!folder) return current;
        return {
          ...current,
          folders: current.folders
            .filter((entry) => entry.id !== id)
            .map((entry) => (entry.parent === id ? { ...entry, parent: folder.parent } : entry)),
          notebooks: current.notebooks.map((notebook) =>
            notebook.folder === id ? { ...notebook, folder: folder.parent } : notebook,
          ),
        };
      });
    },

    async open(id) {
      summary(id);
      const session = await openNotesSession({
        store,
        notebook: id,
        now,
        ...(options.filePolicy ? { filePolicy: options.filePolicy } : {}),
        ...(options.saveDelay === undefined ? {} : { saveDelay: options.saveDelay }),
        onEvent: emit,
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
      if (closed) {
        // The library went away while the notebook opened: nobody is left to close it.
        await session.close({ discard: true });
        throw new NotesError("NOT_FOUND", "The library is closed.");
      }
      sessions.set(id, session);
      const close = session.close.bind(session);
      // The library forgets a session once it's closed, and not before:
      // one whose last save failed is still open.
      const tracked: NotesSession = {
        ...session,
        async close(input) {
          await close(input);
          if (sessions.get(id) === session) sessions.delete(id);
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
        // One reading of the index decides what's saved first, what's
        // archived and what's counted: a notebook that leaves the bin
        // meanwhile is in none of them, never in the archive without its
        // latest ink.
        const taken = index();
        const live = (from: NotesLibraryIndex) =>
          from.notebooks.filter((notebook) => notebook.deletedAt === null);
        // A notebook in the bin is taken only when it's named.
        const archived = new Set(input.notebooks ?? live(taken).map((notebook) => notebook.id));
        // What's open is saved first, so the backup holds the latest ink.
        // Only what the backup takes: a notebook left out can't fail it.
        for (const [id, session] of sessions) {
          if (archived.has(id)) await session.flush();
        }
        // From before the first read: an edit saved while the archive is
        // written isn't in it, and still counts as not backed up.
        const capturedAt = now();
        const blob = await createNotesBackup(store, taken, {
          now,
          // The limits restore will hold it to: a backup that couldn't be read back is refused now.
          policy,
          ...(input.notebooks ? { notebooks: input.notebooks } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        });
        const count = archived.size;
        if (!input.notebooks) {
          // A notebook made, or taken out of the bin, while the archive was
          // written isn't in it. The reminder then keeps counting from the
          // backup before, so that notebook is never taken for backed up.
          await update((current) =>
            live(current).every((notebook) => archived.has(notebook.id))
              ? { ...current, lastBackupAt: capturedAt }
              : current,
          );
        }
        emit({ type: "backup_created", notebooks: count });
        return blob;
      } catch (error) {
        throw fail("backup", error);
      }
    },

    restore(file, input = {}) {
      // One restore at a time: two that planned together could pick the same ids.
      const run = restores.then(async () => {
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
            const restored = new Set(report.restored.map((notebook) => notebook.id));
            await update((current) => {
              const has = new Set(current.folders.map((folder) => folder.id));
              return touched({
                ...current,
                folders: [
                  ...current.folders,
                  ...report.folders.filter((folder) => !has.has(folder.id)),
                ],
                notebooks: [
                  ...current.notebooks
                    .filter((notebook) => !restored.has(notebook.id))
                    .map((notebook) =>
                      unchanged.has(notebook.id) ? { ...notebook, deletedAt: null } : notebook,
                    ),
                  ...report.restored,
                ],
              });
            });
          }
          emit({ type: "backup_restored", notebooks: report.restored.length });
          return report;
        } catch (error) {
          throw fail("restore", error);
        }
      });
      restores = run.catch(() => undefined);
      return run;
    },

    async search(query, input = {}) {
      // Only notebooks the library lists: text left by an import that failed
      // would lead to a notebook that can't be opened. A search of the whole
      // library leaves the bin out.
      const listed = new Set(
        index()
          .notebooks.filter(
            (notebook) => input.notebook !== undefined || notebook.deletedAt === null,
          )
          .map((notebook) => notebook.id),
      );
      const texts = await store.readPageTexts(input.notebook);
      return searchPageTexts(
        texts.filter((entry) => listed.has(entry.notebook)),
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
          // Only the PDF's text: what's typed on the page is the session's to write.
          await store.writePageText({ notebook: id, page: page.id, pdf: text });
        }
      } finally {
        for (const document of open.values()) await document.destroy().catch(() => undefined);
      }
    },

    async exportPdf(id, ports = {}, input = {}) {
      const { signal, onProgress } = input;
      try {
        // Only this notebook's session: another's failed save can't fail the export.
        await sessions.get(id)?.flush();
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
        emit({ type: "pdf_exported", pageCount: notebook.pages.length });
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
      // One closing, whoever asks: every caller is told only once nothing
      // is left to write.
      closing ??= (async () => {
        closed = true;
        unsubscribe?.();
        if (reminder !== undefined) clearTimeout(reminder);
        reminder = undefined;
        // An import, a restore, a load or an open still under way finishes
        // first, and each notebook is saved if it can be and given back
        // either way: the store isn't written to once this resolves.
        while (running.size > 0 || sessions.size > 0) {
          const open = [...sessions.values()];
          sessions.clear();
          await Promise.allSettled(open.map((session) => session.close({ discard: true })));
          await Promise.allSettled([...running]);
        }
        await writes;
      })();
      return closing;
    },
  };

  return {
    ...library,
    load: tracked(library.load),
    createNotebook: tracked(library.createNotebook),
    importPdf: tracked(library.importPdf),
    duplicateNotebook: tracked(library.duplicateNotebook),
    renameNotebook: tracked(library.renameNotebook),
    setNotebookCover: tracked(library.setNotebookCover),
    moveNotebook: tracked(library.moveNotebook),
    binNotebook: tracked(library.binNotebook),
    restoreNotebook: tracked(library.restoreNotebook),
    deleteNotebook: tracked(library.deleteNotebook),
    createFolder: tracked(library.createFolder),
    renameFolder: tracked(library.renameFolder),
    deleteFolder: tracked(library.deleteFolder),
    open: tracked(library.open),
    backup: tracked(library.backup),
    restore: tracked(library.restore),
    indexPdfText: tracked(library.indexPdfText),
    exportPdf: tracked(library.exportPdf),
  };
}
