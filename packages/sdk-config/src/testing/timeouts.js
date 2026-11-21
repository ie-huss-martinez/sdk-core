// The family's test timeouts (sdk-core ADR 0057): one set of limits for every
// repository, to spread into a Vitest project's `test` options or a
// Playwright configuration, so no repository writes the numbers.
//
// A timeout catches a test that will never finish. It isn't a measure of
// speed: a test that asserts timing uses its own clock or fake timers. So
// these only have to be longer than any honest run, on a busy machine too.
//
// Test code only: this entry is never imported by published runtime code.

/**
 * Limits for unit tests, run by Vitest in Node: 30 s for a test and for a
 * hook. Measured: on a machine with four busy processes per core, unit tests
 * ran up to 9 times slower, and 16 times has been reported; a test that
 * takes 1.5 s on a quiet machine still has room.
 *
 * @example
 * ```ts
 * { test: { name: "unit", include: ["src/**\/*.test.ts"], ...unitTimeouts } }
 * ```
 *
 * @type {Readonly<{ testTimeout: number, hookTimeout: number }>}
 */
export const unitTimeouts = Object.freeze({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Limits for tests in Vitest's browser mode: 60 s for a test and for a hook.
 * From practice, not measured under load: a first test starts workers and
 * decoders, which has taken well over Vitest's 15 s in WebKit on a busy
 * machine. In CI, ordinary browser tests take a few seconds.
 *
 * @example
 * ```ts
 * { test: { name: "browser", browser: { … }, ...browserTimeouts } }
 * ```
 *
 * @type {Readonly<{ testTimeout: number, hookTimeout: number }>}
 */
export const browserTimeouts = Object.freeze({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Limits for end-to-end and visual tests, run by Playwright: 60 s for a
 * test, and 10 s for an assertion that waits, such as `toBeVisible()`. From
 * practice, not measured under load. `defineVisualConfig` already uses them.
 *
 * @example
 * ```ts
 * export default defineConfig({ ...endToEndTimeouts, testDir: "tests", … });
 * ```
 *
 * @type {Readonly<{ timeout: number, expect: Readonly<{ timeout: number }> }>}
 */
export const endToEndTimeouts = Object.freeze({
  timeout: 60_000,
  expect: Object.freeze({ timeout: 10_000 }),
});
