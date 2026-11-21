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
export function fontLaunchEnv(env?: Record<string, string | undefined>): Record<string, string>;
/**
 * Whether browsers launched in this environment get the family's font
 * rules: in the browser test image, where `HM_VISUAL_CONTAINER=1`.
 *
 * @param {Record<string, string | undefined>} [env] The environment,
 *   `process.env` by default.
 * @returns {boolean}
 */
export function usesFontRules(env?: Record<string, string | undefined>): boolean;
/** The variable fontconfig reads its configuration file's path from. */
export const FONT_CONFIG_ENV: "FONTCONFIG_FILE";
/**
 * The family's fontconfig file, as an absolute path: the system's
 * configuration, with Liberation Sans preferred for `system-ui` and
 * `sans-serif`, Liberation Serif for `serif`, and Liberation Mono for
 * `monospace` and `ui-monospace`.
 */
export const FONT_CONFIG_FILE: string;
