import { isSdkError } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { contrastRatio, resolveColor } from "../theme/color.js";
import { contrastPairs } from "../tokens/contrast.js";
import { BUTTON_VARIANTS, buttonLook } from "./button-style.js";
import {
  createNativeTheme,
  darkNativeTheme,
  lightNativeTheme,
  type NativeTheme,
} from "./create-native-theme.js";
import { type NativeThemeTokens, nativeTokenKinds } from "./theme.generated.js";

const THEMES = [
  ["light", lightNativeTheme],
  ["dark", darkNativeTheme],
] as const;

const SURFACES = ["color-bg", "color-surface", "color-surface-raised"] as const;

/** The WCAG contrast of two colour tokens, the first over the second. */
function contrast(theme: NativeTheme, foreground: string, background: string): number {
  const color = (token: string) => {
    const value = theme.tokens[token as keyof NativeThemeTokens];
    const resolved = resolveColor(String(value), () => undefined);
    if (!resolved) {
      throw new Error(`${token} isn't a colour: ${String(value)}`);
    }
    return resolved;
  };
  return contrastRatio(color(foreground), color(background)) ?? 0;
}

describe.each(THEMES)("the built-in %s native theme", (name, theme) => {
  it("holds every token, each a value React Native's styles take", () => {
    expect(theme.colorScheme).toBe(name);
    expect(Object.keys(theme.tokens)).toEqual(Object.keys(nativeTokenKinds));
    // Its own values pass its own validation, token by token.
    expect(() => createNativeTheme({ extends: "light", tokens: theme.tokens })).not.toThrow();
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.tokens)).toBe(true);
  });

  it("meets WCAG 2.2 AA for the pairs the web themes must meet", () => {
    for (const pair of contrastPairs) {
      expect(
        contrast(theme, pair.foreground, pair.background),
        `${pair.foreground} on ${pair.background}`,
      ).toBeGreaterThanOrEqual(pair.minimum);
    }
  });

  it("meets it for the hint colours, which only the native themes have", () => {
    for (const background of [...SURFACES, "color-hint-subtle"]) {
      expect(contrast(theme, "color-hint-text", background), background).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    for (const surface of SURFACES) {
      expect(contrast(theme, "color-hint", surface), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(Object.entries(BUTTON_VARIANTS))(
    "draws the %s button's label with enough contrast, at rest and pressed",
    (_variant, tokens) => {
      // A quiet button has no fill: it sits on the surface behind it.
      const fills = tokens.background === undefined ? SURFACES : [tokens.background];
      for (const fill of [...fills, tokens.pressed]) {
        expect(contrast(theme, tokens.foreground, fill), fill).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(["selected", "success", "hint"] as const)(
    "tells the %s state apart by a border that stands out from every surface",
    (variant) => {
      const border = BUTTON_VARIANTS[variant].border as string;
      for (const surface of SURFACES) {
        expect(contrast(theme, border, surface), surface).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("gives touch its targets: 44 dp, and 64 dp for the large size", () => {
    expect(theme.tokens["control-height"]).toBe(44);
    expect(theme.tokens["target-size"]).toBe(44);
    expect(theme.tokens["control-height-large"]).toBe(64);
  });
});

describe("the hint colours", () => {
  it("are no danger colour, in either theme", () => {
    for (const [, theme] of THEMES) {
      const danger = Object.entries(theme.tokens)
        .filter(([token]) => token.includes("danger"))
        .map(([, value]) => value);
      for (const token of ["color-hint", "color-hint-subtle", "color-hint-text"] as const) {
        expect(danger).not.toContain(theme.tokens[token]);
      }
    }
  });

  it("are what a wrong pick is drawn with: no button variant uses a danger token", () => {
    const used = Object.values(BUTTON_VARIANTS).flatMap((tokens) => Object.values(tokens));
    expect(used.filter((token) => token?.includes("danger"))).toEqual([]);
    expect(BUTTON_VARIANTS.hint.foreground).toBe("color-hint-text");
  });
});

describe("buttonLook", () => {
  const look = (options: Partial<Parameters<typeof buttonLook>[1]> = {}) =>
    buttonLook(lightNativeTheme.tokens, {
      variant: "secondary",
      size: "medium",
      textScale: 1,
      pressed: false,
      focused: false,
      disabled: false,
      ...options,
    });

  it("grows the target with the text scale", () => {
    expect(look().container.minHeight).toBe(44);
    expect(look({ size: "large" }).container.minHeight).toBe(64);
    expect(look({ size: "large", textScale: 1.4 }).container.minHeight).toBeCloseTo(89.6);
  });

  it("shows focus on the border without changing the button's size", () => {
    const focused = look({ focused: true }).container;
    expect(focused.borderColor).toBe(lightNativeTheme.tokens["focus-ring-color"]);
    expect(focused.borderWidth).toBe(look().container.borderWidth);
    expect(look({ variant: "quiet" }).container.borderColor).toBe("transparent");
  });

  it("dims a disabled button, and doesn't show it pressed", () => {
    const disabled = look({ disabled: true, pressed: true }).container;
    expect(disabled.opacity).toBe(lightNativeTheme.tokens["opacity-disabled"]);
    expect(disabled.backgroundColor).toBe(look().container.backgroundColor);
    expect(look({ pressed: true }).container.backgroundColor).not.toBe(
      look().container.backgroundColor,
    );
  });
});

describe("createNativeTheme", () => {
  it("changes only the tokens given, and returns a frozen theme", () => {
    const theme = createNativeTheme({
      extends: "dark",
      tokens: { "color-accent": "#1F5F5B", "font-size-body": 22 },
    });
    expect(theme.colorScheme).toBe("dark");
    expect(theme.tokens["color-accent"]).toBe("#1F5F5B");
    expect(theme.tokens["font-size-body"]).toBe(22);
    expect(theme.tokens["color-bg"]).toBe(darkNativeTheme.tokens["color-bg"]);
    expect(Object.isFrozen(theme.tokens)).toBe(true);
    expect(darkNativeTheme.tokens["font-size-body"]).toBe(14);
  });

  it("builds on a theme it made, and on one read back from JSON", () => {
    const first = createNativeTheme({ extends: "light", tokens: { "radius-control": 0 } });
    const second = createNativeTheme({ extends: first, colorScheme: "dark" });
    expect(second.tokens["radius-control"]).toBe(0);
    expect(second.colorScheme).toBe("dark");
    const stored: unknown = JSON.parse(JSON.stringify(first));
    expect(createNativeTheme({ extends: stored as NativeTheme }).tokens).toEqual(first.tokens);
  });

  it.each([
    ["an unknown token", { "color-brand": "#000000" }, "color-brand"],
    ["a hostile key", JSON.parse('{"__proto__":"#000000"}'), "__proto__"],
    ["an inherited name", { toString: "#000000" }, "toString"],
    ["a CSS colour", { "color-accent": "oklch(0.5 0.1 200)" }, "color-accent"],
    ["a CSS length", { "font-size-body": "1rem" }, "font-size-body"],
    ["a number that isn't finite", { "control-height": Number.NaN }, "control-height"],
    [
      "a weight React Native has no name for",
      { "font-weight-strong": "650" },
      "font-weight-strong",
    ],
    [
      "a curve outside the unit square",
      { "motion-easing-enter": [2, 0, 0, 1] },
      "motion-easing-enter",
    ],
  ])("refuses %s, naming the token", (_case, tokens, token) => {
    let thrown: unknown;
    try {
      createNativeTheme({ extends: "light", tokens: tokens as never });
    } catch (error) {
      thrown = error;
    }
    expect(isSdkError(thrown, "INVALID_THEME_TOKEN")).toBe(true);
    expect((thrown as { details: { token: string } }).details.token).toBe(token);
  });

  it("refuses a theme to extend that lacks tokens, or isn't one", () => {
    const partial = { colorScheme: "light", tokens: { "color-bg": "#ffffff" } };
    expect(() => createNativeTheme({ extends: partial as never })).toThrow(/is missing/);
    expect(() => createNativeTheme({ extends: "sepia" as never })).toThrow(/extends takes/);
    expect(() => createNativeTheme(null as never)).toThrow(/options object/);
  });
});
