// ui's manual pass, the Lanes story: part 2's lanes table, without the
// browse-mode step, which a person judges by reading.
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
    },
    { does: "Press →.", keys: ["ArrowRight"], expect: [] },
    { does: "Press → again.", keys: ["ArrowRight"], expect: [] },
    { does: "Tab.", keys: ["Tab"], expect: ["Mute", "toggle button", "not pressed"] },
    { does: "Press →.", keys: ["ArrowRight"], expect: ["Voice gain", "slider"] },
    { does: "Tab.", keys: ["Tab"], expect: ["Voice 1"] },
    { does: "Press →.", keys: ["ArrowRight"], expect: ["Voice 2"] },
    { does: "Press ↓.", keys: ["ArrowDown"], expect: ["Music"] },
    { does: "Press ↓ again.", keys: ["ArrowDown"], expect: ["Effects"] },
    { does: "Press Space.", keys: ["Space"], expect: ["selected"] },
  ],
};
