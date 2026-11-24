import { describe, expect, it } from "vitest";
import { type CommandPaletteItem, filterCommandPaletteItems } from "./filter.js";

const items: CommandPaletteItem[] = [
  { id: "crop", label: "Crop", description: "Cut the edges off" },
  { id: "rotate-left", label: "Rotate left", group: "Orientation", keywords: ["turn"] },
  { id: "rotate-right", label: "Rotate right", group: "Orientation" },
  { id: "edges", label: "Sharpen", description: "Make edges rotate-proof" },
  { id: "write", label: "Écrire du texte" },
];

const ids = (query: string) => filterCommandPaletteItems(items, query).map((item) => item.id);

describe("filterCommandPaletteItems", () => {
  it("finds every item, in order, for an empty or blank query", () => {
    expect(ids("")).toEqual(items.map((item) => item.id));
    expect(ids("  ")).toEqual(items.map((item) => item.id));
  });

  it("matches word prefixes, ignoring case and accents", () => {
    expect(ids("ROT LE")).toEqual(["rotate-left"]);
    expect(ids("ecr")).toEqual(["write"]);
    expect(ids("otate")).toEqual([]);
  });

  it("searches descriptions, groups and keywords, ranking label matches first", () => {
    expect(ids("rot")).toEqual(["rotate-left", "rotate-right", "edges"]);
    expect(ids("orientation")).toEqual(["rotate-left", "rotate-right"]);
    expect(ids("turn")).toEqual(["rotate-left"]);
    expect(ids("cut edges")).toEqual(["crop"]);
  });

  it("needs every word of the query to match", () => {
    expect(ids("rotate turn")).toEqual(["rotate-left"]);
    expect(ids("crop turn")).toEqual([]);
  });
});
