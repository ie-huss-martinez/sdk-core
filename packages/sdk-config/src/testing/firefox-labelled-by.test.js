import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRASHING_FIREFOX,
  removeLabelledByElements,
  withFirefoxLabelledByGuard,
} from "./firefox-labelled-by.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A page's `Element`, with the property on its prototype as Firefox has it. */
function page(/** @type {string} */ userAgent) {
  class Element {}
  Object.defineProperty(Element.prototype, "ariaLabelledByElements", {
    configurable: true,
    get: () => [],
  });
  vi.stubGlobal("navigator", { userAgent });
  vi.stubGlobal("Element", Element);
  return Element;
}

const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:159.0) Gecko/20100101 Firefox/159.0";
const CHROMIUM =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36";
const WEBKIT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

describe("removeLabelledByElements", () => {
  it("removes the property from the page's elements in Firefox, and again does nothing", () => {
    const Element = page(FIREFOX);

    removeLabelledByElements();

    expect("ariaLabelledByElements" in Element.prototype).toBe(false);
    expect(() => removeLabelledByElements()).not.toThrow();
  });

  it.each([
    ["Chromium", CHROMIUM],
    ["WebKit", WEBKIT],
  ])("leaves %s as it is", (_name, userAgent) => {
    const Element = page(userAgent);

    removeLabelledByElements();

    expect("ariaLabelledByElements" in Element.prototype).toBe(true);
  });

  it("does nothing in a Firefox without the property", () => {
    vi.stubGlobal("navigator", { userAgent: FIREFOX });
    vi.stubGlobal("Element", class Element {});

    expect(() => removeLabelledByElements()).not.toThrow();
  });

  it("does nothing outside a page", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("Element", undefined);

    expect(() => removeLabelledByElements()).not.toThrow();
  });

  it("uses nothing from outside itself, so Playwright can send it to the page as text", () => {
    const Element = page(FIREFOX);

    // As an init script arrives: rebuilt from its source, with no module around it.
    new Function(`(${removeLabelledByElements.toString()})()`)();

    expect("ariaLabelledByElements" in Element.prototype).toBe(false);
  });
});

describe("withFirefoxLabelledByGuard", () => {
  /**
   * A stand-in for Playwright's `test`: `extend` hands back the fixtures it was given.
   *
   * @type {{ extend(fixtures: any): any }}
   */
  const base = { extend: (fixtures) => ({ extendedWith: fixtures }) };

  /** Runs the `page` fixture as Playwright would, in a browser. */
  async function opened(/** @type {string} */ browserName) {
    const scripts = /** @type {Array<() => void>} */ ([]);
    const playwrightPage = {
      addInitScript: async (/** @type {() => void} */ script) => {
        scripts.push(script);
      },
    };
    const used = /** @type {unknown[]} */ ([]);
    // The stand-in's `extend` returns what it was given, whatever its type says.
    const { extendedWith } = /** @type {any} */ (withFirefoxLabelledByGuard(base));
    await extendedWith.page(
      { page: playwrightPage, browserName },
      async (/** @type {unknown} */ given) => {
        used.push(given);
      },
    );
    return { scripts, used, playwrightPage };
  }

  it("adds the guard as an init script in Firefox, and hands the page on", async () => {
    const { scripts, used, playwrightPage } = await opened("firefox");

    expect(scripts).toEqual([removeLabelledByElements]);
    expect(used).toEqual([playwrightPage]);
  });

  it.each(["chromium", "webkit"])("adds nothing in %s, and hands the page on", async (browser) => {
    const { scripts, used, playwrightPage } = await opened(browser);

    expect(scripts).toEqual([]);
    expect(used).toEqual([playwrightPage]);
  });

  it("extends the test it's given, so a repository's own fixtures stay", () => {
    const extend = vi.fn(() => "extended");

    expect(withFirefoxLabelledByGuard({ extend })).toBe("extended");
    expect(extend).toHaveBeenCalledTimes(1);
  });
});

describe("the Firefox the guard is for", () => {
  it("is still the one the pinned Playwright installs", () => {
    // Playwright's own record of its browsers, beside the package this
    // repository pins to the image's version (sdk-core ADR 0025).
    const fromPlaywright = createRequire(createRequire(import.meta.url).resolve("playwright"));
    const browsers =
      /** @type {{ browsers: Array<{ name: string, revision: string, browserVersion: string }> }} */ (
        JSON.parse(
          readFileSync(
            join(dirname(fromPlaywright.resolve("playwright-core/package.json")), "browsers.json"),
            "utf8",
          ),
        )
      );
    const firefox = browsers.browsers.find(({ name }) => name === "firefox");

    expect(
      { revision: firefox?.revision, browserVersion: firefox?.browserVersion },
      "Firefox changed: re-check ie-huss-martinez/ui#61 with its two-line page, and remove the guard if the crash is fixed. If it isn't, update CRASHING_FIREFOX.",
    ).toEqual(CRASHING_FIREFOX);
  });
});
