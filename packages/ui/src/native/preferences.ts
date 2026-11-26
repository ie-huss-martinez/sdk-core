/**
 * A person's choices for how a React Native application looks and behaves.
 * The application decides where they're kept, and passes them to
 * `NativeUiProvider` (sdk-core ADR 0067, for the web's equivalent).
 *
 * @public
 */
export interface NativePreferences {
  /** `system` follows the device's appearance. */
  readonly theme: "system" | "light" | "dark";
  /**
   * How much larger text and targets are drawn, on top of the device's own
   * font size setting: 1 is the theme's size.
   */
  readonly textScale: number;
  /** `system` follows the device's reduce-motion setting; the others override it. */
  readonly motion: "system" | "full" | "reduced";
}

/**
 * The values a settings screen offers for each preference, in order.
 * `textScale` accepts any number from {@link MIN_TEXT_SCALE} to
 * {@link MAX_TEXT_SCALE}; these are the steps to offer.
 *
 * @public
 */
export const nativePreferenceOptions: {
  readonly [Name in keyof NativePreferences]: readonly NativePreferences[Name][];
} = {
  theme: ["system", "light", "dark"],
  textScale: [1, 1.2, 1.4],
  motion: ["system", "full", "reduced"],
};

/**
 * The smallest text scale: the theme's own size.
 *
 * @public
 */
export const MIN_TEXT_SCALE = 1;

/**
 * The largest text scale. Past it, a 64 dp target no longer fits a phone's
 * width beside its label.
 *
 * @public
 */
export const MAX_TEXT_SCALE = 2;

/**
 * The preferences of a first launch: the device's appearance and motion
 * setting, and the theme's text size.
 *
 * @public
 */
export const defaultNativePreferences: NativePreferences = {
  theme: "system",
  textScale: 1,
  motion: "system",
};

/**
 * A text scale that's safe to multiply sizes by: `value` kept between
 * {@link MIN_TEXT_SCALE} and {@link MAX_TEXT_SCALE}, and 1 for anything
 * that isn't a finite number.
 *
 * @public
 */
export function clampTextScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value));
}

/**
 * Reads preferences from anything, such as JSON parsed from storage. Each
 * field that's missing or has a value it can't take gets its default, from
 * `defaults` or {@link defaultNativePreferences}; unknown fields are
 * dropped; a text scale outside the range is brought into it. It never
 * throws.
 *
 * @example
 * ```ts
 * const stored = await AsyncStorage.getItem("preferences");
 * let parsed: unknown = null;
 * try {
 *   parsed = JSON.parse(stored ?? "null");
 * } catch {
 *   // Keep the defaults.
 * }
 * const preferences = readNativePreferences(parsed);
 * ```
 *
 * @param value - Anything.
 * @param defaults - Defaults to use instead of {@link defaultNativePreferences}.
 * @returns Valid, frozen preferences.
 * @public
 */
export function readNativePreferences(
  value: unknown,
  defaults: Partial<NativePreferences> = {},
): NativePreferences {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(defaultNativePreferences) as (keyof NativePreferences)[]) {
    const fallback = ownValid(defaults, name) ?? defaultNativePreferences[name];
    result[name] = ownValid(value, name) ?? fallback;
  }
  return Object.freeze(result as unknown as NativePreferences);
}

/**
 * The object's own value for a preference when it's valid, and `undefined`
 * otherwise, including when reading it throws, as a getter or a revoked
 * proxy can.
 */
function ownValid(source: unknown, name: keyof NativePreferences): unknown {
  if (source === null || typeof source !== "object") {
    return undefined;
  }
  try {
    if (!Object.hasOwn(source, name)) {
      return undefined;
    }
    const value: unknown = (source as Record<string, unknown>)[name];
    if (name === "textScale") {
      return typeof value === "number" && Number.isFinite(value)
        ? clampTextScale(value)
        : undefined;
    }
    return (nativePreferenceOptions[name] as readonly unknown[]).includes(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
