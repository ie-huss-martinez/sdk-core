import type { NotesFolder, NotesLibraryIndex } from "../../model/library.js";
import type { NotesNotebook, NotesPage } from "../../model/notebook.js";

/**
 * The library that `library-v1.zip` is a backup of: two notebooks in one
 * folder, with a stroke, a text box and a picture between them.
 *
 * The zip was written once, from these values, by version 1 of the backup
 * format. The values are also what the test expects a restore of it to
 * give, so they never change: a release that reads the file differently
 * has broken version 1.
 */

/** When the library's notebooks were made, and when it was backed up: 2026-01-01. */
export const LIBRARY_V1_TIME = 1_767_225_600_000;

const PICTURE_HEX =
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
  "0000000c4944415478da6390cf7f0d00022a017a466f182e0000000049454e44ae426082";

/** The library's one file: a PNG of a single pixel. */
export const libraryV1Picture: Uint8Array<ArrayBuffer> = Uint8Array.from(
  PICTURE_HEX.match(/../g) ?? [],
  (byte) => Number.parseInt(byte, 16),
);

/** The picture's name: its SHA-256. */
export const LIBRARY_V1_PICTURE_NAME =
  "sha256:cb8b6b7bd8c6a36e216b81eb6c58e55989d09273d5e326d84ac0d326c8ce0d61";

const folder: NotesFolder = {
  id: "folder-school",
  name: "School",
  parent: null,
  createdAt: LIBRARY_V1_TIME,
};

const maths: NotesNotebook = {
  id: "notebook-maths",
  title: "Maths",
  cover: "blue",
  createdAt: LIBRARY_V1_TIME,
  updatedAt: LIBRARY_V1_TIME + 60_000,
  pages: [
    { id: "page-1", width: 59_500, height: 84_200, template: "lined" },
    { id: "page-2", width: 59_500, height: 84_200, template: "grid" },
  ],
  outline: [{ id: "outline-1", title: "Triangles", page: "page-1" }],
  recordings: [],
};

const history: NotesNotebook = {
  id: "notebook-history",
  title: "History",
  cover: "green",
  createdAt: LIBRARY_V1_TIME + 1000,
  updatedAt: LIBRARY_V1_TIME + 2000,
  pages: [{ id: "page-1", width: 61_200, height: 79_200, template: "blank" }],
  outline: [],
  recordings: [],
};

/** The notebooks, as the store holds them. */
export const libraryV1Notebooks: readonly NotesNotebook[] = [maths, history];

/**
 * The pages the store holds, by notebook. The history notebook's page was
 * never written on, so the store has no file for it and the backup holds
 * it empty.
 */
export const libraryV1Pages: Readonly<Record<string, readonly NotesPage[]>> = {
  "notebook-maths": [
    {
      id: "page-1",
      items: [
        {
          id: "stroke-1",
          type: "stroke",
          tool: "pen",
          color: "#1d4ed8",
          size: 200,
          points: [
            10_000, 12_000, 400, 14_000, 12_500, 700, 18_000, 11_800, 1000, 21_000, 12_200, 0,
          ],
        },
        {
          id: "text-1",
          type: "text",
          x: 6000,
          y: 20_000,
          width: 30_000,
          text: "Pythagoras: a\u00b2 + b\u00b2 = c\u00b2\nSecond line",
          size: 1200,
          color: "#111827",
        },
      ],
    },
    {
      id: "page-2",
      items: [
        {
          id: "image-1",
          type: "image",
          x: 5000,
          y: 5000,
          width: 20_000,
          height: 20_000,
          image: { asset: LIBRARY_V1_PICTURE_NAME, mediaType: "image/png", size: 69 },
        },
        {
          id: "link-1",
          type: "link",
          x: 5000,
          y: 30_000,
          width: 10_000,
          height: 2000,
          page: "page-1",
        },
      ],
    },
  ],
  "notebook-history": [],
};

/** The library's index when it was backed up. */
export const libraryV1Index: NotesLibraryIndex = {
  folders: [folder],
  notebooks: [
    {
      id: maths.id,
      title: maths.title,
      cover: maths.cover,
      template: "lined",
      folder: folder.id,
      pageCount: 2,
      createdAt: maths.createdAt,
      updatedAt: maths.updatedAt,
      deletedAt: null,
    },
    {
      id: history.id,
      title: history.title,
      cover: history.cover,
      template: "blank",
      folder: folder.id,
      pageCount: 1,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
      deletedAt: null,
    },
  ],
  lastBackupAt: null,
  lastChangeAt: LIBRARY_V1_TIME + 60_000,
};
