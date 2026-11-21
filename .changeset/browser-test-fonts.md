---
"@hussmartinez/sdk-config": minor
---

Browser tests now render text in fonts with a real bold face (sdk-core ADR 0062). **Taking this release changes every screenshot with text in it: retake your baselines in the same pull request.**

In the pinned browser test image, `system-ui` resolved to a font with one style. `ui`'s text asks for `system-ui` first, so every label was drawn in it, and in Chromium text at weight 600 came out as the same pixels as regular text. A lost font weight couldn't show in a screenshot.

`sdk-config` now ships a fontconfig file that prefers the Liberation fonts the image already has: Liberation Sans for `system-ui` and `sans-serif`, Liberation Serif for `serif`, and Liberation Mono for `monospace` and `ui-monospace`. The image itself doesn't change.

- **`defineVisualConfig` and `browserInstances` pass it** to every browser they launch in the image. You change nothing for those.
- **A configuration that launches browsers its own way** takes the same environment from the new entry, `@hussmartinez/sdk-config/testing/fonts`. Add it to your end-to-end configuration, so end-to-end tests lay text out as screenshots do:

  ```ts
  // e2e/playwright.config.ts
  import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";

  export default defineConfig({
    use: { launchOptions: { env: fontLaunchEnv() } },
  });
  ```

  `fontLaunchEnv()` returns the whole environment, the process's own with the file added. Never pass the one variable alone: Playwright replaces the browser's environment, so the browser would lose `DISPLAY` and the rest. The entry also exports `FONT_CONFIG_FILE`, `FONT_CONFIG_ENV` and `usesFontRules()`.
- **Only in the image,** where `HM_VISUAL_CONTAINER=1`. On your own machine, a browser keeps your fonts.

**To adopt:**

1. Take the release, and add `fontLaunchEnv()` to any configuration that launches browsers without the presets.
2. Run `pnpm test:visual:update`, and commit the baselines in the same pull request.
3. Say in it that the font is the cause. Text changes everywhere. Where a label got wider or narrower, or now wraps, what's beside or below it moves too: explain each such move by the font, because anything that can't be is a real difference.
4. A browser or end-to-end test that asserts a text's size in pixels may need its number updated, for the same reason.

Liberation has two weights, so 400 and 500 draw alike, and 600 and 700 draw alike.
