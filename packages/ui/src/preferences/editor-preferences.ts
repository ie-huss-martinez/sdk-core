import type { EditorMode } from "@hussmartinez/sdk-core";

/**
 * A person's choices for how an editor looks and behaves (sdk-core ADR
 * 0067). SDK editors take them as controlled props; the host decides where
 * they're kept.
 *
 * @public
 */
export interface EditorPreferences {
  /** `system` follows `prefers-color-scheme`. */
  readonly theme: "system" | "light" | "dark";
  /** How much of the editor is shown. */
  readonly mode: EditorMode;
  /** Tools in a sidebar at the inline start, or floating in a dock over the stage. */
  readonly toolsLayout: "sidebar" | "dock";
  /** The tools panel: with labels, icons only, or hidden behind an edge tab. */
  readonly tools: "full" | "icons" | "hidden";
  /** The properties panel, or an edge tab when hidden. */
  readonly properties: "shown" | "hidden";
  readonly density: "comfortable" | "compact";
  /** `system` follows `prefers-reduced-motion`; the others override it. */
  readonly motion: "system" | "full" | "reduced";
  /** Whether hints and descriptions for newcomers are shown. */
  readonly tips: boolean;
}

/**
 * The values each preference can take, in the order a settings panel lists
 * them. `tips` is a boolean.
 *
 * @public
 */
export const editorPreferenceOptions: {
  readonly [Name in Exclude<keyof EditorPreferences, "tips">]: readonly EditorPreferences[Name][];
} = {
  theme: ["system", "light", "dark"],
  mode: ["easy", "advanced", "expert"],
  toolsLayout: ["sidebar", "dock"],
  tools: ["full", "icons", "hidden"],
  properties: ["shown", "hidden"],
  density: ["comfortable", "compact"],
  motion: ["system", "full", "reduced"],
};

/**
 * The preferences of a first visit: the system's theme and motion, Easy
 * mode, a full tools sidebar, the properties panel shown, comfortable
 * density and tips on.
 *
 * @public
 */
export const defaultEditorPreferences: EditorPreferences = {
  theme: "system",
  mode: "easy",
  toolsLayout: "sidebar",
  tools: "full",
  properties: "shown",
  density: "comfortable",
  motion: "system",
  tips: true,
};

/**
 * Reads preferences from anything, such as JSON parsed from storage. Each
 * field that's missing or has a value it can't take gets its default, from
 * `defaults` or {@link defaultEditorPreferences}, and unknown fields are
 * dropped, so a stored value from an older or newer version still reads
 * (sdk-core ADR 0067). It never throws.
 *
 * @example
 * ```ts
 * let stored: unknown;
 * try {
 *   stored = JSON.parse(localStorage.getItem("editor-prefs:image") ?? "null");
 * } catch {
 *   stored = null;
 * }
 * const preferences = readEditorPreferences(stored);
 * ```
 *
 * @param value - Anything.
 * @param defaults - Defaults to use instead of {@link defaultEditorPreferences}, such as an app's own default mode.
 * @returns Valid, frozen preferences.
 * @public
 */
export function readEditorPreferences(
  value: unknown,
  defaults: Partial<EditorPreferences> = {},
): EditorPreferences {
  const base = { ...defaultEditorPreferences };
  const source =
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(base) as (keyof EditorPreferences)[]) {
    const fallback = isValid(name, defaults[name]) ? defaults[name] : base[name];
    const given = Object.hasOwn(source, name) ? source[name] : undefined;
    result[name] = isValid(name, given) ? given : fallback;
  }
  return Object.freeze(result as unknown as EditorPreferences);
}

function isValid(name: keyof EditorPreferences, value: unknown): boolean {
  if (name === "tips") {
    return typeof value === "boolean";
  }
  return (editorPreferenceOptions[name] as readonly unknown[]).includes(value);
}
