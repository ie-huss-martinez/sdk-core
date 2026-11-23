import { createStore } from "@hussmartinez/sdk-core";
import { invalidDocument } from "../../core/errors/notes-error.js";
import { readNotesLibraryDocument } from "../../core/format/documents.js";
import { isNotesId } from "../../core/model/ids.js";
import type { NotesPersistence, NotesStore } from "../../core/ports/notes-store.js";
import {
  checkedAssetName,
  checkedId,
  checkedPageText,
  indexToText,
  notebookFromText,
  notebookToText,
  pageFromText,
  pageToText,
  storeClosed,
} from "../memory-store/stored-documents.js";
import { createNotesDatabase } from "./index-db.js";
import {
  findDirectory,
  listDirectories,
  listFiles,
  makeDirectory,
  readFile,
  readText,
  removeEntry,
  writeFile,
} from "./opfs-files.js";
import { fromAssetFileName, fromFileName, toAssetFileName, toFileName } from "./opfs-names.js";
import { checkStorageFeatures, storageFailure } from "./storage-errors.js";

/**
 * Options of {@link createOpfsNotesStore}.
 *
 * @public
 */
export interface OpfsNotesStoreOptions {
  /**
   * The name of the storage, for a page that keeps more than one library.
   * Defaults to `"hm-notes"`. Letters, digits, `-` and `_` only.
   */
  readonly name?: string;
}

const DEFAULT_NAME = "hm-notes";
const STORAGE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** The folder of the notebooks, below the storage's own. */
export const NOTEBOOKS_DIRECTORY = "notebooks";
/** A notebook's document, in its folder. */
export const NOTEBOOK_FILE = "notebook.json";
/** The folder of a notebook's pages, each `<page id>.json`. */
export const PAGES_DIRECTORY = "pages";
/** The folder of a notebook's files, each named by its hash. */
export const ASSETS_DIRECTORY = "assets";

const PAGE_SUFFIX = ".json";

/** What a store tells the others on its channel after it wrote the index. */
const INDEX_CHANGED = "index-changed";

/** The browser's storage manager, or `undefined` where there is none, as on a server. */
function storageManager(): Partial<StorageManager> | undefined {
  return (globalThis as { readonly navigator?: { readonly storage?: Partial<StorageManager> } })
    .navigator?.storage;
}

/**
 * Asks for a lock without waiting for it. Resolves to `undefined` when it's
 * held, here or in another tab, and otherwise to a function that gives it
 * back and resolves once the browser has let it go.
 *
 * Where the Web Locks API is missing there is no telling what another tab
 * holds, so the lock is always granted.
 */
function requestLock(name: string): Promise<(() => Promise<void>) | undefined> {
  const locks = (globalThis as { readonly navigator?: { readonly locks?: LockManager } }).navigator
    ?.locks;
  if (!locks) return Promise.resolve(() => Promise.resolve());
  return new Promise((resolve, reject) => {
    let letGo: () => void = () => {};
    const untilLetGo = new Promise<void>((done) => {
      letGo = done;
    });
    // The lock is held for as long as the promise the callback returns is pending.
    const finished: Promise<void> = locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(undefined);
        return undefined;
      }
      resolve(() => {
        letGo();
        return finished;
      });
      return untilLetGo;
    });
    finished.catch(reject);
  });
}

/**
 * A {@link NotesStore} on the device: notebooks in the origin private file
 * system, and the library's index and search text in IndexedDB. Nothing
 * leaves the device.
 *
 * - **Creating it touches nothing,** so it can be created on a server. The
 *   first call looks for `navigator.storage.getDirectory`,
 *   `FileSystemFileHandle.createWritable` and `indexedDB`, and rejects with
 *   `UNSUPPORTED_ENVIRONMENT`, naming the first that is missing.
 * - **Layout:** below a folder named after `name`,
 *   `notebooks/<notebook>/notebook.json`,
 *   `notebooks/<notebook>/pages/<page>.json` and
 *   `notebooks/<notebook>/assets/<hash>`. In a folder's or a page's name an
 *   uppercase letter is written as `~` and its lowercase, so ids that
 *   differ only by case stay apart on a disk that folds case.
 * - **A write is all or nothing:** it goes to a temporary file that replaces
 *   the real one only when it's complete. A failed write leaves the earlier
 *   document as it was. Calls on one notebook run one at a time, in the
 *   order they were made.
 * - **What it reads is untrusted:** every document goes through its strict
 *   reader. A damaged one rejects with `INVALID_DOCUMENT`, and one of a
 *   later version with `UNSUPPORTED_FORMAT`. Neither is ever deleted.
 * - **Failures** reject with `STORAGE_FAILED`: with `details.reason`
 *   `"quota"` when the disk is full, and `"unavailable"` when the browser
 *   gives the page no storage, as some private modes do.
 * - **Across tabs:** `lockNotebook` uses the Web Locks API, and `subscribe`
 *   a `BroadcastChannel`, on which each store announces its `writeIndex`.
 *
 * @example
 * ```ts
 * const store = createOpfsNotesStore();
 * const library = createNotesLibrary({ store });
 * ```
 *
 * @param options - The storage's name.
 * @throws `TypeError` if `name` has anything but letters, digits, `-` and `_`.
 * @public
 */
export function createOpfsNotesStore(options: OpfsNotesStoreOptions = {}): NotesStore {
  const name = options.name ?? DEFAULT_NAME;
  // The name becomes a folder, a database, a channel and a lock: nothing else may be in it.
  if (typeof name !== "string" || !STORAGE_NAME.test(name)) {
    throw new TypeError('A storage name has only letters, digits, "-" and "_", and at most 64.');
  }
  const notebooksPath = [toFileName(name), NOTEBOOKS_DIRECTORY];
  const database = createNotesDatabase(name);
  let closed = false;
  let origin: Promise<FileSystemDirectoryHandle> | undefined;
  let channel: BroadcastChannel | undefined;
  /** The last call queued on each notebook. */
  const queues = new Map<string, Promise<void>>();
  /** The locks this store holds, by lock name, each with how to give it back. */
  const held = new Map<string, () => void>();
  /** The locks this store gave back that the browser hasn't let go of yet. */
  const letting = new Map<string, Promise<void>>();
  /** Counts the index changes heard from other tabs. Only its listeners matter. */
  const changes = createStore(0);

  const checkOpen = (): void => {
    if (closed) throw storeClosed();
  };

  /**
   * Runs a call's storage work, once its arguments were checked: refuses a
   * browser without the features, and makes any failure a `NotesError`.
   */
  const run = async <Result>(work: () => Promise<Result>): Promise<Result> => {
    checkStorageFeatures();
    try {
      return await work();
    } catch (error) {
      throw storageFailure(error);
    }
  };

  /**
   * Queues work on a notebook behind the calls already made on it. So two
   * writes of one page end in the order they were made, a read sees the
   * writes made before it, and no file is opened twice at once, which some
   * browsers refuse.
   */
  const inNotebook = <Result>(id: string, work: () => Promise<Result>): Promise<Result> => {
    const result = (queues.get(id) ?? Promise.resolve()).then(work);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(id, settled);
    void settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return result;
  };

  const originRoot = (): Promise<FileSystemDirectoryHandle> => {
    if (origin) return origin;
    const opening: Promise<FileSystemDirectoryHandle> = navigator.storage
      .getDirectory()
      .catch((error: unknown) => {
        // Not kept: the next call asks again.
        if (origin === opening) origin = undefined;
        throw storageFailure(error, true);
      });
    origin = opening;
    return opening;
  };

  // Folders are looked up on every call and never kept: a handle to a folder
  // that was since removed fails every write made through it.
  const findBelow = async (...path: string[]): Promise<FileSystemDirectoryHandle | undefined> =>
    findDirectory(await originRoot(), [...notebooksPath, ...path]);
  const makeBelow = async (...path: string[]): Promise<FileSystemDirectoryHandle> =>
    makeDirectory(await originRoot(), [...notebooksPath, ...path]);

  const openChannel = (): BroadcastChannel | undefined => {
    if (closed || typeof BroadcastChannel === "undefined") return undefined;
    if (!channel) {
      channel = new BroadcastChannel(name);
      // A channel never hears its own messages, so these are other stores'.
      channel.onmessage = (event) => {
        if (event.data === INDEX_CHANGED) changes.set((count) => count + 1);
      };
      // Node keeps a process alive for an open channel. Browsers have no `unref`.
      (channel as { unref?: () => void }).unref?.();
    }
    return channel;
  };

  /** Tells the other tabs that the index changed. The write stands whether or not they hear. */
  const announce = (): void => {
    try {
      openChannel()?.postMessage(INDEX_CHANGED);
    } catch {
      // The channel closed with the store while the write was ending.
    }
  };

  return {
    async readIndex() {
      checkOpen();
      return run(async () => {
        const document = await database.readIndex();
        return document === undefined ? undefined : readNotesLibraryDocument(document);
      });
    },
    async writeIndex(index) {
      checkOpen();
      // Through JSON text, as a file holds a document: the record is exactly
      // what a reader of the format expects, and shares nothing with the caller.
      const document: unknown = JSON.parse(indexToText(index));
      return run(async () => {
        await database.writeIndex(document);
        announce();
      });
    },

    async listNotebooks() {
      checkOpen();
      return run(async () => {
        const directories = await listDirectories(await findBelow());
        const found = await Promise.all(
          directories.map(async ([entry, directory]) => {
            const id = fromFileName(entry);
            if (id === undefined || !isNotesId(id)) return undefined;
            // A folder without a document is a notebook that was never written, or half removed.
            const document = await readFile(directory, NOTEBOOK_FILE);
            return document && document.size > 0 ? id : undefined;
          }),
        );
        return found.filter((id) => id !== undefined);
      });
    },
    async readNotebook(id) {
      checkOpen();
      const notebook = checkedId(id, "id");
      return run(() =>
        inNotebook(notebook, async () => {
          const text = await readText(await findBelow(toFileName(notebook)), NOTEBOOK_FILE);
          if (text === undefined) return undefined;
          const read = notebookFromText(text);
          // Another notebook's document in this folder: saving it would overwrite that one.
          if (read.id !== notebook) throw invalidDocument("invalid-id", "$.id");
          return read;
        }),
      );
    },
    async writeNotebook(notebook) {
      checkOpen();
      const id = checkedId(notebook.id, "notebook.id");
      // Made into text now, not when its turn comes: what the caller changes meanwhile isn't stored.
      const text = notebookToText(notebook);
      return run(() =>
        inNotebook(id, async () => writeFile(await makeBelow(toFileName(id)), NOTEBOOK_FILE, text)),
      );
    },
    async deleteNotebook(id) {
      checkOpen();
      const notebook = checkedId(id, "id");
      return run(() =>
        inNotebook(notebook, async () => {
          // The files first: if this stops half way, the call can be made again.
          await removeEntry(await findBelow(), toFileName(notebook), true);
          await database.deletePageTexts(notebook);
        }),
      );
    },

    async readPage(notebook, page) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const pageId = checkedId(page, "page");
      return run(() =>
        inNotebook(notebookId, async () => {
          const directory = await findBelow(toFileName(notebookId), PAGES_DIRECTORY);
          const text = await readText(directory, `${toFileName(pageId)}${PAGE_SUFFIX}`);
          if (text === undefined) return undefined;
          const read = pageFromText(text);
          if (read.id !== pageId) throw invalidDocument("invalid-id", "$.id");
          return read;
        }),
      );
    },
    async writePage(notebook, page) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const pageId = checkedId(page.id, "page.id");
      const text = pageToText(page);
      return run(() =>
        inNotebook(notebookId, async () => {
          const directory = await makeBelow(toFileName(notebookId), PAGES_DIRECTORY);
          await writeFile(directory, `${toFileName(pageId)}${PAGE_SUFFIX}`, text);
        }),
      );
    },
    async deletePage(notebook, page) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const pageId = checkedId(page, "page");
      return run(() =>
        inNotebook(notebookId, async () => {
          const directory = await findBelow(toFileName(notebookId), PAGES_DIRECTORY);
          await removeEntry(directory, `${toFileName(pageId)}${PAGE_SUFFIX}`);
          await database.deletePageText(notebookId, pageId);
        }),
      );
    },

    async listAssets(notebook) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      return run(() =>
        inNotebook(notebookId, async () => {
          const files = await listFiles(await findBelow(toFileName(notebookId), ASSETS_DIRECTORY));
          // Anything else in the folder, such as a browser's temporary file, isn't an asset.
          return files.map(fromAssetFileName).filter((asset) => asset !== undefined);
        }),
      );
    },
    async readAsset(notebook, asset) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const file = toAssetFileName(checkedAssetName(asset));
      return run(() =>
        inNotebook(notebookId, async () =>
          readFile(await findBelow(toFileName(notebookId), ASSETS_DIRECTORY), file),
        ),
      );
    },
    async writeAsset(notebook, asset, data) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const file = toAssetFileName(checkedAssetName(asset));
      return run(() =>
        inNotebook(notebookId, async () => {
          const directory = await makeBelow(toFileName(notebookId), ASSETS_DIRECTORY);
          // A file is named by the hash of its bytes, so one of the same name
          // and size is the same file. A write that was cut short differs in size.
          const stored = await readFile(directory, file);
          if (stored?.size === data.size) return;
          await writeFile(directory, file, data);
        }),
      );
    },
    async deleteAsset(notebook, asset) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const file = toAssetFileName(checkedAssetName(asset));
      return run(() =>
        inNotebook(notebookId, async () =>
          removeEntry(await findBelow(toFileName(notebookId), ASSETS_DIRECTORY), file),
        ),
      );
    },

    async writePageText(entry) {
      checkOpen();
      const text = checkedPageText(entry);
      return run(() => database.writePageText(text));
    },
    async readPageTexts(notebook) {
      checkOpen();
      const notebookId = notebook === undefined ? undefined : checkedId(notebook, "notebook");
      return run(async () => (await database.readPageTexts(notebookId)).map(checkedPageText));
    },

    async lockNotebook(id) {
      checkOpen();
      const lock = `${name}:notebook:${checkedId(id, "id")}`;
      try {
        // A lock this store just gave back is free only once the browser has let it go.
        await letting.get(lock);
        const letGo = await requestLock(lock);
        if (!letGo) return undefined;
        const giveBack = (): void => {
          // Only once: a later holder's lock isn't this function's to give back.
          if (held.get(lock) !== giveBack) return;
          held.delete(lock);
          const gone = letGo().catch(() => undefined);
          letting.set(lock, gone);
          void gone.then(() => {
            if (letting.get(lock) === gone) letting.delete(lock);
          });
        };
        held.set(lock, giveBack);
        if (closed) {
          // The store closed while the browser was answering.
          giveBack();
          throw storeClosed();
        }
        return giveBack;
      } catch (error) {
        throw storageFailure(error);
      }
    },

    async persistence() {
      checkOpen();
      const storage = storageManager();
      let persisted: unknown;
      let estimate: StorageEstimate | undefined;
      // Where the browser can't or won't say, the answer is "unknown", not a failure.
      try {
        persisted = await storage?.persisted?.();
      } catch {
        persisted = undefined;
      }
      try {
        estimate = await storage?.estimate?.();
      } catch {
        estimate = undefined;
      }
      const result: { -readonly [Field in keyof NotesPersistence]: NotesPersistence[Field] } = {
        persisted: typeof persisted === "boolean" ? persisted : undefined,
      };
      if (typeof estimate?.usage === "number") result.usage = estimate.usage;
      if (typeof estimate?.quota === "number") result.quota = estimate.quota;
      return result;
    },
    async requestPersistence() {
      checkOpen();
      try {
        return (await storageManager()?.persist?.()) === true;
      } catch {
        return false;
      }
    },

    subscribe(listener) {
      if (closed) return () => {};
      openChannel();
      return changes.subscribe(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const giveBack of [...held.values()]) giveBack();
      channel?.close();
      channel = undefined;
      database.close();
    },
  };
}
