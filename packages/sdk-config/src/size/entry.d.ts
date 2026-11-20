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
export function entryFiles(entry: string): string[];
/**
 * @param {string | Uint8Array} content
 * @returns {number} Its size in bytes, compressed with brotli at its highest
 *   quality, as `size-limit` measures a file.
 */
export function brotliSize(content: string | Uint8Array): number;
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
export function measureEntry(entry: string): Promise<EntrySize>;
/**
 * @param {number} bytes
 * @returns {string} As `size-limit` prints sizes: kilobytes of 1,000 bytes,
 *   with two decimals.
 */
export function formatKilobytes(bytes: number): string;
/**
 * An error the user can fix, reported as a message without a stack trace.
 */
export class UsageError extends Error {
}
export type EntrySize = {
    /**
     * The entry, as given.
     */
    entry: string;
    /**
     * The files it loads, from {@link entryFiles}.
     */
    files: string[];
    /**
     * The brotli size of those files as built, in
     * bytes: what the entry's size budget counts.
     */
    built: number;
    /**
     * The brotli size of the same files minified, in
     * bytes. For information only: it's never a budget (ADR 0055).
     */
    minified: number;
};
