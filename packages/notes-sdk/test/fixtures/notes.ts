import type { NotesStroke, NotesText } from "../../src/core/model/items.js";
import type { NotesNotebook } from "../../src/core/model/notebook.js";

/** Identifiers that count up, so a test's documents are the same on every run. */
export function countingIds(prefix = "id"): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

/** A clock that moves a second each time it's read. */
export function tickingClock(start = 1_800_000_000_000): () => number {
  let now = start;
  return () => {
    now += 1_000;
    return now;
  };
}

/** A short pen stroke from one point to another. */
export function stroke(id: string, from = [1_000, 1_000], to = [9_000, 5_000]): NotesStroke {
  return {
    id,
    type: "stroke",
    tool: "pen",
    color: "#1f2937",
    size: 220,
    points: [from[0] ?? 0, from[1] ?? 0, 400, to[0] ?? 0, to[1] ?? 0, 600],
  };
}

/** A text box. */
export function text(id: string, value: string): NotesText {
  return {
    id,
    type: "text",
    x: 5_000,
    y: 5_000,
    width: 20_000,
    text: value,
    size: 1_400,
    color: "#1f2937",
  };
}

/** A notebook of plain lined A4 pages. */
export function notebook(id: string, pages: readonly string[], title = "Physics"): NotesNotebook {
  return {
    id,
    title,
    cover: "blue",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    pages: pages.map((page) => ({ id: page, width: 59_500, height: 84_200, template: "lined" })),
    outline: [],
    recordings: [],
  };
}
