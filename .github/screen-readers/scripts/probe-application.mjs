// Temporary probe for #202, removed before merging: the list table on
// the list inside a role="application" region.

/** @type {import("../steps.mjs").Script} */
export default {
  name: "probe-application",
  site: "catalogue",
  path: "/iframe.html?id=components-reorderablelist--probe-application&viewMode=story",
  steps: [
    {
      does: "Tab from the top of the page into the list.",
      keys: ["Tab"],
      expect: ["Layers", "Photo"],
    },
    { does: "Press ↓.", keys: ["ArrowDown"], expect: ["Shape"] },
    { does: "Press ↑.", keys: ["ArrowUp"], expect: ["Photo"] },
    { does: "Press ↑ again.", keys: ["ArrowUp"], expect: ["Title"] },
    {
      does: "Press Ctrl+↓.",
      keys: ["Control+ArrowDown"],
      expect: ["Photo", "not selected"],
    },
    {
      does: "Press →.",
      keys: ["ArrowRight"],
      expect: ["Show Photo", "toggle button", ["pressed", "selected"]],
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
