import { NotesError, unsupportedFormat } from "../../core/errors/notes-error.js";
import type { NotesPageText } from "../../core/ports/notes-store.js";
import { storeClosed } from "../memory-store/stored-documents.js";
import { isNamed, storageFailure } from "./storage-errors.js";

/** The layout's version. A later one is another release's, which this one can't read. */
export const DATABASE_VERSION = 1;
/** The object store of the library's index: one record, under {@link INDEX_KEY}. */
export const LIBRARY_STORE = "library";
/** The key of the library's index in {@link LIBRARY_STORE}. */
export const INDEX_KEY = "index";
/** The object store of the pages' search texts, keyed by `[notebook, page]`. */
export const PAGE_TEXTS_STORE = "page-texts";
/** The index of {@link PAGE_TEXTS_STORE} by notebook. */
export const BY_NOTEBOOK = "notebook";

/**
 * What the store keeps in IndexedDB: the library's index and each page's
 * search text. Records are returned as they were read, unchecked.
 */
export interface NotesDatabase {
  /** The stored index document, or `undefined` if none was written. */
  readIndex(): Promise<unknown>;
  /** Replaces the index document, and resolves once it's on the disk. */
  writeIndex(document: unknown): Promise<void>;
  writePageText(entry: NotesPageText): Promise<void>;
  /** The texts of one notebook, or of all. */
  readPageTexts(notebook?: string): Promise<readonly unknown[]>;
  deletePageText(notebook: string, page: string): Promise<void>;
  /** Removes every text of a notebook, in one transaction. */
  deletePageTexts(notebook: string): Promise<void>;
  /** Closes the connection. Calls made afterwards reject. */
  close(): void;
}

/**
 * Opens the database, making its object stores the first time.
 *
 * @param name - The database's name.
 * @param onLost - Called when the connection closes other than by `close()`.
 */
function openDatabase(name: string, onLost: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let refused = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, DATABASE_VERSION);
    } catch (error) {
      // Some browsers throw here, and don't fail the request, where a page has no storage.
      reject(storageFailure(error, true));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LIBRARY_STORE)) {
        database.createObjectStore(LIBRARY_STORE);
      }
      if (!database.objectStoreNames.contains(PAGE_TEXTS_STORE)) {
        database
          .createObjectStore(PAGE_TEXTS_STORE, { keyPath: ["notebook", "page"] })
          .createIndex(BY_NOTEBOOK, "notebook");
      }
    };
    request.onblocked = () => {
      // A connection elsewhere didn't close when asked. Waiting could take
      // until that tab closes, so the caller is told now.
      refused = true;
      reject(
        new NotesError("STORAGE_FAILED", "Another tab is keeping the library's database busy."),
      );
    };
    request.onerror = () => {
      refused = true;
      // A database of a later version was made by a later release of the SDK.
      reject(
        isNamed(request.error, "VersionError")
          ? unsupportedFormat(
              "unknown-format-version",
              "The library on this device was written by a later version.",
            )
          : storageFailure(request.error, true),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      if (refused) {
        // It opened after the caller was told it wouldn't: nobody will use it.
        database.close();
        return;
      }
      // Another tab wants to upgrade or delete the database, and waits for
      // every connection to close. The next call here opens it again.
      database.onversionchange = () => {
        database.close();
        onLost();
      };
      // The browser closed it, as when the user clears the site's data.
      database.onclose = onLost;
      resolve(database);
    };
  });
}

/**
 * The store's IndexedDB side. Nothing is opened until the first call.
 *
 * Every call is one transaction, and resolves on the transaction's
 * `complete`, not on a request's `success`: only then is the change kept.
 * It rejects on `error` and on `abort`, with what the browser threw.
 *
 * @param name - The database's name.
 */
export function createNotesDatabase(name: string): NotesDatabase {
  let connection: Promise<IDBDatabase> | undefined;
  let closed = false;

  const connect = (): Promise<IDBDatabase> => {
    if (closed) return Promise.reject(storeClosed());
    if (connection) return connection;
    const forget = (): void => {
      if (connection === opening) connection = undefined;
    };
    const opening: Promise<IDBDatabase> = openDatabase(name, forget);
    connection = opening;
    // A failed opening isn't kept: the next call tries again.
    opening.catch(forget);
    return opening;
  };

  /** A transaction on the open connection, opening it again once if it had just closed. */
  const begin = async (
    stores: string,
    mode: IDBTransactionMode,
    options: IDBTransactionOptions,
  ): Promise<IDBTransaction> => {
    for (let attempt = 0; ; attempt += 1) {
      const opening = connect();
      const database = await opening;
      try {
        return database.transaction(stores, mode, options);
      } catch (error) {
        // `InvalidStateError`: the connection closed for another tab's upgrade
        // between being handed out and being used.
        if (closed) throw storeClosed();
        if (attempt > 0 || !isNamed(error, "InvalidStateError")) throw error;
        if (connection === opening) connection = undefined;
      }
    }
  };

  /**
   * Runs one transaction, and resolves to its request's result once the
   * transaction has completed.
   */
  const transact = async <Result>(
    stores: string,
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => IDBRequest<Result> | undefined,
    options: IDBTransactionOptions = {},
  ): Promise<Result | undefined> => {
    const transaction = await begin(stores, mode, options);
    return new Promise<Result | undefined>((resolve, reject) => {
      let request: IDBRequest<Result> | undefined;
      let failure: unknown;
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = (event) => {
        // The request that failed says why. The transaction's own error is set only once it aborts.
        const target = event.target;
        failure = target instanceof IDBRequest ? target.error : transaction.error;
        reject(failure);
      };
      transaction.onabort = () => reject(transaction.error ?? failure);
      try {
        request = work(transaction);
      } catch (error) {
        reject(error);
        // Nothing of a transaction that couldn't be set up is kept.
        try {
          transaction.abort();
        } catch {
          // Already finished.
        }
      }
    });
  };

  return {
    readIndex: () =>
      transact<unknown>(LIBRARY_STORE, "readonly", (transaction) =>
        transaction.objectStore(LIBRARY_STORE).get(INDEX_KEY),
      ),
    async writeIndex(document) {
      await transact(
        LIBRARY_STORE,
        "readwrite",
        (transaction) => transaction.objectStore(LIBRARY_STORE).put(document, INDEX_KEY),
        // The index is the library: `complete` must mean it's on the disk,
        // which some browsers otherwise don't wait for.
        { durability: "strict" },
      );
    },
    async writePageText(entry) {
      await transact(PAGE_TEXTS_STORE, "readwrite", (transaction) =>
        transaction.objectStore(PAGE_TEXTS_STORE).put(entry),
      );
    },
    async readPageTexts(notebook) {
      const texts = await transact<unknown[]>(PAGE_TEXTS_STORE, "readonly", (transaction) => {
        const store = transaction.objectStore(PAGE_TEXTS_STORE);
        return notebook === undefined ? store.getAll() : store.index(BY_NOTEBOOK).getAll(notebook);
      });
      return texts ?? [];
    },
    async deletePageText(notebook, page) {
      await transact(PAGE_TEXTS_STORE, "readwrite", (transaction) =>
        transaction.objectStore(PAGE_TEXTS_STORE).delete([notebook, page]),
      );
    },
    async deletePageTexts(notebook) {
      await transact(PAGE_TEXTS_STORE, "readwrite", (transaction) => {
        const store = transaction.objectStore(PAGE_TEXTS_STORE);
        const cursors = store.index(BY_NOTEBOOK).openKeyCursor(IDBKeyRange.only(notebook));
        cursors.onsuccess = () => {
          const cursor = cursors.result;
          if (!cursor) return;
          store.delete(cursor.primaryKey);
          cursor.continue();
        };
        return undefined;
      });
    },
    close() {
      closed = true;
      const opening = connection;
      connection = undefined;
      // An opening still under way is closed as soon as it ends.
      opening?.then(
        (database) => database.close(),
        () => undefined,
      );
    },
  };
}
