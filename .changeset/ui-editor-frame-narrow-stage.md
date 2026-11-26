---
"@hussmartinez/ui": patch
---

`EditorFrame` no longer keeps the tools rail's width beside the stage below 45 rem when it has a `tabBar`. The tab bar holds the tools there, but full tools in the sidebar layout still left an empty strip, 4.25 rem wide, at the stage's inline start on a phone. The stage now starts at the frame's edge.
