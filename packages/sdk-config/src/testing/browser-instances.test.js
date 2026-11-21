import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browserInstances, chromiumDiagnosticArgs } from "./browser-instances.js";
import { FONT_CONFIG_FILE } from "./fonts.js";

/** @type {string[]} */
const scratch = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const ALL = /** @type {const} */ (["chromium", "firefox", "webkit"]);

describe("browserInstances", () => {
  it("returns plain Playwright instances without HM_BROWSER_DIAGNOSTICS", () => {
    const instances = browserInstances(ALL, { env: {} });
    expect(instances.map((instance) => instance.browser)).toEqual(ALL);
    // One provider for all, with no options: what playwright() alone gives.
    expect(new Set(instances.map((instance) => instance.provider)).size).toBe(1);
    expect(instances[0]?.provider.name).toBe("playwright");
    expect(instances[0]?.provider.options).toEqual({});
  });

  it("adds the diagnostics to Chromium only, and creates their folder", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "hm-diagnostics-")), "nested");
    scratch.push(dir);
    const [chromium, firefox, webkit] = browserInstances(ALL, {
      env: { HM_BROWSER_DIAGNOSTICS: dir },
    });
    expect(chromium?.provider.options).toEqual({
      launchOptions: { args: chromiumDiagnosticArgs(dir) },
    });
    // Firefox and WebKit refuse to launch with Chromium's flags.
    expect(firefox?.provider.options).toEqual({});
    expect(webkit?.provider).toBe(firefox?.provider);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});

describe("browserInstances, in the browser test image", () => {
  it("launches every browser with the family's font rules, in a whole environment", () => {
    const env = { HM_VISUAL_CONTAINER: "1", DISPLAY: ":0" };

    const instances = browserInstances(ALL, { env });

    expect(new Set(instances.map((instance) => instance.provider)).size).toBe(1);
    expect(instances[0]?.provider.options).toEqual({
      launchOptions: { env: { ...env, FONTCONFIG_FILE: FONT_CONFIG_FILE } },
    });
  });

  it("keeps the font rules beside Chromium's diagnostics", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "hm-diagnostics-")), "nested");
    scratch.push(dir);
    const env = { HM_VISUAL_CONTAINER: "1", HM_BROWSER_DIAGNOSTICS: dir };
    const fonts = { ...env, FONTCONFIG_FILE: FONT_CONFIG_FILE };

    const [chromium, firefox, webkit] = browserInstances(ALL, { env });

    expect(chromium?.provider.options).toEqual({
      launchOptions: { env: fonts, args: chromiumDiagnosticArgs(dir) },
    });
    expect(firefox?.provider.options).toEqual({ launchOptions: { env: fonts } });
    expect(webkit?.provider).toBe(firefox?.provider);
  });

  it("sets no environment outside the image, so a browser inherits the machine's", () => {
    for (const env of [{}, { CI: "true" }, { HM_ALLOW_HOST_BROWSER: "1" }]) {
      expect(browserInstances(ALL, { env })[0]?.provider.options).toEqual({});
    }
  });
});

describe("chromiumDiagnosticArgs", () => {
  it("logs the console to stderr, and every request to a net log per test process", () => {
    expect(chromiumDiagnosticArgs("/tmp/diag")).toEqual([
      "--enable-logging=stderr",
      "--v=0",
      `--log-net-log=/tmp/diag/chromium-${process.pid}.netlog.json`,
    ]);
  });
});
