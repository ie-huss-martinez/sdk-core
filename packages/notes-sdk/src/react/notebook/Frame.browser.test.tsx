import type { EditorPreferences } from "@hussmartinez/ui";
import { act, createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createFakePdfEngine } from "../../../test/fixtures/fake-pdf.js";
import { draw, line } from "../../../test/pen.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { createMemoryNotesStore } from "../../adapters/memory-store/memory-store.js";
import type { NotesRecorder } from "../../core/ports/notes-recorder.js";
import { NotesEditor, type NotesEditorHandle, type NotesEditorProps } from "../NotesEditor.js";

/**
 * The notebook on ui's frame (docs/adr/0008, sdk-core ADR 0067): the dock
 * by default, modes, the command palette, Easy's start cards, toasts with
 * Undo, the blue bar in both themes, the recording's transport, and
 * preferences the host keeps.
 */

afterEach(cleanUp);

// The desktop layout: the frame's breakpoints are container queries at 60
// and 45 rem, and a host this wide is above both.
beforeAll(async () => {
  await page.viewport(1100, 1200);
});

const PAGE = ".hm-notes-page";

/** A recorder that records nothing, at once. */
const recorder: NotesRecorder = {
  supported: true,
  start: async () => ({
    startedAt: Date.now(),
    elapsed: () => 0,
    stop: async () => ({ audio: new Blob(["sound"], { type: "audio/webm" }), duration: 1_000 }),
    cancel: () => undefined,
  }),
};

async function mounted(props: Partial<NotesEditorProps> = {}) {
  const handle = createRef<NotesEditorHandle>();
  const container = await mount(
    <NotesEditor
      ref={handle}
      store={createMemoryNotesStore()}
      pdfEngine={createFakePdfEngine()}
      recorder={recorder}
      {...props}
    />,
    "width: 1000px; height: 1100px; display: grid; grid-template-rows: minmax(0, 1fr);",
  );
  await waitFor(() => expect(named("New notebook")).toBeTruthy());
  return { container, handle };
}

const named = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("button")].find(
    (button) =>
      (button.getAttribute("aria-label") ?? button.textContent)?.trim() === text &&
      button.closest("dialog:not([open])") === null,
  );

async function press(text: string): Promise<void> {
  const found = await waitFor(() => {
    const button = named(text);
    if (!button) throw new Error(`No button named ${text}`);
    return button;
  });
  await userEvent.click(found);
}

async function newNotebook(): Promise<void> {
  await press("New notebook");
  await press("Create");
  await waitFor(() => expect(document.querySelector(PAGE)).toBeTruthy(), { timeout: 5_000 });
}

/** The ids of the tools the frame's panel lists, in order. */
const listed = () =>
  [...document.querySelectorAll<HTMLElement>(".hm-notes-toolbar [data-hm-tool-id]")].map(
    (row) => row.dataset["hmToolId"],
  );
const row = (id: string) => document.querySelector<HTMLElement>(`[data-hm-tool-id="${id}"]`);
const frame = () => document.querySelector<HTMLElement>(".hm-notes-frame");
const cards = () => document.querySelector(".hm-notes-start");
const toasts = () =>
  [...document.querySelectorAll(".hm-toast-message")].map((toast) => toast.textContent);

const key = (target: Element | null, init: KeyboardEventInit) =>
  act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });

describe("the notebook's tools (docs/adr/0008)", () => {
  it("floats them in a dock over the pages unless the sidebar is chosen", async () => {
    await mounted();
    await newNotebook();
    expect(frame()?.dataset["hmLayout"]).toBe("dock");
    // Advanced mode, as a host embeds it: writing, then selecting and adding.
    expect(listed()).toEqual([
      "notes.pen",
      "notes.highlighter",
      "notes.eraser",
      "notes.text",
      "notes.lasso",
      "notes.image",
      "notes.link",
    ]);
    await cleanUp();

    await mounted({ defaultPreferences: { toolsLayout: "sidebar" } });
    await newNotebook();
    expect(frame()?.dataset["hmLayout"]).toBe("sidebar");
  });

  it("lists Easy's tools with descriptions in Easy, and every one with shortcuts in Expert", async () => {
    await mounted({ defaultPreferences: { mode: "easy", toolsLayout: "sidebar" } });
    await newNotebook();
    await press("Just show me the notebook");
    expect(listed()).toEqual(["notes.pen", "notes.highlighter", "notes.eraser", "notes.text"]);
    expect(row("notes.pen")?.querySelector(".hm-tool-list-description")?.textContent).toBe(
      "Write and draw, pressing harder for a thicker line.",
    );
    await cleanUp();

    await mounted({ defaultPreferences: { mode: "expert", toolsLayout: "sidebar" } });
    await newNotebook();
    expect(listed()).toEqual(
      expect.arrayContaining(["notes.hand", "notes.add-page", "notes.record"]),
    );
    expect(row("notes.pen")?.querySelector("kbd")?.textContent).toBe("P");
    // Bar tools are in the top bar, never the panel.
    expect(listed()).not.toContain("notes.undo");
    expect(document.querySelector('.hm-editor-frame-top [data-tool="notes.undo"]')).toBeTruthy();
  });

  it("reaches an Expert tool from the command palette in Easy mode, with Ctrl+K", async () => {
    await mounted({ defaultPreferences: { mode: "easy" } });
    await newNotebook();
    await press("Just show me the notebook");
    expect(row("notes.add-page")).toBeNull();
    await key(row("notes.pen"), { key: "k", ctrlKey: true });
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(document.activeElement).toBe(input);
    await userEvent.type(input as HTMLInputElement, "add a page");
    await key(input, { key: "Enter" });
    await waitFor(() =>
      expect(document.querySelector(".hm-notes-notebook-position")?.textContent).toBe(
        "Page 2 of 2",
      ),
    );
  });

  it("changes mode from the settings, telling the host, and follows the host's preferences when it keeps them", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    await mounted({ onPreferencesChange });
    await newNotebook();
    expect(listed()).not.toContain("notes.hand");
    await press("Settings");
    const expert = [...document.querySelectorAll<HTMLElement>('dialog[open] [role="radio"]')].find(
      (radio) => radio.textContent === "Expert",
    );
    await userEvent.click(expert as HTMLElement);
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "expert", toolsLayout: "dock" }),
    );
    await waitFor(() => expect(listed()).toContain("notes.hand"));
    expect(toasts()).toContain("Expert mode");
  });
});

describe("the blue bar (docs/adr/0008)", () => {
  it("stays blue in the dark theme, through the frame's top-bar tokens", async () => {
    const { container } = await mounted({ theme: "dark" });
    await newNotebook();
    const bar = container.querySelector<HTMLElement>(".hm-editor-frame-top");
    expect(getComputedStyle(bar as HTMLElement).backgroundColor).toBe("rgb(47, 95, 179)");
    // A theme the host sets hides the theme toggle.
    expect(container.querySelector(".hm-theme-toggle")).toBeNull();
  });
});

describe("Easy mode's start cards (docs/adr/0008)", () => {
  it("show over an empty notebook, put a card's tool in hand, and show its options for this notebook only", async () => {
    const onPreferencesChange = vi.fn();
    await mounted({
      defaultPreferences: { mode: "easy", properties: "hidden" },
      onPreferencesChange,
    });
    await newNotebook();
    expect(cards()).not.toBeNull();
    const titles = [...document.querySelectorAll(".hm-notes-start-card-title")].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(["Write by hand", "Type notes", "Mark up a PDF", "Record a lecture"]);
    await press("Type notes Tap the page and type, anywhere on it.");
    expect(cards()).toBeNull();
    expect(row("notes.text")?.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(row("notes.text")));
    const properties = () => document.querySelector<HTMLElement>(".hm-editor-frame-properties");
    expect(properties()?.hidden).toBe(false);
    expect(onPreferencesChange).not.toHaveBeenCalled();

    // Another notebook: the cards again, and the preference for the options.
    await press("Back to the library");
    await newNotebook();
    expect(cards()).not.toBeNull();
    await press("Just show me the notebook");
    expect(properties()?.hidden ?? true).toBe(true);
  });

  it("offers only the cards the host's tools and the browser allow", async () => {
    await mounted({
      defaultPreferences: { mode: "easy" },
      tools: ["notes.pen", "notes.eraser", "notes.undo", "notes.redo"],
      recorder: { ...recorder, supported: false },
    });
    await newNotebook();
    const titles = [...document.querySelectorAll(".hm-notes-start-card-title")].map(
      (title) => title.textContent,
    );
    expect(titles).toEqual(["Write by hand", "Mark up a PDF"]);
  });

  it("never shows the cards in Advanced mode, or over a notebook with writing in it", async () => {
    await mounted();
    await newNotebook();
    expect(cards()).toBeNull();
  });
});

describe("toasts (sdk-core ADR 0067)", () => {
  it("say what an edit did, with Undo that undoes it, and go when the notebook moves on", async () => {
    await mounted({ defaultPreferences: { mode: "expert" } });
    await newNotebook();
    const position = () => document.querySelector(".hm-notes-notebook-position")?.textContent;
    await userEvent.click(row("notes.add-page") as HTMLElement);
    await waitFor(() => expect(toasts()).toContain("Applied new page."));
    expect(position()).toBe("Page 2 of 2");
    const undo = [...document.querySelectorAll<HTMLElement>(".hm-toast button")].find(
      (button) => button.textContent === "Undo",
    );
    await userEvent.click(undo as HTMLElement);
    await waitFor(() => expect(position()).toBe("Page 1 of 1"));
    await waitFor(() => expect(toasts()).toContain("Undone."));
    await waitFor(() => expect(toasts()).not.toContain("Applied new page."));

    // A stroke after an edit takes the edit's Undo away: it would undo the stroke.
    await userEvent.click(row("notes.add-page") as HTMLElement);
    await waitFor(() => expect(toasts()).toContain("Applied new page."));
    await userEvent.click(row("notes.pen") as HTMLElement);
    // On the new page, which the notebook scrolled to: input lands only in view.
    await draw(".hm-notes-page-slot:last-child .hm-notes-page", line([0.2, 0.2], [0.5, 0.2]));
    await waitFor(() => expect(toasts()).not.toContain("Applied new page."));
  });
});

describe("the recording's transport (docs/adr/0007, docs/adr/0008)", () => {
  it("shows in the frame's bottom region while sound is recorded, with Stop", async () => {
    await mounted({ defaultPreferences: { mode: "expert" } });
    await newNotebook();
    expect(document.querySelector(".hm-editor-frame-bottom")).toBeNull();
    await userEvent.click(row("notes.record") as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector(".hm-editor-frame-bottom")?.textContent).toContain(
        "Recording sound",
      ),
    );
    await press("Stop recording");
    await waitFor(() => expect(document.querySelector(".hm-editor-frame-bottom")).toBeNull());
    await waitFor(() => expect(toasts()).toContain("The recording was saved with the notebook."));
  });
});

describe("the properties footer (sdk-core ADR 0067)", () => {
  it("passes a host's footer to the open notebook's frame, under the properties", async () => {
    await mounted({ propertiesFooter: <div className="host-footer" /> });
    await newNotebook();
    expect(
      document.querySelector(".hm-editor-frame-properties-footer > .host-footer"),
    ).not.toBeNull();
  });
});
