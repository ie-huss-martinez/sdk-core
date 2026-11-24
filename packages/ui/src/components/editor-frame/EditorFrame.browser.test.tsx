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
  EditorFrameToolsButton,
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

function Frame({ tabBar = false }: { tabBar?: boolean }) {
  const [tools, setTools] = useState<EditorFrameToolsState>("full");
  const [properties, setProperties] = useState<EditorFramePropertiesState>("shown");
  return (
    <EditorFrame
      topBar={<EditorFrameToolsButton />}
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
    (element) => (element.getAttribute("aria-label") ?? element.textContent) === name,
  ) as HTMLButtonElement;

describe("EditorFrame", () => {
  it("collapses the tools to icons, hides them, and brings them back from the edge tab", async () => {
    const container = render(<Frame />);
    const wide = nav(container).getBoundingClientRect().width;
    await userEvent.click(button(container, "Icons only"));
    expect(frameOf(container).dataset["hmTools"]).toBe("icons");
    // The panel narrows over the panel duration.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    expect(nav(container).getBoundingClientRect().width).toBeLessThan(wide);

    await userEvent.click(button(container, "Hide tools"));
    expect(nav(container).hidden).toBe(true);
    const edge = button(container, "Tools");
    expect(edge.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(edge);
    // It comes back as it was: icons.
    expect(frameOf(container).dataset["hmTools"]).toBe("icons");
  });

  it("hides and shows the tools with Mod+\\ while focus is inside, and from the top bar's button", async () => {
    const container = render(<Frame />);
    button(container, "Stage").focus();
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(nav(container).hidden).toBe(true);
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(nav(container).hidden).toBe(false);

    const menu = button(container, "Hide tools");
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(container.querySelector(".hm-editor-frame-top button") as HTMLElement);
    expect(nav(container).hidden).toBe(true);
    expect(
      (container.querySelector(".hm-editor-frame-top button") as HTMLElement).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("hides the properties to an edge tab", async () => {
    const container = render(<Frame />);
    await userEvent.click(button(container, "Hide properties"));
    expect((container.querySelector("aside") as HTMLElement).hidden).toBe(true);
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
    expect(button(container, "Rotate").getAttribute("aria-describedby")).toBeTruthy();
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
