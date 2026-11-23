import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { NotesStroke, NotesStrokeTool } from "../model/items.js";
import { NOTES_PRESSURE_MAX } from "../model/portable.js";

/**
 * What decides a stroke's shape: its tool, its width at full pressure in
 * units, and whether it keeps one width from end to end.
 */
export interface StrokeStyle {
  readonly tool: NotesStrokeTool;
  readonly size: number;
  readonly uniform?: boolean;
}

/*
 * The options given to perfect-freehand, and why.
 *
 * Size. perfect-freehand's `size` is the width at half pressure: at full
 * pressure the line is `size * (1 + thinning)` wide. The model's size is the
 * width at full pressure, and bounds, hit tests and the eraser rely on ink
 * never being wider. So a pen passes `size / (1 + thinning)`.
 *
 * Pen. `simulatePressure: false`, so the width follows the pen's real
 * pressure. `thinning: 0.5` is gentle: the line is a third of its size at no
 * pressure and its full size at full pressure, so a mouse, which reports half
 * pressure, draws at two thirds. `streamline: 0.3` moves each point about
 * three quarters of the way to the pen's sample, which removes a digitiser's
 * jitter while the line's end stays a third of one sample behind the pen: too
 * little to see. `smoothing: 0.4` keeps outline points at least 0.4 of the
 * size apart, which follows tight handwriting more closely than the default
 * of 0.5.
 *
 * Tapers. Only a finished pen stroke has them, since a taper's length depends
 * on the stroke's whole length. Each end tapers over 1.5 times the size, and
 * never more than a quarter of the stroke, so its middle half keeps its
 * width. A stroke shorter than twice its size has round ends instead: tapered
 * from both ends it would be a sliver.
 *
 * Highlighter. `thinning: 0` for one width whatever the pressure, the pen's
 * smoothing and streamline, no taper, and flat ends, like a marker's chisel
 * tip.
 *
 * A uniform stroke isn't drawn by perfect-freehand at all: see
 * `uniformOutline`.
 */
const PEN_THINNING = 0.5;
const SMOOTHING = 0.4;
const STREAMLINE = 0.3;
/** A taper's length, in stroke sizes. */
const TAPER_LENGTH = 1.5;
/** The most of a stroke one taper covers. */
const TAPER_SHARE = 0.25;
/** A stroke shorter than this many sizes has round ends, not tapers. */
const TAPER_MINIMUM_LENGTH = 2;

/** The sides of the polygon drawn for a dot. */
const DOT_SIDES = 16;

/**
 * A uniform stroke's path turning less than 30 degrees at a point is a curve
 * there, and its outline is smoothed. A sharper turn is a corner.
 */
// The cosine of 30 degrees, written out: a call here would stay in every bundle (sdk-core ADR 0056).
const GENTLE_COSINE = 0.8660254037844387;
/** The largest angle between two points of a round join or a round end: 22.5 degrees. */
const ARC_STEP = Math.PI / 8;

/**
 * The outline of a stroke: the polygon to fill, as flat `x, y` pairs in
 * units.
 *
 * `points` are `x, y, pressure` triples, with pressure from 0 to
 * `NOTES_PRESSURE_MAX`. They may be the integers of a stored stroke or the
 * floats of one being drawn. `complete` says the pen has lifted: the outline
 * then ends exactly at the last point, and a pen's stroke gets its tapers.
 *
 * The polygon can cross itself where the stroke turns sharply, so fill it
 * with the non-zero rule, which is the default of canvas and PDF.
 */
export function outlineOfPoints(
  points: ArrayLike<number>,
  style: StrokeStyle,
  complete: boolean,
): number[] {
  const count = Math.floor(points.length / 3);
  const size = style.size;
  if (count === 0 || !(size > 0)) return [];
  const constantWidth = style.tool === "highlighter" || style.uniform === true;
  const penSize = size / (1 + PEN_THINNING);

  if (isOnePosition(points, count)) {
    // perfect-freehand draws a dot around a second point it invents one unit
    // away. Drawing the circle here keeps it centred and inside its bounds.
    const radius = constantWidth
      ? size / 2
      : penSize * (0.5 - PEN_THINNING * (0.5 - highestPressure(points, count)));
    return dot(points[0] as number, points[1] as number, radius);
  }

  if (style.uniform === true) return uniformOutline(points, count, size, style.tool === "pen");

  let options: StrokeOptions;
  if (style.tool === "highlighter") {
    options = {
      size,
      thinning: 0,
      smoothing: SMOOTHING,
      streamline: STREAMLINE,
      simulatePressure: false,
      start: { cap: false, taper: 0 },
      end: { cap: false, taper: 0 },
      last: complete,
    };
  } else {
    const taper = complete ? taperLength(points, count, size) : 0;
    options = {
      size: penSize,
      thinning: PEN_THINNING,
      smoothing: SMOOTHING,
      streamline: STREAMLINE,
      simulatePressure: false,
      start: { cap: true, taper },
      end: { cap: true, taper },
      last: complete,
    };
  }

  const outline = getStroke(triples(points, count), options);
  const flat = new Array<number>(outline.length * 2);
  for (let index = 0; index < outline.length; index += 1) {
    const point = outline[index] as [number, number];
    flat[index * 2] = point[0];
    flat[index * 2 + 1] = point[1];
  }
  return flat;
}

/**
 * The outline of a stroke: the polygon to fill to draw it, as flat `x, y`
 * pairs in units. It can cross itself where the stroke turns sharply, so
 * fill it with the non-zero rule, which is the default of canvas and PDF.
 * Pass it to {@link outlineToPathData} for a smooth path.
 *
 * @public
 */
export function strokeOutline(stroke: NotesStroke): number[] {
  return outlineOfPoints(stroke.points, stroke, true);
}

/** Rounds to 2 decimals. `+ 0` turns the -0 a small negative rounds to into 0. */
const round2 = (value: number): number => Math.round(value * 100) / 100 + 0;

/**
 * An outline as a smooth closed curve, for a PDF's content stream:
 * `[startX, startY, c1x, c1y, x1, y1, c2x, c2y, x2, y2, ...]`, a point to
 * move to and then one quadratic segment, as its control point and its end,
 * for each point of the outline. The last segment ends where the curve
 * starts.
 *
 * The curve runs from the middle of one side of the polygon to the middle of
 * the next, with the corner between them as the control point, which is the
 * usual way to smooth perfect-freehand's output. Numbers are rounded to 2
 * decimals, a ten-thousandth of a point. An empty outline gives `[]`.
 */
export function outlineSegments(outline: readonly number[]): number[] {
  const count = Math.floor(outline.length / 2);
  if (count === 0) return [];
  const segments = new Array<number>(2 + count * 4);
  let x = outline[0] as number;
  let y = outline[1] as number;
  segments[0] = round2(((outline[count * 2 - 2] as number) + x) / 2);
  segments[1] = round2(((outline[count * 2 - 1] as number) + y) / 2);
  for (let index = 0; index < count; index += 1) {
    const next = index + 1 === count ? 0 : (index + 1) * 2;
    const nextX = outline[next] as number;
    const nextY = outline[next + 1] as number;
    const at = 2 + index * 4;
    segments[at] = round2(x);
    segments[at + 1] = round2(y);
    // The same sum, in the same order, as the start's: the curve closes exactly.
    segments[at + 2] = round2((x + nextX) / 2);
    segments[at + 3] = round2((y + nextY) / 2);
    x = nextX;
    y = nextY;
  }
  return segments;
}

/**
 * An outline as SVG path data, `M...Q...Z`, for a canvas's `Path2D`: a
 * smooth closed curve through the middle of each side of the polygon, with
 * numbers rounded to 2 decimals. An empty outline gives `""`.
 *
 * It's the curve `outlineSegments` describes, number for number, so a page
 * looks the same on screen and in an exported PDF.
 *
 * @public
 */
export function outlineToPathData(outline: readonly number[]): string {
  const segments = outlineSegments(outline);
  if (segments.length === 0) return "";
  return `M${segments[0]} ${segments[1]}Q${segments.slice(2).join(" ")}Z`;
}

/** Whether every point is at the first point's position. */
function isOnePosition(points: ArrayLike<number>, count: number): boolean {
  for (let index = 1; index < count; index += 1) {
    if (points[index * 3] !== points[0] || points[index * 3 + 1] !== points[1]) return false;
  }
  return true;
}

/** The highest pressure of the points, from 0 to 1. */
function highestPressure(points: ArrayLike<number>, count: number): number {
  let highest = 0;
  for (let index = 0; index < count; index += 1) {
    highest = Math.max(highest, pressureOf(points[index * 3 + 2] as number));
  }
  return highest;
}

/** A stored pressure as perfect-freehand's, from 0 to 1. */
function pressureOf(stored: number): number {
  return Math.min(1, Math.max(0, stored / NOTES_PRESSURE_MAX));
}

/** A circle as a polygon. Smoothed, it's round to within 2% of its radius. */
function dot(x: number, y: number, radius: number): number[] {
  const polygon = new Array<number>(DOT_SIDES * 2);
  for (let side = 0; side < DOT_SIDES; side += 1) {
    const angle = (side / DOT_SIDES) * 2 * Math.PI;
    polygon[side * 2] = x + radius * Math.cos(angle);
    polygon[side * 2 + 1] = y + radius * Math.sin(angle);
  }
  return polygon;
}

/** The points as perfect-freehand takes them: `[x, y, pressure]`, pressure from 0 to 1. */
function triples(points: ArrayLike<number>, count: number): number[][] {
  const input = new Array<number[]>(count);
  for (let index = 0; index < count; index += 1) {
    input[index] = [
      points[index * 3] as number,
      points[index * 3 + 1] as number,
      pressureOf(points[index * 3 + 2] as number),
    ];
  }
  return input;
}

/** The length of each taper of a finished pen stroke, or 0 for round ends. */
function taperLength(points: ArrayLike<number>, count: number, size: number): number {
  let length = 0;
  for (let index = 1; index < count; index += 1) {
    length += Math.hypot(
      (points[index * 3] as number) - (points[index * 3 - 3] as number),
      (points[index * 3 + 1] as number) - (points[index * 3 - 2] as number),
    );
  }
  if (length < TAPER_MINIMUM_LENGTH * size) return 0;
  return Math.min(TAPER_LENGTH * size, TAPER_SHARE * length);
}

/**
 * The outline of a uniform stroke: a line of one width along the points,
 * with round joins, and round ends for a pen or flat ends for a highlighter.
 *
 * perfect-freehand isn't used here. It expects the dense path of a hand, and
 * a uniform stroke is usually a straightened shape: a few points joined by
 * long straight segments. It would skew the join of two such segments, and
 * the smoothing of its outline would turn a rectangle into a bulge. This
 * draws the exact shape instead.
 *
 * The polygon is written for {@link outlineSegments}, which smooths every
 * outline through the middle of each side. A point given twice has a side of
 * no length, whose middle is the point itself, so the curve passes through it
 * and the sides next to it stay straight. Corners and the ends of arcs are
 * given twice. Points of an arc, and of a path that bends gently as a curve
 * does, are given once, so smoothing rounds them.
 *
 * A closed path, whose first and last points are the same, is drawn from the
 * middle of its first segment to just past it, with flat ends. Its corners
 * then all look alike, and its two ends lie under the line itself.
 */
function uniformOutline(
  points: ArrayLike<number>,
  count: number,
  size: number,
  roundEnds: boolean,
): number[] {
  const half = size / 2;
  // Positions only, without repeats: a uniform stroke ignores its pressures.
  let path: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = points[index * 3] as number;
    const y = points[index * 3 + 1] as number;
    const length = path.length;
    if (length === 0 || path[length - 2] !== x || path[length - 1] !== y) path.push(x, y);
  }
  let round = roundEnds;
  const end = path.length - 2;
  if (path.length >= 8 && path[0] === path[end] && path[1] === path[end + 1]) {
    path = fromMiddleOfFirstSegment(path, half);
    round = false;
  }

  // The outline runs around the path once: the start, the left side forwards,
  // the end, and the right side backwards. The right side is collected
  // forwards and added in reverse.
  const total = path.length / 2;
  const outline: number[] = [];
  const right: number[] = [];
  let x = path[0] as number;
  let y = path[1] as number;
  let nextX = path[2] as number;
  let nextY = path[3] as number;
  let length = Math.hypot(nextX - x, nextY - y);
  let ux = (nextX - x) / length;
  let uy = (nextY - y) / length;
  if (round) {
    arc(outline, x, y, uy, -ux, -Math.PI, half);
  } else {
    corner(outline, x + uy * half, y - ux * half);
    corner(outline, x - uy * half, y + ux * half);
  }
  for (let index = 1; index < total - 1; index += 1) {
    x = nextX;
    y = nextY;
    nextX = path[index * 2 + 2] as number;
    nextY = path[index * 2 + 3] as number;
    const nextLength = Math.hypot(nextX - x, nextY - y);
    const vx = (nextX - x) / nextLength;
    const vy = (nextY - y) / nextLength;
    const reach = Math.min(length, nextLength);
    join(outline, x, y, ux, uy, vx, vy, half, reach, 1);
    join(right, x, y, ux, uy, vx, vy, half, reach, -1);
    ux = vx;
    uy = vy;
    length = nextLength;
  }
  if (round) {
    arc(outline, nextX, nextY, -uy, ux, -Math.PI, half);
  } else {
    corner(outline, nextX - uy * half, nextY + ux * half);
    corner(outline, nextX + uy * half, nextY - ux * half);
  }
  for (let index = right.length - 2; index >= 0; index -= 2) {
    outline.push(right[index] as number, right[index + 1] as number);
  }
  return outline;
}

/**
 * A closed path, started again from the middle of its first segment and
 * ended a little past that point: by `overlap`, or a quarter of the segment
 * if that's less.
 */
function fromMiddleOfFirstSegment(path: readonly number[], overlap: number): number[] {
  const startX = path[0] as number;
  const startY = path[1] as number;
  const dx = (path[2] as number) - startX;
  const dy = (path[3] as number) - startY;
  const past = 0.5 + Math.min(overlap / Math.hypot(dx, dy), 0.25);
  return [
    startX + dx / 2,
    startY + dy / 2,
    ...path.slice(2),
    startX + dx * past,
    startY + dy * past,
  ];
}

/** Adds a point the smoothed outline passes through, with straight sides next to it. */
function corner(outline: number[], x: number, y: number): void {
  outline.push(x, y, x, y);
}

/**
 * Adds an arc around a centre, from the unit vector `(vx, vy)` and through
 * `sweep` radians. Its two ends are corners.
 */
function arc(
  outline: number[],
  centreX: number,
  centreY: number,
  vx: number,
  vy: number,
  sweep: number,
  radius: number,
): void {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP - 1e-9));
  for (let step = 0; step <= steps; step += 1) {
    const angle = (sweep * step) / steps;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = centreX + (vx * cos - vy * sin) * radius;
    const y = centreY + (vx * sin + vy * cos) * radius;
    outline.push(x, y);
    if (step === 0 || step === steps) outline.push(x, y);
  }
}

/**
 * Adds one side of the join at `(x, y)`, where the path turns from the
 * direction `(ux, uy)` to `(vx, vy)`. `side` is 1 for the left of the path
 * and -1 for the right; `reach` is the length of the shorter segment there.
 */
function join(
  outline: number[],
  x: number,
  y: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  half: number,
  reach: number,
  side: number,
): void {
  const dot = ux * vx + uy * vy;
  const cross = ux * vy - uy * vx;
  // The normals of the two segments, on this side, and their sum.
  const ax = -uy * side;
  const ay = ux * side;
  const sumX = ax - vy * side;
  const sumY = ay + vx * side;
  // Where the two segments' edges meet on this side: the point of a mitre.
  const mitre = half / (1 + dot);
  const inside = cross * side > 0;

  if (dot > GENTLE_COSINE) {
    // Part of a curve: one point, on the edges' crossing inside the bend and
    // at the stroke's width outside it, so the outline is never too wide.
    const scale = inside ? mitre : half / Math.sqrt(2 + 2 * dot);
    outline.push(x + sumX * scale, y + sumY * scale);
  } else if (!inside) {
    arc(outline, x, y, ax, ay, Math.atan2(cross, dot), half);
  } else if (dot > -1 && half * Math.sqrt((1 - dot) / (1 + dot)) <= reach) {
    corner(outline, x + sumX * mitre, y + sumY * mitre);
  } else {
    // The segments are too short for their edges to meet: go through the
    // path's own point, which keeps the outline inside the line.
    corner(outline, x + ax * half, y + ay * half);
    corner(outline, x, y);
    corner(outline, x - vy * side * half, y + vx * side * half);
  }
}
