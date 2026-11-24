import { expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    /** What the Vite example exposes for these tests (examples/vite/src/main.tsx). */
    notesSdk: {
      editor: {
        library: {
          createFolder(name: string): Promise<string>;
          createNotebook(notebook: Record<string, unknown>): Promise<string>;
          binNotebook(id: string): Promise<void>;
        };
      } | null;
      violations: string[];
      events: { type: string }[];
      views: { view: string }[];
    };
  }
}

/**
 * Notices Firefox logs as warnings about its own engine, not about the page.
 * They're matched exactly and kept apart, so every other warning, such as
 * React's hydration warnings, still fails a test.
 *
 * - **Microtask order:** Firefox says it reordered microtasks "to avoid
 *   unsafe execution". Nothing on the page goes wrong; pdf-sdk's suite
 *   records the same notice (pdf-sdk issue #32).
 * - **WebAssembly `try`:** qpdf's WebAssembly, which pdf-sdk bundles to
 *   assemble exported PDFs, was compiled with the older exception-handling
 *   instruction. It still runs; recompiling it is pdf-sdk's to do.
 */
const FIREFOX_ENGINE_NOTICES = [
  /^\[JavaScript Warning: "The execution of microtasks on this page was reordered to avoid unsafe execution\." \{file: "[^"]+" line: 0\}\]$/,
  /^\[JavaScript Warning: "The WebAssembly exception handling 'try' instruction is deprecated and should no longer be used\. Please recompile to use the 'try_table' instruction instead\."\]$/,
];

/** What went wrong on a page while a test ran. */
export interface Problems {
  /** Console errors and warnings, such as React's hydration warnings. */
  readonly console: string[];
  /** Firefox's notices about its own engine, which are recorded but allowed. */
  readonly engineNotices: string[];
  /** Uncaught exceptions. */
  readonly errors: string[];
  /** Requests to any origin but the page's own (ADR 0012 in sdk-core). */
  readonly foreignRequests: string[];
}

/** Records what a page does from now on. */
export function watch(page: Page, origin: string): Problems {
  const problems: Problems = { console: [], engineNotices: [], errors: [], foreignRequests: [] };
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "warning" &&
      FIREFOX_ENGINE_NOTICES.some((notice) => notice.test(text))
    ) {
      problems.engineNotices.push(text);
    } else if (message.type() === "error" || message.type() === "warning") {
      problems.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.protocol.startsWith("http")) return;
    if (url.origin !== origin) problems.foreignRequests.push(request.url());
  });
  return problems;
}

/** One sample of a pen's path, as fractions of an element's box, and its pressure from 0 to 1. */
export interface PenSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

/** A straight path of samples between two points. */
export function line(
  from: readonly [number, number],
  to: readonly [number, number],
  { steps = 12, pressure = 0.5 }: { readonly steps?: number; readonly pressure?: number } = {},
): PenSample[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: from[0] + ((to[0] - from[0]) * index) / steps,
    y: from[1] + ((to[1] - from[1]) * index) / steps,
    pressure,
  }));
}

/** The first page of the open notebook. */
export const PAGE = ".hm-notes-page";

/**
 * Draws on an element with a pen. In Chromium the samples go through the
 * browser's own input pipeline, over its protocol, as real pen events with
 * pressure, as a tablet's stylus sends them (docs/adr/0002). Firefox and
 * WebKit have no such protocol, so there the same samples are dispatched as
 * pointer events on the element.
 */
export async function pen(
  page: Page,
  selector: string,
  samples: readonly PenSample[],
  { barrel = false }: { readonly barrel?: boolean } = {},
): Promise<void> {
  const target = page.locator(selector).first();
  // Aimed at where the target will stay, not where an animation has it now:
  // an open notebook scales in (`hm-notes-open`), and even with reduced
  // motion that takes a frame or more, which put a stroke 3 px off.
  let last = "";
  await expect
    .poll(
      async () => {
        const { moving, box } = await target.evaluate((element) => ({
          moving: document.getAnimations().some((animation) => {
            const animated = (animation.effect as KeyframeEffect | null)?.target;
            return (
              (animation.pending || animation.playState === "running") &&
              animated instanceof Element &&
              animated.contains(element)
            );
          }),
          box: JSON.stringify(element.getBoundingClientRect()),
        }));
        const still = box === last;
        last = box;
        return !moving && still;
      },
      { intervals: [50] },
    )
    .toBe(true);
  const box = await target.boundingBox();
  if (!box) throw new Error(`Nothing to draw on: ${selector}`);
  if (page.context().browser()?.browserType().name() === "chromium") {
    const session = await page.context().newCDPSession(page);
    const button = barrel ? "right" : "left";
    const buttons = barrel ? 2 : 1;
    try {
      for (const [index, sample] of samples.entries()) {
        const common = {
          x: box.x + sample.x * box.width,
          y: box.y + sample.y * box.height,
          pointerType: "pen" as const,
          force: sample.pressure ?? 0.5,
        };
        await session.send("Input.dispatchMouseEvent", {
          ...common,
          type: index === 0 ? "mousePressed" : "mouseMoved",
          button,
          buttons,
          ...(index === 0 ? { clickCount: 1 } : {}),
        });
        if (index === samples.length - 1) {
          await session.send("Input.dispatchMouseEvent", {
            ...common,
            type: "mouseReleased",
            button,
            buttons: 0,
            clickCount: 1,
            force: 0,
          });
        }
      }
    } finally {
      await session.detach();
    }
    return;
  }
  await target.evaluate(
    (element, { samples, barrel }) => {
      const rect = element.getBoundingClientRect();
      samples.forEach((sample, index) => {
        const init: PointerEventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 77,
          pointerType: "pen",
          isPrimary: true,
          clientX: rect.left + sample.x * rect.width,
          clientY: rect.top + sample.y * rect.height,
          pressure: sample.pressure ?? 0.5,
          button: index === 0 ? (barrel ? 2 : 0) : -1,
          buttons: barrel ? 2 : 1,
        };
        element.dispatchEvent(new PointerEvent(index === 0 ? "pointerdown" : "pointermove", init));
        if (index === samples.length - 1) {
          element.dispatchEvent(
            new PointerEvent("pointerup", {
              ...init,
              pressure: 0,
              button: barrel ? 2 : 0,
              buttons: 0,
            }),
          );
        }
      });
    },
    { samples: [...samples], barrel },
  );
}

/**
 * Opens the editor, and says whether this browser gives the page its
 * private file system. Playwright's WebKit doesn't in its throwaway
 * profiles, where opening it fails; Safari itself does. There, the editor
 * must say the notes can't be kept, which is checked here, and the test
 * goes on with a library kept in memory (`?store=memory`, which only the
 * Vite example has), so writing is still tested in every engine.
 */
export async function openEditor(
  page: Page,
  url: string,
  { memory = true }: { readonly memory?: boolean } = {},
): Promise<boolean> {
  await page.goto(url);
  const works = await page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
  if (works) {
    await expect(page.getByRole("button", { name: "New notebook" })).toBeVisible();
    return true;
  }
  await expect(page.locator(".hm-notes-alert")).toContainText(
    "This browser isn't letting the app keep notes on this device.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  if (memory) {
    await page.goto(`${url}?store=memory`);
    await expect(page.getByRole("button", { name: "New notebook" })).toBeVisible();
  }
  return false;
}

/**
 * Waits until nothing on the page is still changing: an open notebook has
 * saved, no transition or animation is running, such as a dialog fading in
 * or a button's colour after it's pressed, and two frames have been drawn
 * since. A screenshot or an accessibility check taken mid-transition sees
 * colours that are on their way somewhere else.
 */
export async function settled(page: Page): Promise<void> {
  const save = page.locator(".hm-notes-notebook-save");
  if ((await save.count()) > 0) await expect(save).toHaveText("Saved");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Creates a notebook from the library, which opens it ready to write. */
export async function newNotebook(page: Page, name?: string): Promise<void> {
  await page.getByRole("button", { name: "New notebook" }).click();
  const dialog = page.getByRole("dialog", { name: "New notebook" });
  if (name) await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(PAGE).first()).toBeVisible();
}

/** Waits until the open notebook says everything is saved on the device. */
export async function saved(page: Page): Promise<void> {
  await expect(page.locator(".hm-notes-notebook-save")).toHaveText("Saved");
}

/**
 * The darkest opaque colour within two pixels of a place on the first page,
 * as red, green, blue and alpha: a thin line may fall a pixel to either side
 * of where it was aimed. It looks at the finished ink, or with `layer`
 * `"background"` at the PDF drawn under it. The pixels are copied to a
 * canvas made for reading, so the page's own canvas isn't read back.
 */
export async function inkAt(
  page: Page,
  x: number,
  y: number,
  layer: "ink" | "background" = "ink",
): Promise<number[]> {
  return page
    .locator(`.hm-notes-page-${layer}`)
    .first()
    .evaluate(
      (element, at) => {
        const canvas = element as HTMLCanvasElement;
        const scratch = document.createElement("canvas");
        scratch.width = 5;
        scratch.height = 5;
        const context = scratch.getContext("2d", {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D;
        context.drawImage(
          canvas,
          Math.round(at.x * canvas.width) - 2,
          Math.round(at.y * canvas.height) - 2,
          5,
          5,
          0,
          0,
          5,
          5,
        );
        const { data } = context.getImageData(0, 0, 5, 5);
        let darkest = [255, 255, 255, 0];
        for (let index = 0; index < data.length; index += 4) {
          const pixel = [
            data[index] ?? 0,
            data[index + 1] ?? 0,
            data[index + 2] ?? 0,
            data[index + 3] ?? 0,
          ];
          const sum = (color: number[]) => (color[0] ?? 0) + (color[1] ?? 0) + (color[2] ?? 0);
          const opaque = pixel[3] === 255;
          if (opaque && (darkest[3] !== 255 || sum(pixel) < sum(darkest))) darkest = pixel;
        }
        return darkest;
      },
      { x, y },
    );
}

/** Whether a colour is dark ink rather than white paper. */
export const isInk = (color: readonly number[]): boolean =>
  (color[3] ?? 0) === 255 && (color[0] ?? 255) + (color[1] ?? 255) + (color[2] ?? 255) < 300;

/**
 * A small PDF written by hand: one Letter page per text given, each with its
 * text in Helvetica. Enough for the import, the search and the export tests,
 * with no PDF library in the test suite.
 */
export function pdfWith(texts: readonly string[]): Buffer {
  const objects: string[] = [];
  const kids = texts.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${texts.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [index, text] of texts.entries()) {
    const stream = `BT /F1 24 Tf 72 700 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${
        5 + index * 2
      } 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
