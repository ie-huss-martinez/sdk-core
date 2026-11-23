import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  inflateRect,
  type NotesRect,
  pointsToUnits,
  rectContains,
  rectsIntersect,
  unionRects,
  unitsToPoints,
} from "./geometry.js";
import { NOTES_UNITS_PER_POINT } from "./portable.js";

const rect = (x: number, y: number, width: number, height: number): NotesRect => ({
  x,
  y,
  width,
  height,
});

const coordinate = fc.integer({ min: -100_000, max: 100_000 });
const side = fc.integer({ min: 0, max: 100_000 });
const anyRect: fc.Arbitrary<NotesRect> = fc.record(
  { x: coordinate, y: coordinate, width: side, height: side },
  // Plain objects only, so strict equality compares them with the functions' results.
  { noNullPrototype: true },
);

describe("pointsToUnits and unitsToPoints", () => {
  it("count 100 units to a PDF point", () => {
    expect(NOTES_UNITS_PER_POINT).toBe(100);
    expect(pointsToUnits(1)).toBe(100);
    expect(pointsToUnits(595)).toBe(59_500);
    expect(unitsToPoints(84_200)).toBe(842);
    expect(unitsToPoints(50)).toBe(0.5);
  });

  it("round points to the grid of whole units", () => {
    expect(pointsToUnits(0.004)).toBe(0);
    expect(pointsToUnits(0.005)).toBe(1);
    expect(pointsToUnits(12.3456)).toBe(1_235);
    expect(pointsToUnits(-12.3456)).toBe(-1_235);
  });

  it("give back the units they were given, exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2_880_000, max: 2_880_000 }), (units) => {
        expect(pointsToUnits(unitsToPoints(units))).toBe(units);
      }),
    );
  });

  it("always give whole units", () => {
    fc.assert(
      fc.property(fc.double({ min: -30_000, max: 30_000, noNaN: true }), (points) => {
        expect(Number.isInteger(pointsToUnits(points))).toBe(true);
        expect(Math.abs(pointsToUnits(points) - points * 100)).toBeLessThanOrEqual(0.5);
      }),
    );
  });
});

describe("unionRects", () => {
  it("gives nothing for no rectangles", () => {
    expect(unionRects([])).toBeUndefined();
    expect(unionRects(new Set<NotesRect>())).toBeUndefined();
  });

  it("gives one rectangle back as it is", () => {
    expect(unionRects([rect(10, 20, 30, 40)])).toStrictEqual(rect(10, 20, 30, 40));
  });

  it("gives the smallest rectangle that holds them all", () => {
    expect(unionRects([rect(0, 0, 10, 10), rect(20, 30, 5, 5)])).toStrictEqual(rect(0, 0, 25, 35));
    expect(unionRects([rect(-10, -10, 5, 5), rect(0, 0, 1, 1)])).toStrictEqual(
      rect(-10, -10, 11, 11),
    );
    expect(unionRects([rect(0, 0, 100, 100), rect(10, 10, 5, 5)])).toStrictEqual(
      rect(0, 0, 100, 100),
    );
  });

  it("keeps a rectangle with no area, such as a single point", () => {
    expect(unionRects([rect(5, 5, 0, 0)])).toStrictEqual(rect(5, 5, 0, 0));
    expect(unionRects([rect(5, 5, 0, 0), rect(8, 9, 0, 0)])).toStrictEqual(rect(5, 5, 3, 4));
  });

  it("takes any iterable, once", () => {
    function* some(): Generator<NotesRect> {
      yield rect(0, 0, 1, 1);
      yield rect(4, 4, 1, 1);
    }
    expect(unionRects(some())).toStrictEqual(rect(0, 0, 5, 5));
  });

  it("holds every rectangle, touches each side, and doesn't depend on their order", () => {
    fc.assert(
      fc.property(fc.array(anyRect, { minLength: 1, maxLength: 8 }), (rects) => {
        const union = unionRects(rects);
        if (!union) throw new Error("Some rectangles have a union.");
        for (const one of rects) {
          expect(one.x).toBeGreaterThanOrEqual(union.x);
          expect(one.y).toBeGreaterThanOrEqual(union.y);
          expect(one.x + one.width).toBeLessThanOrEqual(union.x + union.width);
          expect(one.y + one.height).toBeLessThanOrEqual(union.y + union.height);
        }
        expect(rects.some((one) => one.x === union.x)).toBe(true);
        expect(rects.some((one) => one.y === union.y)).toBe(true);
        expect(rects.some((one) => one.x + one.width === union.x + union.width)).toBe(true);
        expect(rects.some((one) => one.y + one.height === union.y + union.height)).toBe(true);
        expect(unionRects([...rects].reverse())).toStrictEqual(union);
      }),
    );
  });
});

describe("rectsIntersect", () => {
  it("is true for rectangles that overlap", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(2, 2, 2, 2))).toBe(true);
  });

  it("is true for rectangles that only touch, at an edge or a corner", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(true);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 10, 10, 10))).toBe(true);
  });

  it("is false for rectangles apart, on either axis", () => {
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(11, 0, 10, 10))).toBe(false);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 11, 10, 10))).toBe(false);
    expect(rectsIntersect(rect(0, 0, 10, 10), rect(-11, -11, 10, 10))).toBe(false);
  });

  it("doesn't depend on the order, and holds for a rectangle and itself", () => {
    fc.assert(
      fc.property(anyRect, anyRect, (a, b) => {
        expect(rectsIntersect(a, b)).toBe(rectsIntersect(b, a));
        expect(rectsIntersect(a, a)).toBe(true);
        // Two rectangles overlap exactly when some point is in both.
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        expect(rectsIntersect(a, b)).toBe(rectContains(a, x, y) && rectContains(b, x, y));
      }),
    );
  });
});

describe("rectContains", () => {
  const box = rect(10, 20, 30, 40);

  it("is true inside and on the edges", () => {
    expect(rectContains(box, 25, 40)).toBe(true);
    expect(rectContains(box, 10, 20)).toBe(true);
    expect(rectContains(box, 40, 60)).toBe(true);
    expect(rectContains(box, 10, 60)).toBe(true);
  });

  it("is false outside, on every side", () => {
    expect(rectContains(box, 9, 40)).toBe(false);
    expect(rectContains(box, 41, 40)).toBe(false);
    expect(rectContains(box, 25, 19)).toBe(false);
    expect(rectContains(box, 25, 61)).toBe(false);
  });
});

describe("inflateRect", () => {
  it("grows a rectangle on every side", () => {
    expect(inflateRect(rect(10, 20, 30, 40), 5)).toStrictEqual(rect(5, 15, 40, 50));
  });

  it("leaves it as it is for 0, and shrinks it for a negative amount", () => {
    expect(inflateRect(rect(10, 20, 30, 40), 0)).toStrictEqual(rect(10, 20, 30, 40));
    expect(inflateRect(rect(10, 20, 30, 40), -5)).toStrictEqual(rect(15, 25, 20, 30));
  });

  it("keeps the centre, and is undone by the opposite amount", () => {
    fc.assert(
      fc.property(anyRect, fc.integer({ min: 0, max: 10_000 }), (one, by) => {
        const grown = inflateRect(one, by);
        expect(grown.x * 2 + grown.width).toBe(one.x * 2 + one.width);
        expect(grown.y * 2 + grown.height).toBe(one.y * 2 + one.height);
        expect(inflateRect(grown, -by)).toStrictEqual(one);
        expect(unionRects([one, grown])).toStrictEqual(grown);
      }),
    );
  });
});
