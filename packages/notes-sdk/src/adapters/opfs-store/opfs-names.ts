/**
 * The names ids have in the origin private file system.
 *
 * An id tells `a` from `A`, but a file system may not: WebKit keeps each
 * entry as a real file under its own name, and the disk of a Mac folds
 * case by default. There, two pages whose ids differ only by case would be
 * one file, and the second would replace the first. So an uppercase letter
 * is written as `~` and its lowercase: no two ids share a name, on any
 * disk. `~` is in no id, and is an ordinary character in a file name.
 */

const UPPERCASE = /[A-Z]/g;
const ESCAPED = /~([a-z])/g;
const FILE_NAME = /^(?:[a-z0-9_-]|~[a-z])+$/;

/**
 * The file-system name of an id, or of a storage name: the same letters,
 * with each uppercase one as `~` and its lowercase.
 *
 * @param id - A checked id: letters, digits, `-` and `_`.
 */
export function toFileName(id: string): string {
  return id.replace(UPPERCASE, (letter) => `~${letter.toLowerCase()}`);
}

/**
 * The id a file-system name stands for, or `undefined` for a name
 * {@link toFileName} never writes, such as a browser's own temporary file.
 */
export function fromFileName(name: string): string | undefined {
  if (!FILE_NAME.test(name)) return undefined;
  return name.replace(ESCAPED, (_, letter: string) => letter.toUpperCase());
}

const ASSET_PREFIX = "sha256:";
const ASSET_FILE = /^[0-9a-f]{64}$/;

/**
 * The file-system name of an asset: its hash, without the `sha256:` a file
 * name can't hold everywhere.
 *
 * @param asset - A checked asset name.
 */
export function toAssetFileName(asset: string): string {
  return asset.slice(ASSET_PREFIX.length);
}

/** The asset a file-system name stands for, or `undefined` if it isn't a hash. */
export function fromAssetFileName(name: string): string | undefined {
  return ASSET_FILE.test(name) ? `${ASSET_PREFIX}${name}` : undefined;
}
