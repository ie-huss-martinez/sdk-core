import { afterEach, describe, expect, it } from "vitest";
import { normalizeForGrading } from "./language-profile.js";
import { arabicProfile, englishProfile, spanishProfile } from "./language-profiles.js";

const same = (profile: typeof spanishProfile, a: string, b: string) =>
  normalizeForGrading(a, profile) === normalizeForGrading(b, profile);

describe("the Spanish and English profiles", () => {
  it("compare without case, accents, punctuation or extra spaces", () => {
    expect(normalizeForGrading("  ¿Qué   tal?  ", spanishProfile)).toBe("que tal");
    expect(same(spanishProfile, "ÁRBOL", "arbol")).toBe(true);
    expect(same(spanishProfile, "pingüino", "pinguino")).toBe(true);
    expect(same(spanishProfile, "niño", "nino")).toBe(true);
    expect(same(englishProfile, "Don’t!", "dont")).toBe(true);
    expect(same(englishProfile, "café", "CAFE")).toBe(true);
  });

  it("read an accent typed as a separate mark as the same letter", () => {
    // "e" followed by U+0301, as some keyboards and NFD text give it.
    expect(same(spanishProfile, "café", "café")).toBe(true);
  });

  it("keep words that differ apart", () => {
    expect(same(spanishProfile, "casa", "cosa")).toBe(false);
    expect(same(englishProfile, "its", "it is")).toBe(false);
  });

  it("stem plurals conservatively", () => {
    expect(spanishProfile.stem?.("manzanas")).toBe("manzana");
    expect(spanishProfile.stem?.("luces")).toBe("luz");
    expect(spanishProfile.stem?.("flores")).toBe("flor");
    expect(spanishProfile.stem?.("mes")).toBe("mes");
    expect(englishProfile.stem?.("grapes")).toBe("grape");
    expect(englishProfile.stem?.("berries")).toBe("berry");
    expect(englishProfile.stem?.("boxes")).toBe("box");
    expect(englishProfile.stem?.("glass")).toBe("glass");
  });
});

describe("the Arabic profile", () => {
  it("is right to left", () => {
    expect(arabicProfile).toMatchObject({ code: "ar", direction: "rtl" });
  });

  it("compares without tashkeel or tatweel", () => {
    // "kitab" with full vowel marks, and stretched with tatweel.
    expect(same(arabicProfile, "كِتَابٌ", "كتاب")).toBe(true);
    expect(same(arabicProfile, "كتــاب", "كتاب")).toBe(true);
  });

  it("unifies the forms of alef, ta marbuta with ha, and alef maqsura with ya", () => {
    // Ahmad with hamza above, below, madda and wasla, and bare.
    for (const alef of ["أ", "إ", "آ", "ٱ"]) {
      expect(same(arabicProfile, `${alef}حمد`, "احمد")).toBe(true);
    }
    // "madrasa" ending in ta marbuta or ha; "mustashfa" in alef maqsura or ya.
    expect(same(arabicProfile, "مدرسة", "مدرسه")).toBe(true);
    expect(same(arabicProfile, "مستشفى", "مستشفي")).toBe(true);
  });

  it("reads Arabic punctuation as a space, and keeps different words apart", () => {
    expect(normalizeForGrading("نعم، لا؟", arabicProfile)).toBe("نعم لا");
    expect(same(arabicProfile, "قلم", "كلم")).toBe(false);
  });

  it("stems off the attached article, and a plural ending", () => {
    // "al-kitab" and "wal-kitab" to "kitab"; "tuffahat" to "tuffah".
    expect(arabicProfile.stem?.("الكتاب")).toBe("كتاب");
    expect(arabicProfile.stem?.("والكتاب")).toBe("كتاب");
    expect(arabicProfile.stem?.("تفاحات")).toBe("تفاح");
  });
});

describe("the built-in profiles on an engine with less", () => {
  const normalize = String.prototype.normalize;
  const lower = String.prototype.toLowerCase;
  const intl = globalThis.Intl;

  afterEach(() => {
    String.prototype.normalize = normalize;
    String.prototype.toLowerCase = lower;
    globalThis.Intl = intl;
  });

  it("give the same results without normalize, Intl or the engine's case mapping", () => {
    const inputs = [
      [spanishProfile, "  ¿QuÉ   tal?  "],
      [spanishProfile, "café"],
      [englishProfile, "Don’t STOP!"],
      [arabicProfile, "أَحْمَد، مدرسة"],
    ] as const;
    const withAll = inputs.map(([profile, text]) => normalizeForGrading(text, profile));
    // biome-ignore lint/suspicious/noExplicitAny: removing built-ins is the case.
    delete (String.prototype as any).normalize;
    String.prototype.toLowerCase = () => {
      throw new Error("the engine's case mapping was used");
    };
    // biome-ignore lint/suspicious/noExplicitAny: removing a global is the case.
    delete (globalThis as any).Intl;
    expect(inputs.map(([profile, text]) => normalizeForGrading(text, profile))).toEqual(withAll);
    expect(withAll).toEqual(["que tal", "cafe", "dont stop", "احمد مدرسه"]);
  });
});
