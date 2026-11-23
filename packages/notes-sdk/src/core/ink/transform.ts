import type { NotesRect } from "../model/geometry.js";
import type { NotesColor, NotesItem } from "../model/items.js";
import {
  NOTES_LENGTH_RANGE,
  NOTES_POSITION_RANGE,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
} from "../model/portable.js";

/**
 * Rounds to a whole number, halves away from zero, so a distance and its
 * opposite round to opposite numbers. `Math.round` takes 0.5 up and -0.5 up.
 */
function roundAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * A value kept within a range, or `fallback` when it isn't a number: what a
 * resize to or from a rectangle that isn't one gives.
 */
const within = (
  value: number,
  [minimum, maximum]: readonly [number, number],
  fallback: number,
): number => (Number.isNaN(value) ? fallback : Math.min(maximum, Math.max(minimum, value)));

/**
 * As much of a move along one axis as leaves every position within
 * {@link NOTES_POSITION_RANGE}, given the lowest and the highest position the
 * items have on that axis. A move that isn't a number is no move.
 */
function movable(move: number, lowest: number, highest: number): number {
  if (Number.isNaN(move)) return 0;
  const [minimum, maximum] = NOTES_POSITION_RANGE;
  // Never the other way: positions already out of range stay where they are.
  const back = Math.min(0, minimum - lowest);
  const forward = Math.max(0, maximum - highest);
  return Math.min(forward, Math.max(back, move));
}

/**
 * The items, moved by a distance in units. The distance is rounded to whole
 * units once, so every item moves by exactly the same amount.
 *
 * No position leaves {@link NOTES_POSITION_RANGE}, which is all the page
 * reader accepts. Where the distance would take one out, every item moves by
 * as much of it as there is room for, so the items keep their places among
 * themselves. Moving back by the opposite distance restores the items,
 * unless the move was cut short.
 */
export function translateItems(items: readonly NotesItem[], dx: number, dy: number): NotesItem[] {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const hold = (x: number, y: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (const item of items) {
    if (item.type !== "stroke") {
      hold(item.x, item.y);
      continue;
    }
    for (let index = 0; index + 2 < item.points.length; index += 3) {
      hold(item.points[index] as number, item.points[index + 1] as number);
    }
  }
  const moveX = movable(roundAway(dx), left, right);
  const moveY = movable(roundAway(dy), top, bottom);
  return items.map((item) => {
    if (item.type !== "stroke") return { ...item, x: item.x + moveX, y: item.y + moveY };
    const points = item.points.slice();
    for (let index = 0; index + 2 < points.length; index += 3) {
      points[index] = (points[index] as number) + moveX;
      points[index + 1] = (points[index + 1] as number) + moveY;
    }
    return { ...item, points };
  });
}

/**
 * The items, resized so that the rectangle `from` lands on `to`: each axis
 * by its own factor, about the rectangles' corners. A `from` with no width
 * or no height isn't stretched on that axis.
 *
 * A stroke's points move and its size follows the geometric mean of the two
 * factors. A text box's position, width and font size follow, the size by
 * the vertical factor. A picture and a link have their rectangle resized.
 *
 * Results are whole units, within the model's ranges, which are all the page
 * reader accepts: a position within {@link NOTES_POSITION_RANGE}, a width or
 * height within {@link NOTES_LENGTH_RANGE}, and a size within its limits. A
 * resize that would take a value past its range stops that value at the end
 * of it; one that stays within them keeps the proportions asked for.
 */
export function scaleItems(
  items: readonly NotesItem[],
  from: NotesRect,
  to: NotesRect,
): NotesItem[] {
  const factorX = from.width === 0 ? 1 : to.width / from.width;
  const factorY = from.height === 0 ? 1 : to.height / from.height;
  const mapX = (x: number): number =>
    within(Math.round(to.x + (x - from.x) * factorX) + 0, NOTES_POSITION_RANGE, x);
  const mapY = (y: number): number =>
    within(Math.round(to.y + (y - from.y) * factorY) + 0, NOTES_POSITION_RANGE, y);
  const length = (value: number, factor: number): number =>
    within(Math.round(value * Math.abs(factor)), NOTES_LENGTH_RANGE, value);

  return items.map((item) => {
    switch (item.type) {
      case "stroke": {
        const points = item.points.slice();
        for (let index = 0; index + 2 < points.length; index += 3) {
          points[index] = mapX(points[index] as number);
          points[index + 1] = mapY(points[index + 1] as number);
        }
        const size = Math.round(item.size * Math.sqrt(Math.abs(factorX * factorY)));
        return { ...item, points, size: within(size, NOTES_STROKE_SIZE_RANGE, item.size) };
      }
      case "text":
        return {
          ...item,
          x: mapX(item.x),
          y: mapY(item.y),
          width: length(item.width, factorX),
          size: within(Math.round(item.size * Math.abs(factorY)), NOTES_TEXT_SIZE_RANGE, item.size),
        };
      default:
        return {
          ...item,
          x: mapX(item.x),
          y: mapY(item.y),
          width: length(item.width, factorX),
          height: length(item.height, factorY),
        };
    }
  });
}

/**
 * The items in a colour. Ink and text take it; a picture and a link have no
 * colour and are returned as they are.
 */
export function recolorItems(items: readonly NotesItem[], color: NotesColor): NotesItem[] {
  return items.map((item) =>
    item.type === "stroke" || item.type === "text" ? { ...item, color } : item,
  );
}

/**
 * Copies of the items under new ids, for duplicating and pasting. Nothing
 * else changes: a copy is in the same place and keeps its recording's
 * anchor.
 */
export function cloneItems(items: readonly NotesItem[], newId: () => string): NotesItem[] {
  return items.map((item) => ({ ...item, id: newId() }));
}
