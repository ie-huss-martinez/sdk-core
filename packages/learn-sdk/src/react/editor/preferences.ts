import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import { useLatest } from "@hussmartinez/ui/react";
import { useCallback, useState } from "react";

/**
 * A stand-in for `ui`'s shared `useEditorPreferences`, which is moving into
 * `ui` with notes-sdk's frame (ADR 0008). It has the shared hook's options and
 * result, so switching to it is an import change. Remove it then.
 */

/** The fields an embedded editor takes from the page until someone chooses them. */
export type Inherited = "theme" | "density" | "motion";

const INHERITED: readonly Inherited[] = ["theme", "density", "motion"];

/** An editor embedded in a page starts in Advanced, unless the host says otherwise. */
const EMBEDDED: Partial<EditorPreferences> = { mode: "advanced" };

export interface EditorPreferencesOptions {
  readonly preferences?: EditorPreferences | undefined;
  readonly defaultPreferences?: Partial<EditorPreferences> | undefined;
  readonly onPreferencesChange?: ((preferences: EditorPreferences) => void) | undefined;
  /** Called after a change, with the fields that changed, such as for a toast. */
  readonly onChange?:
    | ((next: EditorPreferences, changed: readonly (keyof EditorPreferences)[]) => void)
    | undefined;
  /** A theme the host forces: the editor offers no theme toggle then. */
  readonly theme?: EditorPreferences["theme"] | undefined;
}

export interface EditorPreferencesResult {
  readonly preferences: EditorPreferences;
  /** Whether a field is chosen, rather than inherited from the page. */
  readonly isChosen: (field: Inherited) => boolean;
  readonly change: (next: EditorPreferences) => void;
  /** `ui`'s theme, density and motion for the editor's root, where chosen (sdk-core ADR 0067). */
  readonly rootAttributes: {
    readonly "data-hm-theme"?: string | undefined;
    readonly "data-hm-density"?: string | undefined;
    readonly "data-hm-motion"?: string | undefined;
  };
  /** The theme toggle's value: the chosen theme, or `inherit` until one is. */
  readonly themeToggleValue: EditorPreferences["theme"] | "inherit";
  readonly openSettings: () => void;
  readonly settings: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void };
}

/** The editor's preferences: controlled by the host, or the editor's own (sdk-core ADR 0067). */
export function useEditorPreferences(options: EditorPreferencesOptions): EditorPreferencesResult {
  const { preferences: given, defaultPreferences, theme } = options;
  const [own, setOwn] = useState(() => readEditorPreferences(defaultPreferences, EMBEDDED));
  const [picked, setPicked] = useState<ReadonlySet<Inherited>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const latest = useLatest(options);
  const preferences = given === undefined ? own : readEditorPreferences(given, EMBEDDED);
  const controlled = given !== undefined;

  const isChosen = (field: Inherited): boolean =>
    picked.has(field) || controlled || defaultPreferences?.[field] !== undefined;

  const change = useCallback(
    (next: EditorPreferences) => {
      const before = controlled ? readEditorPreferences(latest.current.preferences, EMBEDDED) : own;
      const changed = (Object.keys(next) as (keyof EditorPreferences)[]).filter(
        (field) => next[field] !== before[field],
      );
      const chosen = changed.filter((field): field is Inherited =>
        INHERITED.includes(field as Inherited),
      );
      if (chosen.length > 0) setPicked((current) => new Set([...current, ...chosen]));
      if (!controlled) setOwn(next);
      latest.current.onPreferencesChange?.(next);
      latest.current.onChange?.(next, changed);
    },
    [controlled, own, latest],
  );

  return {
    preferences,
    isChosen,
    change,
    rootAttributes: {
      "data-hm-theme": theme ?? (isChosen("theme") ? preferences.theme : undefined),
      "data-hm-density": isChosen("density") ? preferences.density : undefined,
      "data-hm-motion": isChosen("motion") ? preferences.motion : undefined,
    },
    themeToggleValue: isChosen("theme") ? preferences.theme : "inherit",
    openSettings: () => setSettingsOpen(true),
    settings: { open: settingsOpen, onOpenChange: setSettingsOpen },
  };
}
