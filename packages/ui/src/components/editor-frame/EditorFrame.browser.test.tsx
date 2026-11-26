import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  defaultEditorPreferences,
  type EditorPreferences,
} from "../../preferences/editor-preferences.js";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { SettingsPanel } from "../settings-panel/SettingsPanel.js";
import { ToolList } from "../tool-list/ToolList.js";
import {
  EditorFrame,
  type EditorFramePropertiesState,
  type EditorFrameToolsState,
} from "./EditorFrame.js";

let root: Root | undefined;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadStyles();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  cleanUp();
  vi.restoreAllMocks();
});

function render(element: React.ReactElement, width = "80rem"): HTMLElement {
  const container = mount("");
  container.style.inlineSize = width;
  container.style.blockSize = "30rem";
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const onRun = vi.fn();
const groups = [
  {
    id: "orientation",
    label: "Orientation",
    items: [
      { id: "rotate", label: "Rotate", icon: <svg />, description: "A quarter turn" },
      { id: "flip", label: "Flip", icon: <svg />, disabled: true },
      { id: "crop", label: "Crop", icon: <svg /> },
    ],
  },
];

function Frame({ tabBar = false, topBar = true }: { tabBar?: boolean; topBar?: boolean }) {
  const [tools, setTools] = useState<EditorFrameToolsState>("full");
  const [properties, setProperties] = useState<EditorFramePropertiesState>("shown");
  return (
    <EditorFrame
      topBar={topBar ? "Image editor" : undefined}
      tools={<ToolList label="Image tools" groups={groups} onRun={onRun} descriptions />}
      properties={<p>Brightness</p>}
      tabBar={tabBar ? <p>Tabs</p> : undefined}
      toolsState={tools}
      onToolsStateChange={setTools}
      propertiesState={properties}
      onPropertiesStateChange={setProperties}
    >
      <button type="button">Stage</button>
    </EditorFrame>
  );
}

const frameOf = (container: HTMLElement) =>
  container.querySelector(".hm-editor-frame") as HTMLElement;
const nav = (container: HTMLElement) => container.querySelector("nav") as HTMLElement;
const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ??
        element.querySelector(".hm-tool-list-label")?.textContent ??
        element.textContent) === name,
  ) as HTMLButtonElement;

describe("EditorFrame", () => {
  it("collapses the tools to icons, and hides and shows them from the top bar's one control", async () => {
    const container = render(<Frame />);
    const wide = nav(container).getBoundingClientRect().width;
    await userEvent.click(button(container, "Icons only"));
    expect(frameOf(container).dataset["hmTools"]).toBe("icons");
    // The panel narrows over the panel duration. Only its own transition is
    // awaited: the pressed button's hover feedback is on the page too, WebKit
    // sometimes cancels it midway, and a cancelled animation rejects
    // `finished`.
    await Promise.all(
      nav(container)
        .getAnimations()
        .map((animation) => animation.finished),
    );
    expect(nav(container).getBoundingClientRect().width).toBeLessThan(wide);

    // One control hides and shows the tools, named by what it does, with its state.
    const toggle = () => container.querySelector(".hm-editor-frame-tools-button") as HTMLElement;
    expect(toggle().getAttribute("aria-label")).toBe("Hide tools");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle());
    expect(nav(container).hidden).toBe(true);
    expect(toggle().getAttribute("aria-label")).toBe("Show tools");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    // Nothing else does the same: no edge tab, and no hide button in the panel.
    expect(container.querySelector(".hm-editor-frame-edge")).toBeNull();
    expect(button(container, "Hide tools")).toBeUndefined();

    // The keyboard reaches it with the tools hidden, and it brings them back as they were.
    toggle().focus();
    await userEvent.keyboard("{Enter}");
    expect(frameOf(container).dataset["hmTools"]).toBe("icons");
  });

  it("hides and shows the tools with Mod+\\ while focus is inside", async () => {
    const container = render(<Frame />);
    button(container, "Stage").focus();
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(nav(container).hidden).toBe(true);
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(nav(container).hidden).toBe(false);
  });

  it("hides and shows the properties from the top bar's toggle", async () => {
    const container = render(<Frame />);
    const toggle = () =>
      container.querySelector(".hm-editor-frame-properties-button") as HTMLElement;
    expect(toggle().getAttribute("aria-label")).toBe("Hide properties");
    await userEvent.click(toggle());
    expect((container.querySelector("aside") as HTMLElement).hidden).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".hm-editor-frame-edge")).toBeNull();
    await userEvent.click(toggle());
    expect((container.querySelector("aside") as HTMLElement).hidden).toBe(false);
  });

  it("brings hidden panels back from edge tabs when there's no top bar", async () => {
    const container = render(<Frame topBar={false} />);
    await userEvent.click(button(container, "Hide tools"));
    await userEvent.click(button(container, "Hide properties"));
    const edge = button(container, "Tools");
    expect(edge.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(edge);
    expect(nav(container).hidden).toBe(false);
    await userEvent.click(button(container, "Properties"));
    expect((container.querySelector("aside") as HTMLElement).hidden).toBe(false);
  });

  it("floats full tools over the stage below 60 rem, and gives way to the tab bar below 45 rem", () => {
    const medium = render(<Frame tabBar />, "52rem");
    expect(getComputedStyle(nav(medium)).position).toBe("absolute");
    expect(
      getComputedStyle(medium.querySelector(".hm-editor-frame-tab-bar") as Element).display,
    ).toBe("none");
    act(() => root?.unmount());
    const narrow = render(<Frame tabBar />, "30rem");
    expect(getComputedStyle(nav(narrow)).display).toBe("none");
    // The tab bar holds the tools, so the top bar's toggle for them goes too.
    expect(
      getComputedStyle(narrow.querySelector(".hm-editor-frame-tools-button") as Element).display,
    ).toBe("none");
    expect(
      getComputedStyle(narrow.querySelector(".hm-editor-frame-tab-bar") as Element).display,
    ).toBe("block");
  });
});

describe("ToolList", () => {
  it("runs a tool on click and Enter, moves with arrows, and never runs a disabled one", async () => {
    onRun.mockClear();
    const container = render(<Frame />);
    await userEvent.click(button(container, "Rotate"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(button(container, "Flip"));
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onRun.mock.calls).toEqual([["rotate"], ["crop"]]);
  });
});

function Panel({ onValueChange }: { onValueChange: (value: EditorPreferences) => void }) {
  const [value, setValue] = useState<EditorPreferences>(defaultEditorPreferences);
  return (
    <SettingsPanel
      open
      onOpenChange={() => {}}
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
        setValue(next);
      }}
    />
  );
}

describe("SettingsPanel", () => {
  it("opens as a modal sheet and reports each change as whole preferences", async () => {
    const onValueChange = vi.fn();
    const container = render(<Panel onValueChange={onValueChange} />);
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.matches(":modal")).toBe(true);
    await userEvent.click(button(container, "Dark"));
    await userEvent.click(button(container, "Off"));
    expect(onValueChange.mock.calls.at(-1)?.[0]).toEqual({
      ...defaultEditorPreferences,
      theme: "dark",
      tips: false,
    });
  });
});
