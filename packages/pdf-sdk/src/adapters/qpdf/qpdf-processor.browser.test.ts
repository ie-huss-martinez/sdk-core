import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { describePdfProcessorContract } from "../../../test/contracts/pdf-processor.contract.js";
import { inspectPdf } from "../../../test/fixtures/inspect.js";
import { formPdf, pagesPdf, SHAPE_COLOURS, shapesPdf } from "../../../test/fixtures/pdfs.js";
import { isPdfError } from "../../core/errors/pdf-error.js";
import type { PdfBuildJob } from "../../core/model/build-job.js";
import type { PdfEngine } from "../../core/ports/pdf-engine.js";
import type { PdfProcessor } from "../../core/ports/pdf-processor.js";
import { createPdfJsEngine } from "../pdfjs/pdfjs-engine.js";
import { createPdfProcessor } from "./qpdf-processor.js";

describePdfProcessorContract("qpdf processor in its worker", {
  createProcessor: createPdfProcessor,
  pages: pagesPdf,
  form: formPdf,
  inspect: inspectPdf,
});

describe("the qpdf processor", () => {
  it("makes no requests but loading its own code (docs/adr/0002)", async () => {
    const processor = createPdfProcessor();
    const bytes = await pagesPdf([{ width: 612, height: 792 }]);
    // Load the processor's code and start its worker before recording.
    await processor.build({
      sources: [{ id: "a", bytes }],
      pages: [{ source: "a", pageIndex: 0 }],
    });

    await commands.startRecordingRequests();
    const output = await processor.build({
      sources: [
        { id: "a", bytes },
        { id: "form", bytes: await formPdf(), formValues: { name: "Ada", agree: true } },
      ],
      pages: [
        { source: "form", pageIndex: 0 },
        { source: "a", pageIndex: 0, rotation: 90 },
      ],
      compress: {},
      encrypt: { userPassword: "secret" },
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const requests = await commands.stopRecordingRequests();
    await processor.destroy();

    const ownCode = ({ url, type }: { url: string; type: string }) =>
      type === "script" && new URL(url).origin === location.origin;
    expect(requests.filter((request) => !ownCode(request))).toEqual([]);
    expect((await inspectPdf(output, "secret")).fields).toEqual({ name: "Ada", agree: true });
  });

  it("rejects a cancelled build with ABORTED, and keeps working", async () => {
    const processor = createPdfProcessor();
    const bytes = await pagesPdf([{ width: 612, height: 792 }]);
    const job = { sources: [{ id: "a", bytes }], pages: [{ source: "a", pageIndex: 0 }] };
    const controller = new AbortController();
    const building = processor.build({ ...job, compress: {} }, { signal: controller.signal });
    controller.abort();
    await expect(building).rejects.toSatisfy((error) => isPdfError(error, "ABORTED"));
    await expect(processor.build(job)).resolves.toBeInstanceOf(Uint8Array);
    await processor.destroy();
  });
});

describe("the qpdf processor with self-hosted assets (docs/adr/0007)", () => {
  const job = async () => ({
    sources: [{ id: "a", bytes: await pagesPdf([{ width: 612, height: 792 }]) }],
    pages: [{ source: "a", pageIndex: 0, rotation: 90 as const }],
    encrypt: { userPassword: "secret" },
  });

  it("loads its worker and qpdf.wasm only from assetsUrl", async () => {
    // The test server serves exactly what the build writes to dist/assets.
    const assetsUrl = new URL("/hm-test-assets/", location.href).href;
    const processor = createPdfProcessor({ assetsUrl });
    const built = await job();
    await commands.startRecordingRequests();
    const output = await processor.build(built);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const requests = await commands.stopRecordingRequests();
    await processor.destroy();

    expect((await inspectPdf(output, "secret")).pages).toEqual([
      { width: 612, height: 792, rotation: 90 },
    ]);
    expect(requests.map(({ url }) => url).sort()).toEqual([
      `${assetsUrl}processing/processing.worker.js`,
      `${assetsUrl}processing/qpdf.wasm`,
    ]);
  });

  it("refuses a qpdf.wasm that isn't this version's, with WORKER_START_FAILED", async () => {
    const processor = createPdfProcessor({ assetsUrl: "/hm-test-assets-tampered/" });
    await expect(processor.build(await job())).rejects.toSatisfy(
      (error) =>
        isPdfError(error, "WORKER_START_FAILED") &&
        (error.details as { asset?: string } | undefined)?.asset === "qpdf.wasm",
    );
    await processor.destroy();
  });

  it("refuses a worker from another version of the package, naming it (sdk-core ADR 0038)", async () => {
    // A host that upgraded without copying dist/assets/ again serves this.
    const assetsUrl = new URL("/hm-test-assets-stale/", location.href).href;
    const processor = createPdfProcessor({ assetsUrl });
    await expect(processor.build(await job())).rejects.toSatisfy(
      (error) =>
        isPdfError(error, "WORKER_START_FAILED") &&
        JSON.stringify(error.details) ===
          JSON.stringify({
            asset: `${assetsUrl}processing/processing.worker.js`,
            expected: __PDF_SDK_VERSION__,
            actual: "0.0.0-stale",
          }),
    );
    await processor.destroy();
  });
});

/**
 * What qpdf's overlay really draws, read from pixels: each job is built by
 * the processor, opened with the SDK's own engine and drawn at one pixel per
 * point, so `(x, y)` is a point of the page as displayed, from its top-left
 * corner. Shapes are placed in points from a page's bottom-left corner.
 */
describe("page overlays, as drawn (docs/adr/0011)", () => {
  const PAGE = { width: 400, height: 600 };
  const COLOURS = { ...SHAPE_COLOURS, white: [255, 255, 255] } as const;
  let processor: PdfProcessor;
  let engine: PdfEngine;

  beforeAll(() => {
    processor = createPdfProcessor();
    engine = createPdfJsEngine();
  });

  afterAll(async () => {
    await engine.destroy();
    await processor.destroy();
  });

  /** The name of a pixel's colour, or its channels when it's none of the fixtures'. */
  const nameOf = (pixel: readonly number[]): string => {
    const found = Object.entries(COLOURS).find(([, colour]) =>
      colour.every((channel, index) => Math.abs(channel - (pixel[index] ?? 0)) <= 8),
    );
    return found ? found[0] : pixel.join(",");
  };

  async function draw(job: PdfBuildJob) {
    const document = await engine.open(await processor.build(job));
    const pages: { size: number[]; at: (x: number, y: number) => string }[] = [];
    for (let index = 0; index < document.pageCount; index += 1) {
      const canvas = window.document.createElement("canvas");
      await document.renderPage(index, canvas, { scale: 1, pixelRatio: 1 });
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      pages.push({
        size: [canvas.width, canvas.height],
        at: (x, y) => nameOf([...context.getImageData(x, y, 1, 1).data.slice(0, 3)]),
      });
    }
    await document.destroy();
    return pages;
  }

  it("draws the overlay over the page's own content, and leaves other pages alone", async () => {
    const own = { x: 40, y: 40, width: 200, height: 200, colour: "blue" } as const;
    const ink = { x: 140, y: 140, width: 200, height: 200, colour: "red" } as const;
    const [first, second] = await draw({
      sources: [
        {
          id: "a",
          bytes: await shapesPdf([
            { ...PAGE, shapes: [own] },
            { ...PAGE, shapes: [own] },
          ]),
        },
        { id: "ink", bytes: await shapesPdf([{ ...PAGE, shapes: [ink] }]) },
      ],
      pages: [
        { source: "a", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } },
        { source: "a", pageIndex: 1 },
      ],
    });

    expect(first?.size).toEqual([400, 600]);
    // The overlay alone, the overlay where it covers the page's shape, the
    // page's shape where it shows, and the bare page through the overlay.
    expect(first?.at(290, 310)).toBe("red");
    expect(first?.at(190, 410)).toBe("red");
    expect(first?.at(90, 510)).toBe("blue");
    expect(first?.at(20, 20)).toBe("white");

    expect(second?.size).toEqual([400, 600]);
    expect(second?.at(290, 310)).toBe("white");
    expect(second?.at(190, 410)).toBe("blue");
    expect(second?.at(90, 510)).toBe("blue");
  });

  it("scales a larger overlay down to fit, never enlarges a smaller one, and centres both", async () => {
    const [underLarger, underSmaller] = await draw({
      sources: [
        { id: "a", bytes: await shapesPdf([PAGE, PAGE]) },
        {
          id: "ink",
          bytes: await shapesPdf([
            // Each shape sits in its page's top-left corner.
            {
              width: 800,
              height: 800,
              shapes: [{ x: 0, y: 600, width: 200, height: 200, colour: "red" }],
            },
            {
              width: 200,
              height: 300,
              shapes: [{ x: 0, y: 200, width: 100, height: 100, colour: "green" }],
            },
          ]),
        },
      ],
      pages: [
        { source: "a", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } },
        { source: "a", pageIndex: 1, overlay: { source: "ink", pageIndex: 1 } },
      ],
    });

    // 800 by 800 at half size is 400 by 400, centred: 100 points from the
    // top. Its shape is 100 by 100 there, not 200 by 200 at the page's top.
    expect(underLarger?.at(50, 150)).toBe("red");
    expect(underLarger?.at(50, 50)).toBe("white");
    expect(underLarger?.at(150, 150)).toBe("white");
    expect(underLarger?.at(50, 250)).toBe("white");

    // 200 by 300 keeps its size, centred: 100 points in and 150 down. Filling
    // the page would put its shape, twice the size, in the page's corner.
    expect(underSmaller?.at(150, 225)).toBe("green");
    expect(underSmaller?.at(50, 50)).toBe("white");
    expect(underSmaller?.at(250, 225)).toBe("white");
  });

  it("places the overlay on the page as displayed, after its rotation", async () => {
    // The page's own shape is in its top-left corner before any rotation.
    const own = { x: 0, y: 500, width: 100, height: 100, colour: "blue" } as const;
    const [landscape, portrait, ownRotation] = await draw({
      sources: [
        {
          id: "a",
          bytes: await shapesPdf([
            { ...PAGE, shapes: [own] },
            { ...PAGE, shapes: [own] },
          ]),
        },
        { id: "turned", bytes: await shapesPdf([{ ...PAGE, rotation: 270, shapes: [own] }]) },
        {
          id: "ink",
          bytes: await shapesPdf([
            // Each shape sits in its page's top-left corner.
            {
              width: 600,
              height: 400,
              shapes: [{ x: 0, y: 300, width: 100, height: 100, colour: "red" }],
            },
            {
              width: 400,
              height: 600,
              shapes: [{ x: 0, y: 450, width: 150, height: 150, colour: "green" }],
            },
          ]),
        },
      ],
      pages: [
        { source: "a", pageIndex: 0, rotation: 90, overlay: { source: "ink", pageIndex: 0 } },
        { source: "a", pageIndex: 1, rotation: 90, overlay: { source: "ink", pageIndex: 1 } },
        { source: "turned", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } },
      ],
    });

    // A quarter turn clockwise shows the page 600 by 400, its own shape now
    // top right. An overlay of that size covers it exactly, upright: its
    // top-left corner is the displayed page's.
    expect(landscape?.size).toEqual([600, 400]);
    expect(landscape?.at(50, 50)).toBe("red");
    expect(landscape?.at(550, 50)).toBe("blue");
    expect(landscape?.at(50, 350)).toBe("white");

    // An overlay with the size of the unrotated page isn't turned with it: it
    // stays upright, scaled by two thirds to the displayed height, centred.
    expect(portrait?.size).toEqual([600, 400]);
    expect(portrait?.at(216, 50)).toBe("green");
    expect(portrait?.at(50, 50)).toBe("white");
    expect(portrait?.at(550, 50)).toBe("blue");

    // The same for a rotation the page already has: /Rotate 270 shows its
    // own shape bottom left.
    expect(ownRotation?.size).toEqual([600, 400]);
    expect(ownRotation?.at(50, 50)).toBe("red");
    expect(ownRotation?.at(50, 350)).toBe("blue");
  });

  it("takes the overlay page as displayed, and measures the page by its crop box", async () => {
    const [underTurned, cropped] = await draw({
      sources: [
        {
          id: "a",
          bytes: await shapesPdf([
            PAGE,
            { ...PAGE, crop: { x: 50, y: 50, width: 300, height: 500 } },
          ]),
        },
        {
          id: "ink",
          bytes: await shapesPdf([
            // 600 by 400 with /Rotate 90 is shown 400 by 600, and its
            // top-left shape top right.
            {
              width: 600,
              height: 400,
              rotation: 90,
              shapes: [{ x: 0, y: 300, width: 100, height: 100, colour: "red" }],
            },
            {
              ...PAGE,
              shapes: [{ x: 0, y: 400, width: 200, height: 200, colour: "green" }],
            },
          ]),
        },
      ],
      pages: [
        { source: "a", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } },
        { source: "a", pageIndex: 1, overlay: { source: "ink", pageIndex: 1 } },
      ],
    });

    // Turned, the overlay page has the page's size and covers it exactly.
    // Unturned, it would be scaled by two thirds, its shape at the left.
    expect(underTurned?.at(350, 50)).toBe("red");
    expect(underTurned?.at(50, 50)).toBe("white");
    expect(underTurned?.at(30, 200)).toBe("white");

    // The engine shows the crop box, 300 by 500. The overlay, 400 by 600, is
    // scaled by three quarters to fit it, 300 by 450, with 25 points above:
    // its shape is 150 by 150 from there, not 200 by 200 from the media box.
    expect(cropped?.size).toEqual([300, 500]);
    expect(cropped?.at(75, 100)).toBe("green");
    expect(cropped?.at(75, 160)).toBe("green");
    expect(cropped?.at(75, 12)).toBe("white");
    expect(cropped?.at(200, 100)).toBe("white");
  });

  it("draws each of several overlays on its own page", async () => {
    const shape = { x: 100, y: 400, width: 100, height: 100 };
    const pages = await draw({
      sources: [
        { id: "a", bytes: await shapesPdf([PAGE, PAGE, PAGE]) },
        {
          id: "ink",
          bytes: await shapesPdf([
            { ...PAGE, shapes: [{ ...shape, colour: "red" }] },
            { ...PAGE, shapes: [{ ...shape, colour: "green" }] },
          ]),
        },
      ],
      pages: [
        { source: "a", pageIndex: 0, overlay: { source: "ink", pageIndex: 1 } },
        { source: "a", pageIndex: 1 },
        { source: "a", pageIndex: 2, overlay: { source: "ink", pageIndex: 0 } },
      ],
    });
    expect(pages.map((page) => page.at(150, 150))).toEqual(["green", "white", "red"]);
  });

  it("draws a page of the same source over another, in a document it leaves whole", async () => {
    const [first, second] = await draw({
      sources: [
        {
          id: "a",
          bytes: await shapesPdf([
            { ...PAGE, shapes: [{ x: 40, y: 40, width: 100, height: 100, colour: "blue" }] },
            { ...PAGE, shapes: [{ x: 250, y: 400, width: 100, height: 100, colour: "red" }] },
          ]),
        },
      ],
      pages: [
        { source: "a", pageIndex: 0, overlay: { source: "a", pageIndex: 1 } },
        { source: "a", pageIndex: 1 },
      ],
    });
    expect(first?.at(90, 510)).toBe("blue");
    expect(first?.at(300, 150)).toBe("red");
    expect(second?.at(90, 510)).toBe("white");
    expect(second?.at(300, 150)).toBe("red");
  });
});
