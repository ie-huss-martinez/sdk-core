// ui's manual pass, the Moving clips story: part 2's moving-clips table, with
// part 1's lane moves. The story doesn't announce moves itself, so a move is
// only checked by focus staying on the clip.
/** NVDA in both browsers: where its default browse mode diverges (see the issues). */
const NVDA = ["nvda-chrome", "nvda-firefox"];
const known = (issue, on = NVDA) => [
  { on, issue: `https://github.com/ie-huss-martinez/sdk-core/issues/${issue}` },
];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "moving-clips",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--moving-clips&viewMode=story",
  steps: [
    {
      does: "Tab to the playhead.",
      keys: ["Tab"],
      expect: ["Playhead", "slider"],
      knownFailures: known(203),
    },
    {
      does: "Tab to the clips.",
      keys: ["Tab"],
      expect: ["voice-2", "from 4.00 seconds"],
      knownFailures: known(203),
    },
    { does: "Press Alt+←.", keys: ["Alt+ArrowLeft"], expect: [] },
    { does: "Press Alt+↓.", keys: ["Alt+ArrowDown"], expect: [] },
    {
      does: "Press ↑, then ↓: focus is still on the clip, now in the music lane.",
      keys: ["ArrowUp", "ArrowDown"],
      expect: ["voice-2"],
      knownFailures: known(203, ["nvda-firefox"]),
    },
    { does: "Press Alt+↑.", keys: ["Alt+ArrowUp"], expect: [] },
  ],
};
