/**
 * The chunks an entry loads later with `import()`, as an esbuild `external`
 * pattern: the family's builds put them in `lazy/` beside the entry. They
 * have budgets of their own, and a bundler without code splitting would
 * otherwise inline them.
 *
 * The pattern is the folder's absolute path, which esbuild matches against
 * each import once it's resolved. So it leaves out this entry's own lazy
 * chunks, whether the entry or a shared chunk imports them, and nothing
 * else: a `lazy/` folder inside a dependency is still counted.
 *
 * @param {string} entry The built entry, such as `dist/index.js`.
 * @returns {string[]}
 */
export function lazyChunks(entry: string): string[];
/**
 * A size budget for an entry: a ceiling on the brotli size of the built
 * entry and the chunks it loads statically (ADR 0055), as a `size-limit`
 * check. It measures the files as built, so it turns `size-limit`'s esbuild
 * plugin off for this check.
 *
 * @example
 * ```js
 * entryBudget({ name: "Core (.)", entry: "dist/index.js", limit: "17 kB" });
 * ```
 *
 * @param {{ name: string, entry: string, limit: string }} options The
 *   check's name, the built entry, and the limit, such as `"17 kB"`.
 * @returns {{ name: string, path: string[], brotli: true, limit: string, disablePlugins: string[] }}
 * @throws {UsageError} If the entry isn't built.
 */
export function entryBudget({ name, entry, limit }: {
    name: string;
    entry: string;
    limit: string;
}): {
    name: string;
    path: string[];
    brotli: true;
    limit: string;
    disablePlugins: string[];
};
/**
 * A size budget for what an application imports from an entry (ADR 0056), as
 * a `size-limit` check for its esbuild plugin: the import bundled and
 * minified, as the application's bundler would ship it, without the host's
 * packages, the family's, or the entry's lazy chunks, compressed with brotli.
 *
 * Each core and React entry has a floor (the cheapest import a host would
 * make, whose limit is its size rounded up to the next 0.1 kB and is never
 * raised), each piece over about 2 kB on its own, and what a typical
 * application imports. Their limits round up to the next 0.5 kB.
 *
 * It needs `@size-limit/esbuild` beside `size-limit`.
 *
 * The check bundles as {@link importCost} does: as an ES module, with
 * `process.env.NODE_ENV` defined as `"production"`. The plugin sets neither
 * itself, so by default it wraps the bundle in a function, as a script for a
 * page would be, and leaves the environment to esbuild's own default. Pass
 * `modifyEsbuildConfig` to change the bundle further: it receives the
 * configuration with both already set, and what it returns is used.
 *
 * @example
 * ```js
 * importBudget({
 *   name: "Import: the floor, PdfError",
 *   entry: "dist/index.js",
 *   imports: "{ PdfError }",
 *   limit: "0.9 kB",
 * });
 * ```
 *
 * @param {{ name: string, entry: string, imports: string, limit: string, ignore?: readonly string[], modifyEsbuildConfig?: (config: EsbuildConfig) => EsbuildConfig }} options
 *   `imports` is the import clause, such as `"{ a, b }"`. `ignore` adds
 *   esbuild `external` patterns to leave out, for a package that puts its
 *   lazy chunks somewhere other than `lazy/` beside the entry.
 *   `modifyEsbuildConfig` changes the bundle's configuration after this
 *   has set its own.
 * @returns {{ name: string, path: string, import: string, ignore: string[], brotli: true, limit: string, modifyEsbuildConfig: (config: EsbuildConfig) => EsbuildConfig }}
 */
export function importBudget({ name, entry, imports, limit, ignore, modifyEsbuildConfig }: {
    name: string;
    entry: string;
    imports: string;
    limit: string;
    ignore?: readonly string[];
    modifyEsbuildConfig?: (config: EsbuildConfig) => EsbuildConfig;
}): {
    name: string;
    path: string;
    import: string;
    ignore: string[];
    brotli: true;
    limit: string;
    modifyEsbuildConfig: (config: EsbuildConfig) => EsbuildConfig;
};
/**
 * The names a built entry exports, in the order it lists them, as an
 * application can import them. It follows `export * from "./file.js"` into
 * relative files, as far as they go, and reads the files without running
 * them. As the language has it:
 *
 * - a name a module exports itself wins over one that arrives through `*`;
 * - a name that arrives through two `*` from two different declarations is
 *   ambiguous, can't be imported, and is left out;
 * - `default` never passes through `*`, and isn't listed.
 *
 * A star re-export of a package can't be read this way, and is left out.
 *
 * @param {string} entry The built entry, such as `dist/index.js`.
 * @returns {string[]}
 * @throws {UsageError} If the entry, or a file it re-exports, isn't there.
 */
export function exportNames(entry: string): string[];
/**
 * @typedef {object} ImportCost
 * @property {string} imports The import clause that was measured.
 * @property {number} size What an application ships for it, in bytes:
 *   bundled, minified and compressed with brotli.
 */
/**
 * @typedef {object} KeptCode
 * @property {number} functions Function declarations left in the bundle.
 * @property {Array<{ call: string, count: number }>} calls Calls at the top
 *   level whose result is assigned, by what's called, most frequent first.
 *   Unless a call is marked `/* @__PURE__ *\/`, a bundler keeps it, and
 *   everything it refers to, whether or not the import uses it.
 */
/**
 * The local names an import clause binds, to use each of them: `Thing` for a
 * default import, `ns` for `* as ns`, and for `{ a, b as c }`, `a` and `c`.
 *
 * @param {string} imports The import clause.
 * @returns {string[]}
 * @throws {UsageError} If the clause binds no name.
 */
export function importedNames(imports: string): string[];
/**
 * Measures what an application ships when it imports part of a built entry
 * (ADR 0056): the import bundled and minified with esbuild, without the
 * host's and the family's packages and without the entry's lazy chunks,
 * compressed with brotli. A third-party runtime dependency is bundled in and
 * counted.
 *
 * It's the measurement behind {@link importBudget}. `size-limit` reports
 * less for the same import, by up to about 0.1 kB, because it subtracts the
 * size of an empty bundle. A budget's limit is set from `size-limit`'s
 * number; this one is for comparing imports, and before with after.
 *
 * It needs `esbuild`.
 *
 * @param {string} entry The built entry, such as `dist/react.js`.
 * @param {string} imports The import clause, such as `"{ Button }"`.
 * @returns {Promise<ImportCost>}
 * @throws {UsageError} If the entry isn't built, `esbuild` isn't installed,
 *   or the import can't be bundled, as for a name the entry doesn't export.
 */
export function importCost(entry: string, imports: string): Promise<ImportCost>;
/**
 * Measures {@link importCost} for each export of a built entry on its own,
 * cheapest first. The first is the entry's floor: what the cheapest import
 * costs. A floor close to the whole entry means the entry doesn't come
 * apart, and {@link keptCode} shows what holds it together.
 *
 * @param {string} entry The built entry, such as `dist/react.js`.
 * @returns {Promise<Array<{ name: string, size: number }>>}
 * @throws {UsageError} As {@link importCost} does.
 */
export function exportCosts(entry: string): Promise<Array<{
    name: string;
    size: number;
}>>;
/**
 * Shows what an import keeps in its bundle, to find why it costs more than
 * it should: the same bundle as {@link importCost}, unminified, with its
 * function declarations counted, and the calls at its top level whose
 * result is assigned, such as `const tool = defineTool(…)`. A bundler keeps
 * such a call, and all the code it refers to, unless it's marked
 * `/* @__PURE__ *\/` or the bundler can prove it has no effect.
 *
 * It reads the bundle's text, so it's a guide to where to look, not proof.
 *
 * @param {string} entry The built entry.
 * @param {string} imports The import clause.
 * @returns {Promise<KeptCode>}
 * @throws {UsageError} As {@link importCost} does.
 */
export function keptCode(entry: string, imports: string): Promise<KeptCode>;
/**
 * What a scenario leaves out of its bundle, because it's counted elsewhere
 * (ADR 0056): the host's own `react` and `react-dom`, and the family's
 * packages, which have budgets of their own and are installed once. The
 * patterns are esbuild's `external` ones. Everything else an import brings
 * is counted, including a third-party runtime dependency.
 */
export const HOST_PACKAGES: readonly string[];
export type ImportCost = {
    /**
     * The import clause that was measured.
     */
    imports: string;
    /**
     * What an application ships for it, in bytes:
     * bundled, minified and compressed with brotli.
     */
    size: number;
};
export type KeptCode = {
    /**
     * Function declarations left in the bundle.
     */
    functions: number;
    /**
     * Calls at the top
     * level whose result is assigned, by what's called, most frequent first.
     * Unless a call is marked `/* @__PURE__ *\/`, a bundler keeps it, and
     * everything it refers to, whether or not the import uses it.
     */
    calls: Array<{
        call: string;
        count: number;
    }>;
};
/**
 * The configuration `@size-limit/esbuild` builds a check's bundle with.
 */
export type EsbuildConfig = import("esbuild").BuildOptions;
