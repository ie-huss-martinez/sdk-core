import type { NotesText } from "../../core/model/items.js";
import type { NotesTextLayout, NotesTextLine } from "../../core/pdf/export.js";

/**
 * The font text boxes are drawn in: the device's own interface font, so
 * nothing is fetched (sdk-core ADR 0012).
 */
export const NOTES_TEXT_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A line's height and the baseline's distance from its top, as fractions of the font size. */
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_ASCENT = 0.93;

/** The font size text is measured at, in pixels. Widths scale linearly from it. */
const REFERENCE = 100;

let measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

function context() {
  if (measurer === undefined) {
    measurer =
      typeof OffscreenCanvas === "undefined"
        ? document.createElement("canvas").getContext("2d")
        : new OffscreenCanvas(1, 1).getContext("2d");
    if (measurer) measurer.font = `${REFERENCE}px ${NOTES_TEXT_FONT}`;
  }
  return measurer;
}

const layouts = new WeakMap<NotesText, NotesTextLayout>();

/**
 * How many of a word's characters, from `start`, fit a line: at least one,
 * so a box narrower than a character still takes its text. `fits` tells
 * whether a run of characters does.
 *
 * The count doubles until a run no longer fits, then is narrowed between the
 * last two. A line of n characters takes about 2 log n measurements of runs
 * no longer than 2n, however long the rest of the word is.
 */
function countThatFit(
  characters: readonly string[],
  start: number,
  fits: (text: string) => boolean,
): number {
  const rest = characters.length - start;
  const run = (count: number) => fits(characters.slice(start, start + count).join(""));
  let known = 1;
  let over = 2;
  while (over <= rest && run(over)) {
    known = over;
    over *= 2;
  }
  // `known` fits, and `over` doesn't or is past the end.
  let beyond = Math.min(over, rest + 1);
  while (beyond - known > 1) {
    const middle = Math.floor((known + beyond) / 2);
    if (run(middle)) known = middle;
    else beyond = middle;
  }
  return known;
}

/**
 * How a text box's text breaks into lines, measured with the font it's
 * drawn in: at spaces where it can, inside a word that's wider than the box,
 * and at every line break typed. Widths are in page units. Items never
 * change, so each is laid out once.
 */
export function layoutText(item: NotesText): NotesTextLayout {
  const known = layouts.get(item);
  if (known) return known;
  const measure = context();
  const toUnits = item.size / REFERENCE;
  const width = (text: string) => (measure ? measure.measureText(text).width * toUnits : 0);
  const fits = (text: string) => width(text) <= item.width;
  const lines: NotesTextLine[] = [];
  for (const paragraph of item.text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<= )/)) {
      if (line !== "") {
        if (fits((line + word).trimEnd())) {
          line += word;
          continue;
        }
        lines.push({ text: line.trimEnd(), width: width(line.trimEnd()) });
      }
      line = word;
      const body = word.trimEnd();
      if (fits(body)) continue;
      // A word wider than the box breaks where it must. It's split into
      // characters once, and each line is measured on its own: the text a
      // box may hold is long enough that measuring what's left of the word
      // for every line would take seconds.
      const characters = [...body];
      let start = 0;
      for (;;) {
        const count = countThatFit(characters, start, fits);
        if (start + count >= characters.length) break;
        const head = characters.slice(start, start + count).join("");
        lines.push({ text: head, width: width(head) });
        start += count;
      }
      // What's left starts the next line, with the space that followed the word.
      line = characters.slice(start).join("") + word.slice(body.length);
    }
    lines.push({ text: line.trimEnd(), width: width(line.trimEnd()) });
  }
  const layout: NotesTextLayout = {
    lines,
    lineHeight: Math.round(item.size * TEXT_LINE_HEIGHT),
    ascent: Math.round(item.size * TEXT_ASCENT),
  };
  layouts.set(item, layout);
  return layout;
}

/** A text box's height once laid out, in page units. */
export function textHeight(item: NotesText): number {
  const layout = layoutText(item);
  return Math.max(1, layout.lines.length) * layout.lineHeight;
}
