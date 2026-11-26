import type { EditorPreferences } from "@hussmartinez/ui";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { ImageEditor } from "./ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "./types.js";

/**
 * The editor in ui's frame (docs/adr/0016, sdk-core ADR 0067): modes, the
 * command palette, Easy's start cards, toasts with Undo, and preferences the
 * host keeps.
 */

async function photo(colour = "#3080c0"): Promise<Blob> {
  const canvas = new OffscreenCanvas(30, 20);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillStyle = colour;
  context.fillRect(0, 0, 30, 20);
  return canvas.convertToBlob();
}

let unloadStyles: () => void = () => {};
beforeAll(async () => {
  // The desktop layout, where the tools panel shows the tools.
  await page.viewport(1280, 900);
  unloadStyles = await loadStyles();
});
afterAll(() => unloadStyles());

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

async function until(condition: () => boolean, what: string, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  if (condition()) return;
  throw new Error(`timed out waiting for ${what}`);
}

async function mounted(props: Partial<ImageEditorProps> = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "700px";
  document.body.append(host);
  root = createRoot(host);
  const render = (next: Partial<ImageEditorProps>) =>
    act(async () => root?.render(<ImageEditor ref={handle} {...next} />));
  await render(props);
  const open = async (file: Blob) => {
    const before = handle.current?.session.getSnapshot().source?.id;
    await act(async () => handle.current?.open(file));
    await until(
      () => {
        const snapshot = handle.current?.session.getSnapshot();
        return snapshot?.status === "ready" && snapshot.source?.id !== before;
      },
      "the open",
      FIRST_OPEN_TIMEOUT,
    );
  };
  const session = () => {
    if (!handle.current) throw new Error("no handle");
    return handle.current.session;
  };
  return { open, session, render };
}

const click = (element: Element | null | undefined) =>
  act(async () => {
    if (!element) throw new Error("nothing to click");
    (element as HTMLElement).click();
  });

const key = (target: Element | null, init: KeyboardEventInit) =>
  act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });

/** The tools panel's rows, by their visible labels. */
const rows = () =>
  [...document.querySelectorAll(".hm-image-editor-toolbar .hm-tool-list-label")].map(
    (label) => label.textContent,
  );
const row = (id: string) => document.querySelector<HTMLElement>(`[data-hm-tool-id="${id}"]`);
const named = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent)?.trim() === text,
  );
const cards = () => document.querySelector("section[aria-labelledby] .hm-image-start-cards");
const toasts = () => [...document.querySelectorAll(".hm-toast")].map((toast) => toast.textContent);

describe("the editor's modes (sdk-core ADR 0067)", () => {
  it("lists only Easy's tools in Easy, with descriptions, and every one in Expert, with shortcuts", async () => {
    const { open, render } = await mounted({ defaultPreferences: { mode: "easy" } });
    await open(await photo());
    expect(rows()).toEqual([
      "Rotate left",
      "Rotate right",
      "Flip horizontally",
      "Crop",
      "Redact",
      "Add text",
    ]);
    expect(row("image.crop")?.querySelector(".hm-tool-list-description")?.textContent).toBe(
      "Cut away the edges, or straighten it",
    );
    expect(row("image.crop")?.querySelector("kbd")).toBeNull();

    await act(async () => root?.unmount());
    root = createRoot(host as HTMLElement);
    await render({ defaultPreferences: { mode: "expert" } });
    expect(rows()).toEqual(
      expect.arrayContaining(["Flip vertically", "Add an arrow", "Draw", "Layers"]),
    );
    expect(row("image.crop")?.querySelector(".hm-tool-list-description")).toBeNull();
    expect(row("image.crop")?.querySelector("kbd")?.textContent).toBe("C");
  });

  it("reaches an Expert tool from the command palette in Easy mode, with Ctrl+K", async () => {
    const { open } = await mounted({ defaultPreferences: { mode: "easy" } });
    await open(await photo());
    await click(named("Just show me the editor"));
    expect(row("image.layers")).toBeNull();
    await key(row("image.crop"), { key: "k", ctrlKey: true });
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    await act(async () => {
      if (!input) return;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "layers");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(input, { key: "Enter" });
    await until(
      () => document.querySelector('section[aria-label="Layers"]') !== null,
      "the layers",
    );
  });

  it("changes mode from the settings, telling the host, and follows the host's preferences when it keeps them", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    const { open, render } = await mounted({ onPreferencesChange });
    await open(await photo());
    expect(rows()).not.toContain("Layers");
    await click(named("Settings"));
    const expert = [...document.querySelectorAll<HTMLElement>('dialog[open] [role="radio"]')].find(
      (radio) => radio.textContent === "Expert",
    );
    await click(expert);
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "expert" }),
    );
    expect(rows()).toContain("Layers");
    expect(toasts()).toContain("Expert mode");

    // Controlled: the host's preferences win until it passes new ones.
    const kept: EditorPreferences = {
      theme: "system",
      mode: "advanced",
      toolsLayout: "sidebar",
      tools: "full",
      properties: "shown",
      density: "comfortable",
      motion: "system",
      tips: true,
    };
    onPreferencesChange.mockClear();
    await render({ preferences: kept, onPreferencesChange });
    expect(rows()).not.toContain("Layers");
    const switchExpert = [
      ...document.querySelectorAll<HTMLElement>('.hm-image-editor-mode [role="radio"]'),
    ].find((radio) => radio.textContent === "Expert");
    await click(switchExpert);
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "expert" }),
    );
    expect(rows()).not.toContain("Layers");
    await render({ preferences: { ...kept, mode: "expert" }, onPreferencesChange });
    expect(rows()).toContain("Layers");
  });
});

describe("what the editor inherits from its page (sdk-core ADR 0067)", () => {
  it("keeps the page's theme, density and motion until the person or the host picks them", async () => {
    const html = document.documentElement;
    html.setAttribute("data-hm-theme", "dark");
    html.setAttribute("data-hm-density", "compact");
    html.setAttribute("data-hm-motion", "reduced");
    try {
      await mounted();
      const section = () => document.querySelector<HTMLElement>("section.hm-image-editor");
      for (const name of ["data-hm-theme", "data-hm-density", "data-hm-motion"]) {
        expect(section()?.hasAttribute(name), name).toBe(false);
      }
      // The toggle shows the theme the editor inherits, the page's dark one.
      const toggle = document.querySelector<HTMLElement>(".hm-theme-toggle");
      await until(() => toggle?.getAttribute("aria-pressed") === "true", "the inherited theme");

      // The settings show what's in effect: the page's values.
      await click(named("Settings"));
      const option = (setting: string, text: string) =>
        [
          ...document.querySelectorAll<HTMLElement>(
            `dialog[open] [aria-label="${setting}"] [role="radio"]`,
          ),
        ].find((radio) => radio.textContent === text);
      const checked = (setting: string) =>
        document.querySelector(
          `dialog[open] [aria-label="${setting}"] [role="radio"][aria-checked="true"]`,
        )?.textContent;
      expect(checked("Density")).toBe("Compact");
      expect(checked("Motion")).toBe("Reduced");
      expect(checked("Appearance")).toBe("Dark");
      // Choosing the one shown changes nothing; another is the editor's own.
      await click(option("Density", "Compact"));
      expect(section()?.hasAttribute("data-hm-density")).toBe(false);
      await click(option("Density", "Comfortable"));
      expect(section()?.dataset["hmDensity"]).toBe("comfortable");
      expect(checked("Density")).toBe("Comfortable");
      expect(section()?.hasAttribute("data-hm-motion")).toBe(false);
      await click(option("Motion", "Full"));
      expect(section()?.dataset["hmMotion"]).toBe("full");
      expect(section()?.hasAttribute("data-hm-theme")).toBe(false);
    } finally {
      html.removeAttribute("data-hm-theme");
      html.removeAttribute("data-hm-density");
      html.removeAttribute("data-hm-motion");
    }
  });

  it("sets a field the host gives a default for, and inherits the others", async () => {
    await mounted({ defaultPreferences: { density: "compact" } });
    const section = document.querySelector<HTMLElement>("section.hm-image-editor");
    expect(section?.dataset["hmDensity"]).toBe("compact");
    expect(section?.hasAttribute("data-hm-motion")).toBe(false);
    expect(section?.hasAttribute("data-hm-theme")).toBe(false);
  });
});

describe("Easy mode's start cards (sdk-core ADR 0067)", () => {
  it("shows once per image, runs a card's tool, and closes with Just show me the editor", async () => {
    const { open } = await mounted({ defaultPreferences: { mode: "easy" } });
    // Before an image, the editor's own empty state, without cards.
    expect(cards()).toBeNull();
    await open(await photo());
    expect(cards()).not.toBeNull();
    expect(document.querySelector(".hm-image-start-title")?.textContent).toBe(
      "What would you like to do?",
    );
    // A card leads into the editor with its tool.
    await click(named("Crop or straighten Cut away the edges, or turn it the right way up."));
    expect(cards()).toBeNull();
    await until(
      () => document.querySelector('[role="group"][aria-label="Crop area"]') !== null,
      "the crop frame",
    );
    await key(document.activeElement, { key: "Escape" });

    // Another image: the cards again, until skipped.
    await open(await photo("#c03080"));
    expect(cards()).not.toBeNull();
    await click(named("Just show me the editor"));
    expect(cards()).toBeNull();
  });

  it("offers only the cards the host's tools and features allow", async () => {
    const { open } = await mounted({
      defaultPreferences: { mode: "easy" },
      tools: ["image.rotate-left", "image.crop", "image.undo", "image.redo"],
      features: { adjust: false, filters: false },
    });
    await open(await photo());
    const titles = [...document.querySelectorAll(".hm-image-start-card-title")].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(["Crop or straighten"]);
  });

  it("shows the properties for its card without changing the preference", async () => {
    const onPreferencesChange = vi.fn();
    const { open } = await mounted({
      defaultPreferences: { mode: "easy", properties: "hidden" },
      onPreferencesChange,
    });
    await open(await photo());
    await click(named("Make it look better Brightness, colour and one-tap filters."));
    const properties = () => document.querySelector<HTMLElement>(".hm-editor-frame-properties");
    expect(properties()?.hidden).toBe(false);
    expect(onPreferencesChange).not.toHaveBeenCalled();
    // Another image starts without the card's reveal.
    await open(await photo("#c03080"));
    await click(named("Just show me the editor"));
    expect(properties()?.hidden ?? true).toBe(true);
  });

  it("never shows the cards in Advanced or Expert mode", async () => {
    const { open } = await mounted({ defaultPreferences: { mode: "advanced" } });
    await open(await photo());
    expect(cards()).toBeNull();
  });
});

describe("toasts (sdk-core ADR 0067)", () => {
  it("says what an edit did, with Undo that undoes it", async () => {
    const { open, session } = await mounted();
    await open(await photo());
    await click(row("image.rotate-right"));
    expect(session().getSnapshot().plan?.base.orientation.rotate).toBe(90);
    expect(toasts().some((text) => text?.includes("Applied rotate or flip."))).toBe(true);
    const undo = [...document.querySelectorAll<HTMLElement>(".hm-toast button")].find(
      (button) => button.textContent === "Undo",
    );
    await click(undo);
    expect(session().getSnapshot().plan?.base.orientation.rotate).toBe(0);
    await until(
      () => toasts().some((text) => text?.includes("Undid rotate or flip.")),
      "the undo's toast",
    );
  });

  it("keeps one edit's toast at a time, so its Undo undoes the edit it names", async () => {
    const { open } = await mounted();
    await open(await photo());
    await click(row("image.rotate-right"));
    await click(row("image.flip-horizontal"));
    await until(
      () => toasts().filter((text) => text?.includes("Applied")).length === 1,
      "one edit's toast",
    );
    expect(document.querySelectorAll(".hm-toast button").length).toBeGreaterThan(0);
    const undos = [...document.querySelectorAll<HTMLElement>(".hm-toast button")].filter(
      (button) => button.textContent === "Undo",
    );
    expect(undos).toHaveLength(1);
  });
});
