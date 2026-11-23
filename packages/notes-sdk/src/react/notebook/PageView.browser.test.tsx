import { afterEach, describe, expect, it } from "vitest";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import type { NotesStroke } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import type { NotesPdfDocument } from "../../core/ports/notes-pdf.js";
import { createImageCache } from "../canvas/image-cache.js";
import { PageView } from "./PageView.js";
import type { PdfDocuments } from "./pdf-documents.js";

afterEach(cleanUp);

const IMAGES = createImageCache(
  async () => new Blob(),
  () => undefined,
);

/** A Letter page, as an imported PDF's pages are. */
const PLAIN: NotesPageInfo = { id: "p1", width: 61_200, height: 79_200, template: "blank" };
const ON_PDF: NotesPageInfo = {
  ...PLAIN,
  background: {
    pdf: { asset: `sha256:${"0".repeat(64)}`, mediaType: "application/pdf", size: 1 },
    pageIndex: 0,
  },
};

/** A yellow highlight straight across the page, at a share of its height. */
const highlight = (id: string, at: number): NotesStroke => ({
  id,
  type: "stroke",
  tool: "highlighter",
  color: "#fde047",
  size: 1_400,
  points: [10_000, Math.round(PLAIN.height * at), 500, 50_000, Math.round(PLAIN.height * at), 500],
});

/** One across the middle of the page, and one across its upper part. */
const HIGHLIGHTS = [highlight("middle", 0.5), highlight("upper", 0.2)];

/** A PDF whose page is white, with a black band across its middle: from 40% to 60% of its height. */
const BANDED: PdfDocuments = {
  async get() {
    const document: NotesPdfDocument = {
      pageCount: 1,
      pageSize: async () => ({ width: 612, height: 792 }),
      pageText: async () => "",
      async render(_pageIndex, canvas, options) {
        const density = options.scale * (options.pixelRatio ?? 1);
        canvas.width = Math.round(612 * density);
        canvas.height = Math.round(792 * density);
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#000000";
        context.fillRect(0, canvas.height * 0.4, canvas.width, canvas.height * 0.2);
      },
      destroy: async () => undefined,
    };
    return document;
  },
  dispose: () => undefined,
};

const NO_PDF: PdfDocuments = { get: async () => undefined, dispose: () => undefined };

async function mountPage(info: NotesPageInfo, documents: PdfDocuments) {
  const container = await mount(
    <PageView
      info={info}
      items={HIGHLIGHTS}
      label="Page 1 of 1"
      pixelsPerPoint={0.5}
      images={IMAGES}
      imagesVersion={0}
      documents={documents}
      register={() => undefined}
    />,
  );
  const ink = container.querySelector<HTMLCanvasElement>(".hm-notes-page-ink");
  if (!ink) throw new Error("The page has no ink canvas.");
  /** The finished ink's colour at a place on the page, as `[r, g, b, a]`. */
  const at = (x: number, y: number): number[] => [
    ...(ink
      .getContext("2d")
      ?.getImageData(Math.round(x * ink.width), Math.round(y * ink.height), 1, 1).data ?? []),
  ];
  return { container, at };
}

const sum = ([red = 0, green = 0, blue = 0]: readonly number[]): number => red + green + blue;

describe("PageView", () => {
  it("multiplies a highlight over the PDF page under it, so black text stays black", async () => {
    const { container, at } = await mountPage(ON_PDF, BANDED);
    await waitFor(() =>
      expect(
        container.querySelector(".hm-notes-page-background")?.hasAttribute("data-hm-pending"),
      ).toBe(false),
    );

    // Over the black band, the highlight leaves it black.
    expect(at(0.5, 0.5)[3]).toBe(255);
    expect(sum(at(0.5, 0.5))).toBeLessThan(30);
    // Over the white of the page, it's yellow.
    const [red = 0, green = 0, blue = 0, alpha] = at(0.5, 0.2);
    expect(alpha).toBe(255);
    expect(red).toBeGreaterThan(240);
    expect(green).toBeGreaterThan(220);
    expect(blue).toBeLessThan(220);
    expect(blue).toBeGreaterThan(120);
    // And the PDF page is the ink's paper: white where nothing is written, black in the band.
    expect(at(0.5, 0.8)).toEqual([255, 255, 255, 255]);
    expect(at(0.9, 0.45)).toEqual([0, 0, 0, 255]);
  });

  it("leaves the ink on a plain ground when the PDF can't be drawn", async () => {
    const { container, at } = await mountPage(ON_PDF, NO_PDF);
    await waitFor(() => expect(at(0.5, 0.5)[3]).toBeGreaterThan(0));
    // Nothing under the highlight but the page's own white, which the canvas doesn't hold.
    expect(at(0.5, 0.8)[3]).toBe(0);
    expect(
      container.querySelector(".hm-notes-page-background")?.hasAttribute("data-hm-pending"),
    ).toBe(true);
  });

  it("paints paper under the ink of a page that has no PDF", async () => {
    const { container, at } = await mountPage(PLAIN, NO_PDF);
    expect(container.querySelector(".hm-notes-page-background")).toBeNull();
    expect(at(0.5, 0.8)).toEqual([255, 255, 255, 255]);
    const [red = 0, green = 0, blue = 0] = at(0.5, 0.5);
    expect(red).toBeGreaterThan(240);
    expect(green).toBeGreaterThan(220);
    expect(blue).toBeLessThan(220);
  });
});
