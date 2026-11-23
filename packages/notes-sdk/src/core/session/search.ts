import type { NotesPageText } from "../ports/notes-store.js";

/**
 * One place a search found its words.
 *
 * @public
 */
export interface NotesSearchHit {
  readonly notebook: string;
  readonly page: string;
  /** Whether the words are in typed text, or in the text of the PDF under the page. */
  readonly source: "typed" | "pdf";
  /** The text around the match, on one line. */
  readonly snippet: string;
  /** Where the match is in `snippet`, in UTF-16 units. */
  readonly matchStart: number;
  readonly matchLength: number;
}

/** The most hits a search returns. */
export const NOTES_MAX_SEARCH_HITS = 200;

/** How much text a snippet shows on each side of the match. */
const CONTEXT = 40;

/**
 * Text as search compares it: compatibility forms folded, case folded, and
 * every run of white space one space, so a match can span a line break.
 *
 * Lowercase alone isn't case folding: it writes a final sigma differently
 * from one inside a word, and keeps a sharp s apart from "SS". Uppercase,
 * then lowercase, then one sigma, makes both sides of a comparison alike.
 */
function fold(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .toLowerCase()
    .replace(/\u03C2/g, "\u03C3")
    .replace(/\s+/g, " ");
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Whether cutting `text` at `index` would split a character in two. */
const splitsCharacter = (text: string, index: number) =>
  index > 0 &&
  index < text.length &&
  isHighSurrogate(text.charCodeAt(index - 1)) &&
  isLowSurrogate(text.charCodeAt(index));

/** A snippet around a match, cut at word boundaries where it can. */
function snippetAt(text: string, start: number, length: number) {
  let from = Math.max(0, start - CONTEXT);
  let to = Math.min(text.length, start + length + CONTEXT);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > start + length) to = space;
  }
  // Never half a character: the cut moves outwards, away from the match.
  if (splitsCharacter(text, from)) from -= 1;
  if (splitsCharacter(text, to)) to += 1;
  return { snippet: text.slice(from, to), matchStart: start - from, matchLength: length };
}

/**
 * Finds a query in pages' text: every page whose typed text or PDF text
 * holds the query, compared without case or line breaks. One hit per page
 * and source, in the order given, and at most {@link NOTES_MAX_SEARCH_HITS}.
 */
export function searchPageTexts(entries: Iterable<NotesPageText>, query: string): NotesSearchHit[] {
  const needle = fold(query).trim();
  const hits: NotesSearchHit[] = [];
  if (needle === "") return hits;
  for (const entry of entries) {
    for (const source of ["typed", "pdf"] as const) {
      const raw = entry[source];
      if (!raw) continue;
      const text = fold(raw);
      const start = text.indexOf(needle);
      if (start === -1) continue;
      hits.push({
        notebook: entry.notebook,
        page: entry.page,
        source,
        ...snippetAt(text, start, needle.length),
      });
      if (hits.length >= NOTES_MAX_SEARCH_HITS) return hits;
    }
  }
  return hits;
}
