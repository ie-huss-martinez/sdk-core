// learn-sdk's screen-reader pass, its first exercise: the multiple-choice
// table, with the Thai prompts. Run where a Thai voice is installed.
/** NVDA in both browsers: where its default browse mode diverges (see the issues). */
const NVDA = ["nvda-chrome", "nvda-firefox"];
const known = (issue, on = NVDA) => [
  { on, issue: `https://github.com/ie-huss-martinez/sdk-core/issues/${issue}` },
];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "learn",
  site: "learn",
  path: "/",
  steps: [
    {
      does: "Tab from the top of the page into the player.",
      keys: ["Tab"],
      expect: ["กิน", "to eat", "toggle button", "not pressed"],
      knownFailures: known(206),
    },
    {
      does: "Press Enter on “to eat”.",
      keys: ["Enter"],
      expect: [["pressed", "selected"]],
      knownFailures: known(206),
    },
    {
      does: "Tab to the second question.",
      keys: ["Tab"],
      expect: ["น้ำ", "rice", "not pressed"],
      knownFailures: known(206),
    },
    { does: "Choose “rice” with Space.", keys: ["Space"], expect: [["pressed", "selected"]] },
    {
      does: "Press Control+Enter, ⌘Enter on a Mac.",
      keys: ["Mod+Enter"],
      expect: ["1 of 2 right"],
      knownFailures: known(207, ["nvda-chrome"]),
    },
  ],
};
