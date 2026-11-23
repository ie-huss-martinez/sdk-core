import { NOTES_UNITS_PER_POINT } from "./portable.js";

/**
 * A position on a page, in units from the page's top-left corner, with `y`
 * growing downwards.
 *
 * @public
 */
export interface NotesPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A rectangle on a page, in units.
 *
 * @public
 */
export interface NotesRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A page's size, in units.
 *
 * @public
 */
export interface NotesSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Converts PDF points to page units, rounded to the grid.
 *
 * @public
 */
export function pointsToUnits(points: number): number {
  return Math.round(points * NOTES_UNITS_PER_POINT);
}

/**
 * Converts page units to PDF points.
 *
 * @public
 */
export function unitsToPoints(units: number): number {
  return units / NOTES_UNITS_PER_POINT;
}

/** The smallest rectangle holding every rectangle given, or `undefined` for none. */
export function unionRects(rects: Iterable<NotesRect>): NotesRect | undefined {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  if (left > right) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether two rectangles overlap, edges included. */
export function rectsIntersect(a: NotesRect, b: NotesRect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/** Whether a point is inside a rectangle, edges included. */
export function rectContains(rect: NotesRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** A rectangle grown by `by` units on every side. */
export function inflateRect(rect: NotesRect, by: number): NotesRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  };
}
