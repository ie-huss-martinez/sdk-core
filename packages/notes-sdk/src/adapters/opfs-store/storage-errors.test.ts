import { describe, expect, it } from "vitest";
import { invalidDocument, NotesError } from "../../core/errors/notes-error.js";
import { isNotFound, missingStorageFeature, storageFailure } from "./storage-errors.js";

describe("storageFailure", () => {
  it("returns a NotesError as it is", () => {
    const refused = invalidDocument("malformed-document", "$");
    expect(storageFailure(refused)).toBe(refused);
    expect(storageFailure(refused, true)).toBe(refused);
  });

  it.each([
    ["a QuotaExceededError", new DOMException("full", "QuotaExceededError")],
    [
      "an error named QuotaExceededError",
      Object.assign(new Error("full"), { name: "QuotaExceededError" }),
    ],
  ])("makes %s a full disk", (_, cause) => {
    const error = storageFailure(cause);
    expect(error).toBeInstanceOf(NotesError);
    expect(error).toMatchObject({ code: "STORAGE_FAILED", details: { reason: "quota" }, cause });
  });

  it("recognises a full disk by the exception's code", () => {
    expect(new DOMException("full", "QuotaExceededError").code).toBe(22);
    const legacy = new DOMException("full", "QuotaExceededError");
    Object.defineProperty(legacy, "name", { value: "NS_ERROR_DOM_QUOTA_REACHED" });
    expect(storageFailure(legacy)).toMatchObject({ details: { reason: "quota" } });
    // A code of 22 on something that isn't a DOMException means nothing.
    expect(storageFailure({ code: 22 }).details).toBeUndefined();
  });

  it("says a full disk is full even while opening the storage", () => {
    const cause = new DOMException("full", "QuotaExceededError");
    expect(storageFailure(cause, true)).toMatchObject({ details: { reason: "quota" } });
  });

  it("makes a SecurityError storage the browser doesn't give", () => {
    const cause = new DOMException("no", "SecurityError");
    expect(storageFailure(cause)).toMatchObject({
      code: "STORAGE_FAILED",
      details: { reason: "unavailable" },
      cause,
    });
  });

  it("makes any failure to open the storage storage the browser doesn't give", () => {
    const cause = new DOMException("no", "UnknownError");
    expect(storageFailure(cause, true)).toMatchObject({
      code: "STORAGE_FAILED",
      details: { reason: "unavailable" },
      cause,
    });
  });

  it.each([
    ["a DOMException", new DOMException("no", "InvalidStateError")],
    ["an Error", new TypeError("no")],
    ["a string", "no"],
    ["nothing", undefined],
  ])("makes %s a storage failure without a reason, keeping it as the cause", (_, cause) => {
    const error = storageFailure(cause);
    expect(error.code).toBe("STORAGE_FAILED");
    expect(error.details).toBeUndefined();
    expect(error.cause).toBe(cause);
  });
});

describe("isNotFound", () => {
  it("tells a missing file from another failure", () => {
    expect(isNotFound(new DOMException("gone", "NotFoundError"))).toBe(true);
    expect(isNotFound(new DOMException("no", "TypeMismatchError"))).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe("missingStorageFeature", () => {
  it("names the file system first where there is no browser", () => {
    expect(missingStorageFeature()).toBe("navigator.storage.getDirectory");
  });
});
