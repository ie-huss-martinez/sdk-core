import { describe, expect, it } from "vitest";

// The family's stacks, as ui has them.
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const TEXT = "Export settings 0123 mmmm iiii";

/**
 * The width of a line of text, as the browser lays it out.
 *
 * @param {string} family
 * @param {number} weight
 * @returns {number}
 */
function width(family, weight) {
  const line = document.createElement("span");
  line.textContent = TEXT;
  line.style.font = `${weight} 14px ${family}`;
  line.style.whiteSpace = "nowrap";
  document.body.append(line);
  const measured = line.getBoundingClientRect().width;
  line.remove();
  return measured;
}

/**
 * Whether a line is drawn with different pixels at two weights.
 *
 * @param {string} family
 * @param {number} lighter
 * @param {number} heavier
 * @returns {boolean}
 */
function drawnDifferently(family, lighter, heavier) {
  const draw = (/** @type {number} */ weight) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 32;
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    context.font = `${weight} 14px ${family}`;
    context.fillText(TEXT, 4, 22);
    return context.getImageData(0, 0, canvas.width, canvas.height).data.join(",");
  };
  return draw(lighter) !== draw(heavier);
}

// These hold in the browser test image, where browser tests run (ADR 0049):
// browserInstances launches every browser there with the family's font
// rules (ADR 0062). The image's own default is a font with one style, wider
// at weight 400 than Liberation Sans and, in Chromium, identical at 600.
describe("the fonts browser tests render with", () => {
  it("draws the family's sans stack in Liberation Sans", () => {
    expect(width(SANS, 400)).toBeCloseTo(width('"Liberation Sans"', 400), 1);
    expect(width("sans-serif", 400)).toBeCloseTo(width('"Liberation Sans"', 400), 1);
    expect(width("system-ui", 400)).toBeCloseTo(width('"Liberation Sans"', 400), 1);
  });

  it("draws strong text in a real bold face, wider than regular text", () => {
    expect(width(SANS, 600)).toBeCloseTo(width('"Liberation Sans"', 700), 1);
    expect(width(SANS, 600)).toBeGreaterThan(width(SANS, 400) + 5);
    expect(drawnDifferently(SANS, 400, 600)).toBe(true);
  });

  it("draws the monospace stack and the generic families in Liberation too", () => {
    expect(width(MONO, 400)).toBeCloseTo(width('"Liberation Mono"', 400), 1);
    expect(width("monospace", 400)).toBeCloseTo(width('"Liberation Mono"', 400), 1);
    expect(width("serif", 400)).toBeCloseTo(width('"Liberation Serif"', 400), 1);
  });
});
