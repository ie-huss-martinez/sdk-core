import {
  defaultLanguageProfile,
  type LanguageProfile,
  normalizeForGrading,
} from "../model/language-profile.js";

/**
 * The largest distance {@link matchTolerantly} accepts unless told
 * otherwise: one slip in four letters, so words of up to three letters must
 * be exact.
 *
 * @public
 */
export const DEFAULT_MATCH_DISTANCE = 0.25;

/**
 * The Levenshtein distance between two texts, in code points: how many
 * letters must be added, removed or replaced to turn one into the other.
 * Deterministic, with no `Intl`.
 *
 * @example
 * ```ts
 * editDistance("gato", "gata"); // 1
 * ```
 *
 * @public
 */
export function editDistance(a: string, b: string): number {
  const from = Array.from(a);
  const to = Array.from(b);
  if (from.length === 0 || to.length === 0) {
    return from.length + to.length;
  }
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let row = 1; row <= from.length; row++) {
    const current = [row];
    for (let column = 1; column <= to.length; column++) {
      current[column] = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        (previous[column - 1] as number) + (from[row - 1] === to[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[to.length] as number;
}

/**
 * Options for {@link matchTolerantly}.
 *
 * @public
 */
export interface TolerantMatchOptions {
  /**
   * The language's profile. Its `normalizeAnswer` prepares both sides, and
   * its `articles` and `stem`, when it has them, forgive an article or a
   * plural. {@link defaultLanguageProfile} otherwise.
   */
  readonly profile?: LanguageProfile;
  /**
   * The largest accepted distance, as a share of the longer text's length,
   * from 0, exact, to 1. Defaults to {@link DEFAULT_MATCH_DISTANCE}.
   */
  readonly maxDistance?: number;
  /**
   * Other answers the learner could have meant, such as the other choices
   * on screen. An answer that's closer to one of them than to an accepted
   * answer isn't a match: "cat" doesn't pass for "car".
   */
  readonly others?: readonly string[];
}

/**
 * What {@link matchTolerantly} found.
 *
 * @public
 */
export interface TolerantMatch {
  readonly match: boolean;
  /**
   * How far the answer is from the closest accepted answer, from 0,
   * identical, to 1, nothing in common. Past `maxDistance` it's a lower
   * bound: runs of words too long or too short to match aren't compared,
   * and count as far apart as their lengths alone make them.
   */
  readonly distance: number;
}

/** A text as the words a match compares: normalised, without articles, stemmed. */
function words(text: string, profile: LanguageProfile): string[] {
  const articles = profile.articles ?? [];
  return normalizeForGrading(text, profile)
    .split(/\s+/)
    .filter((word) => word !== "" && !articles.includes(word))
    .map((word) => {
      const stem: unknown = profile.stem ? profile.stem(word) : word;
      if (typeof stem !== "string") {
        throw new TypeError("A language profile's stem must return a string.");
      }
      return stem;
    })
    .filter((word) => word !== "");
}

/**
 * The smallest distance between `target` and any run of `given`'s words,
 * of one word fewer to one more than the target has, with spaces ignored.
 * A run whose length alone puts it past `limit` is never compared, which
 * keeps a long answer from costing more than its length: it counts as far
 * as its length says, the least it can be.
 */
function closest(given: readonly string[], target: readonly string[], limit: number): number {
  if (given.length === 0 || target.length === 0) {
    return 1;
  }
  const wanted = Array.from(target.join(""));
  let best = 1;
  for (let size = Math.max(1, target.length - 1); size <= target.length + 1; size++) {
    for (let start = 0; start + size <= given.length; start++) {
      const run = given.slice(start, start + size).join("");
      const length = Array.from(run).length;
      const longer = Math.max(length, wanted.length);
      // Two texts are at least as far apart as their lengths are.
      const atLeast = Math.abs(length - wanted.length) / longer;
      if (atLeast > Math.min(best, limit)) {
        best = Math.min(best, atLeast);
        continue;
      }
      best = Math.min(best, editDistance(run, wanted.join("")) / longer);
    }
  }
  return best;
}

/**
 * Compares an answer with the accepted ones forgivingly, for answers that
 * are spoken, or typed by someone who finds typing hard. It's never what
 * the exercise types do unless a host asks for it (ADR 0010).
 *
 * An answer matches when one of the accepted answers is found in it within
 * `maxDistance`:
 *
 * - **wrapped in a sentence:** "I think it's an apple" matches "apple",
 *   because every run of its words is tried;
 * - **with an article or as a plural,** when the profile has `articles` and
 *   `stem`: "the apples" matches "apple";
 * - **with a slip:** "aple" matches "apple", one letter in five.
 *
 * It's deterministic, with no `Intl`: the same answer matches on a server
 * and on every device.
 *
 * @example
 * ```ts
 * matchTolerantly("creo que es una manzana", ["manzana"], { profile: spanishProfile });
 * // { match: true, distance: 0 }
 * matchTolerantly("cat", ["cart"], { others: ["cat"] });
 * // { match: false, distance: 0.25 }: "cat" itself was on offer
 * ```
 *
 * @param given - What the learner typed or said. Several, for a speech
 *   recogniser's alternatives: the best of them counts.
 * @param accepted - The answers that are right.
 * @param options - The profile, the distance and the rival answers.
 * @throws `TypeError` if `maxDistance` isn't a number from 0 to 1.
 * @public
 */
export function matchTolerantly(
  given: string | readonly string[],
  accepted: readonly string[],
  options: TolerantMatchOptions = {},
): TolerantMatch {
  const { profile = defaultLanguageProfile, maxDistance = DEFAULT_MATCH_DISTANCE } = options;
  if (typeof maxDistance !== "number" || !(maxDistance >= 0 && maxDistance <= 1)) {
    throw new TypeError("maxDistance is a number from 0 to 1.");
  }
  const heard = (typeof given === "string" ? [given] : given).map((text) => words(text, profile));
  const best = (targets: readonly string[], limit: number): number => {
    let distance = 1;
    for (const target of targets.map((text) => words(text, profile))) {
      for (const text of heard) {
        distance = Math.min(distance, closest(text, target, limit));
      }
    }
    return distance;
  };
  const distance = best(accepted, maxDistance);
  // A rival only matters when it's strictly closer than the answer found.
  const rival = distance <= maxDistance ? best(options.others ?? [], distance) : 1;
  return { match: distance <= maxDistance && !(rival < distance), distance };
}
