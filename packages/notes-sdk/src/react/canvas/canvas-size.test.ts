import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fitCanvas, pageCanvasSize, textRasterSize } from "./canvas-size.js";

describe("fitCanvas", () => {
  it("draws at the density asked for when the budget allows it", () => {
    expect(fitCanvas(800, 600, 2, { maxPixels: 12_000_000 })).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it("lowers the density, keeping the shape, when the pixels would pass the budget", () => {
    const size = fitCanvas(4000, 3000, 2, { maxPixels: 12_000_000 });
    expect(size.width * size.height).toBeLessThanOrEqual(12_000_000);
    expect(size).toEqual({ width: 4000, height: 3000 });
  });

  it("lowers the density when a side would pass the longest allowed", () => {
    expect(fitCanvas(100, 20_000, 1, { maxPixels: 16_000_000, maxSide: 8_192 })).toEqual({
      width: 41,
      height: 8_192,
    });
  });

  it("gives one pixel to a box that has no size, or a size that isn't a number", () => {
    const budget = { maxPixels: 100 };
    expect(fitCanvas(0, 50, 1, budget)).toEqual({ width: 1, height: 1 });
    expect(fitCanvas(50, Number.NaN, 1, budget)).toEqual({ width: 1, height: 1 });
    expect(fitCanvas(50, 50, 0, budget)).toEqual({ width: 1, height: 1 });
  });

  it("stays within the budget in whole pixels, whatever the box", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1e9, noNaN: true }),
        fc.double({ min: 0.001, max: 1e9, noNaN: true }),
        fc.double({ min: 0.01, max: 8, noNaN: true }),
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.option(fc.integer({ min: 1, max: 20_000 }), { nil: undefined }),
        (width, height, density, maxPixels, maxSide) => {
          const size = fitCanvas(width, height, density, {
            maxPixels,
            ...(maxSide === undefined ? {} : { maxSide }),
          });
          expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true);
          expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(1);
          expect(size.width * size.height).toBeLessThanOrEqual(maxPixels);
          expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(maxSide ?? maxPixels);
          // Never sharper than asked, beyond the rounding of a side to a whole pixel.
          expect(size.width).toBeLessThanOrEqual(Math.max(1, Math.round(width * density)));
          expect(size.height).toBeLessThanOrEqual(Math.max(1, Math.round(height * density)));
        },
      ),
    );
  });
});

describe("pageCanvasSize", () => {
  it("is as sharp as the display for a page that fits the budget", () => {
    expect(pageCanvasSize(768, 1086, 2)).toEqual({ width: 1536, height: 2172 });
  });

  it("is never under half a pixel per CSS pixel while the budget allows it", () => {
    expect(pageCanvasSize(768, 1086, 0.25)).toEqual({ width: 384, height: 543 });
  });

  it("lets the budget win over that floor for a page at the highest zoom", () => {
    // A portrait page at five times a 1,424 pixel view: half a pixel per CSS
    // pixel would be over 15 million pixels.
    const size = pageCanvasSize(6_960, 9_007, 1);
    expect(size.width * size.height).toBeLessThanOrEqual(12_000_000);
    expect(size.width / 6_960).toBeLessThan(0.5);
    // And it uses the budget: no more than a row and a column are given up.
    expect((size.width + 1) * (size.height + 1)).toBeGreaterThan(12_000_000);
    expect(size.width / size.height).toBeCloseTo(6_960 / 9_007, 3);
  });

  it("takes a display that reports no density as one pixel per CSS pixel", () => {
    expect(pageCanvasSize(100, 200, 0)).toEqual({ width: 100, height: 200 });
    expect(pageCanvasSize(100, 200, Number.NaN)).toEqual({ width: 100, height: 200 });
  });
});

describe("textRasterSize", () => {
  it("keeps 300 dots per inch for a box within the budget", () => {
    // 200 by 50 points: 300 / 72 pixels to a point.
    expect(textRasterSize(20_000, 5_000)).toEqual({ width: 833, height: 208 });
  });

  it("draws a box of 2,000 tall lines with fewer dots, within both limits", () => {
    // 144 points wide, and 2,000 lines of 15 points: 600 by 125,000 pixels at 300 dots per inch.
    const size = textRasterSize(14_400, 2_000 * 1_500);
    expect(size).toEqual({ width: 39, height: 8_192 });
  });

  it("holds the largest box the model allows to 16 million pixels and 8,192 a side", () => {
    const size = textRasterSize(1_440_000, 2_000 * 36_000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8_192);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
  });

  it("lowers a wide and tall box by its area, keeping its shape", () => {
    // 1,440 by 1,440 points would be 6,000 pixels a side: 36 million.
    expect(textRasterSize(144_000, 144_000)).toEqual({ width: 4_000, height: 4_000 });
  });
});
