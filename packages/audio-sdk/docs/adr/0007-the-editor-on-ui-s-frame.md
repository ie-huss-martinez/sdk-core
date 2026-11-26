# 0007. The editor on ui's frame: levels, start cards, toasts and preferences

- **Status:** Accepted
- **Date:** 2026-11-26
- **Refines:** the editor's layout in [ADR 0005](0005-editor-shell.md) (the toolbar, the inspector's place and the announcements) and [ADR 0006](0006-multitrack.md) (the toolbar's track and clip tools), under [sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md). Their tools, keys, timeline, selection, focus and export stand.
- **Follows:** image-sdk's [ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/image-sdk/docs/adr/0016-the-editor-on-ui-s-frame.md), the pilot, and pdf-sdk's [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/packages/pdf-sdk/docs/adr/0012-the-editor-on-ui-s-frame.md)

## Context

sdk-core ADR 0067 gives every SDK editor one frame, three modes and preferences that the host keeps, with the primitives in `ui`. image-sdk and pdf-sdk moved first. `AudioEditor` still lays itself out as one toolbar of every tool above the notices, then the stage and the transport, with the inspector beside them from 1080 px or under them below.

The audio editor differs from the other two in three ways that shape the move:

- **Its timeline is its canvas.** There's no picture to preview: the stage is the timeline, a lane per track with its header, waveform and clips. The redesign's spec puts a timeline and transport in the frame's `bottom` region, under a stage; here that region would grow with every track and leave the stage nothing.
- **It has playback.** Play and pause, the start and the end are tools with keys, and the transport is their place.
- **Its tools say what they did.** Every track, clip and range edit, and every refusal, is already announced through the tools' context, from the panel, the keys and the timeline's drags alike.

## Decision

- **The editor renders through `EditorFrame`.**
  - The top bar holds the editor's name, and the `fileName` prop when given, the mode switch, Open, Undo and Redo, the command palette's button in Expert mode, the theme toggle, Settings, and Export as the one primary button. The frame adds its ☰ for the tools and the properties' toggle.
  - The tools panel is a `ToolList` of the editing tools. The `toolbar` part of `classNames` goes on it.
  - The stage holds the notices, then the summary and the timeline, as before; the timeline scrolls in it. Easy mode's start cards cover it.
  - The inspector is the properties panel.
  - The frame's `bottom` region holds the transport and, at its far end, the zoom. On a phone, the line wraps.
  - On a phone, a `TabBar` of the groups opens each in a `Sheet`.
- **Levels,** from the redesign's spec:
  - `easy`: trimming the start and the end, splitting, deleting, fading in and out, and playing;
  - `advanced`: adding a recording, adding, removing and muting tracks, moving a clip earlier or later, and the selection's start, end and clearing;
  - `expert`: Ripple, moving a clip to the track above or below, moving tracks, and going to the start or the end;
  - Open, Export, Undo, Redo and the zoom have no level: they're in the frame's bars in every mode;
  - each panel tool has a one-line description, which the panel shows in Easy mode while tips are on.
- **Playback stays with the transport,** never in the panel. The transport shows play and pause in every mode, and the start and the end in Expert, by their levels. Without a mode, as the `AudioTransport` building block, it shows play and the start, as before.
- **Groups:** `DEFAULT_TOOLBAR` groups "Cut", trimming, splitting and deleting; "Fade"; "Clip", the moves; "Selection"; and "Tracks", adding a recording first. Each is named after its first tool's group, so splitting, deleting and trimming move to a `cut` group, the fades to `fade`, and adding a recording to `tracks`. The bars' tools keep groups of their own.
- **Every tool is in the command palette** (`Mod+K`) in every mode, so a level never takes a tool from keyboard or screen-reader users. Its key is in the provider's shortcut registry, as `audio.command-palette`, and only the editor answers it.
- **Easy mode** opens each recording on four start cards: "Cut the start or end", "Remove a part", "Fade in or out" and "Combine recordings".
  - Each card leads to its tools, with focus on the first that can run, or else the first, and its row is always there: in the panel, shown again as it was last shown if the person hid it, or on a phone in its group's sheet. "Combine recordings" asks for a file at once, so on a phone it leaves focus on its group's tab rather than opening a sheet over the picker.
  - Their tools act on the playhead, the selected clip and the selected time, so the cards don't run anything, except combining, which changes nothing until a file is chosen. They're shown whenever one of their tools is present, whether or not it can run yet: a recording opens with nothing selected.
  - "Combine recordings" lists adding a recording in Easy mode too, and "Fade in or out" shows the properties, where a fade's length is set, both for that recording only, as image-sdk's "Make it look better" shows the properties.
  - The cards cover the stage, so focus moves to the first card when a recording opens, after the playhead has taken it. "Just show me the editor" closes them and puts focus on the playhead. Running any tool closes them too.
- **Toasts replace the editor's announcements,** with the same text.
  - The tools' context says what a tool did through the provider's `feedback`, which the editor sets: the panel's tools, the keys and the timeline's drags all reach the toasts. Without the editor, as with the building blocks, it's announced as before.
  - A result that changed the plan is an edit, such as "Clip deleted.", with Undo while the undo tool is present. One edit's toast shows at a time. The editor remembers the plan the edit left, and the toast goes once the plan changes, whether by another edit, an undo or the host.
  - Undo and redo say "Undone." and "Redone.". Opening says so, and adding a recording is an edit's toast. A refusal, such as "There's no room for the clip there.", is a toast without Undo.
  - The export dialog keeps its own announcements: it's modal, and the toasts sit behind it.
  - A change of mode or theme says its name.
- **Preferences:** `AudioEditor` takes `preferences`, `defaultPreferences` and `onPreferencesChange`, and never stores them.
  - Without them, it starts in Advanced mode. The family's apps pass their own, with Easy on a first visit.
  - The theme, density and motion are each set on the root once chosen: when the host passes preferences, or a default for that field, or the person changes it. Until then, the editor inherits the page's. The theme toggle and the settings show the values in effect, the page's included.
  - **The `theme` prop wins,** as image-sdk's does: with it, the top bar has no theme toggle and the settings leave the theme out.
- **The root keeps its layout when `unstyled`.** It's a column that the frame fills, and the frame keeps its own layout with `unstyled`; what goes is the look: the frame's and the editor's colours, and `hm-text`.
- **Tools in the DOM:** the panel's rows carry `data-hm-tool-id` and the bars' buttons `data-tool`, as the other editors' do. The editor no longer sets `data-hm-tool`, which only `AudioToolbar` still does.

## Alternatives considered

- **The timeline in the frame's `bottom` region,** as the spec draws it for a video editor: the region is as tall as its content, so a recording of many tracks would push the stage, which would hold only the summary, to nothing, and the timeline couldn't scroll within the editor.
- **Playback's tools in the panel,** by their levels: Easy's panel would repeat the transport's play button beside it, with two controls for one action, which ADR 0067's amendment rules out for panels.
- **Toasts only for the panel's tools:** the timeline's drags and keys edit through the same context, and their results would be announced while the panel's showed a toast.
- **Cards shown only when a tool can run,** as pdf-sdk's: a recording opens with no clip or time selected, so most cards would never show.

## Consequences

- The editor's look and layout change for every host, so the release is a minor one. A host that found tools by `data-hm-tool` now uses `data-hm-tool-id` for the panel's rows and `data-tool` for the bars' buttons.
- The inspector's place follows the frame's breakpoints, 60 and 45 rem of the editor's width, rather than 1080 px. With the tools and the properties beside it, the timeline is often under 720 px wide, so its tracks' headers sit above their lanes (ui ADR 0011); hiding either panel gives it back.
- In Easy mode, tools above Easy's level aren't listed until a card leads to them or the mode changes; the palette and the keys still reach them.
- `AudioToolbar` stays exported as a building block, but the editor no longer renders it.
- The editor's screenshots are all new, its own states are taken in Expert mode, and the example's `?app` page behaves as an app: it fills the window, opens in Easy and keeps preferences in `localStorage`. `?mode=` starts the embedded editor in a mode.
- The hook that keeps preferences and the reading of inherited values are copies of image-sdk's, as pdf-sdk's and video-sdk's are. With four copies, they belong in `ui`.
