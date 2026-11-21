// A guard against a crash in Playwright's Firefox 159 (ie-huss-martinez/ui#61,
// audio-sdk#76): reading an element's `ariaLabelledByElements` from
// Playwright's isolated world and then from the page's world, or the other
// way round, crashes the page. Playwright's role and label locators read it
// in the isolated world, as does Vitest's `userEvent`, which builds such
// locators; axe-core reads it in the page's world. So a click by accessible
// name and an axe run on the same page crash Firefox, in either order. Two
// lines reproduce it, with no library:
// `<button aria-labelledby="x"></button><span id="x">Undo</span>`.
//
// So in Firefox the property is removed from the page's world before any
// script runs. axe then resolves `aria-labelledby` by ID, as it does in
// browsers without the property, and reports the same results. Playwright's
// world keeps its own copy. Product code never reads the property.
//
// It doesn't cover the Firefox that users have: that's checked by hand.
//
// Test code only: this entry is never imported by published runtime code.

/**
 * The Firefox that crashes, as Playwright names its build and version in
 * `playwright-core/browsers.json`. A test in this package fails when the
 * pinned Playwright brings another, so the guard is looked at again rather
 * than kept for ever.
 */
export const CRASHING_FIREFOX = Object.freeze({ revision: "1572", browserVersion: "159.0" });

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
export function removeLabelledByElements() {
  if (
    typeof navigator === "undefined" ||
    typeof Element === "undefined" ||
    !navigator.userAgent.includes("Firefox/")
  ) {
    return;
  }
  delete (
    /** @type {{ ariaLabelledByElements?: unknown }} */ (Element.prototype).ariaLabelledByElements
  );
}

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
export function withFirefoxLabelledByGuard(test) {
  return test.extend({
    page: async (
      /** @type {{ page: { addInitScript(script: () => void): Promise<unknown> }, browserName: string }} */ {
        page,
        browserName,
      },
      /** @type {(page: unknown) => Promise<void>} */ use,
    ) => {
      if (browserName === "firefox") {
        await page.addInitScript(removeLabelledByElements);
      }
      await use(page);
    },
  });
}
