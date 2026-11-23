import { invalidDocument, NotesError } from "../errors/notes-error.js";

/**
 * A small zip container, written and read here so that a backup needs no
 * dependency (docs/adr/0005). The writer makes plain archives any tool
 * opens. The reader treats its file as hostile: every offset and length is
 * checked against the file's real size before it's used, and nothing is
 * inflated past what the archive declared.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const LOCAL_SIGNATURE = 0x04034b50;
const DIRECTORY_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const ZIP64_END_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

const LOCAL_SIZE = 30;
const DIRECTORY_SIZE = 46;
const END_SIZE = 22;
const ZIP64_END_SIZE = 56;
const ZIP64_LOCATOR_SIZE = 20;

/** The largest values of 16 and 32 bits, which also mean "see the ZIP64 record". */
const MAX_16 = 0xffff;
const MAX_32 = 0xffffffff;

const STORED = 0;
const DEFLATED = 8;

/** Bit 0: the entry is encrypted. Bits 6 and 13 are stronger kinds of the same. */
const FLAGS_ENCRYPTED = 0x0001 | 0x0040 | 0x2000;
/** Bit 3: the local header has no sizes, and a descriptor after the data has them. */
const FLAG_DESCRIPTOR = 0x0008;
/** Bit 11: the name is UTF-8. */
const FLAG_UTF8 = 0x0800;

const ZIP64_EXTRA = 0x0001;
/** Readers need version 2.0 for deflate, and 4.5 for ZIP64. */
const VERSION = 20;
const VERSION_ZIP64 = 45;
/** 1980-01-01, the first date the format holds, so the same entries give the same file. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

/** The longest name, in bytes, written or read. */
const MAX_NAME_BYTES = 1000;
/** Small pieces are joined up to this size, so an archive of many entries is few parts. */
const PART_SIZE = 65_536;
/** How much of the central directory is read at a time. */
const WINDOW_SIZE = 262_144;

let crcTable: Uint32Array | undefined;

/** The CRC-32 table, built the first time it's needed. */
function table(): Uint32Array {
  if (crcTable) return crcTable;
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    built[index] = value >>> 0;
  }
  crcTable = built;
  return built;
}

/**
 * The CRC-32 of some bytes, as zip and gzip use it. Pass the CRC of what
 * came before as `previous` to continue over data that arrives in pieces.
 */
export function crc32(data: Uint8Array, previous = 0): number {
  const lookup = table();
  let crc = ~previous;
  for (let index = 0; index < data.length; index += 1) {
    crc = (lookup[(crc ^ (data[index] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

/** A drive or device letter and its colon, as in `C:/notes.txt` or `C:notes.txt`. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * Whether a name is a relative path that stays inside the folder an archive
 * is opened in: not absolute, with no drive letter, `..` segment, backslash
 * or control character.
 */
function isSafeName(name: string): boolean {
  if (name === "" || name.startsWith("/") || DRIVE_PREFIX.test(name)) return false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    // C0 and C1 controls, DEL and the backslash.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x5c) return false;
  }
  return !name.split("/").includes("..");
}

/** Half of a surrogate pair on its own, which can't be written as UTF-8. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function unsupported(cause?: unknown): NotesError {
  return new NotesError(
    "UNSUPPORTED_ENVIRONMENT",
    "This environment can't compress or decompress deflate-raw streams.",
    { details: { feature: "CompressionStream" }, cause },
  );
}

/** A deflate compressor, or `UNSUPPORTED_ENVIRONMENT` where the platform has none. */
function compressor(): CompressionStream {
  if (typeof CompressionStream === "undefined") throw unsupported();
  try {
    return new CompressionStream("deflate-raw");
  } catch (cause) {
    // An older browser has the class but not the raw format.
    throw unsupported(cause);
  }
}

function decompressor(): DecompressionStream {
  if (typeof DecompressionStream === "undefined") throw unsupported();
  try {
    return new DecompressionStream("deflate-raw");
  } catch (cause) {
    throw unsupported(cause);
  }
}

/** Calls `visit` with each chunk of a stream, and cancels the stream if `visit` throws. */
async function forEachChunk(
  stream: ReadableStream<Bytes>,
  visit: (chunk: Bytes) => void,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      visit(value);
    }
  } catch (error) {
    // Stops the source and the inflater, so nothing more is produced.
    reader.cancel().catch(() => undefined);
    throw error;
  }
}

function concat(chunks: readonly Bytes[], size: number): Bytes {
  const [first] = chunks;
  if (chunks.length === 1 && first) return first;
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

/** What the records of one entry say about it. */
export interface ZipRecord {
  /** The name, as UTF-8. */
  readonly name: Uint8Array;
  /** 0 for stored, 8 for deflated. */
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
  /** Where the entry's local header starts in the file. */
  readonly offset: number;
}

/** Writes a record's fields in order, little-endian. */
function recordWriter(size: number) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  return {
    bytes,
    u16(value: number): void {
      view.setUint16(at, value, true);
      at += 2;
    },
    u32(value: number): void {
      view.setUint32(at, value, true);
      at += 4;
    },
    u64(value: number): void {
      view.setBigUint64(at, BigInt(value), true);
      at += 8;
    },
    raw(value: Uint8Array): void {
      bytes.set(value, at);
      at += value.length;
    },
  };
}

/**
 * An entry's local header, which comes before its data. It has a ZIP64
 * extra field only when a size doesn't fit 32 bits.
 *
 * Exported, with the two functions below, so that their ZIP64 forms are
 * tested without a file of 4 GB.
 */
export function zipLocalHeader(record: ZipRecord): Bytes {
  const zip64 = record.size >= MAX_32 || record.compressedSize >= MAX_32;
  const extraSize = zip64 ? 20 : 0;
  const out = recordWriter(LOCAL_SIZE + record.name.length + extraSize);
  out.u32(LOCAL_SIGNATURE);
  out.u16(zip64 ? VERSION_ZIP64 : VERSION);
  out.u16(FLAG_UTF8);
  out.u16(record.method);
  out.u16(DOS_TIME);
  out.u16(DOS_DATE);
  out.u32(record.crc);
  out.u32(zip64 ? MAX_32 : record.compressedSize);
  out.u32(zip64 ? MAX_32 : record.size);
  out.u16(record.name.length);
  out.u16(extraSize);
  out.raw(record.name);
  if (zip64) {
    // A local header's ZIP64 field always holds both sizes.
    out.u16(ZIP64_EXTRA);
    out.u16(16);
    out.u64(record.size);
    out.u64(record.compressedSize);
  }
  return out.bytes;
}

/**
 * An entry's record in the central directory. Its ZIP64 extra field holds
 * only the values that don't fit 32 bits, and is absent when all do.
 */
export function zipDirectoryRecord(record: ZipRecord): Bytes {
  const wide = [record.size, record.compressedSize, record.offset].filter(
    (value) => value >= MAX_32,
  );
  const extraSize = wide.length === 0 ? 0 : 4 + 8 * wide.length;
  const version = wide.length === 0 ? VERSION : VERSION_ZIP64;
  const out = recordWriter(DIRECTORY_SIZE + record.name.length + extraSize);
  out.u32(DIRECTORY_SIGNATURE);
  out.u16(version);
  out.u16(version);
  out.u16(FLAG_UTF8);
  out.u16(record.method);
  out.u16(DOS_TIME);
  out.u16(DOS_DATE);
  out.u32(record.crc);
  out.u32(Math.min(record.compressedSize, MAX_32));
  out.u32(Math.min(record.size, MAX_32));
  out.u16(record.name.length);
  out.u16(extraSize);
  // No comment, one disk, and no attributes.
  out.u16(0);
  out.u16(0);
  out.u16(0);
  out.u32(0);
  out.u32(Math.min(record.offset, MAX_32));
  out.raw(record.name);
  if (wide.length > 0) {
    out.u16(ZIP64_EXTRA);
    out.u16(8 * wide.length);
    for (const value of wide) out.u64(value);
  }
  return out.bytes;
}

/**
 * The records that end an archive: the end of central directory, preceded
 * by its ZIP64 form and locator only when there are more than 65,535
 * entries or the directory's size or offset doesn't fit 32 bits.
 */
export function zipEndRecords(
  count: number,
  directorySize: number,
  directoryOffset: number,
): Bytes {
  const zip64 = count > MAX_16 || directorySize >= MAX_32 || directoryOffset >= MAX_32;
  const out = recordWriter(END_SIZE + (zip64 ? ZIP64_END_SIZE + ZIP64_LOCATOR_SIZE : 0));
  if (zip64) {
    out.u32(ZIP64_END_SIGNATURE);
    // The size of the rest of this record.
    out.u64(ZIP64_END_SIZE - 12);
    out.u16(VERSION_ZIP64);
    out.u16(VERSION_ZIP64);
    out.u32(0);
    out.u32(0);
    out.u64(count);
    out.u64(count);
    out.u64(directorySize);
    out.u64(directoryOffset);
    out.u32(ZIP64_LOCATOR_SIGNATURE);
    out.u32(0);
    out.u64(directoryOffset + directorySize);
    out.u32(1);
  }
  out.u32(END_SIGNATURE);
  out.u16(0);
  out.u16(0);
  out.u16(Math.min(count, MAX_16));
  out.u16(Math.min(count, MAX_16));
  out.u32(Math.min(directorySize, MAX_32));
  out.u32(Math.min(directoryOffset, MAX_32));
  out.u16(0);
  return out.bytes;
}

/**
 * Writes a zip archive, one entry at a time.
 */
export interface ZipWriter {
  /**
   * Adds an entry, deflated unless `compress` is `false` or deflating
   * doesn't make it smaller. Entries are written in the order `add` is
   * called. Rejects with `TypeError` for a name already added or one that
   * isn't a safe relative path.
   */
  add(
    name: string,
    data: Blob | Uint8Array,
    options?: { readonly compress?: boolean },
  ): Promise<void>;
  /**
   * The archive. Throws `TypeError` while an entry is still being added,
   * and nothing can be added afterwards.
   */
  finish(): Blob;
}

/** The parts of the archive, with small pieces joined so the `Blob` has few of them. */
function createParts() {
  const parts: BlobPart[] = [];
  let small: Bytes[] = [];
  let smallSize = 0;
  const flush = (): void => {
    if (smallSize === 0) return;
    parts.push(concat(small, smallSize));
    small = [];
    smallSize = 0;
  };
  return {
    bytes(chunk: Bytes): void {
      if (chunk.length >= PART_SIZE) {
        flush();
        parts.push(chunk);
        return;
      }
      small.push(chunk);
      smallSize += chunk.length;
      if (smallSize >= PART_SIZE) flush();
    },
    blob(blob: Blob): void {
      flush();
      parts.push(blob);
    },
    finish(): Blob {
      flush();
      return new Blob(parts, { type: "application/zip" });
    },
  };
}

interface EncodedEntry {
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
  /** The entry's data as written: a large `Blob` as it is, anything else as bytes. */
  readonly body: readonly (Blob | Bytes)[];
}

/**
 * An entry's data as the archive holds it, with its CRC-32 and sizes. Bytes
 * are kept as they are, so they must be the archive's own copy.
 */
async function encodeEntry(data: Blob | Bytes, compress: boolean): Promise<EncodedEntry> {
  let crc = 0;
  let size: number;
  let raw: readonly (Blob | Bytes)[];
  let source: () => Blob;
  // Not `instanceof Blob`, which a blob from another window fails.
  if (ArrayBuffer.isView(data)) {
    crc = crc32(data);
    size = data.length;
    raw = [data];
    source = () => new Blob([data]);
  } else {
    // A small file is kept as bytes, so many small entries join into few parts.
    const kept: Bytes[] = [];
    const keep = data.size < PART_SIZE;
    await forEachChunk(data.stream(), (chunk) => {
      crc = crc32(chunk, crc);
      if (keep) kept.push(chunk);
    });
    size = data.size;
    raw = keep ? kept : [data];
    source = () => data;
  }
  const stored: EncodedEntry = { method: STORED, crc, size, compressedSize: size, body: raw };
  if (!compress || size === 0) return stored;
  const deflated: Bytes[] = [];
  let compressedSize = 0;
  await forEachChunk(source().stream().pipeThrough(compressor()), (chunk) => {
    deflated.push(chunk);
    compressedSize += chunk.length;
  });
  if (compressedSize >= size) return stored;
  return { method: DEFLATED, crc, size, compressedSize, body: deflated };
}

/** A name as the archive holds it, or `TypeError` for one the writer refuses. */
function encodeName(name: string): Bytes {
  const segments = name.split("/");
  if (
    !isSafeName(name) ||
    LONE_SURROGATE.test(name) ||
    segments.includes("") ||
    segments.includes(".")
  ) {
    throw new TypeError("A zip entry's name must be a safe relative path.");
  }
  const encoded = new TextEncoder().encode(name);
  if (encoded.length > MAX_NAME_BYTES) {
    throw new TypeError(`A zip entry's name must be at most ${MAX_NAME_BYTES} bytes.`);
  }
  return encoded;
}

/**
 * Starts a zip archive. The result is a `Blob` of parts, never one buffer
 * of the whole file, and has ZIP64 records only when it needs them. The
 * same entries always give the same bytes.
 */
export function createZipWriter(): ZipWriter {
  const parts = createParts();
  const records: ZipRecord[] = [];
  const names = new Set<string>();
  let offset = 0;
  let pending = 0;
  let finished = false;
  // Entries are encoded one after another, so they're written in the order they were added.
  let queue: Promise<void> = Promise.resolve();

  const append = (name: Bytes, entry: EncodedEntry): void => {
    const record: ZipRecord = {
      name,
      method: entry.method,
      crc: entry.crc,
      size: entry.size,
      compressedSize: entry.compressedSize,
      offset,
    };
    const header = zipLocalHeader(record);
    parts.bytes(header);
    for (const part of entry.body) {
      if (ArrayBuffer.isView(part)) parts.bytes(part);
      else parts.blob(part);
    }
    records.push(record);
    offset += header.length + entry.compressedSize;
  };

  return {
    async add(name, data, options = {}) {
      if (finished) throw new TypeError("The archive is finished: nothing can be added.");
      const encoded = encodeName(name);
      if (names.has(name)) throw new TypeError("The archive already has an entry of that name.");
      names.add(name);
      // Copied now, not when the entry's turn comes, so a caller that reuses
      // its buffer can't change what's written. Not `slice`, which for a
      // Node `Buffer` is a view of the same memory. A `Blob` never changes.
      const own = ArrayBuffer.isView(data) ? new Uint8Array(data) : data;
      pending += 1;
      const turn = queue.then(async () => {
        append(encoded, await encodeEntry(own, options.compress ?? true));
      });
      queue = turn.catch(() => undefined);
      try {
        await turn;
      } finally {
        pending -= 1;
      }
    },
    finish() {
      if (finished) throw new TypeError("The archive is already finished.");
      // An archive missing an entry would look complete, so it's never returned.
      if (pending > 0) throw new TypeError("An entry is still being added to the archive.");
      finished = true;
      const directoryOffset = offset;
      let directorySize = 0;
      for (const record of records) {
        const bytes = zipDirectoryRecord(record);
        parts.bytes(bytes);
        directorySize += bytes.length;
      }
      parts.bytes(zipEndRecords(records.length, directorySize, directoryOffset));
      return parts.finish();
    },
  };
}

/** One file of an archive. */
export interface ZipEntry {
  readonly name: string;
  /** Its size once read, in bytes. */
  readonly size: number;
  /** Its size in the archive, in bytes. */
  readonly compressedSize: number;
}

/** An archive that was opened: its entries, and how to read each. */
export interface ZipArchive {
  /** The files, by name, in the archive's order. Folders aren't listed. */
  readonly entries: ReadonlyMap<string, ZipEntry>;
  /**
   * One entry's bytes, checked against its declared size and CRC-32.
   * Rejects with `INVALID_DOCUMENT`: `missing-entry` for a name the archive
   * doesn't have, and `malformed-archive` for data that doesn't match.
   */
  read(name: string): Promise<Uint8Array<ArrayBuffer>>;
  /** As {@link ZipArchive.read}, as a `Blob`, without holding a stored entry in memory. */
  readBlob(name: string): Promise<Blob>;
}

/** What {@link readZip} accepts. */
export interface ZipLimits {
  /** The most entries the archive may list. */
  readonly maxEntries: number;
  /** The largest file, and the most bytes its entries may hold once read. */
  readonly maxSize: number;
}

function malformed(where: string): NotesError {
  return invalidDocument("malformed-archive", where);
}

function tooLarge(maximum: number, actual: number): NotesError {
  return new NotesError(
    "BACKUP_TOO_LARGE",
    `maxBackupSize is ${maximum} bytes, but the value is ${actual}.`,
    { details: { limit: "maxBackupSize", maximum, actual, unit: "bytes" } },
  );
}

function tooMany(maximum: number, actual: number): NotesError {
  return new NotesError(
    "TOO_MANY_BACKUP_ENTRIES",
    `maxBackupEntries is ${maximum} count, but the value is ${actual}.`,
    { details: { limit: "maxBackupEntries", maximum, actual, unit: "count" } },
  );
}

/** A range of the file, which must be wholly inside it. */
async function bytesAt(
  file: Blob,
  start: number,
  length: number,
  where: string,
): Promise<DataView> {
  if (start < 0 || length > file.size - start) throw malformed(where);
  const buffer = await file.slice(start, start + length).arrayBuffer();
  if (buffer.byteLength !== length) throw malformed(where);
  return new DataView(buffer);
}

/** A 64-bit value, refused when it's too large to be an exact number. */
function u64(view: DataView, at: number, where: string): number {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw malformed(where);
  return Number(value);
}

/** The ZIP64 block of a record's extra fields, if it has one. */
function zip64Block(extra: DataView, where: string): DataView | undefined {
  let at = 0;
  while (at < extra.byteLength) {
    if (extra.byteLength - at < 4) throw malformed(where);
    const size = extra.getUint16(at + 2, true);
    if (size > extra.byteLength - at - 4) throw malformed(where);
    if (extra.getUint16(at, true) === ZIP64_EXTRA) {
      return new DataView(extra.buffer, extra.byteOffset + at + 4, size);
    }
    at += 4 + size;
  }
  return undefined;
}

interface EndOfArchive {
  readonly count: number;
  readonly directorySize: number;
  readonly directoryOffset: number;
  /** Where the end records start: nothing of the directory may reach past it. */
  readonly start: number;
}

/** Finds and reads the records at the end of the file. */
async function readEnd(file: Blob): Promise<EndOfArchive> {
  const where = "end-of-central-directory";
  if (file.size < END_SIZE) throw malformed(where);
  // The record is last, followed only by a comment of at most 65,535 bytes.
  const tailSize = Math.min(file.size, END_SIZE + MAX_16);
  const tailStart = file.size - tailSize;
  const tail = await bytesAt(file, tailStart, tailSize, where);
  let found = -1;
  for (let at = tailSize - END_SIZE; at >= 0; at -= 1) {
    // A real record's comment ends exactly where the file does.
    if (
      tail.getUint32(at, true) === END_SIGNATURE &&
      tail.getUint16(at + 20, true) === tailSize - at - END_SIZE
    ) {
      found = at;
      break;
    }
  }
  if (found < 0) throw malformed(where);
  const endOffset = tailStart + found;
  const end = {
    disk: tail.getUint16(found + 4, true),
    directoryDisk: tail.getUint16(found + 6, true),
    countOnDisk: tail.getUint16(found + 8, true),
    count: tail.getUint16(found + 10, true),
    directorySize: tail.getUint32(found + 12, true),
    directoryOffset: tail.getUint32(found + 16, true),
  };

  if (endOffset >= ZIP64_LOCATOR_SIZE) {
    const locatorOffset = endOffset - ZIP64_LOCATOR_SIZE;
    const locator = await bytesAt(file, locatorOffset, ZIP64_LOCATOR_SIZE, where);
    if (locator.getUint32(0, true) === ZIP64_LOCATOR_SIGNATURE) {
      return readZip64End(file, locator, locatorOffset, end);
    }
  }
  if (end.disk !== 0 || end.directoryDisk !== 0 || end.countOnDisk !== end.count) {
    throw malformed(`${where}.disk`);
  }
  return {
    count: end.count,
    directorySize: end.directorySize,
    directoryOffset: end.directoryOffset,
    start: endOffset,
  };
}

/** Reads the ZIP64 end record a locator points at, and checks the short record agrees. */
async function readZip64End(
  file: Blob,
  locator: DataView,
  locatorOffset: number,
  short: {
    readonly disk: number;
    readonly directoryDisk: number;
    readonly countOnDisk: number;
    readonly count: number;
    readonly directorySize: number;
    readonly directoryOffset: number;
  },
): Promise<EndOfArchive> {
  const where = "zip64-end-of-central-directory";
  if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) > 1) {
    throw malformed(`${where}.disk`);
  }
  const start = u64(locator, 8, where);
  if (start > locatorOffset || locatorOffset - start < ZIP64_END_SIZE) throw malformed(where);
  const record = await bytesAt(file, start, ZIP64_END_SIZE, where);
  if (record.getUint32(0, true) !== ZIP64_END_SIGNATURE) throw malformed(where);
  // The record ends where its locator starts, whatever it holds after the fields read here.
  if (u64(record, 4, where) !== locatorOffset - start - 12) throw malformed(where);
  const countOnDisk = u64(record, 24, where);
  const count = u64(record, 32, where);
  const directorySize = u64(record, 40, where);
  const directoryOffset = u64(record, 48, where);
  if (
    record.getUint32(16, true) !== 0 ||
    record.getUint32(20, true) !== 0 ||
    countOnDisk !== count ||
    (short.disk !== 0 && short.disk !== MAX_16) ||
    (short.directoryDisk !== 0 && short.directoryDisk !== MAX_16)
  ) {
    throw malformed(`${where}.disk`);
  }
  // Each short field either says "see ZIP64" or the same as the ZIP64 record.
  const agrees = (value: number, wide: number, marker: number): boolean =>
    value === marker || value === wide;
  if (
    !agrees(short.countOnDisk, count, MAX_16) ||
    !agrees(short.count, count, MAX_16) ||
    !agrees(short.directorySize, directorySize, MAX_32) ||
    !agrees(short.directoryOffset, directoryOffset, MAX_32)
  ) {
    throw malformed(where);
  }
  return { count, directorySize, directoryOffset, start };
}

/** Reads a range of the file in order, a window at a time. */
function sequentialReader(file: Blob, start: number, end: number) {
  let buffer = new ArrayBuffer(0);
  let bufferStart = start;
  let position = start;
  return {
    /** The next `length` bytes, which must be inside the range. */
    async take(length: number, where: string): Promise<DataView> {
      if (length > end - position) throw malformed(where);
      if (position + length > bufferStart + buffer.byteLength) {
        const size = Math.min(end - position, Math.max(length, WINDOW_SIZE));
        buffer = await file.slice(position, position + size).arrayBuffer();
        if (buffer.byteLength !== size) throw malformed(where);
        bufferStart = position;
      }
      const view = new DataView(buffer, position - bufferStart, length);
      position += length;
      return view;
    },
  };
}

/** Where an entry is, and what its data must be. */
interface LocatedEntry extends ZipEntry {
  /** Its place in the central directory, for error messages. */
  readonly index: number;
  readonly method: number;
  readonly crc: number;
  readonly offset: number;
}

/** Reads the central directory, refusing anything a backup never has. */
async function readDirectory(
  file: Blob,
  end: EndOfArchive,
  limits: ZipLimits,
): Promise<Map<string, LocatedEntry>> {
  const reader = sequentialReader(
    file,
    end.directoryOffset,
    end.directoryOffset + end.directorySize,
  );
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const entries = new Map<string, LocatedEntry>();
  let total = 0;
  for (let index = 0; index < end.count; index += 1) {
    const where = `central-directory[${index}]`;
    const fixed = await reader.take(DIRECTORY_SIZE, where);
    if (fixed.getUint32(0, true) !== DIRECTORY_SIGNATURE) throw malformed(where);
    const flags = fixed.getUint16(8, true);
    if ((flags & FLAGS_ENCRYPTED) !== 0) throw malformed(`${where}.flags`);
    const method = fixed.getUint16(10, true);
    if (method !== STORED && method !== DEFLATED) throw malformed(`${where}.method`);
    const nameSize = fixed.getUint16(28, true);
    if (nameSize === 0 || nameSize > MAX_NAME_BYTES) throw malformed(`${where}.name`);
    const extraSize = fixed.getUint16(30, true);
    const commentSize = fixed.getUint16(32, true);
    if (fixed.getUint16(34, true) !== 0) throw malformed(`${where}.disk`);
    const crc = fixed.getUint32(16, true);
    let compressedSize = fixed.getUint32(20, true);
    let size = fixed.getUint32(24, true);
    let offset = fixed.getUint32(42, true);

    const rest = await reader.take(nameSize + extraSize + commentSize, where);
    let name: string;
    try {
      name = decoder.decode(new DataView(rest.buffer, rest.byteOffset, nameSize));
    } catch {
      throw malformed(`${where}.name`);
    }
    if (!isSafeName(name)) throw malformed(`${where}.name`);

    if (size === MAX_32 || compressedSize === MAX_32 || offset === MAX_32) {
      // The ZIP64 field holds, in this order, each value whose short field is all ones.
      const extra = new DataView(rest.buffer, rest.byteOffset + nameSize, extraSize);
      const block = zip64Block(extra, `${where}.extra`);
      let at = 0;
      const next = (): number => {
        if (!block || block.byteLength - at < 8) throw malformed(`${where}.extra`);
        at += 8;
        return u64(block, at - 8, `${where}.extra`);
      };
      if (size === MAX_32) size = next();
      if (compressedSize === MAX_32) compressedSize = next();
      if (offset === MAX_32) offset = next();
    }

    if (name.endsWith("/")) {
      // A folder: it holds nothing, and its files name it in their own paths.
      if (size !== 0) throw malformed(`${where}.name`);
      continue;
    }
    if (method === STORED && compressedSize !== size) throw malformed(`${where}.size`);
    // The header, the name and the data all lie before the central directory.
    if (
      offset > end.directoryOffset ||
      compressedSize > end.directoryOffset - offset ||
      end.directoryOffset - offset - compressedSize < LOCAL_SIZE + nameSize
    ) {
      throw malformed(`${where}.offset`);
    }
    if (entries.has(name)) throw malformed(`${where}.name`);
    total += size;
    if (total > limits.maxSize) throw tooLarge(limits.maxSize, total);
    entries.set(name, { name, size, compressedSize, index, method, crc, offset });
  }
  return entries;
}

/**
 * Opens a zip archive, treating it as hostile. Only the end of the file and
 * its central directory are read here; each entry is read, inflated and
 * checked when it's asked for.
 *
 * Rejects with `BACKUP_TOO_LARGE` for a file, or a declared total, over
 * `maxSize`, `TOO_MANY_BACKUP_ENTRIES` for more entries than `maxEntries`,
 * and `INVALID_DOCUMENT` with the reason `malformed-archive` for anything
 * that isn't a plain archive: a truncated or multi-disk one, an encrypted
 * entry, a compression other than deflate, an unsafe name or two entries
 * of one name.
 */
export async function readZip(file: Blob, limits: ZipLimits): Promise<ZipArchive> {
  if (file.size > limits.maxSize) throw tooLarge(limits.maxSize, file.size);
  const end = await readEnd(file);
  if (
    end.directoryOffset > end.start ||
    end.directorySize > end.start - end.directoryOffset ||
    end.count > Math.floor(end.directorySize / DIRECTORY_SIZE)
  ) {
    throw malformed("central-directory");
  }
  if (end.count > limits.maxEntries) throw tooMany(limits.maxEntries, end.count);
  const located = await readDirectory(file, end, limits);
  const entries = new Map<string, ZipEntry>();
  for (const { name, size, compressedSize } of located.values()) {
    entries.set(name, { name, size, compressedSize });
  }

  /** Checks an entry's local header against the directory, and returns its data as stored. */
  const dataOf = async (entry: LocatedEntry): Promise<Blob> => {
    const where = `entry[${entry.index}]`;
    const header = await bytesAt(file, entry.offset, LOCAL_SIZE, where);
    if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw malformed(where);
    const flags = header.getUint16(6, true);
    if ((flags & FLAGS_ENCRYPTED) !== 0) throw malformed(`${where}.flags`);
    if (header.getUint16(8, true) !== entry.method) throw malformed(`${where}.method`);
    const name = new TextEncoder().encode(entry.name);
    const nameSize = header.getUint16(26, true);
    const extraSize = header.getUint16(28, true);
    if (nameSize !== name.length) throw malformed(`${where}.name`);
    const dataStart = entry.offset + LOCAL_SIZE + nameSize + extraSize;
    if (dataStart > end.directoryOffset || entry.compressedSize > end.directoryOffset - dataStart) {
      throw malformed(`${where}.offset`);
    }
    const rest = await bytesAt(file, entry.offset + LOCAL_SIZE, nameSize + extraSize, where);
    for (let index = 0; index < nameSize; index += 1) {
      if (rest.getUint8(index) !== name[index]) throw malformed(`${where}.name`);
    }
    // With a data descriptor the local header's own sizes are blank: the directory's stand.
    if ((flags & FLAG_DESCRIPTOR) === 0) {
      let compressedSize = header.getUint32(18, true);
      let size = header.getUint32(22, true);
      if (size === MAX_32 || compressedSize === MAX_32) {
        const extra = new DataView(rest.buffer, nameSize, extraSize);
        const block = zip64Block(extra, `${where}.extra`);
        if (!block || block.byteLength < 16) throw malformed(`${where}.extra`);
        if (size === MAX_32) size = u64(block, 0, `${where}.extra`);
        if (compressedSize === MAX_32) compressedSize = u64(block, 8, `${where}.extra`);
      }
      if (size !== entry.size || compressedSize !== entry.compressedSize) {
        throw malformed(`${where}.size`);
      }
      if (header.getUint32(14, true) !== entry.crc) throw malformed(`${where}.crc`);
    }
    return file.slice(dataStart, dataStart + entry.compressedSize);
  };

  /** Reads an entry through to its end, checking its size and CRC-32 as it goes. */
  const extract = async (
    entry: LocatedEntry,
    keep: boolean,
  ): Promise<{ readonly data: Blob; readonly chunks: Bytes[] }> => {
    const where = `entry[${entry.index}]`;
    const data = await dataOf(entry);
    const stream =
      entry.method === DEFLATED ? data.stream().pipeThrough(decompressor()) : data.stream();
    const chunks: Bytes[] = [];
    let size = 0;
    let crc = 0;
    try {
      await forEachChunk(stream, (chunk) => {
        size += chunk.length;
        // Stops at the first byte too many, before a bomb has grown. The
        // declared sizes were summed against `maxSize` when the directory
        // was read, so this also keeps everything read within that limit.
        if (size > entry.size) throw malformed(`${where}.size`);
        crc = crc32(chunk, crc);
        if (keep) chunks.push(chunk);
      });
    } catch (error) {
      // The platform's inflater fails with a TypeError for data that isn't deflate.
      if (entry.method === DEFLATED && error instanceof TypeError) throw malformed(`${where}.data`);
      throw error;
    }
    if (size !== entry.size) throw malformed(`${where}.size`);
    if (crc !== entry.crc) throw malformed(`${where}.crc`);
    return { data, chunks };
  };

  const find = (name: string): LocatedEntry => {
    const entry = located.get(name);
    if (!entry) throw invalidDocument("missing-entry", "archive");
    return entry;
  };

  return {
    entries,
    async read(name) {
      const entry = find(name);
      const { chunks } = await extract(entry, true);
      return concat(chunks, entry.size);
    },
    async readBlob(name) {
      const entry = find(name);
      if (entry.method === STORED) {
        // Checked without being kept: the result is a slice of the file itself.
        const { data } = await extract(entry, false);
        return data;
      }
      const { chunks } = await extract(entry, true);
      return new Blob(chunks);
    },
  };
}
