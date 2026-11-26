import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";
import { testBrowsers } from "@hussmartinez/sdk-config/testing/browsers";
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
            // build.test.ts checks the built package, so it sits next to the
            // Vite config rather than in src/. test/ holds the repository's
            // own checks, such as the CI image.
            include: ["src/**/*.test.{ts,tsx}", "*.test.ts", "test/**/*.test.ts"],
            exclude: ["**/*.browser.test.{ts,tsx}"],
            environment: "node",
          },
        },
        {
          // Every package the browser tests import, optimised once before any
          // test starts, so a later file's new import doesn't make Vite
          // optimise again and reload the page mid-run.
          optimizeDeps: {
            include: [
              "@hussmartinez/sdk-core",
              "@hussmartinez/ui",
              "@hussmartinez/ui/react",
              "axe-core",
              "react",
              "react/jsx-dev-runtime",
              "react-dom/client",
            ],
          },
          test: {
            name: "browser",
            // Refuses to start outside the pinned browser test image or CI,
            // where Docker's network changes fail tests at random (sdk-core
            // ADR 0049). The unit project above still runs anywhere.
            globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
            include: ["src/**/*.browser.test.{ts,tsx}", "test/**/*.browser.test.ts"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              // The same browsers; with HM_BROWSER_DIAGNOSTICS set to a folder,
              // Chromium also records a net log there, for startup failures
              // that leave no reason (sdk-config's browserInstances).
              instances: browserInstances(browsers),
            },
          },
        },
      ],
    },
  };
});
