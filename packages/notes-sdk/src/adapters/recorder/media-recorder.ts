import { NotesError } from "../../core/errors/notes-error.js";
import type { NotesRecorder, NotesRecorderSession } from "../../core/ports/notes-recorder.js";

/** The container types a recording may be stored as, in order of preference. */
const TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const;

/** A recorder's type without its parameters, if it's one a notebook stores. */
function storedType(mimeType: string): string | undefined {
  const base = mimeType.split(";")[0]?.trim().toLowerCase();
  return TYPES.find((type) => type === base);
}

const failed = (reason: "denied" | "unavailable", cause?: unknown) =>
  new NotesError("RECORDING_FAILED", "Sound couldn't be recorded.", {
    details: { reason },
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * Creates the notes SDK's recorder: the browser's microphone, through
 * `getUserMedia` and `MediaRecorder` (docs/adr/0007). The browser asks the
 * user for the microphone on the first recording. Nothing leaves the device:
 * the sound is handed to the notebook, which stores it beside the ink.
 *
 * A recording that ends by itself, because the microphone was unplugged or
 * the recorder failed, keeps what it had: `stop()` still resolves to it. The
 * microphone is let go when the recording ends, however it ends, and when it
 * can't start.
 *
 * @public
 */
export function createMediaNotesRecorder(): NotesRecorder {
  const supported = () =>
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  return {
    get supported() {
      return supported();
    },
    async start(): Promise<NotesRecorderSession> {
      if (!supported()) throw failed("unavailable");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        throw failed(
          name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable",
          error,
        );
      }
      const release = () => {
        for (const track of stream.getTracks()) track.stop();
      };
      const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch (error) {
        release();
        throw failed("unavailable", error);
      }
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      const clock = performance.now();
      /** When the recording ended, on the clock it started on. */
      let endedAt: number | undefined;
      /** What the recorder said went wrong, if anything did. */
      let failure: Event | undefined;
      let stopping = false;
      let discarded = false;
      const elapsed = () => Math.round((endedAt ?? performance.now()) - clock);

      // Listening from the start, not from `stop()`: the browser ends a
      // recording by itself when the microphone does, as when it's unplugged,
      // and what was recorded until then is kept for whoever asks.
      const recorded = new Promise<{ audio: Blob; duration: number }>((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener("error", (event) => {
          failure = event;
          // A browser that fails hands over what it gathered and stops. One that doesn't is stopped here.
          if (recorder.state !== "inactive") recorder.stop();
        });
        recorder.addEventListener("stop", () => {
          endedAt ??= performance.now();
          release();
          const type = storedType(recorder.mimeType) ?? storedType(chunks[0]?.type ?? "");
          if (discarded || !type || chunks.length === 0) {
            reject(failed("unavailable", failure));
            return;
          }
          resolve({ audio: new Blob(chunks, { type }), duration: elapsed() });
        });
      });
      // Nobody may ever ask for a recording that was cancelled or that failed.
      recorded.catch(() => undefined);

      try {
        // A chunk a second, so a crash loses at most that much of what's in memory.
        recorder.start(1000);
      } catch (error) {
        // No session reaches the caller, so nothing else could let the microphone go.
        release();
        throw failed("unavailable", error);
      }

      return {
        startedAt,
        elapsed,
        stop() {
          if (discarded) return Promise.reject(failed("unavailable"));
          stopping = true;
          // The length is up to now, not up to when the browser has handed over the last chunk.
          endedAt ??= performance.now();
          if (recorder.state !== "inactive") recorder.stop();
          return recorded;
        },
        cancel() {
          // A recording that `stop()` already asked for is still that caller's.
          if (!stopping) discarded = true;
          if (recorder.state !== "inactive") recorder.stop();
          release();
        },
      };
    },
  };
}
