import type { NotesCover, NotesTemplate } from "./notebook.js";

/**
 * A folder of the library. Folders nest.
 *
 * @public
 */
export interface NotesFolder {
  readonly id: string;
  readonly name: string;
  /** The folder it's in, or `null` at the top. */
  readonly parent: string | null;
  readonly createdAt: number;
}

/**
 * What the library shows of a notebook without opening it.
 *
 * @public
 */
export interface NotesNotebookSummary {
  readonly id: string;
  readonly title: string;
  readonly cover: NotesCover;
  /** The paper of its first page, drawn on its cover. */
  readonly template: NotesTemplate;
  /** The folder it's in, or `null` at the top. */
  readonly folder: string | null;
  readonly pageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When it was moved to the bin, or `null`. */
  readonly deletedAt: number | null;
}

/**
 * The library's index: its folders, its notebooks, and when it was last
 * backed up.
 *
 * @public
 */
export interface NotesLibraryIndex {
  readonly folders: readonly NotesFolder[];
  readonly notebooks: readonly NotesNotebookSummary[];
  /** When the whole library was last backed up, or `null`. */
  readonly lastBackupAt: number | null;
  /** When a notebook last changed, or `null` for an empty library. */
  readonly lastChangeAt: number | null;
}

/** An empty library. */
export const EMPTY_LIBRARY: NotesLibraryIndex = {
  folders: [],
  notebooks: [],
  lastBackupAt: null,
  lastChangeAt: null,
};

/** The ids of a folder and every folder inside it. */
export function folderTree(folders: readonly NotesFolder[], root: string): Set<string> {
  const inside = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent !== null && inside.has(folder.parent) && !inside.has(folder.id)) {
        inside.add(folder.id);
        grew = true;
      }
    }
  }
  return inside;
}
