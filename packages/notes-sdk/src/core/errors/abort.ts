import { createErrorHelpers, type ErrorHelpers } from "@hussmartinez/sdk-core";
import { NotesError } from "./notes-error.js";

let helpers: ErrorHelpers<NotesError> | undefined;

/**
 * The family's error helpers, bound to `NotesError` (sdk-core ADR 0034), so
 * every port and session make failures `NotesError`s the same way. They're
 * made on first use: a call at the top of the module would stay in every
 * bundle that imports anything from the package (sdk-core ADR 0056).
 */
function errorHelpers(): ErrorHelpers<NotesError> {
  helpers ??= createErrorHelpers(NotesError, {
    fallbackCode: "UNKNOWN",
    fallbackMessage: "The notes SDK failed.",
  });
  return helpers;
}

/**
 * Makes any failure a `NotesError`: a `NotesError` as it is, another
 * `SdkError` with its code, details and message kept, and anything else as
 * `UNKNOWN`. The original is kept as `cause`.
 *
 * @internal
 */
export function asNotesError(reason: unknown, message?: string): NotesError {
  return errorHelpers().adapt(reason, message);
}

/**
 * Throws if the signal has been aborted: the reason itself when it's an
 * `SdkError`, `TIMEOUT` for a timeout, and `ABORTED` otherwise.
 *
 * @internal
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  errorHelpers().throwIfAborted(signal);
}
