import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesText } from "../../core/model/items.js";
import { NOTES_MAX_TEXT_LENGTH } from "../../core/model/portable.js";
import { layoutText, textHeight } from "./text-layout.js";

/** How many characters the layout has asked the font to measure. */
let measured = 0;

// A font in which every character is half as wide as the font is tall, in
// place of the browser's canvas, which Node doesn't have.
beforeAll(() => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          font: "",
          measureText(text: string) {
            measured += text.length;
            return { width: [...text].length * 50 };
          },
        };
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  measured = 0;
});

/** A text box whose characters are 500 units wide each. */
const box = (text: string, width: number): NotesText => ({
  id: "t",
  type: "text",
  x: 0,
  y: 0,
  width,
  text,
  size: 1_000,
  color: "#1f2937",
});

const texts = (item: NotesText): string[] => layoutText(item).lines.map((line) => line.text);

describe("layoutText", () => {
  it("breaks at spaces, and at every line break typed", () => {
    expect(texts(box("one two three\nfour", 4_000))).toEqual(["one two", "three", "four"]);
  });

  it("keeps a line that fits whole, and measures it", () => {
    expect(layoutText(box("one two", 3_500)).lines).toEqual([{ text: "one two", width: 3_500 }]);
  });

  it("breaks inside a word wider than the box, and carries on after it", () => {
    expect(texts(box("abcdefg hi", 2_500))).toEqual(["abcde", "fg hi"]);
    expect(texts(box("abcdefghij kl", 2_000))).toEqual(["abcd", "efgh", "ij", "kl"]);
    expect(texts(box("ab cdefghij", 2_000))).toEqual(["ab", "cdef", "ghij"]);
  });

  it("doesn't break a word for the space after it", () => {
    // "abcd" fits; the space that follows it is never measured against the box.
    expect(texts(box("abcd efgh", 2_000))).toEqual(["abcd", "efgh"]);
  });

  it("gives a box narrower than a character one character to a line", () => {
    expect(texts(box("abc", 1))).toEqual(["a", "b", "c"]);
  });

  it("never splits a character written as two code units", () => {
    expect(texts(box("\u{1F600}\u{1F601}\u{1F602}", 1_000))).toEqual([
      "\u{1F600}\u{1F601}",
      "\u{1F602}",
    ]);
  });

  it("keeps an empty line for an empty paragraph, and for empty text", () => {
    expect(texts(box("a\n\nb", 4_000))).toEqual(["a", "", "b"]);
    expect(texts(box("", 4_000))).toEqual([""]);
    expect(textHeight(box("", 4_000))).toBe(1_250);
  });

  it("lays out the longest unbroken word in the narrowest box with work that grows with its length", () => {
    const item = box("x".repeat(NOTES_MAX_TEXT_LENGTH), 1);
    const { lines } = layoutText(item);
    expect(lines).toHaveLength(NOTES_MAX_TEXT_LENGTH);
    // A few characters measured for each one laid out: measuring what's left
    // of the word for every line would be 200 million.
    expect(measured).toBeLessThan(NOTES_MAX_TEXT_LENGTH * 8);
  });

  it("does the same for long lines of a long word", () => {
    const item = box("x".repeat(NOTES_MAX_TEXT_LENGTH), 500 * 4_000);
    expect(texts(item).map((line) => line.length)).toEqual([4_000, 4_000, 4_000, 4_000, 4_000]);
    // Each line is found in about two dozen measurements, not one for each character.
    expect(measured).toBeLessThan(NOTES_MAX_TEXT_LENGTH * 32);
  });

  it("loses no character, and fits every line that could fit", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "bb", "cccccc", "ddddddddddddd", " ", "\n"), {
          maxLength: 40,
        }),
        fc.integer({ min: 1, max: 12 }),
        (parts, columns) => {
          const text = parts.join("");
          const { lines } = layoutText(box(text, columns * 500));
          for (const line of lines) {
            expect(line.width).toBe([...line.text].length * 500);
            // Only a line of one character may be wider than the box.
            if ([...line.text].length > 1) expect(line.width).toBeLessThanOrEqual(columns * 500);
          }
          // Line breaks, and spaces at the ends of lines, are all that's dropped.
          expect(
            lines
              .map((line) => line.text)
              .join("")
              .replaceAll(" ", ""),
          ).toBe(text.replaceAll(/[ \n]/g, ""));
        },
      ),
    );
  });
});
