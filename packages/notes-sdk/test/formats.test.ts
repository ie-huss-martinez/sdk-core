import {
  type ConformanceCase,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  NOTES_DOCUMENT_MAX_ENTRIES,
  NOTES_DOCUMENT_MAX_ITEMS,
  NOTES_DOCUMENT_MAX_PAGES,
  toNotesLibraryDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../src/core/format/documents.js";
import { NOTES_AUDIO_TYPES, NOTES_IMAGE_TYPES, NOTES_PDF_TYPE } from "../src/core/format/items.js";
import { MAX_TIME } from "../src/core/format/read.js";
import {
  NOTES_MAX_ID_LENGTH,
  NOTES_MAX_OUTLINE_ENTRIES,
  NOTES_MAX_PAGE_SIDE,
  NOTES_MAX_RECORDINGS,
  NOTES_MAX_STROKE_POINTS,
  NOTES_MAX_TEXT_LENGTH,
  NOTES_MAX_TITLE_LENGTH,
  NOTES_MIN_PAGE_SIDE,
  NOTES_PAGE_MARGIN,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
} from "../src/core/model/portable.js";
import { NOTES_TEMPLATES } from "../src/core/model/templates.js";
import { applyNotesCommand, readNotesCommandDocument } from "../src/core/operations/commands.js";
import {
  backupManifest,
  library,
  mutated,
  notebook,
  page,
  stateAndCommand,
} from "./arbitraries/notes.js";
import {
  accepts,
  type CommandInput,
  DOCUMENT_READERS,
  type DocumentInput,
  hasLoneSurrogate,
  type NotesDocumentFormat,
  readState,
  rejection,
  type StateDocument,
} from "./conformance/run.js";
import { commandErrors, documentErrors, FORMATS, readSchema } from "./conformance/schemas.js";

/**
 * The format schemas (sdk-core ADR 0045, sections 6 and 8) agree with the
 * hand-written readers: a reader accepts nothing its schema refuses, and
 * refuses what its schema accepts only for what a schema can't say, such as
 * a duplicate id or a page that isn't in the notebook.
 */

const DOCUMENTS = new URL("../conformance/hm-notes-documents.json", import.meta.url);
const COMMANDS = new URL("../conformance/hm-notes-commands.json", import.meta.url);
const BASE = "https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/notes-sdk/formats";

type Schema = Record<string, unknown>;
const schemas = Object.fromEntries(FORMATS.map((format) => [format, readSchema(format)])) as Record<
  (typeof FORMATS)[number],
  Schema
>;

/** Every schema object inside a schema, with its path. */
function* nodes(value: unknown, path = "#"): Generator<[string, Schema]> {
  if (typeof value !== "object" || value === null) return;
  if (!Array.isArray(value)) yield [path, value as Schema];
  for (const [name, inner] of Object.entries(value)) yield* nodes(inner, `${path}/${name}`);
}

/** The definition at a path of names inside a schema. */
function part(format: (typeof FORMATS)[number], ...path: string[]): Schema {
  let found: unknown = schemas[format];
  for (const name of path) found = (found as Schema | undefined)?.[name];
  if (typeof found !== "object" || found === null) {
    throw new Error(`${format} has no ${path.join("/")}.`);
  }
  return found as Schema;
}

describe("each format's schema", () => {
  it.each(FORMATS)("%s names itself, its version and what it's for", (format) => {
    const schema = schemas[format];
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema["$id"]).toBe(`${BASE}/${format}/v1.schema.json`);
    expect(schema["title"]).toBe(`${format}, version 1`);
    expect(String(schema["description"])).toContain("Beyond this schema");
  });

  it.each(FORMATS)("%s refuses unknown fields in every object", (format) => {
    for (const [path, node] of nodes(schemas[format])) {
      if (node["type"] === "object" || "properties" in node) {
        expect(node["additionalProperties"], path).toBe(false);
        // Every field it lists as required is one it describes.
        const properties = Object.keys(node["properties"] as object);
        expect(properties, path).toEqual(expect.arrayContaining(node["required"] as string[]));
      }
    }
  });

  it("names the format and version 1 in every document's header", () => {
    for (const format of FORMATS) {
      if (format === "hm-notes-command") continue;
      expect(part(format, "properties", "format")).toStrictEqual({ const: format });
      expect(part(format, "properties", "version")).toStrictEqual({ const: 1 });
    }
  });

  it("gives a definition with one name the same meaning in every schema", () => {
    const seen = new Map<string, [string, unknown]>();
    for (const format of FORMATS) {
      for (const [name, definition] of Object.entries(part(format, "$defs"))) {
        const first = seen.get(name);
        if (first)
          expect(definition, `${name} in ${format} and ${first[0]}`).toStrictEqual(first[1]);
        else seen.set(name, [format, definition]);
      }
    }
    expect(seen.has("id")).toBe(true);
  });

  it("has the readers' bounds", () => {
    const def = (format: (typeof FORMATS)[number], name: string) => part(format, "$defs", name);
    const range = (schema: Schema) => [schema["minimum"], schema["maximum"]];
    expect(def("hm-notes-page", "id")["pattern"]).toBe(`^[A-Za-z0-9_-]{1,${NOTES_MAX_ID_LENGTH}}$`);
    expect(def("hm-notes-page", "color")["pattern"]).toBe("^#[0-9a-f]{6}$");
    expect(def("hm-notes-page", "assetName")["pattern"]).toBe("^sha256:[0-9a-f]{64}$");
    expect(range(def("hm-notes-page", "assetSize"))).toStrictEqual([0, Number.MAX_SAFE_INTEGER]);
    expect(range(def("hm-notes-page", "position"))).toStrictEqual([
      -NOTES_PAGE_MARGIN,
      2 * NOTES_PAGE_MARGIN,
    ]);
    expect(range(def("hm-notes-page", "length"))).toStrictEqual([1, 2 * NOTES_PAGE_MARGIN]);
    expect(range(def("hm-notes-page", "duration"))).toStrictEqual([0, MAX_TIME]);
    expect(range(def("hm-notes-notebook", "time"))).toStrictEqual([0, MAX_TIME]);
    expect(def("hm-notes-notebook", "title")["maxLength"]).toBe(NOTES_MAX_TITLE_LENGTH);
    expect(range(def("hm-notes-notebook", "pageSide"))).toStrictEqual([
      NOTES_MIN_PAGE_SIDE,
      NOTES_MAX_PAGE_SIDE,
    ]);
    expect(def("hm-notes-notebook", "template")["enum"]).toStrictEqual(NOTES_TEMPLATES);
    expect(def("hm-notes-notebook", "outline")["maxItems"]).toBe(NOTES_MAX_OUTLINE_ENTRIES);
    expect(def("hm-notes-notebook", "recordings")["maxItems"]).toBe(NOTES_MAX_RECORDINGS);
    expect(part("hm-notes-notebook", "properties", "pages")).toMatchObject({
      minItems: 1,
      maxItems: NOTES_DOCUMENT_MAX_PAGES,
    });
    expect(part("hm-notes-page", "properties", "items")["maxItems"]).toBe(NOTES_DOCUMENT_MAX_ITEMS);
    const stroke = part("hm-notes-page", "$defs", "stroke", "properties");
    expect(range(stroke["size"] as Schema)).toStrictEqual([...NOTES_STROKE_SIZE_RANGE]);
    expect(stroke["points"]).toMatchObject({ minItems: 3, maxItems: 3 * NOTES_MAX_STROKE_POINTS });
    const text = part("hm-notes-page", "$defs", "text", "properties");
    expect(range(text["size"] as Schema)).toStrictEqual([...NOTES_TEXT_SIZE_RANGE]);
    expect((text["text"] as Schema)["maxLength"]).toBe(NOTES_MAX_TEXT_LENGTH);
    const mediaTypes = (format: (typeof FORMATS)[number], name: string) =>
      part(format, "$defs", name, "properties", "mediaType")["enum"];
    expect(mediaTypes("hm-notes-page", "imageAsset")).toStrictEqual([...NOTES_IMAGE_TYPES]);
    expect(mediaTypes("hm-notes-notebook", "pdfAsset")).toStrictEqual([NOTES_PDF_TYPE]);
    expect(mediaTypes("hm-notes-notebook", "audioAsset")).toStrictEqual([...NOTES_AUDIO_TYPES]);
    for (const list of ["folders", "notebooks"]) {
      for (const format of ["hm-notes-library", "hm-notes-backup"] as const) {
        expect(part(format, "properties", list)["maxItems"]).toBe(NOTES_DOCUMENT_MAX_ENTRIES);
      }
    }
    expect(
      range(part("hm-notes-library", "$defs", "summary", "properties", "pageCount")),
    ).toStrictEqual([1, NOTES_DOCUMENT_MAX_PAGES]);
  });

  it("lists the twelve commands, each by its type", () => {
    const types = (schemas["hm-notes-command"]["oneOf"] as Schema[]).map(
      (command) => ((command["properties"] as Schema)["type"] as Schema)["const"],
    );
    expect(types).toStrictEqual([
      "notes.addItems",
      "notes.removeItems",
      "notes.restoreItems",
      "notes.replaceItems",
      "notes.addPages",
      "notes.removePages",
      "notes.restorePages",
      "notes.reorderPages",
      "notes.setTemplates",
      "notes.setOutline",
      "notes.rename",
      "notes.setRecordings",
    ]);
  });
});

const refusal = ({ expected }: ConformanceCase) =>
  (expected as { error?: { code: string; reason?: string } }).error;

/**
 * Refusals that depend on the whole document, which a schema can't see: two
 * entries with one id, an outline entry's page, and a folder's parent.
 */
const BEYOND_SCHEMA_REASONS = new Set(["duplicate-id", "unknown-page", "unknown-folder"]);

/**
 * The other cases a schema accepts and a reader refuses: a stroke's points,
 * which a schema bounds one by one but can't group in threes. Text with a
 * lone surrogate is one more, which `maxLength` only counts. The vectors hold
 * none (docs/formats/conformance.md), so it has its own test below.
 */
const BEYOND_SCHEMA_CASES: readonly (string | RegExp)[] = [
  "page: refuses points that aren't whole triples",
  "page: refuses a pressure over 1,000",
  "page: refuses a negative pressure",
  "refuses a pressure over 1,000",
];

const beyondSchema = (testCase: ConformanceCase): boolean => {
  const reason = refusal(testCase)?.reason;
  return (
    (reason !== undefined && BEYOND_SCHEMA_REASONS.has(reason)) ||
    BEYOND_SCHEMA_CASES.some((name) =>
      typeof name === "string" ? name === testCase.name : name.test(testCase.name),
    )
  );
};

describe("the vectors agree with the schemas", () => {
  const documents = readConformance(DOCUMENTS).cases;
  const commands = readConformance(COMMANDS).cases;

  /** The notebook the vectors start from, which reads unchanged. */
  const notebookDocument = (): unknown => {
    const found = documents.find(({ name }) => name === "notebook: reads a document unchanged");
    if (!found) throw new Error("The vectors have no notebook that reads unchanged.");
    return (found.input as DocumentInput).document;
  };

  it("names only cases that exist as beyond a schema", () => {
    const names = [...documents, ...commands].map((testCase) => testCase.name);
    for (const name of BEYOND_SCHEMA_CASES) {
      const found = names.filter((other) =>
        typeof name === "string" ? name === other : name.test(other),
      );
      expect(found.length, String(name)).toBeGreaterThan(0);
    }
  });

  it("accept every document a reader accepts, and refuse every refusal a schema can express", () => {
    let valid = 0;
    for (const testCase of documents) {
      const { as, document } = testCase.input as DocumentInput;
      const accepted = documentErrors[as](document).length === 0;
      if (refusal(testCase) === undefined) {
        valid += 1;
        expect(accepted, testCase.name).toBe(true);
        // What a reader writes back is a valid document too, and reads back as itself.
        expect(documentErrors[as](testCase.expected), testCase.name).toStrictEqual([]);
        expect(DOCUMENT_READERS[as](testCase.expected), testCase.name).toStrictEqual(
          testCase.expected,
        );
      } else {
        expect(accepted, testCase.name).toBe(beyondSchema(testCase));
      }
    }
    expect(valid).toBeGreaterThan(50);
  });

  const stateErrors = (state: StateDocument): string[] => [
    ...documentErrors["hm-notes-notebook"](state.notebook),
    ...Object.entries(state.pages).flatMap(([id, items]) =>
      documentErrors["hm-notes-page"]({ format: "hm-notes-page", version: 1, id, items }),
    ),
  ];

  it("hold states made of valid documents, before and after a command", () => {
    for (const testCase of commands) {
      expect(
        stateErrors((testCase.input as CommandInput).state as StateDocument),
        testCase.name,
      ).toStrictEqual([]);
      if (refusal(testCase) === undefined) {
        const { state } = testCase.expected as { state: StateDocument };
        expect(stateErrors(state), testCase.name).toStrictEqual([]);
      }
    }
  });

  it("accept every command the reader accepts, with its inverse, and refuse what it refuses", () => {
    for (const testCase of commands) {
      const { command, state } = testCase.input as CommandInput;
      const valid = commandErrors(command).length === 0;
      // The schema describes what readNotesCommandDocument reads. What applying checks is beyond it.
      const read = accepts(() => readNotesCommandDocument(command));
      expect(valid, testCase.name).toBe(read || beyondSchema(testCase));
      if (refusal(testCase) === undefined) {
        expect(read, testCase.name).toBe(true);
        // The vectors don't hold the inverse, so it's the one this SDK writes.
        const { inverse } = applyNotesCommand(readState(state), readNotesCommandDocument(command));
        expect(commandErrors(JSON.parse(JSON.stringify(inverse))), testCase.name).toStrictEqual([]);
      }
    }
  });

  it("hold no text with a lone surrogate, which a schema accepts and a reader refuses", () => {
    // The vectors can't show it, so one document and one command do, against both.
    const titled = { ...(notebookDocument() as object), title: "Lab\uD83D" };
    expect(documentErrors["hm-notes-notebook"](titled)).toStrictEqual([]);
    expect(rejection(() => DOCUMENT_READERS["hm-notes-notebook"](titled))).toStrictEqual({
      code: "INVALID_DOCUMENT",
      reason: "malformed-document",
    });
    const rename = { type: "notes.rename", title: "Lab\uDCD3" };
    expect(commandErrors(rename)).toStrictEqual([]);
    expect(rejection(() => readNotesCommandDocument(rename))).toStrictEqual({
      code: "INVALID_COMMAND",
      reason: "malformed-command",
    });
  });

  it("refuse a value that ends with a line break, whatever a pattern's `$` means", () => {
    // In Python and others, `$` also matches before a line break that ends the text. A
    // validator written in one must refuse what Ajv refuses, so the schemas are compiled
    // here with every `$` given that meaning.
    const lenient = new Ajv2020({ allErrors: true, strict: true });
    for (const format of FORMATS) {
      lenient.addSchema(
        JSON.parse(JSON.stringify(schemas[format]), (name, value: unknown) =>
          name === "pattern" && typeof value === "string"
            ? value.replace(/\$$/, "(?=\\n?$)")
            : value,
        ) as Schema,
      );
    }
    const validate = (format: (typeof FORMATS)[number], value: unknown): boolean =>
      lenient.getSchema(String(schemas[format]["$id"]))?.(value) === true;
    // The rewritten schemas still accept what they did.
    expect(validate("hm-notes-notebook", notebookDocument())).toBe(true);
    let checked = 0;
    for (const testCase of documents) {
      if (!testCase.name.includes("ends with a line break")) continue;
      const { as, document } = testCase.input as DocumentInput;
      expect(validate(as, document), testCase.name).toBe(false);
      checked += 1;
    }
    for (const testCase of commands) {
      if (!testCase.name.includes("ends with a line break")) continue;
      const { command } = testCase.input as CommandInput;
      expect(validate("hm-notes-command", command), testCase.name).toBe(false);
      checked += 1;
    }
    // An id, a colour and an asset name, in documents and in a command.
    expect(checked).toBeGreaterThan(8);
  });
});

/** Why a reader may refuse a document its schema accepts. */
const BEYOND: Readonly<Record<NotesDocumentFormat, readonly string[]>> = {
  "hm-notes-notebook": ["duplicate-id", "unknown-page"],
  "hm-notes-page": ["duplicate-id", "invalid-points"],
  "hm-notes-library": ["duplicate-id", "unknown-folder"],
  "hm-notes-backup": ["duplicate-id", "unknown-folder"],
};

const VALID: Readonly<Record<NotesDocumentFormat, fc.Arbitrary<unknown>>> = {
  "hm-notes-notebook": notebook.map(toNotesNotebookDocument),
  "hm-notes-page": page.map(toNotesPageDocument),
  "hm-notes-library": library.map(toNotesLibraryDocument),
  "hm-notes-backup": backupManifest,
};

const DOCUMENT_FORMATS = Object.keys(VALID) as NotesDocumentFormat[];

describe("the format schemas agree with the readers", () => {
  it.each(DOCUMENT_FORMATS)("%s: the reader and the schema accept the same documents", (format) => {
    const read = DOCUMENT_READERS[format];
    fc.assert(
      fc.property(fc.oneof(VALID[format], mutated(VALID[format])), (document) => {
        const refused = rejection(() => read(document));
        const errors = documentErrors[format](document);
        if (refused === undefined) {
          expect(errors).toStrictEqual([]);
        } else if (errors.length === 0) {
          // The schema accepts it, so the reader refused it for what a schema can't say.
          expect(refused.code).toBe("INVALID_DOCUMENT");
          if (refused.reason === "malformed-document")
            expect(hasLoneSurrogate(document)).toBe(true);
          else expect(BEYOND[format]).toContain(refused.reason);
        } else {
          // A refusal is one of the reader's two codes, with a reason, whatever the fault.
          expect(["INVALID_DOCUMENT", "UNSUPPORTED_FORMAT"]).toContain(refused.code);
          expect(typeof refused.reason).toBe("string");
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the command reader and the command schema accept the same commands", () => {
    const command = stateAndCommand.map(([, value]) => value as unknown);
    fc.assert(
      fc.property(fc.oneof(command, mutated(command)), (value) => {
        const refused = rejection(() => readNotesCommandDocument(value));
        const errors = commandErrors(value);
        if (refused === undefined) {
          expect(errors).toStrictEqual([]);
        } else {
          // A command's reader has one code, with a reason, whatever the fault.
          expect(refused.code).toBe("INVALID_COMMAND");
          expect(typeof refused.reason).toBe("string");
          if (errors.length > 0) return;
          if (refused.reason === "malformed-command") expect(hasLoneSurrogate(value)).toBe(true);
          else expect(["duplicate-id", "invalid-points"]).toContain(refused.reason);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the command schema accepts every inverse the reducer writes", () => {
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const { inverse } = applyNotesCommand(state, command);
        expect(commandErrors(JSON.parse(JSON.stringify(inverse)))).toStrictEqual([]);
      }),
      { numRuns: 500 },
    );
  });

  it("generate mutated documents the readers accept and refuse often enough to mean something", () => {
    for (const format of DOCUMENT_FORMATS) {
      const sample = fc.sample(mutated(VALID[format]), { numRuns: 500, seed: 1 });
      const share =
        sample.filter((document) => accepts(() => DOCUMENT_READERS[format](document))).length / 500;
      expect(share, format).toBeGreaterThan(0.05);
      expect(share, format).toBeLessThan(0.95);
    }
  });

  it("count text lengths in code points, as the schema's maxLength does", () => {
    const titled = (title: string) => ({
      format: "hm-notes-notebook",
      version: 1,
      id: "nb",
      title,
      cover: "blue",
      createdAt: 0,
      updatedAt: 0,
      pages: [{ id: "p", width: 59_500, height: 84_200, template: "blank" }],
      outline: [],
      recordings: [],
    });
    const read = DOCUMENT_READERS["hm-notes-notebook"];
    const errors = documentErrors["hm-notes-notebook"];
    const fits = titled("\u{1F4D3}".repeat(NOTES_MAX_TITLE_LENGTH));
    const over = titled("\u{1F4D3}".repeat(NOTES_MAX_TITLE_LENGTH + 1));
    expect([accepts(() => read(fits)), errors(fits)]).toStrictEqual([true, []]);
    expect(accepts(() => read(over))).toBe(false);
    expect(errors(over)).not.toStrictEqual([]);
  });
});
