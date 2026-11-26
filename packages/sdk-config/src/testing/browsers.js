// Which browsers the family's browser and end-to-end tests run in (sdk-core
// ADR 0015, ADR 0068): Chromium locally, every engine in CI or when asked,
// and only the engines HM_BROWSERS names when CI sets it, on a draft pull
// request. Vitest and Playwright configurations read the rule here, so it
// has one copy.
//
// Test code only: this entry is never imported by published runtime code.

/** The environment variable that narrows CI's browsers: a comma-separated list, such as `chromium`. */
export const BROWSERS_ENV = "HM_BROWSERS";

/**
 * @typedef {"chromium" | "firefox" | "webkit"} BrowserName
 */

/**
 * Every engine the family tests on, in the order suites list them.
 *
 * @type {readonly BrowserName[]}
 */
export const ALL_BROWSERS = Object.freeze(/** @type {const} */ (["chromium", "firefox", "webkit"]));

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
export function testBrowsers({ all = false, env = process.env } = {}) {
  if (all) {
    return ALL_BROWSERS;
  }
  const listed = (env[BROWSERS_ENV] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (listed.length > 0) {
    const unknown = listed.filter(
      (name) => !ALL_BROWSERS.includes(/** @type {BrowserName} */ (name)),
    );
    if (unknown.length > 0) {
      throw new Error(
        `${BROWSERS_ENV} names ${unknown.join(", ")}, which isn't one of ${ALL_BROWSERS.join(", ")}.`,
      );
    }
    return ALL_BROWSERS.filter((name) => listed.includes(name));
  }
  return env["CI"] ? ALL_BROWSERS : Object.freeze(/** @type {BrowserName[]} */ (["chromium"]));
}
