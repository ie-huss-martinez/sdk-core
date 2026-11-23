import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaNotesRecorder } from "./media-recorder.js";

// Node has no microphone: the browser's side is two small fakes, put on
// `globalThis` for a test and taken away after it.

/** A microphone's track, which says whether it was let go. */
class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

/** What `MediaRecorder` does that the recorder relies on, driven by the test. */
class FakeRecorder extends EventTarget {
  /** The recorders made, latest last. */
  static readonly made: FakeRecorder[] = [];
  /** What `start()` throws, when the browser can't record the track after all. */
  static startFailure: unknown;

  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;

  constructor(_stream: unknown, options: { readonly mimeType?: string } = {}) {
    super();
    this.mimeType = options.mimeType ?? "";
    FakeRecorder.made.push(this);
  }

  static isTypeSupported(type: string): boolean {
    return type === "audio/webm";
  }

  start(): void {
    if (FakeRecorder.startFailure !== undefined) throw FakeRecorder.startFailure;
    this.state = "recording";
  }

  /** Hands over a chunk, as the browser does every second. */
  gather(sound: string): void {
    const event = new Event("dataavailable");
    Object.assign(event, { data: new Blob([sound], { type: "audio/webm;codecs=opus" }) });
    this.dispatchEvent(event);
  }

  /** Ends as the browser ends a recording: the last chunk, then `stop`. */
  end(lastSound = ""): void {
    this.state = "inactive";
    this.gather(lastSound);
    this.dispatchEvent(new Event("stop"));
  }

  /** Fails as the browser does: `error`, then what it gathered, then `stop`. */
  fail(lastSound = ""): void {
    this.state = "inactive";
    this.dispatchEvent(new Event("error"));
    this.gather(lastSound);
    this.dispatchEvent(new Event("stop"));
  }

  stop(): void {
    this.end("|last");
  }
}

/** Puts the fakes in place, and returns the microphone's tracks. */
function fakeBrowser(getUserMedia?: () => Promise<unknown>): FakeTrack[] {
  const tracks = [new FakeTrack()];
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: getUserMedia ?? (async () => ({ getTracks: () => tracks })) },
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  return tracks;
}

const latest = (): FakeRecorder => {
  const recorder = FakeRecorder.made.at(-1);
  if (!recorder) throw new Error("No recorder was made.");
  return recorder;
};

const failure = (reason: string) => ({
  name: "NotesError",
  code: "RECORDING_FAILED",
  details: { reason },
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecorder.made.length = 0;
  FakeRecorder.startFailure = undefined;
});

describe("createMediaNotesRecorder", () => {
  it("can't record where there is no microphone API, and says so", async () => {
    const recorder = createMediaNotesRecorder();
    expect(recorder.supported).toBe(false);
    await expect(recorder.start()).rejects.toMatchObject(failure("unavailable"));
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "unavailable"],
  ])("rejects a microphone refused with %s as %s", async (name, reason) => {
    const refusal = new DOMException("No.", name);
    fakeBrowser(() => Promise.reject(refusal));
    await expect(createMediaNotesRecorder().start()).rejects.toMatchObject({
      ...failure(reason),
      cause: refusal,
    });
  });

  it("records until stopped, and lets the microphone go", async () => {
    const tracks = fakeBrowser();
    const recorder = createMediaNotesRecorder();
    expect(recorder.supported).toBe(true);
    const session = await recorder.start();
    latest().gather("one");
    latest().gather("|two");
    expect(tracks[0]?.stopped).toBe(false);

    const { audio, duration } = await session.stop();
    expect(audio.type).toBe("audio/webm");
    await expect(audio.text()).resolves.toBe("one|two|last");
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(tracks[0]?.stopped).toBe(true);
  });

  it("lets the microphone go when the recorder can't start", async () => {
    const tracks = fakeBrowser();
    FakeRecorder.startFailure = new DOMException("Can't record this track.", "NotSupportedError");
    await expect(createMediaNotesRecorder().start()).rejects.toMatchObject({
      ...failure("unavailable"),
      cause: FakeRecorder.startFailure,
    });
    expect(tracks[0]?.stopped).toBe(true);
  });

  it("keeps what was recorded when the microphone ends on its own", async () => {
    const tracks = fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().gather("one");
    // The microphone was unplugged: the browser ends the recording by itself.
    latest().end("|two");
    expect(tracks[0]?.stopped).toBe(true);
    const length = session.elapsed();

    const { audio, duration } = await session.stop();
    await expect(audio.text()).resolves.toBe("one|two");
    // The recording's length is when it ended, not when it was asked for.
    expect(duration).toBe(length);
    expect(session.elapsed()).toBe(length);
    // And asked again, the answer is the same.
    await expect((await session.stop()).audio.text()).resolves.toBe("one|two");
  });

  it("keeps what was recorded before the recorder failed", async () => {
    fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().gather("one");
    latest().fail("|two");
    await expect((await session.stop()).audio.text()).resolves.toBe("one|two");
  });

  it("rejects a recording that failed before it had any sound", async () => {
    const tracks = fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().fail();
    await expect(session.stop()).rejects.toMatchObject(failure("unavailable"));
    expect(tracks[0]?.stopped).toBe(true);
  });

  it("rejects a recording with no sound", async () => {
    fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().stop = function (this: FakeRecorder) {
      this.end();
    };
    await expect(session.stop()).rejects.toMatchObject(failure("unavailable"));
  });

  it("discards a cancelled recording, and lets the microphone go", async () => {
    const tracks = fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().gather("one");
    session.cancel();
    expect(latest().state).toBe("inactive");
    expect(tracks[0]?.stopped).toBe(true);
    await expect(session.stop()).rejects.toMatchObject(failure("unavailable"));
  });

  it("discards a recording cancelled after it ended on its own", async () => {
    fakeBrowser();
    const session = await createMediaNotesRecorder().start();
    latest().end("one");
    session.cancel();
    await expect(session.stop()).rejects.toMatchObject(failure("unavailable"));
  });
});
