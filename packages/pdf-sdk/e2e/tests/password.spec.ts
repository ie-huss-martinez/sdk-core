import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { Download, Page } from "@playwright/test";
import { PASSWORDS, protectedPdf, restrictedPdf } from "../../test/fixtures/pdfs.js";
import { expect, expectAnnounced, test, watch } from "./helpers.js";

const origin = "http://localhost:4320";

/** axe's findings in the editor, its dialogs included, once nothing is still fading in. */
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

/** Chooses a PDF with the start button's picker, as a user would. */
async function choose(page: Page, bytes: Uint8Array, name: string): Promise<void> {
  await page.locator('.hm-pdf-editor-start input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
}

/** Waits until the first page has been drawn, by the real engine. */
async function drawn(page: Page): Promise<void> {
  await expect(page.locator(".hm-pdf-editor")).toHaveAttribute("data-hm-status", "ready");
  const first = page.locator(".hm-pdf-page").first();
  await expect
    .poll(() => first.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).width), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(first).toHaveAttribute("aria-busy", "false");
}

async function bytesOf(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Whether a PDF is encrypted, and with which cipher its encryption dictionary names. */
function encryptionOf(bytes: Buffer): "none" | "AES-256" | "other" {
  const text = bytes.toString("latin1");
  if (!/\/Encrypt\b/.test(text)) return "none";
  return /\/CFM\s*\/AESV3\b/.test(text) && /\/V\s+5\b/.test(text) ? "AES-256" : "other";
}

/**
 * Password-protected PDFs in the built Vite example, with the real engines
 * (docs/adr/0013): pdf.js opens the document with the password the dialog
 * asked for, and qpdf builds the download, protected with it again.
 */
test.describe("a password-protected PDF", () => {
  test("opens with its password, is edited, and downloads still protected, with AES-256", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await page.goto(`${origin}/`);
    // RC4, the oldest cipher: the download is AES-256 whatever the file had.
    await choose(page, await protectedPdf("RC4-128"), "locked.pdf");

    const dialog = page.getByRole("dialog", { name: "This PDF needs a password" });
    await expect(dialog).toBeVisible();
    const field = dialog.getByLabel("Password");
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("autocomplete", "current-password");
    expect(await violations(page)).toEqual([]);

    await field.fill("not the password");
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("That password didn't open this PDF.").first()).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    expect(await violations(page)).toEqual([]);

    await field.fill(PASSWORDS.user);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await drawn(page);
    await expect(page.getByRole("listbox", { name: "Pages" }).getByRole("option")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Document" })).toBeFocused();
    await expectAnnounced(page, "Opened a PDF with 2 pages.");

    // An edit, then the download, which asks about the password first.
    await page.getByRole("button", { name: "Rotate right" }).click();
    await page.getByRole("button", { name: "Download" }).click();
    const choice = page.getByRole("dialog", { name: "This PDF has a password" });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole("radio", { name: "Keep the password" })).toBeChecked();
    await expect(choice.getByRole("button", { name: "Download" })).toBeFocused();
    expect(await violations(page)).toEqual([]);

    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const saved = await bytesOf(await download);
    await expect(choice).toBeHidden();
    await expectAnnounced(page, "Saved locked.pdf.");

    expect(encryptionOf(saved)).toBe("AES-256");
    await expect(PDFDocument.load(saved)).rejects.toThrow(/encrypted/i);
    await expect(PDFDocument.load(saved, { password: "not the password" })).rejects.toBeDefined();
    const reopened = await PDFDocument.load(saved, { password: PASSWORDS.user });
    expect(reopened.getPages().map((each) => each.getRotation().angle)).toEqual([90, 0]);
    // The password is nowhere on the page once the dialog has closed.
    expect(await page.content()).not.toContain(PASSWORDS.user);

    expect(await page.evaluate(() => window.pdfSdk.violations)).toEqual([]);
    // The console isn't checked here, as in the other tests that export:
    // Firefox warns, once for each qpdf run, that qpdf's WebAssembly uses
    // the older exception-handling instructions. It's about pdfstudio's
    // binary (docs/adr/0001), and nothing on the page goes wrong.
    expect(problems.errors).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("downloads without its password when the person removes it", async ({ page }) => {
    const problems = watch(page, origin);
    await page.goto(`${origin}/`);
    await choose(page, await protectedPdf("AES-256"), "locked.pdf");
    const field = page.getByRole("dialog").getByLabel("Password");
    await field.fill(PASSWORDS.user);
    await page.getByRole("button", { name: "Unlock" }).click();
    await drawn(page);

    // Unchanged, so only the choice makes the editor build a new file.
    await page.getByRole("button", { name: "Download" }).click();
    const choice = page.getByRole("dialog", { name: "This PDF has a password" });
    await choice.getByRole("radio", { name: "Remove the password" }).click();
    await expect(choice.getByText("Anyone will be able to open the copy.")).toBeVisible();
    const download = page.waitForEvent("download");
    await choice.getByRole("button", { name: "Download" }).click();
    const saved = await bytesOf(await download);

    expect(encryptionOf(saved)).toBe("none");
    expect((await PDFDocument.load(saved)).getPageCount()).toBe(2);
    expect(problems.errors).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test("with only an owner password opens without asking, and says that an edited copy has no restrictions", async ({
    page,
  }) => {
    const problems = watch(page, origin);
    await page.goto(`${origin}/`);
    await choose(page, await restrictedPdf("AES-128"), "restricted.pdf");
    await drawn(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Rotate right" }).click();
    // No password to keep, so nothing to ask: only that the copy differs.
    await page.getByRole("button", { name: "Download" }).click();
    const notice = page.getByRole("dialog", { name: "This PDF has restrictions" });
    await expect(notice).toHaveAccessibleDescription(
      "The original's restrictions, such as on printing or copying, aren't kept in this copy.",
    );
    expect(await violations(page)).toEqual([]);
    const download = page.waitForEvent("download");
    await notice.getByRole("button", { name: "Download" }).click();
    const saved = await bytesOf(await download);

    expect(encryptionOf(saved)).toBe("none");
    expect((await PDFDocument.load(saved)).getPages()[0]?.getRotation().angle).toBe(90);
    expect(problems.errors).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });
});
