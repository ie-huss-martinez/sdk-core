/**
 * The positions in `tiles` that an order's texts use, each tile at most once,
 * or null where a text matches no unused tile.
 */
export function tilePositions(
  tiles: readonly string[],
  order: readonly string[],
): (number | null)[] {
  const used = new Set<number>();
  return order.map((text) => {
    const at = tiles.findIndex((tile, index) => tile === text && !used.has(index));
    if (at < 0) return null;
    used.add(at);
    return at;
  });
}

/**
 * Keeps another right order in step when the right order's tiles change
 * (ADR 0008): a tile's new text replaces its old text there, an added tile
 * goes at its end, and a removed tile leaves it. A move changes nothing,
 * because an order is the tiles' texts, not their positions. Anything else,
 * such as two changes at once, leaves the order for validation to report.
 */
export function followTiles(
  before: readonly string[],
  after: readonly string[],
  order: readonly string[],
): readonly string[] {
  const positions = tilePositions(before, order);
  if (after.length === before.length) {
    const changed = before.flatMap((tile, index) => (tile === after[index] ? [] : [index]));
    // A move: the same texts in another order.
    if ([...before].sort().join("\u0000") === [...after].sort().join("\u0000")) return order;
    if (changed.length !== 1) return order;
    const at = changed[0] as number;
    return order.map((text, index) => (positions[index] === at ? (after[at] as string) : text));
  }
  if (after.length === before.length + 1 && before.every((tile, index) => tile === after[index])) {
    return [...order, after[after.length - 1] as string];
  }
  if (after.length === before.length - 1) {
    const removed = before.findIndex((tile, index) => tile !== after[index]);
    const at = removed < 0 ? before.length - 1 : removed;
    if (!after.every((tile, index) => tile === before[index < at ? index : index + 1]))
      return order;
    return order.filter((_, index) => positions[index] !== at);
  }
  return order;
}
