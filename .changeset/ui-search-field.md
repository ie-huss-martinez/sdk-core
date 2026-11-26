---
"@hussmartinez/ui": patch
---

Add `SearchField` to `@hussmartinez/ui/react` (ui ADR 0017): a search box with a search icon and, while it holds text, a button that clears it.

- **`SearchField`:** a native `<input type="search">` in a box styled like `TextField`, with its tokens. `label` names it; `value` and `onValueChange` control it, or `defaultValue` starts it; native input props and the ref go to the input. `icon` replaces the search icon, `end` shows something after the input, such as a shortcut hint, and `clearLabel` names the clear button. It works in a `Field`. Before it hydrates, the browser's own clear button stays.
- **`uiMessages` gains `searchField.clear`.** Nothing to do if you spread `uiMessages` into your catalogue; a hand-written object of that type, such as a test double, must add the key.
- **New tokens:** `--hm-search-field-gap` and `--hm-search-field-icon-fg`.
- **Filter chips** need no new component: use `ToggleButton`s in a `role="group"` with a name. The README and the catalogue show how.
