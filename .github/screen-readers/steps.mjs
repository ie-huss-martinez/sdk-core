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
 * @property {KnownFailure[]} [reportOnly] Where the runner, not a
 *   component, keeps the step from being judged on a pairing, with the
 *   runner's issue: the step is reported there and never fails the run. A
 *   component's bug is a known failure instead, which must keep failing.
 * @property {string[]} [only] The pairings the step runs on, for a key one
 *   screen reader needs and another doesn't, such as NVDA's first Tab
 *   going past the page's first control. Without it, the step runs on all.
 */

/**
 * A step that fails today for a known bug, with the pairings it fails on. It's
 * a strict expected failure: when the step passes there, the run fails too,
 * so the fix removes this marker and can't go unnoticed.
 *
 * @typedef {object} KnownFailure
 * @property {string[]} on Pairings, such as "nvda-chrome".
 * @property {string} issue The issue's URL.
 * @property {string[]} [fragments] The step's fragments that the bug keeps
 *   from being said, as the step's `expect` writes them. Any other fragment
 *   missing still fails the step. Without it, the bug covers the whole step.
 */

/**
 * What a step's result means for a pairing.
 *
 * @param {Step} step
 * @param {string[]} missing Its fragments that weren't said.
 * @param {string} pairing Such as "nvda-firefox".
 * @returns {{ outcome: "pass" | "fail" | "expected failure" | "unexpected pass" | "reported", issue?: string }}
 */
export function outcome(step, missing, pairing) {
  const runner = step.reportOnly?.find((entry) => entry.on.includes(pairing));
  if (runner) {
    return missing.length > 0 ? { outcome: "reported", issue: runner.issue } : { outcome: "pass" };
  }
  const known = step.knownFailures?.find((failure) => failure.on.includes(pairing));
  if (known) {
    const covered = (fragment) => !known.fragments || known.fragments.includes(fragment);
    if (missing.some((fragment) => !covered(fragment))) {
      return { outcome: "fail" };
    }
    return missing.length > 0
      ? { outcome: "expected failure", issue: known.issue }
      : { outcome: "unexpected pass", issue: known.issue };
  }
  return { outcome: missing.length > 0 ? "fail" : "pass" };
}

/**
 * The steps of a script that run on a pairing.
 *
 * @param {Script} script
 * @param {string} pairing Such as "nvda-firefox".
 * @returns {Step[]}
 */
export function stepsFor(script, pairing) {
  return script.steps.filter((step) => !step.only || step.only.includes(pairing));
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
 * Whether a fragment was said as itself: as whole words, and, for a state
 * such as "pressed" or "selected", not as part of its opposite, "not pressed".
 *
 * @param {string} heard Normalized speech.
 * @param {string} fragment
 */
function wasSaid(heard, fragment) {
  const words = normalize(fragment).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const negated = words.startsWith("not ") ? "" : "(?<!\\bnot )";
  return new RegExp(
    `${negated}(?<![\\p{L}\\p{M}\\p{N}])${words}(?![\\p{L}\\p{M}\\p{N}])`,
    "u",
  ).test(heard);
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
    .filter((options) => !options.some((option) => wasSaid(heard, option)))
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
