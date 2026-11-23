import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recogniseShape } from "./shapes.js";

type Position = readonly [x: number, y: number];

/** Triples from positions, rounded as a stored stroke's are, with a pressure that varies. */
function drawn(positions: readonly Position[]): number[] {
  return positions.flatMap(([x, y], index) => [
    Math.round(x),
    Math.round(y),
    300 + (index % 5) * 100,
  ]);
}

/**
 * An ellipse drawn by hand: `turns` times around, from the angle `from`,
 * with its radius wobbling by the share `wobble`.
 */
function ring(
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  { from = 0, turns = 1, wobble = 0, count = 90 } = {},
): Position[] {
  const positions: Position[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = from + (index / count) * turns * 2 * Math.PI;
    const scale = 1 + wobble * Math.sin(angle * 3 + 1);
    positions.push([
      centreX + radiusX * scale * Math.cos(angle),
      centreY + radiusY * scale * Math.sin(angle),
    ]);
  }
  return positions;
}

/**
 * A closed polygon drawn by hand: around its corners and back to where it
 * started, which is the share `start` along its first side, wobbling by
 * `wobble` units to either side.
 */
function around(
  corners: readonly Position[],
  { start = 0, wobble = 0, perSide = 24 } = {},
): Position[] {
  const positions: Position[] = [];
  const sides = corners.length;
  for (let step = 0; step <= sides * perSide; step += 1) {
    const along = (step / perSide + start) % sides;
    const side = Math.floor(along);
    const [ax, ay] = corners[side] as Position;
    const [bx, by] = corners[(side + 1) % sides] as Position;
    const share = along - side;
    const length = Math.hypot(bx - ax, by - ay);
    const off = wobble * Math.sin(step * 0.9);
    positions.push([
      ax + (bx - ax) * share - ((by - ay) / length) * off,
      ay + (by - ay) * share + ((bx - ax) / length) * off,
    ]);
  }
  return positions;
}

/** The positions of a shape's points. */
function positionsOf(points: readonly number[]): Position[] {
  const positions: Position[] = [];
  for (let index = 0; index < points.length; index += 3) {
    positions.push([points[index] as number, points[index + 1] as number]);
  }
  return positions;
}

const box: Position[] = [
  [1000, 2000],
  [5000, 2000],
  [5000, 4500],
  [1000, 4500],
];

const peak: Position[] = [
  [1000, 4000],
  [3000, 1000],
  [5500, 4200],
];

describe("recogniseShape", () => {
  describe("a line", () => {
    it("is a nearly straight path, as its two ends", () => {
      const positions: Position[] = [];
      for (let index = 0; index <= 40; index += 1) {
        positions.push([1000 + index * 100, 2000 + index * 50 + 40 * Math.sin(index / 4)]);
      }
      expect(recogniseShape(drawn(positions))).toEqual({
        kind: "line",
        points: [1000, 2000, 500, 5000, 3978, 500],
      });
    });

    it("can be two points", () => {
      expect(recogniseShape([0, 0, 100, 3000, 400, 900])).toEqual({
        kind: "line",
        points: [0, 0, 500, 3000, 400, 500],
      });
    });

    it("isn't a path that strays more than about 4% of its length", () => {
      const bowed: Position[] = [];
      for (let index = 0; index <= 40; index += 1) {
        bowed.push([index * 100, 300 * Math.sin((index / 40) * Math.PI)]);
      }
      expect(recogniseShape(drawn(bowed))).toBeUndefined();
    });

    it("isn't a scribble back and forth along one line", () => {
      const scribble: Position[] = [];
      for (let pass = 0; pass < 4; pass += 1) {
        for (let index = 0; index <= 20; index += 1) {
          scribble.push([pass % 2 === 0 ? index * 200 : 4000 - index * 200, pass * 10]);
        }
      }
      scribble.push([4000, 40]);
      expect(recogniseShape(drawn(scribble))).toBeUndefined();
    });

    it("isn't a tick shorter than 5 points", () => {
      expect(recogniseShape([0, 0, 500, 300, 300, 500])).toBeUndefined();
      expect(recogniseShape([0, 0, 500, 400, 300, 500])?.kind).toBe("line");
    });
  });

  describe("an ellipse", () => {
    it("is a round drawn by hand, as 48 segments around its bounding box's ellipse", () => {
      // A wobbling round that stops a little short of where it began.
      const result = recogniseShape(
        drawn(ring(3000, 4000, 2000, 1200, { wobble: 0.02, turns: 0.97 })),
      );
      expect(result?.kind).toBe("ellipse");
      const points = result?.points ?? [];
      expect(points).toHaveLength(49 * 3);
      expect(points.slice(0, 3)).toEqual(points.slice(-3));
      expect(points.every(Number.isInteger)).toBe(true);
      const positions = positionsOf(points);
      const xs = positions.map(([x]) => x);
      const ys = positions.map(([, y]) => y);
      const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(Math.abs(centreX - 3000)).toBeLessThan(60);
      expect(Math.abs(centreY - 4000)).toBeLessThan(40);
      const radiusX = (Math.max(...xs) - Math.min(...xs)) / 2;
      const radiusY = (Math.max(...ys) - Math.min(...ys)) / 2;
      for (const [x, y] of positions) {
        expect(Math.hypot((x - centreX) / radiusX, (y - centreY) / radiusY)).toBeCloseTo(1, 2);
      }
    });

    it("is found whichever way and from wherever it was drawn", () => {
      expect(recogniseShape(drawn(ring(0, 0, 900, 900, { from: 2, turns: -1 })))?.kind).toBe(
        "ellipse",
      );
      expect(recogniseShape(drawn(ring(0, 0, 400, 1500, { from: -1, wobble: 0.015 })))?.kind).toBe(
        "ellipse",
      );
    });

    it("isn't a round whose ends don't meet", () => {
      expect(recogniseShape(drawn(ring(0, 0, 1500, 1500, { turns: 0.75 })))).toBeUndefined();
    });

    it("isn't a spiral", () => {
      const spiral: Position[] = [];
      for (let index = 0; index <= 120; index += 1) {
        const angle = (index / 60) * 2 * Math.PI;
        const radius = 1500 * (1 - index / 240);
        spiral.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
      }
      expect(recogniseShape(drawn(spiral))).toBeUndefined();
      expect(recogniseShape(drawn(ring(0, 0, 1500, 1500, { turns: 2 })))).toBeUndefined();
    });
  });

  describe("a rectangle", () => {
    it("is a path along its bounding box's sides, as its 4 corners, closed", () => {
      const result = recogniseShape(drawn(around(box, { wobble: 30 })));
      expect(result?.kind).toBe("rectangle");
      const points = result?.points ?? [];
      expect(points).toHaveLength(15);
      expect(points.filter((_, index) => index % 3 === 2)).toEqual([500, 500, 500, 500, 500]);
      const [first, second, third, fourth, last] = positionsOf(points);
      expect(last).toEqual(first);
      // The bounding box of what was drawn: the box, give or take the wobble.
      for (const [corner, [x, y]] of [
        [first, [1000, 2000]],
        [second, [5000, 2000]],
        [third, [5000, 4500]],
        [fourth, [1000, 4500]],
      ] as const) {
        expect(Math.abs((corner?.[0] ?? 0) - x)).toBeLessThanOrEqual(30);
        expect(Math.abs((corner?.[1] ?? 0) - y)).toBeLessThanOrEqual(30);
      }
    });

    it("is found from the middle of a side, drawn either way", () => {
      expect(recogniseShape(drawn(around(box, { start: 0.4 })))?.kind).toBe("rectangle");
      expect(
        recogniseShape(drawn(around([...box].reverse(), { start: 2.7, wobble: 20 })))?.kind,
      ).toBe("rectangle");
    });

    it("isn't a square turned on its corner", () => {
      const diamond: Position[] = [
        [2000, 0],
        [4000, 2000],
        [2000, 4000],
        [0, 2000],
      ];
      expect(recogniseShape(drawn(around(diamond)))).toBeUndefined();
    });

    it("isn't an L drawn out and back", () => {
      const out: Position[] = [];
      for (let index = 0; index <= 20; index += 1) out.push([0, index * 100]);
      for (let index = 1; index <= 20; index += 1) out.push([index * 100, 2000]);
      const back = [...out].reverse().map(([x, y]): Position => [x + 10, y - 10]);
      expect(recogniseShape(drawn([...out, ...back]))).toBeUndefined();
    });
  });

  describe("a triangle", () => {
    it("is a path around three corners, as those corners, closed", () => {
      const result = recogniseShape(drawn(around(peak, { wobble: 25 })));
      expect(result?.kind).toBe("triangle");
      const points = result?.points ?? [];
      expect(points).toHaveLength(12);
      expect(points.slice(0, 3)).toEqual(points.slice(-3));
      const corners = positionsOf(points).slice(0, 3);
      for (const [x, y] of peak) {
        const nearest = Math.min(...corners.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
        expect(nearest).toBeLessThan(60);
      }
    });

    it("is found from the middle of a side, in the order its corners were drawn", () => {
      const result = recogniseShape(drawn(around(peak, { start: 0.5 })));
      expect(result).toEqual({
        kind: "triangle",
        points: [3000, 1000, 500, 5500, 4200, 500, 1000, 4000, 500, 3000, 1000, 500],
      });
    });

    it("isn't a sliver", () => {
      const sliver: Position[] = [
        [0, 0],
        [4000, 100],
        [8000, 0],
      ];
      expect(recogniseShape(drawn(around(sliver)))).toBeUndefined();
    });
  });

  describe("handwriting", () => {
    it("stays as it was drawn", () => {
      const wave: Position[] = [];
      const zigzag: Position[] = [];
      const eight: Position[] = [];
      const loopWithTail: Position[] = ring(0, 0, 600, 800, { from: 1, turns: 0.9 });
      for (let index = 0; index <= 80; index += 1) {
        wave.push([index * 50, 400 * Math.sin(index / 5)]);
        zigzag.push([index * 50, index % 20 < 10 ? (index % 10) * 80 : 800 - (index % 10) * 80]);
        const angle = (index / 80) * 2 * Math.PI;
        eight.push([1000 * Math.sin(angle), 700 * Math.sin(2 * angle)]);
        loopWithTail.push([600 + index * 20, 700 + index * 5]);
      }
      const star: Position[] = [];
      for (let point = 0; point < 10; point += 1) {
        const angle = (point / 10) * 2 * Math.PI;
        const radius = point % 2 === 0 ? 2000 : 800;
        star.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
      }
      for (const [name, positions] of [
        ["a wave", wave],
        ["a zigzag", zigzag],
        ["a figure of eight", eight],
        ["a loop with a tail", loopWithTail],
        ["a star", around(star, { perSide: 8 })],
      ] as const) {
        expect(recogniseShape(drawn(positions)), name).toBeUndefined();
      }
    });

    it("stays as it was drawn when it's tiny, a dot or not finite", () => {
      expect(recogniseShape([])).toBeUndefined();
      expect(recogniseShape([100, 100, 500])).toBeUndefined();
      expect(recogniseShape([100, 100, 500, 100, 100, 500])).toBeUndefined();
      expect(recogniseShape(drawn(ring(0, 0, 100, 100)))).toBeUndefined();
      expect(recogniseShape([0, 0, 500, Number.NaN, 0, 500, 3000, 0, 500])).toBeUndefined();
    });
  });

  it("finds ellipses, rectangles and triangles of any size and place", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ellipse" as const, "rectangle" as const, "triangle" as const),
        fc.integer({ min: -20_000, max: 60_000 }),
        fc.integer({ min: -20_000, max: 60_000 }),
        fc.integer({ min: 600, max: 20_000 }),
        fc.double({ min: 0.4, max: 2.5, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.boolean(),
        fc.double({ min: 0, max: 0.004, noNaN: true }),
        (kind, x, y, width, aspect, start, reversed, wobble) => {
          const height = width * aspect;
          let positions: Position[];
          if (kind === "ellipse") {
            positions = ring(x, y, width / 2, height / 2, {
              from: start * 6,
              turns: reversed ? -1 : 1,
              wobble: wobble * 3,
            });
          } else {
            const corners: Position[] =
              kind === "rectangle"
                ? [
                    [x, y],
                    [x + width, y],
                    [x + width, y + height],
                    [x, y + height],
                  ]
                : [
                    [x, y + height],
                    [x + width * 0.4, y],
                    [x + width, y + height * 0.9],
                  ];
            if (reversed) corners.reverse();
            positions = around(corners, { start: start * corners.length, wobble: wobble * width });
          }
          const result = recogniseShape(drawn(positions));
          expect(result?.kind).toBe(kind);
          const points = result?.points ?? [];
          expect(points).toHaveLength({ ellipse: 49, rectangle: 5, triangle: 4 }[kind] * 3);
          expect(points.every(Number.isInteger)).toBe(true);
          expect(points.slice(0, 2)).toEqual(points.slice(-3, -1));
          expect(points.every((value, index) => index % 3 !== 2 || value === 500)).toBe(true);
          // A clean shape is recognised as itself.
          expect(recogniseShape(points)).toEqual(result);
        },
      ),
    );
  });

  it("finds a line between any two ends far enough apart", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20_000, max: 60_000 }),
        fc.integer({ min: -20_000, max: 60_000 }),
        fc.double({ min: 0, max: 6.28, noNaN: true }),
        fc.integer({ min: 600, max: 30_000 }),
        fc.double({ min: 0, max: 0.02, noNaN: true }),
        (x, y, angle, length, wobble) => {
          const positions: Position[] = [];
          for (let index = 0; index <= 30; index += 1) {
            const along = (index / 30) * length;
            const off =
              wobble * length * Math.sin(index * 0.7) * (index === 0 || index === 30 ? 0 : 1);
            positions.push([
              x + along * Math.cos(angle) - off * Math.sin(angle),
              y + along * Math.sin(angle) + off * Math.cos(angle),
            ]);
          }
          const points = drawn(positions);
          expect(recogniseShape(points)).toEqual({
            kind: "line",
            points: [points[0], points[1], 500, points.at(-3), points.at(-2), 500],
          });
        },
      ),
    );
  });
});
