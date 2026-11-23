import { inflateRect, type NotesRect, rectContains, rectsIntersect } from "../model/geometry.js";
import type { NotesItem, NotesStroke } from "../model/items.js";
import { itemBounds, type TextHeight } from "./bounds.js";

/** The share of a stroke's points a lasso must hold to select it. */
const LASSO_SHARE = 0.6;

/**
 * Whether a point is inside a polygon, given as flat `x, y` pairs, by the
 * even-odd rule: a region the polygon goes around twice is outside.
 */
export function pointInPolygon(polygon: readonly number[], x: number, y: number): boolean {
  const count = Math.floor(polygon.length / 2);
  let inside = false;
  let fromX = polygon[count * 2 - 2] as number;
  let fromY = polygon[count * 2 - 1] as number;
  for (let index = 0; index < count; index += 1) {
    const toX = polygon[index * 2] as number;
    const toY = polygon[index * 2 + 1] as number;
    // A ray to the right of the point crosses this side.
    if (toY > y !== fromY > y && x < ((fromX - toX) * (y - toY)) / (fromY - toY) + toX) {
      inside = !inside;
    }
    fromX = toX;
    fromY = toY;
  }
  return inside;
}

/** The square of the distance from a point to the segment from `a` to `b`. */
export function squaredDistanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  // How far along the segment the nearest point is, from 0 at `a` to 1 at `b`.
  let along = lengthSquared === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lengthSquared;
  if (along < 0) along = 0;
  else if (along > 1) along = 1;
  const nearX = ax + along * dx - x;
  const nearY = ay + along * dy - y;
  return nearX * nearX + nearY * nearY;
}

/**
 * The square of the distance from a point to a path of points, `stride`
 * numbers each, starting with `x, y`. A path of one point is that point; an
 * empty one is infinitely far.
 */
export function squaredDistanceToPath(
  path: ArrayLike<number>,
  stride: number,
  x: number,
  y: number,
): number {
  const count = Math.floor(path.length / stride);
  if (count === 0) return Number.POSITIVE_INFINITY;
  let fromX = path[0] as number;
  let fromY = path[1] as number;
  let nearest = (fromX - x) * (fromX - x) + (fromY - y) * (fromY - y);
  for (let index = 1; index < count; index += 1) {
    const toX = path[index * stride] as number;
    const toY = path[index * stride + 1] as number;
    const distance = squaredDistanceToSegment(x, y, fromX, fromY, toX, toY);
    if (distance < nearest) nearest = distance;
    fromX = toX;
    fromY = toY;
  }
  return nearest;
}

/**
 * The distance, in units, from a point to a stroke's centre line: the path
 * through its points. A stroke of one point is that point.
 */
export function distanceToStroke(stroke: NotesStroke, x: number, y: number): number {
  return Math.sqrt(squaredDistanceToPath(stroke.points, 3, x, y));
}

/**
 * The topmost item at a point, which is the last one in the array, or
 * `undefined`. A stroke is hit within half its size and `tolerance` of its
 * centre line; any other item, inside its rectangle grown by `tolerance`.
 */
export function hitTest(
  items: readonly NotesItem[],
  x: number,
  y: number,
  tolerance: number,
  textHeight: TextHeight,
): NotesItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index] as NotesItem;
    // The bounds first: they're remembered, and most items are nowhere near.
    if (!rectContains(inflateRect(itemBounds(item, textHeight), tolerance), x, y)) continue;
    if (item.type !== "stroke") return item;
    const reach = item.size / 2 + tolerance;
    if (squaredDistanceToPath(item.points, 3, x, y) <= reach * reach) return item;
  }
  return undefined;
}

/**
 * The ids of the items a freehand lasso selects, in the page's order. The
 * lasso is a polygon of flat `x, y` pairs, closed from its last point to its
 * first. It selects a stroke when it holds at least 60% of the stroke's
 * points, and any other item when it holds the item's centre. A lasso of
 * fewer than 3 points selects nothing.
 */
export function itemsInLasso(
  items: readonly NotesItem[],
  polygon: readonly number[],
  textHeight: TextHeight,
): string[] {
  const corners = Math.floor(polygon.length / 2);
  if (corners < 3) return [];
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < corners; index += 1) {
    left = Math.min(left, polygon[index * 2] as number);
    right = Math.max(right, polygon[index * 2] as number);
    top = Math.min(top, polygon[index * 2 + 1] as number);
    bottom = Math.max(bottom, polygon[index * 2 + 1] as number);
  }
  const around: NotesRect = { x: left, y: top, width: right - left, height: bottom - top };

  const selected: string[] = [];
  for (const item of items) {
    const bounds = itemBounds(item, textHeight);
    if (!rectsIntersect(bounds, around)) continue;
    if (item.type === "stroke") {
      if (lassoHoldsStroke(polygon, item)) selected.push(item.id);
    } else if (pointInPolygon(polygon, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)) {
      selected.push(item.id);
    }
  }
  return selected;
}

/** Whether a lasso holds enough of a stroke's points, and at least one. */
function lassoHoldsStroke(polygon: readonly number[], stroke: NotesStroke): boolean {
  const points = stroke.points;
  const count = Math.floor(points.length / 3);
  const needed = Math.max(1, Math.ceil(count * LASSO_SHARE));
  let inside = 0;
  for (let index = 0; index < count; index += 1) {
    if (pointInPolygon(polygon, points[index * 3] as number, points[index * 3 + 1] as number)) {
      inside += 1;
      if (inside >= needed) return true;
    } else if (inside + (count - index - 1) < needed) {
      // Too many are outside already for the rest to make up for.
      return false;
    }
  }
  return false;
}

/** The ids of the items whose bounds touch a rectangle, in the page's order. */
export function itemsInRect(
  items: readonly NotesItem[],
  rect: NotesRect,
  textHeight: TextHeight,
): string[] {
  const selected: string[] = [];
  for (const item of items) {
    if (rectsIntersect(itemBounds(item, textHeight), rect)) selected.push(item.id);
  }
  return selected;
}
