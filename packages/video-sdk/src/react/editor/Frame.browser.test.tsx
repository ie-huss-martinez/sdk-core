import "@hussmartinez/ui/styles.css";
import "../../styles.css";
import type { EditorPreferences } from "@hussmartinez/ui";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { encodeFakeVideo } from "../../../test/fakes/fake-video.js";
import { VideoEditor, type VideoEditorHandle, type VideoEditorProps } from "../VideoEditor.js";

/**
 * The editor on ui's frame (docs/adr/0010, sdk-core ADR 0067): modes and the
 * transport, the command palette, Easy's start cards, toasts with Undo, and
 * preferences the host keeps. A fake engine keeps inserts quick; it has no
 * preview, which these tests don't need.
 */

let root: Root | undefined;
let container: HTMLElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const video = () =>
  encodeFakeVideo({
    width: 64,
    height: 36,
    rate: { num: 30, den: 1 },
    frames: 60,
    audio: { sampleRate: 48_000, channels: 2 },
  });

/** Wide enough for the frame's desktop layout, with the tools beside the stage. */
function setUp(props: Partial<VideoEditorProps> = {}) {
  const handle = createRef<VideoEditorHandle>();
  container = document.createElement("div");
  container.style.cssText = "inline-size: 1000px; block-size: 640px;";
  document.body.append(container);
  const view = container;
  const engine = createFakeEngine();
  const render = (next: Partial<VideoEditorProps>) =>
    act(() => root?.render(<VideoEditor ref={handle} engine={engine} {...next} />));
  act(() => {
    root = createRoot(view);
    root.render(<VideoEditor ref={handle} engine={engine} {...props} />);
  });
  return {
    view,
    handle,
    render,
    insert: () => act(async () => void (await handle.current?.insert(video()))),
  };
}

const editor = (view: HTMLElement) => view.querySelector(".hm-video-editor") as HTMLElement;
/** The tools panel's rows, by their visible labels. */
const rows = (view: HTMLElement) =>
  [...view.querySelectorAll("nav .hm-tool-list-label")].map((label) => label.textContent);
const row = (view: HTMLElement, id: string) =>
  view.querySelector<HTMLButtonElement>(`nav [data-hm-tool-id="${id}"]`);
/** The transport's buttons, by name. */
const transport = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-video-transport button")].map((button) =>
    button.getAttribute("aria-label"),
  );
/** A button by its accessible name: its label, or else its text. */
const named = (view: HTMLElement, text: string) =>
  [...view.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent)?.trim() === text,
  );
const cards = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-video-start-card-title")].map((title) => title.textContent);
const toasts = (view: HTMLElement) =>
  [...view.querySelectorAll(".hm-toast-message")].map((message) => message.textContent);
const undos = (view: HTMLElement) =>
  [...view.querySelectorAll<HTMLButtonElement>(".hm-toast-action")].filter(
    (button) => button.textContent === "Undo",
  );
const clips = (view: HTMLElement) => [...view.querySelectorAll<HTMLElement>('[role="option"]')];

describe("the editor's modes (sdk-core ADR 0067)", () => {
  it("lists Easy's tools in Easy, with descriptions, and plays from the transport, which adds steps by mode", async () => {
    const { view, render } = setUp({ defaultPreferences: { mode: "easy" } });
    expect(rows(view)).toEqual([
      "Split at the playhead",
      "Delete the selected clips",
      "Add videos",
    ]);
    expect(row(view, "video.split")?.querySelector(".hm-tool-list-description")?.textContent).toBe(
      "Cut the clip in two at the playhead",
    );
    // Playback's tools stay with the transport, never in the panel.
    expect(row(view, "video.play-pause")).toBeNull();
    expect(transport(view)).toEqual(["Play"]);
    expect(named(view, "Commands")).toBeUndefined();

    render({ preferences: { ...readPreferences(), mode: "expert" } });
    expect(rows(view)).toEqual([
      "Split at the playhead",
      "Delete the selected clips",
      "Mute the selected clips",
      "Add videos",
    ]);
    expect(row(view, "video.split")?.querySelector("kbd")?.textContent).toBe("S");
    expect(transport(view)).toEqual([
      "Go to the start",
      "Previous frame",
      "Play",
      "Next frame",
      "Go to the end",
    ]);
    expect(named(view, "Commands")).not.toBeUndefined();
  });

  it("leaves out the transport's start and end, and their card, when the host leaves out their tools", async () => {
    const { view, insert } = setUp({
      defaultPreferences: { mode: "expert" },
      tools: ["video.undo", "video.split", "video.delete", "video.insert", "video.mute"],
      // Mute is present but not in the toolbar, so no row leads to it.
      toolbar: [["video.split", "video.delete"], ["video.insert"]],
    });
    expect(transport(view)).toEqual(["Previous frame", "Play", "Next frame"]);
    await insert();
    act(() => {
      // Easy mode now, to see the cards.
      named(view, "Easy")?.click();
    });
    await vi.waitFor(() =>
      expect(cards(view)).toEqual(["Cut a clip", "Join clips", "Remove a part"]),
    );
  });

  it("reaches a tool Easy doesn't list from the command palette, with Ctrl+K", async () => {
    const { view, insert } = setUp({ defaultPreferences: { mode: "easy" } });
    await insert();
    await act(() => userEvent.click(named(view, "Just show me the editor") as HTMLElement));
    await act(() => userEvent.click(clips(view)[0] as HTMLElement));
    expect(row(view, "video.mute")).toBeNull();
    await act(() => userEvent.keyboard("{Control>}k{/Control}"));
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");
    await act(() => userEvent.keyboard("mute"));
    await act(() => userEvent.keyboard("{Enter}"));
    await vi.waitFor(() => expect(toasts(view)).toContain("Muted the clip."));
    expect(clips(view)[0]?.hasAttribute("data-hm-muted")).toBe(true);
  });
});

/** ui's defaults with the embedded mode, as a host would keep them. */
function readPreferences(): EditorPreferences {
  return {
    theme: "system",
    mode: "advanced",
    toolsLayout: "sidebar",
    tools: "full",
    properties: "shown",
    density: "comfortable",
    motion: "system",
    tips: true,
  };
}

describe("preferences the host keeps (sdk-core ADR 0067)", () => {
  it("inherits the page's theme, density and motion until they're chosen, and reports each change", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    const { view } = setUp({ onPreferencesChange });
    expect(editor(view).hasAttribute("data-hm-theme")).toBe(false);
    expect(editor(view).hasAttribute("data-hm-density")).toBe(false);
    expect(editor(view).hasAttribute("data-hm-motion")).toBe(false);
    // Advanced with no preferences: the editor as hosts embedded it before.
    expect(named(view, "Advanced")?.getAttribute("aria-checked")).toBe("true");

    await act(() => userEvent.click(named(view, "Easy") as HTMLElement));
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "easy" }));
    await vi.waitFor(() => expect(toasts(view)).toContain("Easy mode"));
    // The mode isn't inherited, so the theme still is.
    expect(editor(view).hasAttribute("data-hm-theme")).toBe(false);
  });

  it("sets a field on the root once the host gives it", () => {
    const { view } = setUp({ defaultPreferences: { theme: "dark", density: "compact" } });
    expect(editor(view).getAttribute("data-hm-theme")).toBe("dark");
    expect(editor(view).getAttribute("data-hm-density")).toBe("compact");
    expect(editor(view).hasAttribute("data-hm-motion")).toBe(false);
  });
});

describe("Easy mode's start cards (sdk-core ADR 0067)", () => {
  it("shows once per video, takes focus, and leads to a card's tools and the properties", async () => {
    const { view, insert } = setUp({ defaultPreferences: { mode: "easy" } });
    expect(cards(view)).toEqual([]);
    await insert();
    await vi.waitFor(() =>
      expect(cards(view)).toEqual(["Cut a clip", "Join clips", "Remove a part", "Mute the sound"]),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(view.querySelector(".hm-video-start-card")),
    );
    // No properties in Easy mode, until a card asks.
    expect(view.querySelector(".hm-video-inspector")).toBeNull();

    await act(() => userEvent.click(view.querySelector('[data-hm-card="mute"]') as HTMLElement));
    expect(cards(view)).toEqual([]);
    expect(rows(view)).toContain("Mute the selected clips");
    await vi.waitFor(() => expect(document.activeElement).toBe(row(view, "video.mute")));
    expect(view.querySelector(".hm-video-inspector")).not.toBeNull();

    // Another clip of the same video shows no cards again.
    await insert();
    expect(cards(view)).toEqual([]);
  });

  it("keeps focus on the cards while more clips arrive, as when several files are chosen", async () => {
    const { view, insert } = setUp({ defaultPreferences: { mode: "easy" } });
    await insert();
    await vi.waitFor(() => expect(cards(view)).toHaveLength(4));
    await insert();
    await vi.waitFor(() => expect(clips(view)).toHaveLength(2));
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(view.querySelector(".hm-video-start-card")),
    );
  });

  it("closes when a tool runs, and never shows in Advanced mode", async () => {
    const easy = setUp({ defaultPreferences: { mode: "easy" } });
    await easy.insert();
    await vi.waitFor(() => expect(cards(easy.view)).toHaveLength(4));
    await act(() => userEvent.click(clips(easy.view)[0] as HTMLElement));
    await act(() => userEvent.keyboard("{Delete}"));
    await vi.waitFor(() => expect(cards(easy.view)).toEqual([]));
    act(() => root?.unmount());
    container?.remove();

    const advanced = setUp();
    await advanced.insert();
    await vi.waitFor(() => expect(clips(advanced.view)).toHaveLength(1));
    expect(cards(advanced.view)).toEqual([]);
  });
});

describe("toasts (sdk-core ADR 0067)", () => {
  it("keeps one edit's toast at a time, whose Undo undoes it", async () => {
    const { view, insert } = setUp();
    await insert();
    await vi.waitFor(() => expect(toasts(view)).toContain("Added a clip."));
    await act(() => userEvent.click(clips(view)[0] as HTMLElement));
    await act(() => userEvent.click(row(view, "video.mute") as HTMLElement));
    await vi.waitFor(() => expect(toasts(view)).toContain("Muted the clip."));
    expect(toasts(view)).not.toContain("Added a clip.");
    expect(undos(view)).toHaveLength(1);

    await act(() => userEvent.click(undos(view)[0] as HTMLElement));
    await vi.waitFor(() => expect(toasts(view)).toContain("Undone."));
    expect(clips(view)[0]?.hasAttribute("data-hm-muted")).toBe(false);
    // Undone, the edit's toast goes with its Undo.
    expect(undos(view)).toEqual([]);
  });

  it("offers no Undo when the host leaves the undo tool out", async () => {
    const { view, insert } = setUp({ tools: ["video.insert", "video.mute"] });
    await insert();
    await vi.waitFor(() => expect(toasts(view)).toContain("Added a clip."));
    expect(undos(view)).toEqual([]);
  });
});

describe("the properties footer (sdk-core ADR 0067)", () => {
  it("passes a host's footer to the frame, under the properties", () => {
    const { view } = setUp({ propertiesFooter: <div className="host-footer" /> });
    expect(view.querySelector(".hm-editor-frame-properties-footer > .host-footer")).not.toBeNull();
  });
});
