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

/** What a text input needs from {@link useCommittedText}. */
export interface CommittedTextProps {
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
 * one-line field, after a pause, or when the editor flushes. Nothing commits
 * while an input method is composing; a pause that ends mid-composition
 * commits when the composition ends.
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
      pending.current = null;
      pausedWhileComposing.current = false;
      if (value === null) return;
      latestCommit.current(value);
      setTyped(null);
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
    value: typed ?? committed,
    onChange: (event) => {
      const value = event.currentTarget.value;
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
