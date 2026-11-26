import type { WindowReader } from "@hussmartinez/sdk-core";
import { VideoError } from "../../core/errors/video-error.js";
import type { VideoFilePolicy } from "../../core/errors/video-limits.js";
import { malformed, refused } from "../front-check/errors.js";
import { overPacketCap, packetCaps } from "../packets.js";
import { streamHeader } from "./bitstream.js";
import {
  audioCodecOf,
  FRAME,
  type FrameHeader,
  HEADER_SIZE,
  HEVC_CODEC,
  isFilePrefix,
  isFrameMagic,
  isTrailerMagic,
  MAX_EXTENSION,
  PREFIXED_START,
  readHeader,
  readTags,
  sampleRateOf,
  TRAILER_SIZE,
  UNREAD_VIDEO_CODECS,
} from "./format.js";

/** Where each packet of a track is in the file, and when it plays. */
export interface PacketIndex {
  readonly count: number;
  /** Each payload's offset in the file, in bytes. */
  readonly offsets: Float64Array;
  /** Each payload's size, in bytes. */
  readonly sizes: Uint32Array;
  /** Each packet's time on the file's timeline, in microseconds, never decreasing. */
  readonly times: Float64Array;
}

/**
 * The index of a DHAV file (docs/adr/0009): every packet of the picture and
 * the sound the SDK uses, from one bounded walk of the file's frames. It's
 * the only thing the reader keeps of a file; payloads are read when a
 * decoder asks for them.
 *
 * @internal
 */
export interface DhavIndex {
  readonly video: PacketIndex & {
    /** 1 for each key packet, 0 for the others. The first is always a key packet. */
    readonly keys: Uint8Array;
    /** The codec, as a WebCodecs codec string, from the stream's own parameter set. */
    readonly codec: string;
    readonly width: number;
    readonly height: number;
    /** How long one picture lasts, in microseconds, as the recorder declared it. */
    readonly period: number;
  };
  readonly audio:
    | (PacketIndex & {
        /** The codec's WebCodecs name, or the nearest name when `playable` is false. */
        readonly codec: string;
        readonly sampleRate: number;
        readonly channels: number;
        /** Whether the SDK hands this sound to a decoder: G.711 and 16-bit PCM. */
        readonly playable: boolean;
        /** How long a packet of `bytes` bytes lasts, in microseconds: 0 when not `playable`. */
        duration(bytes: number): number;
      })
    | null;
  /** Every stream in the file, of each kind and channel, including those not used. */
  readonly tracks: number;
  /** The bytes this index holds, which `maxIndexSize` bounds. */
  readonly size: number;
}

const CONTAINER = "dav";
/** The bytes one video packet and one audio packet take in the index. */
const VIDEO_ENTRY = 8 + 4 + 8 + 1;
const AUDIO_ENTRY = 8 + 4 + 8;
/** The picture period when the recorder declares no frame rate, in milliseconds: 25 a second. */
const DEFAULT_PERIOD = 40;
/** The least step between frames that counts as a jump, in milliseconds. */
const MIN_JUMP = 500;
/** How many picture periods a step may be before it counts as a jump. */
const JUMP_PERIODS = 4;
/** How far the date's step may be from the counter's, in milliseconds. The date counts whole seconds. */
const DATE_SLACK = 2_000;
/** How much of the first key picture is searched for its parameter set, in bytes. */
const HEADER_SEARCH = 65_536;
/** How many bytes are read at a time when looking for the next frame. */
const RESYNC_WINDOW = 65_536;

/** A track's packets while the walk collects them: columns that double when full. */
class Columns {
  count = 0;
  offsets = new Float64Array(1_024);
  sizes = new Uint32Array(1_024);
  times = new Float64Array(1_024);
  keys = new Uint8Array(1_024);

  push(offset: number, size: number, time: number, key: boolean): void {
    if (this.count === this.offsets.length) {
      const grow = <T extends Float64Array | Uint32Array | Uint8Array>(column: T): T => {
        const grown = new (column.constructor as new (length: number) => T)(column.length * 2);
        grown.set(column);
        return grown;
      };
      this.offsets = grow(this.offsets);
      this.sizes = grow(this.sizes);
      this.times = grow(this.times);
      this.keys = grow(this.keys);
    }
    this.offsets[this.count] = offset;
    this.sizes[this.count] = size;
    this.times[this.count] = time;
    this.keys[this.count] = key ? 1 : 0;
    this.count += 1;
  }

  finish(): PacketIndex & { readonly keys: Uint8Array } {
    return {
      count: this.count,
      offsets: this.offsets.subarray(0, this.count),
      sizes: this.sizes.subarray(0, this.count),
      times: this.times.subarray(0, this.count),
      keys: this.keys.subarray(0, this.count),
    };
  }
}

/** The offset of the next frame's magic at or after `from`, or the file's size without one. */
async function nextFrame(reader: WindowReader, from: number): Promise<number> {
  let at = from;
  while (at < reader.size) {
    const window = await reader.bytes(at, RESYNC_WINDOW);
    for (let index = 0; index + 4 <= window.length; index += 1) {
      if (isFrameMagic(window, index)) return at + index;
    }
    if (window.length < 4) break;
    // The last three bytes may begin a magic that the next window completes.
    at += window.length - 3;
  }
  return reader.size;
}

/**
 * Walks every frame of a DHAV file and indexes the picture and the sound
 * the SDK uses (docs/adr/0009). It's both the file's front check and its
 * packet walk: nothing else parses the file.
 *
 * - **Bounded:** every frame's length is checked against the bytes that
 *   remain, and the walk always advances. It visits at most `maxElements`
 *   frames, stops as soon as a track has more packets than the limits
 *   allow, and never holds more index than `maxIndexSize`.
 * - **Strict about frames:** a frame is its header, its payload and a
 *   trailer that starts with `dhav`. One that's cut short, too short for its
 *   own header, or without its trailer, is malformed. Bytes between frames
 *   that aren't a frame are skipped to the next `DHAV`.
 * - **One picture and one sound:** the first key picture's channel is the
 *   picture, and its parameter set says the codec and the size; a codec
 *   number is never trusted for either. The first sound frame that declares
 *   its parameters is the sound. Other channels are counted and skipped.
 * - **One timeline:** times come from the frames' millisecond counter, in
 *   file order, for both tracks together. A step that's too large either
 *   way, or that the frames' dates contradict, is a jump in the recorder's
 *   clock or a gap in the recording: the timeline goes on from where it
 *   was, as if nothing were missing. A track's times never go back.
 *
 * Throws `VideoError`: `INVALID_VIDEO` for a malformed file,
 * `UNSUPPORTED_FORMAT` for one without a picture, `UNSUPPORTED_CODEC` for a
 * picture that's neither H.264 nor HEVC, `FRAME_RATE_TOO_HIGH` or
 * `DURATION_TOO_LONG` past the packet caps, and `INDEX_TOO_LARGE`.
 *
 * @internal
 */
export async function scanDhav(
  reader: WindowReader,
  policy: VideoFilePolicy,
  maxElements: number,
): Promise<DhavIndex> {
  const caps = packetCaps(policy);
  const maxIndexSize = policy.limits.maxIndexSize.maximum;
  const videoPackets = new Columns();
  const audioPackets = new Columns();
  let video: { codec: string; width: number; height: number } | undefined;
  let videoChannel = -1;
  let audio:
    | {
        channel: number;
        codec: string;
        sampleRate: number;
        channels: number;
        /** Bytes for one sample of every channel, or 0 for sound the SDK doesn't play. */
        frameBytes: number;
      }
    | undefined;
  /** Streams seen, as the kind and the channel in one number. */
  const streams = new Set<number>();
  /** The video codec number and the frame rate the recorder last declared. */
  let declaredCodec: number | undefined;
  let period = DEFAULT_PERIOD;
  let elements = 0;

  /** The timeline, in milliseconds: the last frame placed, and where what's placed so far ends. */
  let last: { counter: number; date: number; time: number } | undefined;
  let horizon = 0;
  const place = (header: FrameHeader): number => {
    let time = 0;
    if (last) {
      // The counter's step, as a signed 16-bit number: it wraps every 65.536 s.
      const step = ((header.timestamp - last.counter + 0x8000) & 0xffff) - 0x8000;
      const jump = Math.max(MIN_JUMP, JUMP_PERIODS * period);
      const continuous =
        Math.abs(step) <= jump && Math.abs((header.date - last.date) * 1_000 - step) <= DATE_SLACK;
      time = continuous ? Math.max(0, last.time + step) : horizon;
    }
    last = { counter: header.timestamp, date: header.date, time };
    return time;
  };
  const checkIndex = () => {
    const size = videoPackets.count * VIDEO_ENTRY + audioPackets.count * AUDIO_ENTRY;
    if (size > maxIndexSize) policy.check("maxIndexSize", size);
  };

  let first = true;
  let offset = isFilePrefix(await reader.bytes(0, 5)) ? PREFIXED_START : 0;
  while (offset < reader.size) {
    const head = await reader.bytes(offset, HEADER_SIZE + MAX_EXTENSION);
    if (!isFrameMagic(head)) {
      // A file is recognised by its first frame; later bytes that aren't one are skipped.
      if (first) throw refused(CONTAINER, "signature");
      offset = await nextFrame(reader, offset + 1);
      continue;
    }
    first = false;
    elements += 1;
    if (elements > maxElements) throw malformed(CONTAINER, "too-many-elements");
    if (head.length < HEADER_SIZE) throw malformed(CONTAINER, "truncated");
    const header = readHeader(head);
    if (header.length < HEADER_SIZE) throw malformed(CONTAINER, "frame-size");
    const end = offset + header.length;
    if (end > reader.size) throw malformed(CONTAINER, "truncated");
    const start = offset;
    offset = end;

    const isVideo = header.type === FRAME.key || header.type === FRAME.delta;
    // Data frames, and any type the format doesn't name, are skipped by their length.
    if (!isVideo && header.type !== FRAME.audio) continue;
    const payload = start + HEADER_SIZE + header.extensionLength;
    const size = end - TRAILER_SIZE - payload;
    if (size < 0) throw malformed(CONTAINER, "frame-size");
    if (!isTrailerMagic(await reader.bytes(end - TRAILER_SIZE, 4))) {
      throw malformed(CONTAINER, "frame-trailer");
    }
    if (size === 0) continue;
    streams.add((isVideo ? 0 : 0x100) + header.channel);
    const tags = readTags(head.subarray(HEADER_SIZE, HEADER_SIZE + header.extensionLength));

    if (isVideo) {
      if (video && header.channel !== videoChannel) continue;
      // Pictures before the first key picture can't be decoded.
      if (!video && header.type !== FRAME.key) continue;
      if (tags.videoCodec !== undefined) declaredCodec = tags.videoCodec;
      if (tags.frameRate) period = Math.round(1_000 / tags.frameRate);
      if (!video) {
        const unread =
          declaredCodec === undefined ? undefined : UNREAD_VIDEO_CODECS.get(declaredCodec);
        if (unread !== undefined) {
          throw new VideoError("UNSUPPORTED_CODEC", "The video codec isn't one the SDK reads.", {
            details: { container: CONTAINER, codec: unread, track: "video" },
          });
        }
        const stream = streamHeader(
          await reader.bytes(payload, Math.min(size, HEADER_SEARCH)),
          declaredCodec === HEVC_CODEC ? "hevc" : "h264",
        );
        if (!stream) throw malformed(CONTAINER, "parameter-sets");
        video = stream;
        videoChannel = header.channel;
      }
      let time = place(header);
      const before = videoPackets.times[videoPackets.count - 1];
      // Two pictures never share a time: the second plays a millisecond later.
      if (before !== undefined && time * 1_000 <= before) time = before / 1_000 + 1;
      videoPackets.push(payload, size, time * 1_000, header.type === FRAME.key);
      if (videoPackets.count > caps.video) throw overPacketCap("video", videoPackets.count, policy);
      horizon = Math.max(horizon, time + period);
    } else {
      if (audio && header.channel !== audio.channel) continue;
      if (!audio) {
        // Sound frames before the first that declares its parameters can't be placed.
        if (!tags.audio) continue;
        const codec = audioCodecOf(tags.audio.codec);
        const sampleRate = sampleRateOf(tags.audio.rateIndex);
        if (!codec || !sampleRate || tags.audio.channels === 0) continue;
        audio = {
          channel: header.channel,
          codec: codec.codec,
          sampleRate,
          channels: tags.audio.channels,
          frameBytes: (codec.bytesPerSample ?? 0) * tags.audio.channels,
        };
      }
      let time = place(header);
      const before = audioPackets.times[audioPackets.count - 1];
      if (before !== undefined && time * 1_000 < before) time = before / 1_000;
      audioPackets.push(payload, size, time * 1_000, true);
      if (audioPackets.count > caps.audio) throw overPacketCap("audio", audioPackets.count, policy);
      const length =
        audio.frameBytes > 0 ? (size / audio.frameBytes / audio.sampleRate) * 1_000 : 0;
      horizon = Math.max(horizon, time + length);
    }
    checkIndex();
  }

  if (first) throw refused(CONTAINER, "signature");
  if (!video) throw refused(CONTAINER, "no-video");
  const sound = audio;
  return {
    video: { ...videoPackets.finish(), ...video, period: period * 1_000 },
    audio: sound
      ? {
          ...audioPackets.finish(),
          codec: sound.codec,
          sampleRate: sound.sampleRate,
          channels: sound.channels,
          playable: sound.frameBytes > 0,
          duration: (bytes) =>
            sound.frameBytes > 0
              ? Math.round((bytes / sound.frameBytes / sound.sampleRate) * 1_000_000)
              : 0,
        }
      : null,
    tracks: streams.size,
    size: videoPackets.count * VIDEO_ENTRY + audioPackets.count * AUDIO_ENTRY,
  };
}
