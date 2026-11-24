// ui's manual pass, the Lanes story: part 2's lanes table, without the
// browse-mode step, which a person judges by reading.

/** NVDA in both browsers, where its first Tab differs from VoiceOver's. */
const NVDA = ["nvda-chrome", "nvda-firefox"];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "lanes",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--lanes&viewMode=story",
  steps: [
    // NVDA's first Tab on a page goes past the page's first control, here the
    // playhead, to the voice lane's Mute. It does the same to a button
    // placed first, so it's NVDA's, not the timeline's (#203). VoiceOver's
    // reaches the playhead.
    { does: "Tab from the top of the page.", keys: ["Tab"], expect: ["Timeline"] },
    {
      does: "With NVDA, Shift+Tab back to the playhead.",
      keys: ["Shift+Tab"],
      expect: ["Playhead", "slider", "3.33"],
      only: NVDA,
    },
    { does: "Press →.", keys: ["ArrowRight"], expect: [] },
    { does: "Press → again.", keys: ["ArrowRight"], expect: [] },
    {
      does: "Tab to the voice lane's controls.",
      keys: ["Tab"],
      expect: ["Mute", "toggle button", "not pressed"],
    },
    { does: "Press → to its gain.", keys: ["ArrowRight"], expect: ["Voice gain", "slider"] },
    { does: "Tab to the voice clips.", keys: ["Tab"], expect: ["Voice 1"] },
    { does: "Press → to the next clip.", keys: ["ArrowRight"], expect: ["Voice 2"] },
    { does: "Press ↓.", keys: ["ArrowDown"], expect: ["Music"] },
    { does: "Press ↓ again.", keys: ["ArrowDown"], expect: ["Effects"] },
    // Selection follows focus, so the clip is selected already, and Space
    // takes it out of the selection, which the clips announce (#204).
    { does: "Press Space.", keys: ["Space"], expect: ["Effects 2", "not selected"] },
  ],
};
