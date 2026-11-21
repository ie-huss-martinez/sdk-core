// A setup file for Vitest's browser projects: it applies the guard against
// the crash in Playwright's Firefox 159 (ie-huss-martinez/ui#61) before any
// test runs in the page. See ./firefox-labelled-by.js.
//
// List it in the browser project's `setupFiles`:
//
//   setupFiles: ["@hussmartinez/sdk-config/testing/firefox-labelled-by/setup"]
//
// Test code only: this entry is never imported by published runtime code.

import { removeLabelledByElements } from "./firefox-labelled-by.js";

removeLabelledByElements();
