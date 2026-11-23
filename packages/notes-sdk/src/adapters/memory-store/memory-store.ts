import type { NotesPageText, NotesStore } from "../../core/ports/notes-store.js";
import {
  checkedAssetName,
  checkedId,
  checkedPageText,
  indexFromText,
  indexToText,
  notebookFromText,
  notebookToText,
  pageFromText,
  pageToText,
  storeClosed,
} from "./stored-documents.js";

/** What the store holds of one notebook. */
interface StoredNotebook {
  /** The notebook's document, as JSON text. Absent while only pages or files exist. */
  document?: string;
  /** Each page's document, as JSON text, by the page's id. */
  readonly pages: Map<string, string>;
  /** Each file, by its name. */
  readonly assets: Map<string, Blob>;
  /** Each page's search text, by the page's id. */
  readonly texts: Map<string, NotesPageText>;
}

/**
 * A {@link NotesStore} that keeps everything in memory, for as long as the
 * store lives: for tests, and for a host that wants nothing kept on the
 * device.
 *
 * It behaves as real storage does. Each document is kept as the JSON text
 * of its format and read back through the format's strict reader, so a
 * document that real storage couldn't give back fails here too, and a
 * caller never shares an object with the store. A file comes back without
 * its media type, as it does from a file system. Ids are checked as they
 * are before becoming file names.
 *
 * There is no other tab, so `subscribe` never calls its listener, and a
 * notebook's lock is only held against this store. Nothing is persisted:
 * `persistence()` resolves to `{ persisted: false }`.
 *
 * @example
 * ```ts
 * const library = createNotesLibrary({ store: createMemoryNotesStore() });
 * ```
 *
 * @public
 */
export function createMemoryNotesStore(): NotesStore {
  let index: string | undefined;
  const notebooks = new Map<string, StoredNotebook>();
  const locked = new Set<string>();
  let closed = false;

  const checkOpen = (): void => {
    if (closed) throw storeClosed();
  };

  /** The notebook's entry, made on its first write. */
  const entryOf = (id: string): StoredNotebook => {
    let entry = notebooks.get(id);
    if (!entry) {
      entry = { pages: new Map(), assets: new Map(), texts: new Map() };
      notebooks.set(id, entry);
    }
    return entry;
  };

  // Every method is `async`, so a refused argument rejects and never throws.
  // Each checks all its arguments before it looks anything up: `a?.b(check(x))`
  // would skip the check whenever `a` is missing.
  return {
    async readIndex() {
      checkOpen();
      return index === undefined ? undefined : indexFromText(index);
    },
    async writeIndex(next) {
      checkOpen();
      index = indexToText(next);
    },

    async listNotebooks() {
      checkOpen();
      return [...notebooks].filter(([, entry]) => entry.document !== undefined).map(([id]) => id);
    },
    async readNotebook(id) {
      checkOpen();
      const text = notebooks.get(checkedId(id, "id"))?.document;
      return text === undefined ? undefined : notebookFromText(text);
    },
    async writeNotebook(notebook) {
      checkOpen();
      const id = checkedId(notebook.id, "notebook.id");
      const text = notebookToText(notebook);
      entryOf(id).document = text;
    },
    async deleteNotebook(id) {
      checkOpen();
      notebooks.delete(checkedId(id, "id"));
    },

    async readPage(notebook, page) {
      checkOpen();
      const entry = notebooks.get(checkedId(notebook, "notebook"));
      const id = checkedId(page, "page");
      const text = entry?.pages.get(id);
      return text === undefined ? undefined : pageFromText(text);
    },
    async writePage(notebook, page) {
      checkOpen();
      const notebookId = checkedId(notebook, "notebook");
      const id = checkedId(page.id, "page.id");
      const text = pageToText(page);
      entryOf(notebookId).pages.set(id, text);
    },
    async deletePage(notebook, page) {
      checkOpen();
      const entry = notebooks.get(checkedId(notebook, "notebook"));
      const id = checkedId(page, "page");
      entry?.pages.delete(id);
      entry?.texts.delete(id);
    },

    async listAssets(notebook) {
      checkOpen();
      return [...(notebooks.get(checkedId(notebook, "notebook"))?.assets.keys() ?? [])];
    },
    async readAsset(notebook, asset) {
      checkOpen();
      const entry = notebooks.get(checkedId(notebook, "notebook"));
      const name = checkedAssetName(asset);
      return entry?.assets.get(name);
    },
    async writeAsset(notebook, asset, data) {
      checkOpen();
      const id = checkedId(notebook, "notebook");
      const name = checkedAssetName(asset);
      // A file system keeps bytes, not a media type: neither does this.
      entryOf(id).assets.set(name, data.slice(0, data.size, ""));
    },
    async deleteAsset(notebook, asset) {
      checkOpen();
      const entry = notebooks.get(checkedId(notebook, "notebook"));
      const name = checkedAssetName(asset);
      entry?.assets.delete(name);
    },

    async writePageText(entry) {
      checkOpen();
      const text = checkedPageText(entry);
      entryOf(text.notebook).texts.set(text.page, text);
    },
    async readPageTexts(notebook) {
      checkOpen();
      const entries =
        notebook === undefined
          ? [...notebooks.values()]
          : [notebooks.get(checkedId(notebook, "notebook"))];
      return entries.flatMap((entry) => [...(entry?.texts.values() ?? [])].map(checkedPageText));
    },

    async lockNotebook(id) {
      checkOpen();
      const key = checkedId(id, "id");
      if (locked.has(key)) return undefined;
      locked.add(key);
      let held = true;
      return () => {
        // Only once: a later holder's lock isn't this function's to give back.
        if (held) locked.delete(key);
        held = false;
      };
    },

    async persistence() {
      checkOpen();
      return { persisted: false };
    },
    async requestPersistence() {
      checkOpen();
      return false;
    },

    subscribe: () => () => {},
    close() {
      closed = true;
      index = undefined;
      notebooks.clear();
      locked.clear();
    },
  };
}
