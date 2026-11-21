---
"@hussmartinez/sdk-config": patch
---

A new test entry, `@hussmartinez/sdk-config/testing/firefox-labelled-by`: the family's guard against a crash in Playwright's Firefox 159 (ui#61), in place of each repository's own copy.

That Firefox crashes the page when an element's `ariaLabelledByElements` is read from two JavaScript worlds. Playwright's locators by role or label read it in one, and so does Vitest's `userEvent`; axe-core reads it in the other. So a click by accessible name and an axe run on the same page crash it. The guard removes the property from the page, in Firefox only, before any script runs; axe then resolves `aria-labelledby` by ID and reports the same results.

**In a Vitest browser project:**

```ts
setupFiles: ["@hussmartinez/sdk-config/testing/firefox-labelled-by/setup"],
```

**In Playwright's end-to-end tests:**

```ts
// e2e/fixtures.ts
import { test as base } from "@playwright/test";
import { withFirefoxLabelledByGuard } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";

export const test = withFirefoxLabelledByGuard(base);
```

**To adopt:** add those where your tests click by accessible name and run axe, and delete your own `delete Element.prototype.ariaLabelledByElements` setup file or fixture. Nothing changes until you do.

The entry also exports `removeLabelledByElements()` and `CRASHING_FIREFOX`. A test in `sdk-config` fails when the pinned Playwright brings another Firefox, so the guard is re-checked then and removed once the crash is fixed.
