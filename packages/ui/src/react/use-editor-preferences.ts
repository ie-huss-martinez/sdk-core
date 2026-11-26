import { useState } from "react";
import {
  type EditorPreferences,
  readEditorPreferences,
} from "../preferences/editor-preferences.js";
import {
  fromSettings,
  INHERITED,
  type InheritedEditorPreference,
  type InheritedValues,
  inheritedValues,
  settingsValue,
} from "../preferences/inherited.js";

/**
 * Preferences an editor starts with when the host passes none: every tool
 * listed, so a host that embeds the editor keeps what it had. The family's
 * apps pass their own, with Easy on a first visit (sdk-core ADR 0067).
 */
const EMBEDDED: Partial<EditorPreferences> = { mode: "advanced" };

/**
 * Options of {@link useEditorPreferences}: the editor's own props, passed
 * through, and what the editor does when they change.
 *
 * @public
 */
export interface UseEditorPreferencesOptions {
  /**
   * The host's preferences. With them, the preferences are controlled, and
   * every field counts as chosen.
   */
  readonly preferences?: EditorPreferences | undefined;
  /**
   * The preferences to start with when the host passes no `preferences`. A
   * field set here counts as chosen. Unset fields default to
   * {@link defaultEditorPreferences}, in Advanced mode.
   */
  readonly defaultPreferences?: Partial<EditorPreferences> | undefined;
  /** The host's handler, called with the whole preferences on every change. */
  readonly onPreferencesChange?: ((preferences: EditorPreferences) => void) | undefined;
  /**
   * The editor's own response to a change, before the host hears of it,
   * such as a toast in its own words for a new mode or a theme chosen.
   */
  readonly onChange?: ((change: EditorPreferencesChange) => void) | undefined;
  /** A theme the host sets on the editor, which wins over the preferences' on its root. */
  readonly theme?: EditorPreferences["theme"] | undefined;
}

/**
 * A change of preferences, as {@link UseEditorPreferencesOptions.onChange}
 * receives it.
 *
 * @public
 */
export interface EditorPreferencesChange {
  /** The preferences before the change. */
  readonly previous: EditorPreferences;
  /** The preferences after it. */
  readonly preferences: EditorPreferences;
  /**
   * The inherited fields this change chose, which are the editor's own from
   * then on: those it changed, or those the person changed in the settings.
   */
  readonly chosen: readonly InheritedEditorPreference[];
}

/**
 * What {@link useEditorPreferences} returns. Its functions are new on each
 * render, like the handlers of the render that uses them.
 *
 * @public
 */
export interface EditorPreferencesControls {
  /** The preferences in effect. */
  readonly preferences: EditorPreferences;
  /** Whether a field is the editor's own, or still inherited from the page. */
  readonly isChosen: (field: InheritedEditorPreference) => boolean;
  /**
   * Applies new preferences, such as the frame's panel states or a mode
   * switch. Every inherited field that differs from the current preferences
   * is chosen from then on.
   */
  readonly change: (next: EditorPreferences) => void;
  /**
   * The editor root's `data-hm-theme`, `data-hm-density` and `data-hm-motion`:
   * each chosen field's value, and `undefined` for a field still inherited.
   * The `theme` option wins over the preferences' theme.
   */
  readonly rootAttributes: {
    readonly "data-hm-theme": EditorPreferences["theme"] | undefined;
    readonly "data-hm-density": EditorPreferences["density"] | undefined;
    readonly "data-hm-motion": EditorPreferences["motion"] | undefined;
  };
  /** The {@link ThemeToggle}'s `value`: `"inherit"` until a theme is chosen. */
  readonly themeToggleValue: EditorPreferences["theme"] | "inherit";
  /**
   * Opens the settings, showing the values in effect for the fields still
   * inherited, read from the ancestors of the editor's `root` now.
   */
  readonly openSettings: (root: Element | null) => void;
  /**
   * The {@link SettingsPanel}'s `open`, `onOpenChange`, `value` and
   * `onValueChange`. A change applies the fields the person changed; a field
   * still inherited and left alone stays inherited, so the page's value never
   * becomes the host's preference.
   */
  readonly settings: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly value: EditorPreferences;
    readonly onValueChange: (value: EditorPreferences) => void;
  };
}

/**
 * An SDK editor's preferences (sdk-core ADR 0067): the host's when it passes
 * `preferences`, and otherwise the editor's own state, from
 * `defaultPreferences`. Either way, every change reaches
 * `onPreferencesChange`; the editor never stores them.
 *
 * An embedded editor inherits its page's theme, density and motion until
 * someone chooses them: the host, through its preferences or a default for
 * that field, or the person, through the theme toggle or the settings. The
 * hook keeps track of which are chosen, sets them on the editor's root, and
 * wires the {@link ThemeToggle} and the {@link SettingsPanel}.
 *
 * @example
 * ```tsx
 * const prefs = useEditorPreferences({
 *   preferences: props.preferences,
 *   defaultPreferences: props.defaultPreferences,
 *   onPreferencesChange: props.onPreferencesChange,
 *   onChange: ({ previous, preferences, chosen }) => {
 *     if (preferences.mode !== previous.mode) toast.show({ message: t(`mode.${preferences.mode}`) });
 *     if (chosen.includes("theme")) toast.show({ message: t(`theme.${preferences.theme}`) });
 *   },
 * });
 * return (
 *   <section ref={root} {...prefs.rootAttributes}>
 *     <ThemeToggle
 *       value={prefs.themeToggleValue}
 *       onValueChange={(theme) => prefs.change({ ...prefs.preferences, theme })}
 *     />
 *     <IconButton label="Settings" icon={<SettingsIcon />} onClick={() => prefs.openSettings(root.current)} />
 *     <SettingsPanel {...prefs.settings} />
 *   </section>
 * );
 * ```
 *
 * @param options - The editor's preference props, and its response to a change.
 * @returns The preferences, and what the editor's root, theme toggle and settings need.
 * @public
 */
export function useEditorPreferences(
  options: UseEditorPreferencesOptions = {},
): EditorPreferencesControls {
  const { defaultPreferences, onPreferencesChange, onChange, theme } = options;
  const [own, setOwn] = useState(() => readEditorPreferences(defaultPreferences, EMBEDDED));
  const controlled = options.preferences !== undefined;
  const preferences = controlled ? readEditorPreferences(options.preferences, EMBEDDED) : own;
  const [picked, setPicked] = useState<ReadonlySet<InheritedEditorPreference>>(() => new Set());
  const isChosen = (field: InheritedEditorPreference): boolean =>
    picked.has(field) || controlled || defaultPreferences?.[field] !== undefined;

  const apply = (
    next: EditorPreferences,
    chosen: readonly InheritedEditorPreference[] = INHERITED.filter(
      (field) => next[field] !== preferences[field],
    ),
  ): void => {
    onChange?.({ previous: preferences, preferences: next, chosen });
    if (chosen.some((field) => !picked.has(field))) {
      setPicked(new Set([...picked, ...chosen]));
    }
    if (!controlled) {
      setOwn(next);
    }
    onPreferencesChange?.(next);
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  // The page's values for the fields the editor inherits, read as the settings open.
  const [inheritedAtOpen, setInheritedAtOpen] = useState<InheritedValues | null>(null);
  const shown = settingsValue(preferences, isChosen, inheritedAtOpen);

  return {
    preferences,
    isChosen,
    change: (next) => apply(next),
    rootAttributes: {
      "data-hm-theme": theme ?? (isChosen("theme") ? preferences.theme : undefined),
      "data-hm-density": isChosen("density") ? preferences.density : undefined,
      "data-hm-motion": isChosen("motion") ? preferences.motion : undefined,
    },
    themeToggleValue: isChosen("theme") ? preferences.theme : "inherit",
    openSettings: (root) => {
      setInheritedAtOpen(inheritedValues(root));
      setSettingsOpen(true);
    },
    settings: {
      open: settingsOpen,
      onOpenChange: setSettingsOpen,
      value: shown,
      onValueChange: (next) => {
        const choice = fromSettings(next, shown, preferences, isChosen);
        apply(choice.preferences, choice.chosen);
      },
    },
  };
}
