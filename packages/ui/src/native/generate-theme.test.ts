import { describe, expect, it } from "vitest";
import { resolveColor } from "../theme/color.js";
import { lightTheme } from "../theme/create-theme.js";
import { nativeOnlyTokens, nativeTokens, toHex, toNativeValue } from "./generate-theme.js";

const none = (): undefined => undefined;

describe("toNativeValue", () => {
  it.each([
    ["a rem length, at 16 dp", "1.25rem", "length", 20],
    ["a px length", "2px", "length", 2],
    ["a unitless zero", "0", "length", 0],
    ["seconds, as milliseconds", "1s", "duration", 1000],
    ["milliseconds", "150ms", "duration", 150],
    ["a number", "1.5", "number", 1.5],
    ["a weight, as React Native names it", "600", "font-weight", "600"],
    ["a curve", "cubic-bezier(0.2, 0, 0, 1)", "easing", [0.2, 0, 0, 1]],
    ["linear, as its curve", "linear", "easing", [0, 0, 1, 1]],
    ["an opaque colour", "oklch(1 0 0)", "color", "#ffffff"],
    ["a translucent colour, with its alpha", "oklch(0 0 0 / 0.6)", "color", "#00000099"],
  ] as const)("resolves %s", (_case, value, type, expected) => {
    expect(toNativeValue("probe", value, type, none)).toEqual(expected);
  });

  it("follows var() references through the theme", () => {
    const lookup = (token: string) =>
      ({ "space-3": "0.75rem", "inset-normal": "var(--hm-space-3)" })[token];
    expect(toNativeValue("probe", "var(--hm-inset-normal)", "length", lookup)).toBe(12);
  });

  it.each([
    ["a length with a unit a device has no size for", "2em", "length"],
    ["a reference to a token the theme lacks", "var(--hm-missing)", "length"],
    ["a colour that can't be computed", "color-mix(in oklch, red, blue)", "color"],
    ["a step function", "steps(4)", "easing"],
  ] as const)("stops on %s instead of guessing", (_case, value, type) => {
    expect(() => toNativeValue("probe", value, type, none)).toThrow(/probe has no native value/);
  });
});

describe("the native themes' values", () => {
  const native = nativeTokens(lightTheme, nativeOnlyTokens.light);

  it("are the web theme's own colours, resolved", () => {
    const lookup = (token: string) => lightTheme.tokens[token];
    const accent = resolveColor(lightTheme.tokens["color-accent"] as string, lookup);
    expect(native["color-accent"]).toBe(toHex(accent as NonNullable<typeof accent>));
  });

  it("take the coarse-pointer sizes, since a device is a touch screen", () => {
    expect(lightTheme.tokens["control-height"]).toBe("2rem");
    expect(native["control-height"]).toBe(44);
  });

  it("leave out what only CSS can say", () => {
    for (const token of ["font-family", "shadow-raised", "focus-ring", "color-scheme"]) {
      expect(native, token).not.toHaveProperty(token);
    }
  });
});
