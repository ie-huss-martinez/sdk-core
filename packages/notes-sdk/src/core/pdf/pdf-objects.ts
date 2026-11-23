/**
 * A minimal writer of PDF 1.7 files (ISO 32000-1): objects, streams, the
 * cross-reference table and the trailer. It writes only what the notes
 * exporter needs, and everything it writes outside a stream's data is ASCII.
 */

/** A PDF name, such as `/Type`. */
export class PdfName {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

/** A reference to an indirect object, written as `N 0 R`. */
export class PdfRef {
  /** The object's number, from 1. */
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }
}

/** A PDF string: bytes, written as a literal `(...)` or in hexadecimal `<...>`. */
export class PdfString {
  readonly bytes: Uint8Array;
  readonly hex: boolean;

  constructor(bytes: Uint8Array, hex = false) {
    this.bytes = bytes;
    this.hex = hex;
  }
}

/** A PDF dictionary. Entries that are `undefined` are left out. */
export interface PdfDictionary {
  readonly [key: string]: PdfObject | undefined;
}

/** Anything a PDF object can be, except a stream, which the writer adds itself. */
export type PdfObject =
  | number
  | boolean
  | null
  | PdfName
  | PdfRef
  | PdfString
  | readonly PdfObject[]
  | PdfDictionary;

/** A PDF name. */
export function pdfName(value: string): PdfName {
  return new PdfName(value);
}

/**
 * A PDF text string, as the `Info` dictionary holds: a literal string when
 * the text is printable ASCII, and UTF-16BE with a byte order mark, in
 * hexadecimal, otherwise.
 */
export function pdfTextString(text: string): PdfString {
  if (/^[\x20-\x7e]*$/.test(text)) return new PdfString(latin1Bytes(text));
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes[2 + index * 2] = unit >> 8;
    bytes[3 + index * 2] = unit & 0xff;
  }
  return new PdfString(bytes, true);
}

/** The most decimals a number is written with. */
const MAX_DECIMALS = 4;

/**
 * Writes a number as PDF reads it: in plain decimal notation, never with an
 * exponent, with at most four decimals by default, and never as `-0`.
 *
 * @throws `TypeError` for a number that isn't finite, or is too large to
 * write without an exponent.
 */
export function formatPdfNumber(value: number, decimals: number = MAX_DECIMALS): string {
  // toFixed switches to an exponent from 1e21.
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) {
    throw new TypeError("A PDF number must be finite.");
  }
  const places = Math.min(Math.max(Math.trunc(decimals), 0), MAX_DECIMALS);
  let text = value.toFixed(places);
  if (places > 0) text = text.replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/** Characters that end a name, so a name writes them as `#xx`. */
const NAME_DELIMITERS = new Set("()<>[]{}/%#");

function serializeName(value: string): string {
  let text = "/";
  for (const byte of new TextEncoder().encode(value)) {
    const character = String.fromCharCode(byte);
    text +=
      byte < 0x21 || byte > 0x7e || NAME_DELIMITERS.has(character)
        ? `#${byte.toString(16).padStart(2, "0")}`
        : character;
  }
  return text;
}

const BACKSLASH = 0x5c;
const OPEN_PARENTHESIS = 0x28;
const CLOSE_PARENTHESIS = 0x29;

function serializeString(value: PdfString): string {
  let text = "";
  if (value.hex) {
    for (const byte of value.bytes) text += byte.toString(16).padStart(2, "0");
    return `<${text}>`;
  }
  for (const byte of value.bytes) {
    if (byte === BACKSLASH || byte === OPEN_PARENTHESIS || byte === CLOSE_PARENTHESIS) {
      text += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x20 || byte > 0x7e) {
      // Three octal digits, so a digit that follows is never read as part of it.
      text += `\\${byte.toString(8).padStart(3, "0")}`;
    } else {
      text += String.fromCharCode(byte);
    }
  }
  return `(${text})`;
}

/** Writes an object in PDF syntax, in ASCII. */
export function serializePdfObject(value: PdfObject): string {
  if (value === null) return "null";
  if (typeof value === "number") return formatPdfNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof PdfName) return serializeName(value.value);
  if (value instanceof PdfRef) return `${value.id} 0 R`;
  if (value instanceof PdfString) return serializeString(value);
  if (isArray(value)) return `[${value.map(serializePdfObject).join(" ")}]`;
  const entries: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) entries.push(`${serializeName(key)} ${serializePdfObject(entry)}`);
  }
  return entries.length === 0 ? "<<>>" : `<< ${entries.join(" ")} >>`;
}

/** `Array.isArray`, which doesn't narrow a readonly array on its own. */
function isArray(value: PdfObject): value is readonly PdfObject[] {
  return Array.isArray(value);
}

/** The bytes of a string whose characters are all below 256. */
export function latin1Bytes(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/**
 * Compresses bytes in the zlib format, which is what PDF's `FlateDecode`
 * reads, with the platform's `CompressionStream`. Resolves to `undefined`
 * where the platform has none, so the caller writes the bytes as they are.
 */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream !== "function") return undefined;
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const write = async (): Promise<void> => {
    await writer.write(bytes as Uint8Array<ArrayBuffer>);
    await writer.close();
  };
  const read = async (): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    return concatBytes(chunks, length);
  };
  // Written and read together: the stream holds little, and stops taking
  // input until its output is read.
  const [, compressed] = await Promise.all([write(), read()]);
  return compressed;
}

function concatBytes(chunks: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** How a stream is written. */
export interface PdfStreamOptions {
  /**
   * Whether to compress the data with `FlateDecode`. Where the platform
   * can't compress, the data is written as it is. Leave it off for data that
   * already has a filter, such as a JPEG.
   */
  readonly compress?: boolean;
}

/** The header: the version, then a comment of four bytes above 127, which marks the file as binary. */
const HEADER = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";

/**
 * Collects a file's indirect objects and writes them out with their
 * cross-reference table. Objects are numbered in the order they're added or
 * reserved, so the same calls always write the same bytes.
 */
export class PdfWriter {
  /** Each object's body, by its number less one. A reserved object has none yet. */
  readonly #bodies: (Uint8Array | undefined)[] = [];

  /** Takes an object number for an object that's set later, such as a parent its children name. */
  reserve(): PdfRef {
    this.#bodies.push(undefined);
    return new PdfRef(this.#bodies.length);
  }

  /**
   * Gives a reserved object its value.
   *
   * @throws `TypeError` for a reference that isn't reserved, or is already set.
   */
  set(ref: PdfRef, object: PdfObject): void {
    if (!Number.isInteger(ref.id) || ref.id < 1 || ref.id > this.#bodies.length) {
      throw new TypeError("The reference isn't one of this writer's.");
    }
    if (this.#bodies[ref.id - 1] !== undefined) {
      throw new TypeError(`Object ${ref.id} is already set.`);
    }
    this.#bodies[ref.id - 1] = latin1Bytes(serializePdfObject(object));
  }

  /** Adds an object. */
  add(object: PdfObject): PdfRef {
    const ref = this.reserve();
    this.set(ref, object);
    return ref;
  }

  /**
   * Adds a stream: a dictionary and its data. `Length` is written for the
   * caller, and `Filter` too when the data is compressed here.
   */
  async addStream(
    dictionary: PdfDictionary,
    bytes: Uint8Array,
    options: PdfStreamOptions = {},
  ): Promise<PdfRef> {
    // Reserved before compressing, so objects are numbered in call order
    // whatever finishes first.
    const ref = this.reserve();
    const compressed = options.compress ? await deflate(bytes) : undefined;
    const data = compressed ?? bytes;
    const head = latin1Bytes(
      `${serializePdfObject({
        ...dictionary,
        ...(compressed ? { Filter: pdfName("FlateDecode") } : {}),
        Length: data.length,
      })}\nstream\n`,
    );
    const tail = latin1Bytes("\nendstream");
    this.#bodies[ref.id - 1] = concatBytes(
      [head, data, tail],
      head.length + data.length + tail.length,
    );
    return ref;
  }

  /**
   * Writes the file: the header, every object, the cross-reference table
   * and the trailer.
   *
   * @param root - The document's catalog.
   * @param info - The document's `Info` dictionary, if it has one.
   * @throws `TypeError` if a reserved object was never set.
   */
  finish(root: PdfRef, info?: PdfRef): Uint8Array<ArrayBuffer> {
    const chunks: Uint8Array[] = [latin1Bytes(HEADER)];
    let length = HEADER.length;
    const push = (text: string): void => {
      chunks.push(latin1Bytes(text));
      length += text.length;
    };
    const offsets: number[] = [];
    for (const [index, body] of this.#bodies.entries()) {
      if (body === undefined)
        throw new TypeError(`Object ${index + 1} was reserved but never set.`);
      offsets.push(length);
      push(`${index + 1} 0 obj\n`);
      chunks.push(body);
      length += body.length;
      push("\nendobj\n");
    }
    const start = length;
    const size = this.#bodies.length + 1;
    // Each entry is exactly 20 bytes: the offset, the generation, the kind
    // and a two-byte line ending.
    let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (const offset of offsets) table += `${String(offset).padStart(10, "0")} 00000 n \n`;
    push(table);
    push(`trailer\n${serializePdfObject({ Size: size, Root: root, Info: info })}\n`);
    push(`startxref\n${start}\n%%EOF\n`);
    return concatBytes(chunks, length);
  }
}
