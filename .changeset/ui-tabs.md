---
"@hussmartinez/ui": patch
---

Add `Tabs` to `@hussmartinez/ui/react` (ui ADR 0016): sections of which one shows at a time, chosen from a row of tabs, as the WAI-ARIA tabs pattern describes.

- **One component:** `<Tabs label="…" tabs={[{ id, label, icon, content }]} />`. Uncontrolled from `defaultValue`, or controlled with `value` and `onValueChange`.
- **Keyboard:** one Tab stop for the row; the arrow keys, Home and End move between tabs and select, mirrored in right-to-left text; Tab again reaches the panel. `activation="manual"` makes the arrows only move focus, and Enter or Space select.
- **Complete before JavaScript:** on the server, and on a static page that never hydrates it, every panel is shown under a heading with its tab's label, at `headingLevel` or the closest `HeadingLevelProvider`'s level. It becomes tabs once it hydrates, and what's inside the panels is kept.
- **New tokens:** `--hm-tabs-*`.
