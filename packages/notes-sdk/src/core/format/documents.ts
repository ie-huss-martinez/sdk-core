import { invalidDocument } from "../errors/notes-error.js";
import type { NotesFolder, NotesLibraryIndex, NotesNotebookSummary } from "../model/library.js";
import type {
  NotesNotebook,
  NotesOutlineEntry,
  NotesPage,
  NotesPageInfo,
  NotesRecording,
} from "../model/notebook.js";
import {
  NOTES_MAX_OUTLINE_ENTRIES,
  NOTES_MAX_PAGE_SIDE,
  NOTES_MAX_RECORDINGS,
  NOTES_MAX_TITLE_LENGTH,
  NOTES_MIN_PAGE_SIDE,
} from "../model/portable.js";
import { NOTES_AUDIO_TYPES, NOTES_PDF_TYPE, readItems } from "./items.js";
import {
  assetReference,
  fields,
  header,
  id,
  idOrNull,
  integer,
  list,
  MAX_TIME,
  oneOf,
  text,
  time,
  timeOrNull,
} from "./read.js";

/**
 * The notes SDK's portable documents (sdk-core ADR 0045, docs/adr/0003):
 * versioned JSON, written by the `to…Document` functions and read back,
 * strictly, by the `read…Document` ones. Each has a JSON Schema in
 * `formats/`.
 */

/** @public */
export const NOTES_NOTEBOOK_FORMAT = "hm-notes-notebook";
/** @public */
export const NOTES_NOTEBOOK_VERSION = 1;
/** @public */
export const NOTES_PAGE_FORMAT = "hm-notes-page";
/** @public */
export const NOTES_PAGE_VERSION = 1;
/** @public */
export const NOTES_LIBRARY_FORMAT = "hm-notes-library";
/** @public */
export const NOTES_LIBRARY_VERSION = 1;
/** @public */
export const NOTES_BACKUP_FORMAT = "hm-notes-backup";
/** @public */
export const NOTES_BACKUP_VERSION = 1;

/** The most pages a notebook document may list, whatever the file policy. */
export const NOTES_DOCUMENT_MAX_PAGES = 100_000;
/** The most items a page document may hold, whatever the file policy. */
export const NOTES_DOCUMENT_MAX_ITEMS = 1_000_000;
/** The most folders and notebooks a library index may list. */
export const NOTES_DOCUMENT_MAX_ENTRIES = 100_000;

const TEMPLATES = ["blank", "lined", "grid", "dotted"] as const;
const COVERS = ["blue", "green", "amber", "red", "gray"] as const;

/**
 * A notebook as a document: `{ "format": "hm-notes-notebook", "version": 1, … }`.
 *
 * @public
 */
export interface NotesNotebookDocument extends NotesNotebook {
  readonly format: typeof NOTES_NOTEBOOK_FORMAT;
  readonly version: typeof NOTES_NOTEBOOK_VERSION;
}

/**
 * A page's contents as a document: `{ "format": "hm-notes-page", "version": 1, … }`.
 *
 * @public
 */
export interface NotesPageDocument extends NotesPage {
  readonly format: typeof NOTES_PAGE_FORMAT;
  readonly version: typeof NOTES_PAGE_VERSION;
}

/**
 * A library's index as a document: `{ "format": "hm-notes-library", "version": 1, … }`.
 *
 * @public
 */
export interface NotesLibraryDocument extends NotesLibraryIndex {
  readonly format: typeof NOTES_LIBRARY_FORMAT;
  readonly version: typeof NOTES_LIBRARY_VERSION;
}

/**
 * What a backup holds: the first entry of its archive, `backup.json`
 * (docs/adr/0005). Each notebook's own documents and files are under
 * `notebooks/<id>/`.
 *
 * @public
 */
export interface NotesBackupManifest {
  readonly format: typeof NOTES_BACKUP_FORMAT;
  readonly version: typeof NOTES_BACKUP_VERSION;
  /** When the backup was made, in milliseconds since the Unix epoch. */
  readonly createdAt: number;
  /** The whole library, or the notebooks chosen. */
  readonly scope: "library" | "notebooks";
  /** The folders the notebooks are in, with the folders those are in. */
  readonly folders: readonly NotesFolder[];
  /** Each notebook's id, and the folder it's in. */
  readonly notebooks: readonly { readonly id: string; readonly folder: string | null }[];
}

function pageInfo(value: unknown, at: string): NotesPageInfo {
  const entry = fields(value, at, ["id", "width", "height", "template"], ["background"]);
  const info: NotesPageInfo = {
    id: id(entry["id"], `${at}.id`),
    width: integer(
      entry["width"],
      `${at}.width`,
      NOTES_MIN_PAGE_SIDE,
      NOTES_MAX_PAGE_SIDE,
      "invalid-size",
    ),
    height: integer(
      entry["height"],
      `${at}.height`,
      NOTES_MIN_PAGE_SIDE,
      NOTES_MAX_PAGE_SIDE,
      "invalid-size",
    ),
    template: oneOf(entry["template"], `${at}.template`, TEMPLATES),
  };
  if (!Object.hasOwn(entry, "background")) return info;
  const background = fields(entry["background"], `${at}.background`, ["pdf", "pageIndex"]);
  return {
    ...info,
    background: {
      pdf: assetReference(background["pdf"], `${at}.background.pdf`, [NOTES_PDF_TYPE]),
      pageIndex: integer(background["pageIndex"], `${at}.background.pageIndex`, 0, 1_000_000),
    },
  };
}

/** Reads a page's entry in a notebook from untrusted JSON. */
export function readPageInfo(value: unknown, at = "$"): NotesPageInfo {
  return pageInfo(value, at);
}

function outlineEntry(value: unknown, at: string): NotesOutlineEntry {
  const entry = fields(value, at, ["id", "title", "page"]);
  return {
    id: id(entry["id"], `${at}.id`),
    title: text(entry["title"], `${at}.title`, NOTES_MAX_TITLE_LENGTH, "text-too-long"),
    page: id(entry["page"], `${at}.page`),
  };
}

/** Reads an outline, refusing two entries with one id. */
export function readOutline(value: unknown, at = "$"): NotesOutlineEntry[] {
  return unique(
    list(value, at, NOTES_MAX_OUTLINE_ENTRIES).map((entry, index) =>
      outlineEntry(entry, `${at}[${index}]`),
    ),
    at,
  );
}

function recording(value: unknown, at: string): NotesRecording {
  const entry = fields(value, at, ["id", "audio", "startedAt", "duration"]);
  return {
    id: id(entry["id"], `${at}.id`),
    audio: assetReference(entry["audio"], `${at}.audio`, NOTES_AUDIO_TYPES),
    startedAt: time(entry["startedAt"], `${at}.startedAt`),
    duration: integer(entry["duration"], `${at}.duration`, 0, MAX_TIME, "invalid-time"),
  };
}

/** Reads one recording's entry from untrusted JSON. */
export function readRecording(value: unknown, at = "$"): NotesRecording {
  return recording(value, at);
}

function unique<Entry extends { readonly id: string }>(entries: Entry[], at: string): Entry[] {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) throw invalidDocument("duplicate-id", `${at}[${index}].id`);
    seen.add(entry.id);
  });
  return entries;
}

/** Reads a notebook's fields, without the document's header. */
function notebook(entry: Readonly<Record<string, unknown>>): NotesNotebook {
  const pages = unique(
    list(entry["pages"], "$.pages", NOTES_DOCUMENT_MAX_PAGES).map((page, index) =>
      pageInfo(page, `$.pages[${index}]`),
    ),
    "$.pages",
  );
  const known = new Set(pages.map((page) => page.id));
  const outline = readOutline(entry["outline"], "$.outline");
  outline.forEach((item, index) => {
    if (!known.has(item.page)) throw invalidDocument("unknown-page", `$.outline[${index}].page`);
  });
  const createdAt = time(entry["createdAt"], "$.createdAt");
  const updatedAt = time(entry["updatedAt"], "$.updatedAt");
  return {
    id: id(entry["id"], "$.id"),
    title: text(entry["title"], "$.title", NOTES_MAX_TITLE_LENGTH, "text-too-long"),
    cover: oneOf(entry["cover"], "$.cover", COVERS),
    createdAt,
    updatedAt,
    pages,
    outline,
    recordings: unique(
      list(entry["recordings"], "$.recordings", NOTES_MAX_RECORDINGS).map((item, index) =>
        recording(item, `$.recordings[${index}]`),
      ),
      "$.recordings",
    ),
  };
}

const NOTEBOOK_FIELDS = [
  "id",
  "title",
  "cover",
  "createdAt",
  "updatedAt",
  "pages",
  "outline",
  "recordings",
] as const;

/**
 * Reads a notebook document from untrusted JSON. Throws
 * `UNSUPPORTED_FORMAT` for another format or a later version, and
 * `INVALID_DOCUMENT`, with `details.reason`, for anything else it refuses.
 * A notebook has at least one page.
 *
 * @public
 */
export function readNotesNotebookDocument(value: unknown): NotesNotebook {
  header(value, NOTES_NOTEBOOK_FORMAT, NOTES_NOTEBOOK_VERSION);
  const read = notebook(fields(value, "$", ["format", "version", ...NOTEBOOK_FIELDS]));
  if (read.pages.length === 0) throw invalidDocument("malformed-document", "$.pages");
  return read;
}

/**
 * A notebook as its document, ready for `JSON.stringify`.
 *
 * @public
 */
export function toNotesNotebookDocument(notebook: NotesNotebook): NotesNotebookDocument {
  return {
    format: NOTES_NOTEBOOK_FORMAT,
    version: NOTES_NOTEBOOK_VERSION,
    id: notebook.id,
    title: notebook.title,
    cover: notebook.cover,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    pages: notebook.pages,
    outline: notebook.outline,
    recordings: notebook.recordings,
  };
}

/**
 * Reads a page document from untrusted JSON, as
 * {@link readNotesNotebookDocument} reads a notebook's.
 *
 * @public
 */
export function readNotesPageDocument(value: unknown): NotesPage {
  header(value, NOTES_PAGE_FORMAT, NOTES_PAGE_VERSION);
  const entry = fields(value, "$", ["format", "version", "id", "items"]);
  return {
    id: id(entry["id"], "$.id"),
    items: readItems(entry["items"], "$.items", NOTES_DOCUMENT_MAX_ITEMS),
  };
}

/**
 * A page's contents as their document, ready for `JSON.stringify`.
 *
 * @public
 */
export function toNotesPageDocument(page: NotesPage): NotesPageDocument {
  return { format: NOTES_PAGE_FORMAT, version: NOTES_PAGE_VERSION, id: page.id, items: page.items };
}

function folder(value: unknown, at: string): NotesFolder {
  const entry = fields(value, at, ["id", "name", "parent", "createdAt"]);
  return {
    id: id(entry["id"], `${at}.id`),
    name: text(entry["name"], `${at}.name`, NOTES_MAX_TITLE_LENGTH, "text-too-long"),
    parent: idOrNull(entry["parent"], `${at}.parent`),
    createdAt: time(entry["createdAt"], `${at}.createdAt`),
  };
}

/** Reads folders, refusing a parent that isn't listed and a folder inside itself. */
function folders(value: unknown, at: string): NotesFolder[] {
  const read = unique(
    list(value, at, NOTES_DOCUMENT_MAX_ENTRIES).map((entry, index) =>
      folder(entry, `${at}[${index}]`),
    ),
    at,
  );
  const parents = new Map(read.map((entry) => [entry.id, entry.parent]));
  // The folders already known to reach the top. A walk stops at one of them,
  // so each folder is walked once, however deep a hostile list nests them.
  const rooted = new Set<string>();
  read.forEach((entry, index) => {
    // Walks up to the top. A walk longer than the list is a cycle.
    const walked = [entry.id];
    let parent = entry.parent;
    while (parent !== null && !rooted.has(parent)) {
      if (!parents.has(parent) || walked.length > read.length) {
        throw invalidDocument("unknown-folder", `${at}[${index}].parent`);
      }
      walked.push(parent);
      parent = parents.get(parent) ?? null;
    }
    for (const reached of walked) rooted.add(reached);
  });
  return read;
}

function summary(value: unknown, at: string): NotesNotebookSummary {
  const entry = fields(value, at, [
    "id",
    "title",
    "cover",
    "template",
    "folder",
    "pageCount",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ]);
  return {
    id: id(entry["id"], `${at}.id`),
    title: text(entry["title"], `${at}.title`, NOTES_MAX_TITLE_LENGTH, "text-too-long"),
    cover: oneOf(entry["cover"], `${at}.cover`, COVERS),
    template: oneOf(entry["template"], `${at}.template`, TEMPLATES),
    folder: idOrNull(entry["folder"], `${at}.folder`),
    pageCount: integer(entry["pageCount"], `${at}.pageCount`, 1, NOTES_DOCUMENT_MAX_PAGES),
    createdAt: time(entry["createdAt"], `${at}.createdAt`),
    updatedAt: time(entry["updatedAt"], `${at}.updatedAt`),
    deletedAt: timeOrNull(entry["deletedAt"], `${at}.deletedAt`),
  };
}

/**
 * Reads a library document from untrusted JSON, as
 * {@link readNotesNotebookDocument} reads a notebook's.
 *
 * @public
 */
export function readNotesLibraryDocument(value: unknown): NotesLibraryIndex {
  header(value, NOTES_LIBRARY_FORMAT, NOTES_LIBRARY_VERSION);
  const entry = fields(value, "$", [
    "format",
    "version",
    "folders",
    "notebooks",
    "lastBackupAt",
    "lastChangeAt",
  ]);
  const readFolders = folders(entry["folders"], "$.folders");
  const known = new Set(readFolders.map((item) => item.id));
  const notebooks = unique(
    list(entry["notebooks"], "$.notebooks", NOTES_DOCUMENT_MAX_ENTRIES).map((item, index) =>
      summary(item, `$.notebooks[${index}]`),
    ),
    "$.notebooks",
  );
  notebooks.forEach((item, index) => {
    if (item.folder !== null && !known.has(item.folder)) {
      throw invalidDocument("unknown-folder", `$.notebooks[${index}].folder`);
    }
  });
  return {
    folders: readFolders,
    notebooks,
    lastBackupAt: timeOrNull(entry["lastBackupAt"], "$.lastBackupAt"),
    lastChangeAt: timeOrNull(entry["lastChangeAt"], "$.lastChangeAt"),
  };
}

/**
 * A library's index as its document, ready for `JSON.stringify`.
 *
 * @public
 */
export function toNotesLibraryDocument(index: NotesLibraryIndex): NotesLibraryDocument {
  return {
    format: NOTES_LIBRARY_FORMAT,
    version: NOTES_LIBRARY_VERSION,
    folders: index.folders,
    notebooks: index.notebooks,
    lastBackupAt: index.lastBackupAt,
    lastChangeAt: index.lastChangeAt,
  };
}

/**
 * Reads a backup's manifest from untrusted JSON, as
 * {@link readNotesNotebookDocument} reads a notebook.
 *
 * @public
 */
export function readNotesBackupManifest(value: unknown): NotesBackupManifest {
  header(value, NOTES_BACKUP_FORMAT, NOTES_BACKUP_VERSION);
  const entry = fields(value, "$", [
    "format",
    "version",
    "createdAt",
    "scope",
    "folders",
    "notebooks",
  ]);
  const readFolders = folders(entry["folders"], "$.folders");
  const known = new Set(readFolders.map((item) => item.id));
  const notebooks = unique(
    list(entry["notebooks"], "$.notebooks", NOTES_DOCUMENT_MAX_ENTRIES).map((item, index) => {
      const at = `$.notebooks[${index}]`;
      const fieldsOf = fields(item, at, ["id", "folder"]);
      const inFolder = idOrNull(fieldsOf["folder"], `${at}.folder`);
      if (inFolder !== null && !known.has(inFolder)) {
        throw invalidDocument("unknown-folder", `${at}.folder`);
      }
      return { id: id(fieldsOf["id"], `${at}.id`), folder: inFolder };
    }),
    "$.notebooks",
  );
  return {
    format: NOTES_BACKUP_FORMAT,
    version: NOTES_BACKUP_VERSION,
    createdAt: time(entry["createdAt"], "$.createdAt"),
    scope: oneOf(entry["scope"], "$.scope", ["library", "notebooks"]),
    folders: readFolders,
    notebooks,
  };
}
