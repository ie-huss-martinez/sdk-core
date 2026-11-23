import { PDFDict, PDFDocument, PDFName, PDFTextField } from "@cantoo/pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describePdfProcessorContract } from "../../../test/contracts/pdf-processor.contract.js";
import { inspectPdf } from "../../../test/fixtures/inspect.js";
import { formPdf, LINKS, pagesPdf, reportPdf } from "../../../test/fixtures/pdfs.js";
import { PdfError } from "../../core/errors/pdf-error.js";
import type { PdfBuildProgress } from "../../core/model/build-job.js";
import type { PdfProcessor } from "../../core/ports/pdf-processor.js";
import { runBuild } from "./build.js";
import { inlinedWasm, loadToolkit } from "./toolkit.js";

/**
 * The pipeline the processing worker runs, called in process, so the
 * contract runs quickly in Node. The browser tests run it through the worker.
 */
function inProcessProcessor(): PdfProcessor {
  let destroyed = false;
  return {
    async build(job, options = {}) {
      if (destroyed) throw new PdfError("WORKER_TERMINATED", "Destroyed.");
      return runBuild(job, {
        toolkit: () => loadToolkit(inlinedWasm),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onProgress ? { progress: options.onProgress } : {}),
      });
    },
    async destroy() {
      destroyed = true;
    },
  };
}

describePdfProcessorContract("qpdf pipeline, in process", {
  createProcessor: inProcessProcessor,
  pages: pagesPdf,
  form: formPdf,
  inspect: inspectPdf,
});

describe("the qpdf pipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads qpdf and builds without calling fetch (docs/adr/0001)", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("fetch was called")));
    vi.stubGlobal("fetch", fetch);
    const output = await inProcessProcessor().build({
      sources: [{ id: "a", bytes: await pagesPdf([{ width: 612, height: 792 }]) }],
      pages: [{ source: "a", pageIndex: 0, rotation: 90 }],
      compress: {},
      encrypt: { userPassword: "secret" },
    });
    expect(output.byteLength).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an encrypted source with PASSWORD_REQUIRED", async () => {
    const locked = await inProcessProcessor().build({
      sources: [{ id: "a", bytes: await pagesPdf([{ width: 612, height: 792 }]) }],
      pages: [{ source: "a", pageIndex: 0 }],
      encrypt: { userPassword: "secret" },
    });
    await expect(
      inProcessProcessor().build({
        sources: [{ id: "a", bytes: locked }],
        pages: [{ source: "a", pageIndex: 0 }],
      }),
    ).rejects.toMatchObject({ name: "PdfError", code: "PASSWORD_REQUIRED" });
  });

  it("keeps sources the plan doesn't use out of the work, even unreadable ones", async () => {
    const output = await inProcessProcessor().build({
      sources: [
        { id: "a", bytes: await pagesPdf([{ width: 400, height: 400 }]) },
        { id: "unused", bytes: new TextEncoder().encode("not a PDF") },
      ],
      pages: [{ source: "a", pageIndex: 0 }],
    });
    expect((await inspectPdf(output)).pages).toEqual([{ width: 400, height: 400, rotation: 0 }]);
  });

  it("says plainly that flattening and image recompression aren't supported yet", async () => {
    const bytes = await pagesPdf([{ width: 612, height: 792 }]);
    const note = {
      id: "n",
      type: "text" as const,
      at: { x: 0.1, y: 0.1 },
      text: "Hi",
      size: 0.02,
      color: "#000000" as const,
    };
    await expect(
      inProcessProcessor().build({
        sources: [{ id: "a", bytes }],
        pages: [{ source: "a", pageIndex: 0, annotations: [note] }],
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
    await expect(
      inProcessProcessor().build({
        sources: [{ id: "a", bytes }],
        pages: [{ source: "a", pageIndex: 0 }],
        compress: { images: { quality: 0.7, maxDimension: 1600 } },
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_FAILED" });
  });
});

/** What each page carries besides its content: its links, and its text fields' values. */
async function interactiveByPage(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages().map((page) => {
    const annotations = page.node.Annots();
    const subtypes = Array.from({ length: annotations?.size() ?? 0 }, (_, index) =>
      annotations?.lookup(index, PDFDict).get(PDFName.of("Subtype")),
    );
    const links = subtypes.filter((subtype) => subtype === PDFName.of("Link")).length;
    return { annotations, links, text: [] as string[] };
  });
  for (const field of document.getForm().getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    for (const widget of field.acroField.getWidgets()) {
      const ref = document.context.getObjectRef(widget.dict);
      const page = pages.find(({ annotations }) => ref && annotations?.indexOf(ref) !== undefined);
      page?.text.push(field.getText() ?? "");
    }
  }
  return pages.map(({ links, text }) => ({ links, text }));
}

describe("page overlays in the qpdf pipeline (docs/adr/0011)", () => {
  const A4 = { width: 595, height: 842 };
  const LETTER = { width: 612, height: 792 };
  const SQUARE = { width: 400, height: 400 };
  const toolkit = () => loadToolkit(inlinedWasm);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses an overlay from an unknown source before qpdf starts", async () => {
    const start = vi.fn(toolkit);
    await expect(
      runBuild(
        {
          sources: [{ id: "a", bytes: await pagesPdf([A4]) }],
          pages: [{ source: "a", pageIndex: 0, overlay: { source: "b", pageIndex: 0 } }],
        },
        { toolkit: start },
      ),
    ).rejects.toThrow(TypeError);
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses an overlay page outside its source before assembling anything", async () => {
    const merge = vi.spyOn(await toolkit(), "merge");
    await expect(
      runBuild(
        {
          sources: [
            { id: "a", bytes: await pagesPdf([A4, A4]) },
            { id: "b", bytes: await pagesPdf([A4]) },
          ],
          pages: [
            { source: "a", pageIndex: 1 },
            { source: "a", pageIndex: 0, overlay: { source: "b", pageIndex: 1 } },
          ],
        },
        { toolkit },
      ),
    ).rejects.toThrow(RangeError);
    expect(merge).not.toHaveBeenCalled();
  });

  it("normalises a source that only an overlay uses, and still skips unused ones", async () => {
    const repair = vi.spyOn(await toolkit(), "repair");
    const output = await runBuild(
      {
        sources: [
          { id: "a", bytes: await pagesPdf([A4]) },
          { id: "ink", bytes: await pagesPdf([A4]) },
          { id: "unused", bytes: new TextEncoder().encode("not a PDF") },
        ],
        pages: [{ source: "a", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } }],
      },
      { toolkit },
    );
    expect(repair).toHaveBeenCalledTimes(2);
    expect((await inspectPdf(output)).pages).toEqual([{ ...A4, rotation: 0 }]);
  });

  it("draws every overlay in one qpdf pass, from a stamp in the order of the pages", async () => {
    const watermark = vi.spyOn(await toolkit(), "watermark");
    await runBuild(
      {
        sources: [
          { id: "a", bytes: await pagesPdf([A4, A4, A4]) },
          { id: "b", bytes: await pagesPdf([SQUARE, LETTER]) },
        ],
        pages: [
          { source: "a", pageIndex: 0, overlay: { source: "b", pageIndex: 1 } },
          { source: "a", pageIndex: 1 },
          { source: "a", pageIndex: 2, overlay: { source: "b", pageIndex: 0 } },
        ],
      },
      { toolkit },
    );
    expect(watermark).toHaveBeenCalledTimes(1);
    const [, stamp, options] = watermark.mock.calls[0] ?? [];
    // qpdf draws the first page of `from` over the first page of `to`, and so on.
    expect(options).toEqual({ mode: "overlay", to: "1,3", from: "1-z" });
    expect((await inspectPdf(stamp as Uint8Array)).pages).toEqual([
      { ...LETTER, rotation: 0 },
      { ...SQUARE, rotation: 0 },
    ]);
  });

  it("puts each overlay on its own page, with the overlay page's links and filled fields", async () => {
    const form = await formPdf();
    const output = await runBuild(
      {
        sources: [
          { id: "a", bytes: await pagesPdf([LETTER, LETTER, LETTER, LETTER]) },
          { id: "ada", bytes: form, formValues: { name: "Ada" } },
          { id: "grace", bytes: form, formValues: { name: "Grace" } },
          { id: "report", bytes: await reportPdf() },
        ],
        pages: [
          { source: "a", pageIndex: 0, overlay: { source: "grace", pageIndex: 0 } },
          { source: "a", pageIndex: 1 },
          { source: "a", pageIndex: 2, overlay: { source: "ada", pageIndex: 0 } },
          { source: "a", pageIndex: 3, overlay: { source: "report", pageIndex: 0 } },
        ],
      },
      { toolkit },
    );
    // What qpdf does, recorded in docs/adr/0011: links and fields come along.
    expect(await interactiveByPage(output)).toEqual([
      { links: 0, text: ["Grace"] },
      { links: 0, text: [] },
      { links: 0, text: ["Ada"] },
      { links: LINKS.length, text: [""] },
    ]);
  });

  it("keeps a whole document as it is under its overlays, with its title", async () => {
    const titled = await PDFDocument.create();
    titled.setTitle("Minutes");
    titled.addPage([A4.width, A4.height]);
    titled.addPage([A4.width, A4.height]);
    const merge = vi.spyOn(await toolkit(), "merge");
    const output = await runBuild(
      {
        sources: [
          { id: "a", bytes: await titled.save() },
          { id: "ink", bytes: await pagesPdf([A4]) },
        ],
        pages: [
          { source: "a", pageIndex: 0 },
          { source: "a", pageIndex: 1, overlay: { source: "ink", pageIndex: 0 } },
        ],
      },
      { toolkit },
    );
    // The only merge is the stamp's: the document itself isn't reassembled.
    expect(merge).toHaveBeenCalledTimes(1);
    expect((await PDFDocument.load(output, { updateMetadata: false })).getTitle()).toBe("Minutes");
  });

  it("reports the overlay step after assembling, and only for a job with overlays", async () => {
    const watermark = vi.spyOn(await toolkit(), "watermark");
    const bytes = await pagesPdf([A4]);
    const steps = async (overlay?: { source: string; pageIndex: number }) => {
      const progress: PdfBuildProgress[] = [];
      await runBuild(
        {
          sources: [{ id: "a", bytes }],
          pages: [{ source: "a", pageIndex: 0, ...(overlay ? { overlay } : {}) }],
          compress: {},
          encrypt: { userPassword: "secret" },
        },
        { toolkit, progress: (value) => progress.push(value) },
      );
      return progress;
    };

    expect(await steps()).toEqual([
      { step: "fill", fraction: 1 / 4 },
      { step: "assemble", fraction: 2 / 4 },
      { step: "compress", fraction: 3 / 4 },
      { step: "encrypt", fraction: 1 },
    ]);
    expect(watermark).not.toHaveBeenCalled();
    expect(await steps({ source: "a", pageIndex: 0 })).toEqual([
      { step: "fill", fraction: 1 / 5 },
      { step: "assemble", fraction: 2 / 5 },
      { step: "overlay", fraction: 3 / 5 },
      { step: "compress", fraction: 4 / 5 },
      { step: "encrypt", fraction: 1 },
    ]);
    expect(watermark).toHaveBeenCalledTimes(1);
  });

  it("stops before drawing when the build is cancelled after assembling", async () => {
    const watermark = vi.spyOn(await toolkit(), "watermark");
    const controller = new AbortController();
    await expect(
      runBuild(
        {
          sources: [{ id: "a", bytes: await pagesPdf([A4]) }],
          pages: [{ source: "a", pageIndex: 0, overlay: { source: "a", pageIndex: 0 } }],
        },
        {
          toolkit,
          signal: controller.signal,
          progress: ({ step }) => {
            if (step === "assemble") controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ name: "PdfError", code: "ABORTED" });
    expect(watermark).not.toHaveBeenCalled();
  });

  it("reports a failure to draw as PROCESSING_FAILED, with qpdf's error as the cause", async () => {
    const failure = new Error("qpdf failed");
    vi.spyOn(await toolkit(), "watermark").mockRejectedValue(failure);
    await expect(
      runBuild(
        {
          sources: [{ id: "a", bytes: await pagesPdf([A4]) }],
          pages: [{ source: "a", pageIndex: 0, overlay: { source: "a", pageIndex: 0 } }],
        },
        { toolkit },
      ),
    ).rejects.toMatchObject({ name: "PdfError", code: "PROCESSING_FAILED", cause: failure });
  });
});
