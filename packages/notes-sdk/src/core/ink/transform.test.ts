import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesImage, NotesItem, NotesLink, NotesStroke, NotesText } from "../model/items.js";
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
