// A global setup that refuses to start browser tests outside the pinned
// browser test image (sdk-core ADR 0049). On a host, Chromium aborts the dev
// server's requests with ERR_NETWORK_CHANGED whenever Docker adds or removes
// a network interface, so tests fail at random with "did not become ready"
// or "failed to load", which says nothing about the change under test.
//
// It's a global setup, not a check in the configuration, so it runs only
// when a browser project really starts: a configuration that also holds a
// unit project still loads anywhere.
//
// Test code only: this entry is never imported by published runtime code.

/** The environment variable the browser test image sets, locally through hm-in-image and in CI's verify job. */
export const CONTAINER_ENV = "HM_VISUAL_CONTAINER";

/**
 * The environment variable that lets browser tests start on a host: set it
 * to `1` to debug with a headed browser there. Never for gating: a run on a
 * host can fail at random, so it proves nothing about a change.
 */
export const ALLOW_HOST_ENV = "HM_ALLOW_HOST_BROWSER";

/**
 * Whether the environment asks for browser tests on the host, outside the
 * image and CI.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function hostAllowed(env) {
  return env[ALLOW_HOST_ENV] === "1";
}

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
export function browserTestImageProblem(env = process.env) {
  if (inImageOrCi(env) || hostAllowed(env)) {
    return undefined;
  }
  return [
    "Browser tests run only in the pinned browser test image (sdk-core ADR 0049).",
    "On a host, Docker's network changes make Chromium abort requests, and tests fail at random.",
    'Run them through hm-in-image, as the package scripts do: "pnpm test:browser" or "pnpm test:e2e",',
    'or "pnpm exec hm-in-image <command>" for another command.',
    `To debug with a headed browser on this machine, set ${ALLOW_HOST_ENV}=1 for that run. Never use it to check a change.`,
  ].join("\n");
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean} Whether this is the browser test image, or CI.
 */
function inImageOrCi(env) {
  const ci = env["CI"];
  return env[CONTAINER_ENV] === "1" || (ci !== undefined && !["", "0", "false"].includes(ci));
}

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
export default function requireBrowserTestImage() {
  if (!inImageOrCi(process.env) && hostAllowed(process.env)) {
    process.stderr.write(
      `${ALLOW_HOST_ENV}=1: browser tests are running on this machine, outside the pinned browser test image. They can fail at random here, so use this run for debugging only.\n`,
    );
    return;
  }
  const problem = browserTestImageProblem();
  if (problem !== undefined) {
    const error = new Error(problem);
    // The stack would point into this file and the runner, which helps nobody.
    error.stack = `${error.name}: ${problem}`;
    throw error;
  }
}
