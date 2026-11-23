import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { probeImage } from "./image-probe.js";

const blob = (...bytes: number[]) => new Blob([new Uint8Array(bytes)]);
const be32 = (value: number) => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const be16 = (value: number) => [value >>> 8, value & 255];
const le16 = (value: number) => [value & 255, value >>> 8];
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("probeImage", () => {
  it("reads a PNG's size from its IHDR chunk", async () => {
    const file = blob(
      ...PNG,
      ...be32(13),
      ...ascii("IHDR"),
      ...be32(640),
      ...be32(480),
      8,
      6,
      0,
      0,
      0,
    );
    await expect(probeImage(file)).resolves.toEqual({
      mediaType: "image/png",
      width: 640,
      height: 480,
    });
  });

  it("reads a GIF's size from its screen descriptor", async () => {
    const file = blob(...ascii("GIF89a"), ...le16(320), ...le16(200), 0, 0, 0);
    await expect(probeImage(file)).resolves.toEqual({
      mediaType: "image/gif",
      width: 320,
      height: 200,
    });
  });

  it("reads a JPEG's size from its frame header, past the segments before it", async () => {
    const app1 = [0xff, 0xe1, ...be16(8), 1, 2, 3, 4, 5, 6];
    const frame = [
      0xff,
      0xc2,
      ...be16(17),
      8,
      ...be16(1080),
      ...be16(1920),
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ];
    await expect(probeImage(blob(0xff, 0xd8, ...app1, ...frame))).resolves.toEqual({
      mediaType: "image/jpeg",
      width: 1920,
      height: 1080,
    });
  });

  it("reads each kind of WebP", async () => {
    const riff = (chunk: number[]) =>
      blob(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...chunk);
    const extended = [
      ...ascii("VP8X"),
      10,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x1f,
      0x03,
      0,
      0x57,
      0x02,
      0,
      0,
      0,
    ];
    await expect(probeImage(riff(extended))).resolves.toEqual({
      mediaType: "image/webp",
      width: 800,
      height: 600,
    });
    const lossy = [
      ...ascii("VP8 "),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...le16(400),
      ...le16(300),
      0,
      0,
    ];
    await expect(probeImage(riff(lossy))).resolves.toMatchObject({ width: 400, height: 300 });
    // Lossless: width - 1 in the low 14 bits, height - 1 in the next 14.
    const bits = 99 | (49 << 14);
    const lossless = [
      ...ascii("VP8L"),
      0,
      0,
      0,
      0,
      0x2f,
      bits & 255,
      (bits >>> 8) & 255,
      (bits >>> 16) & 255,
      bits >>> 24,
      0,
      0,
      0,
      0,
      0,
    ];
    await expect(probeImage(riff(lossless))).resolves.toMatchObject({ width: 100, height: 50 });
  });

  it("refuses what isn't one of the four kinds, whatever it's called", async () => {
    await expect(
      probeImage(new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"])),
    ).resolves.toBeUndefined();
    await expect(
      probeImage(new File(["plain text"], "photo.png", { type: "image/png" })),
    ).resolves.toBeUndefined();
    await expect(probeImage(new Blob([]))).resolves.toBeUndefined();
  });

  it("refuses a header cut short, or one with no size", async () => {
    await expect(probeImage(blob(...PNG, 0, 0, 0, 13))).resolves.toBeUndefined();
    await expect(probeImage(blob(0xff, 0xd8, 0xff, 0xda, 0, 2))).resolves.toBeUndefined();
    const empty = blob(
      ...PNG,
      ...be32(13),
      ...ascii("IHDR"),
      ...be32(0),
      ...be32(480),
      8,
      6,
      0,
      0,
      0,
    );
    await expect(probeImage(empty)).resolves.toBeUndefined();
  });

  it("never throws, and never reports a size it didn't read, for any bytes", async () => {
    const signatures = [
      PNG,
      ascii("GIF89a"),
      [0xff, 0xd8, 0xff],
      [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")],
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...signatures, []),
        fc.uint8Array({ maxLength: 200 }),
        async (signature, rest) => {
          const probe = await probeImage(new Blob([new Uint8Array(signature), rest]));
          if (probe) {
            expect(Number.isInteger(probe.width) && probe.width > 0).toBe(true);
            expect(Number.isInteger(probe.height) && probe.height > 0).toBe(true);
          }
        },
      ),
    );
  });
});
