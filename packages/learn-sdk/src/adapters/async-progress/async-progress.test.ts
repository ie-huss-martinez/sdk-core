import { describe, expect, it } from "vitest";
import type { ProgressChange } from "../../core/model/progress.js";
import { PROGRESS_FORMAT } from "../../core/model/progress.js";
import type { ContractTestApi } from "../../testing/contract.js";
import { defineProgressStoreContract } from "../../testing/progress-store-contract.js";
import { type AsyncProgressStorage, createAsyncProgressStore } from "./async-progress.js";

/** AsyncStorage's shape over a map, answering a moment later, as a real one does. */
function memoryStorage(delay = 0) {
  const values = new Map<string, string>();
  const later = <Value>(value: () => Value): Promise<Value> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(value());
        } catch (error) {
          reject(error);
        }
      }, delay),
    );
  const storage: AsyncProgressStorage = {
    getItem: (key) => later(() => values.get(key) ?? null),
    setItem: (key, value) => later(() => void values.set(key, value)),
    removeItem: (key) => later(() => void values.delete(key)),
  };
  return { storage, values };
}

const attempt = (exerciseId: string, at: number): ProgressChange => ({
  kind: "attempt",
  exerciseId,
  answer: { recalled: ["x"] },
  grade: { score: 1, max: 1, items: [true] },
  at,
});

describe("createAsyncProgressStore", () => {
  it("passes the progress store contract", async () => {
    const tests: [string, () => Promise<void>][] = [];
    const api: ContractTestApi = {
      describe: (_name, body) => body(),
      it: (name, body) => void tests.push([name, body]),
    };
    defineProgressStoreContract(
      "async",
      () => createAsyncProgressStore({ namespace: "app", storage: memoryStorage().storage }),
      api,
    );
    expect(tests.length).toBeGreaterThan(4);
    for (const [name, body] of tests) {
      await expect(body(), name).resolves.toBeUndefined();
    }
  });

  it("stores an hm-learn-progress document under a namespaced, versioned key", async () => {
    const { storage, values } = memoryStorage();
    const store = createAsyncProgressStore({ namespace: "my app", storage });
    await store.save("learner/1", [attempt("a", 1)]);
    expect([...values.keys()]).toEqual(["hm-learn:v1:my%20app:learner%2F1"]);
    expect(JSON.parse([...values.values()][0] as string)).toMatchObject({
      format: PROGRESS_FORMAT,
      version: 1,
      attempts: [{ exerciseId: "a" }],
    });
  });

  it("loses no change when saves to one scope overlap", async () => {
    const store = createAsyncProgressStore({ namespace: "app", storage: memoryStorage(2).storage });
    await Promise.all([1, 2, 3, 4, 5].map((at) => store.save("s", [attempt(`e${at}`, at)])));
    const { attempts } = await store.load("s");
    expect(attempts.map((saved) => saved.exerciseId)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("copies the changes it's given before it waits its turn", async () => {
    const store = createAsyncProgressStore({ namespace: "app", storage: memoryStorage(2).storage });
    const changes = [attempt("first", 1)];
    const saved = store.save("s", changes);
    changes.push(attempt("added later", 2));
    await saved;
    expect((await store.load("s")).attempts).toHaveLength(1);
  });

  it("discards what it can't read, saying only why, and loads empty", async () => {
    const { storage, values } = memoryStorage();
    const reasons: string[] = [];
    const store = createAsyncProgressStore({
      namespace: "app",
      storage,
      limits: { maxContentSize: 200 },
      onDiscard: (reason) => reasons.push(reason),
    });
    values.set("hm-learn:v1:app:broken", "{not json");
    values.set("hm-learn:v1:app:huge", JSON.stringify({ padding: "x".repeat(500) }));
    expect(await store.load("broken")).toEqual({ attempts: [], cards: [] });
    expect(await store.load("huge")).toEqual({ attempts: [], cards: [] });
    expect(reasons).toEqual(["invalid", "too-large"]);
  });

  it("refuses to save more than it could read back", async () => {
    const store = createAsyncProgressStore({
      namespace: "app",
      storage: memoryStorage().storage,
      limits: { maxContentSize: 200 },
    });
    await expect(store.save("s", [attempt("a".repeat(300), 1)])).rejects.toMatchObject({
      code: "CONTENT_TOO_LARGE",
    });
    // The failed save doesn't hold up the next one.
    await expect(store.save("s", [attempt("b", 2)])).resolves.toBeUndefined();
  });

  it("reports a storage that rejects as STORAGE_UNAVAILABLE, with its failure as the cause", async () => {
    const failing: AsyncProgressStorage = {
      getItem: () => Promise.reject(new Error("disk full")),
      setItem: () => Promise.reject(new Error("disk full")),
      removeItem: () => Promise.reject(new Error("disk full")),
    };
    const store = createAsyncProgressStore({ namespace: "app", storage: failing });
    for (const run of [() => store.load("s"), () => store.save("s", []), () => store.clear("s")]) {
      await expect(run()).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
        cause: { code: "UNKNOWN" },
      });
    }
  });

  it("changes nothing when a queued save or clear is aborted before its turn", async () => {
    const { storage, values } = memoryStorage(5);
    const store = createAsyncProgressStore({ namespace: "app", storage });
    await store.save("s", [attempt("kept", 1)]);
    // Both wait behind a save that's still writing.
    const busy = store.save("s", [attempt("also kept", 2)]);
    const stopClear = new AbortController();
    const stopSave = new AbortController();
    const cleared = store.clear("s", { signal: stopClear.signal });
    const saved = store.save("s", [attempt("never written", 3)], { signal: stopSave.signal });
    stopClear.abort();
    stopSave.abort();
    await busy;
    await expect(cleared).rejects.toMatchObject({ code: "ABORTED" });
    await expect(saved).rejects.toMatchObject({ code: "ABORTED" });
    expect(values.size).toBe(1);
    expect((await store.load("s")).attempts.map((kept) => kept.exerciseId)).toEqual([
      "kept",
      "also kept",
    ]);
  });

  it("needs a namespace, a scope and a storage of the right shape", async () => {
    const { storage } = memoryStorage();
    expect(() => createAsyncProgressStore({ namespace: "", storage })).toThrow(TypeError);
    expect(() => createAsyncProgressStore({ namespace: "app", storage: {} as never })).toThrow(
      TypeError,
    );
    const store = createAsyncProgressStore({ namespace: "app", storage });
    await expect(store.load("")).rejects.toThrow(TypeError);
  });
});
