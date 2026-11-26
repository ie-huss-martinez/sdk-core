import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import { FIRST_OPEN, openByKeyboard, watch } from "./helpers.js";

const origin = "http://localhost:4310";

/**
 * axe's findings in the editor, dialogs and toasts included: they're inside
 * its root. Taken once every transition has ended, such as a sheet's fade
 * in, so axe reads the colours that stay, not a frame of the way there.
 */
async function violations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  const result = await new AxeBuilder({ page }).include(".hm-audio-editor").analyze();
  return result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes
        .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`)
        .join("; ")})`,
  );
}

/**
 * The editor on ui's frame in the built Vite example (docs/adr/0007,
 * sdk-core ADR 0067): an app's preferences kept by the page, and each of
 * the frame's states passing axe.
 */
test.describe("the editor's frame", () => {
  test("opens an app's first visit in Easy mode, and the page keeps the preferences", async ({
    page,
    context,
  }) => {
    const problems = watch(page, origin);
    await page.goto(`${origin}/editor.html?app`);
    await openByKeyboard(page, 2);
    await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible({
      timeout: FIRST_OPEN,
    });
    await expect(page.getByRole("button", { name: /^Cut the start or end/ })).toBeFocused();
    await page.getByRole("radio", { name: "Expert" }).click();
    await expect(page.getByRole("button", { name: "Commands" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("radio", { name: "Expert" })).toBeChecked();
    // Kept by the page, in localStorage, and never in a cookie.
    const stored = await page.evaluate(() => localStorage.getItem("editor-prefs:audio-example"));
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ mode: "expert" });
    expect(await context.cookies()).toEqual([]);
    expect(problems.errors).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("passes axe with the start cards, the settings, the command palette and a phone's sheet", async ({
    page,
  }) => {
    await page.goto(`${origin}/editor.html?mode=easy`);
    await openByKeyboard(page, 2);
    await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible({
      timeout: FIRST_OPEN,
    });
    expect(await violations(page)).toEqual([]);

    await page.getByRole("button", { name: "Just show me the editor" }).click();
    await expect(page.getByRole("slider", { name: "Playhead" })).toBeFocused();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("combobox", { name: "Search tools" })).toBeFocused();
    await page.keyboard.type("Add track");
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(page.locator(".hm-toast-message").getByText("Track added.")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 800 });
    await page
      .getByRole("toolbar", { name: "Tools" })
      .getByRole("button", { name: "Fade" })
      .click();
    await expect(page.getByRole("dialog", { name: "Fade" })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
