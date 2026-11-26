---
"@hussmartinez/notes-sdk": minor
---

An open notebook renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0008). The library keeps its layout.

- **The top bar,** in the notebook's fixed blue in both themes, holds Back to the library, the notebook's title and whether it's saved, the mode switch, Undo, Redo, the page sidebar, search, the theme toggle, Settings and Export as PDF.
- **The tools** float in a dock over the foot of the pages by default, or sit in a sidebar, chosen in the settings. On phones, a tab bar opens each group of tools in a sheet, and the mode is in the settings.
- **The tool's options,** widths and colours, are in the properties panel, with any colour through ui's colour picker. They were a pill over the pages.
- **The page sidebar** stays beside the pages; where you are and the zoom float over them.
- **The recording's transport** (Stop, storing a recording again, and playback) runs across the notebook's foot while it's needed.

New:

- **Levels and descriptions:** pen, highlighter, eraser and text are Easy tools; the lasso, a picture and a link are Advanced; the rest are Expert. Each has a one-line description. The modes decide what the tools list, and the command palette (`Mod+K`) reaches every tool in every mode.
- **Start cards:** in Easy mode, an empty notebook opens on four cards: Write by hand, Type notes, Mark up a PDF (imports a PDF as a new notebook and opens it) and Record a lecture.
- **Toasts:** an edit made with the notebook's controls, such as adding a page or recolouring a selection, shows "Applied …" with Undo, one at a time. Undo, redo, exports and recordings show a toast too, as do a new mode and a chosen theme. Writing and erasing show none.
- **Preferences:** `NotesEditor` and `NotesNotebook` take `preferences`, `defaultPreferences` and `onPreferencesChange`, with ui's `EditorPreferences`, and a `theme` (`NotesEditorTheme`). The editor never stores them. Without them it starts in Advanced mode with the tools in the dock. `<hm-notes-editor>` takes `preferences` and `defaultPreferences` as properties and dispatches `hm-notes-editor-preferences`; its `theme` attribute now also hides the theme toggle.
- **`NotesNotebook`** takes `onOpenNotebook`, which Mark up a PDF uses to open the notebook it imported.
- **Messages:** new keys `tools.*.description`, `actions.*`, `start.*`, `editor.applied`, `editor.mode.*`, `editor.theme.*`, `editor.commands`, `editor.settings`, `toolbar.groups.select`, `properties.none`, `recordings.live` and `recordings.stopPlayback`. `toolbar.groups.ink` now reads "Write". `options.more` and `options.custom` are gone with the popover they named.
- **Tokens:** `--hm-notes-on-chrome-disabled` and `--hm-notes-chrome-active-hover`, for the bar's buttons.

**Migrating:**

- **Preferences you keep:** read them with the notebook's default layout, `readEditorPreferences(stored, { toolsLayout: "dock" })`, or ui's default, the sidebar, applies.
- **Removed tokens:** these `--hm-notes-*` tokens duplicated ui's. Set ui's token on the editor instead:

  | Removed | Use |
  |---|---|
  | `time-fast`, `time-base`, `time-slow`, `time-loop` | `--hm-motion-duration-feedback`, `-enter`, `-panel`, `-loop` |
  | `ease-out`, `ease-in-out`, `ease-spring` | `--hm-motion-easing-enter`, `-standard`, `-spring` |
  | `radius-xs`, `radius-sm` | `--hm-radius-control` |
  | `radius-md`, `radius-lg` | `--hm-radius-surface` |
  | `radius-pill` | `--hm-radius-round` |
  | `shadow-xs`, `shadow-sm` | `--hm-shadow-raised` |
  | `shadow-md` | `--hm-shadow-floating` |
  | `shadow-lg` | `--hm-shadow-overlay` |
  | `glass`, `glass-strong` | `--hm-color-surface-glass` |
  | `glass-blur` | `--hm-blur-glass` |
  | `line`, `line-strong` | `--hm-color-border`, `--hm-color-border-strong` |
  | `hairline` | `--hm-border-width` |
  | `hover`, `pressed` | `--hm-color-control-hover`, `--hm-color-control-active` |
  | `tint` | `--hm-color-accent-subtle` |
  | `ink-muted` | `--hm-color-text-muted` |
  | `scrim` | `--hm-color-overlay` |
  | `caption-size`, `label-size` | `--hm-font-size-small` |
  | `weight-label` | `--hm-font-weight-strong` |
  | `layer-rail`, `layer-float`, `layer-bar`, `layer-toast` | `--hm-z-raised`, `--hm-z-raised`, `--hm-z-sticky`, `--hm-z-overlay` |
  | `rail-width`, `sidebar-width` | `--hm-sidebar-width` |
  | `rail-width-compact` | `--hm-rail-width` |
  | `toast-max` | `--hm-surface-width-medium` |
  | `float-gap` | `--hm-gap-loose` |
  | `eraser-ring` | `--hm-color-border-strong` |

  These went with the old bar and the options pill, and have no replacement: `chrome-deep`, `on-chrome-line`, `tabs-height`, `toolbar-height`, `tool-icon`, `pill-height`, `tab-max`, `popover-width`, `swatch-size` and `swatch-edge`; and these were unused: `time-instant`, `ease-linear`, `tint-strong`, `ring`, `bar-height`, `page-gap` and `opacity-full`. The bar's colours (`chrome`, `on-chrome` and the rest), the paper, the covers and the library's layout keep their tokens.
- **Finding tools in the DOM:** the tools panel's buttons carry `data-hm-tool-id`, and the top bar's `data-tool`. The notebook no longer sets `data-hm-tool` on tools, or `data-hm-group` on their groups.
- **`toolbar`:** its groups place tools: the bar's in the top bar and over the pages, the rest in the tools panel. `toolbar={[]}` still shows no tool, and keeps the shortcuts and the command palette.
- **Tool groups:** the lasso's, the picture's and the link's `group` is now `select`, and the hand's `options`.
- **Layout:** give the editor a height, as before. The notebook's widths are now the frame's, at 60 and 45 rem of the editor. Its root is a `section`, a region named after the notebook.
- **Announcements:** what the notebook announced, adding and deleting pages and items, undo, redo, exports and recordings, is now a toast, which screen readers hear through ui's announcer.
- **`NotesToolbar`:** it's still exported, but the notebook no longer uses it.
