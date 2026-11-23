import { describe, expect, it } from "vitest";
import { NOTES_MAX_SEARCH_HITS, searchPageTexts } from "./search.js";

const entry = (page: string, typed: string, pdf?: string) => ({
  notebook: "book",
  page,
  typed,
  ...(pdf === undefined ? {} : { pdf }),
});

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
