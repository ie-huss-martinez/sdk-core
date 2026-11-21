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
export const unitTimeouts: Readonly<{
    testTimeout: number;
    hookTimeout: number;
}>;
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
export const browserTimeouts: Readonly<{
    testTimeout: number;
    hookTimeout: number;
}>;
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
export const endToEndTimeouts: Readonly<{
    timeout: number;
    expect: Readonly<{
        timeout: number;
    }>;
}>;
