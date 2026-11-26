import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../test.js";
import {
  inkAt,
  isInk,
  line,
  newNotebook,
  openEditor,
  PAGE,
  pen,
  saved,
  settled,
  watch,
} from "./helpers.js";

const url = "http://localhost:4351/";
const origin = new URL(url).origin;

// Tall enough to show a whole page under the top bar, so a test can write
// anywhere on it, and wide enough for ui's frame to lay out as on a desktop,
// with the tool's options beside the pages (docs/adr/0008).
test.use({ viewport: { width: 1100, height: 1500 } });

/**
 * The editor in a Next.js App Router application (ADR 0007 in sdk-core): a
 * Server Component imports the server-safe entry and renders the editor from
 * the client entry, which hydrates without a warning, works, passes axe and
 * never reaches another origin.
 */
test.describe("Next.js App Router", () => {
  test("renders the editor on the server", async ({ request }) => {
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    for (const marker of [
      // The server-safe entry ran in the Server Component.
      '<span data-testid="max-pages">5,000</span>',
      'aria-label="Notes"',
      'data-hm-view="library"',
      // The library hasn't been read yet: storage only exists in the browser.
      "Opening your notebooks",
      'aria-live="polite"',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  test("hydrates without a warning, then writes and saves", async ({ page }) => {
    const problems = watch(page, origin);
    // This example has no library in memory: without storage, it shows why it can't keep notes.
    const kept = await openEditor(page, url, { memory: false });
    await expect(page.locator("[data-hydrated]")).toBeAttached();
    if (kept) {
      await expect(page.getByText("No notebooks yet")).toBeVisible();
      await newNotebook(page);
      await pen(page, PAGE, line([0.2, 0.3], [0.7, 0.3]));
      await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.3))).toBe(true);
      await saved(page);
    }

    expect(problems.errors).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("passes axe in the library and in an open notebook", async ({ page }) => {
    const kept = await openEditor(page, url, { memory: false });
    await expect(page.locator("[data-hydrated]")).toBeAttached();
    // The library, or the reason there's none: both are designed states.
    await settled(page);
    const library = await new AxeBuilder({ page }).include(".hm-notes-editor").analyze();
    expect(library.violations).toEqual([]);
    if (!kept) return;

    await newNotebook(page);
    await settled(page);
    const notebook = await new AxeBuilder({ page }).include(".hm-notes-editor").analyze();
    expect(notebook.violations).toEqual([]);
  });
});
