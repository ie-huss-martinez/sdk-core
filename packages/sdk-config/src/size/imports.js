// What an application ships when it imports part of an entry (sdk-core ADR
// 0056): budgets for `.size-limit.js`, and the measurement behind them, for
// finding what an import costs and what holds code in it.
//
// Tooling only: this entry is never imported by published runtime code.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { brotliSize, entryFiles, UsageError } from "./entry.js";

/**
 * The configuration `@size-limit/esbuild` builds a check's bundle with.
 *
 * @typedef {import("esbuild").BuildOptions} EsbuildConfig
 */

/** What `process.env.NODE_ENV` is replaced with in every bundle measured here: applications ship production code. */
const PRODUCTION = '"production"';

/**
 * What a scenario leaves out of its bundle, because it's counted elsewhere
 * (ADR 0056): the host's own `react` and `react-dom`, and the family's
 * packages, which have budgets of their own and are installed once. The
 * patterns are esbuild's `external` ones. Everything else an import brings
 * is counted, including a third-party runtime dependency.
 */
export const HOST_PACKAGES = Object.freeze([
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "@hussmartinez/*",
]);

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
export function lazyChunks(entry) {
  return [`${join(dirname(resolve(entry)), "lazy").replaceAll("\\", "/")}/*`];
}

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
export function entryBudget({ name, entry, limit }) {
  return {
    name,
    path: entryFiles(entry),
    brotli: true,
    limit,
    disablePlugins: ["@size-limit/esbuild"],
  };
}

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
export function importBudget({ name, entry, imports, limit, ignore = [], modifyEsbuildConfig }) {
  return {
    name,
    path: entry,
    import: imports,
    ignore: [...HOST_PACKAGES, ...lazyChunks(entry), ...ignore],
    brotli: true,
    limit,
    modifyEsbuildConfig(config) {
      /** @type {EsbuildConfig} */
      const ours = {
        ...config,
        format: "esm",
        // An application's bundler never reads the package's tsconfig.json.
        // esbuild would find it from the built entry, and follow its paths
        // back into source.
        tsconfigRaw: "{}",
        define: { ...config.define, "process.env.NODE_ENV": PRODUCTION },
        plugins: [...(config.plugins ?? []), UNUSED_IMPORTS_PLUGIN],
      };
      return modifyEsbuildConfig ? modifyEsbuildConfig(ours) : ours;
    },
  };
}

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

/**
 * An esbuild plugin for `@size-limit/esbuild`'s build: once the bundle is
 * written, it rewrites each JavaScript file without the names it imports
 * and never uses ({@link withoutUnusedImports}), so the check measures them
 * as {@link importCost} does.
 *
 * @type {import("esbuild").Plugin}
 */
const UNUSED_IMPORTS_PLUGIN = {
  name: "hm-unused-imports",
  setup(build) {
    build.onEnd(async (result) => {
      const root = build.initialOptions.absWorkingDir ?? process.cwd();
      for (const output of Object.keys(result.metafile?.outputs ?? {})) {
        const file = resolve(root, output);
        if (!file.endsWith(".js") || !existsSync(file)) {
          continue;
        }
        const code = readFileSync(file, "utf8");
        const trimmed = await withoutUnusedImports(build.esbuild, code);
        if (trimmed !== code) {
          writeFileSync(file, trimmed);
        }
      }
    });
  },
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
export function exportNames(entry) {
  /** In place of a declaring file, for a name that arrives ambiguously: it stays ambiguous for whoever re-exports it. */
  const AMBIGUOUS = "";
  /** Each file's names, with the file that declares each one. A file being read maps to nothing yet. */
  /** @type {Map<string, Map<string, string> | undefined>} */
  const modules = new Map();
  const read = (
    /** @type {string} */ path,
    /** @type {string | undefined} */ from,
  ) => /** @type {Map<string, string>} */ {
    const file = resolve(path);
    if (modules.has(file)) {
      // Already read, or being read: a cycle adds nothing new.
      return modules.get(file) ?? new Map();
    }
    modules.set(file, undefined);
    if (!existsSync(file)) {
      throw new UsageError(
        from === undefined
          ? `${path} doesn't exist. Build the package first.`
          : `${path}, which ${from} re-exports, doesn't exist. Build the package again.`,
      );
    }
    const code = readFileSync(file, "utf8");
    /** @type {Map<string, string>} */
    const own = new Map();
    for (const [, list = ""] of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of list.split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .at(-1);
        if (name && name !== "default") {
          own.set(name, file);
        }
      }
    }
    for (const [, name = ""] of code.matchAll(
      /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      own.set(name, file);
    }
    /** @type {Map<string, string>} */
    const starred = new Map();
    for (const [, namespace, specifier = ""] of code.matchAll(
      /^export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*["']([^"']+)["']/gm,
    )) {
      if (namespace !== undefined) {
        if (namespace !== "default") {
          own.set(namespace, file);
        }
      } else if (specifier.startsWith(".")) {
        for (const [name, origin] of read(join(dirname(file), specifier), path)) {
          const earlier = starred.get(name);
          starred.set(name, earlier === undefined || earlier === origin ? origin : AMBIGUOUS);
        }
      }
    }
    /** @type {Map<string, string>} */
    const names = new Map(own);
    for (const [name, origin] of starred) {
      if (!own.has(name)) {
        names.set(name, origin);
      }
    }
    modules.set(file, names);
    return names;
  };
  return [...read(entry, undefined)]
    .filter(([, origin]) => origin !== AMBIGUOUS)
    .map(([name]) => name);
}

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
export function importedNames(imports) {
  /** @type {string[]} */
  const names = [];
  const braces = /\{([^}]*)\}/.exec(imports);
  const outside = imports.replace(/\{[^}]*\}/, "");
  for (const part of outside.split(",")) {
    const name = part.trim().replace(/^\*\s*as\s+/, "");
    if (name !== "") {
      names.push(name);
    }
  }
  for (const part of (braces?.[1] ?? "").split(",")) {
    const name = part
      .trim()
      .split(/\s+as\s+/)
      .at(-1);
    if (name) {
      names.push(name);
    }
  }
  if (names.length === 0 || names.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) {
    throw new UsageError(
      `"${imports}" isn't an import clause, such as "{ a, b as c }", "Thing" or "* as all".`,
    );
  }
  return names;
}

/**
 * Bundles one import from a built entry as an application's bundler would,
 * with esbuild, leaving out {@link HOST_PACKAGES} and the entry's own lazy
 * chunks ({@link lazyChunks}), as {@link importBudget}'s check does.
 *
 * @param {string} entry
 * @param {string} imports
 * @param {boolean} minify
 * @returns {Promise<string>} The bundle.
 */
async function bundle(entry, imports, minify) {
  /** @type {typeof import("esbuild")} */
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new UsageError("esbuild isn't installed; it bundles the import.");
  }
  const file = resolve(entry);
  if (!existsSync(file)) {
    throw new UsageError(`${entry} doesn't exist. Build the package first.`);
  }
  const used = importedNames(imports).join(", ");
  try {
    const result = await esbuild.build({
      stdin: {
        contents: `import ${imports} from ${JSON.stringify(file)};\nconsole.log(${used});\n`,
        resolveDir: dirname(file),
        loader: "js",
      },
      bundle: true,
      minify,
      format: "esm",
      // As importBudget's check: without the package's own tsconfig.json.
      tsconfigRaw: "{}",
      treeShaking: true,
      write: false,
      logLevel: "silent",
      external: [...HOST_PACKAGES, ...lazyChunks(entry)],
      // The same in both bundles: esbuild would otherwise define "production"
      // when it minifies and "development" when it doesn't, and keptCode
      // would then look at code importCost never ships.
      define: { "process.env.NODE_ENV": PRODUCTION },
    });
    return await withoutUnusedImports(esbuild, result.outputFiles[0]?.text ?? "");
  } catch (error) {
    throw new UsageError(
      `${entry} couldn't be bundled for import ${imports}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }
}

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
export async function importCost(entry, imports) {
  return { imports, size: brotliSize(await bundle(entry, imports, true)) };
}

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
export async function exportCosts(entry) {
  /** @type {Array<{ name: string, size: number }>} */
  const costs = [];
  for (const name of exportNames(entry)) {
    costs.push({ name, size: (await importCost(entry, `{ ${name} }`)).size });
  }
  return costs.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
}

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
export async function keptCode(entry, imports) {
  const lines = (await bundle(entry, imports, false)).split("\n");
  /** @type {Map<string, number>} */
  const calls = new Map();
  let functions = 0;
  for (const line of lines) {
    if (/^(?:async\s+)?function\b/.test(line)) {
      functions += 1;
      continue;
    }
    const call =
      /^(?:var|let|const)\s+[\w$]+\s*=\s*(?:\/\*\s*@__PURE__\s*\*\/\s*)?(?:new\s+)?([\w$]+(?:\.[\w$]+)*)\(/.exec(
        line,
      )?.[1];
    if (call !== undefined) {
      calls.set(call, (calls.get(call) ?? 0) + 1);
    }
  }
  return {
    functions,
    calls: [...calls]
      .map(([call, count]) => ({ call, count }))
      .sort((a, b) => b.count - a.count || a.call.localeCompare(b.call)),
  };
}
