import { createPdfJsEngine, type PdfEngine } from "@hussmartinez/pdf-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { NotesImage, NotesStroke, NotesText } from "../model/items.js";
import { type NotesExportImage, type NotesPdfExportPage, writeNotesPdf } from "./export.js";

/**
 * The unit tests check the file's structure. This one checks that a real
 * viewer reads it and draws what the page shows, which is what catches a
 * wrong flip or a malformed object.
 */

const RED = [217, 45, 32] as const;
const GREEN = [0, 200, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;

/** A wide, straight pen stroke along y = 200 points. */
const pen: NotesStroke = {
  id: "pen",
  type: "stroke",
  tool: "pen",
  color: "#d92d20",
  size: 2_000,
  uniform: true,
  points: [10_000, 20_000, 500, 30_000, 20_000, 500],
};

/** A wide highlighter stroke along y = 500 points. */
const highlighter: NotesStroke = {
  id: "highlighter",
  type: "stroke",
  tool: "highlighter",
  color: "#ffff00",
  size: 3_000,
  points: [10_000, 50_000, 500, 20_000, 50_000, 500, 30_000, 50_000, 500],
};

/** One letter, 72 points high, with its box's top at y = 300 points. */
const letter: NotesText = {
  id: "text",
  type: "text",
  x: 10_000,
  y: 30_000,
  width: 20_000,
  text: "L",
  size: 7_200,
  color: "#000000",
};

/** A picture 100 points square, from (400, 100). */
const picture: NotesImage = {
  id: "image",
  type: "image",
  x: 40_000,
  y: 10_000,
  width: 10_000,
  height: 10_000,
  image: { asset: `sha256:${"a".repeat(64)}`, mediaType: "image/png", size: 16 },
};

/** Two pixels by two: red and green on the first row, blue and nothing on the second. */
const pixels: NotesExportImage = {
  kind: "rgba",
  width: 2,
  height: 2,
  data: Uint8Array.of(...RED, 255, ...GREEN, 255, ...BLUE, 255, 0, 0, 0, 0),
};

const pages: readonly NotesPdfExportPage[] = [
  {
    info: { id: "first", width: 59_500, height: 84_200, template: "lined" },
    items: [pen, highlighter, letter, picture],
    paper: true,
  },
  {
    info: { id: "second", width: 61_200, height: 79_200, template: "blank" },
    items: [{ ...pen, id: "over", color: "#0000ff" }],
    paper: false,
  },
];

describe("an exported PDF, in a real viewer", () => {
  const engines: PdfEngine[] = [];
  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.destroy()));
  });

  /** Opens the export and renders a page at one canvas pixel to a point. */
  async function render(pageIndex: number, source: readonly NotesPdfExportPage[] = pages) {
    const bytes = await writeNotesPdf(
      source,
      { loadImage: async () => pixels },
      { title: "Notes" },
    );
    const engine = createPdfJsEngine();
    engines.push(engine);
    const document = await engine.open(bytes);
    const canvas = window.document.createElement("canvas");
    await document.renderPage(pageIndex, canvas, { scale: 1 });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context.");
    const pixel = (x: number, y: number): number[] => [
      ...context.getImageData(x, y, 1, 1).data.subarray(0, 3),
    ];
    /** How many pixels of a rectangle are dark, as black text is and nothing else on the page. */
    const dark = (x: number, y: number, width: number, height: number): number => {
      const { data } = context.getImageData(x, y, width, height);
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          (data[index] ?? 255) < 96 &&
          (data[index + 1] ?? 255) < 96 &&
          (data[index + 2] ?? 255) < 96
        ) {
          count += 1;
        }
      }
      return count;
    };
    return { document, canvas, pixel, dark };
  }

  /**
   * A colour as it was drawn: within a few levels out of 255 on each channel,
   * which allows for a viewer's colour arithmetic.
   */
  const near = (color: readonly number[]) =>
    color.map((channel) => expect.toSatisfy((drawn: number) => Math.abs(drawn - channel) <= 4));

  it("has the pages of the notebook, at their sizes", async () => {
    const { document, canvas } = await render(0);
    expect(document.pageCount).toBe(2);
    await expect(document.getPage(0)).resolves.toEqual({ width: 595, height: 842, rotation: 0 });
    await expect(document.getPage(1)).resolves.toEqual({ width: 612, height: 792, rotation: 0 });
    expect([canvas.width, canvas.height]).toEqual([595, 842]);
  });

  it("draws ink where the page has it, in its colour, on white paper", async () => {
    const { pixel } = await render(0);
    // On the pen's stroke, which runs from x = 100 to 300 at y = 200.
    expect(pixel(150, 200)).toEqual(near(RED));
    expect(pixel(250, 200)).toEqual(near(RED));
    // Above and below it, and far from everything: bare paper. y = 50 is
    // above the first rule.
    expect(pixel(200, 180)).toEqual(near(WHITE));
    expect(pixel(200, 220)).toEqual(near(WHITE));
    expect(pixel(500, 50)).toEqual(near(WHITE));
    // The same place measured from the bottom, where the stroke would be
    // if y ran upwards.
    expect(pixel(200, 842 - 200)).toEqual(near(WHITE));
  });

  it("draws the highlighter translucent: 40% of its yellow over the white", async () => {
    const { pixel } = await render(0);
    // Multiplied with white, yellow stays yellow, and at 40% the blue
    // channel falls from 255 to 153.
    expect(pixel(200, 500)).toEqual(near([255, 255, 153]));
  });

  it("draws the paper's rules", async () => {
    const { pixel } = await render(0);
    // Lined paper's first rule is 72 points down, half a point wide, so the
    // pixel rows on either side of it are tinted and the ones beyond aren't.
    const tinted = [71, 72].some((y) => pixel(550, y).some((channel) => channel < 250));
    expect(tinted).toBe(true);
    expect(pixel(550, 60)).toEqual(near(WHITE));
    expect(pixel(550, 84)).toEqual(near(WHITE));
  });

  it("draws the paper's dots, a row of them at each row's place", async () => {
    const { pixel } = await render(0, [
      {
        info: { id: "dotted", width: 59_500, height: 84_200, template: "dotted" },
        items: [],
        paper: true,
      },
    ]);
    // Dots are 1.5 points across and 15 apart, the first centred at
    // (12.5, 8.5) and the last at (582.5, 833.5), so each covers one pixel.
    const dotted = (x: number, y: number): boolean => (pixel(x, y)[0] ?? 255) < 225;
    expect(dotted(12, 8)).toBe(true);
    expect(dotted(27, 8)).toBe(true);
    expect(dotted(12, 23)).toBe(true);
    expect(dotted(582, 8)).toBe(true);
    expect(dotted(12, 833)).toBe(true);
    expect(dotted(582, 833)).toBe(true);
    // Between two dots of a row, between two rows, and in the margins: bare paper.
    expect(pixel(20, 8)).toEqual(near(WHITE));
    expect(pixel(12, 16)).toEqual(near(WHITE));
    expect(pixel(20, 16)).toEqual(near(WHITE));
    expect(pixel(3, 3)).toEqual(near(WHITE));
    expect(pixel(591, 838)).toEqual(near(WHITE));
  });

  it("draws an image the right way up", async () => {
    const { pixel } = await render(0);
    // The middle of each quarter of the picture, which is 100 points square.
    expect(pixel(425, 125)).toEqual(near(RED));
    expect(pixel(475, 125)).toEqual(near(GREEN));
    expect(pixel(425, 175)).toEqual(near(BLUE));
    // The fourth pixel is transparent: the paper shows through its mask.
    expect(pixel(475, 175)).toEqual(near(WHITE));
  });

  it("draws text upright, with its baseline where the layout puts it", async () => {
    const { dark } = await render(0);
    // An "L" 72 points high: its box starts at y = 300, so its baseline is
    // 0.93 x 72 = 67 points below, at y = 367, and its top about 52 above
    // that. Upright, its foot runs to the right just above the baseline,
    // and nothing is to the right of its stem higher up.
    expect(dark(120, 352, 15, 14)).toBeGreaterThan(20);
    expect(dark(120, 318, 15, 26)).toBe(0);
    // The stem, on the left, from the top of the letter to its foot.
    expect(dark(100, 320, 20, 40)).toBeGreaterThan(100);
    // Nothing below the baseline, where the letter would hang if it were
    // upside down.
    expect(dark(100, 372, 45, 50)).toBe(0);
  });

  it("draws the ink of a page without paper", async () => {
    const { pixel, canvas } = await render(1);
    expect([canvas.width, canvas.height]).toEqual([612, 792]);
    expect(pixel(200, 200)).toEqual(near(BLUE));
    expect(pixel(200, 300)).toEqual(near(WHITE));
  });
});
