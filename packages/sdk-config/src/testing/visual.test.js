import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVisualVariant,
  defineVisualConfig,
  visualComparison,
  visualVariants,
} from "./visual.js";

const webServer = { command: "vite preview", url: "http://localhost:4320" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("defineVisualConfig", () => {
  it("refuses to run outside the browser test image", () => {
    vi.stubEnv("HM_VISUAL_CONTAINER", "");
    expect(() => defineVisualConfig({ baseURL: "http://localhost:4320", webServer })).toThrow(
      /only in the pinned browser test image .*pnpm test:visual/,
    );
  });

  it("fixes the page, compares without tolerance, and names baselines as ui does", () => {
    vi.stubEnv("HM_VISUAL_CONTAINER", "1");
    const config = defineVisualConfig({ baseURL: "http://localhost:4320", webServer });
    expect(config.projects).toEqual([{ name: "chromium" }]);
    expect(config.use).toMatchObject({
      baseURL: "http://localhost:4320",
      browserName: "chromium",
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    expect(config.expect?.toHaveScreenshot).toEqual({
      threshold: 0.0038,
      maxDiffPixelRatio: 0,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
    expect(config.updateSnapshots).toBe("none");
    expect(config.testDir).toBe("visual");
    expect(config.snapshotPathTemplate).toBe(
      "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
    );
    expect(config.webServer).toBe(webServer);
  });
});

describe("visualComparison", () => {
  it("allows no differing pixel, at the threshold ADR 0054 derives, and can't be changed", () => {
    expect(visualComparison).toEqual({ threshold: 0.0038, maxDiffPixelRatio: 0 });
    expect(Object.isFrozen(visualComparison)).toBe(true);
    // One level on every channel measures 0.5053 in pixelmatch's YIQ distance.
    expect(35215 * visualComparison.threshold ** 2).toBeGreaterThan(0.5053);
    expect(35215 * (visualComparison.threshold - 0.0001) ** 2).toBeLessThan(0.5053);
  });
});

describe("visualVariants", () => {
  it("covers light and dark, each in both densities", () => {
    expect(visualVariants.map((variant) => variant.name)).toEqual([
      "light-compact",
      "light-comfortable",
      "dark-compact",
      "dark-comfortable",
    ]);
    expect(Object.isFrozen(visualVariants)).toBe(true);
  });

  it("are applied as data-hm-theme and data-hm-density on the root", async () => {
    const attributes = new Map();
    const fake = {
      evaluate: async (/** @type {Function} */ fn, /** @type {unknown} */ arg) => {
        vi.stubGlobal("document", {
          documentElement: {
            setAttribute: (/** @type {string} */ name, /** @type {string} */ value) =>
              attributes.set(name, value),
          },
          fonts: { ready: Promise.resolve() },
        });
        try {
          return await fn(arg);
        } finally {
          vi.unstubAllGlobals();
        }
      },
    };
    await applyVisualVariant(
      /** @type {import("@playwright/test").Page} */ (/** @type {unknown} */ (fake)),
      /** @type {import("./visual.js").VisualVariant} */ (visualVariants[2]),
    );
    expect(Object.fromEntries(attributes)).toEqual({
      "data-hm-theme": "dark",
      "data-hm-density": "compact",
    });
  });
});
