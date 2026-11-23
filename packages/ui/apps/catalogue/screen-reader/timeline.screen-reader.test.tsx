import { composeStories, setProjectAnnotations } from "@storybook/react-vite";
import { describe, it } from "vitest";
import * as previewAnnotations from "../.storybook/preview.js";
import * as stories from "../src/components/Timeline.stories.js";
import { alt, play, type RunnableStory } from "./steps.js";

// ui's docs/testing/manual-pass.md, the Lanes and Moving clips stories, with
// the virtual screen reader (sdk-core ADR 0065). It hears what focus lands
// on. It doesn't announce the region, a lane's group or its toolbar on the
// way in, or a change to the focused slider's value, which NVDA and
// VoiceOver do: those steps stay in the manual pass.
setProjectAnnotations([previewAnnotations]);
const { Lanes, MovingClips } = composeStories(stories) as unknown as {
  Lanes: RunnableStory;
  MovingClips: RunnableStory;
};

const PLAYHEAD = "slider, Playhead, orientated horizontally, max value 300, min value 0";

describe("Timeline, spoken", () => {
  it("reads the playhead, a lane's controls and its clips (part 2, the lanes table)", async () => {
    await play(Lanes, [
      // NVDA also says the region "Timeline".
      ["Tab from the top of the page.", "{Tab}", [`${PLAYHEAD}, current value 3.33 seconds`]],
      // NVDA says the playhead's time, larger each time.
      ["Press →.", "{ArrowRight}", []],
      ["Press → again.", "{ArrowRight}", []],
      // NVDA also says the group and the toolbar "Track 1, Voice".
      ["Tab.", "{Tab}", ["button, Mute, not pressed"]],
      [
        "Press →.",
        "{ArrowRight}",
        [
          "slider, Voice gain, orientated horizontally, max value 12, min value -60, current value 0 decibels",
        ],
      ],
      // The clip's place is said twice: "clip 1 of 3" is in its name, and a
      // listbox's options are counted too. The manual pass asks to note it.
      ["Tab.", "{Tab}", ["option, Voice 1, clip 1 of 3, not selected, position 1, set size 3"]],
      [
        "Press →.",
        "{ArrowRight}",
        ["option, Voice 2, clip 2 of 3, selected, position 2, set size 3"],
      ],
      // NVDA also says the group "Track 2, Music", and below it "Track 3,
      // Effects, muted".
      [
        "Press ↓.",
        "{ArrowDown}",
        ["option, Music 1, clip 1 of 2, selected, position 1, set size 2"],
      ],
      [
        "Press ↓ again.",
        "{ArrowDown}",
        ["option, Effects 2, clip 2 of 3, selected, position 2, set size 3"],
      ],
      ["Press Space.", "[Space]", []],
    ]);
  });

  it("keeps focus on a clip that Alt and the arrows move (part 1, and part 2's moving clips)", async () => {
    const voice2 = (from: string, position: number) =>
      `option, voice-2, from ${from} seconds, selected, position ${position}, set size 2`;
    await play(MovingClips, [
      ["Tab to the playhead.", "{Tab}", [`${PLAYHEAD}, current value 0.00 seconds`]],
      ["Tab to the clips.", "{Tab}", [voice2("4.00", 2)]],
      // This story doesn't announce moves itself, so a move is silent, as the
      // manual pass says. Moving away and back hears the new start. In this
      // story, selection follows focus.
      ["Press Alt+←.", alt("ArrowLeft"), []],
      [
        "Press ← to voice-1.",
        "{ArrowLeft}",
        ["option, voice-1, from 0.67 seconds, selected, position 1, set size 2"],
      ],
      ["Press → back to voice-2.", "{ArrowRight}", [voice2("3.83", 2)]],
      ["Press Alt+→.", alt("ArrowRight"), []],
      [
        "Press ← and → again.",
        "{ArrowLeft}{ArrowRight}",
        ["option, voice-1, from 0.67 seconds, selected, position 1, set size 2", voice2("4.00", 2)],
      ],
      // The clip moves to the music lane and keeps focus, which is heard.
      ["Press Alt+↓.", alt("ArrowDown"), [voice2("4.00", 1)]],
      ["Press Alt+↓ again: there's no lane below.", alt("ArrowDown"), []],
      ["Press Alt+↑.", alt("ArrowUp"), [voice2("4.00", 2)]],
      ["Press Alt+↑ again: it stays.", alt("ArrowUp"), []],
    ]);
  });
});
