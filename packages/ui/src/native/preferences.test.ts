import { describe, expect, it } from "vitest";
import {
  clampTextScale,
  defaultNativePreferences,
  nativePreferenceOptions,
  readNativePreferences,
} from "./preferences.js";

describe("readNativePreferences", () => {
  it("returns the defaults for anything that isn't preferences, frozen", () => {
    for (const value of [null, undefined, "dark", 3, [], JSON.parse("{}")]) {
      expect(readNativePreferences(value)).toEqual(defaultNativePreferences);
    }
    expect(Object.isFrozen(readNativePreferences(null))).toBe(true);
  });

  it("keeps valid fields, defaults the rest and drops unknown ones", () => {
    const read = readNativePreferences({
      theme: "dark",
      textScale: 1.2,
      motion: "sometimes",
      density: "compact",
    });
    expect(read).toEqual({ theme: "dark", textScale: 1.2, motion: "system" });
  });

  it("brings a stored text scale into range, and refuses one that isn't a number", () => {
    expect(readNativePreferences({ textScale: 9 }).textScale).toBe(2);
    expect(readNativePreferences({ textScale: 0.5 }).textScale).toBe(1);
    expect(readNativePreferences({ textScale: "1.4" }).textScale).toBe(1);
    expect(readNativePreferences({ textScale: Number.NaN }).textScale).toBe(1);
  });

  it("uses the application's defaults where it has them", () => {
    expect(
      readNativePreferences({ theme: "light" }, { textScale: 1.4, motion: "reduced" }),
    ).toEqual({ theme: "light", textScale: 1.4, motion: "reduced" });
  });

  it("never throws, and reads no inherited value", () => {
    const hostile = new Proxy(
      {},
      {
        has: () => true,
        getOwnPropertyDescriptor: () => {
          throw new Error("no");
        },
      },
    );
    expect(readNativePreferences(hostile)).toEqual(defaultNativePreferences);
    expect(readNativePreferences(Object.create({ theme: "dark" }))).toEqual(
      defaultNativePreferences,
    );
  });

  it("offers steps that are all valid", () => {
    for (const step of nativePreferenceOptions.textScale) {
      expect(clampTextScale(step)).toBe(step);
    }
  });
});
