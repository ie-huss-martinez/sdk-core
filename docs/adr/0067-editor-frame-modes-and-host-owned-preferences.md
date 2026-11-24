# 0067. One editor frame, three modes and preferences the host keeps

- **Status:** Accepted
- **Date:** 2026-11-24
- **Refines:** [ADR 0006](0006-design-tokens-and-theming.md), with motion and surface tokens and a `data-hm-motion` attribute; [ADR 0030](0030-tools-and-keyboard-shortcuts.md), with a level on every tool and two family shortcuts

## Context

The four media editors and notes-sdk each lay themselves out their own way: a toolbar across the top, panels where they fit, and feedback that ranges from an `aria-live` line to nothing. They look and behave like four products. The maintainer decided on 2026-11-22 to give them one layout and one way of working, after comparing four clickable mock-ups:

- **Layout:** a tools sidebar on desktop that collapses from full to icons to hidden, and comes back from an edge tab, a ☰ button in the top bar or `Ctrl+\`. A properties panel that hides to an edge tab. Bottom tabs and a sheet on phones.
- **Modes:** Easy, Advanced and Expert. Easy opens on "What would you like to do?" task cards, which are shortcuts into the editor, not a locked wizard. Expert adds a command palette on `Ctrl+K` and gives the canvas more room.
- **Feedback:** a toast with Undo after each edit, a status line ("Edited · not exported yet") tied to the host's leave guard, export progress, and a "safe to leave" state after the download.
- **A settings panel:** theme, mode, tools layout, density, motion, tips and the panels' states, saved on the device and never in a cookie.
- **Theme:** follows the system by default, with a quick toggle in the top bar.

notes-sdk's redraw ([PR #215](https://github.com/ie-huss-martinez/sdk-core/pull/215)) already tried most of the look: floating pill toolbars on frosted glass, toasts over the foot of the view, spring motion with a reduced-motion fallback. Its tokens are its own, marked to move to `ui` once settled.

Three constraints shape how this is built:

- **The editors are embedded.** A host other than the family's own apps may render `<ImageEditor>` in a page of its own. An SDK that wrote to `localStorage`, or took over the page's theme, would surprise it.
- **Hiding a tool isn't the same as removing it.** A mode that drops tools from the sidebar must not leave a keyboard or screen-reader user with no way to reach them.
- **One copy of each family package** ([ADR 0047](0047-one-copy-of-each-family-package.md)): what's shared has to live in `ui` and `sdk-core`, not in each SDK.

## Decision

### The frame belongs to `ui`, and every editor renders through it

`ui`'s React entry adds the layout primitives. SDKs compose them; they don't restyle them.

| Primitive | What it is |
|---|---|
| `EditorFrame` | The layout: a top bar, a tools region, the stage, a properties region and a bottom region (timeline and transport), with the states below. It handles `Mod+\` |
| `ToolList` | The tools, in labelled groups, as a vertical toolbar with roving focus. Full rows with a description, icons only, or a horizontal dock |
| `ModeSwitch` | Easy, Advanced and Expert, as a segmented control |
| `TabBar` | Up to five tabs and "More" across the foot of a phone |
| `Sheet` | A modal sheet: from the bottom on a narrow viewport, from the inline end on a wide one |
| `SettingsPanel` | The settings, in a `Sheet` |
| `CommandPalette` | A modal search over every tool, on `Mod+K` |
| `ToastProvider`, `useToast` | Short messages over the foot of the frame, with one optional action such as Undo |
| `ProgressOverlay` | Progress over the stage: a title, a bar, a line of detail and Cancel |
| `ColorPicker` | A full colour picker, recorded in `ui`'s [ADR 0013](../../packages/ui/docs/adr/0013-colour-picker.md) |

- **States.** The tools region is `full`, `icons` or `hidden`, and the properties region `shown` or `hidden`. A hidden region leaves an edge tab that brings it back. Both are controlled props of `EditorFrame`, with change callbacks.
- **Tools layout.** `sidebar` puts the tools at the inline start; `dock` floats them as a pill over the foot of the stage, the look notes-sdk uses.
- **Sizes are container queries,** not viewport queries (`STANDARDS.md`), because an editor can be embedded in a column. Below 60 rem the full tools float over the stage instead of pushing it; below 45 rem the tools move into the `TabBar` and the properties sit at the foot of the stage. The breakpoints sit below the viewport widths in the mock-ups (1024 and 768 px), because an app's frame shares the viewport with its own chrome, such as an ad column. A `Sheet` is in the top layer, outside any container, so it alone follows the viewport.
- **Landmarks.** The top bar is a `header` holding a `toolbar`; the tools are a `nav` named "Tools"; the stage stays in the SDK's `main` or region; the properties panel is a `complementary` region named "Properties".

### Every tool has a level, and modes only change what's shown

- **`ToolDefinition.level`** is `"easy"`, `"advanced"` or `"expert"`, and defaults to `"advanced"`, so every existing tool keeps working. `sdk-core` adds the `ToolLevel` and `EditorMode` types and `isToolInMode(tool, mode)`: Easy shows `easy` tools, Advanced adds `advanced` ones, and Expert shows them all.
- **A tool's level decides only whether its row is in the sidebar.** It never removes the tool from the registry, its shortcut or the command palette.
- **Modes never hide a function from keyboard or screen-reader users.** In every mode:
  - every tool stays reachable from the command palette, in Easy too, where its shortcut isn't advertised;
  - every tool's own shortcut keeps working;
  - what's hidden is hidden for everyone, never with CSS that leaves it in the accessibility tree or out of it alone, and never with `aria-hidden` on something that can still be focused.
- **Switching mode never changes the document.** A tool in use stays open after a switch that hides its row.
- **Easy start cards** are data each SDK provides, `{ id, title, description, icon, tools }`, with text by message key. A card leads into the editor with its tools first and its first tool selected. "Just show me the editor" leaves the cards. They're links into the editor, never a wizard that blocks it.
- **Family shortcuts.** `toggle-tools` is `Mod+\` and `command-palette` is `Mod+K`, in every SDK, listened for on the editor's root like every other shortcut ([ADR 0030](0030-tools-and-keyboard-shortcuts.md)).

### The command palette is an ARIA combobox

`CommandPalette` follows the [APG combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) with a listbox popup, inside a modal `<dialog>`:

- the input has `role="combobox"`, `aria-expanded`, `aria-controls` naming the listbox, and `aria-activedescendant` naming the active option, so focus never leaves the input;
- arrow keys move the active option, Home and End jump, Enter runs it, and Escape closes the palette and returns focus to what opened it;
- each option is named by the tool's label, and described by its shortcut and its group;
- the number of results is announced politely as the query changes;
- a disabled tool is listed with `aria-disabled` and can't be run, so it's still found.

It searches tools only, by their labels and descriptions. Actions such as "Export as PNG" can be added later, as palette items an SDK passes.

### Preferences are controlled props, and the host keeps them

- **`ui` defines the preferences** as `EditorPreferences`: `theme` (`system`, `light`, `dark`), `mode`, `toolsLayout` (`sidebar`, `dock`), `tools` (`full`, `icons`, `hidden`), `properties` (`shown`, `hidden`), `density` (`comfortable`, `compact`), `motion` (`system`, `full`, `reduced`) and `tips` (on or off). Its server-safe entry exports the defaults and `readEditorPreferences(value)`, which takes any parsed JSON and returns valid preferences: a field that's missing, unknown or of the wrong value gets its default, and unknown fields are dropped. Preferences are a person's choices, not a document, so a reader that falls back field by field fits them better than the strict readers of [ADR 0045](0045-portable-formats-and-conformance-vectors.md).
- **SDK editors take them as controlled props,** `preferences` and `onPreferencesChange`, with uncontrolled defaults when the host passes neither. An editor never reads or writes `localStorage`, cookies or any other storage itself.
- **The host decides where they're kept.** The family's apps keep them in `localStorage`, one key per app, and never in a cookie. Sharing a theme across the apps' subdomains would need a cookie on the parent domain, so each app keeps its own.
- **Theme and motion apply to the editor's root,** through `ThemeProvider` and `data-hm-motion`. The host applies its own page's theme before first paint, which is the app's concern, not the SDK's.

### Feedback

- **Every edit shows a toast** naming what happened, such as "Rotated", with Undo. Undo and redo show "Undone: Rotate" and "Redone: Rotate". A mode or theme change shows a short toast with no action.
- **Toasts never take focus,** and pause while the pointer is over them or focus is inside them. Their text reaches screen readers through `ui`'s announcer, not a live region of their own, so it's spoken once. Their action is also a keyboard shortcut (Undo is `Mod+Z`), so a toast that's gone takes nothing with it.
- **Long work shows `ProgressOverlay`** over the stage, with Cancel wherever the SDK can cancel ([STANDARDS: UX](../../STANDARDS.md#ux)). The stage behind it is `inert` while it shows.
- **Errors keep their catalogue text** through `messages.error()` ([ADR 0050](0050-error-text-by-reason-and-warning-text.md)), in a toast in the danger colour. Warnings stay inline above the stage.
- **The status line and the leave guard** stay the host's: the SDK reports edits and downloads through its events, and the host words the status and guards leaving.

### The look moves into `ui`'s tokens

- **notes-sdk's look becomes `ui`'s:** larger radii, pill-shaped buttons and segmented controls, a frosted surface for floating bars, softer layered shadows, and calmer surfaces in both themes. Its `--hm-notes-*` tokens that aren't specific to notebooks are replaced by `ui`'s, in the pull request that moves notes-sdk onto the frame.
- **Disabled looks disabled.** A disabled control is drawn in neutral colours of its own, `color-control-disabled` and `color-text-disabled`, in every variant and theme, instead of the variant's colours at half opacity. A disabled primary button is no longer a pale accent that reads as enabled, and a disabled toolbar button in the dark theme no longer fades into the surface. WCAG 1.4.11 exempts inactive controls, so this is a design rule, tested by the screenshots.
- **Motion has three speeds,** a quick one for presses, a normal one for toasts and fades, and a slow one for panels and sheets, with a spring easing for things that arrive and a standard easing for things that leave. Nothing moves on its own except progress, and nothing loops except an indeterminate bar or spinner.
- **Reduced motion is a token, not a rule per component.** With `prefers-reduced-motion: reduce`, or `data-hm-motion="reduced"` on any ancestor, the motion durations are zero, so state changes still happen, at once. `data-hm-motion="full"` keeps motion inside a subtree whose person chose it over the system's setting.

### What each layer owns

| Layer | Owns |
|---|---|
| `sdk-core` | `ToolDefinition.level`, `ToolLevel`, `EditorMode`, `isToolInMode`, and the `toggle-tools` and `command-palette` shortcuts |
| `ui` | The primitives above, `EditorPreferences` and its reader, and the tokens |
| Each SDK | Its tools' levels and descriptions, its start cards, and an editor that renders through `EditorFrame`, takes `preferences` and `onPreferencesChange`, and turns its edits into toasts. Its existing API stays: `<ImageEditor>` still renders a whole editor |
| The host | Where preferences are kept, the default mode, the page's theme before first paint, the status line, the leave guard and the ad slot |

## Alternatives considered

- **A frame in each SDK, sharing only tokens:** five layouts would drift apart again, and each would get collapsing, focus return and container queries subtly wrong in its own way.
- **SDKs saving preferences in `localStorage` themselves:** simpler for the family's apps, but every other host would get storage it didn't ask for, under a key it doesn't control, and couldn't keep preferences in its own account settings.
- **Modes that remove tools from the registry:** the palette and shortcuts would lose them, so a keyboard user in Easy mode couldn't reach a function a mouse user can't see either, and there would be no way to it without a mode switch.
- **A wizard for Easy:** it would lock people into one path, and every edit outside it would need a way out. Cards that open the editor do the same job without a trap.
- **A command palette as a menu or a dialog with a list of buttons:** a list of buttons makes every result a Tab stop, and a menu doesn't take text. The combobox keeps focus in the input, which is what screen readers expect of a search.
- **Toasts as their own live region:** the text would be read twice where the SDK also announces the result, and a live region that's inserted with its text is often not read at all.
- **Reduced motion as a media query in each component:** a person's choice in the settings can't change a media query, and every new component would have to remember the rule.

## Consequences

- Every editor looks and behaves the same way, and a fix to the frame reaches all of them in one `ui` release.
- `ui` grows by a layout, a palette, toasts, sheets and a colour picker; its React entry's budget grows with them, in the pull request that adds them.
- The new look changes the screenshots of every package that renders `ui`, so the pull request that changes the tokens retakes every baseline, and `ui`'s release is a minor one.
- SDKs move onto the frame one at a time: image-sdk first as the pilot, then pdf, video, audio and notes. Until an SDK moves, it keeps its own layout on the new tokens.
- Hosts that want persistence write a few lines: read with `readEditorPreferences`, pass `preferences`, and save in `onPreferencesChange`. The family's apps do it in their shared shell.
- The ad slot and the properties panel both want the inline end on wide screens. That's the apps' layout, decided in editor-apps.
- Analytics of mode changes, if any, are an app's anonymous event under its own consent rules, not an SDK event.
