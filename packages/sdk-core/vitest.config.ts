import { testBrowsers } from "@hussmartinez/sdk-config/testing/browsers";
import { browserTimeouts, unitTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Browser tests run on Chromium locally, and on all three engines in CI or
// with --mode all-browsers (ADR 0015).
export default defineConfig(({ mode }) => {
  // The rule is sdk-config's testBrowsers: on a draft pull request, CI
  // narrows it to Chromium (sdk-core ADR 0068).
  const browsers = testBrowsers({ all: mode === "all-browsers" });
  return {
    test: {
      projects: [
        {
          test: {
            name: "unit",
            ...unitTimeouts,
            include: ["src/**/*.test.ts"],
            exclude: ["src/**/*.browser.test.ts"],
            environment: "node",
          },
        },
        {
          test: {
            name: "browser",
            ...browserTimeouts,
            include: ["src/**/*.browser.test.ts"],
            // Refuses to start outside the browser test image (ADR 0049).
            globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: browsers.map((browser) => ({ browser })),
            },
          },
        },
      ],
    },
  };
});
