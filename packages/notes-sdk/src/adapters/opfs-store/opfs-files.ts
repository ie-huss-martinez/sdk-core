import { invalidDocument } from "../../core/errors/notes-error.js";
import { isNotFound } from "./storage-errors.js";

/**
 * File helpers over the origin private file system. What isn't there reads
 * as `undefined` and deletes without error. Other failures are thrown as
 * the browser threw them, for the store to map.
 */

/**
 * The folder at a path below `root`, or `undefined` if any part is missing.
 *
 * @param root - Where the path starts.
 * @param path - The names of the folders, outermost first.
 */
export async function findDirectory(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
): Promise<FileSystemDirectoryHandle | undefined> {
  let directory = root;
  for (const name of path) {
    try {
      directory = await directory.getDirectoryHandle(name);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }
  return directory;
}

/** The folder at a path below `root`, making each part that is missing. */
export async function makeDirectory(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
): Promise<FileSystemDirectoryHandle> {
  let directory = root;
  for (const name of path) directory = await directory.getDirectoryHandle(name, { create: true });
  return directory;
}

/** A file of a folder, or `undefined` if either is missing. */
export async function readFile(
  directory: FileSystemDirectoryHandle | undefined,
  name: string,
): Promise<File | undefined> {
  if (!directory) return undefined;
  try {
    const handle = await directory.getFileHandle(name);
    return await handle.getFile();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/**
 * A file's text, or `undefined` if the file is missing or empty.
 *
 * An empty file is what a first write leaves when the tab dies before the
 * write ends: the file was made, and nothing replaced it. Nothing was ever
 * stored there, so it reads as missing. No document is empty.
 *
 * The bytes must be UTF-8: a damaged file is refused as `INVALID_DOCUMENT`,
 * and not read with its bad bytes replaced.
 */
export async function readText(
  directory: FileSystemDirectoryHandle | undefined,
  name: string,
): Promise<string | undefined> {
  const file = await readFile(directory, name);
  if (!file || file.size === 0) return undefined;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidDocument("malformed-document", "$");
  }
}

/**
 * Writes a file as a whole, or not at all.
 *
 * `createWritable()` writes to a temporary file, which replaces the real
 * one only when `close()` succeeds. On any failure the temporary file is
 * dropped with `abort()`, so the file keeps what it held. A file that this
 * call made, and then couldn't fill, is removed again.
 *
 * @param directory - The folder, which must exist.
 * @param name - The file's name.
 * @param data - The file's whole contents. Text is written as UTF-8.
 */
export async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  data: string | Blob,
): Promise<void> {
  let handle: FileSystemFileHandle;
  let made = false;
  try {
    handle = await directory.getFileHandle(name);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    handle = await directory.getFileHandle(name, { create: true });
    made = true;
  }
  let writable: FileSystemWritableFileStream | undefined;
  try {
    writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (error) {
    // Both are best effort: the failure to report is the write's own.
    await writable?.abort().catch(() => undefined);
    if (made) await directory.removeEntry(name).catch(() => undefined);
    throw error;
  }
}

/**
 * Removes a file, or a folder with everything in it. Resolves when it's
 * gone, including when it was never there.
 */
export async function removeEntry(
  directory: FileSystemDirectoryHandle | undefined,
  name: string,
  recursive = false,
): Promise<void> {
  if (!directory) return;
  try {
    await directory.removeEntry(name, { recursive });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/**
 * The folders in a folder, by name. A missing folder has none.
 */
export async function listDirectories(
  directory: FileSystemDirectoryHandle | undefined,
): Promise<[name: string, handle: FileSystemDirectoryHandle][]> {
  const found: [string, FileSystemDirectoryHandle][] = [];
  if (!directory) return found;
  try {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "directory") found.push([name, handle]);
    }
  } catch (error) {
    // Removed while it was being listed.
    if (!isNotFound(error)) throw error;
  }
  return found;
}

/** The names of the files in a folder. A missing folder has none. */
export async function listFiles(
  directory: FileSystemDirectoryHandle | undefined,
): Promise<string[]> {
  const found: string[] = [];
  if (!directory) return found;
  try {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === "file") found.push(name);
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return found;
}
