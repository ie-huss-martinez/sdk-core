---
"@hussmartinez/sdk-core": patch
---

Tools gain a level and a description (ADR 0067). `defineTool` takes `level` (`"easy"`, `"advanced"` or `"expert"`, `"advanced"` when left out) and `description` (a message key). `isToolInMode(tool, mode)` says whether an editor in a mode lists a tool in its tools panel; every tool stays in the registry, its shortcuts and the command palette in every mode. New types `ToolLevel` and `EditorMode`, and two family shortcuts: `toggle-tools` (`Mod+\`) and `command-palette` (`Mod+K`).
