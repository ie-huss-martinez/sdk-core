// ui's manual pass, the List story: the list table's last row, that the
// buttons name their keys. On a fresh page of its own: in the list table it
// follows Alt+↓ and Alt+↑, which NVDA doesn't pass to the list (#202), and a
// browser that takes the Alt for its own menu leaves the next key wherever
// that menu is.

/** @type {import("../steps.mjs").Script} */
export default {
  name: "list-controls",
  site: "catalogue",
  path: "/iframe.html?id=components-reorderablelist--default&viewMode=story",
  steps: [
    { does: "Tab into the list.", keys: ["Tab"], expect: [] },
    {
      does: "Tab to the list's buttons.",
      keys: ["Tab"],
      expect: ["Move up", "button"],
    },
  ],
};
