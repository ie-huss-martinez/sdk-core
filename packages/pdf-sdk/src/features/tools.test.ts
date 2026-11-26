import { describe, expect, it } from "vitest";
import { pdfEditorText } from "../messages/editor-en.js";
import { BAR_TOOLS, DEFAULT_TOOLBAR, pdfTools } from "./tools.js";

const text: Readonly<Record<string, unknown>> = pdfEditorText;

describe("the tools' levels and groups (docs/adr/0012, sdk-core ADR 0067)", () => {
  it("gives each panel tool the spec's level and a description, and the bar's tools neither", () => {
    const levels = Object.fromEntries(
      pdfTools.filter((tool) => !BAR_TOOLS.has(tool.id)).map((tool) => [tool.id, tool.level]),
    );
    expect(levels).toEqual({
      "pdf.rotate-left": "easy",
      "pdf.rotate-right": "easy",
      "pdf.delete-pages": "easy",
      "pdf.insert-pages": "easy",
      "pdf.move-earlier": "advanced",
      "pdf.move-later": "advanced",
    });
    for (const tool of pdfTools) {
      if (BAR_TOOLS.has(tool.id)) {
        expect(tool.level, tool.id).toBeUndefined();
        expect(tool.description, tool.id).toBeUndefined();
      } else {
        expect(text[tool.description ?? ""], tool.id).toEqual(expect.any(String));
      }
    }
  });

  it("puts every tool in one default group, named after its first tool's group", () => {
    const listed = DEFAULT_TOOLBAR.flat();
    expect([...listed].sort()).toEqual(pdfTools.map((tool) => tool.id).sort());
    const byId = new Map(pdfTools.map((tool) => [tool.id, tool]));
    const names = DEFAULT_TOOLBAR.filter((group) => !group.every((id) => BAR_TOOLS.has(id))).map(
      (group) => text[`toolbar.groups.${byId.get(group[0] ?? "")?.group}`],
    );
    expect(names).toEqual(["Rotate", "Remove and add", "Reorder"]);
    // The bar's tools sit in groups of their own, so no panel group holds one.
    for (const group of DEFAULT_TOOLBAR) {
      const inBar = group.filter((id) => BAR_TOOLS.has(id));
      expect(inBar.length === 0 || inBar.length === group.length, group.join(" ")).toBe(true);
    }
  });
});
