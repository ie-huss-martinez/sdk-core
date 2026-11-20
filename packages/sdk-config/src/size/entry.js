// What a built entry point loads, and how big it is (sdk-core ADR 0055), for
// `.size-limit.js` and for the tables in pull requests that raise a budget.
//
// Tooling only: this entry is never imported by published runtime code.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

/**
 * An error the user can fix, reported as a message without a stack trace.
 */
export class UsageError extends Error {
  /** @override */
  name = "UsageError";
}

/**
 * A static import or re-export of a relative `.js` file: `from "./a.js"`,
 * or `import "./a.js"` for its side effects. `import("./a.js")`, which loads
 * a chunk later, has a parenthesis before the quote and doesn't match.
 */
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*(["'])(\.{1,2}\/[^"'\n]+?\.js)\1/g;

/**
 * The built files an entry loads up front: the entry itself, and every chunk
 * it imports statically, directly or through other chunks. Chunks loaded
 * later with `import()` aren't included: an application only receives them
 * when it uses what they hold, and each has a size budget of its own.
 *
 * It's what an entry's size budget counts (ADR 0055): only what this entry
 * loads, so one entry's budget doesn't pay for a chunk only another loads.
 *
 * @example
 * ```js
 * // .size-limit.js
 * import { entryFiles } from "@hussmartinez/sdk-config/size";
 *
 * export default [
 *   { name: "Core (.)", path: entryFiles("dist/index.js"), brotli: true, limit: "17 kB" },
 * ];
 * ```
 *
 * @param {string} entry The built entry, such as `dist/index.js`, relative to
 *   the working directory or absolute.
 * @returns {string[]} The entry and the chunks it loads, entry first, each
 *   once.
 * @throws {UsageError} If the entry, or a file it imports, doesn't exist,
 *   as before a build.
 */
export function entryFiles(entry) {
  /** @type {Set<string>} */
  const seen = new Set();
  const visit = (/** @type {string} */ path, /** @type {string | undefined} */ from) => {
    if (seen.has(path)) {
      return;
    }
    if (!existsSync(path)) {
      throw new UsageError(
        from === undefined
          ? `${path} doesn't exist. Build the package first.`
          : `${path}, which ${from} imports, doesn't exist. Build the package again.`,
      );
    }
    seen.add(path);
    for (const [, , specifier = ""] of readFileSync(path, "utf8").matchAll(STATIC_IMPORT)) {
      visit(normalize(join(dirname(path), specifier)), path);
    }
  };
  visit(normalize(entry), undefined);
  return [...seen];
}

/**
 * @param {string | Uint8Array} content
 * @returns {number} Its size in bytes, compressed with brotli at its highest
 *   quality, as `size-limit` measures a file.
 */
export function brotliSize(content) {
  return brotliCompressSync(typeof content === "string" ? Buffer.from(content) : content, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  }).length;
}

/**
 * @typedef {object} EntrySize
 * @property {string} entry The entry, as given.
 * @property {string[]} files The files it loads, from {@link entryFiles}.
 * @property {number} built The brotli size of those files as built, in
 *   bytes: what the entry's size budget counts.
 * @property {number} minified The brotli size of the same files minified, in
 *   bytes. For information only: it's never a budget (ADR 0055).
 */

/**
 * Measures an entry as its size budget does, and again minified, with Vite's
 * minifier, as an application's bundler would ship the same files. The
 * second number is information for a pull request's table: a fifth to a
 * quarter below the first in every package, and never a budget.
 *
 * It needs `vite`, which every package builds with.
 *
 * @param {string} entry The built entry, such as `dist/index.js`.
 * @returns {Promise<EntrySize>}
 * @throws {UsageError} If the entry isn't built, or `vite` isn't installed.
 */
export async function measureEntry(entry) {
  const files = entryFiles(entry);
  /** @type {typeof import("vite")["minifySync"]} */
  let minifySync;
  try {
    ({ minifySync } = await import("vite"));
  } catch {
    throw new UsageError("vite isn't installed; it provides the minifier.");
  }
  let built = 0;
  let minified = 0;
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    built += brotliSize(code);
    minified += brotliSize(minifySync(file, code, { module: true }).code);
  }
  return { entry, files, built, minified };
}

/**
 * @param {number} bytes
 * @returns {string} As `size-limit` prints sizes: kilobytes of 1,000 bytes,
 *   with two decimals.
 */
export function formatKilobytes(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}
