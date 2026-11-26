import { useLatest } from "@hussmartinez/ui/react";
import {
  type ChangeEvent,
  type CompositionEvent,
  createContext,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isLearnError } from "../../core/errors/learn-error.js";

/** How long typing pauses before it's committed as one edit (ADR 0008). */
export const COMMIT_PAUSE_MS = 700;

/**
 * The editor's fields that hold uncommitted typing. Undo, redo, structural
 * edits, `flush()` and `getContent()` commit them first (ADR 0008).
 */
export interface PendingText {
  /** Adds a field's commit, and returns how to remove it. */
  register(flush: () => void): () => void;
  /** Commits every field's pending typing, in no particular order. */
  flush(): void;
}

/** A registry of pending text, one per editor. */
export function createPendingText(): PendingText {
  const fields = new Set<() => void>();
  return {
    register(flush) {
      fields.add(flush);
      return () => {
        fields.delete(flush);
      };
    },
    flush() {
      for (const flush of [...fields]) flush();
    },
  };
}

/** @internal */
export const PendingTextContext = /* @__PURE__ */ createContext<PendingText | null>(null);

/** What a text input needs from {@link useCommittedText}, and why its last commit failed. */
export interface CommittedTextProps {
  /**
   * The error that refused the last commit, such as a text over
   * `maxTextLength`, until the next edit; null otherwise. Not an input
   * attribute: the field shows it as its problem.
   */
  readonly refused: unknown;
  readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onBlur: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  readonly onCompositionStart: () => void;
  readonly onCompositionEnd: (
    event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}

/**
 * A text field whose typing becomes one edit (ADR 0008): it shows what's
 * typed at once, and commits it when the field loses focus, on Enter in a
 * one-line field, after a pause, or when the editor flushes. A pause never
 * commits while an input method is composing: one that ends mid-composition
 * commits when the composition ends. A flush that can't wait does commit
 * what's there: the editor's `flush()` or `getContent()`, a structural edit,
 * leaving the field, or the field going away (ADR 0008).
 *
 * A commit the session refuses, such as a text over `maxTextLength`, isn't
 * applied: the field shows the draft's value again, and reports the error as
 * `refused` until the next edit. Nothing stays pending, so what the editor's
 * content holds is always what its fields show.
 *
 * `committed` is the value in the draft; `commit` turns a new value into a
 * command. Until the field has typing of its own, it shows `committed`, so
 * an undo shows at once.
 */
export function useCommittedText(
  committed: string,
  commit: (value: string) => void,
  options: { readonly multiline?: boolean } = {},
): CommittedTextProps {
  // Typing not yet committed, or null when the field shows the draft's value.
  const [typed, setTyped] = useState<string | null>(null);
  const [refused, setRefused] = useState<unknown>(null);
  // The same, for handlers and timers that run outside a render.
  const pending = useRef<string | null>(null);
  const composing = useRef(false);
  const pausedWhileComposing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest commit, taken as each render commits (sdk-core ADR 0063).
  const latestCommit = useLatest(commit);
  const pendingText = useContext(PendingTextContext);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Commits pending typing, unless an input method is composing it. */
  const flush = useCallback(
    (force = false) => {
      clearTimer();
      if (composing.current && !force) {
        pausedWhileComposing.current = true;
        return;
      }
      const value = pending.current;
      pausedWhileComposing.current = false;
      if (value === null) return;
      // Cleared before committing: a host whose onChange asks for the content
      // flushes again, and must find nothing left to commit.
      pending.current = null;
      setTyped(null);
      try {
        latestCommit.current(value);
        setRefused(null);
      } catch (error) {
        // A bug, not a refusal, still throws.
        if (!isLearnError(error)) throw error;
        // Not applied: the field shows the draft again, with the reason, and
        // nothing is thrown from a timer or a handler.
        setRefused(error);
      }
    },
    [clearTimer, latestCommit],
  );

  // The editor commits this field before undo, structural edits and saving;
  // and typing left when the field goes away is committed, not lost.
  useEffect(() => {
    const unregister = pendingText?.register(() => flush(true));
    return () => {
      unregister?.();
      flush(true);
    };
  }, [pendingText, flush]);

  return {
    refused,
    value: typed ?? committed,
    onChange: (event) => {
      const value = event.currentTarget.value;
      setRefused(null);
      pending.current = value;
      setTyped(value);
      clearTimer();
      timer.current = setTimeout(() => flush(), COMMIT_PAUSE_MS);
    },
    onBlur: () => flush(true),
    onKeyDown: (event) => {
      if (event.key === "Enter" && !options.multiline && !event.nativeEvent.isComposing) {
        flush();
      }
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event) => {
      composing.current = false;
      // The final text, which some browsers send only with compositionend.
      pending.current = event.currentTarget.value;
      setTyped(event.currentTarget.value);
      if (pausedWhileComposing.current) flush();
    },
  };
}
