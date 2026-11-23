// Temporary probe for #203, removed before merging: whether Tab reaches the
// playhead when something focusable comes before the timeline.

/** @type {import("../steps.mjs").Script} */
export default {
  name: "probe-after-button",
  site: "catalogue",
  path: "/iframe.html?id=components-timeline--probe-after-button&viewMode=story",
  steps: [
    { does: "Tab from the top of the page.", keys: ["Tab"], expect: ["Before", "button"] },
    { does: "Tab into the timeline.", keys: ["Tab"], expect: ["Playhead", "slider"] },
    { does: "Tab on.", keys: ["Tab"], expect: ["Mute", "toggle button"] },
  ],
};
