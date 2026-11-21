---
"@hussmartinez/sdk-config": patch
---

Add `@hussmartinez/sdk-config/testing/timeouts`, the family's test timeouts (sdk-core ADR 0057), so a test doesn't fail only because the machine was busy, and no repository writes the numbers.

```ts
import {
  browserTimeouts,   // Vitest browser mode: 60 s for a test and for a hook
  endToEndTimeouts,  // Playwright: 60 s for a test, 10 s for an assertion that waits
  unitTimeouts,      // Vitest on Node: 30 s for a test and for a hook
} from "@hussmartinez/sdk-config/testing/timeouts";

// vitest.config.ts
{ test: { name: "unit", ...unitTimeouts, include: ["src/**/*.test.ts"] } }

// e2e/playwright.config.ts
export default defineConfig({ ...endToEndTimeouts, testDir: "tests" });
```

**To adopt:** spread them into each Vitest project and Playwright configuration, and remove the limits your tests carry individually. Keep one only where a test really does long work, such as encoding a video or waiting out a real deadline, with a comment saying why. A timeout only catches a hang: a test that asserts timing uses its own clock.

**`defineVisualConfig` now uses `endToEndTimeouts`:** visual tests get 60 s instead of Playwright's 30 s, and waiting assertions 10 s instead of 5 s. A visual test that passes today still passes.
