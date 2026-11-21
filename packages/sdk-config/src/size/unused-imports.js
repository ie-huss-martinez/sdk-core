// Cuts the names a bundle imports and never uses, before the bundle is
// measured (sdk-core ADR 0056). Internal to the size tools: importBudget's
// check and hm-size use it, and it isn't part of the package's API.

/**
 * An import statement esbuild wrote: `import"x"`, `import a from"x"`,
 * `import*as a from"x"`, `import{a as b,c}from"x"`, or a default with either
 * of the last two. It starts the bundle or follows the end of a statement,
 * since esbuild writes a module's imports where that module's code starts,
 * not all at the top. `import("x")` isn't one.
 */
const IMPORT_STATEMENT =
  /(?<=^|[;}\n])([ \t]*)import\s*(?:([\w$]+)\s*,?\s*)?(?:\*\s*as\s+([\w$]+)\s*|\{([^}]*)\}\s*)?(?:from\s*)?("[^"\n]*"|'[^'\n]*')([ \t]*;?)/g;

/** A statement that imports a module for its side effects only, on a line of the copy esbuild printed. */
const BARE_IMPORT_LINE = /^import\s*(?:"[^"\n]*"|'[^'\n]*');?\n?/gm;

/** The local name of a named import: `b` in `a as b`, and `a` in `a`. */
const localName = (/** @type {string} */ named) => named.split(/\s+as\s+/).pop() ?? named;

/**
 * @typedef {object} ImportStatement
 * @property {number} start Where the statement starts, after what it follows.
 * @property {number} end Where it ends, after its semicolon.
 * @property {string} indent The blank space before it on its line.
 * @property {string | undefined} defaultName Its default import's local name.
 * @property {string | undefined} namespaceName Its namespace import's local name.
 * @property {string[] | undefined} named Its named imports, as written: `a` or `a as b`.
 * @property {string} from The module, quoted as written.
 * @property {string} tail The blank space and semicolon that end it.
 * @property {string} text The statement as written, without its indent.
 */

/**
 * Finds the import statements in code esbuild wrote.
 *
 * @param {string} code
 * @returns {ImportStatement[]}
 */
function importStatements(code) {
  /** @type {ImportStatement[]} */
  const statements = [];
  for (const match of code.matchAll(IMPORT_STATEMENT)) {
    const [whole, indent = "", defaultName, namespaceName, named, from = "", tail = ""] = match;
    const start = match.index;
    statements.push({
      start,
      end: start + whole.length,
      indent,
      defaultName,
      namespaceName,
      named:
        named === undefined
          ? undefined
          : named
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean),
      from,
      tail,
      text: whole.slice(indent.length),
    });
  }
  return statements;
}

/**
 * The names a statement imports, as the code around it knows them.
 *
 * @param {ImportStatement} statement
 * @returns {string[]}
 */
const localsOf = ({ defaultName, namespaceName, named }) => [
  ...(defaultName ? [defaultName] : []),
  ...(namespaceName ? [namespaceName] : []),
  ...(named ?? []).map(localName),
];

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
export async function withoutUnusedImports(esbuild, code) {
  const statements = importStatements(code).filter((statement) => localsOf(statement).length > 0);
  if (statements.length === 0) {
    return code;
  }
  // Syntax only: that's what drops an unused import. Local names stay as
  // they are, so they can be matched.
  const elide = async (/** @type {string} */ text) =>
    (await esbuild.transform(text, { loader: "js", format: "esm", minifySyntax: true })).code;
  /** @type {string} */
  let reference;
  try {
    reference = await elide(code);
  } catch {
    return code;
  }
  const used = new Set(importStatements(reference).flatMap(localsOf));

  let result = "";
  let from = 0;
  for (const statement of statements) {
    const names = (statement.named ?? []).filter((name) => used.has(localName(name)));
    const keepsDefault = statement.defaultName !== undefined && used.has(statement.defaultName);
    const keepsNamespace =
      statement.namespaceName !== undefined && used.has(statement.namespaceName);
    if (
      names.length === (statement.named ?? []).length &&
      keepsDefault === (statement.defaultName !== undefined) &&
      keepsNamespace === (statement.namespaceName !== undefined)
    ) {
      // Nothing to cut: the statement stays exactly as it was written.
      continue;
    }
    result += code.slice(from, statement.start);
    from = statement.end;
    // As the statement was written: with spaces, or without.
    const tight = !/\bfrom\s/.test(statement.text) && !/^import\s+[{*]/.test(statement.text);
    const clauses = [
      ...(keepsDefault ? [/** @type {string} */ (statement.defaultName)] : []),
      ...(keepsNamespace
        ? [tight ? `*as ${statement.namespaceName}` : `* as ${statement.namespaceName}`]
        : []),
      ...(names.length > 0 ? [tight ? `{${names.join(",")}}` : `{ ${names.join(", ")} }`] : []),
    ];
    if (clauses.length === 0) {
      // Nothing it imports is used: the statement goes, with its line.
      if (code[from] === "\n" && statement.indent === "" && !tight) {
        from += 1;
      }
      continue;
    }
    const clause = clauses.join(tight ? "," : ", ");
    const before = tight && /^[{*]/.test(clause) ? "" : " ";
    const after = tight && clause.endsWith("}") ? "" : " ";
    result += `${statement.indent}import${before}${clause}${after}from${tight ? "" : " "}${statement.from}${statement.tail}`;
  }
  if (from === 0) {
    return code;
  }
  result += code.slice(from);

  // What was cut must have been import statements and nothing else: read
  // the same way, the result is the bundle, imports for side effects aside.
  const comparable = (/** @type {string} */ text) => text.replace(BARE_IMPORT_LINE, "");
  try {
    if (result.length > code.length || comparable(await elide(result)) !== comparable(reference)) {
      return code;
    }
  } catch {
    return code;
  }
  return result;
}
