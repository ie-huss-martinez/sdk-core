import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { joinNals } from "../../../test/builders/dhav.js";
import { nalUnits, streamHeader } from "./bitstream.js";

const fixture = async (name: string) =>
  new Uint8Array(await readFile(`test/fixtures/video/${name}`));

function find(bytes: Uint8Array, type: string): number {
  const codes = Array.from(type, (char) => char.charCodeAt(0));
  for (let at = 0; at + 4 <= bytes.length; at += 1) {
    if (codes.every((code, index) => bytes[at + index] === code)) return at;
  }
  throw new Error(`no ${type}`);
}

/** The sequence parameter set an MP4's `avcC` box holds. */
function avcSps(mp4: Uint8Array): Uint8Array {
  // After the type: five fixed bytes, a count, then a 16-bit length.
  const at = find(mp4, "avcC") + 4 + 6;
  const length = ((mp4[at] as number) << 8) | (mp4[at + 1] as number);
  return mp4.subarray(at + 2, at + 2 + length);
}

/** The sequence parameter set an MP4's `hvcC` box holds: the first NAL unit of type 33. */
function hevcSps(mp4: Uint8Array): Uint8Array {
  // After the type: 22 fixed bytes, a count of arrays, then each array's
  // type, a 16-bit count of units, and each unit after its 16-bit length.
  let at = find(mp4, "hvcC") + 4 + 22;
  const arrays = mp4[at] as number;
  at += 1;
  for (let array = 0; array < arrays; array += 1) {
    const type = (mp4[at] as number) & 0x3f;
    const units = ((mp4[at + 1] as number) << 8) | (mp4[at + 2] as number);
    at += 3;
    for (let unit = 0; unit < units; unit += 1) {
      const length = ((mp4[at] as number) << 8) | (mp4[at + 1] as number);
      if (type === 33) return mp4.subarray(at + 2, at + 2 + length);
      at += 2 + length;
    }
  }
  throw new Error("no HEVC parameter set");
}

describe("splitting an Annex B stream", () => {
  it("gives each NAL unit without its start code, of three bytes or four", () => {
    const stream = Uint8Array.of(9, 9, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65);
    expect([...nalUnits(stream)].map((nal) => [...nal])).toEqual([[0x67, 1, 2], [0x68, 3], [0x65]]);
  });

  it("gives nothing for bytes without a start code", () => {
    expect([...nalUnits(Uint8Array.of(1, 2, 3, 4))]).toEqual([]);
    expect([...nalUnits(new Uint8Array(0))]).toEqual([]);
  });
});

describe("reading a stream's parameter set", () => {
  it("reads H.264's profile, level and cropped size", async () => {
    // 720 lines are 45 macroblocks, coded as 46 with 16 lines cropped.
    const sps = avcSps(await fixture("landscape.mp4"));
    expect(streamHeader(joinNals([sps]), "h264")).toEqual({
      codec: "avc1.64001f",
      width: 1280,
      height: 720,
    });
  });

  it("reads HEVC's profile, tier, level and cropped size", async () => {
    const sps = hevcSps(await fixture("hevc.mp4"));
    expect(streamHeader(joinNals([sps]), "hevc")).toEqual({
      codec: "hev1.1.6.L60.90",
      width: 320,
      height: 180,
    });
  });

  it("finds the set after other units, and tells the codecs apart whichever is tried first", async () => {
    const avc = joinNals([Uint8Array.of(0x09, 0xf0), avcSps(await fixture("landscape.mp4"))]);
    const hevc = joinNals([Uint8Array.of(0x40, 0x01, 0x0c), hevcSps(await fixture("hevc.mp4"))]);
    expect(streamHeader(avc, "hevc")?.codec).toBe("avc1.64001f");
    expect(streamHeader(hevc, "h264")?.codec).toBe("hev1.1.6.L60.90");
  });

  it("gives null for a stream without one, and for one cut at any length", async () => {
    expect(streamHeader(joinNals([Uint8Array.of(0x65, 1, 2, 3)]), "h264")).toBeNull();
    expect(streamHeader(new Uint8Array(64), "h264")).toBeNull();
    for (const [sps, codec] of [
      [avcSps(await fixture("landscape.mp4")), "h264"],
      [hevcSps(await fixture("hevc.mp4")), "hevc"],
    ] as const) {
      for (let length = 0; length < sps.length - 1; length += 1) {
        // Whatever a cut set reads as, it's a size or nothing: never a throw.
        const header = streamHeader(joinNals([sps.subarray(0, length)]), codec);
        if (header) expect(header.width * header.height).toBeGreaterThan(0);
      }
    }
  });

  it("gives null for a set that declares no size, or one too large to be real", () => {
    // H.264, Baseline: five one-bit fields and a flag, then an Exp-Golomb
    // run of more than 32 zeros where the width is.
    const endless = Uint8Array.of(0x67, 66, 0, 30, 0xf8, 0, 0, 0, 0, 0, 0xff);
    expect(streamHeader(joinNals([endless]), "h264")).toBeNull();
  });
});
