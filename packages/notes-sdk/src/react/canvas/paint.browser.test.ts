import { describe, expect, it, vi } from "vitest";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_MAX_PAGE_SIDE } from "../../core/model/portable.js";
import { beginPage, paintPaper } from "./paint.js";

/** A square page of dotted paper, painted on a canvas of `pixels` a side. */
function dotted(side: number, pixels: number) {
  const info: NotesPageInfo = { id: "p", width: side, height: side, template: "dotted" };
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser gave no canvas.");
  const circles = vi.spyOn(context, "arc");
  beginPage(context, info);
  paintPaper(context, info);
  /** How far from white each pixel of a square region is, summed. */
  const ink = (x: number, y: number, size: number): number => {
    const { data } = context.getImageData(x, y, size, size);
    let total = 0;
    for (let index = 0; index < data.length; index += 4) total += 255 - (data[index] ?? 255);
    return total;
  };
  return { circles, ink };
}

describe("paintPaper, on dotted paper", () => {
  // Both at 75 units to a pixel: a dot every 20 pixels, 2 pixels wide, the first at 10.
  const small = () => dotted(30_000, 400);
  const large = () => dotted(225_000, 3_000);

  it("draws each dot of an ordinary page as a circle", () => {
    const { circles, ink } = small();
    expect(circles).toHaveBeenCalledTimes(20 * 20);
    // A dot at 10 pixels each way, and white paper between it and the next.
    expect(ink(8, 8, 4)).toBeGreaterThan(100);
    expect(ink(18, 18, 4)).toBe(0);
  });

  it("paints the dots of a page with tens of thousands as a repeated tile, in the same places", () => {
    const { circles, ink } = large();
    expect(circles).not.toHaveBeenCalled();

    const reference = small();
    // The first dot, one in the middle and the last, each as dark as a dot drawn as a circle.
    const dot = reference.ink(8, 8, 4);
    for (const at of [8, 1_488, 2_988]) {
      expect(Math.abs(ink(at, at, 4) - dot)).toBeLessThan(dot * 0.1);
      // White beside it, where no dot is.
      expect(ink(at + 8, at, 2)).toBe(0);
    }
    // And the same paper, over a part the size of the small page: 400 dots.
    const whole = reference.ink(0, 0, 400);
    expect(Math.abs(ink(0, 0, 400) - whole)).toBeLessThan(whole * 0.05);
    expect(Math.abs(ink(2_600, 2_600, 400) - whole)).toBeLessThan(whole * 0.05);
    // No dot past the last row and column: the margin is as white as the first one.
    expect(ink(2_992, 0, 8)).toBe(0);
  });

  it("paints the largest page the model allows without a circle for each of its 921,600 dots", () => {
    const { circles, ink } = dotted(NOTES_MAX_PAGE_SIDE, 1_200);
    expect(circles).not.toHaveBeenCalled();
    // Dots far smaller than a pixel leave the paper all but white.
    expect(ink(0, 0, 1_200) / (1_200 * 1_200)).toBeLessThan(2);
  });
});
