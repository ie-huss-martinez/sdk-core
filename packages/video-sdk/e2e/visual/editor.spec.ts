import { applyVisualVariant, variantsFor } from "@hussmartinez/sdk-config/testing/visual";
import { expect, type Page, test } from "@playwright/test";
import { video } from "../targets.js";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048), on the
 * built Vite example as a host renders it, with its workers inlined. The
 * main states, in FULL, are captured in light and dark, compact and
 * comfortable; the rest in light-comfortable only (sdk-core ADR 0068).
 *
 * | State | What it shows |
 * |---|---|
 * | `empty` | The drop zone, before a video is open |
 * | `open` | Two clips on the timeline, the first frame on the stage, the transport, the tools and the inspector |
 * | `selection` | Both clips selected, by a click and a Shift-click, with their tools enabled, and their sound in the inspector. Opening already selects the new clip, so one clip would look like `open` |
 * | `paused` | Paused at 1 s, frame 31: the playhead, the stage and the time there |
 * | `output` | No clip selected: the inspector's settings for the exported video, and its details |
 * | `export-summary` | The export dialog's summary and choices |
 * | `export-done` | The export dialog's result, with Download focused |
 * | `error` | A file that isn't a video, and the catalogue's text for it |
 * | `settings` | The settings, in a sheet from the inline end |
 * | `palette` | The command palette, searched for "spl" |
 * | `phone` | A 390-pixel window: the tab bar, and the "Edit" group in a sheet from the bottom |
 * | `advanced-open` | Two clips open in the editor as a host embeds it, with no preferences: Advanced mode |
 * | `easy-start` | Easy mode: two clips just added, under the start cards |
 *
 * The editor's states are in Expert mode, where every tool is listed with
 * its shortcut and the transport has every button, unless their name says
 * otherwise (docs/adr/0010). Toasts stay where they are: the page's clock
 * is fixed, so their timers never run out.
 *
 * Masks, each with its reason:
 *
 * - `export-done` masks the result line: it names the file's size, which
 *   depends on the browser's encoder, not on the editor's layout.
 *
 * The stage shows a frame of the package's colour-bar test video, decoded by
 * Chromium's VP8 decoder and drawn by the SDK's own worker, which are exact
 * in the pinned image; a paused editor shows no time that varies. The
 * custom element isn't captured: video-sdk doesn't ship one yet.
 */

/** A fixed time, so nothing that reads the clock can vary (ADR 0048). */
const NOW = new Date("2026-11-14T12:00:00Z");
const ORIGIN = "http://localhost:4330";

type State = {
  readonly reach: (page: Page) => Promise<void>;
  /** Regions whose content varies by nature, each with its reason above. */
  readonly mask?: (page: Page) => ReturnType<Page["locator"]>[];
};

/** Opens the test video twice through the drop zone and its picker, as a user would. */
async function opened(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (await chooser).setFiles([
    { name: "first.webm", mimeType: "video/webm", buffer: video() },
    { name: "second.webm", mimeType: "video/webm", buffer: video() },
  ]);
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Video preview, frame 1 of 120" })).toBeVisible();
}

/**
 * Dismisses the toasts, as a person can. An export takes long enough for a
 * toast's timer to run out in one run and not in the next, so the export's
 * states start without them.
 */
async function noToasts(page: Page): Promise<void> {
  const dismiss = page.locator(".hm-toast").getByRole("button", { name: "Dismiss" });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
  await expect(page.locator(".hm-toast")).toHaveCount(0);
}

const exportDialog = async (page: Page) => {
  await opened(page);
  await noToasts(page);
  await page.getByRole("button", { name: "Export the video", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export the video" })).toBeVisible();
};

const STATES: Readonly<Record<string, State>> = {
  empty: {
    reach: async (page) => {
      await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
    },
  },
  open: { reach: opened },
  selection: {
    reach: async (page) => {
      await opened(page);
      await page.getByRole("option", { name: /^Clip 1,/ }).click();
      await page.getByRole("option", { name: /^Clip 2,/ }).click({ modifiers: ["Shift"] });
      for (const name of [/^Clip 1,/, /^Clip 2,/]) {
        await expect(page.getByRole("option", { name })).toHaveAttribute("aria-selected", "true");
      }
      await expect(
        page.getByRole("button", { name: "Delete the selected clips" }),
      ).not.toHaveAttribute("aria-disabled");
    },
  },
  paused: {
    reach: async (page) => {
      await opened(page);
      // A second on, from the playhead's own keys.
      await page.getByRole("slider", { name: "Playhead" }).focus();
      await page.keyboard.press("PageUp");
      await expect(page.getByRole("slider", { name: "Playhead" })).toHaveAttribute(
        "aria-valuetext",
        "0:01.00",
      );
      await expect(page.getByRole("img", { name: "Video preview, frame 31 of 120" })).toBeVisible();
      await page.getByRole("slider", { name: "Playhead" }).blur();
    },
  },
  output: {
    reach: async (page) => {
      await opened(page);
      // The last clip added is selected: a Mod-click clears it.
      const clip = page.getByRole("option", { name: /^Clip 2,/ });
      await clip.click({ modifiers: ["ControlOrMeta"] });
      await expect(clip).toHaveAttribute("aria-selected", "false");
      await expect(page.getByRole("group", { name: "The exported video" })).toBeVisible();
    },
  },
  "export-summary": { reach: exportDialog },
  "export-done": {
    reach: async (page) => {
      await exportDialog(page);
      const dialog = page.getByRole("dialog", { name: "Export the video" });
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Download" })).toBeFocused({
        timeout: 60_000,
      });
    },
    mask: (page) => [page.locator(".hm-video-export-result")],
  },
  // The settings, in a sheet from the inline end (sdk-core ADR 0067).
  settings: {
    reach: async (page) => {
      await opened(page);
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    },
  },
  // The command palette, searched, with its first result active (sdk-core ADR 0067).
  palette: {
    reach: async (page) => {
      await opened(page);
      await page.keyboard.press("ControlOrMeta+k");
      const search = page.getByRole("combobox", { name: "Search tools" });
      await expect(search).toBeFocused();
      await search.fill("spl");
      await expect(page.getByRole("option", { name: "Split at the playhead" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  },
  // A phone: the tab bar, and a group of tools open in a sheet from the bottom.
  phone: {
    reach: async (page) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await opened(page);
      await page
        .getByRole("toolbar", { name: "Editing tools" })
        .getByRole("button", { name: "Edit" })
        .click();
      await expect(page.getByRole("dialog", { name: "Edit" })).toBeVisible();
    },
  },
  error: {
    reach: async (page) => {
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Choose files" }).click();
      await (await chooser).setFiles({
        name: "notes.webm",
        mimeType: "video/webm",
        buffer: Buffer.from("not a video at all"),
      });
      // The stage's alert, not the announcer's empty assertive region.
      await expect(page.locator(".hm-video-stage-error")).toBeVisible();
    },
  },
};

/** The editor as a host embeds it, with no preferences: Advanced mode. */
const ADVANCED: Readonly<Record<string, State>> = {
  "advanced-open": { reach: opened },
};

/** Easy mode: two clips just added, under the start cards (sdk-core ADR 0067). */
const EASY: Readonly<Record<string, State>> = {
  "easy-start": {
    reach: async (page) => {
      await opened(page);
      await expect(page.getByRole("region", { name: "What would you like to do?" })).toBeVisible();
      // The cards cover the preview, so focus is on the first of them.
      await expect(page.getByRole("button", { name: /^Cut a clip/ })).toBeFocused();
    },
  },
};

/**
 * Draws the whole page again, from nothing, just before the screenshot. The
 * frame's panels share the page's layer with the preview, whose canvas the
 * media worker draws at a different moment on each load, and Chromium
 * rasterises that layer's anti-aliased edges a level or two apart depending
 * on what was invalidated when. Changing the root's background invalidates
 * every tile, so each capture is of the page drawn in one go. The
 * comparison stays as strict as it was (sdk-core ADR 0054). image-sdk and
 * pdf-sdk steady theirs the same way.
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

/**
 * The states captured in every theme and density (sdk-core ADR 0068): the
 * frame's main states. video-sdk has no right-to-left or element states yet.
 */
const FULL: readonly string[] = [
  "empty",
  "open",
  "settings",
  "phone",
  "advanced-open",
  "easy-start",
];

for (const [path, states] of [
  ["/inline.html?mode=expert", STATES],
  ["/inline.html", ADVANCED],
  ["/inline.html?mode=easy", EASY],
] as const) {
  for (const [state, { reach, mask }] of Object.entries(states)) {
    for (const variant of variantsFor(state, { full: FULL })) {
      test(`${state}, ${variant.name}`, async ({ page }) => {
        // No request may leave the page's origin (sdk-core ADR 0012).
        const foreign: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return;
          if (url.origin !== ORIGIN) foreign.push(request.url());
        });
        await page.clock.install({ time: NOW });
        await page.goto(path);
        await applyVisualVariant(page, variant);
        await reach(page);
        // The pointer rests outside the editor, so no hover styles show.
        await page.mouse.move(0, 0);
        await repainted(page);
        await expect(page).toHaveScreenshot(`${state}-${variant.name}.png`, {
          ...(mask ? { mask: mask(page) } : {}),
        });
        expect(foreign).toEqual([]);
      });
    }
  }
}
