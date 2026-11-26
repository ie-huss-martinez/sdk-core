import { describe, expect, it } from "vitest";
import { inheritedValues } from "./inherited.js";

/** A chain of elements, outermost first, each with its attributes, and the editor's root inside. */
function chain(...levels: Record<string, string>[]) {
  type Node = { parentElement: Node | null; getAttribute(name: string): string | null };
  let parent: Node | null = null;
  for (const attributes of levels) {
    parent = { parentElement: parent, getAttribute: (name) => attributes[name] ?? null };
  }
  return { parentElement: parent, getAttribute: () => null } as unknown as Element;
}

describe("inheritedValues", () => {
  it("takes each field from the nearest ancestor with a value ui knows", () => {
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

  it("skips a value ui doesn't know, as CSS does, and goes further out", () => {
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

  it("falls back to ui's own values without an ancestor or a root", () => {
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
