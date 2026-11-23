import {
  coreLimits,
  defineLimits,
  type FilePolicy,
  type FilePolicyOverrides,
  type Limits,
} from "@hussmartinez/sdk-core";
import { NotesError } from "./notes-error.js";

/**
 * The notes SDK's limit definitions: sdk-core's core limits, which bound
 * each imported PDF and picture, plus five of its own (docs/adr/0004).
 *
 * | Limit | Code | Default maximum | Default warning |
 * |---|---|---|---|
 * | `maxFileSize` | `FILE_TOO_LARGE` | 100 MB | 50 MB |
 * | `maxFiles` | `TOO_MANY_FILES` | 20 | none |
 * | `maxDecodedSize` | `DECODED_SIZE_TOO_LARGE` | 500 MB | none |
 * | `maxProcessingTime` | `PROCESSING_TIME_EXCEEDED` | 120 s | none |
 * | `maxPages` | `TOO_MANY_PAGES` | 5,000 | 1,000 |
 * | `maxPageItems` | `TOO_MANY_ITEMS` | 50,000 | 20,000 |
 * | `maxImagePixels` | `IMAGE_TOO_LARGE` | 50 megapixels | none |
 * | `maxBackupSize` | `BACKUP_TOO_LARGE` | 4 GB | 1 GB |
 * | `maxBackupEntries` | `TOO_MANY_BACKUP_ENTRIES` | 500,000 | none |
 *
 * Sizes are decimal: 1 MB is 1,000,000 bytes. `maxBackupSize` bounds both a
 * backup file and what it holds once read.
 *
 * @public
 */
export const notesLimitDefinitions = /* @__PURE__ */ (() =>
  ({
    ...coreLimits,
    maxPages: { code: "TOO_MANY_PAGES", unit: "count", default: 5_000, warning: 1_000 },
    maxPageItems: { code: "TOO_MANY_ITEMS", unit: "count", default: 50_000, warning: 20_000 },
    maxImagePixels: { code: "IMAGE_TOO_LARGE", unit: "pixels", default: 50_000_000 },
    maxBackupSize: {
      code: "BACKUP_TOO_LARGE",
      unit: "bytes",
      default: 4_000_000_000,
      warning: 1_000_000_000,
    },
    maxBackupEntries: { code: "TOO_MANY_BACKUP_ENTRIES", unit: "count", default: 500_000 },
  }) as const)();

/**
 * The type of {@link notesLimitDefinitions}.
 *
 * @public
 */
export type NotesLimitDefinitions = typeof notesLimitDefinitions;

/**
 * The names of the notes SDK's limits.
 *
 * @public
 */
export type NotesLimitName = keyof NotesLimitDefinitions;

/**
 * A host's `filePolicy`: a new maximum, or `{ maximum, warning }`, for any
 * of the notes SDK's limits. `Infinity` disables a maximum, which removes a
 * protection against hostile files, or disables a warning. Unknown limit
 * names throw `TypeError` when the policy is resolved.
 *
 * @example
 * ```ts
 * const filePolicy: NotesFilePolicyOverrides = {
 *   maxFileSize: { maximum: 300e6, warning: 100e6 },
 * };
 * ```
 *
 * @public
 */
export type NotesFilePolicyOverrides = FilePolicyOverrides<NotesLimitDefinitions>;

/**
 * A resolved file policy for the notes SDK. Violations throw `NotesError`.
 *
 * @public
 */
export type NotesFilePolicy = FilePolicy<NotesLimitDefinitions>;

/**
 * The notes SDK's limits, ready to resolve a host's `filePolicy`.
 * Violations are thrown as `NotesError`, with `details` naming the limit.
 *
 * @example
 * ```ts
 * const policy = notesLimits.resolve(props.filePolicy);
 * policy.check("maxPages", pageCount); // throws NotesError("TOO_MANY_PAGES") above 5,000
 * ```
 *
 * @public
 */
export const notesLimits: Limits<NotesLimitDefinitions> = /* @__PURE__ */ defineLimits(
  notesLimitDefinitions,
  { errorClass: NotesError },
);
