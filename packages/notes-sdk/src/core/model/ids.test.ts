import { describe, expect, it } from "vitest";
import { assetNameOf, createNotesId, isAssetName, isNotesId } from "./ids.js";
import { NOTES_MAX_ID_LENGTH } from "./portable.js";

describe("isNotesId", () => {
  it("accepts 1 to 64 characters from A-Z, a-z, 0-9, _ and -", () => {
    for (const id of [
      "a",
      "Z",
      "0",
      "_",
      "-",
      "page-1",
      "A-Z_a-z_0-9",
      "a".repeat(NOTES_MAX_ID_LENGTH),
    ]) {
      expect(isNotesId(id), id).toBe(true);
    }
  });

  it("accepts the names of Object.prototype's properties, which are ids like any other", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(isNotesId(id), id).toBe(true);
    }
  });

  it("refuses an empty id, a longer one, and any other character", () => {
    const ids = [
      "",
      "a".repeat(NOTES_MAX_ID_LENGTH + 1),
      "a b",
      "a.b",
      "a/b",
      "../a",
      "a\n",
      "\na",
      "a\u0000",
      "caf\u00E9",
      "\u{1F4D3}",
    ];
    for (const id of ids) expect(isNotesId(id), JSON.stringify(id)).toBe(false);
  });

  it("refuses what isn't text", () => {
    for (const value of [1, null, undefined, {}, ["a"], new String("a")]) {
      expect(isNotesId(value)).toBe(false);
    }
  });
});

describe("createNotesId", () => {
  it("makes an id of 22 characters, which holds over 128 random bits", () => {
    const id = createNotesId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isNotesId(id)).toBe(true);
    // 22 characters of a 64-letter alphabet are 132 bits.
    expect(22 * Math.log2(64)).toBeGreaterThanOrEqual(128);
  });

  it("makes a new id every time", () => {
    const ids = new Set(Array.from({ length: 10_000 }, createNotesId));
    expect(ids.size).toBe(10_000);
  });

  it("uses every character of its alphabet, and no other", () => {
    const seen = new Set(Array.from({ length: 2_000 }, createNotesId).join(""));
    expect(seen.size).toBe(64);
    expect([...seen].every((character) => /[A-Za-z0-9_-]/.test(character))).toBe(true);
  });
});

describe("isAssetName", () => {
  const name = `sha256:${"0a".repeat(32)}`;

  it("accepts sha256: and 64 lowercase hexadecimal digits", () => {
    expect(isAssetName(name)).toBe(true);
    expect(isAssetName(`sha256:${"f".repeat(64)}`)).toBe(true);
  });

  it("refuses anything else", () => {
    const names = [
      `sha256:${"0A".repeat(32)}`,
      `sha256:${"0".repeat(63)}`,
      `sha256:${"0".repeat(65)}`,
      `SHA256:${"0a".repeat(32)}`,
      `sha512:${"0a".repeat(32)}`,
      "0a".repeat(32),
      `${name}\n`,
      ` ${name}`,
      `sha256:${"g".repeat(64)}`,
      "",
      1,
      null,
      undefined,
    ];
    for (const value of names) expect(isAssetName(value), String(value)).toBe(false);
  });
});

describe("assetNameOf", () => {
  it("names no bytes by the SHA-256 of the empty input", async () => {
    const empty = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(await assetNameOf(new Uint8Array(0))).toBe(empty);
    expect(await assetNameOf(new ArrayBuffer(0))).toBe(empty);
  });

  it("names the bytes of abc by their known SHA-256", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await assetNameOf(abc)).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives a valid asset name, with leading zeros kept", async () => {
    // The SHA-256 of these bytes starts with a zero byte only for some inputs, so check many.
    for (let value = 0; value < 64; value += 1) {
      expect(isAssetName(await assetNameOf(new Uint8Array([value])))).toBe(true);
    }
  });

  it("names a view by its own bytes, not its whole buffer", async () => {
    const whole = new TextEncoder().encode("xabcx");
    expect(await assetNameOf(whole.subarray(1, 4))).toBe(
      await assetNameOf(new TextEncoder().encode("abc")),
    );
  });

  it("gives equal bytes one name, and other bytes another", async () => {
    const a = await assetNameOf(new Uint8Array([1, 2, 3]));
    expect(await assetNameOf(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(await assetNameOf(new Uint8Array([1, 2, 4]))).not.toBe(a);
  });
});
