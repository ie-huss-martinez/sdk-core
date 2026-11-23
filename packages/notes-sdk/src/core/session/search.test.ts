import { describe, expect, it } from "vitest";
import { NOTES_MAX_SEARCH_HITS, searchPageTexts } from "./search.js";

const entry = (page: string, typed: string, pdf?: string) => ({
  notebook: "book",
  page,
  typed,
  ...(pdf === undefined ? {} : { pdf }),
});

/** Whether a string has no half of a surrogate pair on its own. */
const wellFormed = (value: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

describe("searchPageTexts", () => {
  it("finds a query in typed text and in a PDF's text, each as its own hit", () => {
    const hits = searchPageTexts(
      [entry("p1", "Newton's second law", "The law of inertia"), entry("p2", "Nothing here")],
      "law",
    );
    expect(hits.map((hit) => [hit.page, hit.source])).toEqual([
      ["p1", "typed"],
      ["p1", "pdf"],
    ]);
  });

  it("ignores case, compatibility forms and line breaks", () => {
    const [hit] = searchPageTexts(
      [entry("p1", "Kinetic\nENERGY of a \uFB01eld")],
      "energy  of a field",
    );
    expect(hit).toBeDefined();
    expect(hit?.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe(
      "energy of a field",
    );
  });

  it("shows the words around the match, cut at spaces", () => {
    const text = `${"lorem ipsum ".repeat(20)}the needle is here ${"dolor sit ".repeat(20)}`;
    const [hit] = searchPageTexts([entry("p1", text)], "needle");
    expect(hit?.snippet.length).toBeLessThan(110);
    expect(hit?.snippet).toContain("the needle is here");
    expect(hit?.snippet.startsWith(" ")).toBe(false);
    expect(hit?.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("needle");
  });

  it("folds case the same way on both sides, as for a final sigma and a sharp s", () => {
    // Lowercase writes the last sigma of a word differently from a lone one.
    expect(searchPageTexts([entry("p1", "\u039F\u03A3")], "\u03A3")).toHaveLength(1);
    expect(searchPageTexts([entry("p1", "\u03BF\u03C2")], "\u03C3")).toHaveLength(1);
    expect(searchPageTexts([entry("p1", "Stra\u00DFe")], "STRASSE")).toHaveLength(1);
    expect(searchPageTexts([entry("p1", "STRA\u1E9EE")], "stra\u00DFe")).toHaveLength(1);
  });

  it("never cuts a snippet through the middle of a character", () => {
    const [before] = searchPageTexts([entry("p1", `\u{1F600}${"x".repeat(39)}needle`)], "needle");
    expect(wellFormed(before?.snippet ?? "")).toBe(true);
    expect(before?.snippet.slice(before.matchStart, before.matchStart + 6)).toBe("needle");
    const [after] = searchPageTexts(
      [entry("p1", `needle${"x".repeat(39)}\u{1F600}tail`)],
      "needle",
    );
    expect(after?.snippet.slice(after.matchStart, after.matchStart + 6)).toBe("needle");
    expect(wellFormed(after?.snippet ?? "")).toBe(true);
  });

  it("finds nothing for an empty query", () => {
    expect(searchPageTexts([entry("p1", "anything")], "   ")).toEqual([]);
  });

  it("stops at the most hits a search returns", () => {
    const entries = Array.from({ length: NOTES_MAX_SEARCH_HITS + 50 }, (_, index) =>
      entry(`p${index}`, "match"),
    );
    expect(searchPageTexts(entries, "match")).toHaveLength(NOTES_MAX_SEARCH_HITS);
  });
});
