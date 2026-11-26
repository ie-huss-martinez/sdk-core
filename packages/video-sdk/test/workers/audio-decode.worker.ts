// The audio decoder, exposed for tests (docs/adr/0002): it decodes a range of
// a file's audio track and reports what it delivered, and the ledger of open
// AudioData, so tests can prove every chunk is closed on every path.
import { exposeWorker } from "@hussmartinez/sdk-core";
import { frontCheck } from "../../src/adapters/front-check/front-check.js";
import { audioDataLedger, decodeAudioData } from "../../src/adapters/mediabunny/audio-decoder.js";
import { openTracks } from "../../src/adapters/open-tracks.js";
import { probeFile } from "../../src/adapters/probe.js";
import { videoLimits } from "../../src/core/errors/video-limits.js";
import { laggingAudioDecoderClass, lateOutputAudioDecoderClass } from "./lagging-decoder.js";

export interface AudioDecodeRequest {
  readonly file: Blob;
  readonly from?: number;
  readonly to?: number;
  /** The consumer throws on this delivered chunk, counted from 0. */
  readonly throwAt?: number;
  /** The call is cancelled on this delivered chunk. */
  readonly abortAt?: number;
  /** Delivers one more chunk after the decoder is closed, as Firefox can. */
  readonly lateOutput?: boolean;
  /** Decodes with a wrong channel count, so every chunk is out of bounds. */
  readonly wrongChannels?: boolean;
  /** Decodes with another codec's configuration, so that decoding fails. */
  readonly codec?: string;
  /** Holds this many chunks before the real decoder sees them. */
  readonly lag?: number;
  /** Whether the decoder fires `dequeue`; it does unless this is false. */
  readonly dequeue?: boolean;
  /** The decoder gives nothing back, and its flush never settles. */
  readonly stuck?: boolean;
  /** With `lag`: four chunks come at once when the queue is full. */
  readonly burst?: boolean;
}

export interface AudioDecodeContract {
  readonly decode: {
    readonly input: AudioDecodeRequest;
    readonly output: {
      readonly chunks: number;
      readonly frames: number;
      readonly first: number;
      /** Each chunk's time as delivered, and its length in microseconds. */
      readonly placed: (readonly [number, number])[];
      /** The first packet's time. */
      readonly firstPacket: number;
    };
  };
  readonly ledger: {
    readonly input: undefined;
    readonly output: {
      readonly open: number;
      readonly peakDecodeQueue: number;
      readonly stalls: number;
    };
  };
}

exposeWorker<AudioDecodeContract>({
  async decode(request) {
    // The probe checks the file against the limits, as before any decode.
    await probeFile(request.file, videoLimits.resolve());
    const tracks = await openTracks(
      request.file,
      await frontCheck(request.file, videoLimits.resolve()),
    );
    const controller = new AbortController();
    const RealDecoder = globalThis.AudioDecoder;
    if (request.lateOutput) globalThis.AudioDecoder = lateOutputAudioDecoderClass();
    if (request.lag !== undefined || request.dequeue === false || request.stuck) {
      globalThis.AudioDecoder = request.stuck
        ? laggingAudioDecoderClass(0, true, true)
        : laggingAudioDecoderClass(
            request.lag ?? 0,
            request.dequeue ?? true,
            false,
            request.burst ?? false,
          );
    }
    try {
      const { audio } = tracks;
      const config = audio && (await audio.config());
      if (!audio || !config) throw new Error("no audio");
      let chunks = 0;
      let frames = 0;
      let first = Number.NaN;
      const placed: [number, number][] = [];
      const { description: _description, ...bare } = config;
      await decodeAudioData(
        audio.packets(),
        request.codec
          ? { ...bare, codec: request.codec }
          : request.wrongChannels
            ? { ...config, numberOfChannels: 1 }
            : config,
        {
          from: request.from ?? Number.NEGATIVE_INFINITY,
          to: request.to ?? Number.POSITIVE_INFINITY,
        },
        (data, timestamp) => {
          if (chunks === 0) first = timestamp;
          placed.push([timestamp, (data.numberOfFrames * 1_000_000) / data.sampleRate]);
          const index = chunks;
          chunks += 1;
          frames += data.numberOfFrames;
          if (index === request.throwAt) throw new RangeError("the consumer failed");
          if (index === request.abortAt) controller.abort();
        },
        controller.signal,
      );
      const firstPacket =
        (await audio.packets().getFirstPacket())?.microsecondTimestamp ?? Number.NaN;
      return { chunks, frames, first, placed, firstPacket };
    } finally {
      globalThis.AudioDecoder = RealDecoder;
      tracks.dispose();
    }
  },
  ledger: () => ({ ...audioDataLedger }),
});
