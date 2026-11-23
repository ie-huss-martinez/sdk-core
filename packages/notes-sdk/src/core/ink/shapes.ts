import { NOTES_PRESSURE_MAX } from "../model/portable.js";
import { squaredDistanceToSegment } from "./hit.js";

/** A shape a freehand stroke can be straightened into. */
export type ShapeKind = "line" | "rectangle" | "ellipse" | "triangle";

/** A straightened shape: its kind, and its points for a `uniform` stroke. */
export interface RecognisedShape {
  readonly kind: ShapeKind;
  /** `x, y, pressure` triples in whole units, with one pressure throughout. */
  readonly points: number[];
}

/*
 * The thresholds. They're strict on purpose: a shape drawn with care passes,
 * and handwriting doesn't, because a stroke that turns into a shape nobody
 * asked for is worse than one that stays as it was drawn. Lengths are shares
 * of the stroke's own size, so a shape is recognised the same at any size.
 */

/** A shape's pressure. A uniform stroke ignores it; the middle is a fair value to store. */
const SHAPE_PRESSURE = NOTES_PRESSURE_MAX / 2;
/**
 * The shortest line, and the smallest diagonal of a closed shape's bounding
 * box, in units: 5 points, about 1.8 mm. Anything smaller is a dot or a tick.
 */
const MINIMUM_EXTENT = 500;
/** A line stays within 4% of its length from the straight line between its ends. */
const LINE_DEVIATION = 0.04;
/**
 * A line's path is at most 10% longer than the distance between its ends.
 * A scribble back and forth over a straight line stays close to it too, and
 * this is what tells them apart.
 */
const LINE_SLACK = 1.1;
/** A closed shape's ends meet within 15% of its bounding box's diagonal. */
const CLOSING_GAP = 0.15;
/** A closed shape's shorter side is at least 15% of its longer one. Thinner is a line gone over twice. */
const MINIMUM_ASPECT = 0.15;
/**
 * A closed shape goes around its centre once: between 0.8 and 1.2 turns.
 * A figure of eight, or a path that goes out and comes back the same way,
 * makes no turn in total, and a spiral makes several.
 */
const MINIMUM_TURN = 1.6 * Math.PI;
const MAXIMUM_TURN = 2.4 * Math.PI;
/**
 * How far the path may be from the ideal shape, as a share of the bounding
 * box's diagonal: on average, and at its worst point.
 *
 * The averages are set by how alike the shapes are. A perfect circle is 3.5%
 * from its bounding box's edges on average, and a perfect square is 5% from
 * its inscribed ellipse, so both limits must be under those. The ellipse's
 * is a little looser, because a hand-drawn round is less regular than a
 * hand-drawn box. When a path passes for two shapes, the nearer one wins.
 */
const MEAN_DEVIATION: Readonly<Record<Exclude<ShapeKind, "line">, number>> = {
  ellipse: 0.03,
  rectangle: 0.025,
  triangle: 0.025,
};
const WORST_DEVIATION = 0.1;
/** A triangle's third corner is at least 15% of its longest side away from that side. */
const MINIMUM_HEIGHT = 0.15;
/**
 * The points a path is measured at, evenly spaced along it, so a pen that
 * slowed down in one place doesn't count for more there.
 */
const SAMPLES = 64;
/** The segments of a recognised ellipse. */
const ELLIPSE_SEGMENTS = 48;

/**
 * The clean shape a freehand stroke clearly is, or `undefined`.
 *
 * `points` are the stroke's `x, y, pressure` triples. The answer holds the
 * shape's points for a `uniform` stroke:
 *
 * - a line: its 2 ends;
 * - a rectangle, with its sides along the page's: 5 points, closed;
 * - an ellipse, with its axes along the page's: 49 points, closed;
 * - a triangle: 4 points, closed.
 *
 * Ask only when the user asked for a shape, such as by holding the pen still
 * at the end of a stroke: an "o" is a fine ellipse.
 */
export function recogniseShape(points: ArrayLike<number>): RecognisedShape | undefined {
  const path: number[] = [];
  for (let index = 0; index + 2 < points.length; index += 3) {
    const x = points[index] as number;
    const y = points[index + 1] as number;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    path.push(x, y);
  }
  const count = path.length / 2;
  if (count < 2) return undefined;

  const startX = path[0] as number;
  const startY = path[1] as number;
  const endX = path[count * 2 - 2] as number;
  const endY = path[count * 2 - 1] as number;
  let length = 0;
  let left = startX;
  let right = startX;
  let top = startY;
  let bottom = startY;
  for (let index = 1; index < count; index += 1) {
    const x = path[index * 2] as number;
    const y = path[index * 2 + 1] as number;
    length += Math.hypot(x - (path[index * 2 - 2] as number), y - (path[index * 2 - 1] as number));
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const gap = Math.hypot(endX - startX, endY - startY);

  if (gap >= MINIMUM_EXTENT && length <= LINE_SLACK * gap) {
    const limit = (LINE_DEVIATION * gap) ** 2;
    let straight = true;
    for (let index = 1; index < count - 1 && straight; index += 1) {
      const x = path[index * 2] as number;
      const y = path[index * 2 + 1] as number;
      straight = squaredDistanceToSegment(x, y, startX, startY, endX, endY) <= limit;
    }
    return straight ? shape("line", [startX, startY, endX, endY]) : undefined;
  }

  const width = right - left;
  const height = bottom - top;
  const diagonal = Math.hypot(width, height);
  if (diagonal < MINIMUM_EXTENT || gap > CLOSING_GAP * diagonal) return undefined;
  if (Math.min(width, height) < MINIMUM_ASPECT * Math.max(width, height)) return undefined;

  const samples = resample(path, length);
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  const turn = Math.abs(turnAround(samples, centreX, centreY));
  if (turn < MINIMUM_TURN || turn > MAXIMUM_TURN) return undefined;

  // The nearest of the three shapes, if the path is near enough to it.
  const radiusX = width / 2;
  const radiusY = height / 2;
  const triangle = cornersOfTriangle(path, samples);
  let best: RecognisedShape | undefined;
  let bestMean = Number.POSITIVE_INFINITY;
  for (const kind of CLOSED_SHAPES) {
    if (kind === "triangle" && triangle === undefined) continue;
    let sum = 0;
    let worst = 0;
    for (let index = 0; index < samples.length; index += 2) {
      const x = samples[index] as number;
      const y = samples[index + 1] as number;
      let away: number;
      if (kind === "rectangle") {
        away = Math.min(x - left, right - x, y - top, bottom - y);
      } else if (kind === "ellipse") {
        // Scaled so the ellipse is the unit circle, the point is `scaled`
        // from the centre, and the ellipse is at 1 along the same ray.
        const scaled = Math.hypot((x - centreX) / radiusX, (y - centreY) / radiusY);
        away =
          scaled === 0
            ? Math.min(radiusX, radiusY)
            : Math.hypot(x - centreX, y - centreY) * Math.abs(1 - 1 / scaled);
      } else {
        const [ax, ay, bx, by, cx, cy] = triangle as Corners;
        away = Math.sqrt(
          Math.min(
            squaredDistanceToSegment(x, y, ax, ay, bx, by),
            squaredDistanceToSegment(x, y, bx, by, cx, cy),
            squaredDistanceToSegment(x, y, cx, cy, ax, ay),
          ),
        );
      }
      sum += away;
      worst = Math.max(worst, away);
    }
    const mean = sum / (samples.length / 2) / diagonal;
    if (mean > MEAN_DEVIATION[kind] || worst > WORST_DEVIATION * diagonal || mean >= bestMean) {
      continue;
    }
    bestMean = mean;
    if (kind === "rectangle") {
      best = shape(kind, [left, top, right, top, right, bottom, left, bottom, left, top]);
    } else if (kind === "ellipse") {
      const ellipse: number[] = [];
      for (let segment = 0; segment < ELLIPSE_SEGMENTS; segment += 1) {
        const angle = (segment / ELLIPSE_SEGMENTS) * 2 * Math.PI;
        ellipse.push(centreX + radiusX * Math.cos(angle), centreY + radiusY * Math.sin(angle));
      }
      // Closed on its first point exactly.
      ellipse.push(centreX + radiusX, centreY);
      best = shape(kind, ellipse);
    } else {
      const [ax, ay, bx, by, cx, cy] = triangle as Corners;
      best = shape(kind, [ax, ay, bx, by, cx, cy, ax, ay]);
    }
  }
  return best;
}

/** The closed shapes, in the order they're tried. */
const CLOSED_SHAPES = ["ellipse", "rectangle", "triangle"] as const;

/** A triangle's corners, as three `x, y` pairs. */
type Corners = readonly [number, number, number, number, number, number];

/** A shape from its positions, as whole-unit triples with the shape's pressure. */
function shape(kind: ShapeKind, positions: readonly number[]): RecognisedShape {
  const points: number[] = [];
  for (let index = 0; index < positions.length; index += 2) {
    // `+ 0` turns the -0 that rounding a small negative gives into 0.
    points.push(
      Math.round(positions[index] as number) + 0,
      Math.round(positions[index + 1] as number) + 0,
      SHAPE_PRESSURE,
    );
  }
  return { kind, points };
}

/** `SAMPLES` positions evenly spaced along a path of the given length, ends included. */
function resample(path: readonly number[], length: number): number[] {
  const samples: number[] = [path[0] as number, path[1] as number];
  const count = path.length / 2;
  const step = length / (SAMPLES - 1);
  let walked = 0;
  let next = step;
  for (let index = 1; index < count && samples.length < (SAMPLES - 1) * 2; index += 1) {
    const fromX = path[index * 2 - 2] as number;
    const fromY = path[index * 2 - 1] as number;
    const toX = path[index * 2] as number;
    const toY = path[index * 2 + 1] as number;
    const segment = Math.hypot(toX - fromX, toY - fromY);
    while (next <= walked + segment && samples.length < (SAMPLES - 1) * 2) {
      const along = (next - walked) / segment;
      samples.push(fromX + (toX - fromX) * along, fromY + (toY - fromY) * along);
      next += step;
    }
    walked += segment;
  }
  samples.push(path[count * 2 - 2] as number, path[count * 2 - 1] as number);
  return samples;
}

/** The angle a path turns through around a centre, in radians, signed. */
function turnAround(samples: readonly number[], centreX: number, centreY: number): number {
  let turn = 0;
  let before = Math.atan2((samples[1] as number) - centreY, (samples[0] as number) - centreX);
  for (let index = 2; index < samples.length; index += 2) {
    const angle = Math.atan2(
      (samples[index + 1] as number) - centreY,
      (samples[index] as number) - centreX,
    );
    let change = angle - before;
    if (change > Math.PI) change -= 2 * Math.PI;
    else if (change < -Math.PI) change += 2 * Math.PI;
    turn += change;
    before = angle;
  }
  return turn;
}

/**
 * The three dominant corners of a closed path, as `x, y` pairs in the order
 * they were drawn, or `undefined` if they don't make a triangle.
 *
 * The first is the point furthest from the path's centre, the second the
 * point furthest from the first, and the third the point furthest from the
 * line through both. On a triangle those are its corners, since the point of
 * a convex shape furthest from anything is always a corner.
 */
function cornersOfTriangle(
  path: readonly number[],
  samples: readonly number[],
): Corners | undefined {
  let centreX = 0;
  let centreY = 0;
  for (let index = 0; index < samples.length; index += 2) {
    centreX += samples[index] as number;
    centreY += samples[index + 1] as number;
  }
  centreX /= samples.length / 2;
  centreY /= samples.length / 2;

  const count = path.length / 2;
  const furthest = (measure: (x: number, y: number) => number): number => {
    let found = 0;
    let most = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < count; index += 1) {
      const value = measure(path[index * 2] as number, path[index * 2 + 1] as number);
      if (value > most) {
        most = value;
        found = index;
      }
    }
    return found;
  };
  const first = furthest((x, y) => (x - centreX) ** 2 + (y - centreY) ** 2);
  const ax = path[first * 2] as number;
  const ay = path[first * 2 + 1] as number;
  const second = furthest((x, y) => (x - ax) ** 2 + (y - ay) ** 2);
  const bx = path[second * 2] as number;
  const by = path[second * 2 + 1] as number;
  const side = Math.hypot(bx - ax, by - ay);
  if (side === 0) return undefined;
  // Twice the area of the triangle a point makes with the first two corners.
  const third = furthest((x, y) => Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)));
  const cx = path[third * 2] as number;
  const cy = path[third * 2 + 1] as number;
  const heightOverSide = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / side;
  const longest = Math.max(side, Math.hypot(cx - ax, cy - ay), Math.hypot(cx - bx, cy - by));
  if (heightOverSide < MINIMUM_HEIGHT * longest) return undefined;

  // In the order they were drawn.
  const [one, two, three] = [first, second, third].sort((a, b) => a - b) as [
    number,
    number,
    number,
  ];
  return [
    path[one * 2] as number,
    path[one * 2 + 1] as number,
    path[two * 2] as number,
    path[two * 2 + 1] as number,
    path[three * 2] as number,
    path[three * 2 + 1] as number,
  ];
}
