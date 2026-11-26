# 0010. The editor on ui's frame: levels, the transport by mode, start cards, toasts and preferences

- **Status:** Accepted
- **Date:** 2026-11-26
- **Refines:** the layout and the toolbar in [ADR 0007](0007-editor-shell.md), under [sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md). Its timeline, keys, focus, inspector and canvas stand.
- **Follows:** image-sdk's [ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/image-sdk/docs/adr/0016-the-editor-on-ui-s-frame.md), the pilot, and pdf-sdk's [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/pdf-sdk/docs/adr/0012-the-editor-on-ui-s-frame.md)

## Context

sdk-core ADR 0067 gives every SDK editor one frame, three modes and preferences that the host keeps, with the primitives in `ui`. image-sdk and pdf-sdk have moved. `VideoEditor` still lays itself out as ADR 0007 set it: a toolbar of every tool, the preview with its transport under it, the timeline, and the inspector beside them in a wide container.

The video editor differs from the first two in three ways that shape the move:

- **It has a timeline and a transport,** which ADR 0067 puts in the frame's bottom region, at full width.
- **Its playback tools have levels** in the redesign's spec (play and pause in Easy, a frame back and on in Advanced, the start and end in Expert), but the transport is where playback happens, and ADR 0007 kept them off the toolbar for that reason.
- **Its edits act on the playhead and the selected clips,** so a start card can lead to a tool that can't run yet.

## Decision

- **The editor renders through `EditorFrame`.**
  - The top bar holds the editor's name, and the host's `fileName` when it gives one, the mode switch, Undo and Redo, the command palette's button in Expert mode, the theme toggle, Settings, and Export as the one primary button. The frame adds its ☰ for the tools and its toggle for the properties.
  - The tools panel is a `ToolList` of the editing tools.
  - The properties panel is the inspector, unchanged.
  - The stage is the preview.
  - The bottom region holds the transport, the timeline's own tools and the zoom on one line, which wraps on a phone, then the timeline.
  - On a phone, a `TabBar` of the groups opens each in a `Sheet`, and the properties sit under the preview.
- **Levels,** from the redesign's spec:
  - `easy`: split, delete, add videos, and play and pause;
  - `advanced`: mute, and the previous and next frame;
  - `expert`: the start and the end;
  - Undo, Redo, Export and the zoom have no level: they're in the top bar or with the timeline in every mode.
  - Each tool with a level has a one-line description, which the panel shows in Easy mode while tips are on.
- **Playback stays with the transport.** Its tools are never in the tools panel. Their levels decide which of them the transport shows: play and pause in every mode, the previous and next frame from Advanced, and the start and end in Expert. Their keys work in every mode, and the palette lists them.
- **Groups:** `toolbar`'s default groups are "Edit", splitting, deleting and muting; "Add", adding videos, whose tool moves to an `add` group; then the bar's: history, export and the zoom. Each is named after its first tool's group.
- **Every tool is in the command palette** (`Mod+K`) in every mode, so a level never takes a tool from keyboard or screen-reader users.
- **Easy mode** opens each video on four start cards: "Cut a clip", "Join clips", "Remove a part" and "Mute the sound".
  - Each card leads to its tools, with focus on the first that can run, or else the first, and its row is always there: in the panel, shown again as it was last shown if the person hid it, or on a phone in its group's sheet.
  - "Join clips" runs its tool, which asks for files and changes nothing until one is chosen. On a phone it leaves focus on its group's tab rather than opening a sheet over the picker.
  - "Mute the sound" lists the mute tool in Easy mode too, and shows the properties, where the clips' sound is, for that video only, as image-sdk's "Make it look better" does.
  - The cards show while one of their tools is present, whether or not it can run yet: splitting needs the playhead inside a clip, and deleting and muting a selected clip, which the person chooses after the card.
  - The cards cover the preview, so the first takes focus as they appear. A clip added while they show, as when several files are chosen at once, takes focus in the timeline (ADR 0007); it comes back to the first card. "Just show me the editor" closes them and puts focus on the timeline's clip.
  - Running any tool closes them too.
- **Toasts replace the editor's announcements** of what a tool did.
  - Splitting, deleting and muting say what they did, such as "Deleted 2 clips.", with Undo while the undo tool is present. Adding a video says "Added a clip.", with Undo.
  - One edit's toast shows at a time. The editor remembers the plan the edit left, and the toast goes once the plan changes, whether by another edit, an undo, the inspector or the host.
  - Undo and redo say "Undone." and "Redone.", as they did. Opening a file from the handle says so. A change of mode or theme says its name.
  - `useVideoTools` reports what a tool did. The editor turns it into a toast; the building blocks, such as `VideoToolbar` in a host's own layout, announce it, so they now say what an edit did too.
  - The export dialog keeps its own announcements: a toast outside an open modal dialog isn't there for a screen reader.
  - Warnings and failures stay on the preview, as ADR 0007 placed them.
- **Preferences:** `VideoEditor` takes `preferences`, `defaultPreferences` and `onPreferencesChange`, and never stores them.
  - Without them, it starts in Advanced mode, which lists every editing tool the toolbar had, and the transport's buttons as before. The family's apps pass their own, with Easy on a first visit.
  - The theme, density and motion are each set on the root once chosen: when the host passes preferences, or a default for that field, or the person changes it. Until then, the editor inherits the page's, as the element's `theme` attribute sets it. The theme toggle and the settings show the values in effect.
- **Tools in the DOM:** the panel's rows carry `data-hm-tool-id` and the bars' buttons `data-tool`, as image-sdk's and pdf-sdk's do. `VideoToolbar` keeps its `data-hm-tool`.

## Alternatives considered

- **Playback's tools in the tools panel,** as their levels would put them: play would be there and on the transport in every mode, two controls for one action, which ADR 0067's amendment rules out for the panels' toggles.
- **The inspector only on a card in Advanced too:** it holds the output's settings and the clips' sound and picture, which an Advanced user reaches for, as ADR 0007 has it.
- **Cards that only show when their tool can run,** as pdf-sdk's do: a video opens with the playhead at its start and, for a host's insert, nothing selected, so "Cut a clip" and "Mute the sound" would rarely show.
- **Toasts for the inspector's changes:** a volume drag or a fade typed digit by digit would make a toast each time. The inspector's controls show their values, and the edit toast still goes when they change the plan.

## Consequences

- The editor's look and layout change for every host, so the release is a minor one. A host that found tools by `data-hm-tool` now uses `data-hm-tool-id` for the panel's rows and `data-tool` for the bars' buttons.
- In Easy mode the transport shows only play and pause, and the panel no mute; the keys and the palette still reach them.
- The inspector moves into the frame's properties panel, which the frame places by its own container queries; the old 720-pixel rule is gone.
- `VideoToolbar` stays exported as a building block, but the editor no longer renders it. It now announces what an edit did.
- The editor's screenshots are all new, and the example's `?app` page behaves as an app: it fills the window, opens in Easy and keeps preferences in `localStorage`. `?mode=` starts the embedded editor in a mode.
- The hook that keeps preferences and the inherited values are copies of image-sdk's and pdf-sdk's. With a fourth copy in audio-sdk, they belong in `ui`.
