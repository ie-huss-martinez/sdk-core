---
"@hussmartinez/image-sdk": minor
---

The editor renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0016):

- **The top bar** holds Open, Undo, Redo, the mode switch, the theme toggle, Settings and Export.
- **A tools panel** shows full, as icons or hidden, with `Ctrl+\` to toggle it.
- **The inspector** moves into the properties panel.
- **Zoom** floats over the stage.
- **On phones,** a tab bar opens each tool group in a sheet.

New:

- **Levels and descriptions:** each tool has a level and a one-line description. Easy, Advanced and Expert modes decide what the tools panel lists. The command palette (`Mod+K`) reaches every tool in every mode.
- **Start cards:** Easy mode opens each image on four start cards.
- **Toasts:** an edit shows a toast with Undo, and undo, redo, open and download show what happened.
- **Preferences:** new props `preferences`, `defaultPreferences` and `onPreferencesChange` take ui's `EditorPreferences`. The editor never stores them; keep them where you like, such as `localStorage`. Without them, the editor starts in Advanced mode: every tool stays in the panel except Layers and Frames, which are Expert tools. They're still in the command palette, and on their shortcuts L and F. Pass `defaultPreferences={{ mode: "expert" }}` to list them.
- **Messages:** new keys `tools.*.description`, `editor.applied`, `editor.downloaded`, `editor.mode.*`, `editor.theme.*`, `editor.commands`, `editor.settings`, `editor.size`, `start.*` and `toolbar.groups.playback`. Four group names now say what the group holds, such as "Crop and redact".

**Migrating:**

- **Size:** give the editor a height. It fills its box, at least 24rem.
- **Finding tools in the DOM:** tools in the panel carry `data-hm-tool-id`; only the bar's buttons keep `data-tool`.
- **Theme:** unchanged unless you opt in: without `theme`, preferences or a default theme, the editor inherits the page's theme until the person picks one with the toggle or the settings.
- **`DEFAULT_TOOLBAR`:** its groups changed.
- **`ImageToolbar`:** it's still exported, but the editor no longer uses it.
