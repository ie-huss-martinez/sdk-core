import { describe, expect, it } from "vitest";
import { isRTL } from "./direction.js";

describe("isRTL", () => {
  it.each(["ar", "ar-SA", "AR_eg", "he", "iw", "fa-IR", "ur", "ckb", "az-Arab", "ks-Arab-IN"])(
    "reads %s as right to left",
    (locale) => {
      expect(isRTL(locale)).toBe(true);
    },
  );

  it.each(["es", "en-US", "es_ES", "ur-Latn", "az", "ku", "", "arabic"])(
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
