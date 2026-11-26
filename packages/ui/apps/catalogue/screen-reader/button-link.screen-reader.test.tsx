import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/ButtonLink.stories.js";
import { play, type RunnableStory } from "./steps.js";

// A link that looks like a button is still heard as a link (ui's
// docs/adr/0015), with the virtual screen reader (sdk-core ADR 0065).
setProjectAnnotations([previewAnnotations]);
const { LinksAndButtons } = composeStories(stories) as unknown as {
  LinksAndButtons: RunnableStory;
};

describe("ButtonLink, spoken", () => {
  it("is a link beside a button, and says when it opens a new tab", async () => {
    await play(LinksAndButtons, [
      ["Tab to the button.", "{Tab}", ["button, Save"]],
      // The arrow is decorative, so it isn't read.
      ["Tab to the link beside it.", "{Tab}", ["link, Read the guide"]],
      // Space does nothing on a link: it stays where it is and says nothing.
      ["Press Space.", "[Space]", []],
      ["Tab to the link to another site.", "{Tab}", ["link, Source code (opens in a new tab)"]],
      ["Tab to the mail link.", "{Tab}", ["link, Write to us"]],
    ]);
  });
});
