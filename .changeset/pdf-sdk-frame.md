---
"@hussmartinez/pdf-sdk": minor
---

`PdfEditor` renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0012):

- **The top bar** holds Open, Undo, Redo, the mode switch, the theme toggle, Settings and Download.
- **A tools panel** lists the page tools in three groups, Rotate, Remove and add, and Reorder. It shows full, as icons or hidden, with `Ctrl+\` to toggle it.
- **The notices** for saving, failures and warnings sit above the document, which keeps its thumbnails beside it.
- **On phones,** a tab bar opens each group of tools in a sheet.

New:

- **Levels and descriptions:** rotating, deleting and inserting are Easy tools; moving pages is Advanced. Each has a one-line description. Easy, Advanced and Expert modes decide what the tools panel lists, and the command palette (`Mod+K`) reaches every tool in every mode.
- **Start cards:** in Easy mode, each document opens on four cards: Rotate pages, Remove pages, Add pages from another PDF and Reorder pages.
- **Toasts:** opening, each edit, undo, redo and saving show a toast with the text the editor announced before. An edit's toast offers Undo.
- **Preferences:** new props `preferences`, `defaultPreferences` and `onPreferencesChange` take ui's `EditorPreferences`. The editor never stores them; keep them where you like, such as `localStorage`. Without them, the editor starts in Advanced mode, which lists every tool, as the toolbar did.
- **Messages:** new keys `tools.*.description`, `toolbar.bar`, `toolbar.groups.rotate`, `toolbar.groups.order`, `editor.mode.*`, `editor.theme.*`, `editor.commands`, `editor.settings` and `start.*`. `toolbar.groups.pages` now reads "Remove and add".

**Migrating:**

- **Finding the editor:** its root is a `section`, a region named "PDF editor", rather than a `role="group"`.
- **Finding tools in the DOM:** rows in the tools panel carry `data-hm-tool-id`, and the top bar's buttons `data-tool`. The editor no longer sets `data-hm-tool`.
- **`toolbar`:** its groups now place tools: Open, Undo, Redo and Download in the top bar, and the rest in the tools panel. `toolbar={[]}` still shows no tool, and keeps the shortcuts and the palette.
- **Tool groups:** the rotate tools' `group` is now `rotate`, the insert tool's `pages` and the move tools' `order`.
- **The `header` part** of `classNames` now styles the notices above the document; the toolbar is no longer in it.
- **Theme:** unchanged unless you opt in: without preferences or a default theme, the editor inherits the page's theme until the person picks one with the toggle or the settings.
- **`PdfToolbar`:** it's still exported, but the editor no longer uses it.
