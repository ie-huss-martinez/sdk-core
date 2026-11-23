import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/ReorderableList.stories.js";
import { alt, play, type RunnableStory } from "./steps.js";

// ui's docs/testing/manual-pass.md, the List story, with the virtual screen
// reader (sdk-core ADR 0065). It hears what focus lands on and what the
// announcer says. It doesn't announce the grid or the row on the way in, or
// a change to the focused control's own state, which NVDA and VoiceOver do:
// those steps stay in the manual pass.
setProjectAnnotations([previewAnnotations]);
const { Default } = composeStories(stories) as unknown as { Default: RunnableStory };

describe("ReorderableList, spoken", () => {
  it("reads the rows, the row's control and each move (part 2, the list table)", async () => {
    await play(Default, [
      // NVDA also says the grid "Layers", "selected" and "row 2 of 4".
      ["Tab from the top of the page into the list.", "{Tab}", ["gridcell, Photo"]],
      ["Press ↓.", "{ArrowDown}", ["gridcell, Shape"]],
      ["Press ↑.", "{ArrowUp}", ["gridcell, Photo"]],
      ["Press ↑ again.", "{ArrowUp}", ["gridcell, Title"]],
      ["Press Ctrl+↓.", "{Control>}{ArrowDown}{/Control}", ["gridcell, Photo"]],
      ["Press →.", "{ArrowRight}", ["gridcell, Show Photo, pressed"]],
      // NVDA says "not pressed", then "pressed".
      ["Press Space.", "[Space]", []],
      ["Press Space again.", "[Space]", []],
      ["Press ←.", "{ArrowLeft}", ["gridcell, Photo"]],
      ["Press ↓ to Shape.", "{ArrowDown}", ["gridcell, Shape"]],
      ["Press Alt+↓.", alt("ArrowDown"), ["polite: Shape moved to position 4 of 4"]],
      ["Press Alt+↑.", alt("ArrowUp"), ["polite: Shape moved to position 3 of 4"]],
      ["Press Delete.", "{Delete}", ["gridcell, Background"]],
      ["Press Tab.", "{Tab}", ["button, Move up, key shortcuts Alt+ArrowUp"]],
    ]);
  });

  it("announces each move with Alt and the arrows, and nothing at the ends (part 1)", async () => {
    await play(Default, [
      ["Tab into the list.", "{Tab}", ["gridcell, Photo"]],
      [
        "Press Alt+↑ until Photo is first.",
        alt("ArrowUp"),
        ["polite: Photo moved to position 1 of 4"],
      ],
      ["Press Alt+↑ once more.", alt("ArrowUp"), []],
      ["And again.", alt("ArrowUp"), []],
      ["Press Alt+↓.", alt("ArrowDown"), ["polite: Photo moved to position 2 of 4"]],
      ["Press Alt+↓.", alt("ArrowDown"), ["polite: Photo moved to position 3 of 4"]],
      [
        "Press Alt+↓ until Photo is last.",
        alt("ArrowDown"),
        ["polite: Photo moved to position 4 of 4"],
      ],
      ["Press Alt+↓ once more.", alt("ArrowDown"), []],
      ["And again.", alt("ArrowDown"), []],
    ]);
  });
});
