---
"@hussmartinez/ui": patch
"@hussmartinez/image-sdk": patch
"@hussmartinez/pdf-sdk": patch
"@hussmartinez/video-sdk": patch
"@hussmartinez/audio-sdk": patch
---

**ui:** new `useEditorPreferences` hook in `@hussmartinez/ui/react`, for editors built on `EditorFrame` (sdk-core ADR 0067). It takes the editor's `preferences`, `defaultPreferences` and `onPreferencesChange` props, an `onChange` for the editor's own response to a change, such as a toast, and an optional host `theme`. It returns the preferences and everything around them: which inherited fields (theme, density, motion) have been chosen, `change(next)`, the root's `data-hm-*` attributes, the `ThemeToggle`'s value, and `openSettings(root)` with props to spread on `SettingsPanel`. Without preferences, the editor starts in Advanced mode and inherits its page's theme, density and motion until the host or the person chooses them. New types: `UseEditorPreferencesOptions`, `EditorPreferencesControls`, `EditorPreferencesChange` and `InheritedEditorPreference`.

**image-sdk, pdf-sdk, video-sdk and audio-sdk:** the editor uses ui's shared editor preferences; no change in behaviour.
