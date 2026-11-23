import { type NotesRect, unionRects } from "../model/geometry.js";
import { boxOf, type NotesItem, type NotesStroke, type NotesText } from "../model/items.js";

/**
 * The laid-out height of a text box, in units. Laying text out needs a font,
 * so whoever has one supplies this.
 */
export type TextHeight = (item: NotesText) => number;

/**
 * The bounds already worked out, by stroke. A stroke is never changed once
 * made, so its bounds can't go stale, and hit tests and the eraser ask for
 * the same strokes' bounds on every movement of the pointer.
 */
const known = /* @__PURE__ */ new WeakMap<NotesStroke, NotesRect>();

/**
 * The rectangle a stroke is drawn in: the box around its points, grown by
 * half its size, on whole units. Its ink is never outside it.
 */
export function strokeBounds(stroke: NotesStroke): NotesRect {
  const cached = known.get(stroke);
  if (cached) return cached;
  const points = stroke.points;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 2 < points.length; index += 3) {
    const x = points[index] as number;
    const y = points[index + 1] as number;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  let bounds: NotesRect;
  if (left > right) {
    // No points. A stored stroke always has one, so this is only a safe answer.
    bounds = { x: 0, y: 0, width: 0, height: 0 };
  } else {
    const half = stroke.size / 2;
    const x = Math.floor(left - half);
    const y = Math.floor(top - half);
    bounds = {
      x,
      y,
      width: Math.ceil(right + half) - x,
      height: Math.ceil(bottom + half) - y,
    };
  }
  known.set(stroke, bounds);
  return bounds;
}

/** The rectangle an item is drawn in. */
export function itemBounds(item: NotesItem, textHeight: TextHeight): NotesRect {
  switch (item.type) {
    case "stroke":
      return strokeBounds(item);
    case "text":
      return { x: item.x, y: item.y, width: item.width, height: textHeight(item) };
    default:
      return boxOf(item);
  }
}

/** The smallest rectangle holding every item given, or `undefined` for none. */
export function boundsOf(
  items: Iterable<NotesItem>,
  textHeight: TextHeight,
): NotesRect | undefined {
  const rects: NotesRect[] = [];
  for (const item of items) rects.push(itemBounds(item, textHeight));
  return unionRects(rects);
}
