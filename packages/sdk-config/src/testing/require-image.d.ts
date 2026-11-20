/**
 * Says why browser tests can't run in this environment, if they can't. They
 * can in the browser test image, where `HM_VISUAL_CONTAINER=1`; in CI, where
 * `CI` is set to anything but an empty string, `0` or `false`; and on a
 * host that asks for it with `HM_ALLOW_HOST_BROWSER=1`, for debugging.
 *
 * @param {Record<string, string | undefined>} [env] The environment,
 *   `process.env` by default.
 * @returns {string | undefined} The message to show, or `undefined` when
 *   browser tests can run.
 */
export function browserTestImageProblem(env?: Record<string, string | undefined>): string | undefined;
/**
 * The global setup, for Vitest's browser projects and for Playwright's
 * end-to-end configurations. List it by its package path; nothing is
 * imported into the configuration.
 *
 * @example
 * ```ts
 * // vitest.config.ts: in the browser project only.
 * { test: { name: "browser", globalSetup: ["@hussmartinez/sdk-config/testing/require-image"], browser: { … } } }
 *
 * // e2e/playwright.config.ts
 * export default defineConfig({ globalSetup: "@hussmartinez/sdk-config/testing/require-image", … });
 * ```
 *
 * @returns {void}
 * @throws `Error` outside the browser test image and CI, with what to run
 *   instead and no stack trace, unless `HM_ALLOW_HOST_BROWSER=1`, which
 *   prints a notice instead.
 */
export default function requireBrowserTestImage(): void;
/** The environment variable the browser test image sets, locally through hm-in-image and in CI's verify job. */
export const CONTAINER_ENV: "HM_VISUAL_CONTAINER";
/**
 * The environment variable that lets browser tests start on a host: set it
 * to `1` to debug with a headed browser there. Never for gating: a run on a
 * host can fail at random, so it proves nothing about a change.
 */
export const ALLOW_HOST_ENV: "HM_ALLOW_HOST_BROWSER";
