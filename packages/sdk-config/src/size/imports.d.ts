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
 * Removes, from a bundle esbuild wrote, the names it imports from a package
 * left out of the bundle and never uses.
 *
 * esbuild drops a name a file imports and doesn't use, but only as it reads
 * that file. A name whose every use was then tree-shaken away stays in the
 * import statement. So a scenario that uses one name of a shared chunk
 * carried the chunk's whole list of names from, say, `@hussmartinez/sdk-core`:
 * a floor grew when the chunk imported one more, with no code added to what
 * the import keeps (ADR 0056). An application never pays for that list: its
 * bundler resolves the package, and the names are gone.
 *
 * Which names are unused is esbuild's own answer: passed through it once
 * more, as one file, the bundle comes back without them. That copy is only
 * read for its imports' names. The bundle that's measured is the one esbuild
 * built, with those names cut out of its import statements, wherever in the
 * bundle they are, and a statement left with none removed.
 *
 * - **Nothing else is touched.** A statement that loses no name stays as it
 *   was written, byte for byte, and so does everything between statements.
 *   So the result is never longer than the bundle. Compressed, it's usually
 *   smaller too, but not always: a name that's cut may have been helping
 *   compress the text after it, by a few bytes.
 * - **The result is checked before it's used.** Passed through esbuild the
 *   same way, it must come back as the bundle did, imports for side effects
 *   aside. If it doesn't, something that only looked like an import
 *   statement was changed, inside a string for instance, and the bundle is
 *   returned as it was.
 * - **The copy is read as JavaScript,** which the bundle is. Read as
 *   TypeScript, `a<b>(c)` is a call with a type argument rather than two
 *   comparisons, and a name used only as that `b` would be cut: a floor
 *   that measures too small hides the leaks it exists to catch.
 *
 * If the bundle can't be read, it's returned as it is.
 *
 * @param {Pick<typeof import("esbuild"), "transform">} esbuild
 * @param {string} code The bundle, as an ES module.
 * @returns {Promise<string>}
 */
export function withoutUnusedImports(esbuild: Pick<typeof import("esbuild"), "transform">, code: string): Promise<string>;
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
export type ImportStatement = {
    /**
     * Where the statement starts, after what it follows.
     */
    start: number;
    /**
     * Where it ends, after its semicolon.
     */
    end: number;
    /**
     * The blank space before it on its line.
     */
    indent: string;
    /**
     * Its default import's local name.
     */
    defaultName: string | undefined;
    /**
     * Its namespace import's local name.
     */
    namespaceName: string | undefined;
    /**
     * Its named imports, as written: `a` or `a as b`.
     */
    named: string[] | undefined;
    /**
     * The module, quoted as written.
     */
    from: string;
    /**
     * The blank space and semicolon that end it.
     */
    tail: string;
    /**
     * The statement as written, without its indent.
     */
    text: string;
};
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
