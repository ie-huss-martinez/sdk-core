import { NOTES_PRESSURE_MAX } from "../model/portable.js";

/**
 * Adds a sample, as an `x, y, pressure` triple, to a stroke being drawn,
 * unless it's closer than `minimumDistance` to the last one. A sample that
 * close isn't added: the last point takes its pressure if that's higher, so
 * a pen pressed down in one place still thickens the line. Returns whether
 * the sample was added.
 */
export function appendPoint(
  points: number[],
  x: number,
  y: number,
  pressure: number,
  minimumDistance: number,
): boolean {
  const length = points.length;
  if (length >= 3) {
    const dx = x - (points[length - 3] as number);
    const dy = y - (points[length - 2] as number);
    // Not compared as squares: the square of a very small distance is 0.
    if (Math.hypot(dx, dy) < minimumDistance) {
      if (pressure > (points[length - 1] as number)) points[length - 1] = pressure;
      return false;
    }
  }
  points.push(x, y, pressure);
  return true;
}

/**
 * The points of a drawn stroke as they're stored: positions rounded to whole
 * units, and pressures rounded and kept from 0 to `NOTES_PRESSURE_MAX`.
 * Points that follow one another at one position become one point, with the
 * highest of their pressures. A sample with a number that isn't finite is
 * left out.
 */
export function toStoredPoints(points: ArrayLike<number>): number[] {
  const stored: number[] = [];
  for (let index = 0; index + 2 < points.length; index += 3) {
    const x = Math.round(points[index] as number);
    const y = Math.round(points[index + 1] as number);
    const raw = points[index + 2] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(raw)) continue;
    const pressure = Math.round(Math.min(NOTES_PRESSURE_MAX, Math.max(0, raw)));
    const length = stored.length;
    if (length > 0 && stored[length - 3] === x && stored[length - 2] === y) {
      if (pressure > (stored[length - 1] as number)) stored[length - 1] = pressure;
    } else {
      // `+ 0` turns the -0 that rounding a small negative gives into 0.
      stored.push(x + 0, y + 0, pressure);
    }
  }
  return stored;
}
