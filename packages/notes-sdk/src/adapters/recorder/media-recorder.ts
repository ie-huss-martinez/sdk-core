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
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      const startedAt = Date.now();
      const clock = performance.now();
      // A chunk a second, so a crash loses at most that much of what's in memory.
      recorder.start(1000);

      return {
        startedAt,
        elapsed: () => Math.round(performance.now() - clock),
        stop() {
          return new Promise((resolve, reject) => {
            const duration = Math.round(performance.now() - clock);
            recorder.addEventListener("stop", () => {
              release();
              const type = storedType(recorder.mimeType) ?? storedType(chunks[0]?.type ?? "");
              if (!type || chunks.length === 0) {
                reject(failed("unavailable"));
                return;
              }
              resolve({ audio: new Blob(chunks, { type }), duration });
            });
            recorder.addEventListener("error", (event) => {
              release();
              reject(failed("unavailable", event));
            });
            if (recorder.state === "inactive") {
              release();
              reject(failed("unavailable"));
            } else {
              recorder.stop();
            }
          });
        },
        cancel() {
          if (recorder.state !== "inactive") recorder.stop();
          release();
        },
      };
    },
  };
}
