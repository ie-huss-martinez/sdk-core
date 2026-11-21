// The fonts browser tests render with (sdk-core ADR 0062). In the pinned
// browser test image, `system-ui` and the generic families resolve to a font
// with one style, so text at weight 600 is drawn like regular text, and a
// lost font weight can't show in a screenshot. A fontconfig file, passed to
// each browser as it launches, prefers the Liberation fonts the image has.
//
// Test code only: this entry is never imported by published runtime code.

import { fileURLToPath } from "node:url";
import { CONTAINER_ENV } from "./require-image.js";

/** The variable fontconfig reads its configuration file's path from. */
export const FONT_CONFIG_ENV = "FONTCONFIG_FILE";

/**
 * The family's fontconfig file, as an absolute path: the system's
 * configuration, with Liberation Sans preferred for `system-ui` and
 * `sans-serif`, Liberation Serif for `serif`, and Liberation Mono for
 * `monospace` and `ui-monospace`.
 */
export const FONT_CONFIG_FILE = fileURLToPath(new URL("./fonts.conf", import.meta.url));

/**
 * The environment to launch a browser with, as Playwright's
 * `launchOptions.env`: the process's own, with the family's font rules added
 * in the browser test image.
 *
 * It's a whole environment, because Playwright replaces a browser's
 * environment with `launchOptions.env` rather than adding to it: one
 * variable alone would take `DISPLAY` and everything else away.
 *
 * Outside the image, where `HM_VISUAL_CONTAINER` isn't `1`, it's the
 * process's environment unchanged, so a browser started on a developer's
 * machine keeps that machine's own fonts, and its own `FONTCONFIG_FILE` if
 * it has one.
 *
 * `defineVisualConfig` and `browserInstances` use it already. Pass it
 * yourself in a configuration that launches browsers its own way.
 *
 * @example
 * ```ts
 * // e2e/playwright.config.ts
 * import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";
 *
 * export default defineConfig({
 *   use: { launchOptions: { env: fontLaunchEnv() } },
 * });
 * ```
 *
 * @param {Record<string, string | undefined>} [env] The environment,
 *   `process.env` by default.
 * @returns {Record<string, string>} A new object, without unset variables.
 */
export function fontLaunchEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const launch = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      launch[name] = value;
    }
  }
  if (usesFontRules(env)) {
    launch[FONT_CONFIG_ENV] = FONT_CONFIG_FILE;
  }
  return launch;
}

/**
 * Whether browsers launched in this environment get the family's font
 * rules: in the browser test image, where `HM_VISUAL_CONTAINER=1`.
 *
 * @param {Record<string, string | undefined>} [env] The environment,
 *   `process.env` by default.
 * @returns {boolean}
 */
export function usesFontRules(env = process.env) {
  return env[CONTAINER_ENV] === "1";
}
