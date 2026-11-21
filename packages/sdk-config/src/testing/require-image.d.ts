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
 * The web servers a Playwright configuration lists: the ones given where
 * browser tests can run, and none where the guard will refuse them.
 *
 * Playwright starts its web servers before the global setup. Without this,
 * a run on a host builds and waits for every example's server, and only
 * then hears from the guard, or fails on a server first and never does.
 * With no servers listed, the guard's explanation is the first and only
 * thing shown. In the image, in CI and with `HM_ALLOW_HOST_BROWSER=1`, the
 * list is returned as given.
 *
 * It never throws, so the configuration loads anywhere: refusing is the
 * global setup's job, which is listed beside it.
 *
 * @example
 * ```ts
 * // e2e/playwright.config.ts
 * import { webServersFor } from "@hussmartinez/sdk-config/testing/require-image";
 *
 * export default defineConfig({
 *   globalSetup: "@hussmartinez/sdk-config/testing/require-image",
 *   webServer: webServersFor([
 *     { command: "vite preview --port 4310 --strictPort", url: "http://localhost:4310" },
 *   ]),
 * });
 * ```
 *
 * @template Server
 * @param {Server | readonly Server[] | undefined} servers The
 *   configuration's `webServer`: one server, a list of them, or none.
 * @param {Record<string, string | undefined>} [env] The environment,
 *   `process.env` by default.
 * @returns {Server[]} The servers to list, as a new array.
 */
export function webServersFor<Server>(servers: Server | readonly Server[] | undefined, env?: Record<string, string | undefined>): Server[];
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
 * A Playwright configuration with web servers lists them through
 * {@link webServersFor}, so none starts before this refuses.
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
