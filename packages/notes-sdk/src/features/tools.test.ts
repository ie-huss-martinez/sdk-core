import { isToolInMode } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { BAR_TOOLS, DEFAULT_TOOLBAR, notesTools } from "./tools.js";

/** The tools the panel lists in a mode, in the default groups (docs/adr/0008). */
const listed = (mode: "easy" | "advanced" | "expert") =>
  DEFAULT_TOOLBAR.flat().filter((id) => {
    const tool = notesTools.find((each) => each.id === id);
    return tool && !BAR_TOOLS.has(id) && isToolInMode(tool, mode);
  });

describe("the notebook's tools on ui's frame (docs/adr/0008)", () => {
  it("lists writing first, then selecting and adding, then the rest", () => {
    expect(listed("easy")).toEqual([
      "notes.pen",
      "notes.highlighter",
      "notes.eraser",
      "notes.text",
    ]);
    expect(listed("advanced")).toEqual([
      ...listed("easy"),
      "notes.lasso",
      "notes.image",
      "notes.link",
    ]);
    expect(listed("expert")).toEqual(DEFAULT_TOOLBAR.flat().filter((id) => !BAR_TOOLS.has(id)));
  });

  it("gives every tool of the panel a level, and the bar's none", () => {
    for (const tool of notesTools) {
      if (BAR_TOOLS.has(tool.id)) expect(tool.level, tool.id).toBeUndefined();
      else expect(tool.level, tool.id).toBeDefined();
    }
  });

  it("places every tool in a group once, but selection's, which only keys and the palette reach", () => {
    const grouped = DEFAULT_TOOLBAR.flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(notesTools.map((tool) => tool.id).filter((id) => !grouped.includes(id))).toEqual([
      "notes.select-all",
      "notes.delete-selection",
    ]);
  });
});
