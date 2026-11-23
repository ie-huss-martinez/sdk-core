import type { NotesLibraryIndex } from "../model/library.js";
import type { NotesNotebook, NotesPage } from "../model/notebook.js";

/**
 * Whether the browser will keep the library, and how much room it has.
 *
 * @public
 */
export interface NotesPersistence {
  /**
   * Whether the browser has promised not to clear the storage on its own.
   * `undefined` when it can't say.
   */
  readonly persisted: boolean | undefined;
  /** Bytes used and available, when the browser reports them. */
  readonly usage?: number;
  readonly quota?: number;
}

/**
 * One page's text for search: what's typed on it and, for a page of a PDF,
 * the PDF's own text.
 *
 * @public
 */
export interface NotesPageText {
  readonly notebook: string;
  readonly page: string;
  /** The text of the page's text boxes. */
  readonly typed: string;
  /** The PDF page's own text. Absent until it has been read from the PDF. */
  readonly pdf?: string;
}

/**
 * A change to one page's search text. A field left out keeps what's stored.
 *
 * @public
 */
export interface NotesPageTextChange {
  readonly notebook: string;
  readonly page: string;
  /** The text of the page's text boxes. */
  readonly typed?: string;
  /** The PDF page's own text. */
  readonly pdf?: string;
}

/**
 * Where a library is kept (sdk-core ADR 0008, docs/adr/0003). The SDK's own
 * stores are `createOpfsNotesStore`, on the device, and
 * `createMemoryNotesStore`, for tests. A host can pass its own.
 *
 * A store holds whole documents and never interprets them: it writes what
 * it's given and returns it unchanged, or `undefined` for what it doesn't
 * have. A write resolves only once the data is safely stored, and replaces
 * the earlier document as a whole or not at all. Failures reject with
 * `NotesError`: `STORAGE_FAILED` for the storage itself, and
 * `INVALID_DOCUMENT` or `UNSUPPORTED_FORMAT` for a stored document that
 * can't be read.
 *
 * @public
 */
export interface NotesStore {
  /** The library's index, or `undefined` if none was ever written. */
  readIndex(): Promise<NotesLibraryIndex | undefined>;
  /**
   * Changes the index: gives `change` the index as stored, `undefined` if
   * none was ever written, and stores what it returns. The read and the
   * write are one step, across tabs too, so a change another tab stored is
   * never replaced by one made from an older copy. `change` is synchronous
   * and has no side effects. If it throws, nothing is written and the call
   * rejects with what it threw. An index that couldn't be read back is
   * refused with `INVALID_DOCUMENT`, and a stored index that can't be read
   * is never replaced. Resolves to the index as stored.
   */
  updateIndex(
    change: (index: NotesLibraryIndex | undefined) => NotesLibraryIndex,
  ): Promise<NotesLibraryIndex>;

  /** The ids of every notebook the store holds, to rebuild a lost index. */
  listNotebooks(): Promise<readonly string[]>;
  readNotebook(id: string): Promise<NotesNotebook | undefined>;
  writeNotebook(notebook: NotesNotebook): Promise<void>;
  /** Removes a notebook with its pages, its files and its search text. */
  deleteNotebook(id: string): Promise<void>;

  readPage(notebook: string, page: string): Promise<NotesPage | undefined>;
  writePage(notebook: string, page: NotesPage): Promise<void>;
  deletePage(notebook: string, page: string): Promise<void>;

  /** The names of a notebook's files, each `sha256:` and the file's hash. */
  listAssets(notebook: string): Promise<readonly string[]>;
  readAsset(notebook: string, asset: string): Promise<Blob | undefined>;
  /** Stores a file under its name. Writing a name twice keeps one copy. */
  writeAsset(notebook: string, asset: string, data: Blob): Promise<void>;
  deleteAsset(notebook: string, asset: string): Promise<void>;

  /**
   * Stores one page's search text. A field left out keeps what's stored for
   * it, as one step: the typed text and the PDF's text have different
   * writers, and neither replaces the other's. The typed text of a page
   * with none stored is empty. Deleting the page or its notebook removes it.
   */
  writePageText(change: NotesPageTextChange): Promise<void>;
  /** Every page's search text, of one notebook or of all. */
  readPageTexts(notebook?: string): Promise<readonly NotesPageText[]>;

  /**
   * Takes the notebook for this tab, so two tabs never write the same
   * notebook. Resolves to a function that gives it back, or `undefined`
   * when another tab holds it. It's given back only once the calls already
   * made on the notebook have settled.
   */
  lockNotebook(id: string): Promise<(() => void) | undefined>;

  persistence(): Promise<NotesPersistence>;
  /** Asks the browser to keep the storage. Resolves to whether it will. */
  requestPersistence(): Promise<boolean>;

  /** Calls `listener` when another tab changes the index. Returns how to stop. */
  subscribe(listener: () => void): () => void;
  /** Releases what the store holds. It can't be used afterwards. */
  close(): void;
}
