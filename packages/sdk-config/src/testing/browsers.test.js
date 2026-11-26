import { describe, expect, it } from "vitest";
import { ALL_BROWSERS, testBrowsers } from "./browsers.js";

describe("testBrowsers", () => {
  it("runs Chromium locally, and every engine in CI", () => {
    expect(testBrowsers({ env: {} })).toEqual(["chromium"]);
    expect(testBrowsers({ env: { CI: "true" } })).toEqual(ALL_BROWSERS);
  });

  it("runs only the engines HM_BROWSERS names, in the usual order", () => {
    expect(testBrowsers({ env: { CI: "true", HM_BROWSERS: "chromium" } })).toEqual(["chromium"]);
    expect(testBrowsers({ env: { HM_BROWSERS: " webkit, firefox " } })).toEqual([
      "firefox",
      "webkit",
    ]);
  });

  it("treats an empty HM_BROWSERS as unset, as a workflow's empty expression sets it", () => {
    expect(testBrowsers({ env: { CI: "true", HM_BROWSERS: "" } })).toEqual(ALL_BROWSERS);
  });

  it("runs every engine when asked, whatever HM_BROWSERS says", () => {
    expect(testBrowsers({ all: true, env: { HM_BROWSERS: "chromium" } })).toEqual(ALL_BROWSERS);
  });

  it("refuses an engine the family doesn't test on", () => {
    expect(() => testBrowsers({ env: { HM_BROWSERS: "chromium,chrome" } })).toThrow(
      "HM_BROWSERS names chrome, which isn't one of chromium, firefox, webkit.",
    );
  });
});
