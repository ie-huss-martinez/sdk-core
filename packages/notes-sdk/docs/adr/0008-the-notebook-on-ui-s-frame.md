# 0008. The notebook on ui's frame

- **Status:** Accepted
- **Date:** 2026-11-26
- **Refines:** [ADR 0001](0001-a-familiar-layout-with-our-own-assets.md)'s open notebook and its design values, under [sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md). The library, the ink engine and everything ADR 0001 says about assets stand.
- **Builds on:** [ADR 0007](0007-sound-alongside-the-ink.md) (recording); in image-sdk, [ADR 0016](../../../image-sdk/docs/adr/0016-the-editor-on-ui-s-frame.md), the worked example

## Context

sdk-core ADR 0067 gives every editor of the family one frame, three modes and preferences the host keeps, with the primitives in `ui`. image, pdf, video and audio are on it. notes-sdk is the last, and the odd one out: it isn't one file opened and exported, but a library and, inside it, a notebook, laid out the way handwriting apps are (ADR 0001). Its redraw of 2026-11-24 gave it a blue bar of tools across the top, pills floating over the pages, and design values of its own, `--hm-notes-*`, meant to move to `ui` once they settled. They're what ADR 0067's look was built from.

The maintainer and the family's reviewer approved the plan below on 2026-11-26, with two decisions of Huss's own.

## Decision

### Only the open notebook is on the frame

- **The library keeps its layout:** its rail, search, title and grid of covers (ADR 0001, amended). It isn't an editor of one document, and nothing in it maps to tools, properties or a transport.
- **`NotesNotebook` renders through `EditorFrame`,** inside `NotesEditor` and on its own.

### The regions

- **The top bar:** "Back to the library", the notebook's title and whether it's saved, the mode switch, Undo, Redo, the page sidebar and search, the command palette's button in Expert, the theme toggle (unless the host set a `theme`), Settings, and Export as PDF as the one primary button. The frame adds ☰ and the properties' toggle.
- **The tools:** a `ToolList` of the writing tools.
  - In a **dock**, the pill over the foot of the pages, by default (Huss, 2026-11-26), or in the frame's sidebar, from the settings. The layout is the frame's `toolsLayout` preference: notes-sdk's own default for it is `dock`, ahead of ui's `sidebar`, and a host's `defaultPreferences` or `preferences` win.
  - The dock is an opaque raised surface over the paper, not ui's frosted glass: ink blurred through it would smudge the page, and Chromium draws a backdrop blur over a canvas a level apart at the dock's edge from one load to the next, which the screenshots caught (sdk-core ADR 0054).
  - On a phone, below 45 rem, a `TabBar` of the groups, each opening a `Sheet`, and the mode switch moves to the settings, as image-sdk's does.
- **The properties:** the tool in hand's options, in the frame's properties panel: three widths at a tap and any width on a slider, and the tool's palette through ui's `ColorPicker`, in its `palette` variant, with any colour by its hex value. They were a pill over the pages with a "More options" popover.
- **The stage:** the page sidebar (thumbnails, outline, search, recordings) beside the pages, inside the stage rather than in a region of the frame, since it's part of the notebook's own layout; and over the pages, where you are and the zoom.
- **The bottom region:** the recording's transport (ADR 0007), while sound is recorded, while a recording waits to be stored, or while one plays.

### The blue bar stays, in both themes

- **Huss's decision, 2026-11-26:** the bar across the top of a notebook stays the fixed blue it has been, in the dark theme too, as the cover of a real notebook doesn't change with the light.
- It reaches the frame through the frame's top-bar tokens, `--hm-editor-frame-bar-bg` and `--hm-editor-frame-bar-fg`, set from notes-sdk's stylesheet to `--hm-notes-chrome` and `--hm-notes-on-chrome`. ui's buttons in the bar are drawn for it through their own component tokens: light glyphs, and a white tile for what's pressed and for the primary button. There's no second bar.

### Tools, levels and groups

- **Levels** (sdk-core ADR 0067, the redesign's §4):
  - `easy`: pen, highlighter, eraser and text;
  - `advanced`: the lasso, a picture and a link;
  - `expert`: the rest: the hand, straightening shapes, writing with a finger, adding and deleting a page, recording, selecting everything and deleting the selection.
- **Bar tools have no level:** back to the library, undo, redo, the sidebar, search, the zoom and Export as PDF, the `BAR_TOOLS` set. They're in the top bar or over the pages in every mode.
- **Groups:** the default toolbar's panel groups are Write (pen, highlighter, eraser, text), Select and add (lasso, picture, link), Writing options (hand, straighten, finger), Pages and Recording. The lasso, picture and link tools' `group` is now `select`, and the hand's `options`. Each tool has a one-line description, `tools.<id>.description`.
- **Every tool is in the command palette,** on `Mod+K` (`notes.command-palette`), in every mode, with its group and shortcut.
- **Rows** carry `data-hm-tool-id`, and the bar's buttons `data-tool`; focus that moves to a tool looks for both.

### Start cards, toasts and preferences

- **Start cards** show in Easy mode, once per opened notebook, while it's empty: Write by hand (the pen), Type notes (text), Mark up a PDF, and Record a lecture (recording). A card is offered only if its tool is, and Mark up a PDF only where a PDF engine and the editor's `onOpenNotebook` are. Mark up a PDF imports the PDF as a new notebook, in the same folder, and opens it, as the library's import does: putting a PDF's pages into a notebook that exists is a feature of its own. Write by hand and Type notes show the tool's options for that notebook, without changing the preference. "Just show me the notebook" closes them.
- **Easy mode** shows the properties panel while the tool in hand has options, which the writing tools all do.
- **Toasts** replace the notebook's announcements, through a `ToastProvider` inside the editor's root:
  - an edit made with the notebook's controls, such as adding or deleting a page, moving, recolouring, duplicating or deleting a selection, a picture, a link, a page's paper, the outline or the pages' order, says "Applied <action>." with Undo;
  - writing itself, strokes, erasing and typing, shows no toast: it's what's on the page, and a toast per stroke would cover the notes;
  - one edit's toast at a time: it goes as soon as the notebook changes in any other way, a stroke, an undo or a redo included, so its Undo always undoes the edit it names;
  - undo and redo say "Undone." and "Redone."; an export, and a recording started and stored, say so too;
  - a change of mode, or a theme chosen, says its name;
  - while the tools are docked, the toasts sit above the dock.
  Selecting is still said only to screen readers: the selection's box shows it.
- **Preferences:** `NotesEditor` takes `preferences`, `defaultPreferences`, `onPreferencesChange` and `theme`, through ui's `useEditorPreferences`, and never stores them. One set serves both views, so a theme or a mode chosen in one notebook holds in the library and the next. The embedded default is Advanced. `NotesNotebook` on its own takes the same props. The element takes `preferences` and `defaultPreferences` as properties, and dispatches `hm-notes-editor-preferences`.

### Design values become ui's

- **What duplicated a ui token is gone,** replaced by `ui`'s semantic token: radii, shadows, motion, the frosted surfaces, lines, hover and pressed colours, muted text, the scrim, small type and strong weight, layers, the library's rail widths and the page sidebar's width, and the notes toast's width.
- **What's specific to notebooks stays:** the paper, the covers and folders, the blue bar, the recording's colour, the library's layout and its title type, the size marks of the widths, and the library's dealing-in motion, whose stagger now follows ui's duration so ui's reduced motion stops it.
- ui's component tokens are read with a semantic fallback and never declared by ui; notes-sdk sets only the frame's top-bar tokens and the button tokens inside it, on its own elements.

## Alternatives considered

- **The library on the frame too:** it has no tools, properties or transport, and its rail is what people of the category expect (ADR 0001).
- **The sidebar layout by default,** as the other editors have: the pages want the width, and a dock is how handwriting apps hold their pens.
- **A bar that follows the theme:** it would change what the notebook looks like with the light, as covers don't.
- **The page sidebar in the frame's tools or properties region:** it isn't a tool or a tool's options, and it would push the tool's options off a narrow screen.
- **A toast for every stroke:** with Undo on each, a toast would follow every line written, and cover the notes being written.
- **Mark up a PDF inside the empty notebook:** a new feature, with its own checks of the file, where the library's import already does it.

## Consequences

- The notebook looks and behaves as the family's other editors, and fixes to the frame reach it.
- The release is a minor: `--hm-notes-*` tokens a host may have set are gone (the changeset lists each and its replacement), the toolbar's markup is ui's, and three tools changed group.
- `NotesToolbar` stays exported as a building block, but the editor no longer renders it.
- The paused branch that redraws the notebook's toolbar and menus rebases onto this: its toolbar becomes the `ToolList` and the properties panel.
- The React entry's floor, `notesEditorMessages`, grows with the frame's text: descriptions, start cards, actions and the modes' names.
