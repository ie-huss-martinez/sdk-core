import axe from "axe-core";
import { act, createRef } from "react";
import type { AudioPlan } from "../src/core/model/plan.js";
import { AudioEditor, type AudioEditorHandle } from "../src/react/AudioEditor.js";
import { wavFile } from "./fixtures/pcm-files.js";
import { mount } from "./react.js";
import { sessionEvents } from "./session-events.js";

/** A tone at 8 kHz, as a WAV file. */
export function recording(name = "take.wav", seconds = 1): File {
  const samples = Array.from({ length: 8_000 * seconds }, (_, i) => Math.sin(i / 9) * 0.25);
  return new File([wavFile([samples])], name, { type: "audio/wav" });
}

/** Runs something that updates the editor, inside act(). */
export async function step(run: () => unknown): Promise<void> {
  await act(async () => {
    await run();
  });
}

/**
 * The ids of axe's violations in an element, once the page's finite
 * animations and transitions have finished: a control caught mid-fade
 * fails color-contrast. Endless ones, such as a spinner, aren't waited on.
 */
export async function violations(element: Element): Promise<string[]> {
  await step(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((each) => Number.isFinite(each.effect?.getComputedTiming().endTime))
        .map((each) => each.finished.catch(() => undefined)),
    ),
  );
  return (await axe.run(element)).violations.map((each) => each.id);
}

/** Whether a control is disabled as ui's focusable-when-disabled controls are. */
export const disabled = (element: Element): boolean =>
  element.getAttribute("aria-disabled") === "true";

/**
 * An editor with these recordings open, each on a track of its own, and its
 * latest plan. It's wide enough for the frame's desktop layout, with the tools
 * panel beside the stage, and in Expert mode, which lists every tool in it
 * (docs/adr/0007).
 */
export function editor(...files: File[]) {
  return editorSized(1100, ...files);
}

/** {@link editor}, `width` CSS pixels wide. */
export async function editorSized(width: number, ...files: File[]) {
  const events = sessionEvents();
  const ref = createRef<AudioEditorHandle>();
  const latest: { plan?: AudioPlan } = {};
  const container = await mount(
    <AudioEditor
      ref={ref}
      defaultPreferences={{ mode: "expert" }}
      onEvent={events.onEvent}
      onChange={(plan) => (latest.plan = plan)}
    />,
    `width: ${width}px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);`,
  );
  const [first, ...rest] = files;
  if (first) await step(() => ref.current?.open(first));
  for (const file of rest) await step(() => ref.current?.insert(file));
  // ui's announcer says the open's toast in the next animation frame:
  // let that frame run inside act(), so it never updates React outside one.
  // Frames run in the order they were asked for, so this one comes after it.
  await step(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const plan = () => latest.plan as AudioPlan;
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    ) as HTMLButtonElement;
  // A bar's button carries data-tool, and a tools panel's row data-hm-tool-id.
  const tool = (id: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-tool="${id}"], [data-hm-tool-id="${id}"]`,
    ) as HTMLButtonElement;
  return { container, events, ref, plan, button, tool };
}
