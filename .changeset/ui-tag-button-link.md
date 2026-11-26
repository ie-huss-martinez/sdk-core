---
"@hussmartinez/ui": patch
---

Add `Tag`, `TagList` and `ButtonLink` to `@hussmartinez/ui/react`, for pages as well as editors (ui ADR 0015). All three are complete as rendered on the server, so a static page needs no client JavaScript for them.

- **`Tag`:** a short, static label, such as a category or a state. `tone` is `neutral` (the default), `accent`, `success`, `warning` or `danger`, and `icon` takes a decorative icon. It's text, not a control. New tokens: `--hm-tag-*`.
- **`TagList`:** a `<ul>` that wraps; a `Tag` directly inside it renders as its `<li>`.
- **`ButtonLink`:** a native `<a href>` that looks like `Button`, with its `variant`, `size`, `startIcon` and `endIcon`. With `target="_blank"`, `rel` defaults to `noopener noreferrer` and the link's name gains "(opens in a new tab)", hidden on screen; `newTabHint` replaces the text. A `javascript:` URL is refused: the link renders without an `href`.
- **`uiMessages` gains `buttonLink.newTab`.** Nothing to do if you spread `uiMessages` into your catalogue; a hand-written object of that type, such as a test double, must add the key.
- **New icons:** `arrow-right`, `external-link`, `mail`, `location`, `feed`, `sparkles`, `book`, `brain`, `tip`, `question`, `time`, `history`, `code` and `route`. `arrow-right` and `external-link` mirror in right-to-left text.
