// Whether a real file decodes, for the matrix's `decodes` row: video through
// the SDK's own decoder, audio through AudioDecoder over mediabunny's
// packets. A codec that doesn't decode is false, whatever the browser claims.
import { frontCheck } from "../../src/adapters/front-check/front-check.js";
import { frameBounds } from "../../src/adapters/mediabunny/frame-bounds.js";
import { decodeVideoFrames } from "../../src/adapters/mediabunny/video-decoder.js";
import { openTracks } from "../../src/adapters/open-tracks.js";
import type { AudioPackets } from "../../src/adapters/packets.js";
import { probeFile } from "../../src/adapters/probe.js";
import { videoLimits } from "../../src/core/errors/video-limits.js";

/** How many frames, or audio packets, must decode. */
const SAMPLE = 10;

export async function decodes(file: Blob, track: "video" | "audio"): Promise<boolean> {
  try {
    const probe = await probeFile(file, videoLimits.resolve());
    const tracks = await openTracks(file, await frontCheck(file, videoLimits.resolve()));
    try {
      const { video, audio } = tracks;
      if (track === "video") {
        const config = await video.config();
        if (config === null) return false;
        const range = {
          from: Number.NEGATIVE_INFINITY,
          to: Number.POSITIVE_INFINITY,
          limit: SAMPLE,
        };
        const bounds = frameBounds(probe);
        return (
          (await decodeVideoFrames(video.packets(), config, bounds, range, () => {})) === SAMPLE
        );
      }
      const config = audio && (await audio.config());
      if (!audio || !config) return false;
      return await decodeAudio(audio.packets(), config);
    } finally {
      tracks.dispose();
    }
  } catch {
    return false;
  }
}

async function decodeAudio(sink: AudioPackets, config: AudioDecoderConfig): Promise<boolean> {
  let outputs = 0;
  let failed = false;
  const decoder = new AudioDecoder({
    output(data) {
      outputs += 1;
      data.close();
    },
    error() {
      failed = true;
    },
  });
  try {
    decoder.configure(config);
    let packet = await sink.getFirstPacket();
    for (let count = 0; packet && count < SAMPLE; count += 1) {
      decoder.decode(packet.toEncodedAudioChunk());
      packet = await sink.getNextPacket(packet);
    }
    await decoder.flush();
    return !failed && outputs > 0;
  } catch {
    return false;
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
}
