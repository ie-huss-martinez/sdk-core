import { type EditorPreferences, editorPreferenceOptions } from "./editor-preferences.js";

/**
 * The preferences an editor's root inherits from its page until someone
 * chooses them: its theme, density and motion (sdk-core ADR 0067).
 *
 * @public
 */
export type InheritedEditorPreference = "theme" | "density" | "motion";

/** Every {@link InheritedEditorPreference}. */
export const INHERITED: readonly InheritedEditorPreference[] = ["theme", "density", "motion"];

/** The values of the fields an editor inherits. */
export type InheritedValues = Pick<EditorPreferences, InheritedEditorPreference>;

const ATTRIBUTES: Readonly<Record<InheritedEditorPreference, string>> = {
  theme: "data-hm-theme",
  density: "data-hm-density",
  motion: "data-hm-motion",
};

/** What the tokens use where no ancestor sets a field. */
const FALLBACK: InheritedValues = { theme: "system", density: "comfortable", motion: "system" };

/**
 * The values in effect for the fields an editor inherits: each from the
 * nearest ancestor above its root that sets the attribute the tokens follow
 * with a value they know, or else the tokens' own. An unknown value is
 * skipped, as CSS skips it. It touches the DOM only when called.
 */
export function inheritedValues(root: Element | null): InheritedValues {
  const read = <Field extends InheritedEditorPreference>(field: Field): InheritedValues[Field] => {
    const name = ATTRIBUTES[field];
    const options: readonly string[] = editorPreferenceOptions[field];
    // As in CSS, a value the tokens don't know matches nothing, so the
    // nearest valid one further out is the one in effect.
    for (let element = root?.parentElement; element; element = element.parentElement) {
      const value = element.getAttribute(name);
      if (value !== null && options.includes(value)) {
        return value as InheritedValues[Field];
      }
    }
    return FALLBACK[field];
  };
  return { theme: read("theme"), density: read("density"), motion: read("motion") };
}

/**
 * What the settings show: the preferences, with the values in effect for the
 * fields not chosen, as read when the settings opened.
 */
export function settingsValue(
  preferences: EditorPreferences,
  isChosen: (field: InheritedEditorPreference) => boolean,
  inherited: InheritedValues | null,
): EditorPreferences {
  if (!inherited) {
    return preferences;
  }
  return {
    ...preferences,
    theme: isChosen("theme") ? preferences.theme : inherited.theme,
    density: isChosen("density") ? preferences.density : inherited.density,
    motion: isChosen("motion") ? preferences.motion : inherited.motion,
  };
}

/**
 * A change in the settings, as the preferences to keep and the fields it
 * chose: those that differ from what the settings showed. A field still
 * inherited and left alone keeps its preference, so the page's value never
 * becomes the host's preference.
 */
export function fromSettings(
  next: EditorPreferences,
  shown: EditorPreferences,
  preferences: EditorPreferences,
  isChosen: (field: InheritedEditorPreference) => boolean,
): {
  readonly preferences: EditorPreferences;
  readonly chosen: readonly InheritedEditorPreference[];
} {
  const chosen = INHERITED.filter((field) => next[field] !== shown[field]);
  const keep = (field: InheritedEditorPreference) => !isChosen(field) && !chosen.includes(field);
  return {
    preferences: {
      ...next,
      theme: keep("theme") ? preferences.theme : next.theme,
      density: keep("density") ? preferences.density : next.density,
      motion: keep("motion") ? preferences.motion : next.motion,
    },
    chosen,
  };
}
