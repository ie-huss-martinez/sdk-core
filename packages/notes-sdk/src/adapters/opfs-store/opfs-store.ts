import { createStore } from "@hussmartinez/sdk-core";
import { invalidDocument } from "../../core/errors/notes-error.js";
import { readNotesLibraryDocument } from "../../core/format/documents.js";
import { isNotesId } from "../../core/model/ids.js";
import type { NotesLibraryIndex } from "../../core/model/library.js";
import type { NotesPersistence, NotesStore } from "../../core/ports/notes-store.js";
import {
  checkedAssetName,
  checkedId,
  checkedPageText,
  checkedPageTextChange,
  indexToText,
  mergedPageText,
  notebookFromText,
  notebookToText,
  pageFromText,
  pageToText,
  storeClosed,
} from "../memory-store/stored-documents.js";
import { createNotesDatabase } from "./index-db.js";
import { lockName, queueOn, tryLock, whileLocked } from "./locks.js";
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
 *   order they were made, and a file has one writer at a time, across tabs.
 * - **The index changes in one step:** `updateIndex` reads it and writes it
 *   in one IndexedDB transaction, so a change another tab made is never
 *   replaced by one made from an older copy. An index that couldn't be read
 *   back is refused before it's stored, and a stored one that can't be read
 *   is never replaced. A page's search text is merged the same way.
 * - **What it reads is untrusted:** every document goes through its strict
 *   reader. A damaged one rejects with `INVALID_DOCUMENT`, and one of a
 *   later version with `UNSUPPORTED_FORMAT`. Neither is ever deleted.
 * - **Failures** reject with `STORAGE_FAILED`: with `details.reason`
 *   `"quota"` when the disk is full, and `"unavailable"` when the browser
 *   gives the page no storage, as some private modes do.
 * - **Across tabs:** `lockNotebook` uses the Web Locks API, and `subscribe`
 *   a `BroadcastChannel`, on which each store announces its `updateIndex`.
 *   In a browser without Web Locks a lock still keeps out the other stores
 *   of the page, but another tab can't be seen. There a first write that
 *   fails leaves its file empty and never removes it, since another tab may
 *   have stored a document under that name meanwhile.
 * - **Closing:** `close()` refuses new calls at once. The calls already made
 *   still finish. A notebook's lock is given back, by its function or by
 *   `close()`, only once the calls made on that notebook have settled, so
 *   its next holder never meets a write that was still queued.
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
  /** The storage calls that haven't settled yet. */
  const working = new Set<Promise<unknown>>();
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
  const run = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const result = (async () => {
      checkStorageFeatures();
      try {
        return await work();
      } catch (error) {
        throw storageFailure(error);
      }
    })();
    // Kept until it settles: `close()` waits for it.
    working.add(result);
    const done = (): void => {
      working.delete(result);
    };
    result.then(done, done);
    return result;
  };

  /**
   * Queues work on a notebook behind the calls already made on it. So two
   * writes of one page end in the order they were made, a read sees the
   * writes made before it, and no file is opened twice at once, which some
   * browsers refuse.
   */
  const inNotebook = <Result>(id: string, work: () => Promise<Result>): Promise<Result> =>
    queueOn(queues, id, work);

  /**
   * Writes a file of a notebook while no other store writes it, in this tab
   * or another. A first write makes the file, fills it, and removes it again
   * if that fails: were two stores to do that at once, the one that failed
   * could remove what the other had just stored. In a browser without Web
   * Locks another tab can't be kept out, so there the file that couldn't be
   * filled is left empty. An empty document reads as missing, and an empty
   * file of another size is one cut short, which `writeAsset` writes again.
   *
   * @param directory - The file's folder.
   * @param path - The folder's path below the notebooks, for the lock's name.
   * @param file - The file's name.
   * @param data - The file's whole contents.
   */
  const writeAlone = (
    directory: FileSystemDirectoryHandle,
    path: readonly string[],
    file: string,
    data: string | Blob,
  ): Promise<void> =>
    whileLocked(lockName(name, "file", [...path, file].join("/")), (acrossTabs) =>
      writeFile(directory, file, data, acrossTabs),
    );

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
    if (typeof BroadcastChannel === "undefined") return undefined;
    if (!channel) {
      channel = new BroadcastChannel(name);
      // A channel never hears its own messages, so these are other stores'.
      channel.onmessage = (event) => {
        // A closed store tells nobody, though its channel stays for its last calls.
        if (!closed && event.data === INDEX_CHANGED) changes.set((count) => count + 1);
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
      // The browser wouldn't make or use the channel.
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
    async updateIndex(change) {
      checkOpen();
      let thrown: { readonly error: unknown } | undefined;
      try {
        return await run(async () => {
          const stored = await database.updateIndex((record) => {
            const index = record === undefined ? undefined : readNotesLibraryDocument(record);
            let next: NotesLibraryIndex;
            try {
              next = change(index);
            } catch (error) {
              thrown = { error };
              throw error;
            }
            // Through JSON text, as a file holds a document: the record is
            // exactly what a reader of the format expects, and shares nothing
            // with the caller.
            const document: unknown = JSON.parse(indexToText(next));
            // Read back before it's stored: an index that can't be read could never be changed again.
            readNotesLibraryDocument(document);
            return document;
          });
          announce();
          return readNotesLibraryDocument(stored);
        });
      } catch (error) {
        // What `change` threw is the caller's own, and not a failure of the storage.
        throw thrown ? thrown.error : error;
      }
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
        inNotebook(id, async () => {
          const path = [toFileName(id)];
          await writeAlone(await makeBelow(...path), path, NOTEBOOK_FILE, text);
        }),
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
          const path = [toFileName(notebookId), PAGES_DIRECTORY];
          const file = `${toFileName(pageId)}${PAGE_SUFFIX}`;
          await writeAlone(await makeBelow(...path), path, file, text);
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
          const path = [toFileName(notebookId), ASSETS_DIRECTORY];
          const directory = await makeBelow(...path);
          // A file is named by the hash of its bytes, so one of the same name
          // and size is the same file. A write that was cut short differs in size.
          const stored = await readFile(directory, file);
          if (stored?.size === data.size) return;
          await writeAlone(directory, path, file, data);
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

    async writePageText(change) {
      checkOpen();
      const text = checkedPageTextChange(change);
      // In the notebook's turn: a page deleted before this was called takes
      // its text with it, and mustn't take this one.
      return run(() =>
        inNotebook(text.notebook, () =>
          database.updatePageText(text.notebook, text.page, (stored) =>
            mergedPageText(stored, text),
          ),
        ),
      );
    },
    async readPageTexts(notebook) {
      checkOpen();
      const notebookId = notebook === undefined ? undefined : checkedId(notebook, "notebook");
      const read = async () => (await database.readPageTexts(notebookId)).map(checkedPageText);
      // One notebook's texts are read in its turn, after the writes made before.
      return run(() => (notebookId === undefined ? read() : inNotebook(notebookId, read)));
    },

    async lockNotebook(id) {
      checkOpen();
      const notebook = checkedId(id, "id");
      const lock = lockName(name, "notebook", notebook);
      try {
        // A lock this store just gave back is free only once the browser has let it go.
        await letting.get(lock);
        const letGo = await tryLock(lock);
        if (!letGo) return undefined;
        const giveBack = (): void => {
          // Only once: a later holder's lock isn't this function's to give back.
          if (held.get(lock) !== giveBack) return;
          held.delete(lock);
          // The calls already made on the notebook still write it. The lock
          // goes when they have settled, so its next holder never has a
          // write of this store's land on top of its own.
          const gone = (queues.get(notebook) ?? Promise.resolve())
            .then(letGo)
            .catch(() => undefined);
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
      // New calls are refused from here on. The calls already made still
      // finish: dropping a queued write would lose what the caller was told
      // is being stored.
      closed = true;
      // Each lock goes once its notebook's calls have settled.
      for (const giveBack of [...held.values()]) giveBack();
      // The channel and the database go once every call has: a queued call
      // may still need the database, and a late change to the index is
      // still announced.
      void Promise.allSettled([...working]).then(() => {
        channel?.close();
        channel = undefined;
        database.close();
      });
    },
  };
}
