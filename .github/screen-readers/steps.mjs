// The parts of the screen-reader runs that don't need a screen reader: how a
// step waits for speech to stop, and how what was said is checked. Tested by
// the repository's test/screen-readers.test.js.

/**
 * @typedef {object} Step
 * @property {string} does What a person does, in the manual pass's words.
 * @property {string[]} keys The keys to press, in guidepup's names, such as
 *   "Tab" or "Alt+ArrowDown".
 * @property {string[]} expect Fragments that must be in what's said: a
 *   control's name and role, a toggle's state, an announcement.
 */

/**
 * @typedef {object} Script
 * @property {string} name
 * @property {"catalogue" | "learn"} site Which built site the page is on.
 * @property {string} path The page, from the site's root.
 * @property {Step[]} steps
 */

/**
 * Text as fragments are compared: lowercase, with punctuation and runs of
 * spaces as one space, so "Mute, toggle button, not pressed" contains
 * "toggle button not pressed".
 *
 * @param {string} text
 */
export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\s,.;:!?()"'“”‘’[\]{}]+/gu, " ")
    .trim();
}

/**
 * The fragments that aren't in what was said.
 *
 * @param {string[]} said The phrases spoken during the step.
 * @param {string[]} fragments
 * @returns {string[]}
 */
export function missingFragments(said, fragments) {
  const heard = normalize(said.join(" "));
  return fragments.filter((fragment) => !heard.includes(normalize(fragment)));
}

/**
 * Waits until a screen reader has stopped speaking: its phrase count hasn't
 * changed for `quietMs`. The count is read afresh each time, never kept as
 * an array, since a reader's log may grow in place (as #198 found).
 *
 * @param {() => Promise<number>} count How many phrases have been spoken.
 * @param {{ quietMs?: number, pollMs?: number, timeoutMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ count: number, settled: boolean }>} The count when it
 *   stopped, and false if speech hadn't stopped by `timeoutMs`.
 */
export async function waitForQuiet(count, options = {}) {
  const {
    quietMs = 1500,
    pollMs = 250,
    timeoutMs = 15_000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const deadline = now() + timeoutMs;
  let last = await count();
  let quietSince = now();
  for (;;) {
    await sleep(pollMs);
    const current = await count();
    if (current !== last) {
      last = current;
      quietSince = now();
    } else if (now() - quietSince >= quietMs) {
      return { count: last, settled: true };
    }
    if (now() >= deadline) {
      return { count: last, settled: false };
    }
  }
}
