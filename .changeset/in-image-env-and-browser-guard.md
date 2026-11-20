---
"@hussmartinez/sdk-config": patch
---

Add a guard against browser tests outside the browser test image, and pass more of the environment through `hm-in-image` (sdk-core ADR 0049, as amended).

**`@hussmartinez/sdk-config/testing/require-image`,** a global setup that refuses to start browser tests on a host, where Docker's network changes make them fail at random. It fails at once, saying to use `hm-in-image`. It allows the image (`HM_VISUAL_CONTAINER=1`) and CI (`CI` set), and it never runs for a unit project. Add it to every configuration that starts a browser:

```ts
// vitest.config.ts, in the browser project only
globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],

// e2e/playwright.config.ts
globalSetup: "@hussmartinez/sdk-config/testing/require-image",
```

Your `test:browser` and `test:e2e` scripts already run through `hm-in-image`, so they keep working. A browser test started directly on a host, such as `pnpm exec vitest run --project browser` or from an editor, is now refused once you add the guard.

**`hm-in-image` now passes these variables into the container,** when they're set: `HM_BROWSER_DIAGNOSTICS`, `PLAYWRIGHT_BASE_URL`, `SMOKE_BASE_URL`, `SMOKE_ENGINES` and `SMOKE_ANALYTICS`, as well as `CI` and `DEBUG`. Nothing else of your environment reaches it. If you worked around this with a wrapper script or `docker run` of your own, you can remove it.

**`HM_BROWSER_DIAGNOSTICS` must be a folder inside the checkout,** because the container sees nothing else of your machine. It's passed as that folder's path in the container, so `HM_BROWSER_DIAGNOSTICS=test-results/diagnostics pnpm test:browser` writes the net logs where you can read them. A folder outside the checkout, such as `/tmp/hm-diagnostics`, is now a usage error (exit code 2) instead of logs that vanish with the container.
