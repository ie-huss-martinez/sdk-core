import { describe, expect, it } from "vitest";
import { arabicProfile, englishProfile, spanishProfile } from "../model/language-profiles.js";
import { DEFAULT_MATCH_DISTANCE, editDistance, matchTolerantly } from "./tolerant-match.js";

describe("editDistance", () => {
  it("counts letters added, removed or replaced, in code points", () => {
    expect(editDistance("gato", "gata")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
    // One emoji is one letter, though it's two UTF-16 units.
    expect(editDistance("a\u{1F34E}", "a\u{1F34F}")).toBe(1);
  });
});

describe("matchTolerantly", () => {
  it("finds the word inside a sentence", () => {
    expect(
      matchTolerantly("I think it's an apple", ["apple"], { profile: englishProfile }),
    ).toEqual({
      match: true,
      distance: 0,
    });
    expect(
      matchTolerantly("creo que es una manzana", ["manzana"], { profile: spanishProfile }).match,
    ).toBe(true);
  });

  it("forgives an article and a plural when the profile can", () => {
    expect(matchTolerantly("the apples", ["apple"], { profile: englishProfile }).distance).toBe(0);
    expect(
      matchTolerantly("las manzanas", ["la manzana"], { profile: spanishProfile }).distance,
    ).toBe(0);
    // "al-tuffaha" for "tuffaha": the attached article.
    expect(
      matchTolerantly("التفاحة", ["تفاحة"], {
        profile: arabicProfile,
      }).distance,
    ).toBe(0);
    // Without a profile's stem, a plural is a slip like any other.
    expect(matchTolerantly("apples", ["apple"]).distance).toBeCloseTo(1 / 6);
  });

  it("forgives one slip in four letters, and no more", () => {
    expect(DEFAULT_MATCH_DISTANCE).toBe(0.25);
    expect(matchTolerantly("aple", ["apple"]).match).toBe(true);
    expect(matchTolerantly("cat", ["car"]).match).toBe(false);
    expect(matchTolerantly("banana", ["apple"]).match).toBe(false);
    expect(matchTolerantly("cat", ["car"], { maxDistance: 0.5 }).match).toBe(true);
    expect(matchTolerantly("aple", ["apple"], { maxDistance: 0 }).match).toBe(false);
  });

  it("matches a name of several words, with the spaces a recogniser adds or drops", () => {
    expect(matchTolerantly("ice cream", ["icecream"]).distance).toBe(0);
    expect(matchTolerantly("it is an icecream cone", ["ice cream"]).distance).toBe(0);
  });

  it("takes the best of a recogniser's alternatives, and of the accepted answers", () => {
    expect(
      matchTolerantly(["a pear", "a bear"], ["bear"], { profile: englishProfile }).distance,
    ).toBe(0);
    expect(matchTolerantly("carro", ["coche", "carro", "auto"]).distance).toBe(0);
  });

  it("refuses an answer that's closer to another choice on offer", () => {
    expect(matchTolerantly("cat", ["cart"]).match).toBe(true);
    expect(matchTolerantly("cat", ["cart"], { others: ["cat"] })).toEqual({
      match: false,
      distance: 0.25,
    });
    // Equally close isn't closer.
    expect(matchTolerantly("cart", ["cart"], { others: ["cart"] }).match).toBe(true);
  });

  it("never matches an empty answer, or an empty accepted answer", () => {
    expect(matchTolerantly("", ["apple"])).toEqual({ match: false, distance: 1 });
    expect(matchTolerantly("...", ["apple"], { profile: englishProfile }).match).toBe(false);
    expect(matchTolerantly("apple", []).match).toBe(false);
    expect(matchTolerantly("the", ["the"], { profile: englishProfile }).match).toBe(false);
  });

  it("refuses a distance that isn't one, and a stem that doesn't return text", () => {
    expect(() => matchTolerantly("a", ["a"], { maxDistance: 2 })).toThrow(TypeError);
    expect(() => matchTolerantly("a", ["a"], { maxDistance: Number.NaN })).toThrow(TypeError);
    const broken = { ...englishProfile, stem: () => 1 as never };
    expect(() => matchTolerantly("apples", ["apple"], { profile: broken })).toThrow(TypeError);
  });

  it("doesn't compare runs that are too long or short to match, so a long answer stays cheap", () => {
    const long = Array.from({ length: 1000 }, (_, index) => `w${index}`).join(" ");
    const started = performance.now();
    expect(matchTolerantly(long, ["apple"]).match).toBe(false);
    expect(matchTolerantly(`${long} apple`, ["apple"]).match).toBe(true);
    // A second is a hundred times what it takes; unpruned, it's many seconds.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
