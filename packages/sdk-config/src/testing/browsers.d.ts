/**
 * Returns the browsers a suite runs in:
 *
 * - **`all`:** every engine, as `--mode all-browsers` or a capability table's
 *   update asks for. Nothing narrows an explicit request.
 * - **`HM_BROWSERS` set:** the engines it names. CI sets `HM_BROWSERS=chromium`
 *   on a draft pull request, and its required check fails on such a run, so
 *   it can't stand in for the full one (ADR 0068).
 * - **`CI` set:** every engine.
 * - **Otherwise:** Chromium.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * export default defineConfig(({ mode }) => {
 *   const browsers = testBrowsers({ all: mode === "all-browsers" });
 *   // …
 * });
 * ```
 *
 * @param {{ all?: boolean, env?: Record<string, string | undefined> }} [options]
 *   Whether every engine was asked for, and the environment to read `CI` and
 *   `HM_BROWSERS` from, `process.env` by default.
 * @returns {readonly BrowserName[]} The engines, in {@link ALL_BROWSERS}' order.
 * @throws `Error` when `HM_BROWSERS` names an engine the family doesn't test
 *   on, so a typo can't leave a suite with nothing to run.
 */
export function testBrowsers({ all, env }?: {
    all?: boolean;
    env?: Record<string, string | undefined>;
}): readonly BrowserName[];
/** The environment variable that narrows CI's browsers: a comma-separated list, such as `chromium`. */
export const BROWSERS_ENV: "HM_BROWSERS";
/**
 * @typedef {"chromium" | "firefox" | "webkit"} BrowserName
 */
/**
 * Every engine the family tests on, in the order suites list them.
 *
 * @type {readonly BrowserName[]}
 */
export const ALL_BROWSERS: readonly BrowserName[];
export type BrowserName = "chromium" | "firefox" | "webkit";
