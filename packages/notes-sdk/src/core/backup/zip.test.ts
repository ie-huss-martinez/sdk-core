import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, crc32 as zlibCrc32 } from "node:zlib";
import fc from "fast-check";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  crc32,
  createZipWriter,
  readZip,
  type ZipLimits,
  type ZipRecord,
  zipDirectoryRecord,
  zipEndRecords,
  zipLocalHeader,
} from "./zip.js";

type Bytes = Uint8Array<ArrayBuffer>;

const LIMITS: ZipLimits = { maxEntries: 100_000, maxSize: 100_000_000 };
const MALFORMED = { code: "INVALID_DOCUMENT", details: { reason: "malformed-archive" } };

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const bytesOf = async (blob: Blob): Promise<Bytes> => new Uint8Array(await blob.arrayBuffer());

/** Bytes that deflate can't shrink: a fixed pseudo-random sequence. */
function noise(length: number): Bytes {
  const bytes = new Uint8Array(length);
  let state = 0x2545f491;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

async function archiveOf(
  entries: Readonly<Record<string, Blob | Uint8Array>>,
  options?: { readonly compress?: boolean },
): Promise<Blob> {
  const zip = createZipWriter();
  for (const [name, data] of Object.entries(entries)) await zip.add(name, data, options);
  return zip.finish();
}

// Where the fields a test changes are, in each record.
const LOCAL = { flags: 6, method: 8, crc: 14, compressedSize: 18, size: 22, extraSize: 28 };
const DIRECTORY = {
  flags: 8,
  method: 10,
  crc: 16,
  compressedSize: 20,
  size: 24,
  extraSize: 30,
  disk: 34,
  offset: 42,
};
const END = { disk: 4, countOnDisk: 8, count: 10, directorySize: 12, directoryOffset: 16 };

type Change = (record: Bytes) => Bytes;

const set16 =
  (at: number, value: number): Change =>
  (record) => {
    new DataView(record.buffer).setUint16(at, value, true);
    return record;
  };
const set32 =
  (at: number, value: number): Change =>
  (record) => {
    new DataView(record.buffer).setUint32(at, value, true);
    return record;
  };
const both =
  (...changes: readonly Change[]): Change =>
  (record) =>
    changes.reduce((changed, change) => change(changed), record);

/** Appends an extra field to a record that has no comment, and sets its length. */
const withExtra =
  (sizeAt: number, extra: Uint8Array): Change =>
  (record) => {
    const longer = new Uint8Array(record.length + extra.length);
    longer.set(record);
    longer.set(extra, record.length);
    new DataView(longer.buffer).setUint16(sizeAt, extra.length, true);
    return longer;
  };

/** A ZIP64 extra field holding the values given. */
function zip64Extra(...values: readonly number[]): Bytes {
  const extra = new Uint8Array(4 + 8 * values.length);
  const view = new DataView(extra.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 8 * values.length, true);
  values.forEach((value, index) => {
    view.setBigUint64(4 + 8 * index, BigInt(value), true);
  });
  return extra;
}

interface Part {
  readonly name: string | Uint8Array;
  /** The entry's bytes as the archive holds them. */
  readonly body?: Uint8Array;
  readonly method?: number;
  /** What the records declare. By default, what's true of a stored body. */
  readonly size?: number;
  readonly crc?: number;
  readonly local?: Change;
  readonly directory?: Change;
  /** Bytes after the data, such as a data descriptor. */
  readonly after?: Uint8Array;
}

interface Layout {
  readonly count: number;
  readonly directorySize: number;
  readonly directoryOffset: number;
}

/** An archive built by hand, so a test can make one no writer would. */
function build(
  parts: readonly Part[],
  options: {
    readonly end?: Change;
    /** Replaces the end records altogether. */
    readonly endRecords?: (layout: Layout) => Uint8Array;
    readonly tail?: Uint8Array;
  } = {},
): Blob {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const body = part.body ?? new Uint8Array(0);
    const record: ZipRecord = {
      name: typeof part.name === "string" ? utf8(part.name) : part.name,
      method: part.method ?? 0,
      crc: part.crc ?? crc32(body),
      size: part.size ?? body.length,
      compressedSize: body.length,
      offset,
    };
    const header = (part.local ?? ((bytes) => bytes))(zipLocalHeader(record));
    const after = part.after ?? new Uint8Array(0);
    chunks.push(header, body, after);
    directory.push((part.directory ?? ((bytes) => bytes))(zipDirectoryRecord(record)));
    offset += header.length + body.length + after.length;
  }
  const layout: Layout = {
    count: parts.length,
    directorySize: directory.reduce((sum, record) => sum + record.length, 0),
    directoryOffset: offset,
  };
  const end = options.endRecords
    ? options.endRecords(layout)
    : (options.end ?? ((bytes) => bytes))(
        zipEndRecords(layout.count, layout.directorySize, layout.directoryOffset),
      );
  return new Blob([...chunks, ...directory, end, options.tail ?? new Uint8Array(0)] as BlobPart[]);
}

function deflated(name: string, data: Uint8Array): Part {
  return {
    name,
    body: new Uint8Array(deflateRawSync(data)),
    method: 8,
    size: data.length,
    crc: crc32(data),
  };
}

/** The first place a signature is at, as the four bytes it's written as. */
function indexOfSignature(bytes: Uint8Array, signature: number, from = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = from; at + 4 <= bytes.length; at += 1) {
    if (view.getUint32(at, true) === signature) return at;
  }
  return -1;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("crc32", () => {
  it("gives the check value of the standard", () => {
    expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("agrees with zlib, in one piece or continued over several", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2000 }), fc.nat(), (data, cut) => {
        const at = data.length === 0 ? 0 : cut % (data.length + 1);
        expect(crc32(data)).toBe(zlibCrc32(data));
        expect(crc32(data.subarray(at), crc32(data.subarray(0, at)))).toBe(zlibCrc32(data));
      }),
    );
  });
});

describe("createZipWriter and readZip", () => {
  it("round-trips stored and deflated entries, an empty one, binary data and UTF-8 names", async () => {
    const text = utf8("The quick brown fox jumps over the lazy dog. ".repeat(200));
    const binary = noise(5000);
    const zip = createZipWriter();
    await zip.add("text.txt", text);
    await zip.add("stored.txt", text, { compress: false });
    await zip.add("empty", new Uint8Array(0));
    await zip.add("binary.bin", binary, { compress: false });
    await zip.add("carpeta/se\u00f1al \u65e5\u672c\u8a9e \u{1f4d3}.txt", utf8("\u00a1hola!"));
    const archive = await readZip(zip.finish(), LIMITS);

    expect([...archive.entries.keys()]).toEqual([
      "text.txt",
      "stored.txt",
      "empty",
      "binary.bin",
      "carpeta/se\u00f1al \u65e5\u672c\u8a9e \u{1f4d3}.txt",
    ]);
    expect(archive.entries.get("text.txt")).toEqual({
      name: "text.txt",
      size: text.length,
      compressedSize: expect.any(Number),
    });
    expect(archive.entries.get("text.txt")?.compressedSize).toBeLessThan(text.length / 10);
    expect(archive.entries.get("stored.txt")?.compressedSize).toBe(text.length);
    expect(archive.entries.get("empty")).toEqual({ name: "empty", size: 0, compressedSize: 0 });

    expect(await archive.read("text.txt")).toEqual(text);
    expect(await archive.read("stored.txt")).toEqual(text);
    expect(await archive.read("empty")).toEqual(new Uint8Array(0));
    expect(await archive.read("binary.bin")).toEqual(binary);
    expect(await archive.read("carpeta/se\u00f1al \u65e5\u672c\u8a9e \u{1f4d3}.txt")).toEqual(
      utf8("\u00a1hola!"),
    );
  });

  it("stores data that deflate doesn't make smaller", async () => {
    const data = noise(4000);
    const archive = await readZip(await archiveOf({ noise: data }), LIMITS);
    expect(archive.entries.get("noise")?.compressedSize).toBe(4000);
    expect(await archive.read("noise")).toEqual(data);
  });

  it("takes blobs, small and large, and gives entries back as blobs", async () => {
    const small = noise(300);
    const large = noise(300_000);
    const text = utf8("page ".repeat(60_000));
    const zip = createZipWriter();
    await zip.add("small", new Blob([small]), { compress: false });
    await zip.add("large", new Blob([large]), { compress: false });
    await zip.add("text", new Blob([text]));
    const file = zip.finish();
    expect(file.type).toBe("application/zip");
    const archive = await readZip(file, LIMITS);

    expect(await bytesOf(await archive.readBlob("small"))).toEqual(small);
    expect(await bytesOf(await archive.readBlob("large"))).toEqual(large);
    expect(await bytesOf(await archive.readBlob("text"))).toEqual(text);
    expect(await archive.read("large")).toEqual(large);
    expect(archive.entries.get("text")?.compressedSize).toBeLessThan(text.length / 10);
  });

  it("round-trips any entries", async () => {
    const segment = fc.string({ unit: "grapheme", minLength: 1, maxLength: 8 }).filter(
      (value) =>
        value !== "." &&
        value !== ".." &&
        // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters a name can't hold
        !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value),
    );
    const name = fc.array(segment, { minLength: 1, maxLength: 3 }).map((path) => path.join("/"));
    const entries = fc.uniqueArray(
      fc.record({ name, data: fc.uint8Array({ maxLength: 600 }), compress: fc.boolean() }),
      { maxLength: 6, selector: (entry) => entry.name },
    );
    await fc.assert(
      fc.asyncProperty(entries, async (list) => {
        const zip = createZipWriter();
        for (const entry of list) {
          await zip.add(entry.name, entry.data, { compress: entry.compress });
        }
        const archive = await readZip(zip.finish(), LIMITS);
        expect([...archive.entries.keys()]).toEqual(list.map((entry) => entry.name));
        for (const entry of list) {
          expect(await archive.read(entry.name)).toEqual(new Uint8Array(entry.data));
        }
      }),
      { numRuns: 50 },
    );
  });

  it("writes the same bytes for the same entries, dated 1980-01-01", async () => {
    const entries = { "a.json": utf8('{"a":1}'.repeat(50)), "b.bin": noise(100) };
    const first = await bytesOf(await archiveOf(entries));
    const second = await bytesOf(await archiveOf(entries));
    expect(first).toEqual(second);
    const header = new DataView(first.buffer);
    // The general purpose flags say UTF-8, and the time and date are fixed.
    expect(header.getUint16(6, true)).toBe(0x0800);
    expect(header.getUint16(10, true)).toBe(0);
    expect(header.getUint16(12, true)).toBe(0x0021);
  });

  it("keeps the order entries were added in, even when they're added at once", async () => {
    const zip = createZipWriter();
    await Promise.all([
      zip.add("slow", new Blob([utf8("x".repeat(400_000))])),
      zip.add("quick", new Uint8Array(0)),
      zip.add("middle", utf8("y".repeat(100))),
    ]);
    const archive = await readZip(zip.finish(), LIMITS);
    expect([...archive.entries.keys()]).toEqual(["slow", "quick", "middle"]);
  });

  it("writes the bytes it was given, whatever happens to the buffer afterwards", async () => {
    const data = utf8("unchanged");
    const zip = createZipWriter();
    await zip.add("entry", data, { compress: false });
    data.fill(0);
    const archive = await readZip(zip.finish(), LIMITS);
    expect(await archive.read("entry")).toEqual(utf8("unchanged"));
  });

  it("refuses names that aren't safe relative paths, and names used twice", async () => {
    const unsafe = [
      "",
      "/absolute",
      "../outside",
      "a/../b",
      "a/..",
      "a\\b",
      "a\u0000b",
      "a\nb",
      "a\u0085b",
      "a//b",
      "a/./b",
      "folder/",
      "lone\ud800surrogate",
      "x".repeat(1001),
    ];
    const zip = createZipWriter();
    for (const name of unsafe) {
      await expect(zip.add(name, new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
    }
    await zip.add("once", new Uint8Array(0));
    await expect(zip.add("once", new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
    const archive = await readZip(zip.finish(), LIMITS);
    expect([...archive.entries.keys()]).toEqual(["once"]);
  });

  it("can't be finished twice, added to once finished, or finished mid-entry", async () => {
    const zip = createZipWriter();
    const adding = zip.add("entry", utf8("data"));
    expect(() => zip.finish()).toThrow(TypeError);
    await adding;
    zip.finish();
    expect(() => zip.finish()).toThrow(TypeError);
    await expect(zip.add("late", new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
  });

  it("writes no ZIP64 record when everything fits", async () => {
    const file = await bytesOf(await archiveOf({ a: utf8("a".repeat(100)), b: noise(10) }));
    expect(indexOfSignature(file, 0x06064b50)).toBe(-1);
    expect(indexOfSignature(file, 0x07064b50)).toBe(-1);
    // Version 2.0 is all a reader needs.
    expect(new DataView(file.buffer).getUint16(4, true)).toBe(20);
    expect(zipEndRecords(65_535, 3_000_000, 4_000_000)).toHaveLength(22);
  });

  it("writes and reads 70,000 entries, which needs ZIP64 for their count", async () => {
    const zip = createZipWriter();
    const empty = new Uint8Array(0);
    for (let index = 0; index < 70_000; index += 1) await zip.add(`entries/${index}`, empty);
    await zip.add("last", utf8("the end"));
    const file = zip.finish();

    const tail = await bytesOf(file.slice(file.size - 98));
    const view = new DataView(tail.buffer);
    expect(view.getUint32(0, true)).toBe(0x06064b50);
    expect(Number(view.getBigUint64(32, true))).toBe(70_001);
    expect(view.getUint32(56, true)).toBe(0x07064b50);
    expect(view.getUint32(76, true)).toBe(0x06054b50);
    expect(view.getUint16(76 + 10, true)).toBe(0xffff);

    const archive = await readZip(file, LIMITS);
    expect(archive.entries.size).toBe(70_001);
    expect(archive.entries.has("entries/0")).toBe(true);
    expect(archive.entries.has("entries/69999")).toBe(true);
    expect(await archive.read("entries/69999")).toEqual(empty);
    expect(await archive.read("last")).toEqual(utf8("the end"));
  });

  it("writes ZIP64 fields for sizes and offsets that don't fit 32 bits, and only those", () => {
    const name = utf8("big");
    const base = { name, method: 0, crc: 7, size: 10, compressedSize: 10, offset: 0 };

    const small = zipLocalHeader(base);
    expect(small).toHaveLength(30 + 3);
    const large = zipLocalHeader({ ...base, size: 5_000_000_000, compressedSize: 4_999_999_999 });
    const local = new DataView(large.buffer);
    expect(large).toHaveLength(30 + 3 + 20);
    expect(local.getUint16(4, true)).toBe(45);
    expect(local.getUint32(LOCAL.compressedSize, true)).toBe(0xffffffff);
    expect(local.getUint32(LOCAL.size, true)).toBe(0xffffffff);
    expect(local.getUint16(33, true)).toBe(1);
    expect(local.getUint16(35, true)).toBe(16);
    expect(Number(local.getBigUint64(37, true))).toBe(5_000_000_000);
    expect(Number(local.getBigUint64(45, true))).toBe(4_999_999_999);

    expect(zipDirectoryRecord(base)).toHaveLength(46 + 3);
    const far = zipDirectoryRecord({ ...base, offset: 6_000_000_000 });
    const directory = new DataView(far.buffer);
    expect(far).toHaveLength(46 + 3 + 12);
    expect(directory.getUint32(DIRECTORY.size, true)).toBe(10);
    expect(directory.getUint32(DIRECTORY.offset, true)).toBe(0xffffffff);
    expect(directory.getUint16(49, true)).toBe(1);
    expect(directory.getUint16(51, true)).toBe(8);
    expect(Number(directory.getBigUint64(53, true))).toBe(6_000_000_000);

    const end = zipEndRecords(3, 200, 6_000_000_000);
    const records = new DataView(end.buffer);
    expect(end).toHaveLength(56 + 20 + 22);
    expect(Number(records.getBigUint64(48, true))).toBe(6_000_000_000);
    // The locator points at the ZIP64 record, which follows the directory.
    expect(Number(records.getBigUint64(56 + 8, true))).toBe(6_000_000_200);
    expect(records.getUint16(76 + END.count, true)).toBe(3);
    expect(records.getUint32(76 + END.directorySize, true)).toBe(200);
    expect(records.getUint32(76 + END.directoryOffset, true)).toBe(0xffffffff);
  });

  it("fails with UNSUPPORTED_ENVIRONMENT where the platform can't deflate or inflate", async () => {
    const file = await archiveOf({ text: utf8("text ".repeat(100)) });
    const unsupported = {
      code: "UNSUPPORTED_ENVIRONMENT",
      details: { feature: "CompressionStream" },
    };

    vi.stubGlobal("CompressionStream", undefined);
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(createZipWriter().add("text", utf8("text ".repeat(100)))).rejects.toMatchObject(
      unsupported,
    );
    await expect((await readZip(file, LIMITS)).read("text")).rejects.toMatchObject(unsupported);
    // Nothing needs the platform's streams when nothing is compressed.
    const stored = await archiveOf({ text: utf8("text") }, { compress: false });
    expect(await (await readZip(stored, LIMITS)).read("text")).toEqual(utf8("text"));

    // An older browser has the classes, but not the raw format.
    const refuses = class {
      constructor() {
        throw new TypeError("Unsupported compression format: 'deflate-raw'");
      }
    };
    vi.stubGlobal("CompressionStream", refuses);
    vi.stubGlobal("DecompressionStream", refuses);
    await expect(createZipWriter().add("text", utf8("text ".repeat(100)))).rejects.toMatchObject(
      unsupported,
    );
    await expect((await readZip(file, LIMITS)).read("text")).rejects.toMatchObject(unsupported);
  });
});

describe("an archive from the writer, opened by standard tools", () => {
  const folder = "/tmp/notes-sdk/backup";
  let directory = "";
  beforeAll(() => {
    mkdirSync(folder, { recursive: true });
    directory = mkdtempSync(join(folder, "zip-"));
  });
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;
  const hasPython = spawnSync("python3", ["-I", "-c", "import zipfile"]).status === 0;

  const text = utf8("Notes that must never be lost. ".repeat(100));
  const binary = noise(2000);

  async function written(): Promise<{ readonly plain: string; readonly many: string }> {
    const plain = join(directory, "plain.zip");
    const many = join(directory, "many.zip");
    const zip = createZipWriter();
    await zip.add("backup.json", text);
    await zip.add("notebooks/n1/assets/picture", binary, { compress: false });
    await zip.add("notebooks/n1/empty", new Uint8Array(0));
    await zip.add("notebooks/se\u00f1al.txt", utf8("\u00a1hola!"));
    writeFileSync(plain, await bytesOf(zip.finish()));
    // More entries than the short end record can count.
    const large = createZipWriter();
    for (let index = 0; index < 66_000; index += 1)
      await large.add(`e/${index}`, new Uint8Array(0));
    await large.add("last.txt", text);
    writeFileSync(many, await bytesOf(large.finish()));
    return { plain, many };
  }

  it.skipIf(!hasPython)("opens with Python's zipfile", async () => {
    const files = await written();
    const script = [
      "import json, sys, zipfile",
      "archive = zipfile.ZipFile(sys.argv[1])",
      "names = archive.namelist()",
      "print(json.dumps({",
      "  'count': len(names),",
      "  'names': names[:4],",
      "  'damaged': archive.testzip(),",
      "  'contents': [archive.read(name).hex() for name in names[:4]],",
      "  'last': archive.read(names[-1]).hex(),",
      "}))",
    ].join("\n");
    const list = (file: string): unknown =>
      JSON.parse(execFileSync("python3", ["-I", "-c", script, file], { encoding: "utf8" }));
    const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

    expect(list(files.plain)).toEqual({
      count: 4,
      names: [
        "backup.json",
        "notebooks/n1/assets/picture",
        "notebooks/n1/empty",
        "notebooks/se\u00f1al.txt",
      ],
      damaged: null,
      contents: [hex(text), hex(binary), "", hex(utf8("\u00a1hola!"))],
      last: hex(utf8("\u00a1hola!")),
    });
    expect(list(files.many)).toMatchObject({ count: 66_001, damaged: null, last: hex(text) });
  });

  it.skipIf(!hasPython)("reads an archive written by Python's zipfile", async () => {
    const path = join(directory, "python.zip");
    const script = [
      "import sys, zipfile",
      "with zipfile.ZipFile(sys.argv[1], 'w') as archive:",
      "    archive.writestr('text.txt', 'deflate me ' * 200, compress_type=zipfile.ZIP_DEFLATED)",
      "    archive.writestr('stored.bin', bytes(range(256)), compress_type=zipfile.ZIP_STORED)",
      "    archive.writestr('folder/', '')",
      "    archive.writestr('folder/se\\u00f1al.txt', '\\u00a1hola!', compress_type=zipfile.ZIP_DEFLATED)",
      // Sizes in a ZIP64 field, though they'd fit without one.
      "    with archive.open(zipfile.ZipInfo('wide.txt'), 'w', force_zip64=True) as entry:",
      "        entry.write(b'wide ' * 100)",
    ].join("\n");
    execFileSync("python3", ["-I", "-c", script, path]);

    const archive = await readZip(new Blob([new Uint8Array(readFileSync(path))]), LIMITS);
    expect([...archive.entries.keys()]).toEqual([
      "text.txt",
      "stored.bin",
      "folder/se\u00f1al.txt",
      "wide.txt",
    ]);
    expect(await archive.read("text.txt")).toEqual(utf8("deflate me ".repeat(200)));
    expect(await archive.read("stored.bin")).toEqual(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(await archive.read("folder/se\u00f1al.txt")).toEqual(utf8("\u00a1hola!"));
    expect(await archive.read("wide.txt")).toEqual(utf8("wide ".repeat(100)));
  });

  it.skipIf(!hasUnzip)("opens with unzip", async () => {
    const files = await written();
    const unzip = (...options: string[]): string =>
      execFileSync("unzip", options, { encoding: "utf8", maxBuffer: 64_000_000 });

    // -t reads every entry and checks its CRC; a damaged archive makes unzip exit with an error.
    expect(unzip("-tq", files.plain)).toContain("No errors detected");
    expect(unzip("-Z1", files.plain).split("\n").slice(0, 3)).toEqual([
      "backup.json",
      "notebooks/n1/assets/picture",
      "notebooks/n1/empty",
    ]);
    expect(unzip("-p", files.plain, "backup.json")).toBe(new TextDecoder().decode(text));
    expect(unzip("-tq", files.many)).toContain("No errors detected");
    expect(unzip("-Z1", files.many).trimEnd().split("\n")).toHaveLength(66_001);
  });
});

describe("readZip, of a hostile file", () => {
  const sample = (): Promise<Blob> =>
    archiveOf({ "a.txt": utf8("alpha ".repeat(300)), "b.bin": noise(500), c: utf8("c") });

  it("reads an archive built by hand", async () => {
    const data = utf8("deflate me ".repeat(100));
    const archive = await readZip(
      build([{ name: "stored", body: utf8("as it is") }, deflated("deflated", data)]),
      LIMITS,
    );
    expect(await archive.read("stored")).toEqual(utf8("as it is"));
    expect(await archive.read("deflated")).toEqual(data);
    expect(await bytesOf(await archive.readBlob("deflated"))).toEqual(data);
  });

  it("refuses a file with no end record", async () => {
    await expect(readZip(new Blob([]), LIMITS)).rejects.toMatchObject(MALFORMED);
    await expect(readZip(new Blob([noise(10)]), LIMITS)).rejects.toMatchObject(MALFORMED);
    await expect(readZip(new Blob([noise(100_000)]), LIMITS)).rejects.toMatchObject(MALFORMED);
    await expect(
      readZip(new Blob(["not a zip file at all, but long enough"]), LIMITS),
    ).rejects.toMatchObject(MALFORMED);
  });

  it("refuses a truncated file, wherever it was cut", async () => {
    const file = await sample();
    for (const size of [file.size - 1, file.size - 22, file.size - 60, 100, 31, 4]) {
      await expect(readZip(file.slice(0, size), LIMITS)).rejects.toMatchObject(MALFORMED);
    }
    // Cut from the middle: the end record is whole, but points past what's left.
    const gutted = new Blob([file.slice(0, 40), file.slice(400)]);
    await expect(readZip(gutted, LIMITS)).rejects.toMatchObject(MALFORMED);
  });

  it("refuses bytes after the end record that its comment doesn't cover", async () => {
    const file = build([{ name: "a", body: utf8("a") }], { tail: utf8("junk") });
    await expect(readZip(file, LIMITS)).rejects.toMatchObject(MALFORMED);
    // A comment is part of the format.
    const commented = build([{ name: "a", body: utf8("a") }], {
      end: set16(20, 4),
      tail: utf8("note"),
    });
    expect(await (await readZip(commented, LIMITS)).read("a")).toEqual(utf8("a"));
  });

  it("refuses an entry whose data doesn't match its CRC-32", async () => {
    const changed = build([{ name: "stored", body: utf8("as it is"), crc: 1 }]);
    const archive = await readZip(changed, LIMITS);
    await expect(archive.read("stored")).rejects.toMatchObject(MALFORMED);
    await expect(archive.readBlob("stored")).rejects.toMatchObject(MALFORMED);

    const data = utf8("deflate me ".repeat(100));
    const wrong = await readZip(build([{ ...deflated("deflated", data), crc: 1 }]), LIMITS);
    await expect(wrong.read("deflated")).rejects.toMatchObject(MALFORMED);
    await expect(wrong.readBlob("deflated")).rejects.toMatchObject(MALFORMED);

    // One bit of the data flipped, in an archive from the writer.
    const bytes = await bytesOf(await archiveOf({ noise: noise(500) }));
    bytes[30 + 5 + 100] = (bytes[30 + 5 + 100] as number) ^ 1;
    const flipped = await readZip(new Blob([bytes]), LIMITS);
    await expect(flipped.read("noise")).rejects.toMatchObject(MALFORMED);
  });

  it("refuses deflated data that isn't deflate, or has more after its end", async () => {
    const data = utf8("deflate me ".repeat(100));
    const part = deflated("entry", data);
    const body = part.body ?? new Uint8Array(0);

    const garbage = await readZip(build([{ ...part, body: noise(body.length) }]), LIMITS);
    await expect(garbage.read("entry")).rejects.toMatchObject(MALFORMED);
    const cut = await readZip(build([{ ...part, body: body.subarray(0, 20) }]), LIMITS);
    await expect(cut.read("entry")).rejects.toMatchObject(MALFORMED);
    const longer = new Uint8Array([...body, 1, 2, 3]);
    const trailing = await readZip(build([{ ...part, body: longer }]), LIMITS);
    await expect(trailing.read("entry")).rejects.toMatchObject(MALFORMED);
  });

  it("stops inflating as soon as an entry outgrows its declared size", async () => {
    // 60 MB of zeros in a few kilobytes, declared as one kilobyte.
    const size = 60_000_000;
    const bomb = { ...deflated("bomb", new Uint8Array(size)), size: 1000 };
    const archive = await readZip(build([bomb]), LIMITS);

    let inflated = 0;
    const Real = DecompressionStream;
    vi.stubGlobal(
      "DecompressionStream",
      class {
        readonly writable: WritableStream<BufferSource>;
        readonly readable: ReadableStream<Uint8Array>;
        constructor(format: CompressionFormat) {
          const real = new Real(format);
          this.writable = real.writable;
          this.readable = real.readable.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                inflated += chunk.length;
                controller.enqueue(chunk);
              },
            }),
          );
        }
      },
    );
    await expect(archive.read("bomb")).rejects.toMatchObject(MALFORMED);
    await expect(archive.readBlob("bomb")).rejects.toMatchObject(MALFORMED);
    expect(inflated).toBeGreaterThan(1000);
    expect(inflated).toBeLessThan(size / 20);
  });

  it("refuses an entry that is shorter or longer than it declares", async () => {
    const data = utf8("deflate me ".repeat(100));
    const short = await readZip(
      build([{ ...deflated("entry", data), size: data.length + 1 }]),
      LIMITS,
    );
    await expect(short.read("entry")).rejects.toMatchObject(MALFORMED);
    const long = await readZip(
      build([{ ...deflated("entry", data), size: data.length - 1 }]),
      LIMITS,
    );
    await expect(long.read("entry")).rejects.toMatchObject(MALFORMED);
    // A stored entry's two sizes are one number.
    await expect(
      readZip(build([{ name: "stored", body: utf8("four"), size: 5 }]), LIMITS),
    ).rejects.toMatchObject(MALFORMED);
  });

  it("refuses names that leave the archive, and names it can't read", async () => {
    const names: (string | Uint8Array)[] = [
      "../evil",
      "notebooks/../../evil",
      "..",
      "/etc/passwd",
      "notebooks\\evil",
      "nul\u0000byte",
      "new\nline",
      "delete\u007f",
      "c1\u009bcontrol",
      "x".repeat(1001),
      new Uint8Array([0x61, 0xff, 0xfe]),
      new Uint8Array(0),
    ];
    for (const name of names) {
      await expect(readZip(build([{ name, body: utf8("x") }]), LIMITS)).rejects.toMatchObject(
        MALFORMED,
      );
    }
    const longest = "x".repeat(1000);
    const archive = await readZip(build([{ name: longest, body: utf8("x") }]), LIMITS);
    expect(await archive.read(longest)).toEqual(utf8("x"));
  });

  it("refuses two entries of one name", async () => {
    const file = build([
      { name: "twice", body: utf8("first") },
      { name: "twice", body: utf8("second") },
    ]);
    await expect(readZip(file, LIMITS)).rejects.toMatchObject(MALFORMED);
  });

  it("refuses encrypted entries", async () => {
    for (const flag of [0x0001, 0x0040, 0x2000]) {
      const file = build([
        {
          name: "secret",
          body: utf8("x"),
          local: set16(LOCAL.flags, 0x0800 | flag),
          directory: set16(DIRECTORY.flags, 0x0800 | flag),
        },
      ]);
      await expect(readZip(file, LIMITS)).rejects.toMatchObject(MALFORMED);
    }
    // Encrypted only where the data is: the directory doesn't say so.
    const hidden = await readZip(
      build([{ name: "secret", body: utf8("x"), local: set16(LOCAL.flags, 0x0801) }]),
      LIMITS,
    );
    await expect(hidden.read("secret")).rejects.toMatchObject(MALFORMED);
  });

  it("refuses compression methods other than stored and deflate", async () => {
    for (const method of [1, 9, 12, 14, 93, 99]) {
      await expect(
        readZip(build([{ name: "entry", body: utf8("x"), method }]), LIMITS),
      ).rejects.toMatchObject(MALFORMED);
    }
  });

  it("refuses archives in several parts", async () => {
    const part: Part = { name: "entry", body: utf8("x") };
    await expect(readZip(build([part], { end: set16(END.disk, 1) }), LIMITS)).rejects.toMatchObject(
      MALFORMED,
    );
    await expect(
      readZip(build([part], { end: set16(END.countOnDisk, 0) }), LIMITS),
    ).rejects.toMatchObject(MALFORMED);
    await expect(
      readZip(build([{ ...part, directory: set16(DIRECTORY.disk, 1) }]), LIMITS),
    ).rejects.toMatchObject(MALFORMED);
  });

  it("refuses offsets and counts the file can't hold", async () => {
    const part: Part = { name: "entry", body: utf8("x") };
    const refused = [
      build([part], { end: set32(END.directoryOffset, 5000) }),
      build([part], { end: set32(END.directorySize, 5000) }),
      build([part], { end: both(set16(END.count, 9), set16(END.countOnDisk, 9)) }),
      build([part], { end: set32(END.directoryOffset, 1) }),
      build([{ ...part, directory: set32(DIRECTORY.offset, 5000) }]),
      build([{ ...part, directory: set32(DIRECTORY.offset, 30) }]),
      build([
        {
          ...part,
          directory: both(set32(DIRECTORY.compressedSize, 5000), set32(DIRECTORY.size, 5000)),
        },
      ]),
      // A saturated field with no ZIP64 field to say what it stands for.
      build([{ ...part, directory: set32(DIRECTORY.offset, 0xffffffff) }]),
    ];
    for (const file of refused)
      await expect(readZip(file, LIMITS)).rejects.toMatchObject(MALFORMED);
  });

  it("refuses a local header that disagrees with the directory", async () => {
    const data = utf8("deflate me ".repeat(100));
    const disagreeing: Part[] = [
      { name: "entry", body: utf8("x"), local: set32(0, 0x04034b51) },
      { name: "entry", body: utf8("x"), local: set16(LOCAL.method, 8) },
      { name: "entry", body: utf8("xx"), local: set32(LOCAL.size, 1) },
      { name: "entry", body: utf8("xx"), local: set32(LOCAL.crc, 1) },
      { ...deflated("entry", data), local: set32(LOCAL.compressedSize, 1) },
      // The directory names one file, and the data belongs to another.
      { name: "entry", body: utf8("x"), directory: (record) => record.fill(0x58, 46, 51) },
      { name: "entry", body: utf8("x"), local: set16(26, 6) },
      { name: "entry", body: utf8("x"), local: set16(LOCAL.extraSize, 5000) },
    ];
    for (const part of disagreeing) {
      const archive = await readZip(build([part]), LIMITS);
      const [name] = archive.entries.keys();
      await expect(archive.read(name ?? "")).rejects.toMatchObject(MALFORMED);
    }
  });

  it("skips folders, and refuses one that holds data", async () => {
    const archive = await readZip(
      build([
        { name: "notebooks/" },
        { name: "notebooks/n1/" },
        { name: "notebooks/n1/a", body: utf8("a") },
      ]),
      LIMITS,
    );
    expect([...archive.entries.keys()]).toEqual(["notebooks/n1/a"]);
    await expect(
      readZip(build([{ name: "folder/", body: utf8("data") }]), LIMITS),
    ).rejects.toMatchObject(MALFORMED);
  });

  it("reads an entry written with a data descriptor", async () => {
    const data = utf8("streamed ".repeat(50));
    const part = deflated("streamed", data);
    const descriptor = new Uint8Array(16);
    const view = new DataView(descriptor.buffer);
    view.setUint32(0, 0x08074b50, true);
    view.setUint32(4, part.crc ?? 0, true);
    view.setUint32(8, part.body?.length ?? 0, true);
    view.setUint32(12, data.length, true);
    const file = build([
      {
        ...part,
        // The local header has no CRC and no sizes: they follow the data.
        local: both(
          set16(LOCAL.flags, 0x0808),
          set32(LOCAL.crc, 0),
          set32(LOCAL.compressedSize, 0),
          set32(LOCAL.size, 0),
        ),
        directory: set16(DIRECTORY.flags, 0x0808),
        after: descriptor,
      },
    ]);
    expect(await (await readZip(file, LIMITS)).read("streamed")).toEqual(data);
  });

  it("names a missing entry", async () => {
    const archive = await readZip(await sample(), LIMITS);
    const missing = { code: "INVALID_DOCUMENT", details: { reason: "missing-entry" } };
    await expect(archive.read("nothing")).rejects.toMatchObject(missing);
    await expect(archive.readBlob("nothing")).rejects.toMatchObject(missing);
  });

  it("refuses more entries than the limit, before reading them", async () => {
    await expect(readZip(await sample(), { ...LIMITS, maxEntries: 2 })).rejects.toMatchObject({
      code: "TOO_MANY_BACKUP_ENTRIES",
      details: { limit: "maxBackupEntries", maximum: 2, actual: 3, unit: "count" },
    });
    expect((await readZip(await sample(), { ...LIMITS, maxEntries: 3 })).entries.size).toBe(3);
  });

  it("refuses a file larger than the limit, and one that declares more than the limit", async () => {
    const file = await archiveOf({ zeros: new Uint8Array(100_000), more: new Uint8Array(50_000) });
    expect(file.size).toBeLessThan(2000);
    await expect(readZip(file, { ...LIMITS, maxSize: file.size - 1 })).rejects.toMatchObject({
      code: "BACKUP_TOO_LARGE",
      details: { limit: "maxBackupSize", maximum: file.size - 1, actual: file.size, unit: "bytes" },
    });
    await expect(readZip(file, { ...LIMITS, maxSize: 149_999 })).rejects.toMatchObject({
      code: "BACKUP_TOO_LARGE",
      details: { limit: "maxBackupSize", maximum: 149_999, actual: 150_000, unit: "bytes" },
    });
    const archive = await readZip(file, { ...LIMITS, maxSize: 150_000 });
    // Reading an entry again doesn't count it again.
    for (let times = 0; times < 3; times += 1) {
      expect(await archive.read("zeros")).toHaveLength(100_000);
      expect((await archive.readBlob("more")).size).toBe(50_000);
    }
  });

  describe("with ZIP64 records", () => {
    /** ZIP64 end records, for an archive small enough not to need them. */
    const zip64End =
      (change: (view: DataView) => void = () => undefined) =>
      (layout: Layout): Uint8Array => {
        const records = new Uint8Array(56 + 20 + 22);
        const view = new DataView(records.buffer);
        view.setUint32(0, 0x06064b50, true);
        view.setBigUint64(4, 44n, true);
        view.setUint16(12, 45, true);
        view.setUint16(14, 45, true);
        view.setBigUint64(24, BigInt(layout.count), true);
        view.setBigUint64(32, BigInt(layout.count), true);
        view.setBigUint64(40, BigInt(layout.directorySize), true);
        view.setBigUint64(48, BigInt(layout.directoryOffset), true);
        view.setUint32(56, 0x07064b50, true);
        view.setBigUint64(64, BigInt(layout.directoryOffset + layout.directorySize), true);
        view.setUint32(72, 1, true);
        view.setUint32(76, 0x06054b50, true);
        view.setUint16(76 + END.countOnDisk, 0xffff, true);
        view.setUint16(76 + END.count, 0xffff, true);
        view.setUint32(76 + END.directorySize, 0xffffffff, true);
        view.setUint32(76 + END.directoryOffset, 0xffffffff, true);
        change(view);
        return records;
      };

    /** An entry whose sizes and offset are all in ZIP64 fields. */
    const wide = (name: string, data: Uint8Array): Part => {
      const part = deflated(name, data);
      const compressedSize = part.body?.length ?? 0;
      return {
        ...part,
        local: both(
          set32(LOCAL.compressedSize, 0xffffffff),
          set32(LOCAL.size, 0xffffffff),
          withExtra(LOCAL.extraSize, zip64Extra(data.length, compressedSize)),
        ),
        directory: both(
          set32(DIRECTORY.compressedSize, 0xffffffff),
          set32(DIRECTORY.size, 0xffffffff),
          set32(DIRECTORY.offset, 0xffffffff),
          withExtra(DIRECTORY.extraSize, zip64Extra(data.length, compressedSize, 0)),
        ),
      };
    };

    const data = utf8("wide ".repeat(200));

    it("reads sizes, offsets and counts from them", async () => {
      const file = build([wide("wide", data)], { endRecords: zip64End() });
      const archive = await readZip(file, LIMITS);
      expect(archive.entries.get("wide")?.size).toBe(data.length);
      expect(await archive.read("wide")).toEqual(data);
    });

    it("skips other extra fields to find them", async () => {
      const part = wide("wide", data);
      const other = new Uint8Array([0x55, 0x54, 3, 0, 1, 2, 3]);
      const compressedSize = part.body?.length ?? 0;
      const file = build(
        [
          {
            ...part,
            directory: both(
              set32(DIRECTORY.size, 0xffffffff),
              withExtra(
                DIRECTORY.extraSize,
                new Uint8Array([...other, ...zip64Extra(data.length)]),
              ),
            ),
            local: both(
              set32(LOCAL.size, 0xffffffff),
              withExtra(
                LOCAL.extraSize,
                new Uint8Array([...other, ...zip64Extra(data.length, compressedSize)]),
              ),
            ),
          },
        ],
        { endRecords: zip64End() },
      );
      expect(await (await readZip(file, LIMITS)).read("wide")).toEqual(data);
    });

    it("refuses ZIP64 records that are cut short, too large or inconsistent", async () => {
      const part = wide("wide", data);
      const compressedSize = part.body?.length ?? 0;
      const refused = [
        // A value no number holds exactly.
        build([part], { endRecords: zip64End((view) => view.setBigUint64(48, 2n ** 60n, true)) }),
        build([part], { endRecords: zip64End((view) => view.setBigUint64(32, 2n ** 53n, true)) }),
        // The two end records disagree.
        build([part], { endRecords: zip64End((view) => view.setUint16(76 + END.count, 7, true)) }),
        build([part], { endRecords: zip64End((view) => view.setBigUint64(24, 0n, true)) }),
        // Another disk, a wrong signature, a wrong length, and a locator that points elsewhere.
        build([part], { endRecords: zip64End((view) => view.setUint32(16, 1, true)) }),
        build([part], { endRecords: zip64End((view) => view.setUint32(72, 2, true)) }),
        build([part], { endRecords: zip64End((view) => view.setUint32(0, 0x06064b51, true)) }),
        build([part], { endRecords: zip64End((view) => view.setBigUint64(4, 45n, true)) }),
        build([part], { endRecords: zip64End((view) => view.setBigUint64(64, 2n ** 40n, true)) }),
        build([part], { endRecords: zip64End((view) => view.setBigUint64(64, 0n, true)) }),
        // An entry's ZIP64 field too short for the values it must hold.
        build(
          [
            {
              ...part,
              directory: both(
                set32(DIRECTORY.compressedSize, 0xffffffff),
                set32(DIRECTORY.size, 0xffffffff),
                withExtra(DIRECTORY.extraSize, zip64Extra(data.length)),
              ),
            },
          ],
          { endRecords: zip64End() },
        ),
        // An extra field that says it's longer than the record.
        build(
          [
            {
              ...part,
              directory: both(
                set32(DIRECTORY.size, 0xffffffff),
                withExtra(DIRECTORY.extraSize, new Uint8Array([1, 0, 200, 0, 1, 2])),
              ),
            },
          ],
          { endRecords: zip64End() },
        ),
        build(
          [
            {
              ...part,
              directory: both(
                set32(DIRECTORY.size, 0xffffffff),
                withExtra(DIRECTORY.extraSize, zip64Extra(2 ** 60)),
              ),
            },
          ],
          { endRecords: zip64End() },
        ),
      ];
      for (const file of refused)
        await expect(readZip(file, LIMITS)).rejects.toMatchObject(MALFORMED);

      // The local header's own ZIP64 field disagrees, or is missing.
      const local = [
        both(
          set32(LOCAL.size, 0xffffffff),
          withExtra(LOCAL.extraSize, zip64Extra(data.length + 1, compressedSize)),
        ),
        both(set32(LOCAL.size, 0xffffffff), withExtra(LOCAL.extraSize, zip64Extra(data.length))),
        set32(LOCAL.compressedSize, 0xffffffff),
      ];
      for (const change of local) {
        const archive = await readZip(
          build([{ ...deflated("wide", data), local: change }]),
          LIMITS,
        );
        await expect(archive.read("wide")).rejects.toMatchObject(MALFORMED);
      }
    });
  });

  describe("damaged at random", () => {
    const original = { "a.txt": utf8("alpha ".repeat(300)), "b.bin": noise(500), c: utf8("c") };

    /** The result, or `undefined` for a refusal, which must be a `NotesError`. */
    async function unlessRefused<Result>(run: () => Promise<Result>): Promise<Result | undefined> {
      try {
        return await run();
      } catch (error) {
        expect(error).toMatchObject({ name: "NotesError" });
        return undefined;
      }
    }

    /** Reads everything a damaged archive still gives, and says how much it gave. */
    async function readAll(blob: Blob, exact: boolean): Promise<number> {
      const archive = await unlessRefused(() => readZip(blob, LIMITS));
      if (!archive) return 0;
      let read = 0;
      for (const name of archive.entries.keys()) {
        const data = await unlessRefused(() => archive.read(name));
        if (!data) continue;
        read += 1;
        if (exact && Object.hasOwn(original, name)) {
          expect(data).toEqual(original[name as keyof typeof original]);
        }
      }
      return read;
    }

    it("never returns changed data, and refuses only with a NotesError", async () => {
      const file = await bytesOf(await archiveOf(original));
      const change = fc.record({
        at: fc.nat({ max: file.length - 1 }),
        xor: fc.integer({ min: 1, max: 255 }),
      });
      let read = 0;
      await fc.assert(
        fc.asyncProperty(fc.array(change, { minLength: 1, maxLength: 3 }), async (changes) => {
          const damaged = file.slice();
          for (const { at, xor } of changes) damaged[at] = (damaged[at] as number) ^ xor;
          // A 32-bit check can't be fooled by one changed byte.
          read += await readAll(new Blob([damaged]), changes.length === 1);
        }),
        { numRuns: 300 },
      );
      // Most damage leaves the other entries readable, so both outcomes were seen.
      expect(read).toBeGreaterThan(100);
    });

    it("refuses a file cut anywhere, or with anything put after it", async () => {
      const file = await bytesOf(await archiveOf(original));
      await fc.assert(
        fc.asyncProperty(
          fc.nat({ max: file.length - 1 }),
          fc.uint8Array({ maxLength: 40 }),
          async (cut, added) => {
            const blob = new Blob([file.subarray(0, cut), new Uint8Array(added)]);
            const archive = await unlessRefused(() => readZip(blob, LIMITS));
            // Only bytes that happen to complete the file again make it readable.
            if (archive) expect(await readAll(blob, true)).toBe(3);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
