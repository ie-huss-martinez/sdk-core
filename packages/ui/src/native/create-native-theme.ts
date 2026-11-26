import { UiError } from "../errors/ui-error.js";
import {
  darkNativeTokens,
  lightNativeTokens,
  type NativeThemeTokens,
  nativeTokenKinds,
} from "./theme.generated.js";

/**
 * A theme for React Native: every token resolved to a value a style takes.
 * Create it with {@link createNativeTheme}; it's frozen.
 *
 * @public
 */
export interface NativeTheme {
  readonly colorScheme: "light" | "dark";
  /** Every token value, by the web token's name without `--hm-`. */
  readonly tokens: NativeThemeTokens;
}

/**
 * A light and a dark native theme used together, so `NativeUiProvider` can
 * follow the device's appearance.
 *
 * @public
 */
export interface NativeThemePair {
  readonly light: NativeTheme;
  readonly dark: NativeTheme;
}

/**
 * What {@link createNativeTheme} accepts: the theme to start from, and the
 * tokens that change.
 *
 * @public
 */
export interface NativeThemeInput {
  /** The theme to start from: a built-in one by name, or one from `createNativeTheme`. */
  readonly extends: NativeTheme | "light" | "dark";
  /** Whether the theme is light or dark. Defaults to the extended theme's. */
  readonly colorScheme?: "light" | "dark";
  readonly tokens?: { readonly [Name in keyof NativeThemeTokens]?: NativeThemeTokens[Name] };
}

/** The names of the colour tokens. */
export type ColorToken = {
  [Name in keyof NativeThemeTokens]: Name extends `color-${string}` ? Name : never;
}[keyof NativeThemeTokens];

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const WEIGHT = /^[1-9]00$/;
/** Themes this module made, which need no second validation. */
const CREATED = /* @__PURE__ */ new WeakSet<object>();

function invalidToken(token: string, value: unknown, reason: string): UiError {
  const shown = typeof value === "string" ? value.slice(0, 200) : typeof value;
  return new UiError(
    "INVALID_THEME_TOKEN",
    `The theme token "${token}" can't be used: ${reason}.`,
    { details: { token, value: shown, reason } },
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Why a value can't be the token's, or `undefined` when it can. */
function refusal(kind: (typeof nativeTokenKinds)[keyof NativeThemeTokens], value: unknown) {
  switch (kind) {
    case "color":
      return typeof value === "string" && HEX.test(value)
        ? undefined
        : "a colour is #rgb, #rrggbb or #rrggbbaa";
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : "the value must be a finite number";
    case "font-weight":
      return typeof value === "string" && WEIGHT.test(value)
        ? undefined
        : 'a font weight is "100" to "900"';
    case "easing": {
      // Copied first: `every` skips the holes of a sparse array, and a copy
      // has none.
      const curve: unknown[] = Array.isArray(value) ? Array.from(value) : [];
      const [x1, , x2] = curve;
      return curve.length === 4 &&
        curve.every((point) => typeof point === "number" && Number.isFinite(point)) &&
        (x1 as number) >= 0 &&
        (x1 as number) <= 1 &&
        (x2 as number) >= 0 &&
        (x2 as number) <= 1
        ? undefined
        : "a curve is four numbers, with both x values from 0 to 1";
    }
  }
}

/** Validated copies of the token values in `input`, which may hold any of them. */
function validateTokens(input: unknown): Partial<Record<keyof NativeThemeTokens, unknown>> {
  if (input === undefined) {
    return {};
  }
  if (!isPlainObject(input)) {
    throw invalidToken("tokens", input, "tokens must be a plain object");
  }
  const output: Partial<Record<keyof NativeThemeTokens, unknown>> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!Object.hasOwn(nativeTokenKinds, name)) {
      throw invalidToken(name, value, "it isn't a native token name");
    }
    const token = name as keyof NativeThemeTokens;
    const reason = refusal(nativeTokenKinds[token], value);
    if (reason !== undefined) {
      throw invalidToken(name, value, reason);
    }
    output[token] = Array.isArray(value) ? Object.freeze(Array.from(value)) : value;
  }
  return output;
}

function freeze(theme: NativeTheme): NativeTheme {
  Object.freeze(theme.tokens);
  Object.freeze(theme);
  CREATED.add(theme);
  return theme;
}

/**
 * The built-in light theme, resolved from the same tokens as the web's
 * `lightTheme` when ui is built.
 *
 * @public
 */
export const lightNativeTheme: NativeTheme = /* @__PURE__ */ freeze({
  colorScheme: "light",
  tokens: lightNativeTokens,
});

/**
 * The built-in dark theme, resolved from the same tokens as the web's
 * `darkTheme` when ui is built.
 *
 * @public
 */
export const darkNativeTheme: NativeTheme = /* @__PURE__ */ freeze({
  colorScheme: "dark",
  tokens: darkNativeTokens,
});

/** A parent that's safe to build on: a theme from here, or one checked whole. */
function resolveParent(parent: unknown): NativeTheme {
  if (parent === "light") {
    return lightNativeTheme;
  }
  if (parent === "dark") {
    return darkNativeTheme;
  }
  if (typeof parent === "object" && parent !== null && CREATED.has(parent)) {
    return parent as NativeTheme;
  }
  // Anything else, such as a theme parsed from JSON, must hold every token.
  if (!isPlainObject(parent) || !isPlainObject(parent["tokens"])) {
    throw invalidToken("extends", parent, 'extends takes "light", "dark" or a native theme');
  }
  const tokens = validateTokens(parent["tokens"]);
  const missing = Object.keys(nativeTokenKinds).filter((name) => !Object.hasOwn(tokens, name));
  if (missing.length > 0) {
    throw invalidToken(
      missing[0] as string,
      undefined,
      `the extended theme is missing ${missing.join(", ")}`,
    );
  }
  return {
    colorScheme: parent["colorScheme"] === "dark" ? "dark" : "light",
    tokens: tokens as unknown as NativeThemeTokens,
  };
}

/**
 * Creates a theme for React Native from another, changing only the tokens
 * given. Values are native ones: colours as `#rrggbb` or `#rrggbbaa`,
 * lengths as numbers of density-independent pixels, durations in
 * milliseconds. Nothing is parsed as CSS on the device.
 *
 * Unknown token names and values of the wrong kind throw ui's `UiError`
 * with the code `INVALID_THEME_TOKEN`, and `details` naming the token: tell
 * it apart with sdk-core's `isSdkError(error, "INVALID_THEME_TOKEN")`.
 *
 * It doesn't check contrast, as `createTheme` does in development: check a
 * custom palette against WCAG 2.2 AA yourself, for the pairs ui's
 * `contrastPairs` lists.
 *
 * @example
 * ```ts
 * const calm = createNativeTheme({
 *   extends: "light",
 *   tokens: { "color-accent": "#1f5f5b", "font-size-body": 22 },
 * });
 * ```
 *
 * @public
 */
export function createNativeTheme(input: NativeThemeInput): NativeTheme {
  if (!isPlainObject(input)) {
    throw invalidToken("theme", input, "createNativeTheme takes an options object");
  }
  const parent = resolveParent(input.extends);
  const colorScheme = input.colorScheme ?? parent.colorScheme;
  if (colorScheme !== "light" && colorScheme !== "dark") {
    throw invalidToken("color-scheme", colorScheme, 'colorScheme must be "light" or "dark"');
  }
  return freeze({
    colorScheme,
    tokens: { ...parent.tokens, ...validateTokens(input.tokens) } as NativeThemeTokens,
  });
}
