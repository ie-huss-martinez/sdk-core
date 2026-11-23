import { isNotesError, NotesError } from "../../core/errors/notes-error.js";

/** The name of a thrown value, if it has one, as a `DOMException` does. */
function nameOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  return typeof error.name === "string" ? error.name : undefined;
}

/** `DOMException.QUOTA_EXCEEDED_ERR`, which older browsers set on an error of another name. */
const QUOTA_EXCEEDED_CODE = 22;

function isQuotaError(error: unknown): boolean {
  if (nameOf(error) === "QuotaExceededError") return true;
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.code === QUOTA_EXCEEDED_CODE
  );
}

/** Whether a failure says that the file or folder asked for isn't there. */
export function isNotFound(error: unknown): boolean {
  return nameOf(error) === "NotFoundError";
}

/** Whether a failure is of the given `DOMException` name. */
export function isNamed(error: unknown, name: string): boolean {
  return nameOf(error) === name;
}

/**
 * Makes a failure of the browser's storage a `NotesError`.
 *
 * - A `NotesError` is returned as it is: a stored document its reader
 *   refused keeps the reader's own code and reason.
 * - A full disk is `STORAGE_FAILED` with the reason `quota`.
 * - A `SecurityError`, or any failure to open the storage at all, is
 *   `STORAGE_FAILED` with the reason `unavailable`: some private modes give
 *   a page no storage.
 * - Anything else is `STORAGE_FAILED`.
 *
 * The original is kept as `cause`. Nothing of it goes into `details`, since
 * a browser's message can name a file.
 *
 * @param error - What the browser threw.
 * @param opening - Whether it was thrown while opening the storage.
 */
export function storageFailure(error: unknown, opening = false): NotesError {
  if (isNotesError(error)) return error;
  if (isQuotaError(error)) {
    return new NotesError("STORAGE_FAILED", "The device's storage is full.", {
      details: { reason: "quota" },
      cause: error,
    });
  }
  if (opening || isNamed(error, "SecurityError")) {
    return new NotesError("STORAGE_FAILED", "The browser gives this page no storage.", {
      details: { reason: "unavailable" },
      cause: error,
    });
  }
  return new NotesError("STORAGE_FAILED", "The device's storage failed.", { cause: error });
}

/**
 * The first browser feature the store needs that is missing, or `undefined`
 * when all are there. Looked up when called, never on import, so the store
 * can be created on a server.
 */
export function missingStorageFeature(): string | undefined {
  // Read through `globalThis`: where a feature is missing, its name isn't even declared.
  const scope = globalThis as {
    readonly navigator?: { readonly storage?: { readonly getDirectory?: unknown } };
    readonly FileSystemFileHandle?: { readonly prototype?: { readonly createWritable?: unknown } };
    readonly indexedDB?: unknown;
  };
  if (typeof scope.navigator?.storage?.getDirectory !== "function") {
    return "navigator.storage.getDirectory";
  }
  // Without it a file can only be written in place, where a failure leaves half a file.
  if (typeof scope.FileSystemFileHandle?.prototype?.createWritable !== "function") {
    return "FileSystemFileHandle.createWritable";
  }
  if (typeof scope.indexedDB !== "object" || scope.indexedDB === null) return "indexedDB";
  return undefined;
}

/** Throws `UNSUPPORTED_ENVIRONMENT`, naming the feature, if the browser lacks one the store needs. */
export function checkStorageFeatures(): void {
  const feature = missingStorageFeature();
  if (feature === undefined) return;
  throw new NotesError(
    "UNSUPPORTED_ENVIRONMENT",
    `This browser can't keep notebooks on the device: ${feature} is missing.`,
    { details: { feature } },
  );
}
