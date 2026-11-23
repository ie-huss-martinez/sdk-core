/**
 * What a picture's own header says it is, read before anything decodes it
 * (sdk-core ADR 0020, docs/adr/0004): its kind and its size in pixels.
 */
export interface ImageProbe {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  readonly width: number;
  readonly height: number;
}

/** How far into a JPEG its size is looked for: past any embedded preview. */
const JPEG_SEARCH = 1_048_576;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const starts = (bytes: Uint8Array, ...expected: number[]) =>
  bytes.length >= expected.length && expected.every((byte, index) => bytes[index] === byte);

function png(bytes: Uint8Array): ImageProbe | undefined {
  // The signature, then the IHDR chunk: its length, its name, then width and height.
  if (bytes.length < 24 || !starts(bytes.subarray(12), 0x49, 0x48, 0x44, 0x52)) return undefined;
  const data = view(bytes);
  return { mediaType: "image/png", width: data.getUint32(16), height: data.getUint32(20) };
}

function gif(bytes: Uint8Array): ImageProbe | undefined {
  if (bytes.length < 10) return undefined;
  const data = view(bytes);
  return {
    mediaType: "image/gif",
    width: data.getUint16(6, true),
    height: data.getUint16(8, true),
  };
}

function webp(bytes: Uint8Array): ImageProbe | undefined {
  if (bytes.length < 30) return undefined;
  const data = view(bytes);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    // The extended header: width and height, each less one, in 24 bits.
    const width = 1 + (data.getUint16(24, true) | ((bytes[26] ?? 0) << 16));
    const height = 1 + (data.getUint16(27, true) | ((bytes[29] ?? 0) << 16));
    return { mediaType: "image/webp", width, height };
  }
  if (chunk === "VP8 ") {
    // A lossy frame: its start code, then width and height in 14 bits each.
    if (!starts(bytes.subarray(23), 0x9d, 0x01, 0x2a)) return undefined;
    return {
      mediaType: "image/webp",
      width: data.getUint16(26, true) & 0x3fff,
      height: data.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    // A lossless frame: a signature byte, then width and height, each less one, in 14 bits.
    if (bytes[20] !== 0x2f) return undefined;
    const bits = data.getUint32(21, true);
    return {
      mediaType: "image/webp",
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  return undefined;
}

function jpeg(bytes: Uint8Array): ImageProbe | undefined {
  const data = view(bytes);
  let offset = 2;
  // Segment by segment, to the frame header that carries the size.
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Markers that stand alone, with no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = data.getUint16(offset + 2);
    if (length < 2) return undefined;
    const frame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      return {
        mediaType: "image/jpeg",
        height: data.getUint16(offset + 5),
        width: data.getUint16(offset + 7),
      };
    }
    // The scan follows: a frame header would have come before it.
    if (marker === 0xda || marker === 0xd9) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

/**
 * Reads a picture's kind and size from its header: PNG, JPEG, WebP or GIF,
 * told by its first bytes, never by its name or the type the browser
 * guessed. Resolves to `undefined` for anything else, including a file of
 * one of those kinds whose header is cut short or malformed.
 *
 * It reads fixed fields at checked offsets and decodes nothing, so a
 * picture's pixels can be bounded before the browser's decoder sees it.
 */
export async function probeImage(file: Blob): Promise<ImageProbe | undefined> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  let probe: ImageProbe | undefined;
  if (starts(head, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) probe = png(head);
  else if (starts(head, 0x47, 0x49, 0x46, 0x38)) probe = gif(head);
  else if (
    starts(head, 0x52, 0x49, 0x46, 0x46) &&
    starts(head.subarray(8), 0x57, 0x45, 0x42, 0x50)
  ) {
    probe = webp(head);
  } else if (starts(head, 0xff, 0xd8, 0xff)) {
    probe = jpeg(new Uint8Array(await file.slice(0, JPEG_SEARCH).arrayBuffer()));
  }
  if (!probe || probe.width < 1 || probe.height < 1) return undefined;
  return probe;
}
