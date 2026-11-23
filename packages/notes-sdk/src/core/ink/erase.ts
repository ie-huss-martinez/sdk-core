import { type NotesRect, rectsIntersect } from "../model/geometry.js";
import type { NotesItem, NotesStroke } from "../model/items.js";
import { strokeBounds } from "./bounds.js";
import { squaredDistanceToPath } from "./hit.js";

/**
 * How the eraser works: `stroke` removes every stroke it touches, whole;
 * `precise` removes only the ink under it.
 */
export type EraserMode = "stroke" | "precise";

/**
 * What an erasure changes on a page.
 */
export interface EraseResult {
  /** The ids of the strokes erased, whole or in part, in the page's order. */
  readonly removed: readonly string[];
  /** The strokes that remain of those erased in part, in the page's order. */
  readonly added: readonly NotesStroke[];
  /**
   * What remains of each stroke, by the id it had. A stroke erased whole has
   * an empty list. The pieces of one stroke are in the order of its points.
   */
  readonly pieces: ReadonlyMap<string, readonly NotesStroke[]>;
}

/** A part of a segment shorter than this share of it isn't cut out: the eraser only grazed it. */
const GRAZE = 1e-9;

/**
 * Erases along the eraser's path, given as flat `x, y` pairs in units. One
 * pair is a tap. The eraser is a circle of `radius` units, and it reaches a
 * stroke's ink when it comes within `radius + size / 2` of the stroke's
 * centre line, in both modes. Only strokes are erased.
 *
 * In `stroke` mode, every stroke reached is removed whole. In `precise` mode
 * the reached parts of its centre line are cut out, and what remains becomes
 * new strokes, each with an id from `newId`, the stroke's tool, colour, size,
 * `uniform` and `audio`, and at least 2 points. Where a segment crosses the
 * eraser's edge, the piece ends at a new point there, with its position and
 * pressure taken from along the segment and rounded to whole numbers.
 *
 * Returns `undefined` when the eraser reaches nothing.
 */
export function eraseAlong(
  items: readonly NotesItem[],
  path: ArrayLike<number>,
  radius: number,
  mode: EraserMode,
  newId: () => string,
): EraseResult | undefined {
  const pathCount = Math.floor(path.length / 2);
  if (pathCount === 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pathCount; index += 1) {
    left = Math.min(left, path[index * 2] as number);
    right = Math.max(right, path[index * 2] as number);
    top = Math.min(top, path[index * 2 + 1] as number);
    bottom = Math.max(bottom, path[index * 2 + 1] as number);
  }
  // A stroke's bounds already hold half its size, so the path's need only the radius.
  const swept: NotesRect = {
    x: left - radius,
    y: top - radius,
    width: right - left + 2 * radius,
    height: bottom - top + 2 * radius,
  };

  const removed: string[] = [];
  const added: NotesStroke[] = [];
  const pieces = new Map<string, readonly NotesStroke[]>();
  for (const item of items) {
    if (item.type !== "stroke") continue;
    // The bounds first: they're remembered, and most strokes are nowhere near.
    if (!rectsIntersect(strokeBounds(item), swept)) continue;
    const reach = radius + item.size / 2;
    const remaining = remainingOf(item, path, pathCount, reach, mode === "precise");
    if (remaining === undefined) continue;
    const strokes = remaining.map((points) => ({ ...item, id: newId(), points }));
    removed.push(item.id);
    added.push(...strokes);
    pieces.set(item.id, strokes);
  }
  return removed.length === 0 ? undefined : { removed, added, pieces };
}

/**
 * A page's items after an erasure: each stroke erased is replaced, where it
 * was, by what remains of it, so the order ink was drawn in is kept.
 */
export function replaceErased(items: readonly NotesItem[], result: EraseResult): NotesItem[] {
  const removed = new Set(result.removed);
  const next: NotesItem[] = [];
  for (const item of items) {
    if (!removed.has(item.id)) {
      next.push(item);
      continue;
    }
    for (const piece of result.pieces.get(item.id) ?? []) next.push(piece);
  }
  return next;
}

/**
 * The points of each piece that remains of a stroke, or `undefined` when the
 * eraser doesn't reach it. Without `cut`, a stroke reached leaves nothing.
 */
function remainingOf(
  stroke: NotesStroke,
  path: ArrayLike<number>,
  pathCount: number,
  reach: number,
  cut: boolean,
): number[][] | undefined {
  const points = stroke.points;
  const count = Math.floor(points.length / 3);
  if (count === 0) return undefined;
  if (count === 1) {
    const distance = squaredDistanceToPath(path, 2, points[0] as number, points[1] as number);
    return distance <= reach * reach ? [] : undefined;
  }

  let touched = false;
  const remaining: number[][] = [];
  // The piece being built, and the parts of the current segment the eraser
  // reaches, as `from, to` pairs along it, from 0 to 1.
  let piece: number[] | undefined;
  const spans: number[] = [];
  for (let index = 0; index + 1 < count; index += 1) {
    reachedSpans(spans, points, index, path, pathCount, reach, cut ? GRAZE : -1);
    if (spans.length === 0) {
      if (cut) {
        piece ??= [
          points[index * 3] as number,
          points[index * 3 + 1] as number,
          points[index * 3 + 2] as number,
        ];
        addPoint(piece, points, index, 1);
      }
      continue;
    }
    if (!cut) return [];
    touched = true;
    // What's kept of this segment starts at `kept` and runs to the next span.
    let kept = 0;
    for (let span = 0; span < spans.length; span += 2) {
      const from = spans[span] as number;
      if (from > kept) {
        if (piece === undefined) {
          piece = [];
          addPoint(piece, points, index, kept);
        }
        addPoint(piece, points, index, from);
      }
      if (piece !== undefined) remaining.push(piece);
      piece = undefined;
      kept = spans[span + 1] as number;
    }
    if (kept < 1) {
      piece = [];
      addPoint(piece, points, index, kept);
      addPoint(piece, points, index, 1);
    }
  }
  if (!touched) return undefined;
  if (piece !== undefined) remaining.push(piece);
  // A piece of one point isn't a stroke worth keeping.
  return remaining.filter((kept) => kept.length >= 6);
}

/**
 * Adds the point `along` a stroke's segment, from 0 at its first point to 1
 * at its second, to a piece. A point at the piece's last position isn't
 * added again: the last point takes the higher pressure.
 */
function addPoint(piece: number[], points: readonly number[], index: number, along: number): void {
  const at = index * 3;
  let x: number;
  let y: number;
  let pressure: number;
  if (along <= 0) {
    x = points[at] as number;
    y = points[at + 1] as number;
    pressure = points[at + 2] as number;
  } else if (along >= 1) {
    x = points[at + 3] as number;
    y = points[at + 4] as number;
    pressure = points[at + 5] as number;
  } else {
    const fromX = points[at] as number;
    const fromY = points[at + 1] as number;
    const fromPressure = points[at + 2] as number;
    x = Math.round(fromX + ((points[at + 3] as number) - fromX) * along) + 0;
    y = Math.round(fromY + ((points[at + 4] as number) - fromY) * along) + 0;
    pressure = Math.round(fromPressure + ((points[at + 5] as number) - fromPressure) * along);
  }
  const length = piece.length;
  if (length > 0 && piece[length - 3] === x && piece[length - 2] === y) {
    if (pressure > (piece[length - 1] as number)) piece[length - 1] = pressure;
  } else {
    piece.push(x, y, pressure);
  }
}

/**
 * Fills `spans` with the parts of a stroke's segment within `reach` of the
 * eraser's path: `from, to` pairs along the segment, from 0 to 1, in order
 * and not overlapping. A part no longer than `shortest` is left out.
 */
function reachedSpans(
  spans: number[],
  points: readonly number[],
  index: number,
  path: ArrayLike<number>,
  pathCount: number,
  reach: number,
  shortest: number,
): void {
  spans.length = 0;
  const ax = points[index * 3] as number;
  const ay = points[index * 3 + 1] as number;
  const bx = points[index * 3 + 3] as number;
  const by = points[index * 3 + 4] as number;
  const left = Math.min(ax, bx) - reach;
  const right = Math.max(ax, bx) + reach;
  const top = Math.min(ay, by) - reach;
  const bottom = Math.max(ay, by) + reach;

  // A path of one point is a tap: one circle. Otherwise, one capsule for
  // each of the path's segments.
  const capsules = Math.max(1, pathCount - 1);
  for (let capsule = 0; capsule < capsules; capsule += 1) {
    const cx = path[capsule * 2] as number;
    const cy = path[capsule * 2 + 1] as number;
    const last = pathCount === 1;
    const ex = last ? cx : (path[capsule * 2 + 2] as number);
    const ey = last ? cy : (path[capsule * 2 + 3] as number);
    if (Math.max(cx, ex) < left || Math.min(cx, ex) > right) continue;
    if (Math.max(cy, ey) < top || Math.min(cy, ey) > bottom) continue;
    if (!spanInCapsule(ax, ay, bx - ax, by - ay, cx, cy, ex, ey, reach)) continue;
    if (spanTo - spanFrom <= shortest) continue;
    addSpan(spans, spanFrom, spanTo);
  }
}

/** Adds a span to a sorted list of spans, joining it with those it overlaps. */
function addSpan(spans: number[], from: number, to: number): void {
  let start = from;
  let end = to;
  // Take out every span this one overlaps, growing it to cover them.
  let write = 0;
  let insertAt = -1;
  for (let read = 0; read < spans.length; read += 2) {
    const otherFrom = spans[read] as number;
    const otherTo = spans[read + 1] as number;
    if (otherTo < start) {
      spans[write] = otherFrom;
      spans[write + 1] = otherTo;
      write += 2;
    } else if (otherFrom > end) {
      if (insertAt < 0) insertAt = write;
      spans[write] = otherFrom;
      spans[write + 1] = otherTo;
      write += 2;
    } else {
      start = Math.min(start, otherFrom);
      end = Math.max(end, otherTo);
    }
  }
  spans.length = write;
  spans.splice(insertAt < 0 ? write : insertAt, 0, start, end);
}

/** The span {@link spanInCapsule} last found, along its segment from 0 to 1. */
let spanFrom = 0;
let spanTo = 0;

/**
 * Finds the part of the segment from `a`, along `(dx, dy)`, that lies in a
 * capsule: within `reach` of the segment from `c` to `e`. Returns whether
 * there is one, and leaves it in `spanFrom` and `spanTo`.
 *
 * A capsule is convex, so a line crosses it in one stretch: the stretch that
 * spans the line's crossings of its two round ends and of the box between
 * them.
 */
function spanInCapsule(
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
  reach: number,
): boolean {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  const lengthSquared = dx * dx + dy * dy;

  // The round ends: where |a + t d - centre| = reach.
  for (let end = 0; end < 2; end += 1) {
    const fx = ax - (end === 0 ? cx : ex);
    const fy = ay - (end === 0 ? cy : ey);
    const c = fx * fx + fy * fy - reach * reach;
    if (lengthSquared === 0) {
      if (c <= 0) {
        from = Number.NEGATIVE_INFINITY;
        to = Number.POSITIVE_INFINITY;
      }
    } else {
      const b = fx * dx + fy * dy;
      const discriminant = b * b - lengthSquared * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        from = Math.min(from, (-b - root) / lengthSquared);
        to = Math.max(to, (-b + root) / lengthSquared);
      }
    }
    if (cx === ex && cy === ey) break;
  }

  // The box between them, in its own axes: along the capsule and across it.
  const capsuleX = ex - cx;
  const capsuleY = ey - cy;
  const capsuleLength = Math.hypot(capsuleX, capsuleY);
  if (capsuleLength > 0) {
    const ux = capsuleX / capsuleLength;
    const uy = capsuleY / capsuleLength;
    const along = (ax - cx) * ux + (ay - cy) * uy;
    const alongStep = dx * ux + dy * uy;
    const across = (ay - cy) * ux - (ax - cx) * uy;
    const acrossStep = dy * ux - dx * uy;
    let boxFrom = Number.NEGATIVE_INFINITY;
    let boxTo = Number.POSITIVE_INFINITY;
    let inside = true;
    // Twice: 0 <= along <= length, then -reach <= across <= reach.
    for (let axis = 0; axis < 2 && inside; axis += 1) {
      const start = axis === 0 ? along : across;
      const step = axis === 0 ? alongStep : acrossStep;
      const low = axis === 0 ? 0 : -reach;
      const high = axis === 0 ? capsuleLength : reach;
      if (step === 0) {
        inside = start >= low && start <= high;
      } else {
        const first = (low - start) / step;
        const second = (high - start) / step;
        boxFrom = Math.max(boxFrom, Math.min(first, second));
        boxTo = Math.min(boxTo, Math.max(first, second));
      }
    }
    if (inside && boxFrom <= boxTo) {
      from = Math.min(from, boxFrom);
      to = Math.max(to, boxTo);
    }
  }

  spanFrom = Math.max(0, from);
  spanTo = Math.min(1, to);
  return spanFrom <= spanTo;
}
