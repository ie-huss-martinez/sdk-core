---
"@hussmartinez/sdk-config": patch
---

A new entry, `@hussmartinez/sdk-config/testing/screen-reader`, for browser tests that check what a screen reader says. `startScreenReader()` starts a virtual screen reader, and its `spoken(step)` runs a step, such as a key press, waits until speech stops, and returns the phrases spoken since the previous step. Install `@guidepup/virtual-screen-reader` 0.33 as a dev dependency where you use it: it's an optional peer dependency, and nothing changes for packages that don't.
