import {
  invalidDocument,
  type NotesDocumentRejection,
  unsupportedFormat,
} from "../errors/notes-error.js";
import { isAssetName, isNotesId } from "../model/ids.js";
import type { NotesAssetReference, NotesColor } from "../model/items.js";

/**
 * Strict readers for untrusted JSON (sdk-core ADR 0045): every value is
 * checked, an unknown field is refused, and nothing is read through a
 * prototype. A failure throws `INVALID_DOCUMENT` with a stable reason and
 * the path of the value, never the value itself.
 */

/** A JSON object's own fields, after checking it has only the names allowed. */
export function fields(
  value: unknown,
  at: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidDocument("malformed-document", at);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidDocument("malformed-document", at);
  }
  const names = Object.keys(value);
  for (const name of names) {
    if (!required.includes(name) && !optional.includes(name)) {
      throw invalidDocument("malformed-document", `${at}.${printable(name)}`);
    }
  }
  for (const name of required) {
    if (!Object.hasOwn(value, name)) throw invalidDocument("malformed-document", `${at}.${name}`);
  }
  // A copy without a prototype, so a field named after one of Object's is just a field.
  return Object.assign(Object.create(null), value) as Record<string, unknown>;
}

/** A field name as it may appear in an error: short, and only plain characters. */
function printable(name: string): string {
  return /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : "?";
}

export function list(value: unknown, at: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalidDocument("malformed-document", at);
  }
  return value;
}

/** An integer within bounds. JSON has no integers, so `1.0` and `1` are the same number. */
export function integer(
  value: unknown,
  at: string,
  minimum: number,
  maximum: number,
  reason: NotesDocumentRejection = "malformed-document",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalidDocument(reason, at);
  }
  // Never negative zero, which JSON can carry and `===` can't tell apart.
  return value === 0 ? 0 : value;
}

/** A string of at most `maximum` Unicode code points, with no lone surrogate. */
export function text(
  value: unknown,
  at: string,
  maximum: number,
  reason: NotesDocumentRejection = "malformed-document",
): string {
  if (typeof value !== "string") throw invalidDocument("malformed-document", at);
  // Cheap bound first: a string has at least half as many code points as units.
  if (value.length > maximum * 2 || countCodePoints(value) > maximum) {
    throw invalidDocument(reason, at);
  }
  if (LONE_SURROGATE.test(value)) throw invalidDocument("malformed-document", at);
  return value;
}

/** Half of a surrogate pair on its own, which isn't text and can't be written as UTF-8. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export function oneOf<const Options extends readonly string[]>(
  value: unknown,
  at: string,
  options: Options,
): Options[number] {
  if (typeof value !== "string" || !options.includes(value)) {
    throw invalidDocument("malformed-document", at);
  }
  return value;
}

export function id(value: unknown, at: string): string {
  if (!isNotesId(value)) throw invalidDocument("invalid-id", at);
  return value;
}

export function idOrNull(value: unknown, at: string): string | null {
  return value === null ? null : id(value, at);
}

const COLOR = /^#[0-9a-f]{6}$/;

export function color(value: unknown, at: string): NotesColor {
  if (typeof value !== "string" || !COLOR.test(value)) throw invalidDocument("invalid-color", at);
  return value as NotesColor;
}

/** The longest time the model holds: the year 275760, the last a `Date` can show. */
export const MAX_TIME = 8_640_000_000_000_000;

export function time(value: unknown, at: string): number {
  return integer(value, at, 0, MAX_TIME, "invalid-time");
}

export function timeOrNull(value: unknown, at: string): number | null {
  return value === null ? null : time(value, at);
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,62}$/;

export function assetReference(
  value: unknown,
  at: string,
  mediaTypes: readonly string[],
): NotesAssetReference {
  const entry = fields(value, at, ["asset", "mediaType", "size"]);
  if (!isAssetName(entry["asset"])) throw invalidDocument("invalid-asset", `${at}.asset`);
  const mediaType = entry["mediaType"];
  if (
    typeof mediaType !== "string" ||
    !MEDIA_TYPE.test(mediaType) ||
    !mediaTypes.includes(mediaType)
  ) {
    throw invalidDocument("invalid-asset", `${at}.mediaType`);
  }
  return {
    asset: entry["asset"],
    mediaType,
    size: integer(entry["size"], `${at}.size`, 0, Number.MAX_SAFE_INTEGER, "invalid-asset"),
  };
}

/** Checks a document's `format` and `version`, before anything else is read. */
export function header(value: unknown, format: string, version: number): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidDocument("malformed-document", "$");
  }
  const found = value as { readonly format?: unknown; readonly version?: unknown };
  const foundFormat = Object.hasOwn(value, "format") ? found.format : undefined;
  const foundVersion = Object.hasOwn(value, "version") ? found.version : undefined;
  if (foundFormat !== format) {
    throw unknownFormat();
  }
  if (typeof foundVersion !== "number" || !Number.isSafeInteger(foundVersion) || foundVersion < 1) {
    throw invalidDocument("malformed-document", "$.version");
  }
  if (foundVersion > version) {
    throw laterVersion();
  }
}

function unknownFormat() {
  return unsupportedFormat("unknown-format", "The document isn't in the expected format.");
}

function laterVersion() {
  return unsupportedFormat(
    "unknown-format-version",
    "The document was written by a later version of the format.",
  );
}
