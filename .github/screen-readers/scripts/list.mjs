// ui's manual pass, the List story: part 2's list table.
/** NVDA in both browsers: where its default browse mode diverges (see the issues). */
const NVDA = ["nvda-chrome", "nvda-firefox"];
const known = (issue, on = NVDA) => [
  { on, issue: `https://github.com/ie-huss-martinez/sdk-core/issues/${issue}` },
];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "list",
  site: "catalogue",
  path: "/iframe.html?id=components-reorderablelist--default&viewMode=story",
  steps: [
    {
      does: "Tab from the top of the page into the list.",
      keys: ["Tab"],
      expect: ["Layers", "Photo"],
      knownFailures: known(201),
    },
    { does: "Press ↓.", keys: ["ArrowDown"], expect: ["Shape"], knownFailures: known(201) },
    { does: "Press ↑.", keys: ["ArrowUp"], expect: ["Photo"], knownFailures: known(201) },
    { does: "Press ↑ again.", keys: ["ArrowUp"], expect: ["Title"], knownFailures: known(201) },
    {
      does: "Press Ctrl+↓.",
      keys: ["Control+ArrowDown"],
      expect: ["Photo", "not selected"],
      knownFailures: known(201),
    },
    {
      does: "Press →.",
      keys: ["ArrowRight"],
      expect: ["Show Photo", ["pressed", "selected"]],
    },
    { does: "Press Space.", keys: ["Space"], expect: ["not pressed"] },
    { does: "Press Space again.", keys: ["Space"], expect: [["pressed", "selected"]] },
    { does: "Press ←.", keys: ["ArrowLeft"], expect: ["Photo"] },
    {
      does: "Press ↓ to Shape.",
      keys: ["ArrowDown"],
      expect: ["Shape"],
    },
    {
      does: "Press Alt+↓.",
      keys: ["Alt+ArrowDown"],
      expect: ["Shape moved to position 4 of 4"],
    },
    {
      does: "Press Alt+↑.",
      keys: ["Alt+ArrowUp"],
      expect: ["Shape moved to position 3 of 4"],
    },
    { does: "Press Delete.", keys: ["Delete"], expect: ["Background"] },
  ],
};
