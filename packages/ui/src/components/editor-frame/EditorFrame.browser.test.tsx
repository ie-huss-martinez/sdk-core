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

  it("starts the stage at the frame's inline start below 45 rem, where the tab bar holds the tools", () => {
    // Full tools reserve a rail's width beside the stage below 60 rem; on a
    // phone they're in the tab bar, so nothing is reserved.
    const narrow = render(<Frame tabBar />, "24rem");
    const stage = narrow.querySelector(".hm-editor-frame-stage") as HTMLElement;
    expect(frameOf(narrow).dataset["hmTools"]).toBe("full");
    expect(stage.getBoundingClientRect().left).toBe(frameOf(narrow).getBoundingClientRect().left);
    expect(stage.getBoundingClientRect().width).toBe(frameOf(narrow).getBoundingClientRect().width);
  });
});

/** A frame whose properties are a block `rows` pixels tall, with a 160 × `ad` footer under them. */
function Footed({
  rows = 40,
  ad = 120,
  properties = true,
  propertiesState = "shown",
}: {
  rows?: number;
  ad?: number;
  properties?: boolean;
  propertiesState?: EditorFramePropertiesState;
}) {
  return (
    <EditorFrame
      topBar="Image editor"
      properties={
        properties ? <div className="rows" style={{ blockSize: `${rows}px` }} /> : undefined
      }
      propertiesState={propertiesState}
      propertiesFooter={
        <div className="ad" style={{ inlineSize: "160px", blockSize: `${ad}px` }} />
      }
    >
      <p>Stage</p>
    </EditorFrame>
  );
}

/** A footed frame whose panel starts hidden, with the top bar's toggle working. */
function Toggled({ properties = true }: { properties?: boolean }) {
  const [state, setState] = useState<EditorFramePropertiesState>("hidden");
  return (
    <EditorFrame
      topBar="Image editor"
      properties={properties ? <div className="rows" style={{ blockSize: "40px" }} /> : undefined}
      propertiesState={state}
      onPropertiesStateChange={setState}
      propertiesFooter={<div className="ad" style={{ inlineSize: "160px", blockSize: "120px" }} />}
    >
      <p>Stage</p>
    </EditorFrame>
  );
}

describe("EditorFrame's properties footer", () => {
  const part = (container: HTMLElement, name: string) =>
    container.querySelector(`.hm-editor-frame-${name}`) as HTMLElement;
  const box = (element: Element) => element.getBoundingClientRect();
  const rerender = (element: React.ReactElement) => act(() => root?.render(element));
  /** Whether the footer shows: not hidden with the column, and with room. */
  const shown = (footer: HTMLElement) => footer.checkVisibility({ visibilityProperty: true });

  it("shows under the panel, outside its landmark, at its own size when both fit", () => {
    const container = render(<Footed />);
    const panel = container.querySelector("aside") as HTMLElement;
    const footer = part(container, "properties-footer");
    expect(footer.hidden).toBe(false);
    expect(panel.contains(footer)).toBe(false);
    expect(footer.getAttribute("role")).toBeNull();
    expect(footer.tabIndex).toBe(-1);
    // The host's content keeps its size, centred under the panel.
    const ad = box(container.querySelector(".ad") as Element);
    expect([ad.width, ad.height]).toEqual([160, 120]);
    // Within the footer's one-pixel rule at its inline start.
    expect(Math.abs(ad.left - box(panel).left - (box(panel).right - ad.right))).toBeLessThanOrEqual(
      1,
    );
    // The panel on top, the footer at the foot of the column, and the panel
    // shows all of its content.
    const column = box(part(container, "properties-column"));
    expect(box(footer).bottom).toBeCloseTo(column.bottom, 1);
    expect(box(panel).bottom).toBeCloseTo(box(footer).top, 1);
    const body = part(container, "properties-body");
    expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight);
  });

  it("hides when the panel's content needs the room, and leaves the panel its full height", async () => {
    const container = render(<Footed />);
    const footer = part(container, "properties-footer");
    const panel = container.querySelector("aside") as HTMLElement;
    const columnHeight = box(part(container, "properties-column")).height;
    rerender(<Footed rows={columnHeight - 100} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(false));
    expect(box(panel).height).toBeCloseTo(columnHeight, 1);
    // It comes back, at the size it had, once there's room again.
    rerender(<Footed rows={40} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(true));
    expect(box(container.querySelector(".ad") as Element).height).toBe(120);
  });

  it("leaves properties that fill the panel, with a percentage height, the whole column", async () => {
    const container = render(
      <EditorFrame
        topBar="Image editor"
        properties={<div className="fill" style={{ blockSize: "100%" }} />}
        propertiesFooter={
          <div className="ad" style={{ inlineSize: "160px", blockSize: "120px" }} />
        }
      >
        <p>Stage</p>
      </EditorFrame>,
    );
    const footer = part(container, "properties-footer");
    await vi.waitFor(() => expect(shown(footer)).toBe(false));
    const body = part(container, "properties-body");
    const padding = Number.parseFloat(getComputedStyle(body).paddingBlockStart) * 2;
    expect(box(container.querySelector(".fill") as Element).height).toBeCloseTo(
      box(body).height - padding,
      1,
    );
  });

  it("comes back when its content changes to fit while it has no room", async () => {
    const container = render(<Footed />);
    const footer = part(container, "properties-footer");
    const columnHeight = box(part(container, "properties-column")).height;
    rerender(<Footed ad={columnHeight} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(false));
    rerender(<Footed ad={120} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(true));
  });

  it("hides when text in the panel grows, alone or beside elements", async () => {
    const lines = (count: number) =>
      Array.from({ length: count }, () => "A line of text.").join(" ");
    const frame = (text: string, beside: boolean) => (
      <EditorFrame
        topBar="Image editor"
        properties={
          beside ? (
            <>
              <div style={{ blockSize: "20px" }} />
              {text}
            </>
          ) : (
            text
          )
        }
        propertiesFooter={
          <div className="ad" style={{ inlineSize: "160px", blockSize: "120px" }} />
        }
      >
        <p>Stage</p>
      </EditorFrame>
    );
    for (const beside of [false, true]) {
      const container = render(frame(lines(1), beside));
      const footer = part(container, "properties-footer");
      expect(shown(footer)).toBe(true);
      rerender(frame(lines(400), beside));
      await vi.waitFor(() => expect(shown(footer)).toBe(false));
      act(() => root?.unmount());
    }
  });

  it("stays in its column without a panel from 60 rem, hides below that, and keeps its content mounted", () => {
    const container = render(<Footed propertiesState="hidden" />);
    const footer = part(container, "properties-footer");
    const ad = container.querySelector(".ad");
    expect(shown(footer)).toBe(true);
    rerender(<Footed properties={false} />);
    expect(shown(footer)).toBe(true);
    expect(container.querySelector("aside")).toBeNull();
    rerender(<Footed />);
    expect(shown(footer)).toBe(true);
    // The same content, so an ad isn't requested again.
    expect(container.querySelector(".ad")).toBe(ad);
    act(() => root?.unmount());
    const narrow = render(<Footed />, "30rem");
    expect(getComputedStyle(part(narrow, "properties-footer")).display).toBe("none");
    rerender(<Footed propertiesState="hidden" />);
    expect(shown(part(narrow, "properties-footer"))).toBe(false);
  });

  it("stays at the foot of the column, at its own size, with the panel hidden or absent", async () => {
    const container = render(<Toggled />);
    const footer = part(container, "properties-footer");
    const aside = container.querySelector("aside") as HTMLElement;
    const stage = part(container, "stage");
    const toggle = container.querySelector(".hm-editor-frame-properties-button") as HTMLElement;
    const check = () => {
      expect(shown(footer)).toBe(true);
      // Outside any landmark, and adding none of its own.
      expect(footer.closest("aside, nav, header, main, section, [role]")).toBeNull();
      expect(footer.getAttribute("role")).toBeNull();
      const ad = box(container.querySelector(".ad") as Element);
      expect([ad.width, ad.height]).toEqual([160, 120]);
      const column = box(part(container, "properties-column"));
      expect(box(footer).bottom).toBeCloseTo(column.bottom, 1);
      expect(box(footer).right).toBeCloseTo(column.right, 1);
      return column.width;
    };
    // The panel is hidden; its controls behave as before.
    expect(aside.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const alone = check();
    const stageWidth = box(stage).width;
    // Toggling the panel back on shows it above the footer, in a column as wide.
    await userEvent.click(toggle);
    expect(aside.hidden).toBe(false);
    expect(check()).toBeCloseTo(alone, 1);
    expect(box(aside).bottom).toBeCloseTo(box(footer).top, 1);
    expect(box(aside).width).toBeCloseTo(alone, 1);
    // So the stage doesn't move.
    expect(box(stage).width).toBeCloseTo(stageWidth, 1);
    act(() => root?.unmount());

    // Without properties at all, the column holds just the footer, as wide.
    const bare = render(<Toggled properties={false} />);
    expect(bare.querySelector("aside")).toBeNull();
    expect(bare.querySelector(".hm-editor-frame-properties-button")).toBeNull();
    expect(shown(part(bare, "properties-footer"))).toBe(true);
    expect(box(part(bare, "properties-column")).width).toBeCloseTo(alone, 1);
    const ad = box(bare.querySelector(".ad") as Element);
    expect([ad.width, ad.height]).toEqual([160, 120]);
    expect(box(part(bare, "properties-footer")).bottom).toBeCloseTo(
      box(part(bare, "properties-column")).bottom,
      1,
    );
  });

  it("never floats over the stage alone between 45 and 60 rem", () => {
    const container = render(<Footed propertiesState="hidden" />, "52rem");
    expect(shown(part(container, "properties-footer"))).toBe(false);
    rerender(<Footed properties={false} />);
    expect(shown(part(container, "properties-footer"))).toBe(false);
    // With the panel shown it floats over the stage's end with it, as before.
    rerender(<Footed />);
    expect(getComputedStyle(part(container, "properties-column")).position).toBe("absolute");
    expect(shown(part(container, "properties-footer"))).toBe(true);
  });

  it("has no room without a panel when it's taller than the column, and the column takes none", async () => {
    const container = render(<Footed propertiesState="hidden" />);
    const footer = part(container, "properties-footer");
    const column = part(container, "properties-column");
    const columnHeight = box(column).height;
    rerender(<Footed propertiesState="hidden" ad={columnHeight} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(false));
    expect(footer.hasAttribute("data-hm-no-room")).toBe(true);
    expect(box(column).width).toBe(0);
    // It comes back once it fits again.
    rerender(<Footed propertiesState="hidden" ad={120} />);
    await vi.waitFor(() => expect(shown(footer)).toBe(true));
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
