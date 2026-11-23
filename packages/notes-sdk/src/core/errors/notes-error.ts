import { isSdkError, type SdkCoreErrorCode, SdkError } from "@hussmartinez/sdk-core";

/**
 * Error codes of `@hussmartinez/notes-sdk`: sdk-core's own codes, such as
 * `ABORTED`, `FILE_TOO_LARGE` and `UNSUPPORTED_ENVIRONMENT`, plus the notes
 * SDK's. They never change meaning once released.
 *
 * - `INVALID_DOCUMENT`: a notebook, a page, a library index or a backup
 *   isn't valid in its format. `details.reason` says why, as a stable token
 *   ({@link NotesDocumentRejection}).
 * - `UNSUPPORTED_FORMAT`: a document of another format, or of a later
 *   version than this release reads, with `details.reason`
 *   `unknown-format` or `unknown-format-version`.
 * - `INVALID_COMMAND`: an edit doesn't apply to the notebook, such as one
 *   naming a page it doesn't have. `details.reason` says why
 *   ({@link NotesCommandRejection}).
 * - `NOT_FOUND`: the library has no such notebook, page or file.
 *   `details.kind` names which.
 * - `NOTEBOOK_IN_USE`: the notebook is open in another tab or window.
 * - `STORAGE_FAILED`: the device's storage refused a read or a write.
 *   `details.reason` is `quota` when it's full, and `unavailable` when the
 *   browser gives the page no storage.
 * - `INVALID_PDF`: an imported file isn't a PDF, or is too damaged to open.
 * - `PASSWORD_REQUIRED`: an imported PDF is protected with a password.
 * - `UNSUPPORTED_FILE`: a file isn't of a kind the notebook takes, such as
 *   a picture that isn't PNG, JPEG, WebP or GIF.
 * - `EXPORT_FAILED`: a PDF or a backup couldn't be written. `cause` holds
 *   the reason.
 * - `RECORDING_FAILED`: sound couldn't be recorded. `details.reason` is
 *   `denied` when the microphone was refused, and `unavailable` otherwise.
 * - `TOO_MANY_PAGES`, `TOO_MANY_ITEMS`, `IMAGE_TOO_LARGE`,
 *   `BACKUP_TOO_LARGE`, `TOO_MANY_BACKUP_ENTRIES`: a limit of the file
 *   policy, with `details` naming the `limit`, its `maximum`, the `actual`
 *   value and the `unit`.
 *
 * @public
 */
export type NotesErrorCode =
  | SdkCoreErrorCode
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_COMMAND"
  | "NOT_FOUND"
  | "NOTEBOOK_IN_USE"
  | "STORAGE_FAILED"
  | "INVALID_PDF"
  | "PASSWORD_REQUIRED"
  | "UNSUPPORTED_FILE"
  | "EXPORT_FAILED"
  | "RECORDING_FAILED"
  | "TOO_MANY_PAGES"
  | "TOO_MANY_ITEMS"
  | "IMAGE_TOO_LARGE"
  | "BACKUP_TOO_LARGE"
  | "TOO_MANY_BACKUP_ENTRIES";

/**
 * Why a document was refused, in an `INVALID_DOCUMENT` or
 * `UNSUPPORTED_FORMAT` error's `details.reason` (sdk-core ADR 0045).
 *
 * @public
 */
export type NotesDocumentRejection =
  | "unknown-format"
  | "unknown-format-version"
  | "malformed-document"
  | "malformed-archive"
  | "missing-entry"
  | "asset-mismatch"
  | "invalid-id"
  | "duplicate-id"
  | "invalid-position"
  | "invalid-size"
  | "invalid-color"
  | "invalid-points"
  | "too-many-points"
  | "text-too-long"
  | "invalid-asset"
  | "unknown-page"
  | "unknown-folder"
  | "invalid-time";

/**
 * Why a command was refused, in an `INVALID_COMMAND` error's
 * `details.reason` (sdk-core ADR 0045).
 *
 * @public
 */
export type NotesCommandRejection =
  | NotesDocumentRejection
  | "malformed-command"
  | "unknown-command"
  | "unknown-item"
  | "duplicate-page"
  | "page-not-loaded"
  | "last-page"
  | "invalid-order"
  | "invalid-index";

/**
 * The error `@hussmartinez/notes-sdk` throws and rejects with, with a
 * stable `code`, structured `details` and the underlying error as `cause`.
 * Show users the text for its code from `notesMessages`, never its
 * `message`, which is for developers and may contain text from a file.
 *
 * @example
 * ```ts
 * try {
 *   await library.restore(file);
 * } catch (error) {
 *   if (isNotesError(error, "UNSUPPORTED_FORMAT")) askToUpdate();
 *   else show(messages.error(error));
 * }
 * ```
 *
 * @public
 */
export class NotesError extends SdkError<NotesErrorCode> {
  /** Always `"NotesError"`, which survives minification and worker boundaries. */
  override readonly name = "NotesError";
}

/**
 * Checks whether a value is a {@link NotesError}, optionally with a given
 * code. Unlike `instanceof`, it recognises errors from another copy of this
 * package or another realm.
 *
 * @param value - Any thrown value.
 * @param code - When given, the error must also have this code.
 * @public
 */
export function isNotesError<Code extends NotesErrorCode = NotesErrorCode>(
  value: unknown,
  code?: Code,
): value is NotesError & { readonly code: Code } {
  return isSdkError(value, code) && value.name === "NotesError";
}

/** An `INVALID_DOCUMENT` error with its reason, and where in the document. */
export function invalidDocument(reason: NotesDocumentRejection, at: string): NotesError {
  return new NotesError("INVALID_DOCUMENT", `The document is invalid at ${at}: ${reason}.`, {
    details: { reason, at },
  });
}

/** An `INVALID_COMMAND` error with its reason. */
export function invalidCommand(reason: NotesCommandRejection, message: string): NotesError {
  return new NotesError("INVALID_COMMAND", message, { details: { reason } });
}

/** An `UNSUPPORTED_FORMAT` error with its reason. */
export function unsupportedFormat(
  reason: "unknown-format" | "unknown-format-version",
  message: string,
): NotesError {
  return new NotesError("UNSUPPORTED_FORMAT", message, { details: { reason } });
}
