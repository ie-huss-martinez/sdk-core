import { describe, expect, it } from "vitest";
import { isRTL } from "./direction.js";

describe("isRTL", () => {
  it.each([
    "ar",
    "ar-SA",
    "AR_eg",
    "he",
    "iw",
    "fa-IR",
    "ur",
    "ckb",
    "az-Arab",
    "ks-Arab-IN",
    // Latin digits, not Latin script.
    "ar-u-nu-latn",
    "ar-EG-u-nu-latn",
    // An extended language subtag before the script.
    "zh-uig-Arab",
  ])("reads %s as right to left", (locale) => {
    expect(isRTL(locale)).toBe(true);
  });

  it.each(["es", "en-US", "es_ES", "ur-Latn", "az", "ku", "", "arabic", "en-x-arab", "en-GB-arab"])(
    "reads %s as left to right",
    (locale) => {
      expect(isRTL(locale)).toBe(false);
    },
  );

  it("reads anything that isn't a tag as left to right", () => {
    expect(isRTL(undefined as never)).toBe(false);
    expect(isRTL(null as never)).toBe(false);
  });
});
