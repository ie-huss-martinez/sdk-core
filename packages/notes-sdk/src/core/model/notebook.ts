import type { NotesAssetReference, NotesItem } from "./items.js";

/**
 * The paper a page is ruled with. The rules are drawn by this SDK
 * (docs/adr/0001).
 *
 * @public
 */
export type NotesTemplate = "blank" | "lined" | "grid" | "dotted";

/**
 * The colour of a notebook's cover: a name, which the interface maps to a
 * token of the design system.
 *
 * @public
 */
export type NotesCover = "blue" | "green" | "amber" | "red" | "gray";

/**
 * A page of a PDF under a page's ink.
 *
 * @public
 */
export interface NotesPageBackground {
  /** The PDF's file. */
  readonly pdf: NotesAssetReference;
  /** The page's zero-based index in the PDF. */
  readonly pageIndex: number;
}

/**
 * A page as its notebook lists it: its size and paper. Its contents are a
 * {@link NotesPage}, stored on their own.
 *
 * @public
 */
export interface NotesPageInfo {
  readonly id: string;
  /** The page's width and height, in units. */
  readonly width: number;
  readonly height: number;
  readonly template: NotesTemplate;
  /** The PDF page under the ink, for a page of an imported PDF. */
  readonly background?: NotesPageBackground;
}

/**
 * One entry of a notebook's outline: a title that leads to a page.
 *
 * @public
 */
export interface NotesOutlineEntry {
  readonly id: string;
  readonly title: string;
  /** The id of the page it leads to. */
  readonly page: string;
}

/**
 * A sound recording kept with a notebook.
 *
 * @public
 */
export interface NotesRecording {
  readonly id: string;
  /** The recording's file. */
  readonly audio: NotesAssetReference;
  /** When it started, in milliseconds since the Unix epoch. */
  readonly startedAt: number;
  /** Its length, in milliseconds. */
  readonly duration: number;
}

/**
 * A notebook: its title, its pages in order, its outline and its
 * recordings.
 *
 * @public
 */
export interface NotesNotebook {
  readonly id: string;
  readonly title: string;
  readonly cover: NotesCover;
  /** When it was created and last changed, in milliseconds since the Unix epoch. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly pages: readonly NotesPageInfo[];
  readonly outline: readonly NotesOutlineEntry[];
  readonly recordings: readonly NotesRecording[];
}

/**
 * The contents of one page: its items, from the bottom to the top.
 *
 * @public
 */
export interface NotesPage {
  readonly id: string;
  readonly items: readonly NotesItem[];
}

/**
 * A page size by name, in units.
 *
 * @public
 */
export const NOTES_PAGE_SIZES = {
  a4: { width: 59_500, height: 84_200 },
  letter: { width: 61_200, height: 79_200 },
} as const;

/**
 * The name of a built-in page size.
 *
 * @public
 */
export type NotesPageSizeName = keyof typeof NOTES_PAGE_SIZES;

/** Every asset a notebook and its loaded pages refer to, once each, by its hash. */
export function notebookAssets(
  notebook: NotesNotebook,
  pages: Iterable<NotesPage>,
): Map<string, NotesAssetReference> {
  const assets = new Map<string, NotesAssetReference>();
  for (const page of notebook.pages) {
    if (page.background) assets.set(page.background.pdf.asset, page.background.pdf);
  }
  for (const recording of notebook.recordings) assets.set(recording.audio.asset, recording.audio);
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "image") assets.set(item.image.asset, item.image);
    }
  }
  return assets;
}
