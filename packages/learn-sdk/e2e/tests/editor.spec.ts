import { targets } from "../targets.js";
import { hydrated, noViolations, watch } from "./checks.js";
import { expect, type Page, test } from "./test.js";

/**
 * The editor on each built example (ADR 0008): rendered on the server where
 * the framework does, under a strict Content Security Policy, an exercise
 * written with the keyboard alone and saved through the handle, with no
 * violation, no error, no axe finding and no request to another origin.
 */

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test.describe("the Next.js example's editor on the server", () => {
  test("renders the outline and the first exercise on the server", async ({ request }) => {
    const response = await request.get("http://localhost:4341/editor");
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('aria-label="Exercise editor"');
    expect(html).toContain("Food words");
  });
});

for (const target of targets) {
  test.describe(target.name, () => {
    test("writes a multiple-choice exercise with the keyboard alone, and saves it", async ({
      page,
    }) => {
      const problems = watch(page, new URL(target.url).origin);
      await page.goto(new URL(target.editor, target.url).href);
      await hydrated(page, ".hm-learn-editor");
      await noViolations(page, ".hm-learn-editor");

      await page.getByRole("button", { name: "Add multiple choice" }).focus();
      await page.keyboard.press("Enter");
      await expect(field(page, "Title")).toBeFocused();
      await page.keyboard.type("Hot and cold");
      await field(page, "Question").focus();
      await page.keyboard.type("ร้อน");
      await field(page, "Choice 1").focus();
      await page.keyboard.type("hot");
      await field(page, "Choice 2").focus();
      await page.keyboard.type("cold");
      await page.keyboard.press("Tab");
      await noViolations(page, ".hm-learn-editor");

      await page.getByRole("button", { name: "Save" }).click();
      const saved = JSON.parse((await page.locator("output").textContent()) ?? "{}");
      // A new exercise goes after the selected one, here the first.
      expect(saved.exercises[1]).toMatchObject({
        type: "multiple-choice",
        title: "Hot and cold",
        payload: { questions: [{ prompt: "ร้อน", choices: ["hot", "cold"], correct: 0 }] },
      });
      expect(problems).toEqual({ console: [], errors: [], foreignRequests: [] });
    });
  });
}
