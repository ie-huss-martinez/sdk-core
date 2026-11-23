import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesImage, NotesItem, NotesLink, NotesStroke, NotesText } from "../model/items.js";
import {
  NOTES_LENGTH_RANGE,
  NOTES_POSITION_RANGE,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
} from "../model/portable.js";
import { cloneItems, recolorItems, scaleItems, translateItems } from "./transform.js";

const stroke: NotesStroke = {
  id: "s",
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size: 200,
  points: [100, 200, 300, 500, 600, 700],
  audio: { recording: "r1", at: 1500 },
};

const shape: NotesStroke = { ...stroke, id: "u", tool: "highlighter", uniform: true };

const text: NotesText = {
  id: "t",
  type: "text",
  x: 1000,
  y: 2000,
  width: 3000,
  text: "Hello",
  size: 1200,
  color: "#000000",
};

const image: NotesImage = {
  id: "i",
  type: "image",
  x: 100,
  y: 100,
  width: 400,
  height: 300,
  image: { asset: `sha256:${"0".repeat(64)}`, mediaType: "image/png", size: 10 },
};

const link: NotesLink = { id: "l", type: "link", x: 50, y: 60, width: 70, height: 80, page: "p2" };

const all: readonly NotesItem[] = [stroke, shape, text, image, link];

const anyItems = fc.array(
  fc.oneof(
    fc.record({
      id: fc.constant("s"),
      type: fc.constant("stroke" as const),
      tool: fc.constantFrom("pen" as const, "highlighter" as const),
      color: fc.constant("#000000" as const),
      size: fc.integer({ min: 10, max: 7200 }),
      points: fc
        .array(
          fc.tuple(
            fc.integer({ min: -9000, max: 90_000 }),
            fc.integer({ min: -9000, max: 90_000 }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { minLength: 1, maxLength: 8 },
        )
        .map((triples) => triples.flat()),
    }),
    fc.record({
      id: fc.constant("i"),
      type: fc.constant("link" as const),
      x: fc.integer({ min: -9000, max: 90_000 }),
      y: fc.integer({ min: -9000, max: 90_000 }),
      width: fc.integer({ min: 1, max: 9000 }),
      height: fc.integer({ min: 1, max: 9000 }),
      page: fc.constant("p"),
    }),
    fc.record({
      id: fc.constant("t"),
      type: fc.constant("text" as const),
      x: fc.integer({ min: -9000, max: 90_000 }),
      y: fc.integer({ min: -9000, max: 90_000 }),
      width: fc.integer({ min: 1, max: 9000 }),
      text: fc.constant("text"),
      size: fc.integer({ min: 400, max: 28_800 }),
      color: fc.constant("#000000" as const),
    }),
  ),
  { maxLength: 6 },
) as fc.Arbitrary<NotesItem[]>;

const [LOWEST, HIGHEST] = NOTES_POSITION_RANGE;
const [SHORTEST, LONGEST] = NOTES_LENGTH_RANGE;

/** Items anywhere the page reader accepts, the ends of its ranges included. */
const position = fc.oneof(
  fc.integer({ min: LOWEST, max: HIGHEST }),
  fc.constantFrom(LOWEST, LOWEST + 1, 0, HIGHEST - 1, HIGHEST),
);
const side = fc.oneof(
  fc.integer({ min: SHORTEST, max: LONGEST }),
  fc.constantFrom(SHORTEST, LONGEST),
);
const readableItems = fc.array(
  fc.oneof(
    fc.record({
      id: fc.constant("s"),
      type: fc.constant("stroke" as const),
      tool: fc.constant("pen" as const),
      color: fc.constant("#000000" as const),
      size: fc.integer({ min: NOTES_STROKE_SIZE_RANGE[0], max: NOTES_STROKE_SIZE_RANGE[1] }),
      points: fc
        .array(fc.tuple(position, position, fc.integer({ min: 0, max: 1000 })), {
          minLength: 1,
          maxLength: 6,
        })
        .map((triples) => triples.flat()),
    }),
    fc.record({
      id: fc.constant("l"),
      type: fc.constant("link" as const),
      x: position,
      y: position,
      width: side,
      height: side,
      page: fc.constant("p"),
    }),
    fc.record({
      id: fc.constant("t"),
      type: fc.constant("text" as const),
      x: position,
      y: position,
      width: side,
      text: fc.constant("text"),
      size: fc.integer({ min: NOTES_TEXT_SIZE_RANGE[0], max: NOTES_TEXT_SIZE_RANGE[1] }),
      color: fc.constant("#000000" as const),
    }),
  ),
  { maxLength: 5 },
) as fc.Arbitrary<NotesItem[]>;

/** Every position of the items, as `x, y` pairs: a stroke's points, or another item's corner. */
function positionsOf(items: readonly NotesItem[]): number[] {
  return items.flatMap((item) =>
    item.type === "stroke" ? item.points.filter((_, at) => at % 3 !== 2) : [item.x, item.y],
  );
}

const whole = (value: number, [minimum, maximum]: readonly [number, number]): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

/** Fails unless the page reader would accept every position, length and size of the items. */
function expectReadable(items: readonly NotesItem[]): void {
  for (const item of items) {
    for (const value of positionsOf([item])) expect(whole(value, NOTES_POSITION_RANGE)).toBe(true);
    if (item.type === "stroke") {
      expect(whole(item.size, NOTES_STROKE_SIZE_RANGE)).toBe(true);
      continue;
    }
    expect(whole(item.width, NOTES_LENGTH_RANGE)).toBe(true);
    if (item.type === "text") expect(whole(item.size, NOTES_TEXT_SIZE_RANGE)).toBe(true);
    else expect(whole(item.height, NOTES_LENGTH_RANGE)).toBe(true);
  }
}

/** Distances of every size and sign, and those that aren't numbers at all. */
const anyDistance = fc.oneof(
  fc.double({ min: -4_500_000, max: 4_500_000, noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0),
);

describe("translateItems", () => {
  it("moves every kind of item, and nothing else about it", () => {
    expect(translateItems(all, 10, -20)).toEqual([
      { ...stroke, points: [110, 180, 300, 510, 580, 700] },
      { ...shape, points: [110, 180, 300, 510, 580, 700] },
      { ...text, x: 1010, y: 1980 },
      { ...image, x: 110, y: 80 },
      { ...link, x: 60, y: 40 },
    ]);
  });

  it("rounds the distance once, so every point moves alike", () => {
    const [moved] = translateItems([stroke], 0.6, -0.6);
    expect((moved as NotesStroke).points).toEqual([101, 199, 300, 501, 599, 700]);
    expect(translateItems([link], 0.4, -0.4)).toEqual([link]);
  });

  it("doesn't change the items given", () => {
    const before = structuredClone(all);
    translateItems(all, 500, 500);
    expect(all).toEqual(before);
  });

  it("is undone by the opposite distance", () => {
    fc.assert(
      fc.property(
        anyItems,
        fc.double({ min: -50_000, max: 50_000, noNaN: true }),
        fc.double({ min: -50_000, max: 50_000, noNaN: true }),
        (items, dx, dy) => {
          expect(translateItems(translateItems(items, dx, dy), -dx, -dy)).toEqual(items);
        },
      ),
    );
  });

  it("stops a copy at the edge of the range positions may have", () => {
    // Duplicating offsets the copy by 1800 each way, and this stroke is at the edge already.
    const atEdge: NotesStroke = { ...stroke, points: [HIGHEST, 200, 300, HIGHEST - 500, 600, 700] };
    expect(translateItems([atEdge], 1800, 1800)).toEqual([
      { ...atEdge, points: [HIGHEST, 2000, 300, HIGHEST - 500, 2400, 700] },
    ]);
    const corner: NotesText = { ...text, x: LOWEST + 300, y: LOWEST };
    expect(translateItems([corner], -1000, -1000)).toEqual([{ ...corner, x: LOWEST }]);
  });

  it("cuts a move short for every item alike, so a selection keeps its shape", () => {
    const near: NotesLink = { ...link, x: HIGHEST - 700, y: 60 };
    expect(translateItems([stroke, near, text], 5000, -20)).toEqual([
      { ...stroke, points: [800, 180, 300, 1200, 580, 700] },
      { ...near, x: HIGHEST, y: 40 },
      { ...text, x: 1700, y: 1980 },
    ]);
  });

  it("moves nothing by a distance that isn't a number", () => {
    expect(translateItems(all, Number.NaN, Number.NaN)).toEqual(all);
  });

  it("never moves a position out of range, and moves every position alike", () => {
    fc.assert(
      fc.property(readableItems, anyDistance, anyDistance, (items, dx, dy) => {
        const moved = translateItems(items, dx, dy);
        expectReadable(moved);
        const before = positionsOf(items);
        const after = positionsOf(moved);
        expect(after).toHaveLength(before.length);
        if (before.length === 0) return;
        const movedX = (after[0] as number) - (before[0] as number);
        const movedY = (after[1] as number) - (before[1] as number);
        for (let at = 0; at < before.length; at += 2) {
          expect((after[at] as number) - (before[at] as number)).toBe(movedX);
          expect((after[at + 1] as number) - (before[at + 1] as number)).toBe(movedY);
        }
        // Never further than asked, nor the other way.
        for (const [gone, asked] of [
          [movedX, dx],
          [movedY, dy],
        ] as const) {
          if (gone === 0) continue;
          expect(Math.sign(gone)).toBe(Math.sign(asked));
          expect(Math.abs(gone)).toBeLessThanOrEqual(Math.abs(asked) + 0.5);
        }
      }),
    );
  });
});

describe("scaleItems", () => {
  const from = { x: 0, y: 0, width: 1000, height: 1000 };

  it("maps a stroke's points and scales its size by the mean of both factors", () => {
    const [scaled] = scaleItems([stroke], from, { x: 100, y: 200, width: 4000, height: 1000 });
    // Four times as wide and as high as before: twice the size.
    expect(scaled).toEqual({ ...stroke, points: [500, 400, 300, 2100, 800, 700], size: 400 });
  });

  it("scales a text box's position, width and size, the size by the vertical factor", () => {
    const [scaled] = scaleItems([text], from, { x: 0, y: 0, width: 500, height: 2000 });
    expect(scaled).toEqual({ ...text, x: 500, y: 4000, width: 1500, size: 2400 });
  });

  it("scales a picture's and a link's rectangle", () => {
    expect(scaleItems([image, link], from, { x: 1000, y: 0, width: 2000, height: 500 })).toEqual([
      { ...image, x: 1200, y: 50, width: 800, height: 150 },
      { ...link, x: 1100, y: 30, width: 140, height: 40 },
    ]);
  });

  it("is the same items when the rectangles are the same", () => {
    expect(scaleItems(all, from, from)).toEqual(all);
  });

  it("doesn't stretch along an axis the first rectangle has no length on", () => {
    const flat = { x: 0, y: 200, width: 1000, height: 0 };
    const [scaled] = scaleItems([link], flat, { x: 0, y: 500, width: 2000, height: 700 });
    expect(scaled).toEqual({ ...link, x: 100, y: 360, width: 140, height: 80 });
  });

  it("keeps sizes within the model's ranges, and widths and heights at 1 or more", () => {
    const tiny = scaleItems(all, from, { x: 0, y: 0, width: 1, height: 1 });
    expect((tiny[0] as NotesStroke).size).toBe(10);
    expect((tiny[2] as NotesText).size).toBe(400);
    expect((tiny[2] as NotesText).width).toBe(3);
    expect(tiny[3]).toMatchObject({ width: 1, height: 1 });
    const huge = scaleItems(all, from, { x: 0, y: 0, width: 100_000, height: 100_000 });
    expect((huge[0] as NotesStroke).size).toBe(7200);
    expect((huge[2] as NotesText).size).toBe(28_800);
    const none = scaleItems(all, from, { x: 0, y: 0, width: 0, height: 0 });
    expect(none[3]).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect((none[0] as NotesStroke).size).toBe(10);
  });

  it("keeps a length within the range the page reader accepts", () => {
    // A wide, low picture, resized by its corner to six times its size.
    const wide: NotesImage = { ...image, x: 0, y: 0, width: 500_000, height: 5_000 };
    const [scaled] = scaleItems(
      [wide],
      { x: 0, y: 0, width: 500_000, height: 5_000 },
      { x: 0, y: 0, width: 3_000_000, height: 30_000 },
    );
    expect(scaled).toEqual({ ...wide, width: LONGEST, height: 30_000 });
    const [wider] = scaleItems([text], from, { x: 0, y: 0, width: 1_000_000, height: 1000 });
    expect(wider).toMatchObject({ width: LONGEST });
  });

  it("keeps a position within the range the page reader accepts", () => {
    const far = { x: 0, y: 0, width: 4_000_000, height: 4_000_000 };
    expect(scaleItems([stroke, link], from, far)).toMatchObject([
      { points: [400_000, 800_000, 300, 2_000_000, 2_400_000, 700] },
      { x: 200_000, y: 240_000 },
    ]);
    const further = { x: 0, y: 0, width: 8_000_000, height: 8_000_000 };
    expect(scaleItems([stroke, text], from, further)).toMatchObject([
      { points: [800_000, 1_600_000, 300, HIGHEST, HIGHEST, 700] },
      { x: HIGHEST, y: HIGHEST },
    ]);
    const before = { x: -8_000_000, y: -8_000_000, width: 8_000, height: 8_000 };
    expect(scaleItems([link], from, before)).toMatchObject([{ x: LOWEST, y: LOWEST }]);
  });

  it("leaves a value as it was when the resize gives no number for it", () => {
    const nowhere = { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN };
    expect(scaleItems(all, from, nowhere)).toEqual(all);
  });

  it("never gives a position, a length or a size the page reader refuses", () => {
    const length = fc.oneof(
      fc.double({ min: 0, max: 6_000_000, noNaN: true }),
      fc.constantFrom(0, 1, Number.NaN, Number.POSITIVE_INFINITY),
    );
    const rect = fc.record({ x: anyDistance, y: anyDistance, width: length, height: length });
    fc.assert(
      fc.property(readableItems, rect, rect, (items, source, target) => {
        const scaled = scaleItems(items, source, target);
        expect(scaled).toHaveLength(items.length);
        expectReadable(scaled);
      }),
    );
  });

  it("gives whole numbers, and leaves pressures alone", () => {
    fc.assert(
      fc.property(
        anyItems,
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (items, width, height, toWidth, toHeight) => {
          const scaled = scaleItems(
            items,
            { x: -300, y: 700, width, height },
            { x: 250, y: -90, width: toWidth, height: toHeight },
          );
          expect(scaled).toHaveLength(items.length);
          scaled.forEach((item, index) => {
            if (item.type === "stroke") {
              const before = (items[index] as NotesStroke).points;
              expect(
                item.points.every((value) => Number.isInteger(value) && !Object.is(value, -0)),
              ).toBe(true);
              expect(item.points.filter((_, at) => at % 3 === 2)).toEqual(
                before.filter((_, at) => at % 3 === 2),
              );
              expect(item.size).toBeGreaterThanOrEqual(10);
              expect(item.size).toBeLessThanOrEqual(7200);
              return;
            }
            expect(Number.isInteger(item.x) && Number.isInteger(item.y)).toBe(true);
            expect(Number.isInteger(item.width) && item.width >= 1).toBe(true);
            if (item.type === "text") {
              expect(Number.isInteger(item.size) && item.size >= 400 && item.size <= 28_800).toBe(
                true,
              );
            } else {
              expect(Number.isInteger(item.height) && item.height >= 1).toBe(true);
            }
          });
        },
      ),
    );
  });
});

describe("recolorItems", () => {
  it("colours ink and text, and returns pictures and links as they are", () => {
    const recoloured = recolorItems(all, "#ff0000");
    expect(recoloured.slice(0, 3)).toEqual([
      { ...stroke, color: "#ff0000" },
      { ...shape, color: "#ff0000" },
      { ...text, color: "#ff0000" },
    ]);
    expect(recoloured[3]).toBe(image);
    expect(recoloured[4]).toBe(link);
    expect(stroke.color).toBe("#000000");
  });
});

describe("cloneItems", () => {
  it("copies every item under a new id, in order", () => {
    let next = 0;
    const clones = cloneItems(all, () => `new${++next}`);
    expect(clones).toEqual(all.map((item, index) => ({ ...item, id: `new${index + 1}` })));
    expect(all.map((item) => item.id)).toEqual(["s", "u", "t", "i", "l"]);
  });

  it("gives nothing for no items, without asking for an id", () => {
    expect(
      cloneItems([], () => {
        throw new Error("no id is needed");
      }),
    ).toEqual([]);
  });
});
