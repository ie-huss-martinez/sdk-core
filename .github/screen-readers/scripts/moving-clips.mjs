// ui's manual pass, the Moving clips story: part 2's moving-clips table, with
// part 1's lane moves. The story doesn't announce moves itself, so a move is
// only checked by focus staying on the clip.
/** @type {import("../steps.mjs").Script} */
export default {
  name: "moving-clips",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--moving-clips&viewMode=story",
  steps: [
    { does: "Tab to the playhead.", keys: ["Tab"], expect: ["Playhead", "slider"] },
    { does: "Tab to the clips.", keys: ["Tab"], expect: ["voice-2", "from 4.00 seconds"] },
    { does: "Press Alt+←.", keys: ["Alt+ArrowLeft"], expect: [] },
    { does: "Press Alt+↓.", keys: ["Alt+ArrowDown"], expect: [] },
    {
      does: "Press ↑, then ↓: focus is still on the clip, now in the music lane.",
      keys: ["ArrowUp", "ArrowDown"],
      expect: ["voice-2"],
    },
    { does: "Press Alt+↑.", keys: ["Alt+ArrowUp"], expect: [] },
  ],
};
