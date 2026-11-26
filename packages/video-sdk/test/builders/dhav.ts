/**
 * Builds DHAV frames by hand (docs/adr/0009), for tests of the reader and
 * for `scripts/make-dav-fixtures.ts`, which runs this file in Node as it is:
 * no imports, and only syntax Node can strip.
 */

/** The frame types the reader knows. */
export const DHAV_TYPES = { key: 0xfd, delta: 0xfc, audio: 0xf0, data: 0xf1 } as const;

const ascii = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A frame's date, packed as the header holds it: a wall-clock time to the second. */
export function dhavDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return (
    ((((year - 2000) & 0x3f) << 26) |
      ((month & 0x0f) << 22) |
      ((day & 0x1f) << 17) |
      ((hour & 0x1f) << 12) |
      ((minute & 0x3f) << 6) |
      (second & 0x3f)) >>>
    0
  );
}

/** The date `seconds` after 1 January 2024, 00:00:00, within that day. */
export function dhavClock(seconds: number): number {
  const whole = Math.floor(seconds);
  return dhavDate(
    2024,
    1,
    1,
    Math.floor(whole / 3_600) % 24,
    Math.floor(whole / 60) % 60,
    whole % 60,
  );
}

/** The tags of a frame's extension area. */
export const dhavTags = {
  /** `0x80`: the picture's size, in units of 8 pixels. */
  size8: (width: number, height: number) => Uint8Array.of(0x80, 0, width / 8, height / 8),
  /** `0x81`: the video codec and the frame rate. `0x08` is H.264 and `0x0c` HEVC. */
  video: (codec: number, frameRate: number) => Uint8Array.of(0x81, 0, codec, frameRate),
  /** `0x82`: the picture's size, as two 16-bit numbers. */
  size16: (width: number, height: number) =>
    Uint8Array.of(0x82, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8),
  /** `0x83`: the sound's channels, codec and sample-rate index. `0x0e` is A-law, and index 2 is 8 kHz. */
  audio: (channels: number, codec: number, rateIndex: number) =>
    Uint8Array.of(0x83, channels, codec, rateIndex),
  /** `0x88`: eight bytes the reader skips. */
  skipped: () => Uint8Array.of(0x88, 0, 0, 0, 0, 0, 0, 0),
};

export interface DhavFrameSpec {
  /** One of {@link DHAV_TYPES}, or any other byte. */
  readonly type: number;
  readonly payload?: Uint8Array;
  /** The extension area: tags from {@link dhavTags}, joined. */
  readonly extension?: Uint8Array;
  readonly channel?: number;
  readonly number?: number;
  /** The packed date; see {@link dhavDate}. */
  readonly date?: number;
  /** The 16-bit millisecond counter. */
  readonly timestamp?: number;
  /** Overrides the frame length the header declares. */
  readonly length?: number;
  /** Overrides the 8-byte trailer; an empty array leaves it out. */
  readonly trailer?: Uint8Array;
  /** Overrides the leading magic. */
  readonly magic?: string;
}

/**
 * One frame: the 24-byte header, the extension area, the payload, and the
 * trailer, `dhav` and the frame's length again. The header's checksum byte
 * is left at 0: no reader here checks it.
 */
export function dhavFrame(spec: DhavFrameSpec): Uint8Array {
  const extension = spec.extension ?? new Uint8Array(0);
  const payload = spec.payload ?? new Uint8Array(0);
  const real = 24 + extension.length + payload.length + 8;
  const length = spec.length ?? real;
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  header.set(ascii(spec.magic ?? "DHAV"), 0);
  header[4] = spec.type;
  header[6] = spec.channel ?? 0;
  view.setUint32(8, spec.number ?? 0, true);
  view.setUint32(12, length, true);
  view.setUint32(16, spec.date ?? dhavClock(0), true);
  view.setUint16(20, (spec.timestamp ?? 0) & 0xffff, true);
  header[22] = extension.length;
  const trailer = new Uint8Array(8);
  trailer.set(ascii("dhav"), 0);
  new DataView(trailer.buffer).setUint32(4, length, true);
  return concat(header, extension, payload, spec.trailer ?? trailer);
}

/** The 1,024-byte file header some recorders write before the first frame. */
export function dahuaPrefix(): Uint8Array {
  const out = new Uint8Array(0x400);
  out.set(ascii("DAHUA"), 0);
  return out;
}

/** Splits an Annex B stream into its NAL units, without their start codes. */
export function splitNals(stream: Uint8Array): Uint8Array[] {
  const starts: [number, number][] = [];
  for (let at = 0; at + 3 <= stream.length; at += 1) {
    if (stream[at] === 0 && stream[at + 1] === 0 && stream[at + 2] === 1) {
      starts.push([at > 0 && stream[at - 1] === 0 ? at - 1 : at, at + 3]);
      at += 2;
    }
  }
  return starts.map(([, from], index) =>
    stream.subarray(from, starts[index + 1]?.[0] ?? stream.length),
  );
}

/** Joins NAL units into an Annex B stream, each after a 4-byte start code. */
export function joinNals(nals: readonly Uint8Array[]): Uint8Array {
  return concat(...nals.flatMap((nal) => [Uint8Array.of(0, 0, 0, 1), nal]));
}
