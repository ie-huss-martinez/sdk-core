import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/SearchField.stories.js";
import { play, type RunnableStory } from "./steps.js";

// What's heard while searching and clearing (ui's docs/adr/0017), with the
// virtual screen reader (sdk-core ADR 0065).
setProjectAnnotations([previewAnnotations]);
const { WithText } = composeStories(stories) as unknown as { WithText: RunnableStory };

describe("SearchField, spoken", () => {
  it("reads the field with its text, then the clear button, and returns to the field", async () => {
    await play(WithText, [
      ["Tab to the field.", "{Tab}", ["searchbox, Search guides, socket disconnects"]],
      ["Tab to the clear button.", "{Tab}", ["button, Clear search"]],
      // Focus goes back to the field, now empty.
      ["Press Enter.", "{Enter}", ["searchbox, Search guides"]],
      // A real screen reader echoes the typing.
      ["Type two letters.", "ab", []],
      ["Tab: the clear button is back.", "{Tab}", ["button, Clear search"]],
    ]);
  });
});
