/**
 * Removes `ariaLabelledByElements` from the page's elements, in Firefox. It
 * does nothing in another browser, or where the property isn't there, and
 * calling it again does nothing more.
 *
 * It runs in the page, so it uses nothing from outside itself: Playwright
 * sends it there as text.
 *
 * @returns {void}
 */
export function removeLabelledByElements(): void;
/**
 * Returns Playwright's `test` with the guard: in Firefox, every page removes
 * `ariaLabelledByElements` before any of its scripts run. Give it the
 * repository's own `test`, so its other fixtures stay.
 *
 * @example
 * ```ts
 * // e2e/fixtures.ts
 * import { test as base } from "@playwright/test";
 * import { withFirefoxLabelledByGuard } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";
 *
 * export const test = withFirefoxLabelledByGuard(base);
 * export { expect } from "@playwright/test";
 * ```
 *
 * @template {{ extend(fixtures: any): any }} Test
 * @param {Test} test Playwright's `test`, or one extended from it.
 * @returns {Test} A `test` of the same type: the guard changes the `page`
 *   fixture, and adds none.
 */
export function withFirefoxLabelledByGuard<Test extends {
    extend(fixtures: any): any;
}>(test: Test): Test;
/**
 * The Firefox that crashes, as Playwright names its build and version in
 * `playwright-core/browsers.json`. A test in this package fails when the
 * pinned Playwright brings another, so the guard is looked at again rather
 * than kept for ever.
 */
export const CRASHING_FIREFOX: Readonly<{
    revision: "1572";
    browserVersion: "159.0";
}>;
