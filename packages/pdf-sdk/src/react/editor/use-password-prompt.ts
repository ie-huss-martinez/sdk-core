import { useCallback, useEffect, useRef, useState } from "react";
import { isPdfError, type PdfError } from "../../core/errors/pdf-error.js";

/** Opens or inserts a file, with the password the person gave, once they have. */
type Run = (password?: string) => Promise<void>;

interface Attempt {
  readonly run: Run;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  /** Runs once the file opened with a password the person typed. */
  readonly onUnlocked: (() => void) | undefined;
  /** Why the file is still closed: the session's `PASSWORD_REQUIRED`. */
  error?: PdfError;
}

/** What the password dialog shows. */
export interface PasswordPromptState {
  /** Whether the dialog is open: the file needs a password the person hasn't given yet. */
  readonly asking: boolean;
  /** Whether the password just given is being tried. */
  readonly checking: boolean;
  /**
   * The failure to show at the field: a password that didn't open the file.
   * A new object each time, so a second wrong password is said again.
   */
  readonly incorrect: PdfError | undefined;
}

const CLOSED: PasswordPromptState = { asking: false, checking: false, incorrect: undefined };

/**
 * Asks for a file's password when opening or inserting it fails with
 * `PASSWORD_REQUIRED`, and tries again with what the person types, as often
 * as it's wrong (docs/adr/0013).
 *
 * `run(work)` calls `work()`. Its promise settles once the file has opened,
 * after a prompt or without one, or failed for good: for another reason, or
 * because the person cancelled, which rejects with the `PASSWORD_REQUIRED`
 * error. A newer `run` replaces one that's still asking.
 *
 * The password is never state: it goes from the field to `work` and nowhere
 * else, so it isn't in a render, a snapshot or React's developer tools.
 */
export function usePasswordPrompt(): PasswordPromptState & {
  /**
   * Whether an attempt is under way, asking or not: its `PASSWORD_REQUIRED`
   * failure is the dialog's to show, not the editor's alert.
   */
  readonly pending: boolean;
  readonly run: (work: Run, onUnlocked?: () => void) => Promise<void>;
  readonly submit: (password: string) => void;
  readonly cancel: () => void;
} {
  const [state, setState] = useState<(PasswordPromptState & { readonly pending: boolean }) | null>(
    null,
  );
  const current = useRef<Attempt | null>(null);

  const attemptWith = useCallback(async (attempt: Attempt, password?: string) => {
    try {
      await attempt.run(password);
    } catch (error) {
      if (current.current === attempt && isPdfError(error, "PASSWORD_REQUIRED")) {
        attempt.error = error;
        setState({
          pending: true,
          asking: true,
          checking: false,
          incorrect: error.details?.["reason"] === "incorrect-password" ? error : undefined,
        });
        return;
      }
      if (current.current === attempt) {
        current.current = null;
        setState(null);
      }
      attempt.reject(error);
      return;
    }
    if (current.current === attempt) {
      current.current = null;
      if (password !== undefined) attempt.onUnlocked?.();
      setState(null);
    }
    attempt.resolve();
  }, []);

  /** Ends an attempt that's waiting for a password, as a failure. */
  const abandon = useCallback(() => {
    const attempt = current.current;
    current.current = null;
    // Only one that's asking is waiting; one that's running settles itself.
    if (attempt?.error) attempt.reject(attempt.error);
  }, []);

  const run = useCallback(
    (work: Run, onUnlocked?: () => void) =>
      new Promise<void>((resolve, reject) => {
        abandon();
        const attempt: Attempt = { run: work, resolve, reject, onUnlocked };
        current.current = attempt;
        setState({ pending: true, ...CLOSED });
        void attemptWith(attempt);
      }),
    [abandon, attemptWith],
  );

  const submit = useCallback(
    (password: string) => {
      const attempt = current.current;
      if (!attempt?.error || password === "") return;
      delete attempt.error;
      setState({ pending: true, asking: true, checking: true, incorrect: undefined });
      void attemptWith(attempt, password);
    },
    [attemptWith],
  );

  const cancel = useCallback(() => {
    if (!current.current?.error) return;
    abandon();
    setState(null);
  }, [abandon]);

  // An editor that unmounts leaves no promise waiting.
  useEffect(() => abandon, [abandon]);

  return { ...(state ?? { pending: false, ...CLOSED }), run, submit, cancel };
}
