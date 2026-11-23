import type {
  ConformanceCase,
  ConformanceFile,
} from "@hussmartinez/sdk-config/testing/conformance";
import fc from "fast-check";
import {
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../../src/core/format/documents.js";
import {
  backupManifest,
  HOSTILE_NAMES,
  library,
  mutated,
  notebook,
  page,
  stateAndCommand,
} from "../arbitraries/notes.js";
import { applyToState, type NotesDocumentFormat, readAndWrite, toStateDocument } from "./run.js";

/**
 * Writes the conformance cases (sdk-core ADR 0045): hand-written cases for
 * every outcome a port must reproduce, and cases generated from the
 * property tests' generators with a fixed seed. The files in conformance/
 * are this module's output, checked in; `pnpm conformance:update` rewrites
 * them, and the tests fail when they're out of date.
 */

/** The seed of the generated cases. Changing it, or fast-check's version, rewrites them. */
const SEED = 45;
/** How many generated documents of each format the documents file keeps. */
const GENERATED_DOCUMENTS = 4;
/** How many generated commands of each type that apply, and of each refusal, the commands file keeps. */
const GENERATED_PER_TYPE = 2;
const GENERATED_PER_REFUSAL = 1;

/**
 * The text of a vector file: indented JSON, with a list of numbers on one
 * line, so a stroke's points read as a row. Negative zero is written as
 * `-0`, which `JSON.stringify` writes as `0`.
 */
export function print(value: unknown, indent = ""): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((entry) => typeof entry === "number")) {
      return `[${value.map((entry) => print(entry)).join(", ")}]`;
    }
    return `[\n${value.map((entry) => `${inner}${print(entry, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  if (entries.length === 0) return "{}";
  const lines = entries.map(
    ([name, entry]) => `${inner}${JSON.stringify(name)}: ${print(entry, inner)}`,
  );
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** The value as JSON carries it: what a port reads from the file. `__proto__` becomes an own field. */
const asJson = <T>(value: T): T => JSON.parse(print(value)) as T;

type Path = readonly (string | number)[];
type Json = Record<string | number, unknown>;

/** The object or list at a path inside a JSON value. */
function at(document: unknown, path: Path): Json {
  let target = document as Json;
  for (const step of path) target = target[step] as Json;
  return target;
}

/**
 * A copy of a document with the value at a path replaced, or added. The
 * field is an own property even when it's named `__proto__`, as
 * `JSON.parse` makes it (sdk-core ADR 0045, section 8).
 */
function set(document: unknown, path: Path, value: unknown): unknown {
  const copy = structuredClone(document);
  Object.defineProperty(at(copy, path.slice(0, -1)), path.at(-1) as string | number, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/** A copy of a document without the field at a path. */
function without(document: unknown, path: Path): unknown {
  const copy = structuredClone(document);
  delete at(copy, path.slice(0, -1))[path.at(-1) as string | number];
  return copy;
}

/** A copy of a document with every edit applied, in order. */
const change = (document: unknown, ...edits: readonly (readonly [Path, unknown])[]): unknown =>
  edits.reduce((result, [path, value]) => set(result, path, value), document);

type Outcome =
  | { readonly ok: true }
  | { readonly code: string; readonly reason?: string | undefined };

/**
 * A case whose expected result is what the runner gives. For a hand-written
 * case, `outcome` is what the case is meant to show, and a runner that
 * disagrees fails here, before any file is written.
 */
function make(
  name: string,
  input: unknown,
  run: (input: never) => unknown,
  outcome?: Outcome,
): ConformanceCase {
  const json = asJson(input);
  let expected: unknown;
  try {
    expected = asJson(run(structuredClone(json) as never));
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: string } };
    if (typeof code !== "string") throw error;
    expected = {
      error: { code, ...(typeof details?.reason === "string" ? { reason: details.reason } : {}) },
    };
  }
  if (outcome) {
    const got = (expected as { error?: Outcome }).error ?? { ok: true };
    if (JSON.stringify(got) !== JSON.stringify(outcome)) {
      throw new Error(
        `Case "${name}" gave ${JSON.stringify(got)}, not ${JSON.stringify(outcome)}.`,
      );
    }
  }
  return { name, input: json, expected };
}

/**
 * The cases, once no two share a name. A file with a name twice can't be
 * loaded, not even to rewrite it, so it must never be written.
 */
function distinct(cases: ConformanceCase[]): ConformanceCase[] {
  const names = new Set<string>();
  for (const { name } of cases) {
    if (names.has(name)) throw new Error(`Two cases are named "${name}".`);
    names.add(name);
  }
  return cases;
}

const applied: Outcome = { ok: true };
const invalid = (reason: string): Outcome => ({ code: "INVALID_DOCUMENT", reason });
const unsupported = (reason: string): Outcome => ({ code: "UNSUPPORTED_FORMAT", reason });
const refused = (reason: string): Outcome => ({ code: "INVALID_COMMAND", reason });
const overLimit = (code: string): Outcome => ({ code });

/** A character outside the BMP: one code point, two UTF-16 units. */
const EMOJI = "\u{1F4D3}";
/** Halves of a surrogate pair, which aren't text on their own. */
const HIGH = "\uD83D";
const LOW = "\uDCD3";

const sha = (pair: string) => `sha256:${pair.repeat(32)}`;
const pdfAsset = { asset: sha("0a"), mediaType: "application/pdf", size: 48_213 };
const audioAsset = { asset: sha("0b"), mediaType: "audio/webm", size: 120_000 };
const imageAsset = { asset: sha("0c"), mediaType: "image/png", size: 20_480 };

const stroke = (id: string, changes: object = {}) => ({
  id,
  type: "stroke",
  tool: "pen",
  color: "#1a1a1a",
  size: 200,
  points: [10_000, 12_000, 400, 10_400, 12_300, 650, 11_000, 12_500, 300],
  ...changes,
});
const textBox = (id: string, changes: object = {}) => ({
  id,
  type: "text",
  x: 8_000,
  y: 20_000,
  width: 30_000,
  text: "Check the units",
  size: 1_200,
  color: "#0b57d0",
  ...changes,
});
const image = (id: string, changes: object = {}) => ({
  id,
  type: "image",
  x: 5_000,
  y: 40_000,
  width: 24_000,
  height: 18_000,
  image: imageAsset,
  ...changes,
});
const link = (id: string, to: string, changes: object = {}) => ({
  id,
  type: "link",
  x: 40_000,
  y: 3_000,
  width: 12_000,
  height: 2_400,
  page: to,
  ...changes,
});
const pageInfo = (id: string, changes: object = {}) => ({
  id,
  width: 59_500,
  height: 84_200,
  template: "lined",
  ...changes,
});
const recording = (id: string, changes: object = {}) => ({
  id,
  audio: audioAsset,
  startedAt: 1_700_000_100_000,
  duration: 95_000,
  ...changes,
});
const folder = (id: string, parent: string | null, name = "Courses") => ({
  id,
  name,
  parent,
  createdAt: 1_700_000_000_000,
});
const summary = (id: string, inFolder: string | null, changes: object = {}) => ({
  id,
  title: "Field notes",
  cover: "blue",
  template: "lined",
  folder: inFolder,
  pageCount: 3,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_360_000,
  deletedAt: null,
  ...changes,
});

/** A notebook with every part set: three pages, one over a PDF, an outline and a recording. */
const NOTEBOOK = {
  format: "hm-notes-notebook",
  version: 1,
  id: "nb1",
  title: "Field notes",
  cover: "blue",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_360_000,
  pages: [
    pageInfo("p1"),
    pageInfo("p2", {
      width: 61_200,
      height: 79_200,
      template: "blank",
      background: { pdf: pdfAsset, pageIndex: 0 },
    }),
    pageInfo("p3", { template: "dotted" }),
  ],
  outline: [
    { id: "o1", title: "Week 1", page: "p1" },
    { id: "o2", title: "Handout", page: "p2" },
  ],
  recordings: [recording("r1")],
};

/** A page with one item of every kind, and a stroke with every optional field. */
const PAGE = {
  format: "hm-notes-page",
  version: 1,
  id: "p1",
  items: [
    stroke("s1"),
    stroke("s2", {
      tool: "highlighter",
      color: "#ffd54f",
      size: 1_600,
      points: [8_000, 20_600, 0, 38_000, 20_600, 0],
      uniform: true,
      audio: { recording: "r1", at: 12_500 },
    }),
    textBox("t1", { audio: { recording: "r1", at: 30_000 } }),
    image("i1"),
    link("l1", "p2"),
  ],
};

/** A library of two nested folders and two notebooks, one in the bin. */
const LIBRARY = {
  format: "hm-notes-library",
  version: 1,
  folders: [folder("f1", null), folder("f2", "f1", "Physics")],
  notebooks: [
    summary("nb1", "f2"),
    summary("nb2", null, {
      title: "Sketches",
      cover: "amber",
      template: "blank",
      pageCount: 1,
      deletedAt: 1_700_000_400_000,
    }),
  ],
  lastBackupAt: 1_700_000_200_000,
  lastChangeAt: 1_700_000_360_000,
};

/** The manifest of a backup of that library. */
const BACKUP = {
  format: "hm-notes-backup",
  version: 1,
  createdAt: 1_700_000_500_000,
  scope: "library",
  folders: [folder("f1", null), folder("f2", "f1", "Physics")],
  notebooks: [
    { id: "nb1", folder: "f2" },
    { id: "nb2", folder: null },
  ],
};

const [PROTO, CONSTRUCTOR, TO_STRING] = HOSTILE_NAMES;

/**
 * Documents whose ids, names and text are the names of `Object.prototype`'s
 * properties, which are valid ids here. A reader that keeps ids in a plain
 * object, in any language, must still treat them as data.
 */
const NAMED_NOTEBOOK = {
  ...NOTEBOOK,
  id: PROTO,
  title: CONSTRUCTOR,
  pages: [pageInfo(PROTO), pageInfo(CONSTRUCTOR), pageInfo(TO_STRING)],
  outline: [
    { id: PROTO, title: TO_STRING, page: TO_STRING },
    { id: CONSTRUCTOR, title: PROTO, page: PROTO },
    { id: TO_STRING, title: CONSTRUCTOR, page: CONSTRUCTOR },
  ],
  recordings: [recording(PROTO), recording(CONSTRUCTOR), recording(TO_STRING)],
};
const NAMED_PAGE = {
  ...PAGE,
  id: CONSTRUCTOR,
  items: [
    stroke(PROTO, { audio: { recording: CONSTRUCTOR, at: 0 } }),
    textBox(CONSTRUCTOR, { text: TO_STRING }),
    link(TO_STRING, PROTO),
  ],
};
const NAMED_LIBRARY = {
  ...LIBRARY,
  folders: [
    folder(PROTO, null, TO_STRING),
    folder(CONSTRUCTOR, PROTO, PROTO),
    folder(TO_STRING, CONSTRUCTOR, CONSTRUCTOR),
  ],
  notebooks: [
    summary(PROTO, TO_STRING, { title: CONSTRUCTOR }),
    summary(CONSTRUCTOR, PROTO, { title: TO_STRING }),
    summary(TO_STRING, CONSTRUCTOR, { title: PROTO }),
  ],
};
const NAMED_BACKUP = {
  ...BACKUP,
  folders: NAMED_LIBRARY.folders,
  notebooks: [
    { id: PROTO, folder: TO_STRING },
    { id: CONSTRUCTOR, folder: PROTO },
    { id: TO_STRING, folder: CONSTRUCTOR },
  ],
};

type DocumentCase = readonly [name: string, document: unknown, outcome: Outcome];

const SHORT: Readonly<Record<NotesDocumentFormat, string>> = {
  "hm-notes-notebook": "notebook",
  "hm-notes-page": "page",
  "hm-notes-library": "library",
  "hm-notes-backup": "backup",
};

/** What every format's reader does with the document's header and its top level. */
function headerCases(base: unknown, other: string): DocumentCase[] {
  return [
    ["reads a document unchanged", base, applied],
    ["refuses another format's name", set(base, ["format"], other), unsupported("unknown-format")],
    ["refuses a document with no format", without(base, ["format"]), unsupported("unknown-format")],
    [
      "refuses a format in capitals",
      set(base, ["format"], (base as { format: string }).format.toUpperCase()),
      unsupported("unknown-format"),
    ],
    ["refuses a format that isn't text", set(base, ["format"], 1), unsupported("unknown-format")],
    [
      "refuses a format only Object.prototype has",
      set(base, ["format"], "toString"),
      unsupported("unknown-format"),
    ],
    ["refuses a later version", set(base, ["version"], 2), unsupported("unknown-format-version")],
    ["refuses version 0", set(base, ["version"], 0), invalid("malformed-document")],
    ["refuses a negative version", set(base, ["version"], -1), invalid("malformed-document")],
    ["refuses a version as text", set(base, ["version"], "1"), invalid("malformed-document")],
    ["refuses a fractional version", set(base, ["version"], 1.5), invalid("malformed-document")],
    [
      "refuses a document with no version",
      without(base, ["version"]),
      invalid("malformed-document"),
    ],
    ["refuses a list", [base], invalid("malformed-document")],
    ["refuses null", null, invalid("malformed-document")],
    ["refuses text", "hm-notes", invalid("malformed-document")],
    ["refuses an unknown field", set(base, ["history"], []), invalid("malformed-document")],
    ...HOSTILE_NAMES.map(
      (name): DocumentCase => [
        `refuses an unknown field named ${name}`,
        set(base, [name], { polluted: true }),
        invalid("malformed-document"),
      ],
    ),
  ];
}

/** An unknown field in each object inside a document, named plainly and after Object.prototype's. */
function nestedFieldCases(
  base: unknown,
  objects: readonly (readonly [string, Path])[],
): DocumentCase[] {
  return objects.flatMap(([what, path], index): DocumentCase[] => {
    const hostile = HOSTILE_NAMES[index % HOSTILE_NAMES.length] as string;
    return [
      [
        `refuses an unknown field in ${what}`,
        set(base, [...path, "note"], "x"),
        invalid("malformed-document"),
      ],
      [
        `refuses a field named ${hostile} in ${what}`,
        set(base, [...path, hostile], { polluted: true }),
        invalid("malformed-document"),
      ],
    ];
  });
}

/** Ids a reader refuses. A trailing line break catches a pattern whose `$` matches before one. */
const BAD_IDS: readonly (readonly [string, unknown])[] = [
  ["an empty id", ""],
  ["an id of 65 characters", "a".repeat(65)],
  ["an id with a space", "a b"],
  ["an id with a dot", "a.b"],
  ["an id that ends with a line break", "p1\n"],
  ["an id with a letter outside ASCII", "caf\u00E9"],
  ["an id that's a number", 7],
  ["an id that's null", null],
];

const BAD_ASSET_NAMES: readonly (readonly [string, unknown])[] = [
  ["an asset name in capitals", `sha256:${"0A".repeat(32)}`],
  ["an asset name of 63 digits", `sha256:${"0".repeat(63)}`],
  ["an asset name of 65 digits", `sha256:${"0".repeat(65)}`],
  ["an asset name of another hash", `md5:${"0".repeat(32)}`],
  ["an asset name without its prefix", "0a".repeat(32)],
  ["an asset name that ends with a line break", `${sha("0a")}\n`],
  ["an asset name that's a number", 0],
];

const BAD_COLORS: readonly (readonly [string, unknown])[] = [
  ["a colour in capitals", "#FFD54F"],
  ["a short colour", "#fff"],
  ["a colour by name", "red"],
  ["a colour with a digit that isn't hexadecimal", "#12345g"],
  ["a colour with transparency", "#ffd54f80"],
  ["a colour that ends with a line break", "#ffd54f\n"],
  ["a colour that's a number", 0],
];

const LONE_SURROGATES: readonly (readonly [string, string])[] = [
  ["a high surrogate on its own", `a${HIGH}b`],
  ["a low surrogate on its own", `a${LOW}b`],
  ["a surrogate pair the wrong way round", `${LOW}${HIGH}`],
  ["a high surrogate at the end", `ok${HIGH}`],
];

function notebookCases(): DocumentCase[] {
  const base = NOTEBOOK;
  return [
    ...headerCases(base, "hm-notes-page"),
    ...nestedFieldCases(base, [
      ["a page", ["pages", 0]],
      ["a page's background", ["pages", 1, "background"]],
      ["a background's asset", ["pages", 1, "background", "pdf"]],
      ["an outline entry", ["outline", 0]],
      ["a recording", ["recordings", 0]],
      ["a recording's asset", ["recordings", 0, "audio"]],
    ]),
    ["reads ids and titles named __proto__, constructor and toString", NAMED_NOTEBOOK, applied],
    [
      "reads a notebook of one page, with no outline and no recordings",
      change(base, [["pages"], [pageInfo("p1")]], [["outline"], []], [["recordings"], []]),
      applied,
    ],
    ["reads an empty title", set(base, ["title"], ""), applied],
    ["reads an id of 64 characters", set(base, ["id"], "a".repeat(64)), applied],
    ["reads an id of every kind of character", set(base, ["id"], "A-Z_a-z_0-9"), applied],
    ["refuses a missing field", without(base, ["outline"]), invalid("malformed-document")],
    [
      "refuses a missing field in a page",
      without(base, ["pages", 0, "template"]),
      invalid("malformed-document"),
    ],
    [
      "refuses a notebook with no pages",
      change(base, [["pages"], []], [["outline"], []]),
      invalid("malformed-document"),
    ],
    [
      "refuses pages that aren't a list",
      set(base, ["pages"], { p1: pageInfo("p1") }),
      invalid("malformed-document"),
    ],
    [
      "refuses a page that isn't an object",
      set(base, ["pages", 0], "p1"),
      invalid("malformed-document"),
    ],
    ["refuses a title that isn't text", set(base, ["title"], 7), invalid("malformed-document")],
    ["refuses a title that's null", set(base, ["title"], null), invalid("malformed-document")],
    ["refuses an unknown cover", set(base, ["cover"], "pink"), invalid("malformed-document")],
    [
      "refuses a cover only Object.prototype has",
      set(base, ["cover"], CONSTRUCTOR),
      invalid("malformed-document"),
    ],
    [
      "refuses an unknown template",
      set(base, ["pages", 0, "template"], "music"),
      invalid("malformed-document"),
    ],
    [
      "refuses a template only Object.prototype has",
      set(base, ["pages", 0, "template"], TO_STRING),
      invalid("malformed-document"),
    ],
    ...BAD_IDS.flatMap(([what, value]): DocumentCase[] => [
      [`refuses ${what} for the notebook`, set(base, ["id"], value), invalid("invalid-id")],
      [`refuses ${what} for a page`, set(base, ["pages", 2, "id"], value), invalid("invalid-id")],
    ]),
    [
      "refuses an outline entry with an invalid id",
      set(base, ["outline", 0, "id"], "o 1"),
      invalid("invalid-id"),
    ],
    [
      "refuses an outline entry whose page is an invalid id",
      set(base, ["outline", 0, "page"], ""),
      invalid("invalid-id"),
    ],
    [
      "refuses a recording with an invalid id",
      set(base, ["recordings", 0, "id"], "r/1"),
      invalid("invalid-id"),
    ],
    ["refuses two pages with one id", set(base, ["pages", 2, "id"], "p1"), invalid("duplicate-id")],
    [
      "refuses two outline entries with one id",
      set(base, ["outline", 1, "id"], "o1"),
      invalid("duplicate-id"),
    ],
    [
      "refuses two recordings with one id",
      set(base, ["recordings", 1], recording("r1")),
      invalid("duplicate-id"),
    ],
    [
      "reads an outline entry, a page and a recording that share an id",
      change(base, [["outline", 0, "id"], "p1"], [["recordings", 0, "id"], "p1"]),
      applied,
    ],
    [
      "reads two outline entries that lead to one page",
      set(base, ["outline", 1, "page"], "p1"),
      applied,
    ],
    [
      "refuses an outline entry that leads to an unknown page",
      set(base, ["outline", 0, "page"], "p9"),
      invalid("unknown-page"),
    ],
    [
      "refuses an outline entry that leads to a page only Object.prototype has",
      set(base, ["outline", 0, "page"], "hasOwnProperty"),
      invalid("unknown-page"),
    ],
    ...HOSTILE_NAMES.map(
      (name): DocumentCase => [
        `refuses an outline entry that leads to ${name}, which isn't a page`,
        set(base, ["outline", 0, "page"], name),
        invalid("unknown-page"),
      ],
    ),
    [
      "reads a page of the smallest size",
      change(base, [["pages", 0, "width"], 7_200], [["pages", 0, "height"], 7_200]),
      applied,
    ],
    [
      "reads a page of the largest size",
      change(base, [["pages", 0, "width"], 1_440_000], [["pages", 0, "height"], 1_440_000]),
      applied,
    ],
    [
      "refuses a page narrower than an inch",
      set(base, ["pages", 0, "width"], 7_199),
      invalid("invalid-size"),
    ],
    [
      "refuses a page taller than 200 inches",
      set(base, ["pages", 0, "height"], 1_440_001),
      invalid("invalid-size"),
    ],
    [
      "refuses a fractional page width",
      set(base, ["pages", 0, "width"], 59_500.5),
      invalid("invalid-size"),
    ],
    [
      "refuses a page width as text",
      set(base, ["pages", 0, "width"], "59500"),
      invalid("invalid-size"),
    ],
    [
      "refuses a negative page index",
      set(base, ["pages", 1, "background", "pageIndex"], -1),
      invalid("malformed-document"),
    ],
    [
      "refuses a fractional page index",
      set(base, ["pages", 1, "background", "pageIndex"], 0.5),
      invalid("malformed-document"),
    ],
    [
      "refuses a page index over 1,000,000",
      set(base, ["pages", 1, "background", "pageIndex"], 1_000_001),
      invalid("malformed-document"),
    ],
    [
      "reads a page index of 1,000,000",
      set(base, ["pages", 1, "background", "pageIndex"], 1_000_000),
      applied,
    ],
    [
      "reads negative zero as zero",
      change(
        base,
        [["createdAt"], -0],
        [["pages", 1, "background", "pageIndex"], -0],
        [["recordings", 0, "duration"], -0],
      ),
      applied,
    ],
    ["reads the last time a date holds", set(base, ["updatedAt"], 8_640_000_000_000_000), applied],
    [
      "refuses a time after the last a date holds",
      set(base, ["updatedAt"], 8_640_000_000_000_001),
      invalid("invalid-time"),
    ],
    ["refuses a negative time", set(base, ["createdAt"], -1), invalid("invalid-time")],
    [
      "refuses a fractional time",
      set(base, ["createdAt"], 1_700_000_000_000.5),
      invalid("invalid-time"),
    ],
    [
      "refuses a time as text",
      set(base, ["createdAt"], "2023-11-14T22:13:20Z"),
      invalid("invalid-time"),
    ],
    ["refuses a time that's null", set(base, ["createdAt"], null), invalid("invalid-time")],
    [
      "refuses a negative duration",
      set(base, ["recordings", 0, "duration"], -1),
      invalid("invalid-time"),
    ],
    [
      "refuses a fractional start of a recording",
      set(base, ["recordings", 0, "startedAt"], 0.25),
      invalid("invalid-time"),
    ],
    [
      "reads a title of 200 code points outside the BMP, which are 400 UTF-16 units",
      set(base, ["title"], EMOJI.repeat(200)),
      applied,
    ],
    [
      "refuses a title of 201 code points outside the BMP",
      set(base, ["title"], EMOJI.repeat(201)),
      invalid("text-too-long"),
    ],
    [
      "refuses a title of 201 letters",
      set(base, ["title"], "a".repeat(201)),
      invalid("text-too-long"),
    ],
    [
      "refuses an outline title of 201 code points",
      set(base, ["outline", 0, "title"], EMOJI.repeat(201)),
      invalid("text-too-long"),
    ],
    ...LONE_SURROGATES.map(
      ([what, value]): DocumentCase => [
        `refuses a title with ${what}`,
        set(base, ["title"], value),
        invalid("malformed-document"),
      ],
    ),
    [
      "refuses an outline title with a lone surrogate",
      set(base, ["outline", 0, "title"], HIGH),
      invalid("malformed-document"),
    ],
    ...BAD_ASSET_NAMES.map(
      ([what, value]): DocumentCase => [
        `refuses ${what} for a PDF`,
        set(base, ["pages", 1, "background", "pdf", "asset"], value),
        invalid("invalid-asset"),
      ],
    ),
    [
      "refuses a recording's asset name in capitals",
      set(base, ["recordings", 0, "audio", "asset"], `SHA256:${"0b".repeat(32)}`),
      invalid("invalid-asset"),
    ],
    [
      "refuses a background that's a picture",
      set(base, ["pages", 1, "background", "pdf", "mediaType"], "image/png"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a media type in capitals",
      set(base, ["pages", 1, "background", "pdf", "mediaType"], "Application/PDF"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a media type only Object.prototype has",
      set(base, ["pages", 1, "background", "pdf", "mediaType"], PROTO),
      invalid("invalid-asset"),
    ],
    [
      "refuses a media type that isn't text",
      set(base, ["pages", 1, "background", "pdf", "mediaType"], null),
      invalid("invalid-asset"),
    ],
    [
      "refuses a recording of an unknown media type",
      set(base, ["recordings", 0, "audio", "mediaType"], "audio/mpeg"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a media type with a parameter",
      set(base, ["recordings", 0, "audio", "mediaType"], "audio/webm;codecs=opus"),
      invalid("invalid-asset"),
    ],
    ...["audio/mp4", "audio/ogg", "audio/wav"].map(
      (type): DocumentCase => [
        `reads a recording of type ${type}`,
        set(base, ["recordings", 0, "audio", "mediaType"], type),
        applied,
      ],
    ),
    ["reads an asset of no bytes", set(base, ["recordings", 0, "audio", "size"], 0), applied],
    [
      "reads an asset of the largest whole number of bytes",
      set(base, ["recordings", 0, "audio", "size"], Number.MAX_SAFE_INTEGER),
      applied,
    ],
    [
      "refuses an asset of a negative size",
      set(base, ["recordings", 0, "audio", "size"], -1),
      invalid("invalid-asset"),
    ],
    [
      "refuses an asset of a fractional size",
      set(base, ["recordings", 0, "audio", "size"], 0.5),
      invalid("invalid-asset"),
    ],
    [
      "refuses an asset size past the largest exact whole number",
      set(base, ["recordings", 0, "audio", "size"], 2 ** 53),
      invalid("invalid-asset"),
    ],
    [
      "refuses an asset without its size",
      without(base, ["recordings", 0, "audio", "size"]),
      invalid("malformed-document"),
    ],
    [
      "refuses an asset that's its name alone",
      set(base, ["recordings", 0, "audio"], sha("0b")),
      invalid("malformed-document"),
    ],
  ];
}

function pageCases(): DocumentCase[] {
  const base = PAGE;
  const points = (value: unknown) => set(base, ["items", 0, "points"], value);
  return [
    ...headerCases(base, "hm-notes-notebook"),
    ...nestedFieldCases(base, [
      ["a stroke", ["items", 0]],
      ["an audio anchor", ["items", 1, "audio"]],
      ["a text box", ["items", 2]],
      ["a picture", ["items", 3]],
      ["a picture's asset", ["items", 3, "image"]],
      ["a link", ["items", 4]],
    ]),
    [
      "reads ids, text, a link and an anchor named __proto__, constructor and toString",
      NAMED_PAGE,
      applied,
    ],
    ["reads a page with no items", set(base, ["items"], []), applied],
    [
      "reads a link to a page and an anchor to a recording the page can't know of",
      change(
        base,
        [["items", 4, "page"], "elsewhere"],
        [["items", 1, "audio", "recording"], "unknown"],
      ),
      applied,
    ],
    ["refuses a missing field", without(base, ["items"]), invalid("malformed-document")],
    [
      "refuses items that aren't a list",
      set(base, ["items"], { s1: stroke("s1") }),
      invalid("malformed-document"),
    ],
    [
      "refuses an item that isn't an object",
      set(base, ["items", 0], "s1"),
      invalid("malformed-document"),
    ],
    [
      "refuses an item that's a list",
      set(base, ["items", 0], [stroke("s1")]),
      invalid("malformed-document"),
    ],
    [
      "refuses an item with no type",
      without(base, ["items", 0, "type"]),
      invalid("malformed-document"),
    ],
    [
      "refuses an unknown item type",
      set(base, ["items", 0, "type"], "shape"),
      invalid("malformed-document"),
    ],
    [
      "refuses an item type only Object.prototype has",
      set(base, ["items", 0, "type"], TO_STRING),
      invalid("malformed-document"),
    ],
    [
      "refuses a stroke with a text box's fields",
      set(base, ["items", 2, "type"], "stroke"),
      invalid("malformed-document"),
    ],
    [
      "refuses a missing field in an item",
      without(base, ["items", 2, "width"]),
      invalid("malformed-document"),
    ],
    ...BAD_IDS.flatMap(([what, value]): DocumentCase[] => [
      [`refuses ${what} for the page`, set(base, ["id"], value), invalid("invalid-id")],
      [`refuses ${what} for an item`, set(base, ["items", 3, "id"], value), invalid("invalid-id")],
    ]),
    [
      "refuses a link whose page is an invalid id",
      set(base, ["items", 4, "page"], "p 2"),
      invalid("invalid-id"),
    ],
    [
      "refuses an anchor whose recording is an invalid id",
      set(base, ["items", 1, "audio", "recording"], ""),
      invalid("invalid-id"),
    ],
    ["refuses two items with one id", set(base, ["items", 4, "id"], "s1"), invalid("duplicate-id")],
    [
      "refuses two items named __proto__",
      change(base, [["items", 0, "id"], PROTO], [["items", 3, "id"], PROTO]),
      invalid("duplicate-id"),
    ],
    ["reads an item with the page's id", set(base, ["items", 0, "id"], "p1"), applied],
    // Strokes.
    ["reads a stroke of one point", points([0, 0, 0]), applied],
    [
      "reads points at the ends of their ranges",
      points([-1_440_000, -1_440_000, 0, 2_880_000, 2_880_000, 1_000]),
      applied,
    ],
    ["reads negative zero in points as zero", points([-0, -0, -0, 100, 100, 500]), applied],
    ["refuses a stroke with no points", points([]), invalid("invalid-points")],
    [
      "refuses points that aren't whole triples",
      points([0, 0, 500, 100]),
      invalid("invalid-points"),
    ],
    ["refuses a point with no pressure", points([0, 0]), invalid("invalid-points")],
    [
      "refuses points as pairs of objects",
      points([{ x: 0, y: 0, pressure: 500 }]),
      invalid("invalid-points"),
    ],
    ["refuses points that aren't a list", points("0,0,500"), invalid("invalid-points")],
    ["refuses a pressure over 1,000", points([0, 0, 1_001]), invalid("invalid-points")],
    ["refuses a negative pressure", points([0, 0, -1]), invalid("invalid-points")],
    ["refuses a fractional pressure", points([0, 0, 0.5]), invalid("invalid-points")],
    [
      "refuses a point too far left of the page",
      points([-1_440_001, 0, 500]),
      invalid("invalid-points"),
    ],
    [
      "refuses a point too far below the page",
      points([0, 2_880_001, 500]),
      invalid("invalid-points"),
    ],
    ["refuses a fractional position in points", points([0.5, 0, 500]), invalid("invalid-points")],
    ["refuses a point that's text", points(["0", 0, 500]), invalid("invalid-points")],
    ["refuses a point that's null", points([0, null, 500]), invalid("invalid-points")],
    [
      "refuses a stroke of 20,001 points",
      points(new Array(60_003).fill(0)),
      invalid("too-many-points"),
    ],
    [
      "reads the thinnest and the thickest stroke",
      change(base, [["items", 0, "size"], 10], [["items", 1, "size"], 7_200]),
      applied,
    ],
    [
      "refuses a stroke thinner than 10 units",
      set(base, ["items", 0, "size"], 9),
      invalid("invalid-size"),
    ],
    [
      "refuses a stroke thicker than 7,200 units",
      set(base, ["items", 0, "size"], 7_201),
      invalid("invalid-size"),
    ],
    [
      "refuses a fractional stroke size",
      set(base, ["items", 0, "size"], 200.5),
      invalid("invalid-size"),
    ],
    [
      "refuses an unknown tool",
      set(base, ["items", 0, "tool"], "pencil"),
      invalid("malformed-document"),
    ],
    [
      "refuses a tool only Object.prototype has",
      set(base, ["items", 0, "tool"], CONSTRUCTOR),
      invalid("malformed-document"),
    ],
    [
      "refuses uniform set to false",
      set(base, ["items", 0, "uniform"], false),
      invalid("malformed-document"),
    ],
    [
      "refuses uniform set to 1",
      set(base, ["items", 0, "uniform"], 1),
      invalid("malformed-document"),
    ],
    ...BAD_COLORS.map(
      ([what, value]): DocumentCase => [
        `refuses ${what}`,
        set(base, ["items", 0, "color"], value),
        invalid("invalid-color"),
      ],
    ),
    [
      "refuses a colour only Object.prototype has",
      set(base, ["items", 2, "color"], PROTO),
      invalid("invalid-color"),
    ],
    [
      "reads an anchor at the start of its recording",
      set(base, ["items", 1, "audio", "at"], 0),
      applied,
    ],
    [
      "refuses an anchor before its recording",
      set(base, ["items", 1, "audio", "at"], -1),
      invalid("invalid-time"),
    ],
    [
      "refuses a fractional anchor",
      set(base, ["items", 1, "audio", "at"], 12.5),
      invalid("invalid-time"),
    ],
    [
      "refuses an anchor that's null",
      set(base, ["items", 1, "audio"], null),
      invalid("malformed-document"),
    ],
    // Text boxes, pictures and links.
    [
      "reads positions at the ends of their range",
      change(base, [["items", 2, "x"], -1_440_000], [["items", 2, "y"], 2_880_000]),
      applied,
    ],
    [
      "reads negative zero in a position as zero",
      change(base, [["items", 2, "x"], -0], [["items", 3, "y"], -0]),
      applied,
    ],
    [
      "refuses a position too far left of the page",
      set(base, ["items", 2, "x"], -1_440_001),
      invalid("invalid-position"),
    ],
    [
      "refuses a position too far below the page",
      set(base, ["items", 3, "y"], 2_880_001),
      invalid("invalid-position"),
    ],
    [
      "refuses a fractional position",
      set(base, ["items", 4, "x"], 40_000.5),
      invalid("invalid-position"),
    ],
    [
      "refuses a position as text",
      set(base, ["items", 4, "y"], "3000"),
      invalid("invalid-position"),
    ],
    [
      "reads the smallest and the largest width",
      change(base, [["items", 2, "width"], 1], [["items", 3, "width"], 2_880_000]),
      applied,
    ],
    ["refuses a width of 0", set(base, ["items", 2, "width"], 0), invalid("invalid-size")],
    [
      "refuses a negative height",
      set(base, ["items", 3, "height"], -18_000),
      invalid("invalid-size"),
    ],
    [
      "refuses a height over 2,880,000 units",
      set(base, ["items", 4, "height"], 2_880_001),
      invalid("invalid-size"),
    ],
    ["refuses a fractional width", set(base, ["items", 4, "width"], 0.5), invalid("invalid-size")],
    [
      "reads the smallest and the largest text size",
      set(base, ["items"], [textBox("a", { size: 400 }), textBox("b", { size: 28_800 })]),
      applied,
    ],
    [
      "refuses a text size under 400 units",
      set(base, ["items", 2, "size"], 399),
      invalid("invalid-size"),
    ],
    [
      "refuses a text size over 28,800 units",
      set(base, ["items", 2, "size"], 28_801),
      invalid("invalid-size"),
    ],
    ["reads empty text", set(base, ["items", 2, "text"], ""), applied],
    [
      "reads text that looks like markup, as text",
      set(base, ["items", 2, "text"], "<img src=x onerror=alert(1)>"),
      applied,
    ],
    [
      "reads text of 20,000 code points outside the BMP, which are 40,000 UTF-16 units",
      set(base, ["items"], [textBox("t1", { text: EMOJI.repeat(20_000) })]),
      applied,
    ],
    [
      "refuses text of 20,001 code points outside the BMP",
      set(base, ["items"], [textBox("t1", { text: EMOJI.repeat(20_001) })]),
      invalid("text-too-long"),
    ],
    [
      "refuses text that isn't text",
      set(base, ["items", 2, "text"], ["Check"]),
      invalid("malformed-document"),
    ],
    ...LONE_SURROGATES.map(
      ([what, value]): DocumentCase => [
        `refuses text with ${what}`,
        set(base, ["items", 2, "text"], value),
        invalid("malformed-document"),
      ],
    ),
    ...["image/jpeg", "image/webp", "image/gif"].map(
      (type): DocumentCase => [
        `reads a picture of type ${type}`,
        set(base, ["items", 3, "image", "mediaType"], type),
        applied,
      ],
    ),
    [
      "refuses an SVG picture, which can carry scripts",
      set(base, ["items", 3, "image", "mediaType"], "image/svg+xml"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture of an unknown media type",
      set(base, ["items", 3, "image", "mediaType"], "image/bmp"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture that's a PDF",
      set(base, ["items", 3, "image", "mediaType"], "application/pdf"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture's media type in capitals",
      set(base, ["items", 3, "image", "mediaType"], "IMAGE/PNG"),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture's media type with a parameter",
      set(base, ["items", 3, "image", "mediaType"], "image/png; charset=binary"),
      invalid("invalid-asset"),
    ],
    [
      "refuses an empty media type",
      set(base, ["items", 3, "image", "mediaType"], ""),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture's media type only Object.prototype has",
      set(base, ["items", 3, "image", "mediaType"], TO_STRING),
      invalid("invalid-asset"),
    ],
    ...BAD_ASSET_NAMES.map(
      ([what, value]): DocumentCase => [
        `refuses ${what} for a picture`,
        set(base, ["items", 3, "image", "asset"], value),
        invalid("invalid-asset"),
      ],
    ),
    [
      "refuses a picture's asset name only Object.prototype has",
      set(base, ["items", 3, "image", "asset"], CONSTRUCTOR),
      invalid("invalid-asset"),
    ],
    [
      "refuses a picture with its bytes inline",
      set(base, ["items", 3, "image"], "data:image/png;base64,iVBORw0KGgo="),
      invalid("malformed-document"),
    ],
  ];
}

function libraryCases(): DocumentCase[] {
  const base = LIBRARY;
  return [
    ...headerCases(base, "hm-notes-backup"),
    ...nestedFieldCases(base, [
      ["a folder", ["folders", 0]],
      ["a notebook", ["notebooks", 0]],
    ]),
    [
      "reads ids, names and titles named __proto__, constructor and toString",
      NAMED_LIBRARY,
      applied,
    ],
    [
      "reads an empty library",
      { ...base, folders: [], notebooks: [], lastBackupAt: null, lastChangeAt: null },
      applied,
    ],
    [
      "reads a folder listed before the folder it's in",
      set(base, ["folders"], [folder("f2", "f1", "Physics"), folder("f1", null)]),
      applied,
    ],
    [
      "reads a folder and a notebook that share an id",
      set(base, ["notebooks", 1, "id"], "f1"),
      applied,
    ],
    ["refuses a missing field", without(base, ["lastChangeAt"]), invalid("malformed-document")],
    [
      "refuses a folder with no parent field",
      without(base, ["folders", 0, "parent"]),
      invalid("malformed-document"),
    ],
    [
      "refuses folders that aren't a list",
      set(base, ["folders"], {}),
      invalid("malformed-document"),
    ],
    [
      "refuses two folders with one id",
      set(base, ["folders", 1, "id"], "f1"),
      invalid("duplicate-id"),
    ],
    [
      "refuses two notebooks with one id",
      set(base, ["notebooks", 1, "id"], "nb1"),
      invalid("duplicate-id"),
    ],
    [
      "refuses a folder inside an unknown folder",
      set(base, ["folders", 0, "parent"], "f9"),
      invalid("unknown-folder"),
    ],
    ...HOSTILE_NAMES.map(
      (name): DocumentCase => [
        `refuses a folder inside ${name}, which isn't a folder`,
        set(base, ["folders", 0, "parent"], name),
        invalid("unknown-folder"),
      ],
    ),
    [
      "refuses a folder inside itself",
      set(base, ["folders", 0, "parent"], "f1"),
      invalid("unknown-folder"),
    ],
    [
      "refuses two folders inside each other",
      set(base, ["folders", 0, "parent"], "f2"),
      invalid("unknown-folder"),
    ],
    [
      "refuses a ring of three folders",
      set(base, ["folders"], [folder("f1", "f3"), folder("f2", "f1"), folder("f3", "f2")]),
      invalid("unknown-folder"),
    ],
    [
      "refuses a folder that leads into a ring",
      set(
        base,
        ["folders"],
        [folder("f0", null), folder("f1", "f2"), folder("f2", "f1"), folder("f3", "f1")],
      ),
      invalid("unknown-folder"),
    ],
    [
      "refuses a notebook in an unknown folder",
      set(base, ["notebooks", 0, "folder"], "f9"),
      invalid("unknown-folder"),
    ],
    [
      "refuses a notebook in a folder only Object.prototype has",
      set(base, ["notebooks", 0, "folder"], "hasOwnProperty"),
      invalid("unknown-folder"),
    ],
    [
      "refuses a folder whose parent is an invalid id",
      set(base, ["folders", 1, "parent"], ""),
      invalid("invalid-id"),
    ],
    [
      "refuses a notebook whose folder is an invalid id",
      set(base, ["notebooks", 0, "folder"], "f 2"),
      invalid("invalid-id"),
    ],
    ...BAD_IDS.filter(([, value]) => value !== null).map(
      ([what, value]): DocumentCase => [
        `refuses ${what} for a folder`,
        set(base, ["folders", 1, "id"], value),
        invalid("invalid-id"),
      ],
    ),
    [
      "refuses an id that's null for a folder",
      set(base, ["folders", 1, "id"], null),
      invalid("invalid-id"),
    ],
    [
      "reads a notebook of 100,000 pages",
      set(base, ["notebooks", 0, "pageCount"], 100_000),
      applied,
    ],
    [
      "refuses a notebook of no pages",
      set(base, ["notebooks", 0, "pageCount"], 0),
      invalid("malformed-document"),
    ],
    [
      "refuses a notebook of 100,001 pages",
      set(base, ["notebooks", 0, "pageCount"], 100_001),
      invalid("malformed-document"),
    ],
    [
      "refuses a fractional page count",
      set(base, ["notebooks", 0, "pageCount"], 2.5),
      invalid("malformed-document"),
    ],
    [
      "reads negative zero as zero",
      change(
        base,
        [["lastBackupAt"], -0],
        [["folders", 0, "createdAt"], -0],
        [["notebooks", 0, "deletedAt"], -0],
      ),
      applied,
    ],
    [
      "refuses a negative time of the last backup",
      set(base, ["lastBackupAt"], -1),
      invalid("invalid-time"),
    ],
    [
      "refuses a fractional time of the last change",
      set(base, ["lastChangeAt"], 0.5),
      invalid("invalid-time"),
    ],
    [
      "refuses a time in the bin as text",
      set(base, ["notebooks", 1, "deletedAt"], "yesterday"),
      invalid("invalid-time"),
    ],
    [
      "refuses false for a time that may be null",
      set(base, ["lastBackupAt"], false),
      invalid("invalid-time"),
    ],
    [
      "refuses an unknown cover",
      set(base, ["notebooks", 0, "cover"], PROTO),
      invalid("malformed-document"),
    ],
    [
      "refuses an unknown template",
      set(base, ["notebooks", 0, "template"], CONSTRUCTOR),
      invalid("malformed-document"),
    ],
    [
      "reads a folder name of 200 code points outside the BMP",
      set(base, ["folders", 0, "name"], EMOJI.repeat(200)),
      applied,
    ],
    [
      "refuses a folder name of 201 code points outside the BMP",
      set(base, ["folders", 0, "name"], EMOJI.repeat(201)),
      invalid("text-too-long"),
    ],
    [
      "refuses a notebook title of 201 code points",
      set(base, ["notebooks", 0, "title"], EMOJI.repeat(201)),
      invalid("text-too-long"),
    ],
    ...LONE_SURROGATES.map(
      ([what, value]): DocumentCase => [
        `refuses a folder name with ${what}`,
        set(base, ["folders", 0, "name"], value),
        invalid("malformed-document"),
      ],
    ),
    [
      "refuses a notebook title with a lone surrogate",
      set(base, ["notebooks", 0, "title"], LOW),
      invalid("malformed-document"),
    ],
  ];
}

function backupCases(): DocumentCase[] {
  const base = BACKUP;
  return [
    ...headerCases(base, "hm-notes-library"),
    ...nestedFieldCases(base, [
      ["a folder", ["folders", 0]],
      ["a notebook", ["notebooks", 0]],
    ]),
    ["reads ids and names named __proto__, constructor and toString", NAMED_BACKUP, applied],
    [
      "reads a backup of chosen notebooks, with no folders",
      { ...base, scope: "notebooks", folders: [], notebooks: [{ id: "nb1", folder: null }] },
      applied,
    ],
    ["reads a backup of an empty library", { ...base, folders: [], notebooks: [] }, applied],
    ["refuses a missing field", without(base, ["scope"]), invalid("malformed-document")],
    ["refuses an unknown scope", set(base, ["scope"], "folder"), invalid("malformed-document")],
    [
      "refuses a scope only Object.prototype has",
      set(base, ["scope"], TO_STRING),
      invalid("malformed-document"),
    ],
    [
      "refuses a notebook with its title, which the manifest doesn't hold",
      set(base, ["notebooks", 0, "title"], "Field notes"),
      invalid("malformed-document"),
    ],
    [
      "refuses a notebook that's its id alone",
      set(base, ["notebooks", 0], "nb1"),
      invalid("malformed-document"),
    ],
    [
      "refuses two notebooks with one id",
      set(base, ["notebooks", 1, "id"], "nb1"),
      invalid("duplicate-id"),
    ],
    [
      "refuses two folders with one id",
      set(base, ["folders", 1, "id"], "f1"),
      invalid("duplicate-id"),
    ],
    [
      "refuses a notebook in an unknown folder",
      set(base, ["notebooks", 0, "folder"], "f9"),
      invalid("unknown-folder"),
    ],
    ...HOSTILE_NAMES.map(
      (name): DocumentCase => [
        `refuses a notebook in ${name}, which isn't a folder`,
        set(base, ["notebooks", 0, "folder"], name),
        invalid("unknown-folder"),
      ],
    ),
    [
      "refuses a folder inside an unknown folder",
      set(base, ["folders", 0, "parent"], "f9"),
      invalid("unknown-folder"),
    ],
    [
      "refuses a folder inside itself",
      set(base, ["folders", 1, "parent"], "f2"),
      invalid("unknown-folder"),
    ],
    [
      "refuses two folders inside each other",
      set(base, ["folders", 0, "parent"], "f2"),
      invalid("unknown-folder"),
    ],
    [
      "refuses a notebook with an invalid id",
      set(base, ["notebooks", 0, "id"], "../nb1"),
      invalid("invalid-id"),
    ],
    [
      "refuses a notebook whose folder is an invalid id",
      set(base, ["notebooks", 0, "folder"], 2),
      invalid("invalid-id"),
    ],
    ["reads negative zero as zero", set(base, ["createdAt"], -0), applied],
    ["refuses a negative time", set(base, ["createdAt"], -1), invalid("invalid-time")],
    ["refuses a fractional time", set(base, ["createdAt"], 0.5), invalid("invalid-time")],
    ["refuses a time that's null", set(base, ["createdAt"], null), invalid("invalid-time")],
    [
      "refuses a folder name of 201 code points outside the BMP",
      set(base, ["folders", 0, "name"], EMOJI.repeat(201)),
      invalid("text-too-long"),
    ],
    [
      "refuses a folder name with a lone surrogate",
      set(base, ["folders", 0, "name"], `${HIGH}x`),
      invalid("malformed-document"),
    ],
  ];
}

/** `hm-notes-documents`: a document read as one format, checked and written back. */
export function documentCases(): ConformanceFile {
  const handWritten: readonly (readonly [NotesDocumentFormat, DocumentCase[]])[] = [
    ["hm-notes-notebook", notebookCases()],
    ["hm-notes-page", pageCases()],
    ["hm-notes-library", libraryCases()],
    ["hm-notes-backup", backupCases()],
  ];
  const sample = <T>(arbitrary: fc.Arbitrary<T>): T[] =>
    fc.sample(arbitrary, { seed: SEED, numRuns: GENERATED_DOCUMENTS });
  const generated: readonly (readonly [NotesDocumentFormat, unknown[]])[] = [
    ["hm-notes-notebook", sample(notebook).map(toNotesNotebookDocument)],
    ["hm-notes-page", sample(page).map(toNotesPageDocument)],
    ["hm-notes-library", sample(library).map(toNotesLibraryDocument)],
    ["hm-notes-backup", sample(backupManifest)],
  ];
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-notes-documents",
    description:
      "notes-sdk's documents (docs/formats/conformance.md). input.as names the format to read input.document as: hm-notes-notebook, hm-notes-page, hm-notes-library or hm-notes-backup. expected is the document as a reader writes it back, or the rejection. Positions and sizes are whole units, 100 to a PDF point, and times are whole milliseconds. Generated cases come from the property tests' generators, with a fixed seed.",
    cases: distinct([
      ...handWritten.flatMap(([as, cases]) =>
        cases.map(([name, document, outcome]) =>
          make(`${SHORT[as]}: ${name}`, { as, document }, readAndWrite, outcome),
        ),
      ),
      ...generated.flatMap(([as, documents]) =>
        documents.map((document, index) =>
          make(`${SHORT[as]}: generated ${index + 1}`, { as, document }, readAndWrite, applied),
        ),
      ),
    ]),
  };
}

/**
 * The state the command cases start from: the notebook above, with its
 * first two pages loaded. Its third page, p3, isn't loaded.
 */
const STATE = {
  notebook: NOTEBOOK,
  pages: {
    p1: [stroke("s1"), textBox("t1"), link("l1", "p2")],
    p2: [image("i1")],
  },
};

/** The same notebook with every page loaded. */
const LOADED = { notebook: NOTEBOOK, pages: { ...STATE.pages, p3: [] as unknown[] } };

/**
 * A state whose pages and items are named after `Object.prototype`'s
 * properties. Its page `constructor` isn't loaded, so a port that keeps the
 * loaded pages in a plain object must not find Object's own there.
 */
const NAMED_STATE = {
  notebook: { ...NAMED_NOTEBOOK, recordings: [] },
  pages: Object.fromEntries([
    [PROTO, [stroke(PROTO), textBox(CONSTRUCTOR), link(TO_STRING, CONSTRUCTOR)]],
    [TO_STRING, [stroke(TO_STRING)]],
  ]),
};

type CommandCase = readonly [
  name: string,
  input: { state: unknown; command: unknown; limits?: object },
  outcome: Outcome,
];

/** `hm-notes-commands`: a command read and applied to a state. */
export function commandCases(): ConformanceFile {
  const on = (command: unknown, limits?: object): CommandCase[1] => ({
    state: STATE,
    command,
    ...(limits ? { limits } : {}),
  });
  const onLoaded = (command: unknown, limits?: object): CommandCase[1] => ({
    state: LOADED,
    command,
    ...(limits ? { limits } : {}),
  });
  const onNamed = (command: unknown): CommandCase[1] => ({ state: NAMED_STATE, command });
  /** The base state with p1's link leading to a page that's gone, as removing its page leaves it. */
  const DANGLING = set(STATE, ["pages", "p1", 2, "page"], "gone");
  const onDangling = (command: unknown): CommandCase[1] => ({ state: DANGLING, command });

  const addItems = (items: unknown, pageId: unknown = "p1", index?: unknown) => ({
    type: "notes.addItems",
    page: pageId,
    items,
    ...(index === undefined ? {} : { index }),
  });
  const removeItems = (ids: unknown, pageId: unknown = "p1") => ({
    type: "notes.removeItems",
    page: pageId,
    ids,
  });
  const restoreItems = (entries: unknown, pageId: unknown = "p1") => ({
    type: "notes.restoreItems",
    page: pageId,
    entries,
  });
  const replaceItems = (items: unknown, pageId: unknown = "p1") => ({
    type: "notes.replaceItems",
    page: pageId,
    items,
  });
  const addPages = (atIndex: unknown, pages: unknown) => ({
    type: "notes.addPages",
    at: atIndex,
    pages,
  });
  const newPage = (id: string, items: unknown[] = [], changes: object = {}) => ({
    info: pageInfo(id, changes),
    items,
  });
  const removePages = (pages: unknown) => ({ type: "notes.removePages", pages });
  const restorePages = (entries: unknown, outline: unknown = NOTEBOOK.outline) => ({
    type: "notes.restorePages",
    entries,
    outline,
  });
  const restored = (index: unknown, id: string, items: unknown[] = []) => ({
    index,
    info: pageInfo(id),
    items,
  });
  const reorder = (order: unknown) => ({ type: "notes.reorderPages", order });
  const setTemplates = (templates: unknown) => ({ type: "notes.setTemplates", templates });
  const setOutline = (outline: unknown) => ({ type: "notes.setOutline", outline });
  const rename = (title: unknown) => ({ type: "notes.rename", title });
  const setRecordings = (recordings: unknown) => ({ type: "notes.setRecordings", recordings });
  // `__proto__` as an own field of a command, as JSON.parse makes it.
  const protoField = set(rename("Lab book"), [PROTO], { polluted: true });

  const handWritten: CommandCase[] = [
    // notes.addItems
    ["adds an item on top of a page's others", on(addItems([stroke("s2")])), applied],
    [
      "adds several items at the bottom of a page",
      on(addItems([stroke("s2"), textBox("t2")], "p1", 0)),
      applied,
    ],
    ["adds an item among a page's others", on(addItems([image("i2")], "p1", 2)), applied],
    ["adds an item at the index after the last", on(addItems([stroke("s2")], "p1", 3)), applied],
    ["adds an item whose id another page uses", on(addItems([image("i1")])), applied],
    [
      "adds a link to a page of the notebook that isn't loaded",
      on(addItems([link("l2", "p3")])),
      applied,
    ],
    [
      "adds an item that reaches a page's limit",
      on(addItems([stroke("s2")]), { maxPageItems: 4 }),
      applied,
    ],
    [
      "refuses items over a page's limit",
      on(addItems([stroke("s2"), stroke("s3")]), { maxPageItems: 4 }),
      overLimit("TOO_MANY_ITEMS"),
    ],
    [
      "refuses adding to an unknown page",
      on(addItems([stroke("s2")], "p9")),
      refused("unknown-page"),
    ],
    [
      "refuses adding to a page that isn't loaded",
      on(addItems([stroke("s2")], "p3")),
      refused("page-not-loaded"),
    ],
    ["refuses adding no items", on(addItems([])), refused("malformed-command")],
    [
      "refuses an index past the page's last",
      on(addItems([stroke("s2")], "p1", 4)),
      refused("invalid-index"),
    ],
    [
      "refuses an item whose id the page has",
      on(addItems([stroke("t1")])),
      refused("duplicate-id"),
    ],
    [
      "refuses two new items with one id",
      on(addItems([stroke("s2"), textBox("s2")])),
      refused("duplicate-id"),
    ],
    [
      "refuses adding a link to a page the notebook doesn't have",
      on(addItems([link("l2", "p9")])),
      refused("unknown-page"),
    ],
    [
      "refuses a negative index",
      on(addItems([stroke("s2")], "p1", -1)),
      refused("malformed-command"),
    ],
    [
      "refuses a fractional index",
      on(addItems([stroke("s2")], "p1", 0.5)),
      refused("malformed-command"),
    ],
    [
      "refuses an index as text",
      on(addItems([stroke("s2")], "p1", "0")),
      refused("malformed-command"),
    ],
    ["refuses items that aren't a list", on(addItems(stroke("s2"))), refused("malformed-command")],
    [
      "refuses a page that's an invalid id",
      on(addItems([stroke("s2")], "p 1")),
      refused("invalid-id"),
    ],
    ["refuses an item with an invalid id", on(addItems([stroke("s 2")])), refused("invalid-id")],
    [
      "refuses an item of an unknown type",
      on(addItems([{ ...stroke("s2"), type: "shape" }])),
      refused("malformed-command"),
    ],
    [
      "refuses an item with an unknown field",
      on(addItems([stroke("s2", { opacity: 1 })])),
      refused("malformed-command"),
    ],
    [
      "refuses a colour in capitals",
      on(addItems([stroke("s2", { color: "#1A1A1A" })])),
      refused("invalid-color"),
    ],
    [
      "refuses a stroke thicker than 7,200 units",
      on(addItems([stroke("s2", { size: 7_201 })])),
      refused("invalid-size"),
    ],
    [
      "refuses points that aren't whole triples",
      on(addItems([stroke("s2", { points: [0, 0] })])),
      refused("invalid-points"),
    ],
    [
      "refuses a pressure over 1,000",
      on(addItems([stroke("s2", { points: [0, 0, 1_001] })])),
      refused("invalid-points"),
    ],
    [
      "refuses a position too far from the page",
      on(addItems([textBox("t2", { x: 2_880_001 })])),
      refused("invalid-position"),
    ],
    [
      "refuses a fractional position",
      on(addItems([textBox("t2", { y: 0.5 })])),
      refused("invalid-position"),
    ],
    [
      "refuses an anchor before its recording",
      on(addItems([stroke("s2", { audio: { recording: "r1", at: -1 } })])),
      refused("invalid-time"),
    ],
    [
      "refuses an SVG picture",
      on(addItems([image("i2", { image: { ...imageAsset, mediaType: "image/svg+xml" } })])),
      refused("invalid-asset"),
    ],
    [
      "refuses a picture whose asset name isn't a SHA-256",
      on(addItems([image("i2", { image: { ...imageAsset, asset: "i2.png" } })])),
      refused("invalid-asset"),
    ],
    [
      "adds text of 200 code points outside the BMP",
      on(addItems([textBox("t2", { text: EMOJI.repeat(200) })])),
      applied,
    ],
    [
      "refuses text with a lone surrogate",
      on(addItems([textBox("t2", { text: HIGH })])),
      refused("malformed-command"),
    ],
    // notes.removeItems
    ["removes an item", on(removeItems(["t1"])), applied],
    ["removes several items, in any order", on(removeItems(["l1", "s1"])), applied],
    ["removes every item of a page", on(removeItems(["s1", "t1", "l1"])), applied],
    [
      "removes a link whose page is no longer in the notebook",
      onDangling(removeItems(["l1"])),
      applied,
    ],
    [
      "refuses removing an item the page doesn't have",
      on(removeItems(["i1"])),
      refused("unknown-item"),
    ],
    ["refuses removing no items", on(removeItems([])), refused("malformed-command")],
    ["refuses removing an item twice", on(removeItems(["s1", "s1"])), refused("malformed-command")],
    [
      "refuses removing from an unknown page",
      on(removeItems(["s1"], "p9")),
      refused("unknown-page"),
    ],
    [
      "refuses removing from a page that isn't loaded",
      on(removeItems(["s1"], "p3")),
      refused("page-not-loaded"),
    ],
    ["refuses an id that isn't valid", on(removeItems(["s1", ""])), refused("invalid-id")],
    ["refuses ids that aren't a list", on(removeItems("s1")), refused("malformed-command")],
    // notes.restoreItems
    [
      "restores items at their indexes",
      on(
        restoreItems([
          { index: 0, item: stroke("s0") },
          { index: 2, item: textBox("t0") },
        ]),
      ),
      applied,
    ],
    ["restores an item on top", on(restoreItems([{ index: 3, item: stroke("s2") }])), applied],
    [
      "restores items next to each other at the top",
      on(
        restoreItems([
          { index: 3, item: stroke("s2") },
          { index: 4, item: stroke("s3") },
        ]),
      ),
      applied,
    ],
    [
      "restores a link whose page is no longer in the notebook",
      on(restoreItems([{ index: 0, item: link("l0", "gone") }])),
      applied,
    ],
    ["refuses restoring nothing", on(restoreItems([])), refused("malformed-command")],
    [
      "refuses indexes that don't ascend",
      on(
        restoreItems([
          { index: 2, item: stroke("s2") },
          { index: 1, item: stroke("s3") },
        ]),
      ),
      refused("invalid-index"),
    ],
    [
      "refuses an index twice",
      on(
        restoreItems([
          { index: 1, item: stroke("s2") },
          { index: 1, item: stroke("s3") },
        ]),
      ),
      refused("invalid-index"),
    ],
    [
      "refuses restoring at an index past the page's last",
      on(restoreItems([{ index: 4, item: stroke("s2") }])),
      refused("invalid-index"),
    ],
    [
      "refuses restoring an item whose id the page has",
      on(restoreItems([{ index: 0, item: stroke("s1") }])),
      refused("duplicate-id"),
    ],
    [
      "refuses restoring items over a page's limit",
      on(restoreItems([{ index: 0, item: stroke("s2") }]), { maxPageItems: 3 }),
      overLimit("TOO_MANY_ITEMS"),
    ],
    [
      "refuses restoring to an unknown page",
      on(restoreItems([{ index: 0, item: stroke("s2") }], "p9")),
      refused("unknown-page"),
    ],
    [
      "refuses an entry with an unknown field",
      on(restoreItems([{ index: 0, item: stroke("s2"), was: 1 }])),
      refused("malformed-command"),
    ],
    [
      "refuses an entry without its index",
      on(restoreItems([{ item: stroke("s2") }])),
      refused("malformed-command"),
    ],
    // notes.replaceItems
    [
      "replaces an item by another with its id: a text box, moved and edited",
      on(replaceItems([textBox("t1", { x: 9_000, y: 21_000, text: "Check the units twice" })])),
      applied,
    ],
    [
      "replaces several items, each in its place",
      on(replaceItems([link("l1", "p3"), stroke("s1", { color: "#d93025" })])),
      applied,
    ],
    [
      "replaces a link whose page is no longer in the notebook, keeping its page",
      onDangling(replaceItems([link("l1", "gone", { x: 100 })])),
      applied,
    ],
    [
      "refuses replacing an item the page doesn't have",
      on(replaceItems([stroke("s9")])),
      refused("unknown-item"),
    ],
    [
      "refuses replacing an item by one of another kind",
      on(replaceItems([textBox("s1")])),
      refused("malformed-command"),
    ],
    [
      "refuses replacing an item twice",
      on(replaceItems([stroke("s1"), stroke("s1", { size: 300 })])),
      refused("malformed-command"),
    ],
    ["refuses replacing no items", on(replaceItems([])), refused("malformed-command")],
    [
      "refuses replacing on a page that isn't loaded",
      on(replaceItems([stroke("s1")], "p3")),
      refused("page-not-loaded"),
    ],
    // notes.addPages
    ["adds a page at the end", on(addPages(3, [newPage("p4")])), applied],
    [
      "adds pages with their items at the start",
      on(addPages(0, [newPage("p4", [stroke("s1")]), newPage("p5", [], { template: "grid" })])),
      applied,
    ],
    [
      "adds a page over a PDF",
      on(addPages(1, [newPage("p4", [], { background: { pdf: pdfAsset, pageIndex: 1 } })])),
      applied,
    ],
    [
      "adds pages whose links lead to each other",
      on(addPages(1, [newPage("p4", [link("l1", "p5")]), newPage("p5", [link("l1", "p4")])])),
      applied,
    ],
    [
      "adds a page that reaches the notebook's limit",
      on(addPages(3, [newPage("p4")]), { maxPages: 4 }),
      applied,
    ],
    [
      "refuses pages over the notebook's limit",
      on(addPages(3, [newPage("p4"), newPage("p5")]), { maxPages: 4 }),
      overLimit("TOO_MANY_PAGES"),
    ],
    [
      "refuses a new page with more items than a page's limit",
      on(addPages(3, [newPage("p4", [stroke("a"), stroke("b")])]), { maxPageItems: 1 }),
      overLimit("TOO_MANY_ITEMS"),
    ],
    ["refuses adding no pages", on(addPages(0, [])), refused("malformed-command")],
    [
      "refuses a position past the last page",
      on(addPages(4, [newPage("p4")])),
      refused("invalid-index"),
    ],
    [
      "refuses a page whose id the notebook has",
      on(addPages(0, [newPage("p2")])),
      refused("duplicate-page"),
    ],
    [
      "refuses two new pages with one id",
      on(addPages(0, [newPage("p4"), newPage("p4")])),
      refused("duplicate-page"),
    ],
    [
      "refuses a new page with two items of one id",
      on(addPages(0, [newPage("p4", [stroke("a"), textBox("a")])])),
      refused("duplicate-id"),
    ],
    [
      "refuses a new page with a link to a page the notebook doesn't have",
      on(addPages(0, [newPage("p4", [link("l1", "p9")])])),
      refused("unknown-page"),
    ],
    [
      "refuses a new page narrower than an inch",
      on(addPages(0, [newPage("p4", [], { width: 7_199 })])),
      refused("invalid-size"),
    ],
    [
      "refuses a new page with an unknown template",
      on(addPages(0, [newPage("p4", [], { template: "music" })])),
      refused("malformed-command"),
    ],
    [
      "refuses a fractional position for new pages",
      on(addPages(0.5, [newPage("p4")])),
      refused("malformed-command"),
    ],
    [
      "refuses a new page without its items",
      on(addPages(0, [{ info: pageInfo("p4") }])),
      refused("malformed-command"),
    ],
    // notes.removePages
    [
      "removes a page, with the outline entries that led to it, leaving the links to it",
      on(removePages(["p2"])),
      applied,
    ],
    ["removes several pages", on(removePages(["p2", "p1"])), applied],
    [
      "refuses removing every page",
      onLoaded(removePages(["p1", "p2", "p3"])),
      refused("last-page"),
    ],
    ["refuses removing an unknown page", on(removePages(["p9"])), refused("unknown-page")],
    [
      "refuses removing a page that isn't loaded",
      on(removePages(["p3"])),
      refused("page-not-loaded"),
    ],
    ["refuses removing a page twice", on(removePages(["p1", "p1"])), refused("malformed-command")],
    ["refuses removing no pages", on(removePages([])), refused("malformed-command")],
    ["refuses pages that aren't a list", on(removePages("p1")), refused("malformed-command")],
    // notes.restorePages
    [
      "restores a page at its index",
      on(restorePages([restored(1, "p0", [stroke("s1")])])),
      applied,
    ],
    [
      "restores pages with the outline entries that led to them",
      on(
        restorePages(
          [restored(0, "p0"), restored(4, "p4")],
          [
            { id: "o0", title: "Cover", page: "p0" },
            ...NOTEBOOK.outline,
            { id: "o4", title: "Index", page: "p4" },
          ],
        ),
      ),
      applied,
    ],
    [
      "restores a page with a link to a page that's gone",
      on(restorePages([restored(3, "p4", [link("l1", "gone")])])),
      applied,
    ],
    ["refuses restoring no pages", on(restorePages([])), refused("malformed-command")],
    [
      "refuses page indexes that don't ascend",
      on(restorePages([restored(2, "p4"), restored(1, "p5")])),
      refused("invalid-index"),
    ],
    [
      "refuses a page index past the last",
      on(restorePages([restored(4, "p4")])),
      refused("invalid-index"),
    ],
    [
      "refuses restoring a page whose id the notebook has",
      on(restorePages([restored(0, "p1")])),
      refused("duplicate-page"),
    ],
    [
      "refuses restoring a page with two items of one id",
      on(restorePages([restored(0, "p4", [stroke("a"), stroke("a")])])),
      refused("duplicate-id"),
    ],
    [
      "refuses restoring pages over the notebook's limit",
      on(restorePages([restored(0, "p4")]), { maxPages: 3 }),
      overLimit("TOO_MANY_PAGES"),
    ],
    [
      "refuses restoring a page with more items than a page's limit",
      on(restorePages([restored(0, "p4", [stroke("a"), stroke("b")])]), { maxPageItems: 1 }),
      overLimit("TOO_MANY_ITEMS"),
    ],
    [
      "refuses an outline that leads to a page that isn't there",
      on(
        restorePages(
          [restored(0, "p4")],
          [...NOTEBOOK.outline, { id: "o9", title: "Lost", page: "p9" }],
        ),
      ),
      refused("unknown-page"),
    ],
    [
      "refuses an outline without one of the notebook's entries",
      on(restorePages([restored(0, "p4")], [NOTEBOOK.outline[0]])),
      refused("malformed-command"),
    ],
    [
      "refuses an outline with the notebook's entries in another order",
      on(restorePages([restored(0, "p4")], [NOTEBOOK.outline[1], NOTEBOOK.outline[0]])),
      refused("malformed-command"),
    ],
    [
      "refuses an outline with a new entry for a page that was there",
      on(
        restorePages(
          [restored(0, "p4")],
          [...NOTEBOOK.outline, { id: "o3", title: "Extra", page: "p3" }],
        ),
      ),
      refused("malformed-command"),
    ],
    [
      "refuses an outline with one of the notebook's entries renamed",
      on(
        restorePages(
          [restored(0, "p4")],
          [{ ...NOTEBOOK.outline[0], title: "Week one" }, NOTEBOOK.outline[1]],
        ),
      ),
      refused("malformed-command"),
    ],
    [
      "refuses restoring pages with an outline of two entries with one id",
      on(
        restorePages(
          [restored(0, "p4")],
          [...NOTEBOOK.outline, { id: "o1", title: "Again", page: "p4" }],
        ),
      ),
      refused("duplicate-id"),
    ],
    [
      "refuses a restore without its outline",
      on({ type: "notes.restorePages", entries: [restored(0, "p4")] }),
      refused("malformed-command"),
    ],
    // notes.reorderPages
    ["puts the pages in a new order", on(reorder(["p3", "p1", "p2"])), applied],
    ["keeps the pages' order", on(reorder(["p1", "p2", "p3"])), applied],
    ["refuses an order without every page", on(reorder(["p1", "p2"])), refused("invalid-order")],
    [
      "refuses an order with an unknown page",
      on(reorder(["p1", "p2", "p9"])),
      refused("invalid-order"),
    ],
    [
      "refuses an order with a page twice",
      on(reorder(["p1", "p2", "p2"])),
      refused("invalid-order"),
    ],
    [
      "refuses an order with a page too many",
      on(reorder(["p1", "p2", "p3", "p4"])),
      refused("invalid-order"),
    ],
    ["refuses an empty order", on(reorder([])), refused("invalid-order")],
    // notes.setTemplates
    [
      "changes the paper of pages",
      on(
        setTemplates([
          { page: "p3", template: "grid" },
          { page: "p1", template: "blank" },
        ]),
      ),
      applied,
    ],
    [
      "sets a page's paper to what it is",
      on(setTemplates([{ page: "p1", template: "lined" }])),
      applied,
    ],
    [
      "refuses the paper of an unknown page",
      on(setTemplates([{ page: "p9", template: "grid" }])),
      refused("unknown-page"),
    ],
    [
      "refuses a page's paper twice",
      on(
        setTemplates([
          { page: "p1", template: "grid" },
          { page: "p1", template: "blank" },
        ]),
      ),
      refused("malformed-command"),
    ],
    ["refuses changing the paper of no pages", on(setTemplates([])), refused("malformed-command")],
    [
      "refuses an unknown paper",
      on(setTemplates([{ page: "p1", template: "music" }])),
      refused("malformed-command"),
    ],
    [
      "refuses a paper only Object.prototype has",
      on(setTemplates([{ page: "p1", template: CONSTRUCTOR }])),
      refused("malformed-command"),
    ],
    // notes.setOutline
    [
      "replaces the outline",
      on(
        setOutline([
          { id: "o3", title: "Summary", page: "p3" },
          { id: "o1", title: "Week 1", page: "p1" },
        ]),
      ),
      applied,
    ],
    ["clears the outline", on(setOutline([])), applied],
    [
      "refuses an outline that leads to an unknown page",
      on(setOutline([{ id: "o1", title: "Lost", page: "p9" }])),
      refused("unknown-page"),
    ],
    [
      "refuses an outline with two entries of one id",
      on(
        setOutline([
          { id: "o1", title: "A", page: "p1" },
          { id: "o1", title: "B", page: "p2" },
        ]),
      ),
      refused("duplicate-id"),
    ],
    [
      "refuses an outline title of 201 code points",
      on(setOutline([{ id: "o1", title: EMOJI.repeat(201), page: "p1" }])),
      refused("text-too-long"),
    ],
    [
      "refuses an outline entry with an unknown field",
      on(setOutline([{ id: "o1", title: "A", page: "p1", level: 2 }])),
      refused("malformed-command"),
    ],
    // notes.rename
    ["renames the notebook", on(rename("Lab book")), applied],
    ["renames the notebook to an empty title", on(rename("")), applied],
    ["renames the notebook to a title named __proto__", on(rename(PROTO)), applied],
    [
      "keeps a title of 200 code points outside the BMP, which are 400 UTF-16 units",
      on(rename(EMOJI.repeat(200))),
      applied,
    ],
    [
      "refuses a title of 201 code points outside the BMP",
      on(rename(EMOJI.repeat(201))),
      refused("text-too-long"),
    ],
    ["refuses a title of 201 letters", on(rename("a".repeat(201))), refused("text-too-long")],
    [
      "refuses a title with a lone surrogate",
      on(rename(`Lab${LOW}`)),
      refused("malformed-command"),
    ],
    ["refuses a title that isn't text", on(rename(7)), refused("malformed-command")],
    // notes.setRecordings
    [
      "adds a recording to the list",
      on(
        setRecordings([
          recording("r1"),
          recording("r2", { startedAt: 1_700_000_300_000, duration: 4_000 }),
        ]),
      ),
      applied,
    ],
    [
      "removes every recording, leaving the anchors that named them",
      on(setRecordings([])),
      applied,
    ],
    [
      "refuses two recordings with one id",
      on(setRecordings([recording("r1"), recording("r1")])),
      refused("duplicate-id"),
    ],
    [
      "refuses a recording of a negative length",
      on(setRecordings([recording("r1", { duration: -1 })])),
      refused("invalid-time"),
    ],
    [
      "refuses a recording of an unknown media type",
      on(setRecordings([recording("r1", { audio: { ...audioAsset, mediaType: "audio/mpeg" } })])),
      refused("invalid-asset"),
    ],
    [
      "refuses a recording with an unknown field",
      on(setRecordings([recording("r1", { title: "Lecture" })])),
      refused("malformed-command"),
    ],
    // Names of Object.prototype's properties, as pages and items.
    ["adds an item to the page named __proto__", onNamed(addItems([stroke("s1")], PROTO)), applied],
    [
      "adds an item named constructor to the page named toString",
      onNamed(addItems([textBox(CONSTRUCTOR)], TO_STRING)),
      applied,
    ],
    [
      "refuses an item named __proto__ on the page that has one",
      onNamed(addItems([textBox(PROTO)], PROTO)),
      refused("duplicate-id"),
    ],
    [
      "removes the items named constructor and toString",
      onNamed(removeItems([TO_STRING, CONSTRUCTOR], PROTO)),
      applied,
    ],
    [
      "refuses removing an item only Object.prototype has",
      onNamed(removeItems(["hasOwnProperty"], PROTO)),
      refused("unknown-item"),
    ],
    [
      "replaces the item named __proto__",
      onNamed(replaceItems([stroke(PROTO, { size: 400 })], PROTO)),
      applied,
    ],
    [
      "refuses the page named constructor, which isn't loaded",
      onNamed(addItems([stroke("s1")], CONSTRUCTOR)),
      refused("page-not-loaded"),
    ],
    [
      "refuses a page only Object.prototype has",
      onNamed(addItems([stroke("s1")], "hasOwnProperty")),
      refused("unknown-page"),
    ],
    [
      "refuses a link to a page only Object.prototype has",
      onNamed(addItems([link("l1", "valueOf")], PROTO)),
      refused("unknown-page"),
    ],
    [
      "removes the pages named __proto__ and toString",
      onNamed(removePages([TO_STRING, PROTO])),
      applied,
    ],
    [
      "reorders pages named after Object.prototype's properties",
      onNamed(reorder([TO_STRING, PROTO, CONSTRUCTOR])),
      applied,
    ],
    [
      "refuses an order with a page only Object.prototype has",
      onNamed(reorder([TO_STRING, PROTO, "valueOf"])),
      refused("invalid-order"),
    ],
    [
      "changes the paper of the page named constructor",
      onNamed(setTemplates([{ page: CONSTRUCTOR, template: "grid" }])),
      applied,
    ],
    [
      "refuses the paper of a page only Object.prototype has",
      onNamed(setTemplates([{ page: "valueOf", template: "grid" }])),
      refused("unknown-page"),
    ],
    [
      "refuses a page named __proto__ that the notebook has",
      onNamed(addPages(0, [newPage(PROTO)])),
      refused("duplicate-page"),
    ],
    [
      "adds a page named valueOf",
      onNamed(addPages(3, [newPage("valueOf", [stroke("hasOwnProperty")])])),
      applied,
    ],
    [
      "refuses an outline that leads to a page only Object.prototype has",
      onNamed(setOutline([{ id: "o1", title: "A", page: "hasOwnProperty" }])),
      refused("unknown-page"),
    ],
    // Any command.
    ["refuses a command that isn't an object", on(null), refused("malformed-command")],
    ["refuses a command that's text", on("notes.rename"), refused("malformed-command")],
    ["refuses a list of commands", on([rename("Lab book")]), refused("malformed-command")],
    ["refuses a command with no type", on({ title: "Lab book" }), refused("unknown-command")],
    [
      "refuses an unknown command",
      on({ type: "notes.duplicatePages", pages: ["p1"] }),
      refused("unknown-command"),
    ],
    [
      "refuses a command type in another case",
      on({ type: "notes.Rename", title: "Lab book" }),
      refused("unknown-command"),
    ],
    ["refuses a command type that isn't text", on({ type: 1 }), refused("unknown-command")],
    ...HOSTILE_NAMES.map(
      (name): CommandCase => [
        `refuses the command type ${name}, which only Object.prototype has`,
        on({ type: name }),
        refused("unknown-command"),
      ],
    ),
    [
      "refuses an unknown field",
      on({ ...rename("Lab book"), cover: "red" }),
      refused("malformed-command"),
    ],
    ["refuses an unknown field named __proto__", on(protoField), refused("malformed-command")],
    [
      "refuses an unknown field named constructor",
      on(set(rename("Lab book"), [CONSTRUCTOR], {})),
      refused("malformed-command"),
    ],
    [
      "refuses an unknown field named toString",
      on(set(rename("Lab book"), [TO_STRING], "x")),
      refused("malformed-command"),
    ],
    ["refuses a missing field", on({ type: "notes.rename" }), refused("malformed-command")],
    [
      "refuses a command with a document's header",
      on({ format: "hm-notes-command", version: 1, ...rename("Lab book") }),
      refused("malformed-command"),
    ],
  ];

  // A balanced sample: a few commands of each type that apply, and one of
  // each refusal, so the file stays small enough to review.
  const generated: ConformanceCase[] = [];
  const counts = new Map<string, number>();
  const samples = fc.sample(
    stateAndCommand.chain(([state, command]) =>
      fc.tuple(
        fc.constant(toStateDocument(state)),
        fc.oneof(fc.constant(command as unknown), mutated(fc.constant(command))),
      ),
    ),
    { seed: SEED, numRuns: 1_500 },
  );
  for (const [state, command] of samples) {
    const made = make("", { state, command }, applyToState);
    const { error } = made.expected as { error?: { code: string; reason?: string } };
    const type = (command as { type?: unknown } | null)?.type;
    const named =
      typeof type === "string" && type.startsWith("notes.") ? type : "a malformed command";
    const key = error ? `refused, ${error.reason ?? error.code}` : `${named}, applied`;
    const kept = counts.get(key) ?? 0;
    if (kept >= (error ? GENERATED_PER_REFUSAL : GENERATED_PER_TYPE)) continue;
    counts.set(key, kept + 1);
    generated.push({
      ...made,
      name: `generated ${generated.length + 1}: ${error ? `${named}, ${key}` : key}`,
    });
  }

  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-notes-commands",
    description:
      "notes-sdk's edit commands (docs/formats/conformance.md). input.state is a notebook's state: its hm-notes-notebook document, and the items of each loaded page by the page's id. input.command is an hm-notes-command, and input.limits, when present, holds maxPages and maxPageItems. expected is the resulting state with the command's inverse, or the rejection. Applying the inverse must restore the state. Generated cases come from the property tests' generators, with a fixed seed.",
    cases: distinct([
      ...handWritten.map(([name, input, outcome]) => make(name, input, applyToState, outcome)),
      ...generated,
    ]),
  };
}
