import { describe, expect, it } from "vitest";
import { PdfError } from "../../core/errors/pdf-error.js";
import { fromPdfJsError } from "./errors.js";

/** pdf.js's exceptions arrive from its worker as plain objects with a name. */
const exception = (name: string) => Object.assign(new Error("from pdf.js"), { name });

describe("fromPdfJsError", () => {
  it.each([
    ["PasswordException", "PASSWORD_REQUIRED"],
    ["InvalidPDFException", "INVALID_PDF"],
    ["FormatError", "INVALID_PDF"],
    ["MissingPDFException", "INVALID_PDF"],
    ["UnknownErrorException", "PROCESSING_FAILED"],
  ])("maps %s to %s, keeping it as cause", (name, code) => {
    const reason = exception(name);
    const error = fromPdfJsError(reason, "It failed.");
    expect(error).toMatchObject({ name: "PdfError", code, cause: reason });
  });

  it("tells a missing password from a wrong one by pdf.js's PasswordResponses", () => {
    // PasswordResponses.NEED_PASSWORD is 1 and INCORRECT_PASSWORD is 2.
    const need = Object.assign(exception("PasswordException"), { code: 1 });
    const incorrect = Object.assign(exception("PasswordException"), { code: 2 });
    expect(fromPdfJsError(need, "It failed.")).toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect(fromPdfJsError(need, "It failed.")).not.toHaveProperty("details");
    expect(fromPdfJsError(incorrect, "It failed.")).toMatchObject({
      code: "PASSWORD_REQUIRED",
      details: { reason: "incorrect-password" },
      cause: incorrect,
    });
  });

  it("maps anything else to PROCESSING_FAILED with the given message", () => {
    expect(fromPdfJsError("a string", "Rendering failed.")).toMatchObject({
      code: "PROCESSING_FAILED",
      message: "Rendering failed.",
    });
  });

  it("passes PdfError and RangeError through unchanged", () => {
    const pdfError = new PdfError("ABORTED", "Stopped.");
    const rangeError = new RangeError("Bad index.");
    expect(fromPdfJsError(pdfError, "x")).toBe(pdfError);
    expect(fromPdfJsError(rangeError, "x")).toBe(rangeError);
  });
});
