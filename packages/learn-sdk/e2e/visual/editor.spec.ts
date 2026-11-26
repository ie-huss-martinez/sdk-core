import { applyVisualVariant, variantsFor } from "@hussmartinez/sdk-config/testing/visual";
import { expect, type Page, test } from "@playwright/test";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048, ADR 0068;
 * ADR 0008 in the package), on the built Vite example with its Thai content.
 * The frame's main states are captured in every variant; each block's state
 * in light-comfortable only.
 *
 * | State | What it shows |
 * |---|---|
 * | `open` | The content open: the outline, the tools, the first exercise (multiple choice) |
 * | `empty` | Nothing to edit, in Advanced: the outline's empty text and the tools |
 * | `easy-start` | Nothing to edit, in Easy: a start card per exercise type |
 * | `settings` | The settings sheet over the editor |
 * | `phone` | A phone's width: the tools in the tab bar, the outline under the stage |
 * | `gap-fill` | A gap-fill exercise's block |
 * | `word-order` | A word-order exercise's block, with another right order |
 * | `problems` | A new exercise, its empty fields marked, and the outline's count |
 *
 * Nothing is masked: the editor shows no time. No toast is on screen in any
 * state: every state is reached without a structural edit, or waits for the
 * toast to go. Focus is moved off the editor before each screenshot.
 */

const NOW = new Date("2026-11-26T12:00:00Z");
const ORIGIN = "http://localhost:4340";

const row = (page: Page, name: string) =>
  page.getByRole("gridcell", { name: new RegExp(`^${name},`) });

const STATES: Readonly<
  Record<string, { readonly path: string; readonly reach: (page: Page) => Promise<void> }>
> = {
  open: {
    path: "/editor.html",
    reach: async (page) => {
      await expect(page.getByRole("heading", { name: "Food words" })).toBeVisible();
    },
  },
  empty: {
    path: "/editor.html?empty",
    reach: async (page) => {
      await expect(page.getByText("No exercises yet.").first()).toBeVisible();
    },
  },
  "easy-start": {
    path: "/editor.html?empty",
    reach: async (page) => {
      await page.getByRole("radio", { name: "Easy" }).click();
      await expect(page.getByRole("button", { name: /^Put words in order/ })).toBeVisible();
      // The mode's toast goes before the screenshot.
      await page.clock.runFor(15_000);
      await expect(page.locator(".hm-toast")).toHaveCount(0);
    },
  },
  settings: {
    path: "/editor.html",
    reach: async (page) => {
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  phone: {
    path: "/editor.html",
    reach: async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".hm-editor-frame-tab-bar")).toBeVisible();
    },
  },
  "gap-fill": {
    path: "/editor.html",
    reach: async (page) => {
      await row(page, "At the market").click();
      await expect(page.getByRole("heading", { name: "At the market" })).toBeVisible();
    },
  },
  "word-order": {
    path: "/editor.html",
    reach: async (page) => {
      await row(page, "First sentences").click();
      await page.getByRole("button", { name: "Accept another order" }).click();
      await expect(page.getByRole("grid", { name: "Order 1" })).toBeVisible();
    },
  },
  problems: {
    path: "/editor.html?empty",
    reach: async (page) => {
      await page.getByRole("button", { name: "Add multiple choice" }).click();
      await expect(page.getByText("3 problems").first()).toBeVisible();
      // The "Exercise added" toast goes before the screenshot: the clock is
      // fixed, so it's run past the toast's time.
      await page.clock.runFor(15_000);
      await expect(page.locator(".hm-toast")).toHaveCount(0);
    },
  },
};

const FULL = ["open", "empty", "easy-start", "settings", "phone"];

for (const [state, { path, reach }] of Object.entries(STATES)) {
  for (const variant of variantsFor(state, { full: FULL })) {
    test(`editor ${state}, ${variant.name}`, async ({ page }) => {
      // No request may leave the page's origin (sdk-core ADR 0012).
      const foreign: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (!["http:", "https:"].includes(url.protocol)) return;
        if (url.origin !== ORIGIN) foreign.push(request.url());
      });
      await page.clock.install({ time: NOW });
      await page.goto(path);
      await applyVisualVariant(page, variant);
      await reach(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`editor-${state}-${variant.name}.png`);
      expect(foreign).toEqual([]);
    });
  }
}
