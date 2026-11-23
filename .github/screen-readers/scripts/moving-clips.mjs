// ui's manual pass, the Moving clips story: part 2's moving-clips table, with
// part 1's lane moves. The story doesn't announce moves itself, so a move is
// only checked by focus staying on the clip.

/** NVDA in both browsers, where its first Tab differs from VoiceOver's. */
const NVDA = ["nvda-chrome", "nvda-firefox"];

/** @type {import("../steps.mjs").Script} */
export default {
  name: "moving-clips",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--moving-clips&viewMode=story",
  steps: [
    // NVDA's first Tab goes past the page's first control, the playhead, to
    // the clips (#203, as in the lanes script). VoiceOver's reaches it.
    { does: "Tab from the top of the page.", keys: ["Tab"], expect: ["Timeline"] },
    {
      does: "With NVDA, Shift+Tab back to the playhead.",
      keys: ["Shift+Tab"],
      expect: ["Playhead", "slider"],
      only: NVDA,
    },
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
