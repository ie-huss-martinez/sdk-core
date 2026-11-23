import { describe, expect, it } from "vitest";
import { clipToLength } from "./text.js";

/** Whether a string has no half of a surrogate pair on its own. */
const wellFormed = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

describe("clipToLength", () => {
  it("leaves a value within the length as it is", () => {
    expect(clipToLength("notes", 5)).toBe("notes");
  });

  it("counts characters, not UTF-16 units", () => {
    const faces = "\u{1F600}".repeat(4);
    expect(clipToLength(faces, 4)).toBe(faces);
    expect(clipToLength(faces, 3)).toBe("\u{1F600}".repeat(3));
  });

  it("never cuts a character in two", () => {
    expect(wellFormed(clipToLength(`ab\u{1F600}cd`, 3))).toBe(true);
  });
});
