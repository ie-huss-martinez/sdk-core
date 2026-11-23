import { readFileSync } from "node:fs";
import { schemaValidator } from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { NotesDocumentFormat } from "./run.js";

/**
 * The formats' JSON Schemas, compiled for tests (sdk-core ADR 0045, section
 * 6). Validating against them is test-only: at runtime the SDK uses its own
 * readers, which the tests hold to the schemas.
 */

/** Every format with a schema in formats/, at version 1. */
export const FORMATS = [
  "hm-notes-notebook",
  "hm-notes-page",
  "hm-notes-library",
  "hm-notes-backup",
  "hm-notes-command",
] as const;

/** Where a format's schema is. */
export const schemaUrl = (format: (typeof FORMATS)[number]): URL =>
  new URL(`../../formats/${format}/v1.schema.json`, import.meta.url);

/** A format's schema, as JSON. */
export const readSchema = (format: (typeof FORMATS)[number]): Record<string, unknown> =>
  JSON.parse(readFileSync(schemaUrl(format), "utf8")) as Record<string, unknown>;

/** The validation errors of a document against its format's schema, empty when it's valid. */
export const documentErrors: Readonly<Record<NotesDocumentFormat, (value: unknown) => string[]>> = {
  "hm-notes-notebook": schemaValidator(schemaUrl("hm-notes-notebook")),
  "hm-notes-page": schemaValidator(schemaUrl("hm-notes-page")),
  "hm-notes-library": schemaValidator(schemaUrl("hm-notes-library")),
  "hm-notes-backup": schemaValidator(schemaUrl("hm-notes-backup")),
};

// The command schema refers to the page and notebook schemas by their $id,
// so the three are compiled together, as a host does.
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(readSchema("hm-notes-page"));
ajv.addSchema(readSchema("hm-notes-notebook"));
const validateCommand = ajv.compile(readSchema("hm-notes-command"));

/** The validation errors of a command against `hm-notes-command`'s schema, empty when it's valid. */
export function commandErrors(value: unknown): string[] {
  if (validateCommand(value)) return [];
  return (validateCommand.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
}
