// ui's manual pass, the Lanes story: part 2's lanes table, without the
// browse-mode step, which a person judges by reading.

/** NVDA in both browsers: where its default browse mode diverges (see the issues). */
const NVDA = ["nvda-chrome", "nvda-firefox"];
const known = (issue, on = NVDA) => [
  { on, issue: `https://github.com/ie-huss-martinez/sdk-core/issues/${issue}` },
];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "lanes",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--lanes&viewMode=story",
  steps: [
    {
      does: "Tab from the top of the page.",
      keys: ["Tab"],
      expect: ["Playhead", "slider", "3.33"],
      knownFailures: known(203),
    },
    { does: "Press →.", keys: ["ArrowRight"], expect: [] },
    { does: "Press → again.", keys: ["ArrowRight"], expect: [] },
    {
      does: "Tab to the voice lane's controls.",
      keys: ["Tab"],
      expect: ["Mute", "toggle button", "not pressed"],
      knownFailures: known(203),
    },
    {
      does: "Press → to its gain.",
      keys: ["ArrowRight"],
      expect: ["Voice gain", "slider"],
      knownFailures: known(203),
    },
    {
      does: "Tab to the voice clips.",
      keys: ["Tab"],
      expect: ["Voice 1"],
      knownFailures: known(203),
    },
    {
      does: "Press → to the next clip.",
      keys: ["ArrowRight"],
      expect: ["Voice 2"],
      knownFailures: known(203),
    },
    { does: "Press ↓.", keys: ["ArrowDown"], expect: ["Music"], knownFailures: known(203) },
    {
      does: "Press ↓ again.",
      keys: ["ArrowDown"],
      expect: ["Effects"],
      knownFailures: known(203),
    },
    // The manual pass expects "that clip, selected". In this story selection
    // follows focus, so the clip is selected already, and no reader said
    // anything (#204).
    {
      does: "Press Space.",
      keys: ["Space"],
      expect: ["selected"],
      knownFailures: known(204),
    },
  ],
};
