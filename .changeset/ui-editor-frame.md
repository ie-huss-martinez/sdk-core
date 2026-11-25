---
"@hussmartinez/ui": minor
---

Add the editor frame and a new look (sdk-core ADR 0067).

- **New components** in `@hussmartinez/ui/react`: `EditorFrame` with `useEditorFrame`, `ToolList`, `ModeSwitch`, `ThemeToggle`, `TabBar`, `Sheet`, `SettingsPanel`, `CommandPalette`, `ToastProvider` with `useToast`, `ProgressOverlay`, and `ColorPicker` with `addRecentColor` (ui ADR 0013).
- **Preferences:** `EditorPreferences`, `defaultEditorPreferences`, `editorPreferenceOptions` and `readEditorPreferences`, from both entries. The reader never throws, and gives each invalid field its default.
- **New look:** larger radii, pill-shaped buttons and segmented controls, softer shadows and calmer dark surfaces. New tokens: `color-control-disabled`, `color-surface-glass`, `shadow-floating`, `blur-glass`, `sidebar-width`, `rail-width`, `inspector-width`, `bar-height`, `motion-duration-panel`, `motion-easing-panel`, `motion-easing-spring`, the base tokens `radius-xl`, `radius-2xl`, `easing-emphasized` and `easing-spring`, and component tokens for each new component. Motion durations are now 150, 250 and 350 ms.
- **Disabled buttons look disabled:** every variant draws a disabled button in neutral colours (`--hm-button-disabled-bg` and `--hm-button-disabled-fg`) instead of its own colours at half opacity, in both themes.
- **Reduced motion is a token:** with `prefers-reduced-motion: reduce`, or `data-hm-motion="reduced"` on an ancestor, the motion durations are zero. `data-hm-motion="full"` keeps motion in a subtree, and `"system"` follows the system again.
- **New icons:** `panel-collapse`, `panel-expand`, `properties`, `settings`, `theme-dark`, `theme-light`, `command` and `eyedropper`.

**Why a minor:** the new look changes how every component is drawn, so screenshot baselines of every host and SDK change, and a theme built with `createTheme` from a complete set of semantic tokens must add the new ones.
