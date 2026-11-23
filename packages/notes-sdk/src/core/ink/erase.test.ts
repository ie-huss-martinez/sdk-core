import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesImage, NotesItem, NotesLink, NotesStroke, NotesText } from "../model/items.js";
import { eraseAlong, replaceErased } from "./erase.js";
import { squaredDistanceToPath, squaredDistanceToSegment } from "./hit.js";

const stroke = (id: string, points: number[], size = 100): NotesStroke => ({
  id,
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size,
  points,
});

/** A line along the x axis from 0 to 1000, 100 wide, its pressure rising from 0 to 1000. */
const line = stroke("line", [0, 0, 0, 1000, 0, 1000]);

const text: NotesText = {
  id: "text",
  type: "text",
  x: 0,
  y: -500,
  width: 1000,
  text: "Hello",
  size: 1200,
  color: "#000000",
};

const image: NotesImage = {
  id: "image",
  type: "image",
  x: 0,
  y: -500,
  width: 1000,
  height: 1000,
  image: { asset: `sha256:${"0".repeat(64)}`, mediaType: "image/png", size: 10 },
};

const link: NotesLink = {
  id: "link",
  type: "link",
  x: 0,
  y: -500,
  width: 1000,
  height: 1000,
  page: "p2",
};

/** Ids `n1`, `n2` and so on. */
function counter(): () => string {
  let next = 0;
  return () => `n${++next}`;
}

const pointsOf = (strokes: readonly NotesStroke[]): (readonly number[])[] =>
  strokes.map((piece) => piece.points);

/** The distance between two segments: 0 if they cross, or else from an end of one to the other. */
function segmentDistance(a: readonly number[], b: readonly number[]): number {
  const [ax, ay, bx, by] = a as [number, number, number, number];
  const [cx, cy, dx, dy] = b as [number, number, number, number];
  const side = (px: number, py: number, qx: number, qy: number, x: number, y: number): number =>
    Math.sign((qx - px) * (y - py) - (qy - py) * (x - px));
  const crossing =
    side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 &&
    side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0;
  if (crossing) return 0;
  return Math.sqrt(
    Math.min(
      squaredDistanceToSegment(ax, ay, cx, cy, dx, dy),
      squaredDistanceToSegment(bx, by, cx, cy, dx, dy),
      squaredDistanceToSegment(cx, cy, ax, ay, bx, by),
      squaredDistanceToSegment(dx, dy, ax, ay, bx, by),
    ),
  );
}

/** The distance between a stroke's centre line and the eraser's path. */
function distanceBetween(item: NotesStroke, path: readonly number[]): number {
  const segmentsOf = (flat: readonly number[], stride: number): number[][] => {
    const segments: number[][] = [];
    const count = flat.length / stride;
    for (let index = 0; index < Math.max(1, count - 1); index += 1) {
      const next = Math.min(index + 1, count - 1);
      segments.push([
        flat[index * stride] as number,
        flat[index * stride + 1] as number,
        flat[next * stride] as number,
        flat[next * stride + 1] as number,
      ]);
    }
    return segments;
  };
  let nearest = Number.POSITIVE_INFINITY;
  for (const a of segmentsOf(item.points, 3)) {
    for (const b of segmentsOf(path, 2)) nearest = Math.min(nearest, segmentDistance(a, b));
  }
  return nearest;
}

describe("eraseAlong", () => {
  it("returns undefined when the eraser reaches nothing", () => {
    expect(eraseAlong([line], [], 100, "stroke", counter())).toBeUndefined();
    expect(eraseAlong([], [0, 0], 100, "stroke", counter())).toBeUndefined();
    expect(eraseAlong([line], [500, 400], 100, "stroke", counter())).toBeUndefined();
    expect(eraseAlong([line], [500, 400], 100, "precise", counter())).toBeUndefined();
  });

  it("never touches text, pictures or links", () => {
    for (const mode of ["stroke", "precise"] as const) {
      expect(eraseAlong([text, image, link], [500, 0], 300, mode, counter())).toBeUndefined();
    }
  });

  describe("in stroke mode", () => {
    it("removes whole every stroke within the radius and half its size", () => {
      // The line's ink reaches 50 from its centre line, and the eraser 100 from its own.
      expect(eraseAlong([line], [500, 150], 100, "stroke", counter())).toEqual({
        removed: ["line"],
        added: [],
        pieces: new Map([["line", []]]),
      });
      expect(eraseAlong([line], [500, 151], 100, "stroke", counter())).toBeUndefined();
    });

    it("removes a stroke the path crosses between its own points", () => {
      const result = eraseAlong([line], [300, -5000, 300, 5000], 1, "stroke", counter());
      expect(result?.removed).toEqual(["line"]);
    });

    it("removes a stroke of one point", () => {
      const dot = stroke("dot", [500, 0, 500]);
      expect(eraseAlong([dot], [0, 100, 1000, 100], 50, "stroke", counter())?.removed).toEqual([
        "dot",
      ]);
      expect(eraseAlong([dot], [0, 101, 1000, 101], 50, "stroke", counter())).toBeUndefined();
    });

    it("gives the removed strokes in the page's order, and asks for no ids", () => {
      const items: NotesItem[] = [
        stroke("c", [0, 0, 500, 1000, 0, 500]),
        text,
        stroke("far", [0, 5000, 500, 1000, 5000, 500]),
        stroke("a", [500, -500, 500, 500, 500, 500]),
      ];
      const result = eraseAlong(items, [500, 0], 10, "stroke", () => {
        throw new Error("no id is needed");
      });
      expect(result?.removed).toEqual(["c", "a"]);
      expect(result?.added).toEqual([]);
    });
  });

  describe("in precise mode", () => {
    it("cuts out the part under the eraser, at the edge of its reach", () => {
      // A tap of radius 50 on a line 100 wide reaches 100 along it on each side.
      const result = eraseAlong([line], [500, 0], 50, "precise", counter());
      expect(result?.removed).toEqual(["line"]);
      expect(result?.added).toEqual([
        { ...line, id: "n1", points: [0, 0, 0, 400, 0, 400] },
        { ...line, id: "n2", points: [600, 0, 600, 1000, 0, 1000] },
      ]);
      expect(result?.pieces).toEqual(new Map([["line", result?.added]]));
    });

    it("cuts along a path as well as under a tap", () => {
      const across = eraseAlong([line], [500, -900, 500, 900], 50, "precise", counter());
      expect(pointsOf(across?.added ?? [])).toEqual([
        [0, 0, 0, 400, 0, 400],
        [600, 0, 600, 1000, 0, 1000],
      ]);
      const along = eraseAlong([line], [300, 0, 500, 0, 700, 0], 50, "precise", counter());
      expect(pointsOf(along?.added ?? [])).toEqual([
        [0, 0, 0, 200, 0, 200],
        [800, 0, 800, 1000, 0, 1000],
      ]);
    });

    it("shortens a stroke erased at one end", () => {
      const result = eraseAlong([line], [0, 0], 50, "precise", counter());
      expect(pointsOf(result?.added ?? [])).toEqual([[100, 0, 100, 1000, 0, 1000]]);
    });

    it("cuts a stroke of many points wherever the eraser crosses it", () => {
      // Down, across and up, crossed twice by one sweep from left to right.
      const bucket = stroke("u", [0, 0, 500, 0, 1000, 500, 1000, 1000, 500, 1000, 0, 500]);
      const result = eraseAlong([bucket], [-500, 500, 1500, 500], 50, "precise", counter());
      expect(pointsOf(result?.added ?? [])).toEqual([
        [0, 0, 500, 0, 400, 500],
        [0, 600, 500, 0, 1000, 500, 1000, 1000, 500, 1000, 600, 500],
        [1000, 400, 500, 1000, 0, 500],
      ]);
    });

    it("leaves nothing of a stroke that is all under the eraser", () => {
      expect(eraseAlong([line], [500, 0], 1000, "precise", counter())).toEqual({
        removed: ["line"],
        added: [],
        pieces: new Map([["line", []]]),
      });
    });

    it("drops what would remain as a single point", () => {
      // All but the first third of a unit is erased, and that rounds to one point.
      const result = eraseAlong([line], [600, 0], 549.7, "precise", counter());
      expect(result).toEqual({ removed: ["line"], added: [], pieces: new Map([["line", []]]) });
    });

    it("removes a stroke of one point it reaches, and leaves alone one it doesn't", () => {
      const dot = stroke("dot", [500, 0, 500]);
      expect(eraseAlong([dot], [500, 90], 50, "precise", counter())).toEqual({
        removed: ["dot"],
        added: [],
        pieces: new Map([["dot", []]]),
      });
      expect(eraseAlong([dot], [500, 110], 50, "precise", counter())).toBeUndefined();
    });

    it("keeps the stroke's tool, colour, size, shape and recording in every piece", () => {
      const shape: NotesStroke = {
        id: "shape",
        type: "stroke",
        tool: "highlighter",
        color: "#ffcc00",
        size: 100,
        points: [0, 0, 500, 1000, 0, 500],
        uniform: true,
        audio: { recording: "r1", at: 2500 },
      };
      const result = eraseAlong([shape], [500, 0], 50, "precise", counter());
      expect(result?.added).toEqual([
        { ...shape, id: "n1", points: [0, 0, 500, 400, 0, 500] },
        { ...shape, id: "n2", points: [600, 0, 500, 1000, 0, 500] },
      ]);
    });

    it("gives each stroke's pieces, in the page's order", () => {
      const upright = stroke("upright", [500, -1000, 500, 500, 1000, 500]);
      const result = eraseAlong([upright, image, line], [500, 0], 50, "precise", counter());
      expect(result?.removed).toEqual(["upright", "line"]);
      expect(result?.added.map((piece) => piece.id)).toEqual(["n1", "n2", "n3", "n4"]);
      expect(result?.pieces.get("upright")?.map((piece) => piece.id)).toEqual(["n1", "n2"]);
      expect(result?.pieces.get("line")?.map((piece) => piece.id)).toEqual(["n3", "n4"]);
    });

    it("doesn't cut a stroke the eraser only grazes", () => {
      // Exactly at its reach: stroke mode removes it, and there is nothing to cut out.
      expect(eraseAlong([line], [500, 150], 100, "stroke", counter())?.removed).toEqual(["line"]);
      expect(eraseAlong([line], [500, 150], 100, "precise", counter())).toBeUndefined();
    });
  });

  const position = fc.tuple(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 3000 }));
  const strokes = fc.array(
    fc.tuple(
      fc.array(fc.tuple(position, fc.integer({ min: 0, max: 1000 })), {
        minLength: 1,
        maxLength: 10,
      }),
      fc.integer({ min: 10, max: 600 }),
    ),
    { minLength: 1, maxLength: 5 },
  );
  const eraserPath = fc.array(position, { minLength: 1, maxLength: 5 }).map((path) => path.flat());
  const build = (drawn: [[[number, number], number][], number][]): NotesStroke[] =>
    drawn.map(([points, size], index) =>
      stroke(
        `s${index}`,
        points.flatMap(([[x, y], pressure]) => [x, y, pressure]),
        size,
      ),
    );

  it("removes, in stroke mode, exactly the strokes within reach", () => {
    fc.assert(
      fc.property(strokes, eraserPath, fc.integer({ min: 1, max: 500 }), (drawn, path, radius) => {
        const items = build(drawn);
        const removed = eraseAlong(items, path, radius, "stroke", counter())?.removed ?? [];
        for (const item of items) {
          const margin = distanceBetween(item, path) - (radius + item.size / 2);
          // Within a millionth of a unit of the reach, either answer is right.
          if (margin < -1e-6) expect(removed).toContain(item.id);
          if (margin > 1e-6) expect(removed).not.toContain(item.id);
        }
      }),
    );
  });

  it("leaves, in precise mode, only ink outside the eraser's reach, where it was", () => {
    fc.assert(
      fc.property(strokes, eraserPath, fc.integer({ min: 1, max: 500 }), (drawn, path, radius) => {
        const items = build(drawn);
        const newId = counter();
        const result = eraseAlong(items, path, radius, "precise", newId);
        const whole = eraseAlong(items, path, radius, "stroke", counter());
        // Nothing is cut that stroke mode wouldn't remove.
        for (const id of result?.removed ?? []) expect(whole?.removed).toContain(id);
        if (!result) return;
        expect(result.added).toEqual([...result.pieces.values()].flat());
        expect(new Set(result.added.map((piece) => piece.id)).size).toBe(result.added.length);

        for (const item of items) {
          const pieces = result.pieces.get(item.id);
          const reach = radius + item.size / 2;
          if (!pieces) {
            expect(result.removed).not.toContain(item.id);
            continue;
          }
          const kept: string[] = [];
          for (const piece of pieces) {
            expect({ ...piece, id: item.id, points: item.points }).toEqual(item);
            expect(piece.points.length % 3).toBe(0);
            expect(piece.points.length).toBeGreaterThanOrEqual(6);
            expect(piece.points.every(Number.isInteger)).toBe(true);
            for (let index = 0; index < piece.points.length; index += 3) {
              const x = piece.points[index] as number;
              const y = piece.points[index + 1] as number;
              kept.push(`${x},${y}`);
              expect(piece.points[index + 2]).toBeGreaterThanOrEqual(0);
              expect(piece.points[index + 2]).toBeLessThanOrEqual(1000);
              // On the stroke's own path, give or take the rounding of a cut point.
              expect(Math.sqrt(squaredDistanceToPath(item.points, 3, x, y))).toBeLessThanOrEqual(
                0.75,
              );
              // Outside the eraser's reach, give or take the same rounding.
              expect(Math.sqrt(squaredDistanceToPath(path, 2, x, y))).toBeGreaterThanOrEqual(
                reach - 0.75,
              );
              if (index === 0) continue;
              // And so is the ink between two points of a piece.
              const middleX = (x + (piece.points[index - 3] as number)) / 2;
              const middleY = (y + (piece.points[index - 2] as number)) / 2;
              expect(
                Math.sqrt(squaredDistanceToPath(path, 2, middleX, middleY)),
              ).toBeGreaterThanOrEqual(reach - 1.5);
            }
          }
          // Every point of the stroke that is clear of the eraser is still there,
          // unless it was left on its own.
          const count = item.points.length / 3;
          for (let index = 0; index < count; index += 1) {
            const x = item.points[index * 3] as number;
            const y = item.points[index * 3 + 1] as number;
            const clear = (at: number): boolean =>
              at >= 0 &&
              at < count &&
              Math.sqrt(
                squaredDistanceToPath(
                  path,
                  2,
                  item.points[at * 3] as number,
                  item.points[at * 3 + 1] as number,
                ),
              ) >
                reach + 1;
            if (
              clear(index) &&
              (clear(index - 1) || clear(index + 1)) &&
              isClearBetween(item, path, reach, index, count)
            ) {
              expect(kept).toContain(`${x},${y}`);
            }
          }
        }
      }),
    );
  });
});

/** Whether a point's segment to a clear neighbour is long enough to leave a piece of two points. */
function isClearBetween(
  item: NotesStroke,
  path: readonly number[],
  reach: number,
  index: number,
  count: number,
): boolean {
  const x = item.points[index * 3] as number;
  const y = item.points[index * 3 + 1] as number;
  for (const other of [index - 1, index + 1]) {
    if (other < 0 || other >= count) continue;
    const otherX = item.points[other * 3] as number;
    const otherY = item.points[other * 3 + 1] as number;
    if (Math.sqrt(squaredDistanceToPath(path, 2, otherX, otherY)) <= reach + 1) continue;
    if (Math.hypot(otherX - x, otherY - y) >= 2) return true;
  }
  return false;
}

describe("replaceErased", () => {
  it("puts each stroke's pieces where the stroke was", () => {
    const upright = stroke("upright", [500, -1000, 500, 500, 1000, 500]);
    const far = stroke("far", [0, 5000, 500, 1000, 5000, 500]);
    const items: NotesItem[] = [far, upright, image, line, text];
    const result = eraseAlong(items, [500, 0], 50, "precise", counter());
    if (!result) throw new Error("the eraser reaches two strokes");
    const next = replaceErased(items, result);
    expect(next.map((item) => item.id)).toEqual(["far", "n1", "n2", "image", "n3", "n4", "text"]);
    expect(next[0]).toBe(far);
    expect(next[3]).toBe(image);
    expect(items).toHaveLength(5);
  });

  it("takes out strokes removed whole", () => {
    const items: NotesItem[] = [text, line, link];
    const result = eraseAlong(items, [500, 0], 50, "stroke", counter());
    if (!result) throw new Error("the eraser reaches the line");
    expect(replaceErased(items, result)).toEqual([text, link]);
  });
});
