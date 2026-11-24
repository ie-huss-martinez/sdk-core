import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultEditorPreferences } from "../../preferences/editor-preferences.js";
import { ModeSwitch } from "../mode-switch/ModeSwitch.js";
import { SettingsPanel } from "../settings-panel/SettingsPanel.js";
import { TabBar } from "../tab-bar/TabBar.js";
import { ThemeToggle } from "../theme-toggle/ThemeToggle.js";
import { ToolList } from "../tool-list/ToolList.js";
import { EditorFrame, EditorFrameToolsButton } from "./EditorFrame.js";

const groups = [
  {
    id: "orientation",
    label: "Orientation",
    items: [
      {
        id: "rotate",
        label: "Rotate",
        description: "Turn it a quarter",
        icon: <svg />,
        shortcut: "]",
      },
      { id: "flip", label: "Flip", icon: <svg />, disabled: true },
    ],
  },
];

describe("EditorFrame on the server", () => {
  it("renders the landmarks, states and edge tabs", () => {
    const html = renderToString(
      <EditorFrame
        topBar={<EditorFrameToolsButton />}
        tools={<ToolList label="Image tools" groups={groups} onRun={() => {}} />}
        properties={<p>Props</p>}
        bottom={<p>Timeline</p>}
        toolsState="hidden"
        propertiesState="shown"
      >
        <main>Stage</main>
      </EditorFrame>,
    );
    expect(html).toContain(
      'class="hm-editor-frame" data-hm-tools="hidden" data-hm-properties="shown" data-hm-layout="sidebar"',
    );
    expect(html).toMatch(/<header class="hm-editor-frame-top">/);
    expect(html).toMatch(
      /<nav id="[^"]+" aria-label="Tools" class="hm-editor-frame-tools" hidden="">/,
    );
    expect(html).toMatch(
      /<aside id="[^"]+" aria-label="Properties" class="hm-editor-frame-properties">/,
    );
    // The edge tab and the top bar's button both say the tools are collapsed.
    expect(html).toMatch(
      /class="hm-editor-frame-edge hm-editor-frame-edge--tools" aria-controls="[^"]+" aria-expanded="false"/,
    );
    expect(html).toContain('aria-label="Show tools"');
  });

  it("leaves out panels it has no content for", () => {
    const html = renderToString(<EditorFrame>Stage</EditorFrame>);
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("data-hm-tools");
    expect(renderToString(<EditorFrameToolsButton />)).toBe("");
  });
});

describe("ToolList on the server", () => {
  it("names rows by their label, describes them, and keeps disabled tools focusable", () => {
    const html = renderToString(
      <ToolList label="Image tools" groups={groups} onRun={() => {}} descriptions shortcuts />,
    );
    expect(html).toContain('role="toolbar" aria-label="Image tools" aria-orientation="vertical"');
    expect(html).toContain('role="group" aria-label="Orientation"');
    expect(html).toMatch(/aria-label="Rotate" aria-describedby="[^"]+"/);
    expect(html).toContain("Turn it a quarter");
    expect(html).toContain("<kbd>]</kbd>");
    expect(html).toContain('aria-label="Flip"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });

  it("shows icons only with tooltips naming them", () => {
    const html = renderToString(
      <ToolList label="Image tools" groups={groups} onRun={() => {}} display="icons" />,
    );
    expect(html).toContain("hm-tool-list--icons");
    expect(html).not.toContain("hm-tool-list-group-label");
    expect(html).toContain('role="tooltip"');
  });
});

describe("the frame's controls on the server", () => {
  it("renders the mode switch as a named radio group", () => {
    const html = renderToString(<ModeSwitch value="advanced" onValueChange={() => {}} />);
    expect(html).toContain('aria-label="Experience"');
    expect(html).toMatch(/aria-checked="true"[^>]*>.*Advanced/);
  });

  it("renders the theme toggle as a pressed state the server can't know, so light", () => {
    const html = renderToString(<ThemeToggle value="system" onValueChange={() => {}} />);
    expect(html).toContain('aria-label="Dark theme"');
    expect(html).toContain('aria-pressed="false"');
    expect(renderToString(<ThemeToggle value="dark" onValueChange={() => {}} />)).toContain(
      'aria-pressed="true"',
    );
  });

  it("renders at most max tabs, then More", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id.toUpperCase(),
      icon: <svg />,
    }));
    const html = renderToString(
      <TabBar
        label="Tools"
        items={items}
        value="b"
        onValueChange={() => {}}
        max={3}
        onMore={() => {}}
      />,
    );
    expect(html.match(/hm-tab-bar-item/g)).toHaveLength(4);
    expect(html).toContain(">More<");
    expect(html).not.toContain(">D<");
  });

  it("renders the settings panel closed, with the settings asked for", () => {
    const html = renderToString(
      <SettingsPanel
        open={false}
        onOpenChange={() => {}}
        value={defaultEditorPreferences}
        onValueChange={() => {}}
        settings={["theme", "tips"]}
      />,
    );
    expect(html).toContain("hm-sheet hm-sheet--auto hm-settings-panel");
    expect(html).toContain('aria-label="Appearance"');
    expect(html).toContain('aria-label="Tips"');
    expect(html).not.toContain('aria-label="Density"');
  });
});
