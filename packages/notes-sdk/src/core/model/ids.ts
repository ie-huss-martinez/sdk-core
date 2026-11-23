import { NOTES_MAX_ID_LENGTH } from "./portable.js";

const ID = /^[A-Za-z0-9_-]+$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** Whether a value is a valid identifier of the notes model. */
export function isNotesId(value: unknown): value is string {
  return typeof value === "string" && value.length <= NOTES_MAX_ID_LENGTH && ID.test(value);
}

/**
 * A new random identifier: 22 characters holding 128 random bits, from the
 * platform's cryptographic generator.
 *
 * @public
 */
export function createNotesId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte & 63];
  return id;
}

const ASSET = /^sha256:[0-9a-f]{64}$/;

/** Whether a value is an asset's name: `sha256:` and 64 hexadecimal digits. */
export function isAssetName(value: unknown): value is string {
  return typeof value === "string" && ASSET.test(value);
}

/** The asset name of some bytes: their SHA-256, as `sha256:<hex>`. */
export async function assetNameOf(data: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}
