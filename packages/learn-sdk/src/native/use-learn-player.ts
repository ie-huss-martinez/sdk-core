import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
// From the core entry itself, which the build leaves as an import: an
// application then runs one copy of the session's code, not this entry's own.
import {
  createLearnPlayer,
  type Exercise,
  type LearnError,
  type LearnPlayer,
  type LearnPlayerEvent,
  type LearnPlayerOptions,
  type LearnPlayerSnapshot,
  type PlayerExerciseState,
  type ProgressChange,
} from "../index.js";

const subscribeNothing = () => () => {};

/**
 * A player's snapshot, kept current as the session changes, or `null` while
 * there's no session.
 *
 * @example
 * ```tsx
 * const snapshot = usePlayerSnapshot(player);
 * ```
 *
 * @public
 */
export function usePlayerSnapshot(player: LearnPlayer | null): LearnPlayerSnapshot | null {
  return useSyncExternalStore(
    player ? player.subscribe : subscribeNothing,
    () => player?.getSnapshot() ?? null,
    () => player?.getSnapshot() ?? null,
  );
}

/**
 * The exercise a player is on, with the learner's state in it.
 *
 * @public
 */
export interface CurrentExercise extends PlayerExerciseState {
  readonly exercise: Exercise;
  /** Its position, from 0, of `count`. */
  readonly position: number;
  /** How many exercises the content has. */
  readonly count: number;
}

/**
 * What {@link useLearnPlayer} returns.
 *
 * @public
 */
export interface LearnPlayerSession {
  /** The session, with its actions: `answer`, `check`, `next` and the rest. `null` when the content couldn't be read. */
  readonly player: LearnPlayer | null;
  /** The session's state, kept current. `null` with no session. */
  readonly snapshot: LearnPlayerSnapshot | null;
  /** The exercise the learner is on. `null` with no session, or no exercises. */
  readonly current: CurrentExercise | null;
  /** Why there's no session: what reading the content threw, such as a `LearnError` with `INVALID_DOCUMENT`. `null` otherwise. */
  readonly error: unknown;
  /** Starts the same content again, in a new session. */
  readonly restart: () => void;
}

/** The latest value, for a callback that must not restart the session when it changes (sdk-core ADR 0063). */
function useLatest<Value>(value: Value): { readonly current: Value } {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A learn-sdk player session for a component to draw: the headless player,
 * created once for its content and settings and disposed with the
 * component, with its state kept current (ADR 0010). It renders nothing and
 * has no text: draw the current exercise with your own views, and call the
 * player's actions.
 *
 * The session is created again when `content`, `types`, `profile`,
 * `progressStore`, `scope`, `scheduler` or `limits` changes, so keep those
 * the same between renders: content parsed once, and stores made outside
 * the component or with `useMemo`. `onProgress`, `onEvent` and `onError`
 * may change freely.
 *
 * @example
 * ```tsx
 * const { player, current, snapshot, error } = useLearnPlayer({ content, types, profile, progressStore, scope });
 * if (!player || !current) return <Problem error={error} />;
 * const payload = current.exercise.payload as RecallPayload;
 * return (
 *   <ChoiceList
 *     choices={payload.items[0].choices.map((choice) => ({ key: choice, label: choice }))}
 *     onValueChange={(choice) => {
 *       player.answer({ recalled: [choice] });
 *       player.check();
 *     }}
 *   />
 * );
 * ```
 *
 * @param options - What `createLearnPlayer` takes.
 * @public
 */
export function useLearnPlayer(options: LearnPlayerOptions): LearnPlayerSession {
  const { content, types, profile, progressStore, scope, scheduler, limits, now } = options;
  const latest = useLatest(options);
  const onProgress = useCallback(
    (change: ProgressChange) => latest.current.onProgress?.(change),
    [latest],
  );
  const onEvent = useCallback(
    (event: LearnPlayerEvent) => latest.current.onEvent?.(event),
    [latest],
  );
  const onError = useCallback((error: LearnError) => latest.current.onError?.(error), [latest]);
  const [run, setRun] = useState(0);
  const restart = useCallback(() => setRun((count) => count + 1), []);

  const session = useMemo((): { player: LearnPlayer | null; error: unknown } => {
    // `run` only counts restarts: reading it here is what starts a new session.
    void run;
    try {
      const player = createLearnPlayer({
        content,
        types,
        ...(profile ? { profile } : {}),
        ...(progressStore ? { progressStore } : {}),
        ...(scope === undefined ? {} : { scope }),
        ...(scheduler ? { scheduler } : {}),
        ...(limits ? { limits } : {}),
        ...(now ? { now } : {}),
        onProgress,
        onEvent,
        onError,
      });
      return { player, error: null };
    } catch (error) {
      return { player: null, error };
    }
  }, [
    content,
    types,
    profile,
    progressStore,
    scope,
    scheduler,
    limits,
    now,
    onProgress,
    onEvent,
    onError,
    run,
  ]);
  useEffect(() => () => session.player?.dispose(), [session]);

  const snapshot = usePlayerSnapshot(session.player);
  const current = useMemo((): CurrentExercise | null => {
    const exercise = snapshot?.content.exercises[snapshot.position];
    const state = snapshot?.exercises[snapshot.position];
    return snapshot && exercise && state
      ? { ...state, exercise, position: snapshot.position, count: snapshot.exercises.length }
      : null;
  }, [snapshot]);
  return useMemo(
    () => ({ ...session, snapshot, current, restart }),
    [session, snapshot, current, restart],
  );
}
