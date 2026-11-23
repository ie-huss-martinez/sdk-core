import { devices } from "@playwright/test";

const os = process.platform;
export default {
  testDir: ".",
  testMatch: os === "win32" ? "nvda.spec.js" : "voiceover.spec.js",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: { headless: false, video: "retain-on-failure" },
  // Real Chrome only: Firefox and Safari run without Playwright (native.mjs).
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
};
