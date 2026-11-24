---
"@hussmartinez/ui": patch
---

`ToolList` marks each row with its tool's id as `data-hm-tool-id`, so an editor can find a tool's row again, such as to return focus to it.

`EditorFrame` keeps to its own width when a child, such as a top bar, is wider. Below 45 rem it puts the properties under the stage, in the flow, instead of over the stage's foot, so they never cover what's on the stage. The stage keeps at least 60% of the height there.
