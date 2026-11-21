// Browser instances for Vitest's browser mode, with opt-in diagnostics for
// failures that leave no message (video-sdk#55): an iframe that "did not
// become ready", or a module worker that "failed to load". Chromium's error
// events for a module that failed to load carry no reason, so with
// HM_BROWSER_DIAGNOSTICS set, Chromium records every request and its network
// error in a net log, and writes its console to stderr, which Playwright
// prints with DEBUG=pw:browser. hm-netlog-errors lists the failed requests.
//
// Test code only: this entry is never imported by published runtime code.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { fontLaunchEnv, usesFontRules } from "./fonts.js";

/** The environment variable that turns the diagnostics on: the folder they're written to. */
export const DIAGNOSTICS_ENV = "HM_BROWSER_DIAGNOSTICS";

/**
 * @typedef {"chromium" | "firefox" | "webkit"} BrowserName
 */

/**
 * Chromium's flags for the diagnostics: its console on stderr, and a net log
 * of every request in the folder, one file per test process. Firefox and
 * WebKit refuse to launch with them.
 *
 * @param {string} dir The folder.
 * @returns {string[]}
 */
export function chromiumDiagnosticArgs(dir) {
  return [
    "--enable-logging=stderr",
    "--v=0",
    `--log-net-log=${join(resolve(dir), `chromium-${process.pid}.netlog.json`)}`,
  ];
}

/**
 * Returns Vitest's `browser.instances` for these browsers, all with
 * `@vitest/browser-playwright`.
 *
 * - **In the browser test image,** every browser launches with the family's
 *   font rules (ADR 0062), so text is drawn as in screenshots.
 * - **With `HM_BROWSER_DIAGNOSTICS` set to a folder,** Chromium writes a net
 *   log there and its console to stderr. Firefox and WebKit never get those
 *   flags.
 * - **Otherwise they're the plain instances,** so nothing changes.
 *
 * Replace `instances: browsers.map((browser) => ({ browser }))` with it, and
 * keep `provider: playwright()`.
 *
 * @example
 * ```ts
 * import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";
 *
 * browser: {
 *   enabled: true,
 *   headless: true,
 *   provider: playwright(),
 *   instances: browserInstances(browsers),
 * },
 * ```
 *
 * @param {readonly BrowserName[]} browsers The browsers to run.
 * @param {{ env?: Record<string, string | undefined> }} [options] The
 *   environment to read `HM_BROWSER_DIAGNOSTICS` and `HM_VISUAL_CONTAINER`
 *   from, and to launch the browsers with, `process.env` by default.
 * @returns {Array<{ browser: BrowserName, provider: ReturnType<typeof playwright> }>}
 */
export function browserInstances(browsers, { env = process.env } = {}) {
  // Outside the image, no environment is set, so the browser inherits the process's.
  const fonts = usesFontRules(env) ? { env: fontLaunchEnv(env) } : undefined;
  const plain = fonts ? playwright({ launchOptions: fonts }) : playwright();
  const dir = env[DIAGNOSTICS_ENV];
  let chromium = plain;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    chromium = playwright({ launchOptions: { ...fonts, args: chromiumDiagnosticArgs(dir) } });
  }
  return browsers.map((browser) => ({
    browser,
    provider: browser === "chromium" ? chromium : plain,
  }));
}
