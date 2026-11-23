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
