/**
 * Helvetica, one of the fonts every PDF viewer has, so a file names it
 * without carrying it. To place text, the writer still has to know how wide
 * each character is: these are the font's published advance widths (its AFM
 * metrics), per 1000 units of font size, for the codes of `WinAnsiEncoding`
 * from 32 to 255, sixteen to a row.
 *
 * Codes 127, 129, 141, 143, 144 and 157 have no character. Their widths are
 * never read, because {@link encodeWinAnsi} never writes them.
 */
// biome-ignore format: a table, sixteen codes to a row.
const WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/** The first code {@link WIDTHS} covers. */
const FIRST_CODE = 32;

/**
 * The characters of Windows-1252 from 128 to 159, which aren't at their
 * Unicode code points: each code point, and its code.
 */
// biome-ignore format: a table, one pair per character.
const HIGH_CODES: ReadonlyMap<number, number> = new Map([
  [0x20ac, 128], [0x201a, 130], [0x0192, 131], [0x201e, 132], [0x2026, 133], [0x2020, 134],
  [0x2021, 135], [0x02c6, 136], [0x2030, 137], [0x0160, 138], [0x2039, 139], [0x0152, 140],
  [0x017d, 142], [0x2018, 145], [0x2019, 146], [0x201c, 147], [0x201d, 148], [0x2022, 149],
  [0x2013, 150], [0x2014, 151], [0x02dc, 152], [0x2122, 153], [0x0161, 154], [0x203a, 155],
  [0x0153, 156], [0x017e, 158], [0x0178, 159],
]);

/**
 * How wide a character Helvetica can't write counts, per 1000 units of font
 * size. An estimate: it only decides where text wraps when the host gives
 * no layout of its own.
 */
const UNENCODABLE_WIDTH = 600;

/**
 * The WinAnsi code of a character, or `undefined` if it has none: control
 * characters, a tab among them, and everything outside Windows-1252.
 */
function winAnsiCode(codePoint: number): number | undefined {
  if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) {
    return codePoint;
  }
  return HIGH_CODES.get(codePoint);
}

/**
 * The WinAnsi (Windows-1252) bytes of a text, which is how a PDF string
 * names characters of a font with `WinAnsiEncoding`.
 *
 * @returns The bytes, or `undefined` if any character can't be encoded. No
 * control character can, not even a tab.
 */
export function encodeWinAnsi(text: string): Uint8Array | undefined {
  const bytes = new Uint8Array(text.length);
  let length = 0;
  for (const character of text) {
    const code = winAnsiCode(character.codePointAt(0) ?? 0);
    if (code === undefined) return undefined;
    bytes[length] = code;
    length += 1;
  }
  return bytes.subarray(0, length);
}

/**
 * The text with every character Helvetica can't write replaced by `?`, so
 * {@link encodeWinAnsi} always encodes the result.
 */
export function replaceUnencodable(text: string): string {
  let replaced = "";
  for (const character of text) {
    replaced += winAnsiCode(character.codePointAt(0) ?? 0) === undefined ? "?" : character;
  }
  return replaced;
}

/**
 * The width of a text in Helvetica at a font size, in the unit of `size`.
 * A character Helvetica can't write counts as 0.6 of the size.
 */
export function helveticaWidth(text: string, size: number): number {
  let width = 0;
  for (const character of text) {
    const code = winAnsiCode(character.codePointAt(0) ?? 0);
    width += code === undefined ? UNENCODABLE_WIDTH : (WIDTHS[code - FIRST_CODE] ?? 0);
  }
  return (width * size) / 1000;
}
