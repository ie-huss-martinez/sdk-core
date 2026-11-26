import { createShortcutRegistry, createToolRegistry, type Platform } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { audioEditorText } from "../../messages/editor-en.js";
import { audioTools, BAR_TOOLS, defaultAudioToolbar, TRANSPORT_TOOLS } from "./tools.js";

const text: Readonly<Record<string, unknown>> = audioEditorText;

describe("the tools' levels and groups (docs/adr/0007, sdk-core ADR 0067)", () => {
  it("gives each tool the spec's level and a description, and the bars' tools neither", () => {
    const levels = Object.fromEntries(
      audioTools.filter((tool) => !BAR_TOOLS.has(tool.id)).map((tool) => [tool.id, tool.level]),
    );
    expect(levels).toEqual({
      "audio.trim-start": "easy",
      "audio.trim-end": "easy",
      "audio.split": "easy",
      "audio.delete": "easy",
      "audio.fade-in": "easy",
      "audio.fade-out": "easy",
      "audio.play-pause": "easy",
      "audio.add-track": "advanced",
      "audio.remove-track": "advanced",
      "audio.mute": "advanced",
      "audio.insert": "advanced",
      "audio.move-earlier": "advanced",
      "audio.move-later": "advanced",
      "audio.set-start": "advanced",
      "audio.set-end": "advanced",
      "audio.clear-selection": "advanced",
      "audio.ripple": "expert",
      "audio.move-to-track-above": "expert",
      "audio.move-to-track-below": "expert",
      "audio.move-track-up": "expert",
      "audio.move-track-down": "expert",
      "audio.start": "expert",
      "audio.end": "expert",
    });
    for (const tool of audioTools) {
      if (BAR_TOOLS.has(tool.id)) {
        expect(tool.level, tool.id).toBeUndefined();
        expect(tool.description, tool.id).toBeUndefined();
      } else {
        expect(text[tool.description ?? ""], tool.id).toEqual(expect.any(String));
      }
    }
  });

  it("puts every tool but playback's in one default group, named after its first tool's group", () => {
    const listed = defaultAudioToolbar.flat();
    expect([...listed, ...TRANSPORT_TOOLS].sort()).toEqual(
      audioTools.map((tool) => tool.id).sort(),
    );
    const byId = new Map(audioTools.map((tool) => [tool.id, tool]));
    const names = defaultAudioToolbar
      .filter((group) => !group.every((id) => BAR_TOOLS.has(id)))
      .map((group) => text[`toolbar.${byId.get(group[0] ?? "")?.group}`]);
    expect(names).toEqual(["Cut", "Fade", "Clip", "Selection", "Tracks"]);
    // The bars' tools sit in groups of their own, so no panel group holds one.
    for (const group of defaultAudioToolbar) {
      const inBar = group.filter((id) => BAR_TOOLS.has(id));
      expect(inBar.length === 0 || inBar.length === group.length, group.join(" ")).toBe(true);
    }
  });

  it("register with sdk-core, with no two sharing a key on either platform", () => {
    const registry = createToolRegistry(audioTools, { toolbar: defaultAudioToolbar });
    for (const platform of ["apple", "other"] as Platform[]) {
      expect(() => createShortcutRegistry({ platform, tools: registry.tools })).not.toThrow();
    }
  });
});
