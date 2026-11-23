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
  projects:
    os === "win32"
      ? [
          { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        ]
      : [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
};
