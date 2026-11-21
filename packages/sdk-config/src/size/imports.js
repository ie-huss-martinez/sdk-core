// What an application ships when it imports part of an entry (sdk-core ADR
// 0056): budgets for `.size-limit.js`, and the measurement behind them, for
// finding what an import costs and what holds code in it.
//
// Tooling only: this entry is never imported by published runtime code.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { brotliSize, entryFiles, UsageError } from "./entry.js";

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
 * @param {{ name: string, entry: string, imports: string, limit: string, ignore?: readonly string[] }} options
 *   `imports` is the import clause, such as `"{ a, b }"`. `ignore` adds
 *   esbuild `external` patterns to leave out, for a package that puts its
 *   lazy chunks somewhere other than `lazy/` beside the entry.
 * @returns {{ name: string, path: string, import: string, ignore: string[], brotli: true, limit: string }}
 */
export function importBudget({ name, entry, imports, limit, ignore = [] }) {
  return {
    name,
    path: entry,
    import: imports,
    ignore: [...HOST_PACKAGES, ...lazyChunks(entry), ...ignore],
    brotli: true,
    limit,
  };
}

/**
 * The names a built entry exports, in the order it lists them. It follows
 * `export * from "./file.js"` into relative files, as far as they go, and
 * reads the files without running them. A star re-export of a package can't
 * be read this way, and is left out.
 *
 * @param {string} entry The built entry, such as `dist/index.js`.
 * @returns {string[]}
 * @throws {UsageError} If the entry, or a file it re-exports, isn't there.
 */
export function exportNames(entry) {
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Set<string>} */
  const seen = new Set();
  const read = (/** @type {string} */ path, /** @type {string | undefined} */ from) => {
    const file = resolve(path);
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    if (!existsSync(file)) {
      throw new UsageError(
        from === undefined
          ? `${path} doesn't exist. Build the package first.`
          : `${path}, which ${from} re-exports, doesn't exist. Build the package again.`,
      );
    }
    const code = readFileSync(file, "utf8");
    for (const [, list = ""] of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of list.split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .at(-1);
        if (name && name !== "default") {
          names.add(name);
        }
      }
    }
    for (const [, name = ""] of code.matchAll(
      /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      names.add(name);
    }
    for (const [, namespace, specifier = ""] of code.matchAll(
      /^export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*["']([^"']+)["']/gm,
    )) {
      if (namespace !== undefined) {
        names.add(namespace);
      } else if (specifier.startsWith(".")) {
        read(join(dirname(file), specifier), path);
      }
    }
  };
  read(entry, undefined);
  return [...names];
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
      treeShaking: true,
      write: false,
      logLevel: "silent",
      external: [...HOST_PACKAGES, ...lazyChunks(entry)],
      // The same in both bundles: esbuild would otherwise define "production"
      // when it minifies and "development" when it doesn't, and keptCode
      // would then look at code importCost never ships.
      define: { "process.env.NODE_ENV": '"production"' },
    });
    return result.outputFiles[0]?.text ?? "";
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
