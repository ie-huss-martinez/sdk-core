import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { wavFile } from "../../test/fixtures/pcm-files.js";

/**
 * How long a test waits for the first open of a page to show (sdk-core ADR
 * 0057): longer than the family's 10 s for an assertion, because the first
 * open starts the audio worker from cold and decodes, which is the slow
 * step, and in Firefox and WebKit slower still. It stays well under the
 * test's 60 s.
 */
export const FIRST_OPEN = 20_000;

/**
 * A tone at 8 kHz, as WAV bytes, `seconds` long: by default quiet enough
 * never to clip, and loud enough that two together clip at 0.9.
 */
export function tone(seconds: number, amplitude = 0.25): Buffer {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * amplitude);
  return Buffer.from(wavFile([samples]));
}

/** Presses Tab, or Shift+Tab, until the locator has focus, as a person would. */
export async function tabTo(page: Page, target: Locator, backwards = false): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

/** Presses an arrow key within a toolbar until the locator has focus. */
export async function arrowTo(page: Page, target: Locator, key = "ArrowRight"): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`${key} never reached ${target}`);
}

/** Opens a recording through the drop zone's button, with the keyboard. */
export async function openByKeyboard(page: Page, seconds: number, name = "take.wav") {
  await tabTo(page, page.getByRole("button", { name: "Choose a file" }));
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({ name, mimeType: "audio/wav", buffer: tone(seconds) });
}

/** What went wrong on a page: errors, console messages and requests to another origin. */
export function watch(page: Page, origin: string) {
  const problems = {
    errors: [] as string[],
    console: [] as string[],
    foreignRequests: [] as string[],
  };
  page.on("pageerror", (error) => problems.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.console.push(message.text());
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) {
      problems.foreignRequests.push(request.url());
    }
  });
  return problems;
}

/**
 * axe's findings in the editor, dialogs and toasts included: they're inside
 * its root. Taken once every transition has ended, such as a sheet's fade
 * in, so axe reads the colours that stay, not a frame of the way there.
 */
export async function violations(page: Page) {
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
 * Waits until `text` is what the editor's polite live region said last.
 * Messages announced in the same frame are said together, separated by a
 * space (ui 0.14.2), so the region may also hold an earlier one, such as an
 * open's toast that a slow engine shows a frame late.
 */
export async function expectAnnounced(page: Page, text: string): Promise<void> {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await expect(page.locator(".hm-announcer [aria-live=polite]")).toHaveText(
    // A whole sentence: the start, or the end of the previous one, comes first.
    new RegExp(`(^|[.!?\u2026] )${escaped}$`),
  );
}
