import { asLearnError, throwIfAborted } from "../../core/errors/error-helpers.js";
import { isLearnError, LearnError } from "../../core/errors/learn-error.js";
import { type LearnLimitOverrides, learnLimits } from "../../core/errors/learn-limits.js";
import { utf8Size } from "../../core/model/documents.js";
import { cloneData } from "../../core/model/engine.js";
import { parseProgress } from "../../core/model/parse-progress.js";
import {
  applyProgressChanges,
  emptyProgress,
  type ProgressSnapshot,
  toProgressDocument,
} from "../../core/model/progress.js";
import type { LearnCallOptions } from "../../core/ports/options.js";
import type { ProgressStore } from "../../core/ports/progress-store.js";
import type { ProgressDiscardReason } from "../local-progress/local-progress.js";

/** The storage layout's version, in every key, shared with the `localStorage` adapter. */
const KEY_PREFIX = "hm-learn:v1:";

/**
 * A key-value storage that answers with promises: the part of React
 * Native's AsyncStorage the adapter uses, so the SDK depends on no storage
 * package. Anything of this shape works, such as a wrapper around a secure
 * store or IndexedDB.
 *
 * @public
 */
export interface AsyncProgressStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Options for {@link createAsyncProgressStore}.
 *
 * @public
 */
export interface AsyncProgressStoreOptions {
  /** Your app's key prefix, such as your app's name, so its progress never mixes with anything else in the same storage. */
  readonly namespace: string;
  /** Where to store, such as `AsyncStorage` from `@react-native-async-storage/async-storage`. */
  readonly storage: AsyncProgressStorage;
  /** The host's limit settings; `maxContentSize` bounds each stored scope. */
  readonly limits?: LearnLimitOverrides;
  /** Called when stored progress is discarded on load, with only the reason, never the data. */
  readonly onDiscard?: (reason: ProgressDiscardReason) => void;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * A {@link ProgressStore} that keeps progress in a storage the host passes
 * in, which answers with promises, as React Native's AsyncStorage does: the
 * way to keep progress on a phone (ADR 0010). Opt-in, like the
 * `localStorage` adapter, and it behaves the same:
 *
 * - **Keys** are namespaced and versioned: `hm-learn:v1:<namespace>:<scope>`.
 *   Choose scopes per learner, and call `clear(scope)` when one signs out.
 * - **What it reads back is untrusted:** each value is an `hm-learn-progress`
 *   document, read with {@link parseProgress}. Anything wrong discards that
 *   scope's progress, calls `onDiscard` with the reason, and loads empty,
 *   without throwing.
 * - **Saving** refuses progress larger than `maxContentSize` with
 *   `CONTENT_TOO_LARGE`, so it can always be read back. A storage that
 *   rejects is `STORAGE_UNAVAILABLE`, with its failure as the cause.
 * - **Saves to one scope take turns,** each reading what the one before it
 *   wrote, so two that overlap never lose a change. A save or a clear whose
 *   `signal` aborts while it waits its turn changes nothing.
 * - **Not encrypted,** unless the storage you pass is.
 *
 * @example
 * ```ts
 * import AsyncStorage from "@react-native-async-storage/async-storage";
 *
 * const progressStore = createAsyncProgressStore({ namespace: "my-app", storage: AsyncStorage });
 * const progress = await progressStore.load(`learner-${id}`);
 * ```
 *
 * @param options - The namespace and the storage, and optionally limits and a discard callback.
 * @throws `TypeError` for an empty namespace, or a storage without the three methods.
 * @public
 */
export function createAsyncProgressStore(options: AsyncProgressStoreOptions): ProgressStore {
  if (!isText(options.namespace)) {
    throw new TypeError("An async progress store needs a namespace.");
  }
  const { storage } = options;
  if (
    typeof storage?.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    throw new TypeError(
      "An async progress store needs a storage with getItem, setItem and removeItem.",
    );
  }
  const policy = learnLimits.resolve(options.limits);
  const keyFor = (scope: string) => {
    if (!isText(scope)) {
      throw new TypeError("A progress scope must be a non-empty string.");
    }
    return `${KEY_PREFIX}${encodeURIComponent(options.namespace)}:${encodeURIComponent(scope)}`;
  };
  /** Runs a storage call, with any failure of the storage as `STORAGE_UNAVAILABLE`. */
  const call = async <Result>(run: () => Promise<Result>): Promise<Result> => {
    try {
      return await run();
    } catch (error) {
      throw new LearnError("STORAGE_UNAVAILABLE", "The device's storage refused the operation.", {
        cause: asLearnError(error),
      });
    }
  };
  const read = async (key: string): Promise<ProgressSnapshot> => {
    const text: unknown = await call(() => storage.getItem(key));
    if (text === null || text === undefined) {
      return emptyProgress;
    }
    try {
      return parseProgress(text, options.limits ? { limits: options.limits } : {});
    } catch (error) {
      if (isLearnError(error)) {
        options.onDiscard?.(error.code === "CONTENT_TOO_LARGE" ? "too-large" : "invalid");
        return emptyProgress;
      }
      throw error;
    }
  };
  /** The last write to each key, so the next one waits for it. */
  const writes = new Map<string, Promise<void>>();
  const inTurn = (key: string, write: () => Promise<void>): Promise<void> => {
    // A write that failed doesn't hold up the ones after it.
    const turn = (writes.get(key) ?? Promise.resolve()).then(write, write);
    const settled = turn.then(
      () => undefined,
      () => undefined,
    );
    writes.set(key, settled);
    void settled.then(() => {
      if (writes.get(key) === settled) {
        writes.delete(key);
      }
    });
    return turn;
  };
  const checked = async <Result>(
    { signal }: LearnCallOptions,
    run: () => Promise<Result>,
  ): Promise<Result> => {
    throwIfAborted(signal);
    const result = await run();
    throwIfAborted(signal);
    return result;
  };
  return {
    load(scope, callOptions = {}) {
      return checked(callOptions, async () => cloneData(await read(keyFor(scope))));
    },
    save(scope, changes, callOptions = {}) {
      return checked(callOptions, async () => {
        const key = keyFor(scope);
        // Copied now: the caller may change its list while this waits its turn.
        const pending = cloneData(changes);
        await inTurn(key, async () => {
          // Checked again when its turn comes, and before the write: a save
          // aborted while it waited or read changes nothing.
          throwIfAborted(callOptions.signal);
          const next = applyProgressChanges(await read(key), pending);
          const text = JSON.stringify(toProgressDocument(next));
          policy.check("maxContentSize", utf8Size(text, policy.limits.maxContentSize.maximum));
          throwIfAborted(callOptions.signal);
          await call(() => storage.setItem(key, text));
        });
      });
    },
    clear(scope, callOptions = {}) {
      return checked(callOptions, async () => {
        const key = keyFor(scope);
        await inTurn(key, async () => {
          // A clear aborted while it waited its turn removes nothing.
          throwIfAborted(callOptions.signal);
          await call(() => storage.removeItem(key));
        });
      });
    },
  };
}
