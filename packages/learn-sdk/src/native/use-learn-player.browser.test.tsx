import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryProgressStore } from "../adapters/memory-progress/memory-progress.js";
import { createExerciseTypes } from "../core/model/exercise-type.js";
import { englishProfile } from "../core/model/language-profiles.js";
import type { ProgressChange } from "../core/model/progress.js";
import type { LearnPlayerOptions } from "../core/session/player.js";
import { recall } from "../features/recall/recall.js";
import { sequenceRecall } from "../features/sequence-recall/sequence-recall.js";
import { createFakeScheduler } from "../testing.js";
import { type LearnPlayerSession, useLearnPlayer } from "./use-learn-player.js";

// The hooks have no DOM of their own; a browser is only where React runs
// effects here, as it would on a device (ADR 0010).

const types = createExerciseTypes([recall, sequenceRecall]);
const content = {
  format: "hm-learn-content",
  version: 1,
  exercises: [
    {
      id: "vault",
      type: "recall",
      payload: {
        items: [{ id: "vault:keys", cue: "Where are the keys?", answers: ["In the drawer"] }],
      },
    },
    { id: "path", type: "sequence-recall", payload: { tiles: 9, sequence: [4, 0, 7] } },
  ],
};

let root: Root | undefined;
let session: LearnPlayerSession | undefined;
let renders = 0;

function Probe(props: { options: LearnPlayerOptions }) {
  session = useLearnPlayer(props.options);
  renders += 1;
  return null;
}

function render(options: Partial<LearnPlayerOptions> = {}) {
  const full = { content, types, profile: englishProfile, ...options };
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root?.render(<Probe options={full} />));
  return (next: Partial<LearnPlayerOptions>) =>
    act(() => root?.render(<Probe options={{ ...full, ...next }} />));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  renders = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  session = undefined;
});

describe("useLearnPlayer", () => {
  it("starts on the first exercise, with its state and place", () => {
    render();
    expect(session?.error).toBeNull();
    expect(session?.current).toMatchObject({
      position: 0,
      count: 2,
      status: "answering",
      exercise: { id: "vault", type: "recall" },
    });
    expect(session?.snapshot?.can).toMatchObject({ check: false, next: true });
  });

  it("follows the session as the learner answers, checks and moves on", () => {
    render();
    act(() => session?.player?.answer({ recalled: ["in the DRAWER"] }));
    expect(session?.current?.draft).toEqual({ recalled: ["in the DRAWER"] });
    act(() => session?.player?.check());
    expect(session?.current).toMatchObject({
      status: "checked",
      grade: { score: 1, max: 1, items: [true] },
    });
    act(() => session?.player?.next());
    expect(session?.current).toMatchObject({ position: 1, exercise: { type: "sequence-recall" } });
    act(() => session?.player?.answer({ taps: [4, 0, 2] }));
    act(() => session?.player?.check());
    expect(session?.current?.grade).toEqual({ score: 2, max: 3, items: [true, true, false] });
    expect(session?.snapshot?.summary).toEqual({ score: 3, max: 4, skipped: 0 });
  });

  it("records a recall item's review with a scheduler, and saves through the store", async () => {
    const progressStore = createMemoryProgressStore();
    const changes: ProgressChange[] = [];
    render({
      progressStore,
      scope: "learner",
      scheduler: createFakeScheduler(),
      now: () => 1_000,
      onProgress: (change) => changes.push(change),
    });
    act(() => session?.player?.answer({ recalled: ["nowhere"] }));
    act(() => session?.player?.check());
    await act(() => session?.player?.settled());
    expect(changes.map((change) => change.kind)).toEqual(["attempt", "review"]);
    expect(changes[1]).toMatchObject({ itemId: "vault:keys", rating: "again" });
    expect((await progressStore.load("learner")).cards.map((card) => card.itemId)).toEqual([
      "vault:keys",
    ]);
  });

  it("keeps one session while only its callbacks change, and calls the latest", () => {
    const first = vi.fn();
    const second = vi.fn();
    const update = render({ onEvent: first });
    const player = session?.player;
    update({ onEvent: second });
    expect(session?.player).toBe(player);
    act(() => session?.player?.answer({ recalled: ["x"] }));
    act(() => session?.player?.check());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ type: "exercise_checked" }));
  });

  it("starts again from the first exercise on restart, disposing the old session", () => {
    render();
    const player = session?.player;
    const dispose = vi.spyOn(player as NonNullable<typeof player>, "dispose");
    act(() => session?.player?.next());
    act(() => session?.restart());
    expect(session?.player).not.toBe(player);
    expect(session?.current?.position).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("gives the error, and no session, for content it can't read", () => {
    render({ content: { format: "hm-learn-content", version: 2, exercises: [] } });
    expect(session?.player).toBeNull();
    expect(session?.snapshot).toBeNull();
    expect(session?.current).toBeNull();
    expect(session?.error).toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  it("disposes the session when the component goes", () => {
    render();
    const player = session?.player as NonNullable<LearnPlayerSession["player"]>;
    const dispose = vi.spyOn(player, "dispose");
    act(() => root?.unmount());
    root = undefined;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("returns the very same object when it renders again with nothing changed", () => {
    const options = { content, types };
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => root?.render(<Probe options={options} />));
    const before = session;
    act(() => root?.render(<Probe options={options} />));
    expect(renders).toBe(2);
    expect(session).toBe(before);
  });
});
