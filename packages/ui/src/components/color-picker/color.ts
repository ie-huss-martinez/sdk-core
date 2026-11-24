/**
 * Colour maths for the colour picker (docs/adr/0013): one parser, the
 * conversions between hex and hue, saturation and brightness, and the parts
 * of a spoken colour name. Pure, so importing it does nothing.
 */

/** Hue in degrees from 0 to 360, saturation, brightness and alpha from 0 to 1. */
export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * A colour as lowercase `#rrggbb`, or `#rrggbbaa` when `alpha` is on, from
 * `#rgb`, `#rrggbb` or, with `alpha`, `#rgba` and `#rrggbbaa`, each with or
 * without the `#`. Opaque input gets `ff` with `alpha`. Anything else is
 * `undefined`. Its result is the only text that reaches an SVG attribute.
 */
export function parseColor(text: unknown, alpha = false): string | undefined {
  if (typeof text !== "string") {
    return undefined;
  }
  const match = HEX.exec(text.trim());
  if (!match) {
    return undefined;
  }
  let digits = (match[1] as string).toLowerCase();
  if (digits.length <= 4) {
    digits = digits.replace(/./g, "$&$&");
  }
  if (digits.length === 8) {
    if (!alpha) {
      return undefined;
    }
    return `#${digits}`;
  }
  return alpha ? `#${digits}ff` : `#${digits}`;
}

const byte = (value: number): string =>
  Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");

/** The opaque part of a parsed colour, `#rrggbb`. */
export function opaquePart(color: string): string {
  return color.slice(0, 7);
}

/** The alpha of a parsed colour, from 0 to 1. */
export function alphaOf(color: string): number {
  return color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1;
}

/** Red, green and blue of `#rrggbb…`, from 0 to 1. */
export function rgbOf(color: string): readonly [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/**
 * Hue, saturation, brightness and alpha of a parsed colour. A grey has no
 * hue of its own, and black no saturation either, so they keep `previous`'s,
 * and dragging through grey or black and back doesn't lose them.
 */
export function toHsva(color: string, previous?: Hsva): Hsva {
  const [r, g, b] = rgbOf(color);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const v = max;
  let s = max === 0 ? (previous?.s ?? 0) : delta / max;
  let h = previous?.h ?? 0;
  if (delta > 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta + 6) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  } else if (max !== 0) {
    s = 0;
  }
  return { h, s, v, a: alphaOf(color) };
}

/** A colour from hue, saturation and brightness, as `#rrggbb`, or `#rrggbbaa` with `alpha`. */
export function toHex(hsva: Hsva, alpha = false): string {
  const h = (((hsva.h % 360) + 360) % 360) / 60;
  const s = Math.min(1, Math.max(0, hsva.s));
  const v = Math.min(1, Math.max(0, hsva.v));
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  const opaque = `#${byte(r + m)}${byte(g + m)}${byte(b + m)}`;
  return alpha ? `${opaque}${byte(hsva.a)}` : opaque;
}

/** The hue families a colour name can have. */
export type HueFamily = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink";

/**
 * What a colour is called, as message parts: `white`, `black`, a grey, or
 * a hue family with how light and how saturated it is.
 */
export type ColorName =
  | { readonly kind: "white" | "black" | "grey" | "light-grey" | "dark-grey" }
  | {
      readonly kind: "hue";
      readonly hue: HueFamily;
      readonly tone: "light" | "dark" | "greyish" | "plain";
    };

const FAMILIES: readonly (readonly [number, HueFamily])[] = [
  [15, "red"],
  [45, "orange"],
  [70, "yellow"],
  [160, "green"],
  [195, "cyan"],
  [250, "blue"],
  [290, "purple"],
  [345, "pink"],
  [360, "red"],
];

/** The name of a parsed colour, ignoring its alpha. */
export function nameOf(color: string): ColorName {
  const { h, s, v } = toHsva(color);
  // Lightness of the colour, as HSL has it, to tell light from dark.
  const lightness = v * (1 - s / 2);
  if (v < 0.12) {
    return { kind: "black" };
  }
  if (s < 0.1) {
    if (lightness > 0.94) {
      return { kind: "white" };
    }
    return lightness > 0.7
      ? { kind: "light-grey" }
      : lightness < 0.3
        ? { kind: "dark-grey" }
        : { kind: "grey" };
  }
  const hue = FAMILIES.find(([limit]) => h < limit)?.[1] ?? "red";
  const tone = s < 0.3 ? "greyish" : lightness > 0.7 ? "light" : v < 0.45 ? "dark" : "plain";
  return { kind: "hue", hue, tone };
}

/**
 * Adds a colour to a list of recent colours: first, without duplicates
 * (whatever their case), and at most `max` long. Every colour in the list
 * is normalised, and text that isn't a colour is dropped, before the
 * duplicates go and the list is cut to `max`; a new colour that isn't one
 * isn't added.
 *
 * @example
 * ```ts
 * const onValueCommit = (color: string) => setRecent((list) => addRecentColor(list, color));
 * ```
 *
 * @param list - The recent colours, newest first.
 * @param color - The colour to add, such as `#1570ef` or `#1570ef80`.
 * @param max - The longest the list may be. Defaults to 8.
 * @returns A new, frozen list.
 * @public
 */
export function addRecentColor(list: readonly string[], color: string, max = 8): readonly string[] {
  const normalise = (value: string): string | undefined => {
    const parsed = parseColor(value, true);
    // Opaque colours are kept as #rrggbb, as hosts gave them.
    return parsed?.endsWith("ff") ? parsed.slice(0, 7) : parsed;
  };
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [color, ...list]) {
    const normalised = normalise(value);
    if (normalised !== undefined && !seen.has(normalised)) {
      seen.add(normalised);
      result.push(normalised);
    }
  }
  return Object.freeze(result.slice(0, Math.max(0, max)));
}
