import { VideoError } from "../core/errors/video-error.js";
import type { VideoFilePolicy } from "../core/errors/video-limits.js";
import type { AudioTrackProbe, VideoTrackProbe } from "../core/model/source.js";

/**
 * One encoded video packet, as the decoder's loop needs it (docs/adr/0009).
 * mediabunny's `EncodedPacket` already has this shape.
 *
 * @internal
 */
export interface VideoPacket {
  readonly type: "key" | "delta";
  /** The presentation timestamp, in whole microseconds. */
  readonly microsecondTimestamp: number;
  toEncodedVideoChunk(): EncodedVideoChunk;
}

/**
 * A video track's packets, in decoding order, read one at a time
 * (docs/adr/0009). mediabunny's `EncodedPacketSink` already has this shape,
 * and the SDK's own DHAV reader implements it.
 *
 * @internal
 */
export interface VideoPackets {
  getFirstPacket(): Promise<VideoPacket | null>;
  /** The last key packet at or before a time in seconds, or `null` before the first. */
  getKeyPacket(seconds: number): Promise<VideoPacket | null>;
  /** The packet after one this reader gave, or `null` after the last. */
  getNextPacket(packet: VideoPacket): Promise<VideoPacket | null>;
}

/**
 * One encoded audio packet. Every audio packet is a key packet.
 *
 * @internal
 */
export interface AudioPacket {
  readonly microsecondTimestamp: number;
  toEncodedAudioChunk(): EncodedAudioChunk;
}

/**
 * An audio track's packets, read one at a time, as {@link VideoPackets}.
 *
 * @internal
 */
export interface AudioPackets {
  getFirstPacket(): Promise<AudioPacket | null>;
  /** The last packet at or before a time in seconds, or `null` before the first. */
  getPacket(seconds: number): Promise<AudioPacket | null>;
  getNextPacket(packet: AudioPacket): Promise<AudioPacket | null>;
}

/**
 * The tracks the SDK uses from an open file, whichever reader opened it
 * (docs/adr/0009): the probe and every later reader pick the same ones.
 *
 * @internal
 */
export interface OpenTracks {
  readonly video: {
    /** The codec, as a WebCodecs codec string. */
    readonly codec: string;
    /** The decoder's configuration, or `null` when the reader can't give one. */
    config(): Promise<VideoDecoderConfig | null>;
    /** A new reader of the track's packets: each decode takes its own. */
    packets(): VideoPackets;
  };
  /** The audio track, or `undefined` when the file has none the reader recognises. */
  readonly audio:
    | {
        readonly codec: string;
        /** The decoder's configuration, or `null` for sound the SDK can't hand to a decoder. */
        config(): Promise<AudioDecoderConfig | null>;
        packets(): AudioPackets;
      }
    | undefined;
  /** Releases the file. Reading afterwards fails. */
  dispose(): void;
}

/**
 * What walking every packet of the tracks the SDK uses found (ADR 0001).
 *
 * @internal
 */
export interface PacketWalk {
  /** The video track's earliest presentation timestamp, in microseconds. */
  readonly start: number;
  /** The length in microseconds from `start`: the larger of the header's and the walk's. */
  readonly duration: number;
  readonly peakBitrate: number;
  readonly maxPacketSize: number;
  readonly video: VideoTrackProbe;
  readonly audio: AudioTrackProbe | null;
}

/**
 * The most packets a video track and an audio track may have under the
 * policy: the duration limit times the frame-rate limit, and times 1,000 a
 * second for audio (ADR 0004). The packet walk stops past them.
 *
 * @internal
 */
export function packetCaps(policy: VideoFilePolicy): {
  readonly video: number;
  readonly audio: number;
} {
  const seconds = policy.limits.maxDuration.maximum / 1_000;
  return {
    video: Math.ceil(seconds * policy.limits.maxFrameRate.maximum),
    audio: Math.ceil(seconds * 1_000),
  };
}

/**
 * The error for a track with more packets than {@link packetCaps} allows:
 * `FRAME_RATE_TOO_HIGH` for video and `DURATION_TOO_LONG` for audio (ADR 0004).
 *
 * @internal
 */
export function overPacketCap(
  track: "video" | "audio",
  count: number,
  policy: VideoFilePolicy,
): VideoError {
  const isVideo = track === "video";
  const limit = isVideo ? "maxFrameRate" : "maxDuration";
  const seconds = policy.limits.maxDuration.maximum / 1_000;
  return new VideoError(
    isVideo ? "FRAME_RATE_TOO_HIGH" : "DURATION_TOO_LONG",
    `The ${track} track has more packets than the limits allow.`,
    {
      details: {
        limit,
        maximum: policy.limits[limit].maximum,
        actual: isVideo ? count / seconds : policy.limits.maxDuration.maximum + 1,
        unit: isVideo ? "hertz" : "milliseconds",
      },
    },
  );
}

/**
 * The most timestamps, in microseconds, within any window of one second
 * (ADR 0004). Sorts the array it's given.
 *
 * @internal
 */
export function peakPerSecond(timestamps: Float64Array): number {
  timestamps.sort();
  let peak = 0;
  let first = 0;
  for (let last = 0; last < timestamps.length; last += 1) {
    while ((timestamps[last] as number) - (timestamps[first] as number) >= 1_000_000) first += 1;
    peak = Math.max(peak, last - first + 1);
  }
  return peak;
}
