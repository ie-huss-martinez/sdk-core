import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { reportPdf } from "../../test/fixtures/pdfs.js";
import { expectAnnounced, openPdf, watch } from "./helpers.js";

const origin = "http://localhost:4320";

/**
 * axe's findings in the editor, dialogs and toasts included: they're inside
 * its root. Taken once every transition has ended, such as a sheet's fade
 * in, so axe reads the colours that stay, not a frame of the way there.
 */
async function violations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  const result = await new AxeBuilder({ page }).include(".hm-pdf-editor").analyze();
  return result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
        .join("; ")})`,
  );
}

/**
 * The editor on ui's frame in the built Vite example (docs/adr/0012,
 * sdk-core ADR 0067): an app's preferences kept by the page, and each of
 * the frame's states passing axe.
 */
test.describe("the editor's frame", () => {
  test("opens an app's first visit in Easy mode, and the page keeps the preferences", async ({
    page,
    context,
  }) => {
    const problems = watch(page, origin);
    await page.goto(`${origin}/?app`);
    await openPdf(page, await reportPdf(), "report.pdf");
    await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Rotate pages/ })).toBeFocused();
    await page.getByRole("radio", { name: "Expert" }).click();
    await expectAnnounced(page, "Expert mode");

    await page.reload();
    await expect(page.getByRole("radio", { name: "Expert" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Commands" })).toBeVisible();
    // Kept by the page, in localStorage, and never in a cookie.
    const stored = await page.evaluate(() => localStorage.getItem("editor-prefs:pdf-example"));
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ mode: "expert" });
    expect(await context.cookies()).toEqual([]);
    expect(problems.errors).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("passes axe with the start cards, the settings, the command palette and a phone's sheet", async ({
    page,
  }) => {
    await page.goto(`${origin}/?mode=easy`);
    await openPdf(page, await reportPdf(), "report.pdf");
    await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await page.getByRole("button", { name: "Just show me the editor" }).click();
    await expect(page.getByRole("region", { name: "Document" })).toBeFocused();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("combobox", { name: "Search tools" })).toBeFocused();
    await page.keyboard.type("later");
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Enter");
    await expectAnnounced(page, "Moved 1 page to position 2.");

    await page.setViewportSize({ width: 390, height: 800 });
    await page
      .getByRole("toolbar", { name: "PDF tools" })
      .getByRole("button", { name: "Rotate" })
      .click();
    await expect(page.getByRole("dialog", { name: "Rotate" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
