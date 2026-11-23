/**
 * A recording in progress.
 *
 * @public
 */
export interface NotesRecorderSession {
  /** When it started, in milliseconds since the Unix epoch. */
  readonly startedAt: number;
  /** Milliseconds recorded so far. */
  elapsed(): number;
  /** Ends the recording and resolves to its sound and length. */
  stop(): Promise<{ readonly audio: Blob; readonly duration: number }>;
  /** Ends the recording and discards it. */
  cancel(): void;
}

/**
 * What records sound alongside the ink (sdk-core ADR 0008). The SDK's own,
 * `createMediaNotesRecorder`, uses the browser's microphone and
 * `MediaRecorder`. Failures reject with `NotesError("RECORDING_FAILED")`.
 *
 * @public
 */
export interface NotesRecorder {
  /** Whether this browser can record at all. */
  readonly supported: boolean;
  /** Asks for the microphone and starts recording. */
  start(): Promise<NotesRecorderSession>;
}
