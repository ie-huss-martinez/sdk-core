import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { item } from "../../../test/arbitraries/notes.js";
import { isNotesError } from "../errors/notes-error.js";
import {
  NOTES_AUDIO_TYPES,
  NOTES_IMAGE_TYPES,
  NOTES_PDF_TYPE,
  readItem,
  readItems,
} from "./items.js";

/** The rejection's reason and place, or `undefined` when the call returns. */
function refusal(run: () => unknown): { reason: unknown; at: unknown } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!isNotesError(error, "INVALID_DOCUMENT")) throw error;
    return { reason: error.details?.["reason"], at: error.details?.["at"] };
  }
}

const stroke = {
  id: "s",
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size: 200,
  points: [0, 0, 500],
};
const text = {
  id: "t",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  text: "x",
  size: 1_200,
  color: "#000000",
};

describe("the media types a notebook keeps", () => {
  it("are four kinds of picture, never SVG, with PDF and four kinds of sound", () => {
    expect(NOTES_IMAGE_TYPES).toStrictEqual(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    expect(NOTES_IMAGE_TYPES).not.toContain("image/svg+xml");
    expect(NOTES_PDF_TYPE).toBe("application/pdf");
    expect(NOTES_AUDIO_TYPES).toStrictEqual(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]);
  });
});

describe("readItem", () => {
  it("reads any valid item as it is, from JSON", () => {
    fc.assert(
      fc.property(item(), (value) => {
        expect(readItem(JSON.parse(JSON.stringify(value)), "$")).toStrictEqual(value);
      }),
      { numRuns: 300 },
    );
  });

  it("returns a copy, with its own list of points", () => {
    const read = readItem(stroke, "$");
    expect(read).not.toBe(stroke);
    expect(read.type === "stroke" && read.points).not.toBe(stroke.points);
    expect(read).toStrictEqual(stroke);
  });

  it("keeps uniform only when it's true, and leaves out what an item doesn't have", () => {
    expect(readItem({ ...stroke, uniform: true }, "$")).toStrictEqual({ ...stroke, uniform: true });
    expect(Object.keys(readItem(stroke, "$"))).toStrictEqual(Object.keys(stroke));
    expect(readItem(text, "$")).not.toHaveProperty("audio");
  });

  it("refuses an item by its own type's fields", () => {
    expect(refusal(() => readItem({ ...text, points: [0, 0, 500] }, "$.item"))).toStrictEqual({
      reason: "malformed-document",
      at: "$.item.points",
    });
    expect(refusal(() => readItem({ ...stroke, type: "text" }, "$.item"))?.reason).toBe(
      "malformed-document",
    );
  });

  it("refuses a type it doesn't know, or one that's only inherited", () => {
    for (const type of ["shape", "Stroke", "toString", "", 1, null, undefined]) {
      expect(refusal(() => readItem({ ...stroke, type }, "$.item"))).toStrictEqual({
        reason: "malformed-document",
        at: "$.item.type",
      });
    }
    const inherited = Object.create(stroke) as unknown;
    expect(refusal(() => readItem(inherited, "$.item"))?.at).toBe("$.item.type");
  });

  it("refuses what isn't an object", () => {
    for (const value of [null, undefined, "stroke", 1, [stroke]]) {
      expect(refusal(() => readItem(value, "$.item"))).toStrictEqual({
        reason: "malformed-document",
        at: "$.item",
      });
    }
  });

  it("says which field is wrong", () => {
    const cases: [object, string, string][] = [
      [{ ...stroke, size: 9 }, "invalid-size", "$.size"],
      [{ ...stroke, color: "#FFF" }, "invalid-color", "$.color"],
      [{ ...stroke, points: [0, 0] }, "invalid-points", "$.points"],
      [{ ...stroke, points: [0, 0.5, 500] }, "invalid-points", "$.points[1]"],
      [{ ...stroke, audio: { recording: "r", at: -1 } }, "invalid-time", "$.audio.at"],
      [{ ...stroke, audio: { recording: "", at: 0 } }, "invalid-id", "$.audio.recording"],
      [{ ...text, x: 2_880_001 }, "invalid-position", "$.x"],
      [{ ...text, width: 0 }, "invalid-size", "$.width"],
      [{ ...text, text: "\uD83D" }, "malformed-document", "$.text"],
      [{ ...text, id: "a b" }, "invalid-id", "$.id"],
    ];
    for (const [value, reason, at] of cases) {
      expect(
        refusal(() => readItem(value, "$")),
        at,
      ).toStrictEqual({ reason, at });
    }
  });
});

describe("readItems", () => {
  it("reads a list of items in order", () => {
    expect(readItems([stroke, text], "$.items", 2)).toStrictEqual([stroke, text]);
    expect(readItems([], "$.items", 0)).toStrictEqual([]);
  });

  it("refuses more items than the most allowed", () => {
    expect(refusal(() => readItems([stroke, text], "$.items", 1))).toStrictEqual({
      reason: "malformed-document",
      at: "$.items",
    });
  });

  it("refuses two items with one id, even of different kinds, and names the second", () => {
    expect(
      refusal(() => readItems([stroke, text, { ...text, id: "s" }], "$.items", 5)),
    ).toStrictEqual({
      reason: "duplicate-id",
      at: "$.items[2].id",
    });
  });

  it("tells ids named after Object.prototype's properties apart", () => {
    const named = ["__proto__", "constructor", "toString"].map((id) => ({ ...stroke, id }));
    expect(readItems(named, "$", 3).map((read) => read.id)).toStrictEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(refusal(() => readItems([...named, { ...text, id: "__proto__" }], "$", 4))?.reason).toBe(
      "duplicate-id",
    );
  });
});
