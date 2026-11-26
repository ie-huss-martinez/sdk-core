# 0012. The editor on ui's frame: levels, start cards, toasts and preferences

- **Status:** Accepted
- **Date:** 2026-11-26
- **Refines:** the editor's layout in [ADR 0008](0008-page-organisation-in-the-editor.md) (the toolbar as the guaranteed path) and [ADR 0009](0009-saving-the-document.md) (the header's saving status and alert), under [sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md). Their tools, keys, selection, focus and saving stand.
- **Follows:** image-sdk's [ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/image-sdk/docs/adr/0016-the-editor-on-ui-s-frame.md), the pilot

## Context

sdk-core ADR 0067 gives every SDK editor one frame, three modes and preferences that the host keeps, with the primitives in `ui`. image-sdk moved first. `PdfEditor` still lays itself out as a header, with one toolbar of every tool and the notices under it, above the thumbnails and the viewer.

The PDF editor differs from the image editor in three ways that shape the move:

- **It has no inspector.** Its tools act at once on the selected pages, or the current one, and have no settings.
- **Its thumbnails are the selection.** Deleting and moving act on the pages selected there, and their keys work only there (ADR 0008).
- **Its failures must stay.** A failed insert or save shows an alert until the next document opens (ADR 0009).

## Decision

- **The editor renders through `EditorFrame`.**
  - The top bar holds the editor's name and the file's, the mode switch, Open, Undo and Redo, the command palette's button in Expert mode, the theme toggle, Settings, and Download as the one primary button. The frame adds its ☰ for the tools.
  - The tools panel is a `ToolList` of the page tools.
  - There's no properties panel, so no toggle for one, and the settings leave its row out.
  - The stage holds the notices, then the thumbnails beside the viewer, as before. The thumbnails are how pages are selected and found, not a tool's settings, so they stay with the document.
  - On a phone, a `TabBar` of the groups opens each in a `Sheet`.
- **Levels,** from the redesign's spec:
  - `easy`: rotate left and right, delete pages and insert pages;
  - `advanced`: move earlier and move later;
  - `expert`: none yet;
  - Open, Undo, Redo and Download have no level: they're in the top bar in every mode.
  - Each panel tool has a one-line description, which the panel shows in Easy mode while tips are on.
- **Groups:** `DEFAULT_TOOLBAR` groups "Rotate"; "Remove and add", deleting and inserting; and "Reorder", the move tools. Each is named after its first tool's group, so the rotate tools move to a `rotate` group, insert to `pages` and the move tools to `order`. The bar's tools keep groups of their own.
- **Keys:** deleting and moving keep their keys in the thumbnails only (ADR 0008). Their rows give them as `aria-keyshortcuts`, but show no shortcut in Expert mode, where a key that works only in the thumbnails would mislead.
- **Every tool is in the command palette** (`Mod+K`) in every mode, so a level never takes a tool from keyboard or screen-reader users.
- **Easy mode** opens each document on four start cards: "Rotate pages", "Remove pages", "Add pages from another PDF" and "Reorder pages".
  - Each card leads to its tools, with focus on the first that can run, and its row is always there: in the panel, shown again as it was last shown if the person hid it, or on a phone in its group's sheet. "Add pages" asks for a file at once, so on a phone it leaves focus on its group's tab rather than opening a sheet over the picker. Rotating, removing and reordering act on the pages the person selects, so these cards don't run anything. Only "Add pages" runs its tool, which asks for a file and changes nothing until one is chosen.
  - "Reorder pages" lists the move tools in Easy mode too, for that document only, as image-sdk's "Make it look better" shows the properties.
  - The cards show only when one of their tools is present and can run: no removing or reordering a document of one page.
  - The cards cover the document, so focus moves to the first card when a document opens, rather than to the document behind it. "Just show me the editor" closes them and puts focus on the document.
  - Running any tool closes them too.
- **Toasts replace the editor's announcements,** with the same text.
  - An edit says what it did, such as "Rotated 2 pages.", with Undo while the undo tool is present.
  - One edit's toast shows at a time. The editor remembers the plan the edit left, and the toast goes once the plan changes, whether by another edit, an undo or the host.
  - Undo and redo say "Undone." and "Redone.". Opening and closing say so too, and a save says the file's name, or that the PDF is ready for `onExport`.
  - A change of mode or theme says its name.
- **Notices stay above the document.** Saving's status and Cancel, a failed save, open or insert, and the file policy's warnings keep their places from ADRs 0008 and 0009, in the `header` part, now above the thumbnails and the viewer rather than under a toolbar. A failure stays until the next document opens, which a toast that leaves after a few seconds can't do.
- **Preferences:** `PdfEditor` takes `preferences`, `defaultPreferences` and `onPreferencesChange`, and never stores them.
  - Without them, it starts in Advanced mode, which lists every tool, as the toolbar did. The family's apps pass their own, with Easy on a first visit.
  - The theme, density and motion are each set on the root once chosen: when the host passes preferences, or a default for that field, or the person changes it. Until then, the editor inherits the page's, so a page in compact density or reduced motion keeps them in the editor. The theme toggle shows the theme the editor inherits until one is chosen.
- **The root is a region,** a `section` named "PDF editor", where it was a `group`. The frame's top bar is a `header`, which outside a sectioning element would be the host page's banner landmark. The region also makes the editor easy to find, as image-sdk's is.
- **Tools in the DOM:** the panel's rows carry `data-hm-tool-id` and the bar's buttons `data-tool`, as image-sdk's do. The editor no longer sets `data-hm-tool`, which only `PdfToolbar` still does.

## Alternatives considered

- **The thumbnails as the properties panel:** they would get a toggle that hides the pages, and a phone would put them under the document. They're the document's navigation and selection, not settings.
- **Failures as danger toasts,** as sdk-core ADR 0067 suggests: a toast leaves after a few seconds, and ADR 0009 keeps a failure in view until the next document. Warnings stay inline in ADR 0067 too.
- **Cards that run their first tool,** as image-sdk's crop card does: rotating or deleting at once would change a page the person hadn't chosen.
- **Keeping the root a `group`:** the frame's `header` would become the host page's banner wherever the editor isn't inside a sectioning element.

## Consequences

- The editor's look and layout change for every host, so the release is a minor one. A host that found tools by `data-hm-tool` now uses `data-hm-tool-id` for the panel's rows and `data-tool` for the bar's buttons, and one that found the editor by `role="group"` finds a region.
- ADR 0008's guaranteed path, the toolbar's buttons, is now the panel's rows and the bar's buttons, which keep focus when they become disabled. In Easy mode the move tools aren't listed until the "Reorder pages" card is chosen or the mode changes; the palette and the thumbnails' keys still reach them.
- `PdfToolbar` stays exported as a building block, but the editor no longer renders it.
- The editor's screenshots are all new, and the example's `?app` page behaves as an app: it fills the window, opens in Easy and keeps preferences in `localStorage`. `?mode=` starts the embedded editor in a mode.
- The hook that keeps preferences is a copy of image-sdk's. If the other editors copy it too, it belongs in `ui`.
