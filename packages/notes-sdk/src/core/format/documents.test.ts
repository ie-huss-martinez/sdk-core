import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backupManifest, library, notebook, page } from "../../../test/arbitraries/notes.js";
import { documentErrors } from "../../../test/conformance/schemas.js";
import { isNotesError } from "../errors/notes-error.js";
import type { NotesFolder } from "../model/library.js";
import {
  NOTES_MAX_OUTLINE_ENTRIES,
  NOTES_MAX_RECORDINGS,
  NOTES_MAX_STROKE_POINTS,
} from "../model/portable.js";
import {
  NOTES_BACKUP_FORMAT,
  NOTES_BACKUP_VERSION,
  NOTES_DOCUMENT_MAX_ENTRIES,
  NOTES_LIBRARY_FORMAT,
  NOTES_LIBRARY_VERSION,
  NOTES_NOTEBOOK_FORMAT,
  NOTES_NOTEBOOK_VERSION,
  NOTES_PAGE_FORMAT,
  NOTES_PAGE_VERSION,
  readNotesBackupManifest,
  readNotesLibraryDocument,
  readNotesNotebookDocument,
  readNotesPageDocument,
  readOutline,
  readPageInfo,
  readRecording,
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "./documents.js";

/** A value as JSON carries it: written as text and parsed again. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The rejection's code, reason and place, or `undefined` when the call returns. */
function refusal(run: () => unknown): { code: string; reason: unknown; at: unknown } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!isNotesError(error)) throw error;
    return { code: error.code, reason: error.details?.["reason"], at: error.details?.["at"] };
  }
}

const invalid = (reason: string, at: string) => ({ code: "INVALID_DOCUMENT", reason, at });

const NOTEBOOK = {
  format: "hm-notes-notebook",
  version: 1,
  id: "nb",
  title: "Field notes",
  cover: "blue",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  pages: [{ id: "p1", width: 59_500, height: 84_200, template: "lined" }],
  outline: [] as unknown[],
  recordings: [] as unknown[],
};

const LIBRARY = {
  format: "hm-notes-library",
  version: 1,
  folders: [] as unknown[],
  notebooks: [] as unknown[],
  lastBackupAt: null,
  lastChangeAt: null,
};

const audio = { asset: `sha256:${"0b".repeat(32)}`, mediaType: "audio/webm", size: 1 };
const folder = (id: string, parent: string | null): NotesFolder => ({
  id,
  name: "Folder",
  parent,
  createdAt: 0,
});

describe("the documents' names and versions", () => {
  it("are the formats' names, at version 1", () => {
    expect([
      [NOTES_NOTEBOOK_FORMAT, NOTES_NOTEBOOK_VERSION],
      [NOTES_PAGE_FORMAT, NOTES_PAGE_VERSION],
      [NOTES_LIBRARY_FORMAT, NOTES_LIBRARY_VERSION],
      [NOTES_BACKUP_FORMAT, NOTES_BACKUP_VERSION],
    ]).toStrictEqual([
      ["hm-notes-notebook", 1],
      ["hm-notes-page", 1],
      ["hm-notes-library", 1],
      ["hm-notes-backup", 1],
    ]);
  });
});

describe("writing a document and reading it back", () => {
  it("keeps any notebook, which is valid by its schema", () => {
    fc.assert(
      fc.property(notebook, (value) => {
        const document = asJson(toNotesNotebookDocument(value));
        expect(documentErrors["hm-notes-notebook"](document)).toStrictEqual([]);
        expect(readNotesNotebookDocument(document)).toStrictEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps any page, which is valid by its schema", () => {
    fc.assert(
      fc.property(page, (value) => {
        const document = asJson(toNotesPageDocument(value));
        expect(documentErrors["hm-notes-page"](document)).toStrictEqual([]);
        expect(readNotesPageDocument(document)).toStrictEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps any library index, which is valid by its schema", () => {
    fc.assert(
      fc.property(library, (value) => {
        const document = asJson(toNotesLibraryDocument(value));
        expect(documentErrors["hm-notes-library"](document)).toStrictEqual([]);
        expect(readNotesLibraryDocument(document)).toStrictEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps any backup manifest, which is valid by its schema", () => {
    fc.assert(
      fc.property(backupManifest, (value) => {
        const document = asJson(value);
        expect(documentErrors["hm-notes-backup"](document)).toStrictEqual([]);
        expect(readNotesBackupManifest(document)).toStrictEqual(value);
      }),
      { numRuns: 500 },
    );
  });

  it("writes the header first, and only the document's own fields", () => {
    const read = readNotesNotebookDocument(NOTEBOOK);
    const written = toNotesNotebookDocument({ ...read, session: "s1" } as typeof read);
    expect(Object.keys(written)).toStrictEqual(Object.keys(NOTEBOOK));
    expect(Object.keys(toNotesPageDocument({ id: "p1", items: [] }))).toStrictEqual([
      "format",
      "version",
      "id",
      "items",
    ]);
    expect(Object.keys(toNotesLibraryDocument(readNotesLibraryDocument(LIBRARY)))).toStrictEqual(
      Object.keys(LIBRARY),
    );
  });

  it("returns a copy that shares nothing with what it read", () => {
    const input = structuredClone(NOTEBOOK);
    const read = readNotesNotebookDocument(input);
    expect(read.pages[0]).not.toBe(input.pages[0]);
    expect(read).not.toHaveProperty("format");
    expect(read).not.toHaveProperty("version");
  });
});

describe("a document's header", () => {
  it("is checked before anything else", () => {
    // Everything else about this document is wrong too.
    const other = { format: "hm-notes-page", version: 1, pages: "none" };
    expect(refusal(() => readNotesNotebookDocument(other))).toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      reason: "unknown-format",
    });
    const later = { format: "hm-notes-notebook", version: 2, layers: [] };
    expect(refusal(() => readNotesNotebookDocument(later))).toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      reason: "unknown-format-version",
    });
  });

  it("is never read through a prototype", () => {
    const inherited = Object.assign(Object.create({ format: "hm-notes-notebook", version: 1 }), {
      ...NOTEBOOK,
      format: undefined,
    });
    delete inherited.format;
    expect(refusal(() => readNotesNotebookDocument(inherited))?.reason).toBe("unknown-format");
  });

  it("refuses an instance of a class, whose fields may come from anywhere", () => {
    class Document {
      format = "hm-notes-library";
      version = 1;
      folders = [];
      notebooks = [];
      lastBackupAt = null;
      lastChangeAt = null;
    }
    expect(refusal(() => readNotesLibraryDocument(new Document()))).toStrictEqual(
      invalid("malformed-document", "$"),
    );
  });
});

describe("readNotesNotebookDocument", () => {
  it("says where a document is wrong, by path", () => {
    const cases: [object, string, string][] = [
      [{ ...NOTEBOOK, pages: [] }, "malformed-document", "$.pages"],
      [
        { ...NOTEBOOK, pages: [{ ...NOTEBOOK.pages[0], width: 1 }] },
        "invalid-size",
        "$.pages[0].width",
      ],
      [
        { ...NOTEBOOK, pages: [NOTEBOOK.pages[0], NOTEBOOK.pages[0]] },
        "duplicate-id",
        "$.pages[1].id",
      ],
      [
        { ...NOTEBOOK, outline: [{ id: "o", title: "x", page: "p9" }] },
        "unknown-page",
        "$.outline[0].page",
      ],
      [{ ...NOTEBOOK, createdAt: -1 }, "invalid-time", "$.createdAt"],
      [{ ...NOTEBOOK, extra: 1 }, "malformed-document", "$.extra"],
    ];
    for (const [document, reason, at] of cases) {
      expect(
        refusal(() => readNotesNotebookDocument(document)),
        at,
      ).toStrictEqual(invalid(reason, at));
    }
  });

  it("never puts a field's name in an error unless it's short and plain", () => {
    const named = (name: string) =>
      Object.defineProperty({ ...NOTEBOOK }, name, { value: 1, enumerable: true });
    expect(refusal(() => readNotesNotebookDocument(named("secret name")))?.at).toBe("$.?");
    expect(refusal(() => readNotesNotebookDocument(named("x".repeat(41))))?.at).toBe("$.?");
    expect(refusal(() => readNotesNotebookDocument(named("<script>")))?.at).toBe("$.?");
    expect(refusal(() => readNotesNotebookDocument(named("__proto__")))?.at).toBe("$.__proto__");
  });

  it("reads an outline and recordings at their limits, and refuses one more", () => {
    const outline = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `o${index}`, title: "", page: "p1" }));
    const recordings = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `r${index}`,
        audio,
        startedAt: 0,
        duration: 0,
      }));
    const most = {
      ...NOTEBOOK,
      outline: outline(NOTES_MAX_OUTLINE_ENTRIES),
      recordings: recordings(NOTES_MAX_RECORDINGS),
    };
    expect(documentErrors["hm-notes-notebook"](most)).toStrictEqual([]);
    expect(readNotesNotebookDocument(most).outline).toHaveLength(NOTES_MAX_OUTLINE_ENTRIES);
    const longOutline = { ...NOTEBOOK, outline: outline(NOTES_MAX_OUTLINE_ENTRIES + 1) };
    expect(refusal(() => readNotesNotebookDocument(longOutline))).toStrictEqual(
      invalid("malformed-document", "$.outline"),
    );
    expect(documentErrors["hm-notes-notebook"](longOutline)).not.toStrictEqual([]);
    const manyRecordings = { ...NOTEBOOK, recordings: recordings(NOTES_MAX_RECORDINGS + 1) };
    expect(refusal(() => readNotesNotebookDocument(manyRecordings))).toStrictEqual(
      invalid("malformed-document", "$.recordings"),
    );
    expect(documentErrors["hm-notes-notebook"](manyRecordings)).not.toStrictEqual([]);
  });
});

describe("readNotesPageDocument", () => {
  const withPoints = (points: number[]) => ({
    format: "hm-notes-page",
    version: 1,
    id: "p1",
    items: [{ id: "s", type: "stroke", tool: "pen", color: "#000000", size: 200, points }],
  });

  it("reads a stroke of the most points, and refuses one more", () => {
    const most = withPoints(new Array<number>(NOTES_MAX_STROKE_POINTS * 3).fill(500));
    expect(documentErrors["hm-notes-page"](most)).toStrictEqual([]);
    expect(readNotesPageDocument(most).items).toHaveLength(1);
    const over = withPoints(new Array<number>(NOTES_MAX_STROKE_POINTS * 3 + 3).fill(500));
    expect(refusal(() => readNotesPageDocument(over))).toStrictEqual(
      invalid("too-many-points", "$.items[0].points"),
    );
    expect(documentErrors["hm-notes-page"](over)).not.toStrictEqual([]);
  });

  it("reads negative zero as zero, which a document can carry and `===` can't tell apart", () => {
    const read = readNotesPageDocument(
      JSON.parse(
        '{"format":"hm-notes-page","version":1,"id":"p1","items":[{"id":"s","type":"stroke","tool":"pen","color":"#000000","size":200,"points":[-0,-0,-0]}]}',
      ),
    );
    const [stroke] = read.items;
    expect(stroke?.type === "stroke" && stroke.points.every((value) => Object.is(value, 0))).toBe(
      true,
    );
  });

  it("says which point of a stroke is wrong", () => {
    expect(
      refusal(() => readNotesPageDocument(withPoints([0, 0, 500, 0, 0, 1_001]))),
    ).toStrictEqual(invalid("invalid-points", "$.items[0].points[5]"));
  });
});

describe("folders, in a library index and a backup's manifest", () => {
  const chain = (count: number): NotesFolder[] =>
    Array.from({ length: count }, (_, index) =>
      folder(`f${index}`, index === 0 ? null : `f${index - 1}`),
    );

  it("reads the most folders, each inside the one before, without walking the chain for each", () => {
    // A hostile index can nest every folder it lists. Reading it must take time in
    // proportion to the list, not to its square: 100,000 folders walked one by one
    // from each is five thousand million steps.
    const folders = chain(NOTES_DOCUMENT_MAX_ENTRIES);
    expect(readNotesLibraryDocument({ ...LIBRARY, folders }).folders).toHaveLength(
      NOTES_DOCUMENT_MAX_ENTRIES,
    );
    // The deepest first, which is the order that walks the furthest.
    const manifest = {
      format: "hm-notes-backup",
      version: 1,
      createdAt: 0,
      scope: "library",
      folders: [...folders].reverse(),
      notebooks: [],
    };
    expect(readNotesBackupManifest(manifest).folders).toHaveLength(NOTES_DOCUMENT_MAX_ENTRIES);
  });

  it("refuses a ring of the most folders", () => {
    const folders = chain(NOTES_DOCUMENT_MAX_ENTRIES);
    folders[0] = folder("f0", `f${NOTES_DOCUMENT_MAX_ENTRIES - 1}`);
    expect(refusal(() => readNotesLibraryDocument({ ...LIBRARY, folders }))).toStrictEqual(
      invalid("unknown-folder", "$.folders[0].parent"),
    );
  });

  it("names the first folder that never reaches the top", () => {
    const rings: [NotesFolder[], number][] = [
      [[folder("a", null), folder("b", "b")], 1],
      [[folder("a", null), folder("b", "a"), folder("c", "d"), folder("d", "c")], 2],
      [[folder("a", null), folder("b", "c"), folder("c", "d"), folder("d", "c")], 1],
      [[folder("a", "b"), folder("b", "missing")], 0],
    ];
    for (const [folders, index] of rings) {
      expect(refusal(() => readNotesLibraryDocument({ ...LIBRARY, folders }))).toStrictEqual(
        invalid("unknown-folder", `$.folders[${index}].parent`),
      );
    }
  });

  it("refuses one folder more than the most", () => {
    const folders = Array.from({ length: NOTES_DOCUMENT_MAX_ENTRIES + 1 }, (_, index) =>
      folder(`f${index}`, null),
    );
    expect(refusal(() => readNotesLibraryDocument({ ...LIBRARY, folders }))).toStrictEqual(
      invalid("malformed-document", "$.folders"),
    );
  });
});

describe("the readers of a document's parts", () => {
  it("read a page's entry, an outline and a recording on their own", () => {
    expect(readPageInfo(NOTEBOOK.pages[0])).toStrictEqual(NOTEBOOK.pages[0]);
    expect(readOutline([{ id: "o", title: "x", page: "anywhere" }])).toStrictEqual([
      { id: "o", title: "x", page: "anywhere" },
    ]);
    const recording = { id: "r", audio, startedAt: 5, duration: 10 };
    expect(readRecording(recording)).toStrictEqual(recording);
  });

  it("name the place they're given in what they refuse", () => {
    expect(
      refusal(() => readPageInfo({ ...NOTEBOOK.pages[0], height: 0 }, "$.info")),
    ).toStrictEqual(invalid("invalid-size", "$.info.height"));
    expect(
      refusal(() =>
        readOutline(
          [
            { id: "o", title: "x", page: "p" },
            { id: "o", title: "y", page: "p" },
          ],
          "$.outline",
        ),
      ),
    ).toStrictEqual(invalid("duplicate-id", "$.outline[1].id"));
    expect(
      refusal(() => readRecording({ id: "r", audio, startedAt: 5, duration: -1 })),
    ).toStrictEqual(invalid("invalid-time", "$.duration"));
  });
});

describe("text with a lone surrogate", () => {
  // Half of a surrogate pair isn't text, and can't be written as UTF-8. The conformance
  // vectors hold none, so that every JSON library loads them (docs/formats/conformance.md):
  // these cases are here instead, one for each text a document holds.
  const HIGH = "\uD83D";
  const LOW = "\uDCD3";
  const LONE = [`a${HIGH}b`, `a${LOW}b`, `${LOW}${HIGH}`, `ok${HIGH}`, HIGH, LOW];
  const summary = {
    id: "nb",
    title: "Field notes",
    cover: "blue",
    template: "lined",
    folder: null,
    pageCount: 1,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
  const textItem = {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 30_000,
    text: "Check the units",
    size: 1_200,
    color: "#0b57d0",
  };
  const BACKUP = {
    format: "hm-notes-backup",
    version: 1,
    createdAt: 0,
    scope: "library",
    folders: [] as unknown[],
    notebooks: [] as unknown[],
  };

  /** Each text a document holds: its reader, the document with that text set, and its path. */
  const texts: readonly (readonly [string, (text: string) => unknown, string])[] = [
    ["a notebook's title", (title) => readNotesNotebookDocument({ ...NOTEBOOK, title }), "$.title"],
    [
      "an outline entry's title",
      (title) =>
        readNotesNotebookDocument({ ...NOTEBOOK, outline: [{ id: "o1", title, page: "p1" }] }),
      "$.outline[0].title",
    ],
    [
      "a text box's text",
      (text) =>
        readNotesPageDocument({
          format: "hm-notes-page",
          version: 1,
          id: "p1",
          items: [{ ...textItem, text }],
        }),
      "$.items[0].text",
    ],
    [
      "a folder's name, in a library",
      (name) =>
        readNotesLibraryDocument({ ...LIBRARY, folders: [{ ...folder("f1", null), name }] }),
      "$.folders[0].name",
    ],
    [
      "a notebook's title, in a library",
      (title) => readNotesLibraryDocument({ ...LIBRARY, notebooks: [{ ...summary, title }] }),
      "$.notebooks[0].title",
    ],
    [
      "a folder's name, in a backup's manifest",
      (name) => readNotesBackupManifest({ ...BACKUP, folders: [{ ...folder("f1", null), name }] }),
      "$.folders[0].name",
    ],
  ];

  it.each(texts)("is refused in %s", (_what, read, at) => {
    for (const text of LONE) {
      expect(
        refusal(() => read(text)),
        JSON.stringify(text),
      ).toStrictEqual(invalid("malformed-document", at));
    }
  });

  it.each(texts)("isn't mistaken for a whole pair in %s", (_what, read) => {
    // The same documents read with the pair the right way round, so only the lone half is wrong.
    expect(refusal(() => read(`a${HIGH}${LOW}b`))).toBeUndefined();
  });
});
