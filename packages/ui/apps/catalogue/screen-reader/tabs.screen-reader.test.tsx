import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/Tabs.stories.js";
import { play, type RunnableStory } from "./steps.js";

// What's heard while working tabs (ui's docs/adr/0016), with the virtual
// screen reader (sdk-core ADR 0065).
setProjectAnnotations([previewAnnotations]);
const { Default } = composeStories(stories) as unknown as { Default: RunnableStory };

describe("Tabs, spoken", () => {
  it("reads each tab with its place as the arrows select it, then the panel", async () => {
    await play(Default, [
      // "1 control" is the panel the tab shows.
      [
        "Tab to the row of tabs.",
        "{Tab}",
        ["tab, Next.js, selected, 1 control, position 1, set size 3"],
      ],
      ["Press →.", "{ArrowRight}", ["tab, Astro, selected, 1 control, position 2, set size 3"]],
      ["Press End.", "{End}", ["tab, Remix, selected, 1 control, position 3, set size 3"]],
      [
        "Press → at the end, which wraps.",
        "{ArrowRight}",
        ["tab, Next.js, selected, 1 control, position 1, set size 3"],
      ],
      ["Press Tab, to the panel.", "{Tab}", ["tabpanel, Next.js"]],
    ]);
  });
});
