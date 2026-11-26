import AxeBuilder from "@axe-core/playwright";
import { reportPdf } from "../../test/fixtures/pdfs.js";
import { expect, expectAnnounced, openPdf, test, watch } from "./helpers.js";

const url = "http://localhost:4321/";
const origin = new URL(url).origin;

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
      'aria-label="PDF editor"',
      'data-hm-status="empty"',
      // ui's frame, with the top bar's tools and the tools panel (docs/adr/0012).
      'class="hm-editor-frame',
      'role="toolbar"',
      'aria-label="PDF tools"',
      'data-tool="pdf.open"',
      'data-hm-tool-id="pdf.rotate-left"',
      'aria-keyshortcuts="Control+Z"',
      "Choose a PDF",
      'aria-live="polite"',
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  test("hydrates without a warning, opens a PDF and edits it from the keyboard", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await page.goto(url);
    await expect(page.locator("[data-hydrated]")).toBeAttached();

    // The top bar's tools and the tools panel are a tab stop each.
    await expect(page.locator('header [role="toolbar"] [tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('nav [role="toolbar"] [tabindex="0"]')).toHaveCount(1);

    await openPdf(page, await reportPdf(), "report.pdf");
    await expect(page.getByRole("listbox", { name: "Pages" }).getByRole("option")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Document" })).toBeFocused();

    // A shortcut rotates the current page, and says so.
    await page.keyboard.press("]");
    await expectAnnounced(page, "Rotated 1 page.");
    // The top bar's Undo, not the toast's.
    await expect(page.locator("header").getByRole("button", { name: "Undo" })).toBeEnabled();

    expect(problems.errors).toEqual([]);
    expect(problems.console).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("passes axe with no document, and with one open", async ({ page }) => {
    await page.goto(url);
    await expect(page.locator("[data-hydrated]")).toBeAttached();
    const empty = await new AxeBuilder({ page }).include(".hm-pdf-editor").analyze();
    expect(empty.violations).toEqual([]);

    await openPdf(page, await reportPdf(), "report.pdf");
    const ready = await new AxeBuilder({ page }).include(".hm-pdf-editor").analyze();
    expect(ready.violations).toEqual([]);
  });
});
