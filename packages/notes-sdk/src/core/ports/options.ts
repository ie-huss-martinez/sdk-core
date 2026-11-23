/**
 * Options every asynchronous call takes.
 *
 * @public
 */
export interface NotesCallOptions {
  /** Cancels the call, which then rejects with `ABORTED`. */
  readonly signal?: AbortSignal;
}

/**
 * Progress of a long operation: the fraction done, from 0 to 1.
 *
 * @public
 */
export interface NotesProgress {
  readonly fraction: number;
}

/**
 * Options of a long operation that reports progress.
 *
 * @public
 */
export interface NotesProgressOptions extends NotesCallOptions {
  readonly onProgress?: (progress: NotesProgress) => void;
}
