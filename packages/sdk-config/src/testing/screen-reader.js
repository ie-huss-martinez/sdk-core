/// <reference lib="dom" preserve="true" />
// A virtual screen reader for browser tests, which says what a screen reader
// would say while a test works a component (sdk-core ADR 0065). It's the
// family's one way to assert spoken output: tests compare the phrases
// spoken after each step with the step's expectation.
//
// It listens as a screen reader does, to focus moving, by any means, and to
// live regions changing, so a test drives the component with real keys, such
// as `userEvent` from `vitest/browser`, and reads what was spoken. It isn't a
// real screen reader: its wording follows the ARIA specifications, and a
// change it accepts still needs the manual pass, or the real screen readers'
// workflow, before a release that depends on it.
//
// Test code only: this entry is never imported by published runtime code.
// `@guidepup/virtual-screen-reader` is an optional peer dependency: install it
// where this entry is used.
import { virtual } from "@guidepup/virtual-screen-reader";

/**
 * @typedef {object} ScreenReaderOptions
 * @property {Node} [container] What the screen reader can perceive. Defaults
 *   to `document.body`, so that live regions outside a component are heard.
 * @property {number} [quietMs] How long speech must have stopped before a
 *   step counts as finished, in milliseconds. Defaults to 150: ui's
 *   announcer fills its region one animation frame after a change.
 * @property {number} [timeoutMs] The longest a step may keep speaking, in
 *   milliseconds. Defaults to 3000.
 */

/**
 * @typedef {object} ScreenReader
 * @property {(step?: () => unknown) => Promise<string[]>} spoken Runs `step`,
 *   if given, waits until speech has stopped, and returns the phrases spoken
 *   since the previous call, or since the screen reader started. A live
 *   region that was only emptied says nothing, as with a real screen reader.
 * @property {() => Promise<void>} stop Stops listening. Every test that starts
 *   a screen reader stops it, such as in `afterEach`.
 */

/**
 * A live region emptied, which the library logs as its politeness alone. A
 * screen reader says nothing for it. ui's announcer empties its region before
 * each message, and whether the library sees the two changes apart depends on
 * the browser's frame timing.
 */
const EMPTIED_REGION = /^(?:polite|assertive):\s*$/;

/** Whether a screen reader is listening. The library has one instance. */
let running = false;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the virtual screen reader. Only one can run at a time.
 *
 * @example
 * ```ts
 * import { startScreenReader } from "@hussmartinez/sdk-config/testing/screen-reader";
 * import { userEvent } from "vitest/browser";
 *
 * it("announces a move", async () => {
 *   const reader = await startScreenReader();
 *   onTestFinished(() => reader.stop());
 *   // … render the component and focus a row …
 *   expect(await reader.spoken(() => userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}"))).toEqual([
 *     "polite: Shape moved to position 4 of 4",
 *   ]);
 * });
 * ```
 *
 * @param {ScreenReaderOptions} [options]
 * @returns {Promise<ScreenReader>}
 */
export async function startScreenReader({
  container = document.body,
  quietMs = 150,
  timeoutMs = 3000,
} = {}) {
  if (running) {
    throw new Error(
      "A screen reader is already running. Stop it first, such as with onTestFinished(() => reader.stop()).",
    );
  }
  running = true;
  try {
    await virtual.start({ container });
  } catch (error) {
    running = false;
    throw error;
  }
  // What it says on starting, such as the document's name, belongs to no step.
  let heard = (await virtual.spokenPhraseLog()).length;
  let stopped = false;

  return {
    async spoken(step) {
      if (stopped) {
        throw new Error("This screen reader has stopped.");
      }
      if (step) {
        await step();
      }
      const deadline = Date.now() + timeoutMs;
      // The library returns its own log, which grows in place, so what's
      // compared is a count saved at each look, never the array.
      let count = (await virtual.spokenPhraseLog()).length;
      let quietSince = Date.now();
      for (;;) {
        await sleep(Math.min(25, quietMs));
        const now = (await virtual.spokenPhraseLog()).length;
        if (now !== count) {
          count = now;
          quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
          break;
        }
        if (Date.now() >= deadline) {
          const log = await virtual.spokenPhraseLog();
          throw new Error(
            `Speech didn't stop within ${timeoutMs} ms: ${JSON.stringify(log.slice(heard))}`,
          );
        }
      }
      const log = [...(await virtual.spokenPhraseLog())].slice(heard, count);
      heard = count;
      return log.filter((phrase) => !EMPTIED_REGION.test(phrase));
    },
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      running = false;
      await virtual.stop();
    },
  };
}
