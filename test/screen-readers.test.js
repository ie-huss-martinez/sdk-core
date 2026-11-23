// Tests .github/screen-readers/steps.mjs: how the real screen readers' runs
// check what was said, and wait for speech to stop (ADR 0066).
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingFragments, normalize, waitForQuiet } from "../.github/screen-readers/steps.mjs";

describe("missingFragments", () => {
  it("finds fragments across a step's phrases, whatever the punctuation and case", () => {
    const said = ["Show Photo, toggle button,", "PRESSED"];
    expect(missingFragments(said, ["show photo", "Toggle button", "pressed"])).toEqual([]);
  });

  it("names what wasn't said", () => {
    expect(missingFragments(["Mute, toggle button"], ["Mute", "not pressed"])).toEqual([
      "not pressed",
    ]);
  });

  it("finds Thai text as it is", () => {
    expect(missingFragments(["กิน, to eat, toggle button, not pressed"], ["กิน", "to eat"])).toEqual(
      [],
    );
  });

  it("asks nothing of a step that expects nothing", () => {
    expect(missingFragments([], [])).toEqual([]);
  });

  it("doesn't let a fragment match across a word's punctuation into another word", () => {
    expect(normalize("Shape moved to position 4 of 4.")).toBe("shape moved to position 4 of 4");
    expect(missingFragments(["position 4 of 4"], ["position 3 of 4"])).toEqual(["position 3 of 4"]);
  });
});

/** A clock and a phrase count that grows on a schedule, in milliseconds. */
function fakeReader(times) {
  let clock = 0;
  return {
    count: async () => times.filter((time) => time <= clock).length,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
}

describe("waitForQuiet", () => {
  it("waits until nothing new has been said for the quiet time", async () => {
    const reader = fakeReader([100, 400, 900]);
    const result = await waitForQuiet(reader.count, { ...reader, quietMs: 500, pollMs: 100 });
    expect(result).toEqual({ count: 3, settled: true });
    expect(reader.now()).toBeGreaterThanOrEqual(1400);
  });

  it("gives up, unsettled, when speech goes on past the timeout", async () => {
    const reader = fakeReader(Array.from({ length: 100 }, (_, index) => index * 200));
    const result = await waitForQuiet(reader.count, {
      ...reader,
      quietMs: 500,
      pollMs: 100,
      timeoutMs: 3000,
    });
    expect(result.settled).toBe(false);
    expect(reader.now()).toBeLessThanOrEqual(3100);
  });

  it("sees a log that grows in place, since it counts afresh each time", async () => {
    const log = [];
    let clock = 0;
    const result = await waitForQuiet(async () => log.length, {
      quietMs: 300,
      pollMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        if (clock === 200) {
          log.push("Moved to position 2 of 3");
        }
      },
    });
    expect(result).toEqual({ count: 1, settled: true });
  });
});

describe("the scripts", () => {
  it("each have a site, a page and steps with keys", async () => {
    const dir = new URL("../.github/screen-readers/scripts/", import.meta.url);
    const files = readdirSync(dir).filter((file) => file.endsWith(".mjs"));
    expect(files.sort()).toEqual(["lanes.mjs", "learn.mjs", "list.mjs", "moving-clips.mjs"]);
    for (const file of files) {
      const { default: script } = await import(new URL(file, dir).href);
      expect(["catalogue", "learn"]).toContain(script.site);
      expect(script.path.startsWith("/")).toBe(true);
      expect(script.steps.length).toBeGreaterThan(0);
      for (const step of script.steps) {
        expect(step.keys.length, `${script.name}: ${step.does}`).toBeGreaterThan(0);
        expect(Array.isArray(step.expect)).toBe(true);
      }
    }
  });
});
