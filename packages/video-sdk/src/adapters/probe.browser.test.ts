import { describe, expect, it } from "vitest";
import landscapeMkv from "../../test/fixtures/video/landscape.mkv?url";
import landscapeMp4 from "../../test/fixtures/video/landscape.mp4?url";
import landscapeWebm from "../../test/fixtures/video/landscape.webm?url";
import numberedDav from "../../test/fixtures/video/numbered.dav?url";
import rotatedMov from "../../test/fixtures/video/rotated.mov?url";
import { videoLimits } from "../core/errors/video-limits.js";
import { probeFile } from "./probe.js";

// The same probe as the unit tests, in each browser engine: mediabunny reads
// a Blob differently on WebKit (ADR 0001), and the front check reads it
// through Blob.slice.
describe("probing in the browser", () => {
  it.each([
    [landscapeMp4, "mp4", 0],
    [landscapeWebm, "webm", 0],
    [landscapeMkv, "mkv", 0],
    [rotatedMov, "mov", 90],
  ])("reads %s", async (url, container, rotation) => {
    const file = await (await fetch(url)).blob();
    const probe = await probeFile(file, videoLimits.resolve());
    expect(probe).toMatchObject({ container, tracks: 2 });
    expect(probe.video).toMatchObject({
      displayWidth: 1280,
      displayHeight: 720,
      rotation,
      frameRate: 30,
      packets: 60,
    });
    expect(probe.audio).toMatchObject({ sampleRate: 48_000, channels: 2 });
  });

  // A recording has no MIME type a browser knows, and the SDK's own reader
  // reads it through Blob.slice (docs/adr/0009).
  it("reads a DAV recording, whatever type the browser gives it", async () => {
    const bytes = await (await fetch(numberedDav)).arrayBuffer();
    for (const type of ["", "application/octet-stream"]) {
      const probe = await probeFile(new Blob([bytes], { type }), videoLimits.resolve());
      expect(probe).toMatchObject({ container: "dav", tracks: 2, duration: 3_000_000 });
      expect(probe.video).toMatchObject({
        codec: "avc1.64000a",
        displayWidth: 256,
        displayHeight: 32,
        frameRate: 25,
        packets: 75,
      });
      expect(probe.audio).toEqual({ codec: "alaw", sampleRate: 8_000, channels: 1 });
    }
  });
});
