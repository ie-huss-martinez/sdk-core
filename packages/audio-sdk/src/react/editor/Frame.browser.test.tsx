import type { EditorPreferences } from "@hussmartinez/ui";
import { act, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { recording, step } from "../../../test/editor.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { AudioEditor, type AudioEditorHandle, type AudioEditorProps } from "../AudioEditor.js";

/**
 * The editor on ui's frame (docs/adr/0007, sdk-core ADR 0067): modes and the
 * transport, the command palette, Easy's start cards, toasts with Undo, and
 * preferences the host keeps.
 */

afterEach(async () => {
  await cleanUp();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Wide enough for the frame's desktop layout, with the tools beside the stage. */
const DESKTOP = "width: 1100px; height: 640px; display: grid; grid-template-rows: minmax(0, 1fr);";

async function setUp(props: Partial<AudioEditorProps> = {}) {
  const handle = createRef<AudioEditorHandle>();
  const view = await mount(<AudioEditor ref={handle} {...props} />, DESKTOP);
  return {
    view,
    open: async () => {
      await step(() => handle.current?.open(recording()));
      // The open's toast is said in the next animation frame.
      await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    },
  };
}

const editor = (view: HTMLElement) => view.querySelector(".hm-audio-editor") as HTMLElement;
/** The tools panel's rows, by their visible labels. */
const rows = (view: HTMLElement) =>
  [...view.querySelectorAll("nav .hm-tool-list-label")].map((label) => label.textContent);
const row = (view: HTMLElement, id: string) =>
  view.querySelector<HTMLButtonElement>(`nav [data-hm-tool-id="${id}"]`);
/** The transport's buttons, by name. */
const transport = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-audio-editor-transport button")].map((button) =>
    button.getAttribute("aria-label"),
  );
/** A button by its accessible name: its label, or else its text. */
const named = (view: HTMLElement, text: string) =>
  [...view.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent)?.trim() === text,
  );
const cards = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-audio-start-card-title")].map((title) => title.textContent);
const toasts = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-toast-message")].map((message) => message.textContent);
const undos = (view: HTMLElement) =>
  [...view.querySelectorAll<HTMLButtonElement>(".hm-toast-action")].filter(
    (button) => button.textContent === "Undo",
  );

describe("the editor's modes (sdk-core ADR 0067)", () => {
  it("lists Easy's tools in Easy, with descriptions, and plays from the transport, which adds its ends in Expert", async () => {
    const easy = await setUp({ defaultPreferences: { mode: "easy" } });
    expect(rows(easy.view)).toEqual([
      "Trim the start to the playhead",
      "Trim the end to the playhead",
      "Split at the playhead",
      "Delete",
      "Fade in",
      "Fade out",
    ]);
    expect(
      row(easy.view, "audio.fade-in")?.querySelector(".hm-tool-list-description")?.textContent,
    ).toBe("Bring the sound in gradually");
    // Playback's tools stay with the transport, never in the panel.
    expect(row(easy.view, "audio.play-pause")).toBeNull();
    expect(transport(easy.view)).toEqual(["Play"]);
    expect(named(easy.view, "Commands")).toBeUndefined();
    await cleanUp();

    const expert = await setUp({ defaultPreferences: { mode: "expert" } });
    expect(rows(expert.view)).toContain("Ripple");
    expect(rows(expert.view)).toContain("Move track up");
    expect(row(expert.view, "audio.split")?.querySelector("kbd")?.textContent).toBe("S");
    expect(transport(expert.view)).toEqual(["Play", "Back to the start", "Go to the end"]);
    expect(named(expert.view, "Commands")).not.toBeUndefined();
  });

  it("reaches a tool Easy doesn't list from the command palette, with Ctrl+K", async () => {
    const { view, open } = await setUp({ defaultPreferences: { mode: "easy" } });
    await open();
    await step(() => userEvent.click(named(view, "Just show me the editor") as HTMLElement));
    expect(row(view, "audio.add-track")).toBeNull();
    await step(() => userEvent.keyboard("{Control>}k{/Control}"));
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");
    await step(() => userEvent.keyboard("Add track"));
    await step(() => userEvent.keyboard("{Enter}"));
    await waitFor(() => expect(toasts(view)).toContain("Track added."));
  });
});

describe("preferences the host keeps (sdk-core ADR 0067)", () => {
  it("inherits the page's theme, density and motion until they're chosen, and reports each change", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    const { view } = await setUp({ onPreferencesChange });
    expect(editor(view).hasAttribute("data-hm-theme")).toBe(false);
    expect(editor(view).hasAttribute("data-hm-density")).toBe(false);
    expect(editor(view).hasAttribute("data-hm-motion")).toBe(false);
    // Advanced with no preferences: the editor as hosts embedded it before.
    expect(named(view, "Advanced")?.getAttribute("aria-checked")).toBe("true");

    await step(() => userEvent.click(named(view, "Easy") as HTMLElement));
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "easy" }));
    await waitFor(() => expect(toasts(view)).toContain("Easy mode"));
    expect(editor(view).hasAttribute("data-hm-theme")).toBe(false);
  });

  it("lets the host's theme prop win, with no toggle, and sets a default it gives", async () => {
    const { view } = await setUp({ theme: "dark", defaultPreferences: { density: "compact" } });
    expect(editor(view).getAttribute("data-hm-theme")).toBe("dark");
    expect(editor(view).getAttribute("data-hm-density")).toBe("compact");
    expect(editor(view).hasAttribute("data-hm-motion")).toBe(false);
    expect(view.querySelector(".hm-theme-toggle")).toBeNull();
  });
});

describe("Easy mode's start cards (sdk-core ADR 0067)", () => {
  it("shows once per recording, takes focus, and leads to a card's tools and the properties", async () => {
    const { view, open } = await setUp({ defaultPreferences: { mode: "easy" } });
    expect(cards(view)).toEqual([]);
    await open();
    expect(cards(view)).toEqual([
      "Cut the start or end",
      "Remove a part",
      "Fade in or out",
      "Combine recordings",
    ]);
    await waitFor(() =>
      expect(document.activeElement).toBe(view.querySelector(".hm-audio-start-card")),
    );
    // No properties in Easy mode, until a card asks.
    expect(view.querySelector(".hm-audio-editor-inspector")).toBeNull();

    await step(() => userEvent.click(view.querySelector('[data-hm-card="fade"]') as HTMLElement));
    expect(cards(view)).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(row(view, "audio.fade-in")));
    expect(view.querySelector(".hm-audio-editor-inspector")).not.toBeNull();
  });

  it("lists the combining card's tool in Easy mode, and runs it, which asks for a file", async () => {
    const { view, open } = await setUp({ defaultPreferences: { mode: "easy" } });
    await open();
    const picker = view.querySelector(".hm-audio-editor-picker") as HTMLInputElement;
    // The browser's own picker isn't opened in a test: only the call is counted.
    const chosen = vi.spyOn(picker, "click").mockImplementation(() => {});
    await step(() =>
      userEvent.click(view.querySelector('[data-hm-card="combine"]') as HTMLElement),
    );
    expect(chosen).toHaveBeenCalledTimes(1);
    expect(rows(view)).toContain("Add recording");
  });

  it("never shows in Advanced mode", async () => {
    const { view, open } = await setUp();
    await open();
    expect(cards(view)).toEqual([]);
  });
});

describe("toasts (sdk-core ADR 0067)", () => {
  it("keeps one edit's toast at a time, whose Undo undoes it", async () => {
    const { view, open } = await setUp();
    await open();
    await waitFor(() => expect(toasts(view)).toContain("Recording opened."));
    await step(() => userEvent.click(row(view, "audio.add-track") as HTMLElement));
    await waitFor(() => expect(toasts(view)).toContain("Track added."));
    await step(() => userEvent.click(row(view, "audio.add-track") as HTMLElement));
    // Three tracks, each with its header.
    await waitFor(() =>
      expect(view.querySelectorAll('.hm-audio-editor-stage [role="toolbar"]')).toHaveLength(3),
    );
    expect(undos(view)).toHaveLength(1);

    await act(() => userEvent.click(undos(view)[0] as HTMLElement));
    await waitFor(() => expect(toasts(view)).toContain("Undone."));
    // Undone, the edit's toast goes with its Undo.
    expect(undos(view)).toEqual([]);
  });
});
