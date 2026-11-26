import { describe, expect, it } from "vitest";
import { readEditorPreferences } from "./editor-preferences.js";
import { fromSettings, inheritedValues, settingsValue } from "./inherited.js";

/** A chain of elements, outermost first, each with its attributes, and an editor's root inside. */
function chain(...levels: Record<string, string>[]) {
  type Node = { parentElement: Node | null; getAttribute(name: string): string | null };
  let parent: Node | null = null;
  for (const attributes of levels) {
    parent = { parentElement: parent, getAttribute: (name) => attributes[name] ?? null };
  }
  return { parentElement: parent, getAttribute: () => null } as unknown as Element;
}

describe("inheritedValues", () => {
  it("takes each field from the nearest ancestor with a value the tokens know", () => {
    const root = chain(
      { "data-hm-theme": "dark", "data-hm-density": "compact" },
      { "data-hm-density": "comfortable", "data-hm-motion": "reduced" },
    );
    expect(inheritedValues(root)).toEqual({
      theme: "dark",
      density: "comfortable",
      motion: "reduced",
    });
  });

  it("skips a value the tokens don't know, as CSS does, and goes further out", () => {
    const root = chain(
      { "data-hm-density": "compact" },
      { "data-hm-density": "tiny", "data-hm-theme": "" },
    );
    expect(inheritedValues(root)).toEqual({
      theme: "system",
      density: "compact",
      motion: "system",
    });
  });

  it("falls back to the tokens' own values without an ancestor or a root", () => {
    expect(inheritedValues(chain())).toEqual({
      theme: "system",
      density: "comfortable",
      motion: "system",
    });
    expect(inheritedValues(null)).toEqual({
      theme: "system",
      density: "comfortable",
      motion: "system",
    });
  });
});

describe("settingsValue", () => {
  const preferences = readEditorPreferences({ theme: "light", density: "compact" });
  const inherited = { theme: "dark", density: "comfortable", motion: "reduced" } as const;

  it("shows the preferences until the inherited values are read", () => {
    expect(settingsValue(preferences, () => false, null)).toBe(preferences);
  });

  it("shows the values in effect for the fields not chosen", () => {
    const shown = settingsValue(preferences, (field) => field === "density", inherited);
    expect(shown).toEqual({ ...preferences, theme: "dark", density: "compact", motion: "reduced" });
  });
});

describe("fromSettings", () => {
  const preferences = readEditorPreferences({ theme: "light", density: "compact" });
  const notChosen = () => false;
  const shown = settingsValue(preferences, notChosen, {
    theme: "dark",
    density: "comfortable",
    motion: "reduced",
  });

  it("chooses only the fields that differ from what the settings showed", () => {
    const choice = fromSettings({ ...shown, theme: "light" }, shown, preferences, notChosen);
    expect(choice.chosen).toEqual(["theme"]);
    expect(choice.preferences.theme).toBe("light");
  });

  it("keeps the preference of an inherited field left alone, never the page's value", () => {
    const choice = fromSettings({ ...shown, mode: "expert" }, shown, preferences, notChosen);
    expect(choice.chosen).toEqual([]);
    expect(choice.preferences).toEqual({ ...preferences, mode: "expert" });
  });

  it("takes the shown value of a field already chosen", () => {
    const choice = fromSettings(shown, shown, preferences, (field) => field === "motion");
    expect(choice.preferences.motion).toBe("reduced");
    expect(choice.preferences.theme).toBe("light");
  });
});
