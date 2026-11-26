import { applyVisualVariant, variantsFor } from "@hussmartinez/sdk-config/testing/visual";
import { expect, type Page, test } from "@playwright/test";
import { inkAt, isInk, line, PAGE, pen, settled } from "../tests/helpers.js";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048), on the
 * built Vite example as a host renders it, with a library kept in memory so
 * every run starts from the same empty one. The main states, in FULL, are
 * captured in light and dark, compact and comfortable; the rest in
 * light-comfortable only (sdk-core ADR 0068). An open notebook is on ui's
 * frame (docs/adr/0008): its states run in Expert mode, where every tool is
 * listed, apart from `advanced-open` and the Easy ones.
 *
 * | State | What it shows |
 * |---|---|
 * | `library-empty` | The library before any notebook, with its actions and its empty state |
 * | `library` | A folder and three notebooks: each cover colour's board, spine and ruled label |
 * | `new-notebook` | The dialog for a new notebook: name, paper, cover, page size and orientation |
 * | `bin` | The bin, with a notebook to restore or delete for good |
 * | `notebook` | An open notebook: the blue top bar, the tools in their dock, the pen's options in the properties panel, lined paper, pen and highlighter ink |
 * | `sidebar` | The same with the page sidebar open in the stage, thumbnails of two pages, and the toast of the page just added |
 * | `selection` | A stroke selected with the lasso: its box, corner handles and bar of actions |
 * | `eraser` | The eraser in hand, with its options, and a stroke cut in two |
 * | `tools-sidebar` | The tools in the frame's sidebar instead of the dock, chosen in the settings |
 * | `settings` | The settings, in a sheet from the inline end |
 * | `palette` | The command palette, searched, with its first result active |
 * | `phone` | A phone: the tab bar of the tool groups, and the writing tools open in a sheet |
 * | `advanced-open` | The notebook as a host embeds it, with no preferences: Advanced mode |
 * | `easy-start` | A new notebook in Easy mode, under the start cards |
 *
 * No state is masked: the library's names are fixed, the ink is drawn from
 * fixed samples through the browser's own pen input, and the editor shows no
 * time or random value.
 *
 * Not captured yet:
 *
 * - A page over a PDF: pdf.js draws it in a worker, which the other suites cover.
 * - Recording and playback: they need a microphone.
 * - The custom element: it renders the same editor.
 */

/** A fixed time, so nothing that reads the clock can vary (ADR 0048). Toasts stay put under it. */
const NOW = new Date("2026-11-23T12:00:00Z");
const ORIGIN = "http://localhost:4350";

// Tall enough to show most of a page under the toolbar.
test.use({ viewport: { width: 1000, height: 1100 } });

type State = (page: Page) => Promise<void>;

/** Fills the library through its own API, as a host could. */
async function seed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const library = window.notesSdk.editor?.library;
    if (!library) throw new Error("The editor isn't ready.");
    await library.createFolder("School");
    await library.createNotebook({ title: "Physics", template: "grid", cover: "blue" });
    await library.createNotebook({ title: "Journal", template: "lined", cover: "green" });
    await library.createNotebook({ title: "Sketches", template: "dotted", cover: "amber" });
    const old = await library.createNotebook({
      title: "Old drafts",
      template: "blank",
      cover: "gray",
    });
    await library.binNotebook(old);
  });
  await expect(page.getByRole("button", { name: /^Sketches/ })).toBeVisible();
}

/** Opens a new lined notebook and writes on it with the pen and the highlighter. */
const written: State = async (page) => {
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Physics");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.locator(PAGE).first()).toBeVisible();
  // A line that presses harder as it goes, then a wave under it.
  await pen(
    page,
    PAGE,
    Array.from({ length: 25 }, (_, index) => ({
      x: 0.15 + index * 0.025,
      y: 0.12,
      pressure: 0.2 + index * 0.03,
    })),
  );
  await pen(
    page,
    PAGE,
    Array.from({ length: 41 }, (_, index) => ({
      x: 0.15 + index * 0.015,
      y: 0.22 + Math.sin(index / 3) * 0.02,
      pressure: 0.6,
    })),
  );
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  await pen(page, PAGE, line([0.15, 0.12], [0.5, 0.12], { steps: 14 }));
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  // The pointer leaves the dock, so its tooltip goes.
  await page.mouse.move(0, 0);
  await expect.poll(async () => isInk(await inkAt(page, 0.6, 0.12))).toBe(true);
  await expect(page.locator(".hm-notes-notebook-save")).toHaveText("Saved");
};

/** The library, and the notebook in Expert mode, where every tool is listed. */
const EDITOR: Readonly<Record<string, State>> = {
  "library-empty": async (page) => {
    await expect(page.getByText("No notebooks yet")).toBeVisible();
  },
  library: seed,
  "new-notebook": async (page) => {
    await page.getByRole("button", { name: "New notebook" }).click();
    await expect(page.getByRole("dialog", { name: "New notebook" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  },
  bin: async (page) => {
    await seed(page);
    await page.getByRole("button", { name: "Bin (1)" }).click();
    await expect(page.getByRole("button", { name: "Delete for good" })).toBeVisible();
  },
  notebook: written,
  sidebar: async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Add a page" }).click();
    await expect(page.locator(".hm-notes-notebook-position")).toHaveText("Page 2 of 2");
    await page.getByRole("button", { name: "Pages, outline and recordings" }).click();
    await expect(page.getByRole("grid", { name: "Pages" }).getByRole("row")).toHaveCount(2);
    // Each thumbnail draws once it's in view, which sizes its canvas: until then it has a
    // canvas's default width of 300.
    await expect
      .poll(() =>
        page
          .locator(".hm-notes-thumbnail-canvas")
          .evaluateAll((canvases) =>
            canvases.every((canvas) => (canvas as HTMLCanvasElement).width === 224),
          ),
      )
      .toBe(true);
    // A thumbnail can draw again once the page it shows settles, such as the
    // first page after a page is added; wait until what they show stops
    // changing.
    await expect
      .poll(() =>
        page.locator(".hm-notes-thumbnail-canvas").evaluateAll(async (canvases) => {
          const drawn = () =>
            canvases.map((canvas) => (canvas as HTMLCanvasElement).toDataURL()).join();
          const before = drawn();
          await new Promise((resolve) => setTimeout(resolve, 250));
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return drawn() === before;
        }),
      )
      .toBe(true);
  },
  selection: async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    // A loop around the wave only.
    await pen(page, PAGE, [
      { x: 0.1, y: 0.17 },
      { x: 0.85, y: 0.17 },
      { x: 0.85, y: 0.27 },
      { x: 0.1, y: 0.27 },
      { x: 0.1, y: 0.17 },
    ]);
    await expect(page.getByRole("group", { name: "Selection: 1 item" })).toBeVisible();
  },
  eraser: async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    await pen(page, PAGE, line([0.45, 0.17], [0.45, 0.27]));
    await expect.poll(async () => isInk(await inkAt(page, 0.45, 0.22))).toBe(false);
    await expect(page.locator(".hm-notes-notebook-save")).toHaveText("Saved");
  },
  // Huss's decision (a): the dock by default, and the sidebar from the settings.
  "tools-sidebar": async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("radio", { name: "Sidebar" }).click();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    // Focus leaves Settings, so its tooltip goes.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  },
  settings: async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  },
  palette: async (page) => {
    await written(page);
    await page.getByRole("button", { name: "Pen", exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByRole("combobox", { name: "Search tools" });
    await expect(search).toBeFocused();
    await search.fill("high");
    await expect(page.getByRole("option", { name: "Highlighter" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
  phone: async (page) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole("button", { name: "New notebook" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.locator(PAGE).first()).toBeVisible();
    await page
      .getByRole("toolbar", { name: "Notebook tools" })
      .getByRole("button", { name: "Write", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Write" })).toBeVisible();
  },
};

/** The notebook as a host embeds it, with no preferences: Advanced mode, the tools in a dock. */
const ADVANCED: Readonly<Record<string, State>> = {
  "advanced-open": written,
};

/** Easy mode: a new notebook under the start cards (sdk-core ADR 0067). */
const EASY: Readonly<Record<string, State>> = {
  "easy-start": async (page) => {
    await page.getByRole("button", { name: "New notebook" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  },
};

/** The states captured in every theme and density (sdk-core ADR 0068). */
const FULL: readonly string[] = [
  "library-empty",
  "notebook",
  "settings",
  "phone",
  "advanced-open",
  "easy-start",
];

/**
 * Draws the whole page again, from nothing. Chromium keeps the pixels of what
 * a frame didn't change, and a rounded edge drawn before the sidebar opened
 * can come out a few levels apart from the same edge drawn after it. With the
 * layout, styles, focus and canvases measured identical, the sidebar's scenes
 * still gave one of two screenshots, about one run in three. Changing the
 * root's background invalidates every tile, so each capture is of the page
 * drawn in one go, whatever order it was built in. The comparison stays as
 * strict as it was: the difference is removed at its source (sdk-core ADR 0054).
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

for (const [query, states] of [
  ["?store=memory&mode=expert", EDITOR],
  ["?store=memory", ADVANCED],
  ["?store=memory&mode=easy", EASY],
] as const) {
  for (const [state, reach] of Object.entries(states)) {
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
        await page.goto(`/${query}`);
        await applyVisualVariant(page, variant);
        await expect(page.getByRole("button", { name: "New notebook" })).toBeVisible();
        await reach(page);
        // The pointer rests outside the editor, so no hover styles show.
        await page.mouse.move(0, 0);
        await settled(page);
        await repainted(page);
        await expect(page).toHaveScreenshot(`${state}-${variant.name}.png`);
        expect(foreign).toEqual([]);
      });
    }
  }
}
