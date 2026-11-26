import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultEditorPreferences,
  type EditorPreferences,
} from "../preferences/editor-preferences.js";
import { cleanUp, track } from "../test/dom.js";
import {
  type EditorPreferencesControls,
  type UseEditorPreferencesOptions,
  useEditorPreferences,
} from "./use-editor-preferences.js";

let root: Root | undefined;
let controls: EditorPreferencesControls | undefined;
let editor: HTMLElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  controls = undefined;
  editor = null;
  cleanUp();
});

/** An editor's root with the hook's attributes, handing its controls to the test. */
function Editor(options: UseEditorPreferencesOptions) {
  const prefs = useEditorPreferences(options);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    controls = prefs;
    editor = section.current;
  });
  return <section ref={section} {...prefs.rootAttributes} />;
}

/** Renders the editor in a page whose root sets `page`'s attributes. */
function render(options: UseEditorPreferencesOptions, page: Record<string, string> = {}) {
  const container = track(document.createElement("div"));
  for (const [name, value] of Object.entries(page)) {
    container.setAttribute(name, value);
  }
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Editor {...options} />));
  return (next: UseEditorPreferencesOptions) => act(() => root?.render(<Editor {...next} />));
}

function current(): EditorPreferencesControls {
  if (!controls) {
    throw new Error("the editor didn't render");
  }
  return controls;
}

const attributes = () => ({
  theme: editor?.getAttribute("data-hm-theme") ?? null,
  density: editor?.getAttribute("data-hm-density") ?? null,
  motion: editor?.getAttribute("data-hm-motion") ?? null,
});

describe("useEditorPreferences, uncontrolled", () => {
  it("starts in Advanced mode, inheriting the page's theme, density and motion", () => {
    render({});
    expect(current().preferences).toEqual({ ...defaultEditorPreferences, mode: "advanced" });
    expect(current().themeToggleValue).toBe("inherit");
    expect(attributes()).toEqual({ theme: null, density: null, motion: null });
  });

  it("starts from the host's defaults, and a field set there is chosen", () => {
    render({ defaultPreferences: { mode: "easy", density: "compact" } });
    expect(current().preferences.mode).toBe("easy");
    expect(current().isChosen("density")).toBe(true);
    expect(current().isChosen("theme")).toBe(false);
    expect(attributes()).toEqual({ theme: null, density: "compact", motion: null });
  });

  it("keeps a change, reports it, and chooses the inherited fields it changed", () => {
    const onPreferencesChange = vi.fn();
    const onChange = vi.fn();
    render({ onPreferencesChange, onChange });
    const previous = current().preferences;
    const next: EditorPreferences = { ...previous, theme: "dark", mode: "expert" };
    act(() => current().change(next));

    expect(current().preferences).toEqual(next);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      previous,
      preferences: next,
      chosen: ["theme"],
    });
    expect(onPreferencesChange).toHaveBeenCalledExactlyOnceWith(next);
    expect(current().themeToggleValue).toBe("dark");
    expect(attributes()).toEqual({ theme: "dark", density: null, motion: null });

    // Chosen stays chosen, even back to the value it inherited.
    act(() => current().change({ ...current().preferences, theme: "system" }));
    expect(attributes().theme).toBe("system");
  });

  it("lets the host's theme win on the root", () => {
    render({ theme: "light", defaultPreferences: { theme: "dark" } });
    expect(attributes().theme).toBe("light");
    expect(current().themeToggleValue).toBe("dark");
  });
});

describe("useEditorPreferences, controlled", () => {
  it("shows the host's preferences, every field chosen, and only reports changes", () => {
    const onPreferencesChange = vi.fn();
    const preferences: EditorPreferences = { ...defaultEditorPreferences, density: "compact" };
    const rerender = render({ preferences, onPreferencesChange });
    expect(current().preferences).toEqual(preferences);
    expect(current().themeToggleValue).toBe("system");
    expect(attributes()).toEqual({ theme: "system", density: "compact", motion: "system" });

    const next = { ...preferences, mode: "expert" } as const;
    act(() => current().change(next));
    expect(onPreferencesChange).toHaveBeenCalledExactlyOnceWith(next);
    // The host hasn't passed it back yet.
    expect(current().preferences.mode).toBe("easy");

    rerender({ preferences: next, onPreferencesChange });
    expect(current().preferences.mode).toBe("expert");
  });

  it("reads what the host passes, as readEditorPreferences does", () => {
    render({ preferences: { theme: "dark" } as EditorPreferences });
    expect(current().preferences).toEqual({
      ...defaultEditorPreferences,
      mode: "advanced",
      theme: "dark",
    });
  });
});

describe("useEditorPreferences, the settings", () => {
  const page = { "data-hm-theme": "dark", "data-hm-density": "compact" };

  it("show the page's values for the fields still inherited, read as they open", () => {
    render({}, page);
    expect(current().settings.open).toBe(false);
    act(() => current().openSettings(editor));
    expect(current().settings.open).toBe(true);
    expect(current().settings.value).toEqual({
      ...current().preferences,
      theme: "dark",
      density: "compact",
      motion: "system",
    });

    act(() => current().settings.onOpenChange(false));
    expect(current().settings.open).toBe(false);
  });

  it("never make the page's value the host's preference for a field left alone", () => {
    const onPreferencesChange = vi.fn();
    const onChange = vi.fn();
    render({ onPreferencesChange, onChange }, page);
    act(() => current().openSettings(editor));
    const { value } = current().settings;

    act(() => current().settings.onValueChange({ ...value, mode: "expert" }));
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...defaultEditorPreferences,
      mode: "expert",
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ chosen: [] }));
    expect(attributes()).toEqual({ theme: null, density: null, motion: null });

    // Changing a field in the settings chooses it, and only it.
    act(() =>
      current().settings.onValueChange({ ...current().settings.value, density: "comfortable" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ chosen: ["density"] }));
    expect(onPreferencesChange).toHaveBeenLastCalledWith({
      ...defaultEditorPreferences,
      mode: "expert",
      density: "comfortable",
    });
    expect(attributes()).toEqual({ theme: null, density: "comfortable", motion: null });
    expect(current().settings.value.theme).toBe("dark");
  });
});
