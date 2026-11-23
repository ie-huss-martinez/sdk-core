import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeWinAnsi, helveticaWidth, replaceUnencodable } from "./helvetica.js";

/** Codes of Windows-1252 that have no character, and DEL, which is a control character. */
const UNUSED_CODES = new Set([0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/** Every character Helvetica writes here, by its WinAnsi code, from the platform's own decoder. */
const characters = new Map<number, string>();
for (let code = 32; code <= 255; code += 1) {
  if (!UNUSED_CODES.has(code)) {
    characters.set(code, new TextDecoder("windows-1252").decode(Uint8Array.of(code)));
  }
}

describe("encodeWinAnsi", () => {
  it("encodes ASCII as itself", () => {
    expect(encodeWinAnsi("Hello, world!")).toEqual(new TextEncoder().encode("Hello, world!"));
    expect(encodeWinAnsi("")).toEqual(new Uint8Array(0));
  });

  it("encodes Latin-1 letters at their code points", () => {
    expect(encodeWinAnsi("caf\u00e9 \u00ff\u00a0")).toEqual(
      Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x20, 0xff, 0xa0),
    );
  });

  it("encodes the characters Windows-1252 keeps between 128 and 159", () => {
    // Euro, curly quotes, an en dash, an em dash, an ellipsis, a trademark sign.
    expect(encodeWinAnsi("\u20ac\u201c\u201d\u2018\u2019\u2013\u2014\u2026\u2122")).toEqual(
      Uint8Array.of(0x80, 0x93, 0x94, 0x91, 0x92, 0x96, 0x97, 0x85, 0x99),
    );
  });

  it("agrees with the platform's Windows-1252 decoder on every code", () => {
    for (const [code, character] of characters) {
      expect(encodeWinAnsi(character), `code ${code}`).toEqual(Uint8Array.of(code));
    }
    expect(characters.size).toBe(218);
  });

  it("can't encode control characters, a tab among them", () => {
    for (const text of ["\t", "\n", "\r", "\u0000", "\u001f", "\u007f", "\u0081", "\u009d"]) {
      expect(encodeWinAnsi(text), JSON.stringify(text)).toBeUndefined();
      expect(encodeWinAnsi(`a${text}b`), JSON.stringify(text)).toBeUndefined();
    }
  });

  it("can't encode anything outside Windows-1252", () => {
    for (const text of ["\u0100", "\u03b1", "\u4e2d", "\u{1f600}", "\ufeff"]) {
      expect(encodeWinAnsi(text), JSON.stringify(text)).toBeUndefined();
    }
  });

  it("encodes a text exactly when every one of its characters has a code", () => {
    const encodable = new Set(characters.values());
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        const bytes = encodeWinAnsi(text);
        const all = [...text].every((character) => encodable.has(character));
        expect(bytes !== undefined).toBe(all);
        if (bytes) {
          expect(new TextDecoder("windows-1252").decode(bytes)).toBe(text);
        }
      }),
    );
  });
});

describe("replaceUnencodable", () => {
  it("puts a question mark for each character Helvetica can't write", () => {
    expect(replaceUnencodable("a\tb\u4e2dc")).toBe("a?b?c");
    // One character outside the basic plane is one question mark.
    expect(replaceUnencodable("\u{1f600}!")).toBe("?!");
    expect(replaceUnencodable("caf\u00e9 \u20ac")).toBe("caf\u00e9 \u20ac");
  });

  it("always gives a text that encodes", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(encodeWinAnsi(replaceUnencodable(text))).toBeDefined();
      }),
    );
  });
});

describe("helveticaWidth", () => {
  it("adds up the font's advance widths", () => {
    // H 722, e 556, l 222, l 222, o 556.
    expect(helveticaWidth("Hello", 1000)).toBe(2278);
    expect(helveticaWidth("", 1000)).toBe(0);
  });

  it("knows the published width of each character", () => {
    const widths: Record<string, number> = {
      " ": 278,
      "!": 278,
      "'": 191,
      "0": 556,
      "@": 1015,
      A: 667,
      I: 278,
      M: 833,
      W: 944,
      f: 278,
      i: 222,
      m: 833,
      w: 722,
      "~": 584,
      "\u20ac": 556,
      "\u2026": 1000,
      "\u2014": 1000,
      "\u2022": 350,
      "\u0152": 1000,
      "\u00a0": 278,
      "\u00a9": 737,
      "\u00bd": 834,
      "\u00c6": 1000,
      "\u00e9": 556,
      "\u00df": 611,
      "\u00ff": 500,
    };
    for (const [character, width] of Object.entries(widths)) {
      expect(helveticaWidth(character, 1000), JSON.stringify(character)).toBe(width);
    }
  });

  it("has a width for every character it encodes", () => {
    for (const [code, character] of characters) {
      const width = helveticaWidth(character, 1000);
      expect(width, `code ${code}`).toBeGreaterThanOrEqual(191);
      expect(width, `code ${code}`).toBeLessThanOrEqual(1015);
    }
  });

  it("scales with the font size, in its unit", () => {
    expect(helveticaWidth("Hello", 12)).toBeCloseTo(27.336, 10);
    expect(helveticaWidth("Hello", 1200)).toBeCloseTo(2733.6, 8);
  });

  it("counts a character it can't write as 0.6 of the size", () => {
    expect(helveticaWidth("\u4e2d", 1000)).toBe(600);
    expect(helveticaWidth("a\u{1f600}\t", 1000)).toBe(556 + 600 + 600);
  });
});
