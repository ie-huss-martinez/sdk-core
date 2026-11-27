import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInBareRealm } from "@hussmartinez/sdk-config/testing/bare-realm";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFsrsScheduler } from "./src/index.js";

/**
 * The built package where React Native runs it (ADR 0010, sdk-core ADR
 * 0069): on Hermes, which has no DOM, and where `Intl`,
 * `String.prototype.normalize`, `structuredClone`, `Blob`, `TextEncoder`
 * and `crypto` can't be counted on.
 *
 * Each entry runs through sdk-config's `runInBareRealm`: bundled whole, as
 * Metro would bundle it, with ts-fsrs and sdk-core inside, in a realm that
 * has the ECMAScript language and nothing else. That's less than Hermes
 * has, so what runs here runs there.
 */

// Inside the package, so the built files resolve their dependencies.
const directory = new URL("temp/native-check/", import.meta.url);
/**
 * What the core takes from React Native itself, which sets it up beside
 * Hermes: `AbortController`, for the player's saves. Nothing else.
 */
const FROM_REACT_NATIVE = ["AbortController", "AbortSignal"];
const inBareRealm = (entry: string, probe: string): Promise<unknown> =>
  runInBareRealm({
    entry: fileURLToPath(new URL(entry, directory)),
    probe,
    provided: FROM_REACT_NATIVE,
  });

const CONTENT = {
  format: "hm-learn-content",
  version: 1,
  exercises: [
    {
      id: "vault",
      type: "recall",
      payload: {
        items: [{ id: "vault:keys", cue: "¿Dónde están las llaves?", answers: ["En el cajón"] }],
      },
    },
    { id: "path", type: "sequence-recall", payload: { tiles: 9, sequence: [4, 0, 7] } },
    {
      id: "gap",
      type: "gap-fill",
      payload: { items: [{ sentence: "Yo ___ pan", answers: ["como"] }] },
    },
  ],
};
/** 2026-01-01T00:00:00Z, and a day, in milliseconds. */
const T = 1_767_225_600_000;
const DAY = 86_400_000;

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const config of ["vite.config.ts", "vite.native.config.ts"]) {
    await build({
      configFile: fileURLToPath(new URL(config, import.meta.url)),
      logLevel: "silent",
      build: { outDir: fileURLToPath(directory), emptyOutDir: false },
    });
  }
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

// Two Vite builds and a bundle per test: a few seconds alone, and several
// times that beside other suites.
describe("the built package on Hermes", { timeout: 60_000 }, () => {
  it("reads content and grades it, exactly and tolerantly, as Node does", async () => {
    const probe = `(sdk) => {
      const types = sdk.createExerciseTypes([sdk.recall, sdk.sequenceRecall, sdk.gapFill]);
      const content = sdk.parseContent(${JSON.stringify(JSON.stringify(CONTENT))}, { types });
      const [vault, path, gap] = content.exercises;
      const tolerant = sdk.createExerciseTypes([sdk.createRecallType({ tolerance: sdk.DEFAULT_MATCH_DISTANCE })]);
      return {
        exact: sdk.gradeAnswer(vault, { recalled: ["en el CAJON"] }, { types, profile: sdk.spanishProfile }),
        tolerant: sdk.gradeAnswer(vault, { recalled: ["creo que en los cajones"] }, { types: tolerant, profile: sdk.spanishProfile }),
        path: sdk.gradeAnswer(path, { taps: [4, 0, 2] }, { types }),
        gap: sdk.gradeAnswer(gap, { filled: ["como"] }, { types }),
        arabic: sdk.normalizeForGrading("\\u0623\\u064E\\u062D\\u0652\\u0645\\u064E\\u062F", sdk.arabicProfile),
        match: sdk.matchTolerantly("aple", ["apple"]),
      };
    }`;
    expect(await inBareRealm("index.js", probe)).toEqual({
      exact: { score: 1, max: 1, items: [true] },
      tolerant: { score: 1, max: 1, items: [true] },
      path: { score: 2, max: 3, items: [true, true, false] },
      gap: { score: 1, max: 1, items: [true] },
      arabic: "احمد",
      match: { match: true, distance: 0.2 },
    });
  });

  it("runs ts-fsrs's FSRS-7 there, to the same schedule as in Node", async () => {
    const reviews = [
      ["good", T + DAY],
      ["again", T + 4 * DAY],
      ["easy", T + 5 * DAY],
    ] as const;
    const probe = `(sdk) => {
      const scheduler = sdk.createFsrsScheduler();
      let step = scheduler.initial(${T});
      const steps = [step];
      for (const [rating, at] of ${JSON.stringify(reviews)}) {
        step = scheduler.review(step.state, rating, at);
        steps.push(step);
      }
      return steps;
    }`;
    const scheduler = createFsrsScheduler();
    let step = scheduler.initial(T);
    const expected = [step];
    for (const [rating, at] of reviews) {
      step = scheduler.review(step.state, rating, at);
      expected.push(step);
    }
    // Exactly, not within a tolerance: the same arithmetic, in the same engine.
    expect(await inBareRealm("index.js", probe)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("plays a session with a scheduler, and keeps its progress in an async storage", async () => {
    const probe = `async (sdk) => {
      const values = new Map();
      const storage = {
        getItem: async (key) => values.get(key) ?? null,
        setItem: async (key, value) => void values.set(key, value),
        removeItem: async (key) => void values.delete(key),
      };
      const progressStore = sdk.createAsyncProgressStore({ namespace: "app", storage });
      const events = [];
      const player = sdk.createLearnPlayer({
        content: ${JSON.stringify(CONTENT)},
        types: sdk.createExerciseTypes([sdk.recall, sdk.sequenceRecall, sdk.gapFill]),
        profile: sdk.spanishProfile,
        progressStore,
        scope: "learner",
        scheduler: sdk.createFsrsScheduler(),
        now: () => ${T},
        onEvent: (event) => events.push(event.type),
        onError: (error) => events.push(error.code),
      });
      player.answer({ recalled: ["en el cajon"] });
      player.check();
      await player.settled();
      const progress = await progressStore.load("learner");
      const due = sdk.dueItems(progress, ${T + 30 * DAY});
      const memory = sdk.createMemoryProgressStore();
      await memory.save("s", [{ kind: "attempt", exerciseId: "e", answer: { a: [1] }, grade: { score: 1, max: 1, items: [true] }, at: 1 }]);
      return {
        events,
        grade: player.getSnapshot().exercises[0].grade,
        keys: [...values.keys()],
        cards: progress.cards.map((card) => [card.itemId, card.scheduling.model]),
        due: due.map((card) => card.itemId),
        dueNow: sdk.dueItems(progress, ${T}).length,
        memory: (await memory.load("s")).attempts.length,
      };
    }`;
    expect(await inBareRealm("index.js", probe)).toEqual({
      events: ["exercise_checked"],
      grade: { score: 1, max: 1, items: [true] },
      keys: ["hm-learn:v1:app:learner"],
      cards: [["vault:keys", "FSRS-7"]],
      due: ["vault:keys"],
      dueNow: 0,
      memory: 1,
    });
  });

  it("says which feature is missing where something needs more than the realm has", async () => {
    const probe = `async (sdk) => {
      const feature = async (run) => {
        try {
          await run();
        } catch (error) {
          return [error.code, error.details && error.details.feature];
        }
        return "no error";
      };
      const types = sdk.createExerciseTypes([sdk.gapFill]);
      const editor = sdk.createLearnEditor({ types });
      return {
        clip: await feature(() => sdk.loadClip({ load: async () => null }, "ref")),
        localStore: await feature(() => sdk.createLocalProgressStore({ namespace: "app" }).load("s")),
        command: await feature(() => sdk.applyLearnCommand({ format: "hm-learn-content", version: 1, exercises: [] }, { type: "learn.removeExercise", exerciseId: "x" }, { types })),
        newId: await feature(() => editor.newExerciseId()),
        ownId: sdk.createLearnEditor({ types, newId: () => "mine" }).newExerciseId(),
      };
    }`;
    expect(await inBareRealm("index.js", probe)).toEqual({
      clip: ["UNSUPPORTED_ENVIRONMENT", "Blob"],
      localStore: ["UNSUPPORTED_ENVIRONMENT", "localStorage"],
      command: ["UNSUPPORTED_ENVIRONMENT", "structuredClone"],
      newId: ["UNSUPPORTED_ENVIRONMENT", "crypto.getRandomValues"],
      ownId: "mine",
    });
  });

  it("loads the native entry's hooks there, from the one copy of the core", async () => {
    expect(
      await inBareRealm(
        "native.js",
        "(native) => [typeof native.useLearnPlayer, typeof native.usePlayerSnapshot]",
      ),
    ).toEqual(["function", "function"]);
    const code = await readFile(new URL("native.js", directory), "utf8");
    const imported = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map(([, name]) => name);
    // React, and the built core beside it: no second copy of the session,
    // no React Native, no DOM entry.
    expect(imported.sort()).toEqual(["./index.js", "react"]);
  });
});
