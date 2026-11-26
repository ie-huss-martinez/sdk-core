# @hussmartinez/notes-sdk

## 0.2.0

### Minor Changes

- [#242](https://github.com/ie-huss-martinez/sdk-core/pull/242) [`bc27473`](https://github.com/ie-huss-martinez/sdk-core/commit/bc274734e86cfb7951b468ee6cd81dc27a00035d) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An open notebook renders through ui's editor frame (sdk-core ADR 0067, docs/adr/0008). The library keeps its layout.
  
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

### Patch Changes

- [#242](https://github.com/ie-huss-martinez/sdk-core/pull/242) [`bc27473`](https://github.com/ie-huss-martinez/sdk-core/commit/bc274734e86cfb7951b468ee6cd81dc27a00035d) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Steady writing is now saved at least every 2 seconds. Before, each change restarted the 400 ms save delay, so a notebook written on without a pause stayed unsaved until the writing stopped, and closing the tab could lose it. The first unsaved change is now saved within 2 s, or within `saveDelay` when a host sets a longer one. Nothing changes in the API.
- Updated dependencies [[`9565590`](https://github.com/ie-huss-martinez/sdk-core/commit/95655907223b0a210d6e63e13146283cf5259d68), [`1dd7dc7`](https://github.com/ie-huss-martinez/sdk-core/commit/1dd7dc70b724452d766d4013c9d8f6f318020aaa), [`6883c62`](https://github.com/ie-huss-martinez/sdk-core/commit/6883c623af809908c033952615f5af06979a782c), [`42cf2be`](https://github.com/ie-huss-martinez/sdk-core/commit/42cf2be5f2c4af78df6f0e787a0cb44cd3b1cf9b), [`6883c62`](https://github.com/ie-huss-martinez/sdk-core/commit/6883c623af809908c033952615f5af06979a782c), [`bc27473`](https://github.com/ie-huss-martinez/sdk-core/commit/bc274734e86cfb7951b468ee6cd81dc27a00035d), [`f545758`](https://github.com/ie-huss-martinez/sdk-core/commit/f54575877f29c5558031020c04e9bee78f4b13a9), [`1dd7dc7`](https://github.com/ie-huss-martinez/sdk-core/commit/1dd7dc70b724452d766d4013c9d8f6f318020aaa), [`562e33d`](https://github.com/ie-huss-martinez/sdk-core/commit/562e33d49cf54f796b393a33adcee8ed26aceb11), [`cd6a92e`](https://github.com/ie-huss-martinez/sdk-core/commit/cd6a92e868dcb90240eb7ae4c14b6911a3c683c9), [`b732a7d`](https://github.com/ie-huss-martinez/sdk-core/commit/b732a7df11a1307d550f4ad8ff881328efe6e513)]:
  - @hussmartinez/pdf-sdk@0.8.0
  - @hussmartinez/sdk-core@0.4.9
  - @hussmartinez/ui@0.17.0

## 0.1.1

### Patch Changes

- [#215](https://github.com/ie-huss-martinez/sdk-core/pull/215) [`cf42776`](https://github.com/ie-huss-martinez/sdk-core/commit/cf42776a15b41cd168fb00cd234d9695f75a9930) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Redraw the library and the open notebook. The library has a rail of places beside a grid of notebook covers and folders drawn in CSS. An open notebook has the notebook's title on a tab over a blue bar of tools. Undo and redo, the tool's options (three widths and a palette, with any colour and width a tap away), the page number and the zoom float over the pages. Covers deal in, lift on hover, and tools spring into place. Every motion stops when the device asks for less. The new design values are `--hm-notes-*` tokens a host can override on the editor.
- Updated dependencies [[`32ce51f`](https://github.com/ie-huss-martinez/sdk-core/commit/32ce51f5cf8d7fcfb3edf0ef42162f81e0fdf067), [`32ce51f`](https://github.com/ie-huss-martinez/sdk-core/commit/32ce51f5cf8d7fcfb3edf0ef42162f81e0fdf067)]:
  - @hussmartinez/pdf-sdk@0.7.1
  - @hussmartinez/ui@0.16.7

## 0.1.0

### Minor Changes

- [#210](https://github.com/ie-huss-martinez/sdk-core/pull/210) [`b87a8f8`](https://github.com/ie-huss-martinez/sdk-core/commit/b87a8f8ff0101671b203aa8b1372a15fe2567506) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The first release of `@hussmartinez/notes-sdk`: handwritten notes kept on the device.
  
  - **`NotesEditor`**, from `./react`, is the whole editor: a library of notebooks and folders and, once one is open, pages to write on with a stylus. `defineNotesEditorElement()`, from `./element`, registers it as `<hm-notes-editor>`. Import `@hussmartinez/ui/styles.css`, then `@hussmartinez/notes-sdk/styles.css`.
  - **Writing:** a pen with pressure, a highlighter, an eraser for whole strokes or parts of them, a lasso to move, resize and recolour, shapes that straighten, text boxes, pictures, and links between pages, with undo and redo. The pen writes while fingers pan and zoom, and a resting palm does nothing.
  - **Notebooks:** blank, lined, grid and dotted paper; pages to add, reorder and delete; an outline; search in typed text and in PDFs' text; sound recorded alongside the ink.
  - **PDFs:** `library.importPdf(file)` makes a notebook to write on, and `library.exportPdf(id)` writes one with the ink as vector paths.
  - **Storage:** `createOpfsNotesStore()` keeps the library in the browser's private file system, saved as you write. `library.backup()` writes a standard zip, and `library.restore(file)` reads one without ever overwriting a notebook.
  - **The headless core,** from `.`, runs on a server: `createNotesLibrary`, `openNotesSession`, `applyNotesCommand`, the strict readers of the `hm-notes-*` formats, and `writeNotesPdf`.

### Patch Changes

- Updated dependencies [[`b87a8f8`](https://github.com/ie-huss-martinez/sdk-core/commit/b87a8f8ff0101671b203aa8b1372a15fe2567506), [`4c7b4b6`](https://github.com/ie-huss-martinez/sdk-core/commit/4c7b4b63e49f18ec57934267c02d46c10d5b65b5), [`4c7b4b6`](https://github.com/ie-huss-martinez/sdk-core/commit/4c7b4b63e49f18ec57934267c02d46c10d5b65b5)]:
  - @hussmartinez/pdf-sdk@0.7.0
  - @hussmartinez/ui@0.16.6
