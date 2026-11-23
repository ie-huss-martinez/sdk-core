// learn-sdk's screen-reader pass, its first exercise: the multiple-choice
// table, with the Thai prompts. Run where a Thai voice is installed.
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
    },
    { does: "Press Enter on “to eat”.", keys: ["Enter"], expect: ["pressed"] },
    { does: "Tab to the second question.", keys: ["Tab"], expect: ["น้ำ", "rice", "not pressed"] },
    { does: "Choose “rice” with Space.", keys: ["Space"], expect: ["pressed"] },
    { does: "Press Control+Enter.", keys: ["Control+Enter"], expect: ["1 of 2 right"] },
  ],
};
