/**
 * Writes the React Native themes from the token source (sdk-core ADR 0069).
 * Development-time only: `scripts/generate-tokens.ts` runs it, and a unit
 * test fails when the committed output is stale.
 *
 * A device has no CSS: no `oklch()`, no `rem`, no `var()`. So every value is
 * resolved here, once, into what React Native's styles take, and the native
 * entry ships plain literals with no colour maths or CSS parser.
 */
import { type Rgba, resolveColor } from "../theme/color.js";
import { darkTheme, lightTheme } from "../theme/create-theme.js";
import { type CssNode, parseValue } from "../theme/css-value.js";
import type { Theme } from "../theme/types.js";
import { type TokenType, tokens } from "../tokens/definitions.js";

/** One `rem`, in density-independent pixels: the default font size everywhere. */
const REM = 16;

/** What a native token's value is: a colour string, a number, a curve or a weight. */
export type NativeTokenKind = "color" | "number" | "easing" | "font-weight";

/**
 * Token types that have a native value. The rest describe CSS itself: a
 * font stack, a `box-shadow` list, an `outline` shorthand and the
 * `color-scheme` keyword, which is the theme's `colorScheme` instead.
 */
const KINDS: Readonly<Partial<Record<TokenType, NativeTokenKind>>> = {
  color: "color",
  length: "number",
  duration: "number",
  number: "number",
  integer: "number",
  easing: "easing",
  "font-weight": "font-weight",
};

/**
 * Tokens only the native themes have, written as the web's are so they
 * resolve the same way.
 *
 * - **The hint colours** are the gentle tone for "not this one, look again":
 *   an errorless interface never answers a wrong pick with the danger
 *   colours. They follow the success colours' steps, at a violet hue that
 *   none of the feedback colours uses.
 * - **`control-height-large`** is the 64 dp target for people who need a
 *   large one.
 *
 * The web's tokens don't gain them here: a new semantic token is a new
 * required value in every complete theme, and more stylesheet for every
 * application.
 */
export const nativeOnlyTokens = {
  light: {
    "color-hint": "oklch(0.5 0.156 300)",
    "color-hint-subtle": "oklch(0.965 0.043 300)",
    "color-hint-text": "oklch(0.5 0.156 300)",
    "control-height-large": "4rem",
  },
  dark: {
    "color-hint": "oklch(0.78 0.153 300)",
    "color-hint-subtle": "oklch(0.26 0.085 300)",
    "color-hint-text": "oklch(0.87 0.119 300)",
    "control-height-large": "4rem",
  },
} as const;

const NATIVE_ONLY_KINDS: Readonly<Record<keyof typeof nativeOnlyTokens.light, NativeTokenKind>> = {
  "color-hint": "color",
  "color-hint-subtle": "color",
  "color-hint-text": "color",
  "control-height-large": "number",
};

/** A resolved value: what the generated file holds for one token. */
export type NativeValue = string | number | readonly [number, number, number, number];

const byte = (channel: number): string =>
  Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` for a translucent colour. React Native reads both. */
export function toHex({ r, g, b, alpha }: Rgba): string {
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha < 1 ? byte(alpha) : ""}`;
}

/** The value's one node, following `var(--hm-…)` references into the theme. */
function resolveNode(
  value: string,
  lookup: (token: string) => string | undefined,
  depth = 0,
): CssNode | undefined {
  const nodes = parseValue(value).nodes;
  const [node] = nodes;
  if (nodes.length !== 1 || node === undefined || depth > 16) {
    return undefined;
  }
  if (node.kind === "function" && node.name === "var") {
    const [property] = node.args;
    const referenced =
      property?.kind === "ident" ? lookup(property.value.slice("--hm-".length)) : undefined;
    return referenced === undefined ? undefined : resolveNode(referenced, lookup, depth + 1);
  }
  return node;
}

function toNumber(node: CssNode, type: TokenType): number | undefined {
  if (node.kind !== "number") {
    return undefined;
  }
  const units: Readonly<Record<string, number>> =
    type === "length"
      ? { rem: REM, px: 1 }
      : type === "duration"
        ? { ms: 1, s: 1000 }
        : // A unitless zero is a length and a duration too.
          {};
  if (node.unit === "") {
    return type === "number" || type === "integer" || node.value === 0 ? node.value : undefined;
  }
  const scale = units[node.unit];
  return scale === undefined ? undefined : node.value * scale;
}

function toEasing(node: CssNode): readonly [number, number, number, number] | undefined {
  if (node.kind === "ident" && node.value === "linear") {
    return [0, 0, 1, 1];
  }
  if (node.kind !== "function" || node.name !== "cubic-bezier") {
    return undefined;
  }
  const points = node.args.filter((arg) => arg.kind !== "comma");
  if (points.length !== 4 || points.some((arg) => arg.kind !== "number" || arg.unit !== "")) {
    return undefined;
  }
  const [x1, y1, x2, y2] = points.map((arg) => (arg as { value: number }).value);
  return [x1 as number, y1 as number, x2 as number, y2 as number];
}

/**
 * Resolves one token's CSS value to its native value, or throws: a token
 * that can't be resolved must stop generation, never ship as a guess.
 */
export function toNativeValue(
  name: string,
  value: string,
  type: TokenType,
  lookup: (token: string) => string | undefined,
): NativeValue {
  let result: NativeValue | undefined;
  if (type === "color") {
    const color = resolveColor(value, lookup);
    result = color && toHex(color);
  } else {
    const node = resolveNode(value, lookup);
    if (node !== undefined) {
      result =
        type === "easing"
          ? toEasing(node)
          : type === "font-weight"
            ? node.kind === "number" && node.unit === ""
              ? String(node.value)
              : undefined
            : toNumber(node, type);
    }
  }
  if (result === undefined) {
    throw new Error(`The token ${name} has no native value: ${value}`);
  }
  return result;
}

/**
 * A built-in theme's native values, by token name. Density tokens take
 * their coarse-pointer values, because a device is a touch screen: 44 dp
 * targets (ADR 0014).
 */
export function nativeTokens(
  theme: Theme,
  nativeOnly: Readonly<Record<string, string>>,
): Record<string, NativeValue> {
  const values: Readonly<Record<string, string>> = {
    ...theme.tokens,
    ...theme.coarsePointer,
    ...nativeOnly,
  };
  const lookup = (token: string): string | undefined => values[token];
  const result: Record<string, NativeValue> = {};
  for (const definition of tokens) {
    if (definition.level === "semantic" && KINDS[definition.type] !== undefined) {
      result[definition.name] = toNativeValue(
        definition.name,
        values[definition.name] as string,
        definition.type,
        lookup,
      );
    }
  }
  for (const name of Object.keys(NATIVE_ONLY_KINDS) as (keyof typeof NATIVE_ONLY_KINDS)[]) {
    const type = NATIVE_ONLY_KINDS[name] === "color" ? "color" : "length";
    result[name] = toNativeValue(name, values[name] as string, type, lookup);
  }
  return result;
}

/** Every native token's kind, by name, in the order the file lists them. */
export function nativeTokenKinds(): Record<string, NativeTokenKind> {
  const kinds: Record<string, NativeTokenKind> = {};
  for (const definition of tokens) {
    const kind = KINDS[definition.type];
    if (definition.level === "semantic" && kind !== undefined) {
      kinds[definition.name] = kind;
    }
  }
  return { ...kinds, ...NATIVE_ONLY_KINDS };
}

const TYPES: Readonly<Record<NativeTokenKind, string>> = {
  color: "string",
  number: "number",
  easing: "NativeEasing",
  "font-weight": "NativeFontWeight",
};

const HEADER = [
  "// Generated by scripts/generate-tokens.ts from src/tokens and",
  "// src/native/generate-theme.ts. Don't edit it: change the tokens and run",
  "// `pnpm --filter @hussmartinez/ui tokens` (sdk-core ADR 0069).",
];

/** The generated module, before formatting: `src/native/theme.generated.ts`. */
export function generateNativeThemeSource(): string {
  const kinds = nativeTokenKinds();
  const literal = (values: Record<string, NativeValue>): string =>
    Object.entries(values)
      .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`)
      .join("\n");
  return [
    ...HEADER,
    "",
    "/**",
    " * A timing curve, as the four numbers of a cubic Bézier: what",
    " * `Easing.bezier(...curve)` takes.",
    " *",
    " * @public",
    " */",
    "export type NativeEasing = readonly [x1: number, y1: number, x2: number, y2: number];",
    "",
    "/**",
    " * A font weight, as React Native's `fontWeight` takes it.",
    " *",
    " * @public",
    " */",
    'export type NativeFontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";',
    "",
    "/**",
    " * Every token of a native theme, by the name the web's token has, without",
    " * `--hm-`. Colours are `#rrggbb` or `#rrggbbaa`; lengths are",
    " * density-independent pixels; durations are milliseconds.",
    " *",
    " * @public",
    " */",
    "export interface NativeThemeTokens {",
    ...Object.entries(kinds).map(
      ([name, kind]) => `  readonly ${JSON.stringify(name)}: ${TYPES[kind]};`,
    ),
    "}",
    "",
    "/** What each token's value is, for `createNativeTheme` to check. */",
    'export const nativeTokenKinds: Readonly<Record<keyof NativeThemeTokens, "color" | "number" | "easing" | "font-weight">> = {',
    ...Object.entries(kinds).map(
      ([name, kind]) => `  ${JSON.stringify(name)}: ${JSON.stringify(kind)},`,
    ),
    "};",
    "",
    "/** The built-in light theme's values. */",
    "export const lightNativeTokens: NativeThemeTokens = {",
    literal(nativeTokens(lightTheme, nativeOnlyTokens.light)),
    "};",
    "",
    "/** The built-in dark theme's values. */",
    "export const darkNativeTokens: NativeThemeTokens = {",
    literal(nativeTokens(darkTheme, nativeOnlyTokens.dark)),
    "};",
    "",
  ].join("\n");
}
