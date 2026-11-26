import { applyVisualVariant, visualVariants } from "@hussmartinez/sdk-config/testing/visual";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";
import { FIRST_OPEN, tone } from "../tests/helpers.js";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048). Each is
 * captured in light and dark, compact and comfortable, on the built example
 * as a host renders it.
 *
 * | State | What it shows |
 * |---|---|
 * | `empty` | The drop zone, before a recording is open |
 * | `open` | One recording on its track: the tools panel, the timeline with its waveform, the transport and the inspector's Recording section |
 * | `tracks` | Two tracks, the second muted, with a clip of the first selected and the inspector's Clip section |
 * | `selection` | A range on the first of two tracks, with Ripple's warning on its lane and header, the transport's text and the inspector's Selection section |
 * | `rename` | The rename dialog, its field focused |
 * | `export-summary` | The export dialog's summary, naming the muted track, and its formats with their sizes |
 * | `export-done` | The export dialog's result for a mix that clipped, with the clipping report and Download focused |
 * | `error` | A file that isn't audio, and the catalogue's text for it |
 * | `element-empty`, `element-open` | `<hm-audio-editor>`, whose styles arrive through the host's imports |
 * | `long-text`, `long-text-rename`, `long-text-export` | A host's longer text, as a translation can be: two tracks with a clip selected, the rename dialog and the export dialog wrap it |
 * | `rtl`, `rtl-selection` | A Hebrew host, right to left: two tracks, the second muted, with a clip of the first selected, and a range on the first. Time runs from the right, and the icons that point along time are mirrored |
 * | `rtl-dir-only` | `tracks` on a page that sets only `dir="rtl"`, with English text, so a rule keyed on a right-to-left `lang` can't stand in for one keyed on direction |
 * | `settings` | The settings, in a sheet from the inline end |
 * | `palette` | The command palette, searched for "fade" |
 * | `phone` | A 390-pixel window: the tab bar, and the "Cut" group in a sheet from the bottom |
 * | `advanced-open` | A recording open in the editor as a host embeds it, with no preferences: Advanced mode |
 * | `easy-start` | Easy mode: a recording just opened, under the start cards |
 *
 * The editor's own states are in Expert mode, where every tool is listed
 * with its shortcut, unless their name says otherwise (docs/adr/0007). The
 * long-text, right-to-left and element states are the editor as a host
 * embeds it, in Advanced mode. Toasts stay where they are: the page's clock
 * is fixed, so their timers never run out.
 *
 * No state is masked: every one renders generated tones at a fixed time,
 * the waveform is drawn from their peaks, and the editor shows no time or
 * random value that varies between runs.
 */

/** A fixed time, so nothing that reads the clock can vary (ADR 0048). */
const NOW = new Date("2026-11-18T12:00:00Z");

type State = (page: Page) => Promise<void>;

const open = async (page: Page, bytes: Buffer) => {
  await page.evaluate((data) => window.audioEditor.open(new Uint8Array(data).buffer), [...bytes]);
};
const insert = async (page: Page, bytes: Buffer) => {
  await page.evaluate((data) => window.audioEditor.insert(new Uint8Array(data).buffer), [...bytes]);
};
const clipsShown = (page: Page, count: number) =>
  expect(page.getByRole("option")).toHaveCount(count, { timeout: FIRST_OPEN });

/** Two tracks: a 2 s tone, and a 1 s one under it, muted. */
const twoTracks = async (page: Page, amplitude?: number) => {
  await open(page, tone(2, amplitude));
  await insert(page, tone(1, amplitude));
  await clipsShown(page, 2);
};
const muteSecond = async (page: Page) => {
  const header = page.getByRole("toolbar", { name: "Track 2" });
  await header.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("group", { name: "Track 2, muted" })).toBeAttached();
};

/** Two tracks, the second muted, with a clip of the first selected. */
const tracks: State = async (page) => {
  await twoTracks(page);
  await muteSecond(page);
  await page.getByRole("option").first().focus();
  await expect(page.getByText("Clip on Track 1")).toBeVisible();
};

/** One recording open, with focus on the playhead. */
const opened: State = async (page) => {
  await open(page, tone(2));
  await expect(page.getByRole("slider", { name: "Playhead" })).toBeFocused({
    timeout: FIRST_OPEN,
  });
};

const EDITOR: Readonly<Record<string, State>> = {
  empty: async (page) => {
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  },
  open: opened,
  tracks,
  selection: async (page) => {
    await twoTracks(page);
    // Drag across the first track's clip, from a quarter to three quarters of it.
    const box = await page.getByRole("option").first().boundingBox();
    if (!box) throw new Error("no clip");
    const y = box.y + box.height - 4;
    await page.mouse.move(box.x + box.width / 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 3) / 4, y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator(".hm-audio-editor-selection")).toContainText("on Track 1");
    await expect(page.locator(".hm-audio-editor-track-ripple")).toHaveText("Ripple");
  },
  rename: async (page) => {
    await open(page, tone(2));
    await clipsShown(page, 1);
    await page.getByRole("button", { name: "Track 1, rename" }).click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  },
  "export-summary": async (page) => {
    await twoTracks(page);
    await muteSecond(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByText("Track 2 is muted, so it won't be in the file.")).toBeVisible();
  },
  "export-done": async (page) => {
    await twoTracks(page, 0.9);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Download" })).toBeFocused({
      timeout: FIRST_OPEN,
    });
    await expect(dialog.getByText(/The mix went .* dB over full scale/)).toBeVisible();
  },
  error: async (page) => {
    await open(page, Buffer.from([1, 2, 3, 4])).catch(() => {});
    await expect(page.locator(".hm-audio-editor-error")).toBeVisible({ timeout: FIRST_OPEN });
  },
  // The settings, in a sheet from the inline end (sdk-core ADR 0067).
  settings: async (page) => {
    await opened(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  },
  // The command palette, searched, with its first result active (sdk-core ADR 0067).
  palette: async (page) => {
    await opened(page);
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByRole("combobox", { name: "Search tools" });
    await expect(search).toBeFocused();
    await search.fill("fade");
    await expect(page.getByRole("option", { name: "Fade in" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
  // A phone: the tab bar, and a group of tools open in a sheet from the bottom.
  phone: async (page) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await opened(page);
    await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Cut" }).click();
    await expect(page.getByRole("dialog", { name: "Cut" })).toBeVisible();
  },
};

/** The editor as a host embeds it, with no preferences: Advanced mode. */
const ADVANCED: Readonly<Record<string, State>> = {
  "advanced-open": async (page) => opened(page),
};

/** Easy mode: a recording just opened, under the start cards (sdk-core ADR 0067). */
const EASY: Readonly<Record<string, State>> = {
  "easy-start": async (page) => {
    await open(page, tone(2));
    await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible({
      timeout: FIRST_OPEN,
    });
    // The cards cover the stage, so focus is on the first of them.
    await expect(page.getByRole("button", { name: /^Cut the start or end/ })).toBeFocused();
  },
};

const ELEMENT: Readonly<Record<string, State>> = {
  "element-empty": async (page) => {
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  },
  "element-open": async (page) => {
    await page.evaluate(
      (bytes) => {
        const editor = document.querySelector("hm-audio-editor") as HTMLElement & { file?: Blob };
        editor.file = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      },
      [...tone(2)],
    );
    await clipsShown(page, 1);
  },
};

/** The same states, with the example's `?long-text` overrides, as a translation's text. */
const LONG_TEXT: Readonly<Record<string, State>> = {
  "long-text": async (page) => {
    await twoTracks(page);
    await page.getByRole("option").first().focus();
    await expect(page.getByText("Clip on Tonspur Nummer 1")).toBeVisible();
  },
  "long-text-rename": async (page) => {
    await open(page, tone(2));
    await clipsShown(page, 1);
    await page.getByRole("button", { name: "Tonspur Nummer 1, rename" }).click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  },
  "long-text-export": async (page) => {
    await twoTracks(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Aufnahme als Datei exportieren" }),
    ).toBeVisible();
  },
};

/** The example's `?lang=he`: a Hebrew host, right to left. */
const HEBREW: Readonly<Record<string, State>> = {
  rtl: async (page) => {
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await twoTracks(page);
    const header = page.getByRole("toolbar", { name: "רצועה 2" });
    await header.getByRole("button", { name: "השתקה" }).click();
    await expect(page.getByRole("group", { name: "רצועה 2, מושתקת" })).toBeAttached();
    await page.getByRole("option").first().focus();
    await expect(page.getByText("קטע ברצועה 1")).toBeVisible();
  },
  "rtl-selection": async (page) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await twoTracks(page);
    // Across the first track's clip, from a quarter to three quarters of it.
    const box = await page.getByRole("option").first().boundingBox();
    if (!box) throw new Error("no clip");
    const y = box.y + box.height - 4;
    await page.mouse.move(box.x + box.width / 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + (box.width * 3) / 4, y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator(".hm-audio-editor-selection")).toContainText("רצועה 1");
    await expect(page.locator(".hm-audio-editor-track-ripple")).toHaveText("Ripple");
  },
};

/** The example's `?dir=rtl`: only `dir`, no right-to-left `lang`. */
const DIR_ONLY: Readonly<Record<string, State>> = {
  "rtl-dir-only": async (page) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await tracks(page);
  },
};

/**
 * Draws the whole page again, from nothing, just before the screenshot. The
 * frame's panels share the page's layer with the waveforms, whose canvases
 * are drawn at a different moment on each load, and Chromium rasterises
 * that layer's anti-aliased edges a level or two apart depending on what was
 * invalidated when. Changing the root's background invalidates every tile,
 * so each capture is of the page drawn in one go. The comparison stays as
 * strict as it was (sdk-core ADR 0054), as in pdf-sdk and image-sdk.
 */
async function repainted(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const frames = (then: () => void) =>
          requestAnimationFrame(() => requestAnimationFrame(() => then()));
        const root = document.documentElement;
        const before = root.style.backgroundColor;
        // A colour no theme uses, so the change always invalidates.
        root.style.backgroundColor = "rgb(1, 2, 3)";
        frames(() => {
          root.style.backgroundColor = before;
          frames(resolve);
        });
      }),
  );
}

for (const [path, states] of [
  ["/editor.html?mode=expert", EDITOR],
  ["/editor.html", ADVANCED],
  ["/editor.html?mode=easy", EASY],
  ["/editor.html?long-text", LONG_TEXT],
  ["/editor.html?lang=he", HEBREW],
  ["/editor.html?dir=rtl", DIR_ONLY],
  ["/element.html", ELEMENT],
] as const) {
  for (const [state, reach] of Object.entries(states)) {
    for (const variant of visualVariants) {
      test(`${state}, ${variant.name}`, async ({ page }) => {
        // No request may leave the page's origin (sdk-core ADR 0012).
        const foreign: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return;
          if (url.origin !== "http://localhost:4310") foreign.push(request.url());
        });
        await page.clock.install({ time: NOW });
        await page.goto(path);
        await applyVisualVariant(page, variant);
        await reach(page);
        // The pointer rests outside the editor, so no hover styles show.
        await page.mouse.move(0, 0);
        await repainted(page);
        await expect(page).toHaveScreenshot(`${state}-${variant.name}.png`);
        expect(foreign).toEqual([]);
      });
    }
  }
}
