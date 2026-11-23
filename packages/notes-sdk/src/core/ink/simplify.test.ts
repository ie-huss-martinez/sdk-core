import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appendPoint, toStoredPoints } from "./simplify.js";

describe("appendPoint", () => {
  it("adds the first sample whatever the distance", () => {
    const points: number[] = [];
    expect(appendPoint(points, 10.5, 20.25, 300, 1000)).toBe(true);
    expect(points).toEqual([10.5, 20.25, 300]);
  });

  it("adds a sample at least the minimum distance from the last", () => {
    const points = [0, 0, 300];
    expect(appendPoint(points, 3, 4, 400, 5)).toBe(true);
    expect(points).toEqual([0, 0, 300, 3, 4, 400]);
  });

  it("leaves out a closer sample, keeping the higher pressure", () => {
    const points = [0, 0, 300];
    expect(appendPoint(points, 3, 3.9, 800, 5)).toBe(false);
    expect(points).toEqual([0, 0, 800]);
    expect(appendPoint(points, 1, 1, 200, 5)).toBe(false);
    expect(points).toEqual([0, 0, 800]);
  });

  it("measures from the last point, not the first", () => {
    const points = [0, 0, 500, 100, 0, 500];
    expect(appendPoint(points, 2, 0, 500, 10)).toBe(true);
    expect(appendPoint(points, 4, 0, 500, 10)).toBe(false);
    expect(points).toHaveLength(9);
  });

  it("never leaves two points closer than the minimum distance", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: -500, max: 500, noNaN: true }),
            fc.double({ min: -500, max: 500, noNaN: true }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { maxLength: 60 },
        ),
        fc.double({ min: 0, max: 50, noNaN: true }),
        (samples, minimum) => {
          const points: number[] = [];
          for (const [x, y, pressure] of samples) appendPoint(points, x, y, pressure, minimum);
          expect(points.length % 3).toBe(0);
          for (let index = 3; index < points.length; index += 3) {
            const distance = Math.hypot(
              (points[index] as number) - (points[index - 3] as number),
              (points[index + 1] as number) - (points[index - 2] as number),
            );
            expect(distance).toBeGreaterThanOrEqual(minimum);
          }
        },
      ),
    );
  });
});

describe("toStoredPoints", () => {
  it("rounds positions and pressures to whole numbers", () => {
    expect(toStoredPoints([10.4, 20.5, 499.6, 30.6, -40.5, 0.4])).toEqual([
      10, 21, 500, 31, -40, 0,
    ]);
  });

  it("keeps pressures within the model's range", () => {
    expect(toStoredPoints([0, 0, -20, 10, 0, 1000.4, 20, 0, 5000])).toEqual([
      0, 0, 0, 10, 0, 1000, 20, 0, 1000,
    ]);
  });

  it("makes one point of points that follow each other at one position", () => {
    expect(toStoredPoints([10.1, 10.2, 300, 9.9, 10.4, 700, 10, 10, 500, 20, 10, 100])).toEqual([
      10, 10, 700, 20, 10, 100,
    ]);
  });

  it("keeps a position the stroke comes back to", () => {
    expect(toStoredPoints([0, 0, 500, 10, 0, 500, 0, 0, 500])).toEqual([
      0, 0, 500, 10, 0, 500, 0, 0, 500,
    ]);
  });

  it("leaves out samples that aren't finite, and never stores a negative zero", () => {
    const stored = toStoredPoints([
      Number.NaN,
      0,
      500,
      -0.2,
      -0.4,
      500,
      5,
      Number.POSITIVE_INFINITY,
      500,
    ]);
    expect(stored).toEqual([0, 0, 500]);
    expect(Object.is(stored[0], 0) && Object.is(stored[1], 0)).toBe(true);
  });

  it("gives nothing for no points, and ignores an unfinished triple", () => {
    expect(toStoredPoints([])).toEqual([]);
    expect(toStoredPoints(new Float64Array([1, 2, 3, 4, 5]))).toEqual([1, 2, 3]);
  });

  it("gives valid stored points, and leaves them as they are when given them again", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -20_000, max: 20_000, noNaN: true }), { maxLength: 90 }),
        (numbers) => {
          const stored = toStoredPoints(numbers);
          expect(stored.length % 3).toBe(0);
          expect(stored.length).toBeLessThanOrEqual(numbers.length);
          for (let index = 0; index < stored.length; index += 3) {
            expect(Number.isInteger(stored[index]) && Number.isInteger(stored[index + 1])).toBe(
              true,
            );
            expect(Number.isInteger(stored[index + 2])).toBe(true);
            expect(stored[index + 2]).toBeGreaterThanOrEqual(0);
            expect(stored[index + 2]).toBeLessThanOrEqual(1000);
            if (index > 0) {
              const same =
                stored[index] === stored[index - 3] && stored[index + 1] === stored[index - 2];
              expect(same).toBe(false);
            }
          }
          expect(toStoredPoints(stored)).toEqual(stored);
        },
      ),
    );
  });
});
