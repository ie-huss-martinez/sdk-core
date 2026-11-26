import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import { useLatest } from "@hussmartinez/ui/react";
import { useCallback, useState } from "react";

/**
 * Preferences an editor starts with when the host passes none: every tool
 * listed, as before the frame, so a host that embeds the editor keeps what
 * it had. The family's apps pass their own, with Easy on a first visit
 * (sdk-core ADR 0067).
 */
const EMBEDDED: Partial<EditorPreferences> = { mode: "advanced" };

/**
 * The editor's preferences: the host's when it passes `preferences`, and
 * otherwise the editor's own state, from `defaultPreferences`. Either way,
 * each change is reported through `onPreferencesChange`. The editor never
 * stores them (sdk-core ADR 0067).
 */
export function useEditorPreferences(
  preferences: EditorPreferences | undefined,
  defaultPreferences: Partial<EditorPreferences> | undefined,
  onPreferencesChange: ((preferences: EditorPreferences) => void) | undefined,
): readonly [EditorPreferences, (next: EditorPreferences) => void] {
  const [own, setOwn] = useState(() => readEditorPreferences(defaultPreferences, EMBEDDED));
  const latest = useLatest(onPreferencesChange);
  const controlled = preferences !== undefined;
  const set = useCallback(
    (next: EditorPreferences) => {
      if (!controlled) setOwn(next);
      latest.current?.(next);
    },
    [controlled, latest],
  );
  return [controlled ? readEditorPreferences(preferences, EMBEDDED) : own, set];
}
