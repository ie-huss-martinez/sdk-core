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
  const lines: NotesTextLine[] = [];
  for (const paragraph of item.text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<= )/)) {
      if (width((line + word).trimEnd()) <= item.width || line === "") {
        line += word;
      } else {
        lines.push({ text: line.trimEnd(), width: width(line.trimEnd()) });
        line = word;
      }
      // A word wider than the box breaks where it must.
      while (width(line.trimEnd()) > item.width && [...line].length > 1) {
        const characters = [...line];
        let fits = 1;
        while (
          fits < characters.length &&
          width(characters.slice(0, fits + 1).join("")) <= item.width
        ) {
          fits += 1;
        }
        const head = characters.slice(0, fits).join("");
        lines.push({ text: head, width: width(head) });
        line = characters.slice(fits).join("");
      }
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
