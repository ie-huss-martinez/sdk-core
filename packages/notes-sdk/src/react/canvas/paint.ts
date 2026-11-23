import {
  outlineOfPoints,
  outlineToPathData,
  type StrokeStyle,
  strokeOutline,
} from "../../core/ink/outline.js";
import type { NotesColor, NotesItem, NotesStroke } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_PAPER_COLOR, templateMarks } from "../../core/model/templates.js";
import type { ImageCache } from "./image-cache.js";
import { layoutText, NOTES_TEXT_FONT } from "./text-layout.js";

type Context = CanvasRenderingContext2D;

/** How see-through highlighter ink is. The exported PDF uses the same value. */
export const HIGHLIGHTER_OPACITY = 0.4;
/** How faint ink is while a recording plays and hasn't reached it yet. */
const DIMMED_OPACITY = 0.25;
/** The colour of a link's outline and of a picture's placeholder. */
const LINK_COLOR = "#2563eb";
const PLACEHOLDER_COLOR = "#e5e7eb";

/**
 * The most dots drawn one by one. A page with more has them painted as a
 * repeated tile: the largest page the model allows has 921,600, and a circle
 * for each, on every repaint, would stall the pen. The pages of ordinary
 * paper sizes have a few thousand, and keep their circles.
 */
const MAX_DOT_CIRCLES = 20_000;

/** The dots of dotted paper, as the grid of even squares they are. */
interface DotGrid {
  /** The first dot's place, in units. */
  readonly left: number;
  readonly top: number;
  /** The distance from one dot to the next, across and down. */
  readonly gap: number;
  readonly columns: number;
  readonly rows: number;
}

/**
 * The grid a template's dots make, from their list, which is row by row
 * from the top. `undefined` when they aren't a grid of even squares, which
 * a repeated tile can't paint.
 */
function dotGridOf(dots: readonly number[]): DotGrid | undefined {
  const [left, top, next] = dots;
  if (left === undefined || top === undefined || next === undefined) return undefined;
  const gap = next - left;
  let columns = 0;
  while (dots[columns * 2 + 1] === top) columns += 1;
  const rows = dots.length / (2 * columns);
  const even =
    gap > 0 &&
    Number.isInteger(rows) &&
    dots[columns * 2 - 2] === left + (columns - 1) * gap &&
    (rows === 1 || dots[columns * 2 + 1] === top + gap) &&
    dots.at(-1) === top + (rows - 1) * gap;
  return even ? { left, top, gap, columns, rows } : undefined;
}

/**
 * Paints a grid of dots as one tile, repeated: the work follows the canvas's
 * pixels, not the number of dots. Returns false, having painted nothing,
 * where the browser can't make the tile.
 */
function paintDotTiles(context: Context, grid: DotGrid, dotSize: number, color: string): boolean {
  const { a, b } = context.getTransform();
  // One square of the grid, in whole canvas pixels: a little larger than it
  // is on the canvas, and scaled back when it's painted.
  // (Less a millionth, so a square of exactly 20 pixels isn't taken for 21.)
  const side = Math.max(1, Math.ceil(grid.gap * Math.hypot(a, b) - 1e-6));
  const tile = document.createElement("canvas");
  tile.width = side;
  tile.height = side;
  const dot = tile.getContext("2d");
  if (!dot) return false;
  const pixelsPerUnit = side / grid.gap;
  dot.fillStyle = color;
  dot.beginPath();
  dot.arc(side / 2, side / 2, (dotSize / 2) * pixelsPerUnit, 0, Math.PI * 2);
  dot.fill();
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return false;
  context.save();
  // The pattern starts at the origin: half a square before the first dot, in tile pixels.
  context.translate(grid.left - grid.gap / 2, grid.top - grid.gap / 2);
  context.scale(1 / pixelsPerUnit, 1 / pixelsPerUnit);
  context.fillStyle = pattern;
  context.fillRect(0, 0, grid.columns * side, grid.rows * side);
  context.restore();
  return true;
}

/** Each stroke's path, built once: strokes never change. */
const paths = new WeakMap<NotesStroke, Path2D>();

function pathOf(stroke: NotesStroke): Path2D {
  let path = paths.get(stroke);
  if (!path) {
    path = new Path2D(outlineToPathData(strokeOutline(stroke)));
    paths.set(stroke, path);
  }
  return path;
}

/** What painting items needs beyond the items. */
export interface PaintOptions {
  readonly images: ImageCache;
  /** Items left out, such as those being moved, which are drawn elsewhere. */
  readonly skip?: ReadonlySet<string> | undefined;
  /** Whether an item is drawn faint. */
  readonly dim?: ((item: NotesItem) => boolean) | undefined;
}

/** Sets the canvas up to draw in page units, and clears it. */
export function beginPage(context: Context, info: NotesPageInfo): void {
  const scale = context.canvas.width / info.width;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(scale, 0, 0, scale, 0, 0);
}

/** Paints the paper and its rules. A page over a PDF has no paper of its own. */
export function paintPaper(context: Context, info: NotesPageInfo): void {
  if (info.background) return;
  context.fillStyle = NOTES_PAPER_COLOR;
  context.fillRect(0, 0, info.width, info.height);
  const marks = templateMarks(info.template, info.width, info.height);
  if (marks.lines.length > 0) {
    context.strokeStyle = marks.color;
    context.lineWidth = marks.lineWidth;
    context.beginPath();
    for (let index = 0; index < marks.lines.length; index += 4) {
      context.moveTo(marks.lines[index] ?? 0, marks.lines[index + 1] ?? 0);
      context.lineTo(marks.lines[index + 2] ?? 0, marks.lines[index + 3] ?? 0);
    }
    context.stroke();
  }
  if (marks.dots.length > 0) {
    const grid = marks.dots.length > MAX_DOT_CIRCLES * 2 ? dotGridOf(marks.dots) : undefined;
    if (grid && paintDotTiles(context, grid, marks.dotSize, marks.color)) return;
    context.fillStyle = marks.color;
    context.beginPath();
    for (let index = 0; index < marks.dots.length; index += 2) {
      const x = marks.dots[index] ?? 0;
      const y = marks.dots[index + 1] ?? 0;
      context.moveTo(x + marks.dotSize / 2, y);
      context.arc(x, y, marks.dotSize / 2, 0, Math.PI * 2);
    }
    context.fill();
  }
}

function paintOne(context: Context, item: NotesItem, options: PaintOptions): void {
  const faint = options.dim?.(item) ? DIMMED_OPACITY : 1;
  switch (item.type) {
    case "stroke": {
      const highlighter = item.tool === "highlighter";
      context.globalAlpha = (highlighter ? HIGHLIGHTER_OPACITY : 1) * faint;
      context.globalCompositeOperation = highlighter ? "multiply" : "source-over";
      context.fillStyle = item.color;
      context.fill(pathOf(item));
      context.globalCompositeOperation = "source-over";
      break;
    }
    case "text": {
      const layout = layoutText(item);
      context.globalAlpha = faint;
      context.fillStyle = item.color;
      context.font = `${item.size}px ${NOTES_TEXT_FONT}`;
      context.textBaseline = "alphabetic";
      layout.lines.forEach((line, index) => {
        context.fillText(line.text, item.x, item.y + layout.ascent + index * layout.lineHeight);
      });
      break;
    }
    case "image": {
      const bitmap = options.images.get(item.image);
      context.globalAlpha = faint;
      if (bitmap) {
        context.drawImage(bitmap, item.x, item.y, item.width, item.height);
      } else {
        context.fillStyle = PLACEHOLDER_COLOR;
        context.fillRect(item.x, item.y, item.width, item.height);
      }
      break;
    }
    case "link": {
      context.globalAlpha = 0.6;
      context.strokeStyle = LINK_COLOR;
      context.lineWidth = 100;
      context.setLineDash([400, 300]);
      context.strokeRect(item.x, item.y, item.width, item.height);
      context.setLineDash([]);
      break;
    }
  }
  context.globalAlpha = 1;
}

/**
 * Paints a page's items: highlighter ink first, so it sits under everything
 * written over it, then the rest from the bottom up. The exported PDF draws
 * in the same order.
 */
export function paintItems(
  context: Context,
  items: readonly NotesItem[],
  options: PaintOptions,
): void {
  const shown = options.skip ? items.filter((item) => !options.skip?.has(item.id)) : items;
  for (const item of shown) {
    if (item.type === "stroke" && item.tool === "highlighter") paintOne(context, item, options);
  }
  for (const item of shown) {
    if (!(item.type === "stroke" && item.tool === "highlighter")) paintOne(context, item, options);
  }
}

/** What painting a whole page needs beyond its items. */
export interface PagePaintOptions extends PaintOptions {
  /**
   * The PDF page the page is written on, already drawn: it's painted as the
   * page's paper, so highlighter ink is multiplied over it as the exported
   * PDF multiplies it, and black text under a highlight stays black.
   */
  readonly backdrop?: CanvasImageSource | undefined;
}

/**
 * Paints a page from nothing: its paper, or the PDF page it's written on,
 * then its items. The canvas is cleared first, and left drawing in page
 * units.
 */
export function paintPage(
  context: Context,
  info: NotesPageInfo,
  items: readonly NotesItem[],
  options: PagePaintOptions,
): void {
  beginPage(context, info);
  if (options.backdrop) context.drawImage(options.backdrop, 0, 0, info.width, info.height);
  else paintPaper(context, info);
  paintItems(context, items, options);
}

/** Paints a stroke that's still being drawn, from its points so far. */
export function paintLiveStroke(
  context: Context,
  points: ArrayLike<number>,
  style: StrokeStyle,
  color: NotesColor,
): void {
  const outline = outlineOfPoints(points, style, false);
  if (outline.length === 0) return;
  context.globalAlpha = style.tool === "highlighter" ? HIGHLIGHTER_OPACITY : 1;
  context.fillStyle = color;
  context.fill(new Path2D(outlineToPathData(outline)));
  context.globalAlpha = 1;
}
