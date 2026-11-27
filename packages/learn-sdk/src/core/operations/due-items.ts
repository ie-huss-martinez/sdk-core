import type { CardRecord, ProgressSnapshot } from "../model/progress.js";

/**
 * Options for {@link dueItems}.
 *
 * @public
 */
export interface DueItemsOptions {
  /** The most cards to return. All of them without it. */
  readonly limit?: number;
}

/**
 * The cards due for review at `now`, longest overdue first: what a session
 * shows before anything new. Two cards due at the same moment come in the
 * order of their ids, by code unit, so the result is the same on a server
 * and on every device. Pure; the progress given is left unchanged.
 *
 * @example
 * ```ts
 * const progress = await progressStore.load(scope);
 * const due = dueItems(progress, Date.now(), { limit: 4 });
 * ```
 *
 * @param progress - A scope's progress, or just its cards.
 * @param now - The time to compare with, in milliseconds since the Unix epoch.
 * @param options - A limit.
 * @returns The due cards, as they are in the progress.
 * @public
 */
export function dueItems(
  progress: Pick<ProgressSnapshot, "cards">,
  now: number,
  options: DueItemsOptions = {},
): readonly CardRecord[] {
  const due = progress.cards
    .filter((card) => card.due <= now)
    .sort((a, b) => a.due - b.due || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  const { limit } = options;
  return limit === undefined ? due : due.slice(0, Math.max(0, Math.floor(limit)));
}
