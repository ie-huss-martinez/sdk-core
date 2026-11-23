import { cleanFileName } from "@hussmartinez/sdk-core";
import { NotesError } from "../core/errors/notes-error.js";
import type { NotesFilePolicy } from "../core/errors/notes-limits.js";
import { probeImage } from "../core/files/image-probe.js";

/**
 * Checks a picture a user chose, against the file policy (sdk-core
 * ADR 0020, docs/adr/0004): its size in bytes, then its kind and its pixels
 * as its own header gives them, before anything decodes it. Only then does
 * the browser's decoder see it, and what it decoded is checked again.
 */
export async function checkImage(
  file: Blob,
  policy: NotesFilePolicy,
): Promise<{ readonly mediaType: string; readonly width: number; readonly height: number }> {
  policy.check("maxFileSize", file.size);
  const probe = await probeImage(file);
  if (!probe) {
    throw new NotesError("UNSUPPORTED_FILE", "The file isn't a PNG, JPEG, WebP or GIF picture.");
  }
  policy.check("maxImagePixels", probe.width * probe.height);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    throw new NotesError("UNSUPPORTED_FILE", "The picture couldn't be decoded.", { cause });
  }
  const { width, height } = bitmap;
  bitmap.close();
  policy.check("maxImagePixels", width * height);
  return { mediaType: probe.mediaType, width, height };
}

/** A download's name from a title: cleaned as any file name is, with an extension. */
export function downloadName(title: string, extension: string, fallback: string): string {
  const cleaned = cleanFileName(`${title}.${extension}`);
  return cleaned ?? `${fallback}.${extension}`;
}

/** Hands a file to the browser to download. */
export function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has been handled: revoking at once can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Bytes as a file of a given type. The exporters return buffers of their
 * own, never shared memory, which is what a `Blob` takes.
 */
export function toBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
}
