import type { NotesTemplate } from "./notebook.js";

/**
 * What a paper template draws, in units: straight rules and dots, in one
 * colour. The same marks are drawn on screen and written to an exported PDF,
 * so both show the same paper (docs/adr/0001).
 */
export interface TemplateMarks {
  /** Rules, as `x1, y1, x2, y2` quadruples. */
  readonly lines: readonly number[];
  /** Dots, as `x, y` pairs. */
  readonly dots: readonly number[];
  /** The rules' width and the dots' diameter. */
  readonly lineWidth: number;
  readonly dotSize: number;
  readonly color: `#${string}`;
}

/** The paper's colour: every page is white, in light and dark themes alike. */
export const NOTES_PAPER_COLOR = "#ffffff";

/** The colour of the rules and dots: a quiet blue-grey. */
const RULE_COLOR = "#c3cbd6";

/** The gap between the rules of lined paper: 24 points, about 8.5 mm. */
const LINE_GAP = 2_400;
/** The space above the first rule of lined paper. */
const LINE_TOP = 7_200;
/** The side of a square of grid paper, and the gap between dots: 15 points, about 5.3 mm. */
const GRID_GAP = 1_500;

/**
 * The marks of a paper template on a page of a given size. Deterministic:
 * the same page always has the same marks.
 */
export function templateMarks(
  template: NotesTemplate,
  width: number,
  height: number,
): TemplateMarks {
  const lines: number[] = [];
  const dots: number[] = [];
  if (template === "lined") {
    for (let y = LINE_TOP; y < height - LINE_GAP / 2; y += LINE_GAP) lines.push(0, y, width, y);
  } else if (template === "grid") {
    // Centred, so the margins on both sides are equal.
    const left = ((width % GRID_GAP) + GRID_GAP) / 2;
    const top = ((height % GRID_GAP) + GRID_GAP) / 2;
    for (let x = left; x < width; x += GRID_GAP) lines.push(x, 0, x, height);
    for (let y = top; y < height; y += GRID_GAP) lines.push(0, y, width, y);
  } else if (template === "dotted") {
    const left = ((width % GRID_GAP) + GRID_GAP) / 2;
    const top = ((height % GRID_GAP) + GRID_GAP) / 2;
    for (let y = top; y < height; y += GRID_GAP) {
      for (let x = left; x < width; x += GRID_GAP) dots.push(x, y);
    }
  }
  return { lines, dots, lineWidth: 50, dotSize: 150, color: RULE_COLOR };
}

/** Every template, in the order the interface offers them. */
export const NOTES_TEMPLATES: readonly NotesTemplate[] = ["blank", "lined", "grid", "dotted"];
