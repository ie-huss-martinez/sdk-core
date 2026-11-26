import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  concat,
  DHAV_TYPES,
  type DhavFrameSpec,
  dahuaPrefix,
  dhavClock,
  dhavFrame,
  dhavTags,
} from "../../../test/builders/dhav.js";
import { isVideoError } from "../../core/errors/video-error.js";
import { type VideoFilePolicyOverrides, videoLimits } from "../../core/errors/video-limits.js";
import { checkProbe } from "../../core/model/probe-limits.js";
import { frontCheck } from "../front-check/front-check.js";
import { probeFile } from "../probe.js";
import { openDhavTracks } from "./tracks.js";

const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);
const fixture = async (name: string) =>
  new Uint8Array(await readFile(`test/fixtures/video/${name}`));
const probe = (bytes: Uint8Array, overrides: VideoFilePolicyOverrides = {}) =>
  probeFile(blob(bytes), videoLimits.resolve(overrides));

/** The index the front check builds, with each track's times in milliseconds. */
async function index(bytes: Uint8Array) {
  const front = await frontCheck(blob(bytes), videoLimits.resolve());
  if (front.family !== "dhav") throw new Error("not a DHAV file");
  const milliseconds = (times: Float64Array) => Array.from(times, (time) => time / 1_000);
  return {
    front,
    video: milliseconds(front.index.video.times),
    audio: front.index.audio ? milliseconds(front.index.audio.times) : null,
  };
}

async function failure(bytes: Uint8Array, overrides: VideoFilePolicyOverrides = {}) {
  try {
    await probe(bytes, overrides);
  } catch (error) {
    if (!isVideoError(error)) throw error;
    return { code: error.code, ...(error.details as { reason?: string; codec?: string }) };
  }
  throw new Error("expected the probe to fail");
}

/** The fixture's first key picture: real H.264, with its parameter sets. */
const keyPayload = (async () => {
  const bytes = await fixture("numbered.dav");
  const extension = bytes[22] as number;
  const length = new DataView(bytes.buffer).getUint32(12, true);
  return bytes.slice(24 + extension, length - 8);
})();
/** A picture that isn't a key picture: one slice's start, never decoded here. */
const DELTA = Uint8Array.of(0, 0, 0, 1, 0x41, 0x9a, 0x00, 0x10);
const SOUND = new Uint8Array(320).fill(0xd5);

/** A picture at a time in milliseconds on the recorder's clock; the first is a key picture. */
async function picture(time: number, spec: Partial<DhavFrameSpec> = {}): Promise<Uint8Array> {
  const key = spec.type === DHAV_TYPES.key;
  return dhavFrame({
    type: DHAV_TYPES.delta,
    payload: key ? await keyPayload : DELTA,
    timestamp: time,
    date: dhavClock(time / 1_000),
    ...(key ? { extension: dhavTags.video(0x08, 25) } : {}),
    ...spec,
  });
}
const key = (time: number, spec: Partial<DhavFrameSpec> = {}) =>
  picture(time, { type: DHAV_TYPES.key, ...spec });
const sound = (time: number, spec: Partial<DhavFrameSpec> = {}) =>
  dhavFrame({
    type: DHAV_TYPES.audio,
    payload: SOUND,
    timestamp: time,
    date: dhavClock(time / 1_000),
    extension: dhavTags.audio(1, 0x0e, 2),
    ...spec,
  });
const file = async (...frames: (Uint8Array | Promise<Uint8Array>)[]) =>
  concat(...(await Promise.all(frames)));

describe("probing the generated DAV fixtures", () => {
  it("reads numbered.dav: H.264 without a description, and A-law sound", async () => {
    const probed = await probe(await fixture("numbered.dav"));
    expect(probed).toMatchObject({ container: "dav", tracks: 2, start: 0, duration: 3_000_000 });
    expect(probed.video).toEqual({
      codec: "avc1.64000a",
      codedWidth: 256,
      codedHeight: 32,
      displayWidth: 256,
      displayHeight: 32,
      rotation: 0,
      frameRate: 25,
      packets: 75,
    });
    expect(probed.audio).toEqual({ codec: "alaw", sampleRate: 8_000, channels: 1 });
    // 75 pictures of 21 bytes and 75 sound frames of 20, in the index.
    expect(probed.indexSize).toBe(75 * 21 + 75 * 20);
    expect(probed.peakBitrate).toBeGreaterThan(0);
    expect(probed.maxPacketSize).toBeGreaterThan(320);
    expect(checkProbe(videoLimits.resolve(), probed)).toEqual([]);
  });

  it("reads hevc.dav: HEVC, and no sound", async () => {
    const probed = await probe(await fixture("hevc.dav"));
    expect(probed).toMatchObject({ container: "dav", tracks: 1, duration: 480_000, audio: null });
    expect(probed.video).toMatchObject({
      codec: "hev1.1.6.L30.90",
      codedWidth: 256,
      codedHeight: 32,
      // All twelve pictures are within one second.
      frameRate: 12,
      packets: 12,
    });
  });
});

describe("a DHAV file's structure", () => {
  it("is recognised by its first frame, or by the DAHUA header before it", async () => {
    const frames = await file(key(0), picture(40));
    expect((await index(frames)).video).toEqual([0, 40]);
    expect((await index(concat(dahuaPrefix(), frames))).video).toEqual([0, 40]);
    expect(await failure(dahuaPrefix())).toEqual({
      code: "UNSUPPORTED_FORMAT",
      container: "dav",
      reason: "signature",
    });
  });

  it("skips data frames, unknown types, empty frames and bytes between frames", async () => {
    const bytes = await file(
      dhavFrame({ type: DHAV_TYPES.data, payload: new Uint8Array(40) }),
      key(0),
      Uint8Array.of(1, 2, 3, 0x44, 0x48, 0x41, 5),
      dhavFrame({ type: 0x7a, payload: new Uint8Array(9) }),
      picture(40, { payload: new Uint8Array(0) }),
      picture(80),
      Uint8Array.of(0x44, 0x48),
    );
    expect((await index(bytes)).video).toEqual([0, 80]);
  });

  it("starts at the first key picture, and keeps to its channel", async () => {
    const bytes = await file(
      picture(0),
      key(40, { channel: 2 }),
      picture(80, { channel: 2 }),
      picture(80, { channel: 3 }),
      key(120, { channel: 3 }),
      sound(120, { channel: 2 }),
      sound(160, { channel: 5 }),
    );
    const { front, video, audio } = await index(bytes);
    expect(video).toEqual([0, 40]);
    expect(audio).toEqual([80]);
    // Pictures on channels 0, 2 and 3, and sound on channels 2 and 5.
    expect(front.tracks).toBe(5);
  });

  it.each([
    ["cut inside its header", async () => (await key(0)).subarray(0, 20), "truncated"],
    ["cut inside its payload", async () => (await key(0)).subarray(0, 100), "truncated"],
    ["shorter than a header", () => key(0, { length: 23 }), "frame-size"],
    [
      "too short for its extension area",
      () => dhavFrame({ type: DHAV_TYPES.key, extension: new Uint8Array(40), length: 60 }),
      "frame-size",
    ],
    ["without its trailer", () => key(0, { trailer: new Uint8Array(8) }), "frame-trailer"],
    ["whose key picture has no parameter set", () => key(0, { payload: DELTA }), "parameter-sets"],
  ])("refuses a frame %s as malformed", async (_, frame, reason) => {
    // After a whole frame, so the file is recognised, and before another.
    const bytes = await file(
      dhavFrame({ type: DHAV_TYPES.data }),
      frame(),
      new Uint8Array(reason === "truncated" ? 0 : 64),
    );
    expect(await failure(bytes)).toEqual({ code: "INVALID_VIDEO", container: "dav", reason });
  });

  it("refuses a file without a key picture, and a codec it doesn't read", async () => {
    expect(await failure(await file(picture(0), sound(0)))).toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      reason: "no-video",
    });
    const mpeg4 = await key(0, { extension: dhavTags.video(0x01, 25) });
    expect(await failure(mpeg4)).toMatchObject({ code: "UNSUPPORTED_CODEC", codec: "mp4v" });
  });

  it("reads the codec from the stream, whatever number the recorder declares", async () => {
    // The fixture's H.264, declared as HEVC, and with no declaration at all.
    for (const extension of [dhavTags.video(0x0c, 25), new Uint8Array(0)]) {
      const probed = await probe(await key(0, { extension }));
      expect(probed.video.codec).toBe("avc1.64000a");
    }
  });

  it("ends the reading of an extension area at a tag it doesn't know", async () => {
    const extension = concat(
      dhavTags.video(0x08, 10),
      Uint8Array.of(0xee, 1),
      dhavTags.video(0x01, 50),
    );
    const { front } = await index(await key(0, { extension }));
    if (front.family !== "dhav") throw new Error("not a DHAV file");
    expect(front.index.video.period).toBe(100_000);
  });
});

describe("a DHAV file's limits", () => {
  it("stops once a track has more packets than the limits allow", async () => {
    // 100 ms at 120 frames a second allows 12 pictures, and 100 sound frames.
    const pictures = Array.from({ length: 14 }, (_, n) => (n === 0 ? key(0) : picture(n * 40)));
    expect(await failure(await file(...pictures), { maxDuration: 100 })).toMatchObject({
      code: "FRAME_RATE_TOO_HIGH",
    });
    const sounds = Array.from({ length: 102 }, (_, n) => sound(n * 40));
    expect(await failure(await file(key(0), ...sounds), { maxDuration: 100 })).toMatchObject({
      code: "DURATION_TOO_LONG",
    });
  });

  it("stops once the index is larger than maxIndexSize", async () => {
    const bytes = await file(key(0), picture(40), picture(80));
    expect((await probe(bytes, { maxIndexSize: 63 })).indexSize).toBe(63);
    expect(await failure(bytes, { maxIndexSize: 62 })).toMatchObject({ code: "INDEX_TOO_LARGE" });
  });

  it("stops after as many frames as the limits allow packets, plus the margin", async () => {
    const data = dhavFrame({ type: DHAV_TYPES.data });
    const many = concat(await key(0), ...Array.from({ length: 10_112 }, () => data));
    expect(await failure(many, { maxDuration: 100 })).toMatchObject({
      code: "INVALID_VIDEO",
      reason: "too-many-elements",
    });
  });
});

describe("a DHAV file's timeline", () => {
  it("follows the millisecond counter through its wrap", async () => {
    const bytes = await file(key(65_480), picture(65_520), picture(65_560), picture(65_600));
    expect((await index(bytes)).video).toEqual([0, 40, 80, 120]);
  });

  it("keeps a short gap, such as a dropped picture", async () => {
    expect((await index(await file(key(0), picture(40), picture(160)))).video).toEqual([
      0, 40, 160,
    ]);
  });

  it("closes a gap in the recording to one picture's length, as the recorder declares it", async () => {
    const bytes = await file(key(0), picture(40), picture(10_040), picture(10_080));
    expect((await index(bytes)).video).toEqual([0, 40, 80, 120]);
    const slow = dhavTags.video(0x08, 10);
    const tenASecond = await file(key(0, { extension: slow }), picture(100), picture(60_100));
    expect((await index(tenASecond)).video).toEqual([0, 100, 200]);
  });

  it("closes a jump the counter hides but the dates show", async () => {
    // Two wraps of the counter later, less 32 ms: the counter alone says 40 ms.
    const later = picture(80, { date: dhavClock(131.112) });
    expect((await index(await file(key(0), picture(40), later))).video).toEqual([0, 40, 80]);
  });

  it("closes a clock that goes back", async () => {
    const bytes = await file(key(30_000), picture(30_040), picture(1_000), picture(1_040));
    expect((await index(bytes)).video).toEqual([0, 40, 80, 120]);
  });

  it("never gives two pictures one time", async () => {
    const bytes = await file(key(0), picture(0), picture(40), picture(40), picture(80));
    expect((await index(bytes)).video).toEqual([0, 1, 40, 41, 80]);
  });

  it("places the picture and the sound on one clock, and closes a gap for both", async () => {
    const bytes = await file(
      key(0),
      sound(0),
      picture(40),
      sound(40),
      sound(20_000),
      picture(20_000),
      sound(20_040),
      picture(20_040),
    );
    const { video, audio } = await index(bytes);
    expect(audio).toEqual([0, 40, 80, 120]);
    expect(video).toEqual([0, 40, 80, 120]);
  });

  it("measures the file from its first picture to the end of the longer track", async () => {
    const bytes = await file(sound(0), key(40), sound(40), picture(80), sound(80));
    const probed = await probe(bytes);
    expect(probed.start).toBe(40_000);
    // The sound ends 40 ms after its last frame starts, as the pictures do.
    expect(probed.duration).toBe(80_000);
  });
});

describe("a DHAV file's sound", () => {
  it.each([
    [0x0e, "alaw", 40_000],
    [0x0a, "ulaw", 40_000],
    [0x16, "ulaw", 40_000],
    [0x10, "pcm-s16", 20_000],
  ])("plays codec %d as %s", async (codec, name, duration) => {
    const bytes = await file(key(0), sound(0, { extension: dhavTags.audio(1, codec, 2) }));
    const { front } = await index(bytes);
    if (front.family !== "dhav") throw new Error("not a DHAV file");
    expect(front.index.audio).toMatchObject({ codec: name, sampleRate: 8_000, playable: true });
    expect(front.index.audio?.duration(320)).toBe(duration);
    const tracks = openDhavTracks(blob(bytes), front.index);
    expect(await tracks.audio?.config()).toEqual({
      codec: name,
      sampleRate: 8_000,
      numberOfChannels: 1,
    });
  });

  it("names sound it doesn't play, without a decoder configuration", async () => {
    const bytes = await file(key(0), sound(0, { extension: dhavTags.audio(2, 0x1a, 4) }));
    expect((await probe(bytes)).audio).toEqual({ codec: "aac", sampleRate: 16_000, channels: 2 });
    const { front } = await index(bytes);
    if (front.family !== "dhav") throw new Error("not a DHAV file");
    expect(await openDhavTracks(blob(bytes), front.index).audio?.config()).toBeNull();
  });

  it.each([
    ["a codec the format doesn't name", dhavTags.audio(1, 0x55, 2)],
    ["a sample rate the format doesn't name", dhavTags.audio(1, 0x0e, 13)],
    ["no channels", dhavTags.audio(0, 0x0e, 2)],
    ["no parameters", new Uint8Array(0)],
  ])("leaves out sound with %s, and still counts its track", async (_, extension) => {
    const probed = await probe(await file(key(0), sound(0, { extension })));
    expect(probed.audio).toBeNull();
    expect(probed.tracks).toBe(2);
  });

  it("reads the second kind of sound tag too", async () => {
    const extension = Uint8Array.of(0x8c, 0, 1, 0x0e, 4, 0, 0, 0);
    const probed = await probe(await file(key(0), sound(0, { extension })));
    expect(probed.audio).toEqual({ codec: "alaw", sampleRate: 16_000, channels: 1 });
  });
});

describe("reading a DHAV file's packets", () => {
  const open = async () => {
    const bytes = await fixture("numbered.dav");
    const { front } = await index(bytes);
    if (front.family !== "dhav") throw new Error("not a DHAV file");
    return openDhavTracks(blob(bytes), front.index);
  };

  it("walks the pictures in order, a key picture each second", async () => {
    const packets = (await open()).video.packets();
    const seen: [string, number][] = [];
    for (let packet = await packets.getFirstPacket(); packet; ) {
      seen.push([packet.type, packet.microsecondTimestamp]);
      packet = await packets.getNextPacket(packet);
    }
    expect(seen).toHaveLength(75);
    expect(seen.filter(([type]) => type === "key").map(([, time]) => time)).toEqual([
      0, 1_000_000, 2_000_000,
    ]);
    expect(seen.map(([, time]) => time)).toEqual(Array.from({ length: 75 }, (_, n) => n * 40_000));
  });

  it("finds the key picture at or before a time, and none before the first", async () => {
    const packets = (await open()).video.packets();
    expect((await packets.getKeyPacket(1.5))?.microsecondTimestamp).toBe(1_000_000);
    expect((await packets.getKeyPacket(2))?.microsecondTimestamp).toBe(2_000_000);
    expect((await packets.getKeyPacket(99))?.microsecondTimestamp).toBe(2_000_000);
    expect(await packets.getKeyPacket(-1)).toBeNull();
  });

  it("finds the sound at or before a time", async () => {
    const packets = (await open()).audio?.packets();
    expect((await packets?.getPacket(1.05))?.microsecondTimestamp).toBe(1_040_000);
    expect(await packets?.getPacket(-1)).toBeNull();
    const last = await packets?.getPacket(99);
    expect(last?.microsecondTimestamp).toBe(2_960_000);
    expect(last && (await packets?.getNextPacket(last))).toBeNull();
  });

  it("fails with INVALID_VIDEO when the file is shorter than when it was indexed", async () => {
    const bytes = await fixture("numbered.dav");
    const { front } = await index(bytes);
    if (front.family !== "dhav") throw new Error("not a DHAV file");
    const packets = openDhavTracks(blob(bytes.subarray(0, 100)), front.index).video.packets();
    await expect(packets.getFirstPacket()).rejects.toMatchObject({ code: "INVALID_VIDEO" });
  });
});
