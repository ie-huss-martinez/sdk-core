import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { removeLabelledByElements } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";
import { expect, type Page, test } from "../test.js";
import {
  inkAt,
  isInk,
  line,
  newNotebook,
  openEditor,
  PAGE,
  pdfWith,
  pen,
  saved,
  settled,
  watch,
} from "./helpers.js";

const url = "http://localhost:4350/";
const origin = new URL(url).origin;

// Tall enough to show a whole page under the top bar, so a test can write
// anywhere on it, and wide enough for ui's frame to lay out as on a desktop,
// with the tool's options beside the pages (docs/adr/0008).
test.use({ viewport: { width: 1100, height: 1500 } });

/** Nothing went wrong: no error, no warning, no foreign request, no policy violation. */
async function expectClean(page: Page, problems: ReturnType<typeof watch>): Promise<void> {
  expect(problems.errors).toEqual([]);
  expect(problems.console).toEqual([]);
  expect(problems.foreignRequests).toEqual([]);
  expect(await page.evaluate(() => window.notesSdk.violations)).toEqual([]);
}

/**
 * The built editor in a plain Vite page, under the README's Content Security
 * Policy, keeping its library on the device (ADR 0039 in sdk-core). Each
 * test has a browser profile of its own, so its library starts empty.
 */
test.describe("the notes editor", () => {
  test("writes with a pen, saves on the device, and shows the ink after a reload", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    const kept = await openEditor(page, url);
    await expect(page.getByText("No notebooks yet")).toBeVisible();
    await newNotebook(page, "Physics");
    await expect(page.getByRole("toolbar", { name: "Notebook tools" })).toBeVisible();

    await pen(page, PAGE, line([0.2, 0.3], [0.7, 0.3], { pressure: 0.8 }));
    await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.3))).toBe(true);
    expect(isInk(await inkAt(page, 0.45, 0.6))).toBe(false);
    await saved(page);

    // Where the browser gives the page no storage, there's nothing to come back to.
    if (!kept) return;
    // Nothing was saved by hand: the notebook is simply there again.
    await page.reload();
    await page.getByRole("button", { name: /^Physics/ }).click();
    await expect(page.locator(PAGE).first()).toBeVisible();
    await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.3))).toBe(true);
    await expectClean(page, problems);
  });

  test("erases, undoes and redoes, with the pen's button and from the keyboard", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await openEditor(page, url);
    await newNotebook(page);
    await pen(page, PAGE, line([0.2, 0.3], [0.8, 0.3], { steps: 30 }));
    await expect.poll(async () => isInk(await inkAt(page, 0.5, 0.3))).toBe(true);

    // The barrel button erases the part it passes over, while the pen stays in hand.
    await pen(page, PAGE, line([0.5, 0.25], [0.5, 0.35]), { barrel: true });
    await expect.poll(async () => isInk(await inkAt(page, 0.5, 0.3))).toBe(false);
    expect(isInk(await inkAt(page, 0.3, 0.3))).toBe(true);
    expect(isInk(await inkAt(page, 0.7, 0.3))).toBe(true);
    await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => isInk(await inkAt(page, 0.5, 0.3))).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => isInk(await inkAt(page, 0.3, 0.3))).toBe(false);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => isInk(await inkAt(page, 0.3, 0.3))).toBe(true);
    await expectClean(page, problems);
  });

  test("backs up to a file, and restores it in another browser profile", async ({
    page,
    browser,
  }) => {
    const problems = watch(page, origin);
    await openEditor(page, url);
    await newNotebook(page, "Chemistry");
    await pen(page, PAGE, line([0.2, 0.4], [0.7, 0.4]));
    await saved(page);
    await page.getByRole("button", { name: "Back to the library" }).click();

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Back up", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^notes-backup-\d{4}-\d{2}-\d{2}\.zip$/);
    const backup = await readFile(await download.path());
    // A standard zip, which ordinary tools open.
    expect(backup.subarray(0, 2).toString("latin1")).toBe("PK");
    await expect(page.locator(".hm-notes-notice:not([data-hm-kind])")).toContainText(
      "The backup is ready.",
    );
    await expectClean(page, problems);

    // Another profile: a new device, or this one after its data was cleared.
    const context = await browser.newContext();
    // A context made here isn't covered by the fixture's guard (see ../test.ts).
    await context.addInitScript(removeLabelledByElements);
    const other = await context.newPage();
    const otherProblems = watch(other, origin);
    await openEditor(other, url);
    await expect(other.getByText("No notebooks yet")).toBeVisible();
    await other.locator('input[data-hm-input="backup"]').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/zip",
      buffer: backup,
    });
    await expect(other.locator(".hm-notes-notice:not([data-hm-kind])")).toHaveText(
      "Restored 1 notebook.",
    );
    await other.getByRole("button", { name: /^Chemistry/ }).click();
    await expect(other.locator(PAGE).first()).toBeVisible();
    await expect.poll(async () => isInk(await inkAt(other, 0.45, 0.4))).toBe(true);
    await expectClean(other, otherProblems);
    await context.close();
  });

  test("imports a PDF, writes on it, finds its text, and exports it with the ink", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await openEditor(page, url);
    const source = pdfWith(["Thermodynamics", "Entropy rises"]);
    await page.locator('input[data-hm-input="pdf"]').setInputFiles({
      name: "Lecture notes.pdf",
      mimeType: "application/pdf",
      buffer: source,
    });
    // The imported PDF opens as a notebook named after the file, one page per PDF page.
    await expect(page.getByRole("heading", { name: "Lecture notes" })).toBeVisible();
    await expect(page.locator(".hm-notes-notebook-position")).toHaveText("Page 1 of 2");
    // pdf.js starts its worker and draws the first page under the ink, which
    // can take longer than an assertion waits by default (sdk-core ADR 0057).
    await expect(page.locator(".hm-notes-page-background").first()).not.toHaveAttribute(
      "data-hm-pending",
      "",
      { timeout: 30_000 },
    );

    // The PDF itself has nothing where the stroke will go.
    expect(isInk(await inkAt(page, 0.45, 0.5, "background"))).toBe(false);
    await pen(page, PAGE, line([0.2, 0.5], [0.7, 0.5]));
    await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.5))).toBe(true);
    await saved(page);

    await page.getByRole("button", { name: "Search this notebook" }).click();
    await page.getByRole("searchbox", { name: "Search typed text and PDF text" }).fill("entropy");
    await expect(page.getByRole("button", { name: /Page 2/ })).toContainText("entropy rises");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export as PDF" }).click();
    const download = await downloading;
    // Named after the notebook. WebKit writes a space in a download's name as an underscore.
    expect(download.suggestedFilename()).toMatch(/^Lecture[ _]notes\.pdf$/);
    const exported = await readFile(await download.path());
    expect(exported.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // The original's pages with the ink drawn over them: more than the original alone.
    expect(exported.byteLength).toBeGreaterThan(source.byteLength);

    // Read back as a PDF, the stroke is part of the first page, where it was drawn.
    await page.getByRole("button", { name: "Back to the library" }).click();
    await page.locator('input[data-hm-input="pdf"]').setInputFiles({
      name: "Exported.pdf",
      mimeType: "application/pdf",
      buffer: exported,
    });
    await expect(page.getByRole("heading", { name: "Exported" })).toBeVisible();
    await expect(page.locator(".hm-notes-page-background").first()).not.toHaveAttribute(
      "data-hm-pending",
      "",
      { timeout: 30_000 },
    );
    await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.5, "background"))).toBe(true);
    expect(isInk(await inkAt(page, 0.45, 0.7, "background"))).toBe(false);
    await expectClean(page, problems);
  });

  test("passes axe in the library, in a dialog, in an open notebook with its sidebar, and in its settings", async ({
    page,
  }) => {
    await openEditor(page, url);
    await expect(page.getByText("No notebooks yet")).toBeVisible();
    // Each check looks at a settled page: a colour caught mid-transition isn't the design's.
    const check = async (scope = ".hm-notes-editor") => {
      await settled(page);
      return (await new AxeBuilder({ page }).include(scope).analyze()).violations;
    };
    expect(await check()).toEqual([]);

    await page.getByRole("button", { name: "New notebook" }).click();
    await expect(page.getByRole("dialog", { name: "New notebook" })).toBeVisible();
    expect(await check("dialog[open]")).toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.locator(PAGE).first()).toBeVisible();
    await pen(page, PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await page.getByRole("button", { name: "Pages, outline and recordings" }).click();
    await expect(page.getByRole("complementary", { name: "Notebook sidebar" })).toBeVisible();
    expect(await check()).toEqual([]);

    // ui's frame: the settings, in a sheet (sdk-core ADR 0067).
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(await check("dialog[open]")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

    await page.getByRole("button", { name: "Back to the library" }).click();
    await expect(page.getByRole("button", { name: /^Untitled notebook/ })).toBeVisible();
    expect(await check()).toEqual([]);
  });

  test("works from the keyboard: one tab stop for the tools, tool keys, the palette, and pages", async ({
    page,
  }) => {
    await openEditor(page, url);
    await newNotebook(page);
    // The tools are one tab stop; arrow keys move within them.
    await expect(
      page.getByRole("toolbar", { name: "Notebook tools" }).locator('[tabindex="0"]'),
    ).toHaveCount(1);
    await page.getByRole("region", { name: "Pages" }).focus();
    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "Eraser", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Adding a page is an Expert tool, out of the panel in Advanced mode, and
    // in the command palette in every mode (sdk-core ADR 0067).
    await expect(page.getByRole("button", { name: "Add a page" })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByRole("combobox", { name: "Search tools" });
    await expect(search).toBeFocused();
    await search.fill("add a page");
    await page.keyboard.press("Enter");
    await expect(page.locator(".hm-notes-notebook-position")).toHaveText("Page 2 of 2");
    // The edit says what it did, with Undo.
    await expect(page.locator(".hm-toast")).toContainText("Applied new page.");
    // The events a host hears name no title, and say which view shows.
    const reported = await page.evaluate(() => ({
      events: window.notesSdk.events.map((event) => event.type),
      views: window.notesSdk.views.map((view) => view.view),
    }));
    expect(reported.views).toEqual(["notebook"]);
    expect(reported.events).toEqual(
      expect.arrayContaining(["notebook_created", "notebook_opened"]),
    );
  });
});
