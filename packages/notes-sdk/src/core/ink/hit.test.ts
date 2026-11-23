import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesImage, NotesItem, NotesLink, NotesStroke, NotesText } from "../model/items.js";
import type { TextHeight } from "./bounds.js";
import {
  distanceToStroke,
  hitTest,
  itemsInLasso,
  itemsInRect,
  pointInPolygon,
  squaredDistanceToPath,
  squaredDistanceToSegment,
} from "./hit.js";

const stroke = (id: string, points: number[], size = 100): NotesStroke => ({
  id,
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size,
  points,
});

const text: NotesText = {
  id: "text",
  type: "text",
  x: 1000,
  y: 1000,
  width: 2000,
  text: "Hello",
  size: 1200,
  color: "#000000",
};

const image: NotesImage = {
  id: "image",
  type: "image",
  x: 5000,
  y: 1000,
  width: 1000,
  height: 1000,
  image: { asset: `sha256:${"0".repeat(64)}`, mediaType: "image/png", size: 10 },
};

const link: NotesLink = {
  id: "link",
  type: "link",
  x: 5200,
  y: 1200,
  width: 200,
  height: 200,
  page: "p2",
};

/** Every text box is 500 units high. */
const textHeight: TextHeight = () => 500;

const square = [0, 0, 100, 0, 100, 100, 0, 100];

describe("pointInPolygon", () => {
  it("tells inside from outside", () => {
    expect(pointInPolygon(square, 50, 50)).toBe(true);
    expect(pointInPolygon(square, 150, 50)).toBe(false);
    expect(pointInPolygon(square, 50, -1)).toBe(false);
    expect(pointInPolygon(square, -50, 50)).toBe(false);
  });

  it("follows a shape that isn't convex", () => {
    // An L: the square without its top right quarter.
    const corner = [0, 0, 50, 0, 50, 50, 100, 50, 100, 100, 0, 100];
    expect(pointInPolygon(corner, 25, 25)).toBe(true);
    expect(pointInPolygon(corner, 75, 75)).toBe(true);
    expect(pointInPolygon(corner, 75, 25)).toBe(false);
  });

  it("counts a region gone around twice as outside", () => {
    // Two squares that overlap in the middle, drawn as one polygon.
    const overlapping = [
      0, 0, 100, 0, 100, 100, 0, 100, 0, 0, 50, 50, 150, 50, 150, 150, 50, 150, 50, 50,
    ];
    expect(pointInPolygon(overlapping, 20, 80)).toBe(true);
    expect(pointInPolygon(overlapping, 120, 120)).toBe(true);
    expect(pointInPolygon(overlapping, 75, 75)).toBe(false);
  });

  it("holds nothing with fewer than 3 points", () => {
    expect(pointInPolygon([], 0, 0)).toBe(false);
    expect(pointInPolygon([0, 0], 0, 0)).toBe(false);
    expect(pointInPolygon([0, 0, 100, 100], 50, 50)).toBe(false);
  });

  it("agrees with a rectangle's own test", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        fc.double({ min: -1100, max: 1100, noNaN: true }),
        fc.double({ min: -1100, max: 1100, noNaN: true }),
        (left, top, width, height, x, y) => {
          const rectangle = [
            left,
            top,
            left + width,
            top,
            left + width,
            top + height,
            left,
            top + height,
          ];
          // Half a unit off the grid, so the point is never on a side.
          const inside =
            x + 0.5 > left && x + 0.5 < left + width && y + 0.5 > top && y + 0.5 < top + height;
          const onSide =
            [left, left + width].includes(x + 0.5) || [top, top + height].includes(y + 0.5);
          fc.pre(!onSide);
          expect(pointInPolygon(rectangle, x + 0.5, y + 0.5)).toBe(inside);
        },
      ),
    );
  });
});

describe("squaredDistanceToSegment", () => {
  it("measures to the nearest point of the segment", () => {
    expect(squaredDistanceToSegment(50, 30, 0, 0, 100, 0)).toBe(900);
    expect(squaredDistanceToSegment(-30, 40, 0, 0, 100, 0)).toBe(2500);
    expect(squaredDistanceToSegment(130, -40, 0, 0, 100, 0)).toBe(2500);
    expect(squaredDistanceToSegment(60, 0, 0, 0, 100, 0)).toBe(0);
  });

  it("treats a segment of no length as a point", () => {
    expect(squaredDistanceToSegment(3, 4, 0, 0, 0, 0)).toBe(25);
  });
});

describe("squaredDistanceToPath", () => {
  it("is infinite for no points", () => {
    expect(squaredDistanceToPath([], 2, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads pairs or triples", () => {
    expect(squaredDistanceToPath([0, 0, 100, 0, 100, 100], 2, 110, 50)).toBe(100);
    expect(squaredDistanceToPath([0, 0, 500, 100, 0, 500, 100, 100, 500], 3, 110, 50)).toBe(100);
  });
});

describe("distanceToStroke", () => {
  it("is the distance to the path through the stroke's points", () => {
    const item = stroke("s", [0, 0, 500, 1000, 0, 500, 1000, 1000, 500]);
    expect(distanceToStroke(item, 500, 300)).toBe(300);
    expect(distanceToStroke(item, 1400, 500)).toBe(400);
    expect(distanceToStroke(item, -300, -400)).toBe(500);
    expect(distanceToStroke(item, 1000, 700)).toBe(0);
  });

  it("is the distance to the point of a stroke of one point", () => {
    expect(distanceToStroke(stroke("dot", [100, 100, 500]), 400, 500)).toBe(500);
  });

  it("is never more than the distance to any of the stroke's points", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: -2000, max: 2000 })),
          { minLength: 1, maxLength: 20 },
        ),
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        (positions, x, y) => {
          const item = stroke(
            "s",
            positions.flatMap(([px, py]) => [px, py, 500]),
          );
          const distance = distanceToStroke(item, x, y);
          for (const [px, py] of positions) {
            expect(distance).toBeLessThanOrEqual(Math.hypot(px - x, py - y) + 1e-9);
          }
        },
      ),
    );
  });
});

describe("hitTest", () => {
  const line = stroke("line", [0, 0, 500, 1000, 0, 500], 100);

  it("hits a stroke within half its size and the tolerance of its centre line", () => {
    expect(hitTest([line], 500, 50, 0, textHeight)).toBe(line);
    expect(hitTest([line], 500, 51, 0, textHeight)).toBeUndefined();
    expect(hitTest([line], 500, 80, 30, textHeight)).toBe(line);
    expect(hitTest([line], 500, 81, 30, textHeight)).toBeUndefined();
    expect(hitTest([line], 1040, 0, 0, textHeight)).toBe(line);
  });

  it("misses a stroke whose bounds hold the point but whose ink doesn't", () => {
    const diagonal = stroke("diagonal", [0, 0, 500, 1000, 1000, 500], 100);
    expect(hitTest([diagonal], 900, 100, 20, textHeight)).toBeUndefined();
    expect(hitTest([diagonal], 500, 500, 0, textHeight)).toBe(diagonal);
  });

  it("hits a box inside its rectangle grown by the tolerance", () => {
    expect(hitTest([image], 5500, 1500, 0, textHeight)).toBe(image);
    expect(hitTest([image], 4990, 1500, 0, textHeight)).toBeUndefined();
    expect(hitTest([image], 4990, 1500, 10, textHeight)).toBe(image);
  });

  it("uses the height a text box is laid out in", () => {
    expect(hitTest([text], 2000, 1400, 0, textHeight)).toBe(text);
    expect(hitTest([text], 2000, 1600, 0, textHeight)).toBeUndefined();
    expect(hitTest([text], 2000, 1600, 0, () => 700)).toBe(text);
  });

  it("gives the topmost item, which is the last", () => {
    const over = stroke("over", [5000, 1300, 500, 6000, 1300, 500], 100);
    expect(hitTest([image, link], 5300, 1300, 0, textHeight)).toBe(link);
    expect(hitTest([link, image], 5300, 1300, 0, textHeight)).toBe(image);
    expect(hitTest([image, link, over], 5300, 1300, 0, textHeight)).toBe(over);
    expect(hitTest([image, link, over], 5300, 1390, 0, textHeight)).toBe(link);
  });

  it("gives nothing where there is nothing", () => {
    expect(hitTest([], 0, 0, 100, textHeight)).toBeUndefined();
    expect(hitTest([line, text, image, link], 9000, 9000, 100, textHeight)).toBeUndefined();
  });
});

describe("itemsInLasso", () => {
  const lasso = [0, 0, 1000, 0, 1000, 1000, 0, 1000];
  // Ten points along a line, 100 units apart, from x to x + 900.
  const dotted = (id: string, x: number): NotesStroke =>
    stroke(id, Array.from({ length: 10 }, (_, index) => [x + index * 100, 500, 500]).flat());

  it("selects a stroke with at least 60% of its points inside", () => {
    // From x = 550, the points at 550 to 950 are inside: 5 of 10. From 450, 6 of 10.
    expect(itemsInLasso([dotted("half", 550)], lasso, textHeight)).toEqual([]);
    expect(itemsInLasso([dotted("most", 450)], lasso, textHeight)).toEqual(["most"]);
    expect(itemsInLasso([dotted("all", 50)], lasso, textHeight)).toEqual(["all"]);
    expect(itemsInLasso([dotted("none", 2000)], lasso, textHeight)).toEqual([]);
  });

  it("selects a stroke of one point only when the point is inside", () => {
    expect(itemsInLasso([stroke("in", [500, 500, 500])], lasso, textHeight)).toEqual(["in"]);
    expect(itemsInLasso([stroke("out", [1020, 500, 500])], lasso, textHeight)).toEqual([]);
  });

  it("selects a box when its centre is inside", () => {
    const around = [900, 900, 2100, 900, 2100, 1300, 900, 1300];
    // The text is 500 high, so its centre is at 2000, 1250.
    expect(itemsInLasso([text], around, textHeight)).toEqual(["text"]);
    expect(itemsInLasso([text], around, () => 900)).toEqual([]);
    const corner = [4900, 900, 5400, 900, 5400, 1400, 4900, 1400];
    expect(itemsInLasso([image, link], corner, textHeight)).toEqual(["link"]);
  });

  it("gives ids in the page's order", () => {
    const items: NotesItem[] = [dotted("b", 50), stroke("a", [500, 500, 500]), dotted("c", 20)];
    expect(itemsInLasso(items, lasso, textHeight)).toEqual(["b", "a", "c"]);
  });

  it("selects nothing with fewer than 3 points", () => {
    const items = [stroke("in", [500, 500, 500])];
    expect(itemsInLasso(items, [], textHeight)).toEqual([]);
    expect(itemsInLasso(items, [0, 0, 1000, 1000], textHeight)).toEqual([]);
  });

  it("selects everything inside a lasso around the whole page", () => {
    const everything = [-1e7, -1e7, 1e7, -1e7, 1e7, 1e7, -1e7, 1e7];
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc
              .array(
                fc.tuple(
                  fc.integer({ min: -90_000, max: 90_000 }),
                  fc.integer({ min: -90_000, max: 90_000 }),
                ),
                { minLength: 1, maxLength: 12 },
              )
              .map(
                (positions): NotesItem =>
                  stroke(
                    "s",
                    positions.flatMap(([x, y]) => [x, y, 500]),
                  ),
              ),
            fc
              .tuple(
                fc.integer({ min: -90_000, max: 90_000 }),
                fc.integer({ min: -90_000, max: 90_000 }),
                fc.integer({ min: 1, max: 9000 }),
                fc.integer({ min: 1, max: 9000 }),
              )
              .map(([x, y, width, height]): NotesItem => ({ ...link, x, y, width, height })),
            fc
              .tuple(
                fc.integer({ min: -90_000, max: 90_000 }),
                fc.integer({ min: -90_000, max: 90_000 }),
              )
              .map(([x, y]): NotesItem => ({ ...text, x, y })),
          ),
          { maxLength: 8 },
        ),
        (drawn) => {
          const items = drawn.map((item, index) => ({ ...item, id: `item${index}` }));
          expect(itemsInLasso(items, everything, textHeight)).toEqual(items.map((item) => item.id));
        },
      ),
    );
  });
});

describe("itemsInRect", () => {
  it("selects the items whose bounds touch the rectangle, in the page's order", () => {
    const line = stroke("line", [0, 0, 500, 1000, 0, 500], 100);
    const items: NotesItem[] = [image, line, text, link];
    expect(itemsInRect(items, { x: 0, y: 0, width: 10_000, height: 10_000 }, textHeight)).toEqual([
      "image",
      "line",
      "text",
      "link",
    ]);
    expect(itemsInRect(items, { x: 5100, y: 1100, width: 50, height: 50 }, textHeight)).toEqual([
      "image",
    ]);
    expect(itemsInRect(items, { x: 2500, y: 1400, width: 2600, height: 50 }, textHeight)).toEqual([
      "image",
      "text",
    ]);
    expect(itemsInRect(items, { x: 7000, y: 7000, width: 50, height: 50 }, textHeight)).toEqual([]);
  });

  it("counts a stroke's width, and an edge that only touches", () => {
    const line = stroke("line", [0, 0, 500, 1000, 0, 500], 100);
    expect(itemsInRect([line], { x: 200, y: 50, width: 10, height: 10 }, textHeight)).toEqual([
      "line",
    ]);
    expect(itemsInRect([line], { x: 200, y: 51, width: 10, height: 10 }, textHeight)).toEqual([]);
  });
});
