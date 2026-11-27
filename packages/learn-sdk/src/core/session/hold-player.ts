import type { LearnPlayer } from "./player.js";

/** A session, or why there's none. One object for as long as neither changes. */
export interface HeldPlayer {
  readonly player: LearnPlayer | null;
  /** What making the player threw, such as a `LearnError` for content that can't be read. */
  readonly error: unknown;
}

/**
 * Keeps a player alive for as long as something listens to it, and never
 * hands out a disposed one: how a React component holds a session (ADR
 * 0010).
 *
 * A player made while rendering and disposed in an effect's cleanup breaks
 * when React runs effects twice, as `StrictMode` does in development: the
 * cleanup disposes the player, the second setup keeps it, and a disposed
 * player shows grades and saves nothing. Here the player belongs to the
 * subscription instead, which `useSyncExternalStore` takes. When the last
 * listener goes it's disposed and forgotten, and the next listener, or the
 * next read, gets a new one.
 *
 * @param make - Creates the player. It's called again after a disposal.
 * @internal
 */
export function holdPlayer(make: () => LearnPlayer): {
  /** The session now, made if there's none. The same object until it changes. */
  readonly current: () => HeldPlayer;
  readonly subscribe: (listener: () => void) => () => void;
} {
  let held: HeldPlayer | undefined;
  let listeners = 0;
  const current = (): HeldPlayer => {
    if (!held) {
      try {
        held = { player: make(), error: null };
      } catch (error) {
        held = { player: null, error };
      }
    }
    return held;
  };
  return {
    current,
    subscribe(listener) {
      const { player } = current();
      listeners += 1;
      const unsubscribe = player?.subscribe(listener);
      return () => {
        unsubscribe?.();
        listeners -= 1;
        if (listeners === 0 && held?.player === player) {
          player?.dispose();
          // Content that couldn't be read stays an error: it won't read better again.
          held = player ? undefined : held;
        }
      };
    },
  };
}
