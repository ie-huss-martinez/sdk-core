// Tests .github/screen-readers/steps.mjs: how the real screen readers' runs
// check what was said, and wait for speech to stop (ADR 0066).
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  missingFragments,
  normalize,
  outcome,
  platformKey,
  waitForSpeech,
} from "../.github/screen-readers/steps.mjs";

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

  it("takes any one of a fragment's alternatives, and names them all when none was said", () => {
    expect(
      missingFragments(["Show Photo selected toggle button"], [["pressed", "selected"]]),
    ).toEqual([]);
    expect(missingFragments(["Show Photo toggle button"], [["pressed", "selected"]])).toEqual([
      "pressed or selected",
    ]);
  });

  it('doesn\'t take a state from its opposite: "pressed" isn\'t in "not pressed"', () => {
    expect(missingFragments(["Mute, toggle button, not pressed"], ["pressed"])).toEqual([
      "pressed",
    ]);
    expect(missingFragments(["Mute, toggle button, not pressed"], ["not pressed"])).toEqual([]);
    expect(missingFragments(["Photo, not selected"], [["pressed", "selected"]])).toEqual([
      "pressed or selected",
    ]);
    expect(missingFragments(["Show Photo, toggle button, pressed"], ["pressed"])).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(missingFragments(["unpressed"], ["pressed"])).toEqual(["pressed"]);
    expect(missingFragments(["Voice 12"], ["Voice 1"])).toEqual(["Voice 1"]);
    expect(missingFragments(["3.33 seconds"], ["3.33"])).toEqual([]);
  });

  it("finds Thai words, with their marks, between other words", () => {
    expect(
      missingFragments(["rice toggle button Choices for question 2 น้ำ group"], ["น้ำ"]),
    ).toEqual([]);
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

const TIMING = { firstMs: 2000, quietMs: 500, pollMs: 100 };

describe("waitForSpeech", () => {
  it("waits for speech that starts late, then for the quiet time after it", async () => {
    // NVDA's log arriving 1.8 s after the key, as on the hosted runner.
    const reader = fakeReader([1800, 1900]);
    const result = await waitForSpeech(reader.count, { ...reader, ...TIMING });
    expect(result).toEqual({ count: 2, settled: true });
    expect(reader.now()).toBeGreaterThanOrEqual(2400);
  });

  it("ends a step that says nothing after firstMs", async () => {
    const reader = fakeReader([]);
    const result = await waitForSpeech(reader.count, { ...reader, ...TIMING });
    expect(result).toEqual({ count: 0, settled: true });
    expect(reader.now()).toBe(2000);
  });

  it("counts from the step's start, so speech before the first look still counts", async () => {
    const reader = fakeReader([0]);
    const result = await waitForSpeech(reader.count, { ...reader, ...TIMING, since: 0 });
    expect(result).toEqual({ count: 1, settled: true });
  });

  it("gives up, unsettled, when speech goes on past the timeout", async () => {
    const reader = fakeReader(Array.from({ length: 100 }, (_, index) => index * 200));
    const result = await waitForSpeech(reader.count, { ...reader, ...TIMING, timeoutMs: 3000 });
    expect(result.settled).toBe(false);
    expect(reader.now()).toBeLessThanOrEqual(3100);
  });

  it("sees a log that grows in place, since it counts afresh each time", async () => {
    const log = [];
    let clock = 0;
    const result = await waitForSpeech(async () => log.length, {
      ...TIMING,
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

describe("platformKey", () => {
  it("makes Mod Command on macOS and Control elsewhere", () => {
    expect(platformKey("Mod+Enter", "darwin")).toBe("Command+Enter");
    expect(platformKey("Mod+Enter", "win32")).toBe("Control+Enter");
    expect(platformKey("Alt+ArrowDown", "darwin")).toBe("Alt+ArrowDown");
  });
});

describe("outcome", () => {
  const issue = "https://github.com/ie-huss-martinez/sdk-core/issues/1";
  const step = {
    does: "Press Alt+↓.",
    keys: ["Alt+ArrowDown"],
    expect: ["moved"],
    knownFailures: [{ on: ["nvda-chrome", "nvda-firefox"], issue }],
  };

  it("passes or fails an unmarked step on what was said", () => {
    const plain = { ...step, knownFailures: undefined };
    expect(outcome(plain, [], "nvda-chrome")).toEqual({ outcome: "pass" });
    expect(outcome(plain, ["moved"], "nvda-chrome")).toEqual({ outcome: "fail" });
  });

  it("expects a marked step to fail on the pairings it names", () => {
    expect(outcome(step, ["moved"], "nvda-firefox")).toEqual({
      outcome: "expected failure",
      issue,
    });
  });

  it("flags a marked step that passes, so the fix removes the marker", () => {
    expect(outcome(step, [], "nvda-chrome")).toEqual({ outcome: "unexpected pass", issue });
  });

  it("judges a step normally on a pairing its marker doesn't name", () => {
    expect(outcome(step, ["moved"], "voiceover-safari")).toEqual({ outcome: "fail" });
    expect(outcome(step, [], "voiceover-safari")).toEqual({ outcome: "pass" });
  });
});

const PAIRINGS = ["nvda-chrome", "nvda-firefox", "voiceover-safari"];

describe("the scripts", () => {
  it("each have a site, a page and steps with keys", async () => {
    const dir = new URL("../.github/screen-readers/scripts/", import.meta.url);
    const files = readdirSync(dir).filter((file) => file.endsWith(".mjs"));
    expect(files.sort()).toEqual([
      "lanes.mjs",
      "learn.mjs",
      "list-controls.mjs",
      "list.mjs",
      "moving-clips.mjs",
    ]);
    for (const file of files) {
      const { default: script } = await import(new URL(file, dir).href);
      expect(["catalogue", "learn"]).toContain(script.site);
      expect(script.path.startsWith("/")).toBe(true);
      expect(script.steps.length).toBeGreaterThan(0);
      // A step is named in issues and in failures by what it does.
      const labels = script.steps.map((step) => step.does);
      expect(new Set(labels).size, `${script.name}'s steps each say what they do`).toBe(
        labels.length,
      );
      for (const step of script.steps) {
        expect(step.keys.length, `${script.name}: ${step.does}`).toBeGreaterThan(0);
        expect(Array.isArray(step.expect)).toBe(true);
        for (const failure of step.knownFailures ?? []) {
          expect(failure.on.length, `${script.name}: ${step.does}`).toBeGreaterThan(0);
          expect(failure.on.every((pairing) => PAIRINGS.includes(pairing))).toBe(true);
          expect(failure.issue).toMatch(
            /^https:\/\/github\.com\/ie-huss-martinez\/sdk-core\/issues\/\d+$/,
          );
          expect(
            step.expect.length,
            `${script.name}: ${step.does} asserts something`,
          ).toBeGreaterThan(0);
        }
        for (const fragment of step.expect) {
          const options = Array.isArray(fragment) ? fragment : [fragment];
          expect(options.every((option) => typeof option === "string" && option.length > 0)).toBe(
            true,
          );
        }
      }
    }
  });
});
