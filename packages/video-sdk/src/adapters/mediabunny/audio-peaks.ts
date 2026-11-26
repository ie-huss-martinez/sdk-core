import type { VideoPeaks, VideoProbe } from "../../core/model/source.js";
import type { FrontCheck } from "../front-check/types.js";
import { openTracks } from "../open-tracks.js";
import { createPeakBuilder } from "../peaks.js";
import { decodeAudioData } from "./audio-decoder.js";

/**
 * Decodes a probed file's audio track in the worker, and builds its waveform
 * peaks (docs/adr/0002). Every chunk is copied out as 32-bit float samples
 * and closed at once. Resolves `null` for a file without audio.
 *
 * @internal
 */
export async function audioPeaks(
  file: Blob,
  probe: VideoProbe,
  front: FrontCheck,
  signal?: AbortSignal,
): Promise<VideoPeaks | null> {
  // A probe without sound, such as a track this browser can't decode, has no peaks.
  if (probe.audio === null) return null;
  const tracks = await openTracks(file, front);
  try {
    const { audio } = tracks;
    const config = audio && (await audio.config());
    if (!audio || !config) return null;
    const peaks = createPeakBuilder(probe.start, probe.duration);
    let buffers: Float32Array[] = [];
    await decodeAudioData(
      audio.packets(),
      config,
      { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY },
      (data, timestamp) => {
        if (
          buffers.length !== data.numberOfChannels ||
          (buffers[0]?.length ?? 0) < data.numberOfFrames
        ) {
          buffers = Array.from(
            { length: data.numberOfChannels },
            () => new Float32Array(data.numberOfFrames),
          );
        }
        const channels = buffers.map((buffer, planeIndex) => {
          const view = buffer.subarray(0, data.numberOfFrames);
          data.copyTo(view, { planeIndex, format: "f32-planar" });
          return view;
        });
        peaks.add({
          timestamp,
          sampleRate: data.sampleRate,
          numberOfFrames: data.numberOfFrames,
          channels,
        });
      },
      signal,
    );
    return peaks.finish();
  } finally {
    tracks.dispose();
  }
}
