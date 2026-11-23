---
"@hussmartinez/notes-sdk": patch
---

Redraw the library and the open notebook. The library has a rail of places beside a grid of notebook covers and folders drawn in CSS. An open notebook has the notebook's title on a tab over a blue bar of tools. Undo and redo, the tool's options (three widths and a palette, with any colour and width a tap away), the page number and the zoom float over the pages. Covers deal in, lift on hover, and tools spring into place. Every motion stops when the device asks for less. The new design values are `--hm-notes-*` tokens a host can override on the editor.
