import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesRect } from "../../core/model/geometry.js";
import { type Corner, resized, resizedAboutCentre } from "./SelectionOverlay.js";

const box: NotesRect = { x: 1_000, y: 2_000, width: 4_000, height: 3_000 };

/** The corner of a box opposite the one being moved, which must stay where it is. */
function opposite(rect: NotesRect, corner: Corner): [number, number] {
  return [
    corner === "nw" || corner === "sw" ? rect.x + rect.width : rect.x,
    corner === "nw" || corner === "ne" ? rect.y + rect.height : rect.y,
  ];
}

describe("resized", () => {
  it("follows a corner pulled along the box's diagonal", () => {
    expect(resized(box, "se", 2_000, 1_500)).toEqual({ ...box, width: 6_000, height: 4_500 });
    expect(resized(box, "se", -2_000, -1_500)).toEqual({ ...box, width: 2_000, height: 1_500 });
    expect(resized(box, "nw", -4_000, -3_000)).toEqual({
      x: -3_000,
      y: -1_000,
      width: 8_000,
      height: 6_000,
    });
  });

  it("shrinks the box when a corner is pulled straight along one edge, towards the box", () => {
    const left = resized(box, "se", -2_000, 0);
    expect(left.width).toBeLessThan(box.width);
    expect(left.height).toBeLessThan(box.height);
    const up = resized(box, "se", 0, -1_500);
    expect(up.width).toBeLessThan(box.width);
    const right = resized(box, "nw", 2_000, 0);
    expect(right.width).toBeLessThan(box.width);
  });

  it("grows the box when a corner is pulled straight along one edge, away from the box", () => {
    expect(resized(box, "se", 2_000, 0).width).toBeGreaterThan(box.width);
    expect(resized(box, "sw", -2_000, 0).width).toBeGreaterThan(box.width);
    expect(resized(box, "ne", 0, -1_500).height).toBeGreaterThan(box.height);
  });

  it("leaves the box as it is when the corner moves across the diagonal", () => {
    // At a right angle to the diagonal of a box of 4 by 3: neither towards the box nor away.
    const moved = resized(box, "se", 3, -4);
    expect(moved.width).toBeCloseTo(box.width, 9);
    expect(moved.height).toBeCloseTo(box.height, 9);
  });

  it("never makes the box smaller than a twentieth of its size", () => {
    expect(resized(box, "se", -100_000, -100_000)).toEqual({ ...box, width: 200, height: 150 });
  });

  it("keeps the box's proportions and its opposite corner, whichever corner moves", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Corner>("nw", "ne", "sw", "se"),
        fc.integer({ min: -20_000, max: 20_000 }),
        fc.integer({ min: -20_000, max: 20_000 }),
        (corner, dx, dy) => {
          const next = resized(box, corner, dx, dy);
          expect(next.width / next.height).toBeCloseTo(box.width / box.height, 9);
          const [x, y] = opposite(next, corner);
          const [fixedX, fixedY] = opposite(box, corner);
          expect(x).toBeCloseTo(fixedX, 6);
          expect(y).toBeCloseTo(fixedY, 6);
        },
      ),
    );
  });
});

describe("resizedAboutCentre", () => {
  it("resizes the box about its middle", () => {
    expect(resizedAboutCentre(box, 2)).toEqual({ x: -1_000, y: 500, width: 8_000, height: 6_000 });
    expect(resizedAboutCentre(box, 0.5)).toEqual({
      x: 2_000,
      y: 2_750,
      width: 2_000,
      height: 1_500,
    });
  });
});
