// The parts of the screen-reader runs that don't need a screen reader: how a
// step waits for speech to stop, and how what was said is checked. Tested by
// the repository's test/screen-readers.test.js.

/**
 * @typedef {object} Step
 * @property {string} does What a person does, in the manual pass's words.
 * @property {string[]} keys The keys to press, in guidepup's names, such as
 *   "Tab" or "Alt+ArrowDown". "Mod" is Control, or Command on macOS, as for
 *   a shortcut such as Check's Control+Enter, which is ⌘Enter on a Mac.
 * @property {Array<string | string[]>} expect Fragments that must be in
 *   what's said: a control's name and role, a toggle's state, an
 *   announcement. A list is alternatives, any of which will do, such as
 *   ["pressed", "selected"], which screen readers say for the same state.
 * @property {KnownFailure[]} [knownFailures] Where the step is a known bug:
 *   it still asserts, and must fail there until the bug is fixed.
 */

/**
 * A step that fails today for a known bug, with the pairings it fails on. It's
 * a strict expected failure: when the step passes there, the run fails too,
 * so the fix removes this marker and can't go unnoticed.
 *
 * @typedef {object} KnownFailure
 * @property {string[]} on Pairings, such as "nvda-chrome".
 * @property {string} issue The issue's URL.
 */

/**
 * What a step's result means for a pairing.
 *
 * @param {Step} step
 * @param {string[]} missing Its fragments that weren't said.
 * @param {string} pairing Such as "nvda-firefox".
 * @returns {{ outcome: "pass" | "fail" | "expected failure" | "unexpected pass", issue?: string }}
 */
export function outcome(step, missing, pairing) {
  const known = step.knownFailures?.find((failure) => failure.on.includes(pairing));
  if (known) {
    return missing.length > 0
      ? { outcome: "expected failure", issue: known.issue }
      : { outcome: "unexpected pass", issue: known.issue };
  }
  return { outcome: missing.length > 0 ? "fail" : "pass" };
}

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
 * The fragments that aren't in what was said. Alternatives count as said if
 * any one of them is, and are reported joined with " or ".
 *
 * @param {string[]} said The phrases spoken during the step.
 * @param {Array<string | string[]>} fragments
 * @returns {string[]}
 */
export function missingFragments(said, fragments) {
  const heard = normalize(said.join(" "));
  return fragments
    .map((fragment) => (Array.isArray(fragment) ? fragment : [fragment]))
    .filter((options) => !options.some((option) => heard.includes(normalize(option))))
    .map((options) => options.join(" or "));
}

/**
 * A key in guidepup's names for this platform: "Mod" is Command on macOS and
 * Control elsewhere.
 *
 * @param {string} key
 * @param {string} platform `process.platform`.
 */
export function platformKey(key, platform) {
  return key.replace(/\bMod\b/u, platform === "darwin" ? "Command" : "Control");
}

/**
 * Waits until a screen reader has said what a step makes it say, and stopped.
 *
 * Speech can start well after the key: NVDA's log, as guidepup reads it, has
 * been seen to arrive more than 1.5 s later. So the quiet time only starts
 * once something new has been said. A step that says nothing ends after
 * `firstMs`. The count is read afresh each time, never kept as an array,
 * since a reader's log may grow in place (as #198 found).
 *
 * @param {() => Promise<number>} count How many phrases have been spoken.
 * @param {{ since?: number, firstMs?: number, quietMs?: number, pollMs?: number, timeoutMs?: number, now?: () => number, sleep?: (ms: number) => Promise<void> }} [options]
 *   `since` is the count before the step, by default the count on entry.
 * @returns {Promise<{ count: number, settled: boolean }>} The count when it
 *   stopped, and false if speech hadn't stopped by `timeoutMs`.
 */
export async function waitForSpeech(count, options = {}) {
  const {
    firstMs = 5000,
    quietMs = 1500,
    pollMs = 250,
    timeoutMs = 20_000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const start = now();
  const before = options.since ?? (await count());
  let last = before;
  let changedAt;
  for (;;) {
    await sleep(pollMs);
    const current = await count();
    if (current !== last) {
      last = current;
      changedAt = now();
    }
    if (changedAt === undefined && now() - start >= firstMs) {
      return { count: last, settled: true };
    }
    if (changedAt !== undefined && now() - changedAt >= quietMs) {
      return { count: last, settled: true };
    }
    if (now() - start >= timeoutMs) {
      return { count: last, settled: false };
    }
  }
}
