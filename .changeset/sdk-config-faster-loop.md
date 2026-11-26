---
"@hussmartinez/sdk-config": patch
---

Add `testBrowsers` and `variantsFor`, for faster draft pull requests and fewer screenshots.

- **`@hussmartinez/sdk-config/testing/browsers`** is a new entry with no dependencies. `testBrowsers({ all })` returns the engines a Vitest browser project or a Playwright end-to-end configuration runs in: every engine with `all: true`, such as for `--mode all-browsers`; otherwise the ones `HM_BROWSERS` names, comma-separated; otherwise every engine when `CI` is set, and Chromium when it isn't. An engine it doesn't know throws. Replace a configuration's `process.env["CI"] || mode === "all-browsers" ? ALL_BROWSERS : ["chromium"]` with `testBrowsers({ all: mode === "all-browsers" })`, and a Playwright configuration's `ci || name === "chromium"` filter with `testBrowsers().includes(name)`.
- **`hm-in-image`** passes `HM_BROWSERS` into the container, so `HM_BROWSERS=firefox pnpm test:browser` runs Firefox alone.
- **`@hussmartinez/sdk-config/testing/visual`** adds `primaryVisualVariant`, light-comfortable, and `variantsFor(state, { full })`, which returns every variant for a state listed in `full` and `primaryVisualVariant` alone for any other. `visualVariants` is unchanged.
