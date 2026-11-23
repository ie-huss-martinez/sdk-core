import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesImage, NotesLink, NotesStroke, NotesText } from "../model/items.js";
import { boundsOf, itemBounds, strokeBounds, type TextHeight } from "./bounds.js";
import { strokeOutline } from "./outline.js";

const stroke = (points: number[], size = 200): NotesStroke => ({
  id: "s",
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size,
  points,
});

const text: NotesText = {
  id: "t",
  type: "text",
  x: 1000,
  y: 2000,
  width: 3000,
  text: "Two\nlines",
  size: 1200,
  color: "#000000",
};

const image: NotesImage = {
  id: "i",
  type: "image",
  x: -500,
  y: 100,
  width: 400,
  height: 300,
  image: { asset: `sha256:${"0".repeat(64)}`, mediaType: "image/png", size: 10 },
};

const link: NotesLink = { id: "l", type: "link", x: 50, y: 60, width: 70, height: 80, page: "p2" };

/** Two lines of text, each 1.5 times the font size high. */
const textHeight: TextHeight = (item) => item.size * 1.5 * item.text.split("\n").length;

describe("strokeBounds", () => {
  it("is the box around the points, grown by half the size", () => {
    expect(strokeBounds(stroke([100, 200, 500, 700, 50, 500, 400, 900, 500]))).toEqual({
      x: 0,
      y: -50,
      width: 800,
      height: 1050,
    });
  });

  it("lands on whole units for an odd size, growing outwards", () => {
    // Half of 25 is 12.5: the origin is floored and the far side is raised.
    expect(strokeBounds(stroke([100, 100, 500], 25))).toEqual({
      x: 87,
      y: 87,
      width: 26,
      height: 26,
    });
  });

  it("gives the same rectangle again for the same stroke", () => {
    const one = stroke([0, 0, 500, 10, 10, 500]);
    expect(strokeBounds(one)).toBe(strokeBounds(one));
    expect(strokeBounds({ ...one })).toEqual(strokeBounds(one));
  });

  it("holds all of a stroke's ink", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: -4000, max: 4000 }),
            fc.integer({ min: -4000, max: 4000 }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 10, max: 1500 }),
        fc.boolean(),
        (triples, size, uniform) => {
          const item: NotesStroke = {
            ...stroke(triples.flat(), size),
            ...(uniform ? { uniform } : {}),
          };
          const bounds = strokeBounds(item);
          expect(Number.isInteger(bounds.x) && Number.isInteger(bounds.y)).toBe(true);
          expect(Number.isInteger(bounds.width) && Number.isInteger(bounds.height)).toBe(true);
          const outline = strokeOutline(item);
          // A round end of perfect-freehand's is drawn around a point up to 3 units off.
          const slack = uniform ? 1e-6 : 4;
          for (let index = 0; index < outline.length; index += 2) {
            const x = outline[index] as number;
            const y = outline[index + 1] as number;
            expect(x).toBeGreaterThanOrEqual(bounds.x - slack);
            expect(x).toBeLessThanOrEqual(bounds.x + bounds.width + slack);
            expect(y).toBeGreaterThanOrEqual(bounds.y - slack);
            expect(y).toBeLessThanOrEqual(bounds.y + bounds.height + slack);
          }
        },
      ),
    );
  });
});

describe("itemBounds", () => {
  it("is a stroke's bounds", () => {
    const item = stroke([0, 0, 500, 100, 0, 500]);
    expect(itemBounds(item, textHeight)).toEqual(strokeBounds(item));
  });

  it("is a text box's position and width, with the height its text is laid out in", () => {
    expect(itemBounds(text, textHeight)).toEqual({ x: 1000, y: 2000, width: 3000, height: 3600 });
  });

  it("is a picture's and a link's own rectangle", () => {
    expect(itemBounds(image, textHeight)).toEqual({ x: -500, y: 100, width: 400, height: 300 });
    expect(itemBounds(link, textHeight)).toEqual({ x: 50, y: 60, width: 70, height: 80 });
  });
});

describe("boundsOf", () => {
  it("is undefined for no items", () => {
    expect(boundsOf([], textHeight)).toBeUndefined();
  });

  it("is the rectangle around every item", () => {
    expect(boundsOf([image, text, link], textHeight)).toEqual({
      x: -500,
      y: 60,
      width: 4500,
      height: 5540,
    });
  });

  it("takes any iterable", () => {
    expect(boundsOf(new Set([link]), textHeight)).toEqual({ x: 50, y: 60, width: 70, height: 80 });
  });
});
