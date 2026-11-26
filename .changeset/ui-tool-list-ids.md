---
"@hussmartinez/ui": patch
---

`ToolList` marks each row with its tool's id as `data-hm-tool-id`, so an editor can find a tool's row again, such as to return focus to it.

`EditorFrame` keeps to its own width when a child, such as a top bar, is wider. Below 45 rem it puts the properties under the stage, in the flow, instead of over the stage's foot, so they never cover what's on the stage. The stage keeps at least 60% of the height there.

`EditorFrame` puts one toggle for each panel in its top bar: ☰ for the tools at its start, with `Mod+\` in its tooltip, and the properties' toggle at its end. Each carries `aria-expanded` and is named for what pressing it does. With a top bar, hidden panels no longer leave an edge tab, and the panels drop their own hide buttons, so there's one control for each action.

`ThemeToggle` takes `value="inherit"` for an editor that hasn't chosen a theme: it shows the theme its own element inherits from the page, read after mount and kept current as an ancestor's `data-hm-theme` or the system's preference changes, and light on the server.
