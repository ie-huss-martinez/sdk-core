import { SdkError } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { createNotesPdfEngine } from "../../src/adapters/pdf/pdf-engine.js";

/** An error as `@hussmartinez/pdf-sdk` throws it: an `SdkError` named `PdfError`. */
class PdfError extends SdkError<string> {
  override readonly name = "PdfError";
}

/** An engine over a PDF engine and processor that fail the way a test says. */
const failing = (error: unknown) =>
  createNotesPdfEngine({
    engine: {
      open: async () => {
        throw error;
      },
      destroy: async () => undefined,
    },
    processor: {
      build: async () => {
        throw error;
      },
      destroy: async () => undefined,
    },
  });

const assembly = { sources: [{ id: "a", bytes: new Uint8Array() }], pages: [] };

describe("createNotesPdfEngine", () => {
  it("keeps the codes the two SDKs share", async () => {
    for (const code of ["INVALID_PDF", "PASSWORD_REQUIRED", "TOO_MANY_PAGES"]) {
      const engine = failing(new PdfError(code, "from pdf-sdk"));
      await expect(engine.open(new Uint8Array())).rejects.toMatchObject({
        name: "NotesError",
        code,
      });
    }
  });

  it("keeps sdk-core's codes, such as a cancelled call or a crashed worker", async () => {
    for (const code of ["ABORTED", "WORKER_CRASHED", "FILE_TOO_LARGE"]) {
      const engine = failing(new PdfError(code, "from pdf-sdk"));
      await expect(engine.assemble(assembly)).rejects.toMatchObject({ name: "NotesError", code });
    }
  });

  it("gives pdf-sdk's own codes and its bad-request errors the notes SDK's code for the call", async () => {
    for (const error of [
      new PdfError("PROCESSING_FAILED", "qpdf failed"),
      new RangeError("page out of range"),
      new TypeError("unknown source"),
    ]) {
      const engine = failing(error);
      await expect(engine.open(new Uint8Array())).rejects.toMatchObject({
        name: "NotesError",
        code: "INVALID_PDF",
        cause: error,
      });
      await expect(engine.assemble(assembly)).rejects.toMatchObject({
        name: "NotesError",
        code: "EXPORT_FAILED",
        cause: error,
      });
    }
  });

  it("passes an overlay through to the processor, and creates nothing until it's used", async () => {
    const jobs: unknown[] = [];
    const engine = createNotesPdfEngine({
      processor: {
        build: async (job) => {
          jobs.push(job);
          return new Uint8Array([1]);
        },
        destroy: async () => undefined,
      },
    });
    await engine.assemble({
      sources: [
        { id: "ink", bytes: new Uint8Array() },
        { id: "pdf", bytes: new Uint8Array() },
      ],
      pages: [
        { source: "ink", pageIndex: 0 },
        { source: "pdf", pageIndex: 2, overlay: { source: "ink", pageIndex: 1 } },
      ],
    });
    expect(jobs).toEqual([
      expect.objectContaining({
        pages: [
          { source: "ink", pageIndex: 0 },
          { source: "pdf", pageIndex: 2, overlay: { source: "ink", pageIndex: 1 } },
        ],
      }),
    ]);
  });
});
