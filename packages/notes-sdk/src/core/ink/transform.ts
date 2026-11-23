import type { NotesRect } from "../model/geometry.js";
import type { NotesColor, NotesItem } from "../model/items.js";
import { NOTES_STROKE_SIZE_RANGE, NOTES_TEXT_SIZE_RANGE } from "../model/portable.js";

/**
 * Rounds to a whole number, halves away from zero, so a distance and its
 * opposite round to opposite numbers. `Math.round` takes 0.5 up and -0.5 up.
 */
function roundAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const clamp = (value: number, [minimum, maximum]: readonly [number, number]): number =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * The items, moved by a distance in units. The distance is rounded to whole
 * units once, so every item moves by exactly the same amount and moving back
 * by the opposite distance restores them.
 */
export function translateItems(items: readonly NotesItem[], dx: number, dy: number): NotesItem[] {
  const moveX = roundAway(dx);
  const moveY = roundAway(dy);
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
 * Results are whole units, within the model's ranges: a size stays within
 * its limits, and a width or height is at least 1.
 */
export function scaleItems(
  items: readonly NotesItem[],
  from: NotesRect,
  to: NotesRect,
): NotesItem[] {
  const factorX = from.width === 0 ? 1 : to.width / from.width;
  const factorY = from.height === 0 ? 1 : to.height / from.height;
  const mapX = (x: number): number => Math.round(to.x + (x - from.x) * factorX) + 0;
  const mapY = (y: number): number => Math.round(to.y + (y - from.y) * factorY) + 0;
  const length = (value: number, factor: number): number =>
    Math.max(1, Math.round(value * Math.abs(factor)));

  return items.map((item) => {
    switch (item.type) {
      case "stroke": {
        const points = item.points.slice();
        for (let index = 0; index + 2 < points.length; index += 3) {
          points[index] = mapX(points[index] as number);
          points[index + 1] = mapY(points[index + 1] as number);
        }
        const size = Math.round(item.size * Math.sqrt(Math.abs(factorX * factorY)));
        return { ...item, points, size: clamp(size, NOTES_STROKE_SIZE_RANGE) };
      }
      case "text":
        return {
          ...item,
          x: mapX(item.x),
          y: mapY(item.y),
          width: length(item.width, factorX),
          size: clamp(Math.round(item.size * Math.abs(factorY)), NOTES_TEXT_SIZE_RANGE),
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
