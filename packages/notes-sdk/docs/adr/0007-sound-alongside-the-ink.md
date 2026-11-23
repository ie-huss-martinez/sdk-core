# 0007. Sound recorded alongside the ink

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** [ADR 0003](0003-a-library-on-the-device.md) (the model and its files); in sdk-core, [ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md) (ports) and [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) (no network)

## Context

In a lecture, people record what's said while they write. Played back later, the notes show what was being written at each moment, and what was said when a line was written. Apps of this kind sell that as a paid feature.

It needs a microphone, a place to keep the sound, and a link between the sound's time and the ink.

## Decision

- **`NotesRecorder` is the port.** `createMediaNotesRecorder` implements it with the browser's `getUserMedia` and `MediaRecorder`. Where either is missing, the record tool isn't offered.
- **The browser asks for the microphone** the first time. A refusal is `RECORDING_FAILED` with the reason `denied`, and the editor says how to allow it.
- **A recording is a file of the notebook,** stored under its hash like a PDF or a picture, in the container the browser's recorder writes: WebM, MP4 or Ogg. The notebook lists it with when it started and how long it is.
- **Items written while recording carry an anchor:** the recording's id and the milliseconds since it started.
- **Playback follows the ink.** While a recording plays, the ink it hasn't reached yet is drawn faint, so the page fills in as it was written.
- **Nothing leaves the device.** The sound goes from the recorder to the store. Playing it needs `media-src blob:` in a host's Content Security Policy.
- **Recordings are in backups,** as the notebook's other files are, and are deleted with their notebook. Deleting one is undoable until the notebook is closed.

## Alternatives considered

- **`audio-sdk` for recording:** it edits sound; it doesn't capture it yet. When it does, this port takes its recorder.
- **Raw samples through an `AudioWorklet`,** encoded here: a codec in this package, for what the browser already does.
- **One recording per page:** people turn pages while a lecture goes on. A recording belongs to the notebook, and anchors say where each item falls in it.

## Consequences

- Recording works wherever the browser records, with no code of ours in the audio path.
- The container differs by browser, so a recording made in one may not play in another. A backup carries it either way.
- A long recording is held in memory until it's stopped, then stored. Storing it in pieces as it grows is a later step.
- Jumping to the moment a line was written, by tapping it during playback, is a later step: the anchors are already stored.
