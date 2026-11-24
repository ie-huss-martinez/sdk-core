import type { ReactNode } from "react";

/**
 * One entry of a {@link CommandPalette}: usually a tool.
 *
 * @public
 */
export interface CommandPaletteItem {
  /** Passed to `onRun`. Unique in the list. */
  readonly id: string;
  /** What the option says, and its accessible name. */
  readonly label: string;
  /** A line under the label, read as the option's description and searched. */
  readonly description?: string | undefined;
  /** The group it belongs to, such as "Pages", shown beside it and searched. */
  readonly group?: string | undefined;
  /** Its shortcut as display text, such as "Ctrl+Shift+L". */
  readonly shortcut?: string | undefined;
  /** More words that find it, such as "turn" for Rotate. Not shown. */
  readonly keywords?: readonly string[] | undefined;
  /** A decorative icon before the label. It draws with `currentColor`. */
  readonly icon?: ReactNode;
  /** Listed, with `aria-disabled`, but can't be run. */
  readonly disabled?: boolean | undefined;
}

/** Lowercase, without accents, so "Écrire" matches "ecr". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function wordsOf(text: string | undefined): string[] {
  return text === undefined
    ? []
    : fold(text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

const everyPrefix = (query: readonly string[], words: readonly string[]): boolean =>
  query.every((part) => words.some((word) => word.startsWith(part)));

/**
 * The items a query finds, in the order a {@link CommandPalette} lists them.
 * Every word of the query must start a word of the item's label,
 * description, group or keywords, ignoring case and accents. Items whose
 * label alone matches come first; otherwise the given order holds. An empty
 * query finds every item.
 *
 * @example
 * ```ts
 * filterCommandPaletteItems(items, "rot le"); // "Rotate left" first
 * ```
 *
 * @param items - Every item, in their natural order.
 * @param query - What the person typed.
 * @returns The matching items.
 * @public
 */
export function filterCommandPaletteItems<Item extends CommandPaletteItem>(
  items: readonly Item[],
  query: string,
): Item[] {
  const parts = wordsOf(query);
  if (parts.length === 0) {
    return [...items];
  }
  const ranked: { item: Item; rank: number; index: number }[] = [];
  for (const [index, item] of items.entries()) {
    const label = wordsOf(item.label);
    if (everyPrefix(parts, label)) {
      ranked.push({ item, rank: 0, index });
      continue;
    }
    const all = [
      ...label,
      ...wordsOf(item.description),
      ...wordsOf(item.group),
      ...(item.keywords ?? []).flatMap((keyword) => wordsOf(keyword)),
    ];
    if (everyPrefix(parts, all)) {
      ranked.push({ item, rank: 1, index });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map(({ item }) => item);
}
