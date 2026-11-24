# 0016. The editor on ui's frame: levels, start cards, toasts and preferences

- **Status:** Accepted
- **Date:** 2026-11-25
- **Refines:** [ADR 0007](0007-editor-shell.md)'s layout, under [sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md). Its stage, gestures, shortcuts, focus and export dialog stand.

## Context

sdk-core ADR 0067 gives every SDK editor one frame, three modes and preferences that the host keeps, with the primitives in `ui`. image-sdk is the pilot: the first editor to move onto the frame, so pdf-sdk, video-sdk, audio-sdk and notes-sdk can follow a worked example. ADR 0007 laid the editor out as a toolbar across the top, the stage, and the inspector under or beside it, with a container query at 720 px.

## Decision

- **The editor renders through `EditorFrame`.**
  - The top bar holds the ☰ tools button, the editor's name and the image's size, the mode switch, Open, Undo and Redo, the command palette's button in Expert mode, the theme toggle, Settings, and Export as the one primary button.
  - The tools panel is a `ToolList`, and the stage is unchanged.
  - The properties panel holds the inspector.
  - The bottom region holds the animation bar, for an animation only.
  - Zoom floats over the foot of the stage.
  - On a phone, a `TabBar` of the tool groups opens each group in a `Sheet`.
- **Levels:**
  - `easy`: rotate left and right, flip horizontally, crop, redact and add text.
  - `advanced`: flip vertically, the arrow, rectangle, ellipse and image layers, and drawing.
  - `expert`: layers, frames and play.
  - Open, Export, Undo, Redo and zoom have no level: they're in the bar or on the stage in every mode.
  - Each tool has a one-line description, which the tools panel shows in Easy mode while tips are on.
- **Groups:** `DEFAULT_TOOLBAR` groups rotating and flipping; cropping and redacting; adding layers and drawing; and layers with frames. Each group is named after its first tool's group, and those names now say what the group holds, such as "Crop and redact".
- **Every tool is in the command palette** (`Mod+K`) in every mode, with its group and shortcut, so a level never takes a tool from keyboard or screen-reader users. Modes only decide what the tools panel lists.
- **Easy mode** starts each newly opened image on four start cards: "Crop or straighten", "Make it look better", "Hide something private" and "Add text or arrows". Above them, Open → Edit → Export marks the current step. A card runs its tool, or shows the properties for the adjustments and filters. "Just show me the editor" closes them. Easy hides the properties panel unless a tool or a card needs it.
- **Toasts replace the editor's own announcements.**
  - An edit shows "Applied <action>." with Undo.
  - Undo and redo show the text they announced before, "Undid <action>." and "Redid <action>.".
  - An open shows the image's size.
  - A download shows "Downloaded.".
  - A change of mode or theme shows its name.

  Each toast reaches screen readers once, through ui's announcer.
- **Preferences:**
  - `<ImageEditor>` takes `preferences`, `defaultPreferences` and `onPreferencesChange`, and never stores them.
  - Without either, it starts in Advanced mode, so a host that embedded it before keeps nearly every tool in the panel. Layers and Frames are Expert tools: in Advanced they're in the command palette, with their shortcuts, but not the panel. A host that wants them listed passes `defaultPreferences={{ mode: "expert" }}`. The family's apps pass their own preferences, with Easy on a first visit.
  - The density and motion are set on the editor's root. So is the theme, once the host passes preferences or a default theme, or the person chooses one; until then, an embedded editor inherits the page's theme, as before. A `theme` prop still wins over the preferences, and then neither the toggle nor the setting is shown.

## Alternatives considered

- **Easy mode as the default for every host:** what the apps want on a first visit, but a host that embedded the editor would lose half its tools on upgrade, with no change of its own.
- **Keeping the toolbar beside the new panel:** two places for the same tools, and a layout the other editors wouldn't share.
- **Start cards as a step before the editor:** a wizard, which sdk-core ADR 0067 rules out. The cards sit over the stage and leave everything else usable.

## Consequences

- The editor's look and layout change for every host, so the release is a minor. A host that relied on the toolbar's markup (`[data-tool]` on every tool) now finds tools in the panel by `data-hm-tool-id`; the bar's buttons keep `data-tool`.
- `ImageToolbar` stays exported as a building block, but the editor no longer renders it.
- The editor's screenshots are all new, and so are the example's, whose `?app` page behaves as an app: it fills the window, opens in Easy and keeps preferences in `localStorage`.
- pdf-sdk, video-sdk, audio-sdk and notes-sdk follow this record when they move onto the frame.
