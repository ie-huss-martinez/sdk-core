---
"@hussmartinez/audio-sdk": minor
---

`AudioEditor` renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0007):

- **The top bar** holds the mode switch, Open, Undo, Redo, the theme toggle, Settings and Export.
- **A tools panel** lists the editing tools in five groups, Cut, Fade, Clip, Selection and Tracks. It shows full, as icons or hidden, with `Ctrl+\` to toggle it.
- **The timeline** stays the stage, with the notices above it; **the inspector** is the properties panel, beside it on a wide editor and under it on a phone.
- **The transport and the zoom** run across the editor's foot.
- **On phones,** a tab bar opens each group of tools in a sheet.

New:

- **Levels and descriptions:** trimming, splitting, deleting, fading and playing are Easy tools; adding recordings and tracks, muting, moving clips and the selection's tools are Advanced; Ripple, moving clips between tracks, moving tracks and going to the start or end are Expert. Each has a one-line description. Easy, Advanced and Expert modes decide what the tools panel lists, and what the transport shows: the start and end buttons are Expert's. The command palette (`Mod+K`) reaches every tool in every mode.
- **Start cards:** in Easy mode, each recording opens on four cards: Cut the start or end, Remove a part, Fade in or out and Combine recordings.
- **Toasts:** edits, undo, redo, refusals, opening and adding a recording show a toast with the text the editor announced before, the timeline's drags and keys included. An edit's toast offers Undo.
- **Preferences:** new props `preferences`, `defaultPreferences` and `onPreferencesChange` take ui's `EditorPreferences`. The editor never stores them; keep them where you like, such as `localStorage`. Without them, the editor starts in Advanced mode. The `theme` prop still wins, and then the top bar has no theme toggle.
- **Messages:** new keys `tools.*.description`, `toolbar.cut`, `toolbar.fade`, `toolbar.bar`, `editor.mode.*`, `editor.theme.*`, `editor.commands`, `editor.settings` and `start.*`.

**Migrating:**

- **Finding tools in the DOM:** rows in the tools panel carry `data-hm-tool-id`, and the frame's buttons `data-tool`. The editor no longer sets `data-hm-tool`.
- **`toolbar`:** its groups now place tools: Open, Undo, Redo and Export in the top bar, the zoom by the transport, and the rest in the tools panel. `toolbar={[]}` still shows no tool, and keeps the shortcuts and the palette.
- **Tool groups:** splitting, deleting and trimming now have the `group` `cut`, the fades `fade`, and adding a recording `tracks`.
- **The inspector's place** follows the frame's widths, 60 and 45 rem of the editor, rather than 1080 px.
- **`unstyled`** still leaves out the editor's look, and ui's `hm-text`, but the root keeps its column layout, which the frame needs.
- **Theme, density and motion:** unchanged unless you opt in: without the `theme` prop, preferences or a default for the field, the editor inherits the page's until the person picks one in the settings, or the theme with the toggle, which shows the inherited theme.
- **`AudioToolbar`:** it's still exported, but the editor no longer uses it.
