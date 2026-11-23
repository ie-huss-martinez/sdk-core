import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import {
  NOTES_PAGE_FORMAT,
  NOTES_PAGE_VERSION,
  type NotesNotebookDocument,
  readNotesBackupManifest,
  readNotesLibraryDocument,
  readNotesNotebookDocument,
  readNotesPageDocument,
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../../src/core/format/documents.js";
import type { NotesItem } from "../../src/core/model/items.js";
import {
  applyNotesCommand,
  type NotesCommand,
  type NotesCommandLimits,
  type NotesDocumentState,
  readNotesCommandDocument,
} from "../../src/core/operations/commands.js";

/**
 * How the TypeScript SDK runs each conformance subject: what a port in
 * another language implements too (sdk-core ADR 0045). There's one runner
 * per subject, shared by the generator that writes the cases and the tests
 * that check them. docs/formats/conformance.md describes them for ports.
 */

/** The formats of `hm-notes-documents`, each with its reader, which writes the document back. */
export const DOCUMENT_READERS = {
  "hm-notes-notebook": (document: unknown): unknown =>
    toNotesNotebookDocument(readNotesNotebookDocument(document)),
  "hm-notes-page": (document: unknown): unknown =>
    toNotesPageDocument(readNotesPageDocument(document)),
  "hm-notes-library": (document: unknown): unknown =>
    toNotesLibraryDocument(readNotesLibraryDocument(document)),
  // A manifest is read as the document it is: it has no form in memory of its own.
  "hm-notes-backup": (document: unknown): unknown => readNotesBackupManifest(document),
} as const;

/** The name of a format `hm-notes-documents` reads. */
export type NotesDocumentFormat = keyof typeof DOCUMENT_READERS;

/** An `hm-notes-documents` case's input: a document, and the format to read it as. */
export interface DocumentInput {
  readonly as: NotesDocumentFormat;
  readonly document: unknown;
}

/** `hm-notes-documents`: a document read as one format and written back, as a reader normalises it. */
export function readAndWrite(input: DocumentInput): unknown {
  if (!Object.hasOwn(DOCUMENT_READERS, input.as)) {
    throw new TypeError(`The vectors have no reader named ${String(input.as)}.`);
  }
  return DOCUMENT_READERS[input.as](input.document);
}

/**
 * A notebook's state as the vectors hold it: its notebook document, and the
 * items of each page that's loaded, by the page's id. A page the notebook
 * lists that isn't in `pages` isn't loaded.
 */
export interface StateDocument {
  readonly notebook: NotesNotebookDocument;
  readonly pages: Readonly<Record<string, readonly NotesItem[]>>;
}

/** An `hm-notes-commands` case's input. Without `limits`, nothing is limited. */
export interface CommandInput {
  readonly state: unknown;
  readonly command: unknown;
  readonly limits?: Partial<NotesCommandLimits>;
}

/** Reads a state from a vector, as strictly as the documents it's made of. */
export function readState(value: unknown): NotesDocumentState {
  if (typeof value !== "object" || value === null) throw new TypeError("A state is an object.");
  const names = Object.keys(value);
  if (names.length !== 2 || !Object.hasOwn(value, "notebook") || !Object.hasOwn(value, "pages")) {
    throw new TypeError("A state has a notebook and its pages, and nothing else.");
  }
  const { notebook: document, pages: loaded } = value as { notebook: unknown; pages: unknown };
  if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) {
    throw new TypeError("A state's pages are an object, keyed by page id.");
  }
  const notebook = readNotesNotebookDocument(document);
  const listed = new Set(notebook.pages.map((info) => info.id));
  const pages = new Map(
    // Own keys only, so a page named `__proto__` is a page like any other.
    Object.entries(loaded).map(([id, items]) => {
      if (!listed.has(id)) throw new TypeError("A state's pages are pages of its notebook.");
      const page = { format: NOTES_PAGE_FORMAT, version: NOTES_PAGE_VERSION, id, items };
      return [id, readNotesPageDocument(page)] as const;
    }),
  );
  return { notebook, pages };
}

/** A state as the vectors hold it, with the loaded pages in the notebook's order. */
export function toStateDocument(state: NotesDocumentState): StateDocument {
  const loaded: [string, readonly NotesItem[]][] = [];
  for (const { id } of state.notebook.pages) {
    const page = state.pages.get(id);
    if (page) loaded.push([id, page.items]);
  }
  // Object.fromEntries defines own fields, so the key `__proto__` stays a key.
  return { notebook: toNotesNotebookDocument(state.notebook), pages: Object.fromEntries(loaded) };
}

const limitsOf = (limits: CommandInput["limits"]): NotesCommandLimits => ({
  maxPages: limits?.maxPages ?? Number.POSITIVE_INFINITY,
  maxPageItems: limits?.maxPageItems ?? Number.POSITIVE_INFINITY,
});

/**
 * `hm-notes-commands`: a command read and applied to a state, giving the
 * new state and the command's inverse. The inverse must restore the state
 * exactly.
 */
export function applyToState(input: CommandInput): {
  readonly state: StateDocument;
  readonly inverse: NotesCommand;
} {
  const state = readState(input.state);
  const limits = limitsOf(input.limits);
  const applied = applyNotesCommand(state, readNotesCommandDocument(input.command), limits);
  let undone: NotesDocumentState;
  try {
    undone = applyNotesCommand(applied.state, applied.inverse, limits).state;
  } catch (error) {
    // Never the command's own rejection: an inverse always applies to the state it came with.
    throw new Error("The command's inverse was refused.", { cause: error });
  }
  if (!conforms(toStateDocument(undone), toStateDocument(state))) {
    throw new Error("The command's inverse didn't restore the state.");
  }
  return { state: toStateDocument(applied.state), inverse: applied.inverse };
}

/** Whether a call returns, rather than throws. */
export const accepts = (run: () => unknown): boolean => {
  try {
    run();
    return true;
  } catch {
    return false;
  }
};

/** The rejection a call throws, as the vectors hold it, or `undefined` when it returns. */
export function rejection(run: () => unknown): { code: string; reason?: string } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    const { code, details } = error as { code?: unknown; details?: { reason?: unknown } };
    if (typeof code !== "string") throw error;
    return { code, ...(typeof details?.reason === "string" ? { reason: details.reason } : {}) };
  }
}
