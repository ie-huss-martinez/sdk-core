/**
 * What the SDK reads from a stream's sequence parameter set (docs/adr/0009):
 * the codec string a decoder is configured with, and the size of the picture
 * it will produce.
 *
 * @internal
 */
export interface StreamHeader {
  /** Which codec the parameter set read as. */
  readonly kind: "h264" | "hevc";
  /** The codec, as a WebCodecs codec string, such as `"avc1.64001f"`. */
  readonly codec: string;
  /** The picture's size, after the stream's own cropping. */
  readonly width: number;
  readonly height: number;
}

/** The most `ue(v)` loops a parameter set may ask for: `num_ref_frames_in_pic_order_cnt_cycle`'s range. */
const MAX_CYCLE = 255;

/**
 * The NAL units of an Annex B stream, without their start codes, in order.
 * Bytes before the first start code aren't a NAL unit, and are left out.
 *
 * @internal
 */
export function* nalUnits(stream: Uint8Array): Generator<Uint8Array> {
  let from = -1;
  for (let at = 0; at + 3 <= stream.length; at += 1) {
    if (stream[at] !== 0 || stream[at + 1] !== 0 || stream[at + 2] !== 1) continue;
    // A four-byte start code's leading zero belongs to the code, not the unit before it.
    if (from >= 0) yield stream.subarray(from, at > from && stream[at - 1] === 0 ? at - 1 : at);
    from = at + 3;
    at += 2;
  }
  if (from >= 0) yield stream.subarray(from);
}

/** A NAL unit's payload without its emulation prevention bytes: `00 00 03` becomes `00 00`. */
function withoutEmulationPrevention(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length);
  let length = 0;
  let zeros = 0;
  for (const byte of payload) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    zeros = byte === 0 ? zeros + 1 : 0;
    out[length] = byte;
    length += 1;
  }
  return out.subarray(0, length);
}

/** Thrown inside this module when a parameter set ends early or makes no sense. */
class BitstreamError extends Error {}

/** Reads bits, most significant first. Every read is checked against the bytes that remain. */
class BitReader {
  private at = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  bit(): number {
    const byte = this.bytes[this.at >> 3];
    if (byte === undefined) throw new BitstreamError();
    const value = (byte >> (7 - (this.at & 7))) & 1;
    this.at += 1;
    return value;
  }

  bits(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) value = value * 2 + this.bit();
    return value;
  }

  skip(count: number): void {
    this.at += count;
    if (this.at > this.bytes.length * 8) throw new BitstreamError();
  }

  /** An unsigned Exp-Golomb number, `ue(v)`, of at most 32 bits. */
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros += 1;
      if (zeros > 32) throw new BitstreamError();
    }
    return 2 ** zeros - 1 + this.bits(zeros);
  }

  /** A signed Exp-Golomb number, `se(v)`. */
  se(): number {
    const value = this.ue();
    return value % 2 === 0 ? -value / 2 : (value + 1) / 2;
  }
}

const hex = (value: number, width = 2) => value.toString(16).padStart(width, "0");

/** A size a parameter set gave: whole, positive, and small enough to multiply safely. */
function size(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) throw new BitstreamError();
  return value;
}

/** H.264 profiles whose parameter sets carry the chroma format and scaling lists. */
const H264_HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(reader: BitReader, entries: number): void {
  let last = 8;
  let next = 8;
  for (let index = 0; index < entries; index += 1) {
    if (next !== 0) next = (last + reader.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

function h264(nal: Uint8Array): Omit<StreamHeader, "kind"> {
  const reader = new BitReader(withoutEmulationPrevention(nal.subarray(1)));
  const profile = reader.bits(8);
  const constraints = reader.bits(8);
  const level = reader.bits(8);
  reader.ue();
  let chroma = 1;
  let separatePlanes = 0;
  if (H264_HIGH_PROFILES.has(profile)) {
    chroma = reader.ue();
    if (chroma === 3) separatePlanes = reader.bit();
    reader.ue();
    reader.ue();
    reader.bit();
    if (reader.bit() === 1) {
      const lists = chroma === 3 ? 12 : 8;
      for (let index = 0; index < lists; index += 1) {
        if (reader.bit() === 1) skipScalingList(reader, index < 6 ? 16 : 64);
      }
    }
  }
  reader.ue();
  const orderType = reader.ue();
  if (orderType === 0) {
    reader.ue();
  } else if (orderType === 1) {
    reader.bit();
    reader.se();
    reader.se();
    const cycle = reader.ue();
    if (cycle > MAX_CYCLE) throw new BitstreamError();
    for (let index = 0; index < cycle; index += 1) reader.se();
  }
  reader.ue();
  reader.bit();
  const widthInBlocks = reader.ue() + 1;
  const heightInUnits = reader.ue() + 1;
  const framesOnly = reader.bit();
  if (framesOnly === 0) reader.bit();
  reader.bit();
  let width = size(widthInBlocks * 16);
  let height = size((2 - framesOnly) * heightInUnits * 16);
  if (reader.bit() === 1) {
    const monochrome = chroma === 0 || separatePlanes === 1;
    const unitX = monochrome || chroma === 3 ? 1 : 2;
    const unitY = (monochrome || chroma !== 1 ? 1 : 2) * (2 - framesOnly);
    const left = reader.ue();
    const right = reader.ue();
    const top = reader.ue();
    const bottom = reader.ue();
    width -= unitX * (left + right);
    height -= unitY * (top + bottom);
  }
  return {
    codec: `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`,
    width: size(width),
    height: size(height),
  };
}

function hevc(nal: Uint8Array): Omit<StreamHeader, "kind"> {
  const bytes = withoutEmulationPrevention(nal.subarray(2));
  const reader = new BitReader(bytes);
  reader.bits(4);
  const subLayers = reader.bits(3);
  reader.bit();
  const space = reader.bits(2);
  const tier = reader.bit();
  const profile = reader.bits(5);
  // The compatibility flags go into the codec string in reverse bit order.
  let compatibility = 0;
  for (let index = 0; index < 32; index += 1) compatibility += reader.bit() * 2 ** index;
  const constraints: number[] = [];
  for (let index = 0; index < 6; index += 1) constraints.push(reader.bits(8));
  const level = reader.bits(8);
  const profilePresent: number[] = [];
  const levelPresent: number[] = [];
  for (let index = 0; index < subLayers; index += 1) {
    profilePresent.push(reader.bit());
    levelPresent.push(reader.bit());
  }
  if (subLayers > 0) reader.skip(2 * (8 - subLayers));
  for (let index = 0; index < subLayers; index += 1) {
    if (profilePresent[index] === 1) reader.skip(88);
    if (levelPresent[index] === 1) reader.skip(8);
  }
  reader.ue();
  const chroma = reader.ue();
  if (chroma === 3) reader.bit();
  let width = size(reader.ue());
  let height = size(reader.ue());
  if (reader.bit() === 1) {
    const unitX = chroma === 1 || chroma === 2 ? 2 : 1;
    const unitY = chroma === 1 ? 2 : 1;
    const left = reader.ue();
    const right = reader.ue();
    const top = reader.ue();
    const bottom = reader.ue();
    width -= unitX * (left + right);
    height -= unitY * (top + bottom);
  }
  while (constraints.length > 0 && constraints.at(-1) === 0) constraints.pop();
  const codec = [
    "hev1",
    `${["", "A", "B", "C"][space]}${profile}`,
    compatibility.toString(16).toUpperCase(),
    `${tier === 1 ? "H" : "L"}${level}`,
    ...constraints.map((byte) => byte.toString(16).toUpperCase()),
  ].join(".");
  return { codec, width: size(width), height: size(height) };
}

/**
 * The header of the first sequence parameter set in an Annex B stream, as
 * H.264 or as HEVC, or `null` when it has none that reads as one. Trying
 * `"hevc"` first tells the two apart for a stream known to be HEVC; their
 * NAL unit headers differ, so a parameter set of one rarely reads as the
 * other, and a decoder's output is checked against the result either way
 * (docs/adr/0001).
 *
 * Every read is checked against the bytes that remain, and every loop is
 * bounded by the stream's length or a fixed count.
 *
 * @internal
 */
export function streamHeader(stream: Uint8Array, first: "h264" | "hevc"): StreamHeader | null {
  const order = first === "hevc" ? (["hevc", "h264"] as const) : (["h264", "hevc"] as const);
  for (const codec of order) {
    for (const nal of nalUnits(stream)) {
      const head = nal[0];
      if (head === undefined || head >> 7 === 1) continue;
      const isSet = codec === "h264" ? (head & 0x1f) === 7 : ((head >> 1) & 0x3f) === 33;
      if (!isSet) continue;
      try {
        return { kind: codec, ...(codec === "h264" ? h264(nal) : hevc(nal)) };
      } catch (error) {
        if (!(error instanceof BitstreamError)) throw error;
      }
    }
  }
  return null;
}

/** What a NAL unit is, from its first byte: a parameter set by its name, a coded picture, or anything else. */
function unitKind(
  head: number,
  kind: "h264" | "hevc",
): "vps" | "sps" | "pps" | "picture" | "other" {
  if (kind === "h264") {
    const type = head & 0x1f;
    if (type === 7) return "sps";
    if (type === 8) return "pps";
    return type >= 1 && type <= 5 ? "picture" : "other";
  }
  const type = (head >> 1) & 0x3f;
  if (type === 32) return "vps";
  if (type === 33) return "sps";
  if (type === 34) return "pps";
  return type <= 31 ? "picture" : "other";
}

/**
 * The parameter sets at the start of a picture, before its first coded
 * slice: each after a four-byte start code, joined, and whether they're all
 * a decoder needs to start there, a sequence and a picture parameter set,
 * and for HEVC a video parameter set too (docs/adr/0009). Only the bytes
 * before the first slice are looked at.
 *
 * @internal
 */
export function leadingParameterSets(
  stream: Uint8Array,
  kind: "h264" | "hevc",
): { readonly sets: Uint8Array; readonly complete: boolean } {
  const found = new Set<string>();
  const parts: Uint8Array[] = [];
  /** The parameter set whose end the next start code gives. */
  let open: number | undefined;
  const close = (end: number) => {
    if (open !== undefined) parts.push(stream.subarray(open, end));
    open = undefined;
  };
  for (let at = 0; at + 3 < stream.length; at += 1) {
    if (stream[at] !== 0 || stream[at + 1] !== 0 || stream[at + 2] !== 1) continue;
    close(at > 0 && stream[at - 1] === 0 ? at - 1 : at);
    const unit = unitKind(stream[at + 3] as number, kind);
    if (unit === "picture") break;
    if (unit !== "other") {
      found.add(unit);
      open = at + 3;
    }
    at += 2;
  }
  close(stream.length);
  const sets = new Uint8Array(parts.reduce((sum, part) => sum + 4 + part.length, 0));
  let at = 0;
  for (const part of parts) {
    sets[at + 3] = 1;
    sets.set(part, at + 4);
    at += 4 + part.length;
  }
  const complete = found.has("sps") && found.has("pps") && (kind === "h264" || found.has("vps"));
  return { sets, complete };
}
