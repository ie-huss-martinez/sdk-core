import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { NotesTemplate } from "./notebook.js";
import { NOTES_PAGE_SIZES } from "./notebook.js";
import { NOTES_MAX_PAGE_SIDE, NOTES_MIN_PAGE_SIDE } from "./portable.js";
import { NOTES_PAPER_COLOR, NOTES_TEMPLATES, templateMarks } from "./templates.js";

const A4 = NOTES_PAGE_SIZES.a4;
const template: fc.Arbitrary<NotesTemplate> = fc.constantFrom(...NOTES_TEMPLATES);
/** Sides up to a metre, so a dotted page stays small enough to check dot by dot. */
const side = fc.integer({ min: NOTES_MIN_PAGE_SIDE, max: 280_000 });

/** A list cut into rows of `size` numbers. */
const rows = (values: readonly number[], size: number): number[][] =>
  Array.from({ length: values.length / size }, (_, index) =>
    values.slice(index * size, index * size + size),
  );

describe("NOTES_TEMPLATES", () => {
  it("lists every template once, blank first", () => {
    expect(NOTES_TEMPLATES).toStrictEqual(["blank", "lined", "grid", "dotted"]);
  });
});

describe("templateMarks", () => {
  it("draws nothing on blank paper", () => {
    const marks = templateMarks("blank", A4.width, A4.height);
    expect(marks.lines).toStrictEqual([]);
    expect(marks.dots).toStrictEqual([]);
  });

  it("rules lined paper every 24 points from an inch down, from edge to edge", () => {
    const marks = templateMarks("lined", A4.width, A4.height);
    const lines = rows(marks.lines, 4);
    expect(marks.dots).toStrictEqual([]);
    expect(lines[0]).toStrictEqual([0, 7_200, A4.width, 7_200]);
    expect(lines[1]).toStrictEqual([0, 9_600, A4.width, 9_600]);
    // (84,200 - 1,200 - 7,200) / 2,400 rules fit, rounded up.
    expect(lines).toHaveLength(32);
    expect(lines.at(-1)).toStrictEqual([0, 81_600, A4.width, 81_600]);
  });

  it("rules grid paper in squares of 15 points, with equal margins", () => {
    const marks = templateMarks("grid", A4.width, A4.height);
    const lines = rows(marks.lines, 4);
    const vertical = lines.filter(([x1, , x2]) => x1 === x2);
    const horizontal = lines.filter(([, y1, , y2]) => y1 === y2);
    expect(marks.dots).toStrictEqual([]);
    // 59,500 leaves 1,000 over 39 squares: a margin of 1,250 on each side.
    expect(vertical[0]).toStrictEqual([1_250, 0, 1_250, A4.height]);
    expect(vertical.at(-1)).toStrictEqual([58_250, 0, 58_250, A4.height]);
    expect(vertical).toHaveLength(39);
    // 84,200 leaves 200 over 56 squares: a margin of 850 at the top and the bottom.
    expect(horizontal[0]).toStrictEqual([0, 850, A4.width, 850]);
    expect(horizontal.at(-1)).toStrictEqual([0, 83_350, A4.width, 83_350]);
    expect(horizontal).toHaveLength(56);
  });

  it("puts the dots of dotted paper where the grid's lines cross", () => {
    const dots = rows(templateMarks("dotted", A4.width, A4.height).dots, 2);
    const grid = rows(templateMarks("grid", A4.width, A4.height).lines, 4);
    const columns = grid.filter(([x1, , x2]) => x1 === x2).map(([x]) => x);
    const lines = grid.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y);
    expect(templateMarks("dotted", A4.width, A4.height).lines).toStrictEqual([]);
    expect(dots).toHaveLength(columns.length * lines.length);
    expect(dots[0]).toStrictEqual([columns[0], lines[0]]);
    expect(dots.at(-1)).toStrictEqual([columns.at(-1), lines.at(-1)]);
  });

  it("draws in one quiet colour, on white paper, with thin rules", () => {
    for (const name of NOTES_TEMPLATES) {
      const marks = templateMarks(name, A4.width, A4.height);
      expect(marks.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(marks.color).not.toBe(NOTES_PAPER_COLOR);
      expect(marks.lineWidth).toBe(50);
      expect(marks.dotSize).toBe(150);
    }
    expect(NOTES_PAPER_COLOR).toBe("#ffffff");
  });

  it("gives the same marks for the same page, every time", () => {
    fc.assert(
      fc.property(template, side, side, (name, width, height) => {
        expect(templateMarks(name, width, height)).toStrictEqual(
          templateMarks(name, width, height),
        );
      }),
      { numRuns: 30 },
    );
  });

  it("keeps every mark within the page", () => {
    fc.assert(
      fc.property(template, side, side, (name, width, height) => {
        const marks = templateMarks(name, width, height);
        expect(marks.lines.length % 4).toBe(0);
        expect(marks.dots.length % 2).toBe(0);
        marks.lines.forEach((value, index) => {
          const most = index % 2 === 0 ? width : height;
          if (value < 0 || value > most) throw new Error(`A rule leaves the page at ${value}.`);
        });
        marks.dots.forEach((value, index) => {
          const most = index % 2 === 0 ? width : height;
          if (value < 0 || value > most) throw new Error(`A dot leaves the page at ${value}.`);
        });
      }),
      { numRuns: 30 },
    );
  });

  it("draws straight rules, the full width or the full height of the page", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<NotesTemplate>("lined", "grid"),
        side,
        side,
        (name, width, height) => {
          for (const [x1, y1, x2, y2] of rows(templateMarks(name, width, height).lines, 4)) {
            const across = y1 === y2 && x1 === 0 && x2 === width;
            const down = x1 === x2 && y1 === 0 && y2 === height;
            expect(across || down).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("leaves equal margins on both sides of a grid, whatever the page's size", () => {
    fc.assert(
      fc.property(side, side, (width, height) => {
        const lines = rows(templateMarks("grid", width, height).lines, 4);
        const columns = lines.filter(([x1, , x2]) => x1 === x2).map(([x]) => x ?? 0);
        const across = lines.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y ?? 0);
        expect((columns[0] ?? 0) + (columns.at(-1) ?? 0)).toBe(width);
        expect((across[0] ?? 0) + (across.at(-1) ?? 0)).toBe(height);
        // Never a rule on the page's edge, and never more than a square of margin.
        expect(columns[0]).toBeGreaterThan(0);
        expect(columns[0]).toBeLessThanOrEqual(1_500);
      }),
      { numRuns: 30 },
    );
  });

  it("stays small on the largest page a document may hold", () => {
    const lined = templateMarks("lined", NOTES_MAX_PAGE_SIDE, NOTES_MAX_PAGE_SIDE);
    expect(lined.lines.length / 4).toBe(597);
    const grid = templateMarks("grid", NOTES_MAX_PAGE_SIDE, NOTES_MAX_PAGE_SIDE);
    expect(grid.lines.length / 4).toBe(2 * 960);
  });
});
