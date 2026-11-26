import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/ToggleButton.stories.js";
import { play, type RunnableStory } from "./steps.js";

// Filter chips are toggle buttons in a named group (ui's docs/adr/0017).
// What's heard, with the virtual screen reader (sdk-core ADR 0065). It
// doesn't say the group focus enters, "Filter by category", which NVDA and
// VoiceOver do.
setProjectAnnotations([previewAnnotations]);
const { FilterChips } = composeStories(stories) as unknown as { FilterChips: RunnableStory };

const back = "{Shift>}{Tab}{/Shift}";

describe("Filter chips, spoken", () => {
  it("reads each chip with its state, and the state it has after being pressed", async () => {
    await play(FilterChips, [
      ["Tab to the first chip.", "{Tab}", ["button, All, not pressed"]],
      ["Tab on.", "{Tab}", ["button, Foundations, not pressed"]],
      ["Tab to the chip that's on.", "{Tab}", ["button, Security, pressed"]],
      // NVDA says "not pressed" here.
      ["Press Space, which turns it off.", "[Space]", []],
      ["Tab on.", "{Tab}", ["button, Operations, not pressed"]],
      ["Shift+Tab back to it.", back, ["button, Security, not pressed"]],
      ["Shift+Tab.", back, ["button, Foundations, not pressed"]],
      // No category applies now, so "All" is on.
      ["Shift+Tab to the first chip.", back, ["button, All, pressed"]],
    ]);
  });
});
