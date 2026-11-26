/**
 * The DHAV container's layout, as far as the SDK reads it (docs/adr/0009).
 * A file is a run of frames. Each one is a 24-byte header, an extension area
 * of tagged fields, a payload, and an 8-byte trailer; numbers are
 * little-endian.
 *
 * | Offset | Bytes | Field |
 * |---|---|---|
 * | 0 | 4 | `DHAV` |
 * | 4 | 1 | type: `0xFD` key picture, `0xFC` picture, `0xF0` sound, `0xF1` data |
 * | 6 | 1 | channel |
 * | 12 | 4 | the frame's length, from the `D` to the end of its trailer |
 * | 16 | 4 | the recorder's date, packed, to the second |
 * | 20 | 2 | a millisecond counter, which wraps |
 * | 22 | 1 | the extension area's length |
 * | 24 | | the extension area, the payload, then `dhav` and 4 more bytes |
 */

/** The header's size, in bytes. */
export const HEADER_SIZE = 24;
/** The trailer's size, in bytes. */
export const TRAILER_SIZE = 8;
/** The largest extension area: its length is one byte. */
export const MAX_EXTENSION = 255;
/** Where the first frame is in a file that starts with `DAHUA`. */
export const PREFIXED_START = 0x400;

/** The frame types. Any other is skipped by its length. */
export const FRAME = { key: 0xfd, delta: 0xfc, audio: 0xf0, data: 0xf1 } as const;

const matches = (bytes: Uint8Array, at: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false;
  }
  return true;
};

/** Whether a frame's magic, `DHAV`, is at `at`. */
export const isFrameMagic = (bytes: Uint8Array, at = 0) => matches(bytes, at, "DHAV");
/** Whether a trailer's magic, `dhav`, is at `at`. */
export const isTrailerMagic = (bytes: Uint8Array, at = 0) => matches(bytes, at, "dhav");
/** Whether the file header some recorders write, `DAHUA`, is at the start. */
export const isFilePrefix = (bytes: Uint8Array) => matches(bytes, 0, "DAHUA");

/** A frame's header. */
export interface FrameHeader {
  readonly type: number;
  readonly channel: number;
  /** The frame's whole length, as declared. */
  readonly length: number;
  /** The recorder's date, in seconds since 1970, read as UTC. */
  readonly date: number;
  /** The millisecond counter, 0 to 65,535. */
  readonly timestamp: number;
  readonly extensionLength: number;
}

/** Reads a frame's header from its first {@link HEADER_SIZE} bytes. */
export function readHeader(bytes: Uint8Array): FrameHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  const date = view.getUint32(16, true);
  return {
    type: view.getUint8(4),
    channel: view.getUint8(6),
    length: view.getUint32(12, true),
    // Date.UTC carries out-of-range fields over, so no value here can fail.
    date:
      Date.UTC(
        2000 + (date >>> 26),
        ((date >>> 22) & 0x0f) - 1,
        (date >>> 17) & 0x1f,
        (date >>> 12) & 0x1f,
        (date >>> 6) & 0x3f,
        date & 0x3f,
      ) / 1_000,
    timestamp: view.getUint16(20, true),
    extensionLength: view.getUint8(22),
  };
}

/** How many bytes each known tag takes, its own byte included. */
const TAG_SIZES = new Map<number, number>([
  ...[0x80, 0x81, 0x83, 0x84, 0x85, 0x8b, 0x94, 0x96, 0xa0, 0xb2, 0xb4].map(
    (tag) => [tag, 4] as const,
  ),
  ...[0x82, 0x88, 0x8c, 0x91, 0x92, 0x93, 0x95, 0x9a, 0x9b, 0xb3].map((tag) => [tag, 8] as const),
]);

/** What the SDK uses from a frame's extension area. */
export interface FrameTags {
  /** The video codec's number, from tag `0x81`. */
  videoCodec?: number;
  /** Frames a second, from tag `0x81`. */
  frameRate?: number;
  /** The sound's parameters, from tag `0x83` or `0x8C`. */
  audio?: { readonly channels: number; readonly codec: number; readonly rateIndex: number };
}

/**
 * Reads the tags of an extension area. An unknown tag, or one that runs past
 * the area, ends the reading: its size isn't known, and the payload starts
 * after the area whatever it holds.
 */
export function readTags(extension: Uint8Array): FrameTags {
  const tags: FrameTags = {};
  let at = 0;
  while (at < extension.length) {
    const tag = extension[at] as number;
    const size = TAG_SIZES.get(tag);
    if (size === undefined || at + size > extension.length) break;
    if (tag === 0x81) {
      tags.videoCodec = extension[at + 2] as number;
      tags.frameRate = extension[at + 3] as number;
    } else if (tag === 0x83) {
      tags.audio = {
        channels: extension[at + 1] as number,
        codec: extension[at + 2] as number,
        rateIndex: extension[at + 3] as number,
      };
    } else if (tag === 0x8c) {
      tags.audio = {
        channels: extension[at + 2] as number,
        codec: extension[at + 3] as number,
        rateIndex: extension[at + 4] as number,
      };
    }
    at += size;
  }
  return tags;
}

/** Video codec numbers the SDK doesn't read, by the name an error gives them. */
export const UNREAD_VIDEO_CODECS = new Map<number, string>([
  [0x01, "mp4v"],
  [0x03, "mjpeg"],
]);
/** The video codec number of HEVC. H.264 has three: `0x02`, `0x04` and `0x08`. */
export const HEVC_CODEC = 0x0c;

/** The sample rates a rate index names, in hertz. */
const SAMPLE_RATES = [
  8_000, 4_000, 8_000, 11_025, 16_000, 20_000, 22_050, 32_000, 44_100, 48_000, 96_000, 192_000,
  64_000,
];

/** The sample rate of a rate index, or `undefined` for one the format doesn't name. */
export const sampleRateOf = (rateIndex: number) => SAMPLE_RATES[rateIndex];

/**
 * A sound codec: its WebCodecs name, or the nearest name for one the SDK
 * can't hand to a decoder, and how many bytes one sample of one channel
 * takes, when the SDK decodes it.
 */
export interface AudioCodec {
  readonly codec: string;
  /** Bytes per sample for the codecs the SDK plays; absent for the others. */
  readonly bytesPerSample?: number;
}

/**
 * The sound codecs, by number. G.711 and 16-bit PCM are plain samples, which
 * a decoder takes as they are. The others are named, so that a file with
 * them opens with its picture and says which sound it couldn't play
 * (docs/adr/0008): how a recorder frames them isn't something a generated
 * file can show (docs/adr/0009).
 */
const AUDIO_CODECS = new Map<number, AudioCodec>([
  [0x0e, { codec: "alaw", bytesPerSample: 1 }],
  [0x0a, { codec: "ulaw", bytesPerSample: 1 }],
  [0x16, { codec: "ulaw", bytesPerSample: 1 }],
  [0x0c, { codec: "pcm-s16", bytesPerSample: 2 }],
  [0x10, { codec: "pcm-s16", bytesPerSample: 2 }],
  [0x07, { codec: "pcm-s8" }],
  [0x1a, { codec: "aac" }],
  [0x1f, { codec: "mp2" }],
  [0x21, { codec: "mp3" }],
  [0x0d, { codec: "adpcm" }],
]);

/** The sound codec of a codec number, or `undefined` for one the format doesn't name. */
export const audioCodecOf = (codec: number) => AUDIO_CODECS.get(codec);
