import { invalidDocument, NotesError } from "../../core/errors/notes-error.js";
import {
  readNotesLibraryDocument,
  readNotesNotebookDocument,
  readNotesPageDocument,
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../../core/format/documents.js";
import { isAssetName, isNotesId } from "../../core/model/ids.js";
import type { NotesLibraryIndex } from "../../core/model/library.js";
import type { NotesNotebook, NotesPage } from "../../core/model/notebook.js";
import type { NotesPageText, NotesPageTextChange } from "../../core/ports/notes-store.js";

/**
 * What the SDK's own stores share: how a document becomes the text they
 * keep, how that text is read back, and the checks every call makes before
 * it reaches storage.
 *
 * A document is kept as the JSON text of its `toNotes...Document` form and
 * read back through its strict reader. So a store never hands out an object
 * a caller also holds, and what a later version or a damaged disk left
 * behind is refused, not trusted.
 */

/**
 * An id, checked before it becomes a key or a file name. Anything else,
 * such as `../x`, throws `INVALID_DOCUMENT` with the reason `invalid-id`.
 *
 * @param value - What the caller passed.
 * @param at - The argument's name, for the error.
 */
export function checkedId(value: unknown, at: string): string {
  if (!isNotesId(value)) throw invalidDocument("invalid-id", at);
  return value;
}

/**
 * An asset's name, checked before it becomes a key or a file name. Anything
 * else throws `INVALID_DOCUMENT` with the reason `invalid-asset`.
 */
export function checkedAssetName(value: unknown): string {
  if (!isAssetName(value)) throw invalidDocument("invalid-asset", "asset");
  return value;
}

/** The error every call rejects with once the store is closed. */
export function storeClosed(): NotesError {
  return new NotesError("STORAGE_FAILED", "The store is closed.");
}

function toText(document: object): string {
  try {
    return JSON.stringify(document);
  } catch {
    // A cycle or a BigInt: not something a document can hold.
    throw invalidDocument("malformed-document", "$");
  }
}

function fromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The parser's message can quote the text, so it isn't kept.
    throw invalidDocument("malformed-document", "$");
  }
}

/** A library's index as the JSON text of its document. */
export function indexToText(index: NotesLibraryIndex): string {
  return toText(toNotesLibraryDocument(index));
}

/** Reads a library's index back from stored text, strictly. */
export function indexFromText(text: string): NotesLibraryIndex {
  return readNotesLibraryDocument(fromText(text));
}

/** A notebook as the JSON text of its document. */
export function notebookToText(notebook: NotesNotebook): string {
  return toText(toNotesNotebookDocument(notebook));
}

/** Reads a notebook back from stored text, strictly. */
export function notebookFromText(text: string): NotesNotebook {
  return readNotesNotebookDocument(fromText(text));
}

/** A page's contents as the JSON text of their document. */
export function pageToText(page: NotesPage): string {
  return toText(toNotesPageDocument(page));
}

/** Reads a page's contents back from stored text, strictly. */
export function pageFromText(text: string): NotesPage {
  return readNotesPageDocument(fromText(text));
}

/**
 * A copy of one page's stored search text with only its own fields, after
 * checking them: what a store reads back is as untrusted as a file.
 */
export function checkedPageText(value: unknown): NotesPageText {
  if (typeof value !== "object" || value === null) throw invalidDocument("malformed-document", "$");
  const entry = value as { readonly [Field in keyof NotesPageText]?: unknown };
  const notebook = checkedId(entry.notebook, "$.notebook");
  const page = checkedId(entry.page, "$.page");
  if (typeof entry.typed !== "string") throw invalidDocument("malformed-document", "$.typed");
  if (entry.pdf === undefined) return { notebook, page, typed: entry.typed };
  if (typeof entry.pdf !== "string") throw invalidDocument("malformed-document", "$.pdf");
  return { notebook, page, typed: entry.typed, pdf: entry.pdf };
}

/**
 * A copy of a change to one page's search text with only its own fields,
 * after checking them. A field may be left out, and otherwise is text.
 */
export function checkedPageTextChange(value: unknown): NotesPageTextChange {
  if (typeof value !== "object" || value === null) throw invalidDocument("malformed-document", "$");
  const entry = value as { readonly [Field in keyof NotesPageTextChange]?: unknown };
  const notebook = checkedId(entry.notebook, "$.notebook");
  const page = checkedId(entry.page, "$.page");
  if (entry.typed !== undefined && typeof entry.typed !== "string") {
    throw invalidDocument("malformed-document", "$.typed");
  }
  if (entry.pdf !== undefined && typeof entry.pdf !== "string") {
    throw invalidDocument("malformed-document", "$.pdf");
  }
  return {
    notebook,
    page,
    ...(entry.typed === undefined ? {} : { typed: entry.typed }),
    ...(entry.pdf === undefined ? {} : { pdf: entry.pdf }),
  };
}

/**
 * One page's search text after a change: each field the change leaves out
 * keeps what was stored for it. The typed text of a page with none stored
 * is empty, and there is no PDF text until one is written.
 *
 * What was stored is untrusted, and is only search text, which is made from
 * the pages: a stored field that isn't text counts as not stored, and
 * doesn't keep the change from being made.
 *
 * @param stored - The page's stored row, or `undefined` if it has none.
 * @param change - The change, already checked.
 */
export function mergedPageText(stored: unknown, change: NotesPageTextChange): NotesPageText {
  const kept =
    typeof stored === "object" && stored !== null
      ? (stored as { readonly typed?: unknown; readonly pdf?: unknown })
      : {};
  const typed = change.typed ?? (typeof kept.typed === "string" ? kept.typed : "");
  const pdf = change.pdf ?? (typeof kept.pdf === "string" ? kept.pdf : undefined);
  return {
    notebook: change.notebook,
    page: change.page,
    typed,
    ...(pdf === undefined ? {} : { pdf }),
  };
}
