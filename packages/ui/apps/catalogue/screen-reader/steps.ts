import { startScreenReader } from "@hussmartinez/sdk-config/testing/screen-reader";
import { expect } from "vitest";
import { userEvent } from "vitest/browser";

/** What a test needs from a story composed with `composeStories`. */
export interface RunnableStory {
  run: (context: { canvasElement: HTMLElement }) => Promise<void>;
}

/**
 * One row of a manual-pass table: what to do, with the keys in
 * `userEvent.keyboard`'s syntax, and what the virtual screen reader must say
 * after it, phrase by phrase. An empty list means it says nothing.
 */
export type Step = readonly [does: string, keys: string, says: readonly string[]];

/** Alt with a key, as `userEvent.keyboard` writes it. */
export const alt = (key: string): string => `{Alt>}{${key}}{/Alt}`;

/**
 * Renders a story, starts the virtual screen reader, and does each step in
 * turn, checking what it says after each one (sdk-core ADR 0065).
 */
export async function play(story: RunnableStory, steps: readonly Step[]): Promise<void> {
  const canvasElement = document.createElement("div");
  document.body.append(canvasElement);
  await story.run({ canvasElement });
  const reader = await startScreenReader();
  try {
    for (const [does, keys, says] of steps) {
      expect(await reader.spoken(() => userEvent.keyboard(keys)), does).toEqual(says);
    }
  } finally {
    await reader.stop();
    canvasElement.remove();
  }
}
