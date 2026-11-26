import type { EditorPreferences } from "@hussmartinez/ui";
import { type EditorPreferencesControls, useEditorPreferences } from "@hussmartinez/ui/react";
import { createContext } from "react";

/**
 * The editor's colour mode: ui's light or dark theme, or the system's. Unset,
 * the editor inherits the page's.
 *
 * @public
 */
export type NotesEditorTheme = "light" | "dark" | "system";

/**
 * The preference props of {@link NotesEditor} and {@link NotesNotebook}
 * (sdk-core ADR 0067, docs/adr/0008).
 *
 * @public
 */
export interface NotesPreferenceProps {
  /**
   * The person's preferences: mode, theme, the tools' layout, the panels,
   * density, motion and tips. Controlled with `onPreferencesChange`; the
   * editor never stores them, so the host decides where they're kept, such
   * as `localStorage`. A `theme` prop wins over the preferences' theme.
   */
  readonly preferences?: EditorPreferences;
  /**
   * Preferences to start with when `preferences` isn't given. Fields left
   * out take ui's defaults, except two: the mode is Advanced, so a host that
   * embedded the editor keeps its tools, and the tools float in a dock over
   * the foot of the page (docs/adr/0008). The theme, density and motion are
   * the page's until the host sets them here or the person picks them.
   */
  readonly defaultPreferences?: Partial<EditorPreferences>;
  /** Called with the whole preferences when the person changes one. */
  readonly onPreferencesChange?: (preferences: EditorPreferences) => void;
  /** The colour mode, set as `data-hm-theme` on the editor's root. Unset, it inherits the page's. */
  readonly theme?: NotesEditorTheme;
}

/** What `NotesEditor` shares with the notebook it shows: one set of preferences for both views. */
export interface NotesFrameShared {
  readonly preferences: EditorPreferencesControls;
  readonly theme: NotesEditorTheme | undefined;
  /** Whether the editor drops its visual styles, the frame's included. */
  readonly unstyled: boolean;
}

/** Set by `NotesEditor`; a notebook rendered on its own keeps preferences of its own. */
export const NotesFrameContext = /* @__PURE__ */ createContext<NotesFrameShared | null>(null);

/** The tools float in a dock over the page unless the host or the person chose the sidebar (docs/adr/0008). */
const NOTES_DEFAULTS: Partial<EditorPreferences> = { toolsLayout: "dock" };

/**
 * ui's preferences hook, with the notebook's defaults, saying a new mode or
 * a chosen theme with `say`, in the editor's own words.
 */
export function useNotesPreferences(
  props: NotesPreferenceProps,
  say: (key: string) => void,
): EditorPreferencesControls {
  return useEditorPreferences({
    preferences: props.preferences,
    defaultPreferences: { ...NOTES_DEFAULTS, ...props.defaultPreferences },
    onPreferencesChange: props.onPreferencesChange,
    theme: props.theme,
    onChange: ({ previous, preferences: next, chosen }) => {
      if (next.mode !== previous.mode) say(`editor.mode.${next.mode}`);
      if (chosen.includes("theme")) say(`editor.theme.${next.theme}`);
    },
  });
}
