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
