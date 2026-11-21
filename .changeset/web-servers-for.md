---
"@hussmartinez/sdk-config": patch
---

`@hussmartinez/sdk-config/testing/require-image` now exports `webServersFor(servers)`, for a Playwright configuration's `webServer`.

Playwright starts its web servers before the global setup, so on a host the guard only refused after every example's server had been built and waited for, or a server failed first and the guard's explanation never appeared. `webServersFor` returns the servers where browser tests can run (in the browser test image, in CI, and with `HM_ALLOW_HOST_BROWSER=1`) and an empty list where the guard will refuse, so the guard's message is the first and only thing shown. It takes one server, a list or `undefined`, always returns an array, and never throws.

To adopt, wrap the list in each `e2e/playwright.config.ts` that names the guard, and remove any local copy of this check:

```ts
import { webServersFor } from "@hussmartinez/sdk-config/testing/require-image";

export default defineConfig({
  globalSetup: "@hussmartinez/sdk-config/testing/require-image",
  webServer: webServersFor([{ command: "…", url: "http://localhost:4310" }]),
});
```

`defineVisualConfig` is unchanged: it already refuses outside the image as the configuration loads, before any server starts.
