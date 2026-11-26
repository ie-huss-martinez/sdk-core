---
"@hussmartinez/video-sdk": minor
---

`VideoEditor` renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0010):

- **The top bar** holds the mode switch, Undo, Redo, the theme toggle, Settings and Export.
- **A tools panel** lists the editing tools in two groups, Edit and Add. It shows full, as icons or hidden, with `Ctrl+\` to toggle it.
- **The inspector** is the frame's properties panel, beside the preview, or under it on a phone.
- **The transport, the zoom and the timeline** run across the foot, at full width.
- **On phones,** a tab bar opens each group of tools in a sheet.

New:

- **Levels and descriptions:** splitting, deleting, adding videos, and play and pause are Easy tools; muting and the previous and next frame are Advanced; the start and end are Expert. Each has a one-line description. Easy, Advanced and Expert modes decide what the tools panel lists and which buttons the transport shows, and the command palette (`Mod+K`) reaches every tool in every mode.
- **Start cards:** in Easy mode, each video opens on four cards: Cut a clip, Join clips, Remove a part and Mute the sound.
- **Toasts:** splitting, deleting, muting and adding a clip show a toast with Undo; undo, redo, opening a file and a change of mode or theme show one too.
- **Preferences:** new props `preferences`, `defaultPreferences` and `onPreferencesChange` take ui's `EditorPreferences`. The editor never stores them; keep them where you like, such as `localStorage`. Without them, the editor starts in Advanced mode, which lists every editing tool the toolbar had.
- **Messages:** new keys `tools.*.description`, `toolbar.add`, `toolbar.bar`, `editor.mode.*`, `editor.theme.*`, `editor.commands`, `editor.settings`, `editor.opened`, `editor.added`, `editor.split`, `editor.deleted`, `editor.muted`, `editor.unmuted` and `start.*`.
- **`VideoToolbar`** now announces what an edit did, such as "Deleted 2 clips.", as well as undo and redo.

**Migrating:**

- **Finding tools in the DOM:** rows in the tools panel carry `data-hm-tool-id`, and the bars' buttons `data-tool`. The editor no longer renders `VideoToolbar`, whose buttons keep `data-hm-tool`.
- **`toolbar`:** its groups now place tools: Undo, Redo and Export in the top bar, the zoom with the timeline, and the rest in the tools panel. `toolbar={[]}` still shows no tool, and keeps the shortcuts and the palette. The insert tool's `group` is now `add`.
- **The transport:** in Easy mode it shows only play and pause; Expert adds the start and end. Without preferences the editor is in Advanced mode, whose transport is the one it had.
- **Layout:** give the editor a bounded height; the preview takes what the bars leave. The inspector's 720-pixel container rule is gone: the frame places it.
- **Theme, density and motion:** unchanged unless you opt in: without preferences, or a default for the field, the editor inherits the page's until the person picks one in the settings, or the theme with the toggle, which shows the inherited theme.
