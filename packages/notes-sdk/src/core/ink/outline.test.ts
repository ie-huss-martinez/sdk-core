import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesStroke } from "../model/items.js";
import { squaredDistanceToPath } from "./hit.js";
import {
  outlineOfPoints,
  outlineSegments,
  outlineToPathData,
  type StrokeStyle,
  strokeOutline,
} from "./outline.js";

const pen: StrokeStyle = { tool: "pen", size: 200 };
const highlighter: StrokeStyle = { tool: "highlighter", size: 600 };

/** The box around an outline: `[left, top, right, bottom]`. */
function extent(outline: readonly number[]): [number, number, number, number] {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < outline.length; index += 2) {
    left = Math.min(left, outline[index] as number);
    right = Math.max(right, outline[index] as number);
    top = Math.min(top, outline[index + 1] as number);
    bottom = Math.max(bottom, outline[index + 1] as number);
  }
  return [left, top, right, bottom];
}

/** How often a polygon goes around a point: not 0 means filled, by the non-zero rule. */
function windingNumber(polygon: readonly number[], x: number, y: number): number {
  let winding = 0;
  const count = polygon.length / 2;
  for (let index = 0; index < count; index += 1) {
    const ax = polygon[index * 2] as number;
    const ay = polygon[index * 2 + 1] as number;
    const bx = polygon[((index + 1) % count) * 2] as number;
    const by = polygon[((index + 1) % count) * 2 + 1] as number;
    const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
    if (ay <= y && by > y && side > 0) winding += 1;
    else if (ay > y && by <= y && side < 0) winding -= 1;
  }
  return winding;
}

/** A straight stroke along the x axis, with a point every 50 units and one pressure. */
function straight(length: number, pressure: number): number[] {
  const points: number[] = [];
  for (let x = 0; x <= length; x += 50) points.push(x, 0, pressure);
  return points;
}

/** The height of an outline where it crosses a vertical line, from its points near it. */
function heightNear(outline: readonly number[], x: number, within: number): number {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < outline.length; index += 2) {
    if (Math.abs((outline[index] as number) - x) > within) continue;
    top = Math.min(top, outline[index + 1] as number);
    bottom = Math.max(bottom, outline[index + 1] as number);
  }
  return bottom - top;
}

describe("outlineOfPoints", () => {
  it("gives nothing for no points or no size", () => {
    expect(outlineOfPoints([], pen, true)).toEqual([]);
    expect(outlineOfPoints([0, 0, 500], { tool: "pen", size: 0 }, true)).toEqual([]);
  });

  it("draws one point as a circle around it", () => {
    const radiusOf = (outline: number[]): number[] => {
      const radii: number[] = [];
      for (let index = 0; index < outline.length; index += 2) {
        radii.push(
          Math.hypot((outline[index] as number) - 300, (outline[index + 1] as number) - 400),
        );
      }
      return radii;
    };
    // A highlighter's and a uniform stroke's dot is as wide as the stroke.
    for (const style of [highlighter, { ...pen, uniform: true }]) {
      const radii = radiusOf(outlineOfPoints([300, 400, 100], style, true));
      expect(radii.length).toBeGreaterThanOrEqual(12);
      for (const radius of radii) expect(radius).toBeCloseTo(style.size / 2, 6);
    }
    // A pen's follows its pressure: the full size at full pressure, a third at none.
    for (const [pressure, diameter] of [
      [1000, 200],
      [500, 400 / 3],
      [0, 200 / 3],
    ] as const) {
      for (const radius of radiusOf(outlineOfPoints([300, 400, pressure], pen, false))) {
        expect(radius).toBeCloseTo(diameter / 2, 6);
      }
    }
  });

  it("draws points that are all in one place as one dot", () => {
    expect(outlineOfPoints([300, 400, 200, 300, 400, 1000], pen, true)).toEqual(
      outlineOfPoints([300, 400, 1000], pen, true),
    );
  });

  it("makes a pen's line wider under more pressure, and never wider than its size", () => {
    const light = heightNear(outlineOfPoints(straight(3000, 100), pen, false), 1500, 200);
    const firm = heightNear(outlineOfPoints(straight(3000, 1000), pen, false), 1500, 200);
    expect(light).toBeGreaterThan(50);
    expect(firm).toBeGreaterThan(light * 2);
    expect(firm).toBeLessThanOrEqual(200 + 1e-6);
    expect(firm).toBeGreaterThan(190);
  });

  it("gives a highlighter one width whatever the pressure", () => {
    const light = outlineOfPoints(straight(3000, 50), highlighter, true);
    const firm = outlineOfPoints(straight(3000, 950), highlighter, true);
    expect(light).toEqual(firm);
    expect(heightNear(firm, 1500, 300)).toBeCloseTo(600, 6);
  });

  it("tapers a pen's ends only once the stroke is complete", () => {
    const points = straight(3000, 1000);
    const drawing = extent(outlineOfPoints(points, pen, false));
    const complete = extent(outlineOfPoints(points, pen, true));
    // A round end reaches past the first point by the line's half width; a taper ends on it.
    expect(drawing[0]).toBeLessThan(-80);
    expect(complete[0]).toBeGreaterThan(-1);
    expect(complete[2]).toBeLessThan(3001);
    expect(heightNear(outlineOfPoints(points, pen, true), 1500, 200)).toBeGreaterThan(190);
  });

  it("gives a short pen stroke round ends instead of tapers", () => {
    // 300 units long, under twice its size.
    const complete = extent(outlineOfPoints(straight(300, 1000), pen, true));
    expect(complete[0]).toBeLessThan(-80);
    expect(complete[2]).toBeGreaterThan(380);
  });

  it("ends a highlighter's line flat", () => {
    const [left, , right] = extent(outlineOfPoints(straight(3000, 500), highlighter, true));
    // No round end: the outline stops at the ends, within perfect-freehand's 2% overshoot.
    expect(left).toBeGreaterThan(-600 * 0.02);
    expect(right).toBeLessThan(3000 + 600 * 0.02);
  });

  it("ends a complete stroke exactly at its last point", () => {
    const points = [0, 0, 500, 900, 0, 500, 2000, 0, 500];
    const [, , right] = extent(outlineOfPoints(points, highlighter, true));
    expect(right).toBeCloseTo(2000, 0);
  });

  it("accepts the floats of a stroke being drawn", () => {
    const points = new Float32Array([0.25, 0.5, 400.5, 500.75, 20.25, 600.5, 1000.5, 0.75, 700]);
    const outline = outlineOfPoints(points, pen, false);
    expect(outline.length).toBeGreaterThan(8);
    expect(outline.every(Number.isFinite)).toBe(true);
  });

  it("is the same every time", () => {
    const points = [0, 0, 300, 400, 150, 700, 900, -50, 500, 1500, 300, 200];
    expect(outlineOfPoints(points, pen, true)).toEqual(outlineOfPoints(points, pen, true));
  });

  it("keeps the ink inside the points' box grown by half the size", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 5000 }),
            fc.integer({ min: 0, max: 5000 }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { minLength: 1, maxLength: 40 },
        ),
        fc.constantFrom<StrokeStyle>(
          { tool: "pen", size: 150 },
          { tool: "highlighter", size: 800 },
          { tool: "pen", size: 300, uniform: true },
          { tool: "highlighter", size: 800, uniform: true },
        ),
        fc.boolean(),
        (triples, style, complete) => {
          const points = triples.flat();
          const outline = outlineOfPoints(points, style, complete);
          expect(outline.every(Number.isFinite)).toBe(true);
          const [left, top, right, bottom] = extent(outline);
          const xs = triples.map((triple) => triple[0]);
          const ys = triples.map((triple) => triple[1]);
          // perfect-freehand's flat end overshoots by 2% of the half width,
          // and its round end is drawn around a point up to 3 units off.
          const reach = style.size / 2 + style.size * 0.01 + 4;
          expect(left).toBeGreaterThanOrEqual(Math.min(...xs) - reach);
          expect(top).toBeGreaterThanOrEqual(Math.min(...ys) - reach);
          expect(right).toBeLessThanOrEqual(Math.max(...xs) + reach);
          expect(bottom).toBeLessThanOrEqual(Math.max(...ys) + reach);
        },
      ),
    );
  });
});

describe("outlineOfPoints, for a uniform stroke", () => {
  const line = [0, 0, 500, 1000, 0, 500];

  it("draws a pen's line with round ends, exactly its size wide", () => {
    const outline = outlineOfPoints(line, { tool: "pen", size: 100, uniform: true }, true);
    const [left, top, right, bottom] = extent(outline);
    expect(left).toBeCloseTo(-50, 6);
    expect(right).toBeCloseTo(1050, 6);
    expect(top).toBeCloseTo(-50, 6);
    expect(bottom).toBeCloseTo(50, 6);
  });

  it("draws a highlighter's line as a rectangle", () => {
    const outline = outlineOfPoints(line, { tool: "highlighter", size: 100, uniform: true }, true);
    expect(extent(outline)).toEqual([0, -50, 1000, 50]);
    // Each corner is given twice, so the smoothed curve passes through it.
    expect(outline).toHaveLength(16);
    expect(outlineToPathData(outline)).toBe(
      "M500 -50Q0 -50 0 -50 0 -50 0 0 0 50 0 50 0 50 500 50 1000 50 1000 50 1000 50 1000 0 1000 -50 1000 -50 1000 -50 500 -50Z",
    );
  });

  it("ignores pressure and whether the stroke is complete", () => {
    const style: StrokeStyle = { tool: "pen", size: 100, uniform: true };
    expect(outlineOfPoints([0, 0, 0, 1000, 0, 1000], style, false)).toEqual(
      outlineOfPoints(line, style, true),
    );
  });

  it("keeps a rectangle's sides straight and its inside corners sharp", () => {
    const rectangle = [0, 0, 500, 2000, 0, 500, 2000, 1000, 500, 0, 1000, 500, 0, 0, 500];
    const outline = outlineOfPoints(rectangle, { tool: "pen", size: 200, uniform: true }, true);
    expect(extent(outline).map((value) => Math.round(value))).toEqual([-100, -100, 2100, 1100]);
    // Filled along every side, the one its two ends meet on included.
    for (const [x, y] of [
      [1000, 0],
      [500, 0],
      [1150, 0],
      [2000, 500],
      [1000, 1000],
      [0, 500],
      [0, 0],
      [2000, 1000],
    ] as const) {
      expect(windingNumber(outline, x, y), `${x}, ${y}`).not.toBe(0);
    }
    // Empty in the middle, right up to the inside corners, and past the round outside ones.
    for (const [x, y] of [
      [1000, 500],
      [102, 102],
      [1898, 898],
      [-98, -98],
      [2098, 1098],
    ] as const) {
      expect(windingNumber(outline, x, y), `${x}, ${y}`).toBe(0);
    }
  });

  it("fills exactly what is within half the size of the path", () => {
    const position = fc.tuple(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 3000 }));
    fc.assert(
      fc.property(
        fc.array(position, { minLength: 2, maxLength: 12 }),
        fc.boolean(),
        fc.constantFrom<"pen" | "highlighter">("pen", "highlighter"),
        fc.constantFrom(40, 200, 700),
        fc.array(position, { minLength: 20, maxLength: 20 }),
        (corners, closed, tool, size, probes) => {
          const path = closed ? [...corners, corners[0] as [number, number]] : corners;
          const points = path.flatMap(([x, y]) => [x, y, 500]);
          const outline = outlineOfPoints(points, { tool, size, uniform: true }, true);
          const centre = path.flat();
          // On the path itself, away from a flat end, is always ink.
          for (let index = 1; index + 1 < path.length; index += 1) {
            const [x, y] = path[index] as [number, number];
            expect(windingNumber(outline, x + 0.5, y + 0.5)).not.toBe(0);
          }
          for (const [x, y] of probes) {
            const distance = Math.sqrt(squaredDistanceToPath(centre, 2, x + 0.5, y + 0.5));
            // Never ink beyond the stroke's width: 5% covers a gentle bend's inside point.
            if (distance > (size / 2) * 1.05 + 1)
              expect(windingNumber(outline, x + 0.5, y + 0.5)).toBe(0);
          }
        },
      ),
    );
  });
});

describe("strokeOutline", () => {
  it("is the outline of the stroke's points, complete", () => {
    const stroke: NotesStroke = {
      id: "s1",
      type: "stroke",
      tool: "pen",
      color: "#112233",
      size: 200,
      points: straight(1500, 600),
    };
    expect(strokeOutline(stroke)).toEqual(outlineOfPoints(stroke.points, pen, true));
    const shape: NotesStroke = { ...stroke, uniform: true };
    expect(strokeOutline(shape)).toEqual(
      outlineOfPoints(stroke.points, { ...pen, uniform: true }, true),
    );
  });
});

describe("outlineSegments and outlineToPathData", () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];

  it("give nothing for an empty outline", () => {
    expect(outlineSegments([])).toEqual([]);
    expect(outlineToPathData([])).toBe("");
  });

  it("run from the middle of each side to the middle of the next, around each corner", () => {
    expect(outlineSegments(square)).toEqual([
      0, 5, 0, 0, 5, 0, 10, 0, 10, 5, 10, 10, 5, 10, 0, 10, 0, 5,
    ]);
    expect(outlineToPathData(square)).toBe("M0 5Q0 0 5 0 10 0 10 5 10 10 5 10 0 10 0 5Z");
  });

  it("round to 2 decimals", () => {
    expect(outlineSegments([0.123456, 0.005, 1.999, -0.004, 3.14259, 2.71728])).toEqual([
      1.63, 1.36, 0.12, 0.01, 1.06, 0, 2, 0, 2.57, 1.36, 3.14, 2.72, 1.63, 1.36,
    ]);
    expect(outlineToPathData([-0.001, -0.001, 5, 0, 5, 5])).toBe(
      "M2.5 2.5Q0 0 2.5 0 5 0 5 2.5 5 5 2.5 2.5Z",
    );
  });

  it("handle an outline of one point", () => {
    expect(outlineSegments([3, 4])).toEqual([3, 4, 3, 4, 3, 4]);
    expect(outlineToPathData([3, 4])).toBe("M3 4Q3 4 3 4Z");
  });

  it("describe the same closed curve, number for number", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3_000_000, max: 3_000_000, noNaN: true }), {
          minLength: 2,
          maxLength: 80,
        }),
        (numbers) => {
          const outline = numbers.length % 2 === 0 ? numbers : numbers.slice(1);
          const segments = outlineSegments(outline);
          const data = outlineToPathData(outline);
          expect(segments).toHaveLength(2 + outline.length * 2);
          expect(data).toMatch(/^M-?[\d.]+ -?[\d.]+Q(-?[\d.]+ )*-?[\d.]+Z$/);
          const parsed = (data.match(/-?[\d.]+/g) ?? []).map(Number);
          expect(parsed).toEqual(segments);
          // Closed: the last segment ends where the curve starts.
          expect(segments.slice(-2)).toEqual(segments.slice(0, 2));
          // Each control point is the outline's own point, rounded.
          for (let index = 0; index < outline.length; index += 2) {
            expect(segments[2 + index * 2]).toBeCloseTo(outline[index] as number, 1);
            expect(segments[3 + index * 2]).toBeCloseTo(outline[index + 1] as number, 1);
          }
        },
      ),
    );
  });
});
