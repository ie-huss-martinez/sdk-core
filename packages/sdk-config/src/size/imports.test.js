import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  entryBudget,
  exportCosts,
  exportNames,
  HOST_PACKAGES,
  importBudget,
  importCost,
  importedNames,
  keptCode,
  lazyChunks,
  UsageError,
} from "./index.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

/** @type {string[]} */
const roots = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A built package: its files, by path.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<string>} Its folder.
 */
async function built(files) {
  const root = await mkdtemp(join(tmpdir(), "hm-size-imports-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** A filler a minifier can't shrink much: distinct strings. */
const heavy = (/** @type {string} */ label, /** @type {number} */ lines) =>
  Array.from({ length: lines }, (_, index) => `  "${label} message number ${index * 7919}",`).join(
    "\n",
  );

/** An entry whose exports come apart: each is a function, or a constant. */
const APART = {
  "package.json": '{ "name": "apart", "type": "module", "sideEffects": false }',
  "dist/index.js": [
    'import { helper } from "./shared/helper.js";',
    'import { useState } from "react";',
    'import { SdkError } from "@hussmartinez/sdk-core";',
    "const SMALL = 1;",
    `const TABLE = [\n${heavy("table", 120)}\n];`,
    "function small() { return SMALL + helper(); }",
    'function large() { return TABLE.join(""); }',
    'function hook() { return useState(new SdkError("X", "x")); }',
    'const load = () => import("./lazy/worker.js");',
    "export { small, large, hook, load, SMALL as VALUE };",
  ].join("\n"),
  "dist/shared/helper.js": "export function helper() { return 2; }\n",
  "dist/lazy/worker.js": `export const worker = [\n${heavy("worker", 400)}\n];\n`,
};

/** The same, but a top-level call keeps the large table alive for every import. */
const LEAKY = {
  ...APART,
  "package.json": '{ "name": "leaky", "type": "module", "sideEffects": false }',
  "dist/index.js": APART["dist/index.js"].replace(
    "const load =",
    "const registry = defineTool({ run: large });\nfunction defineTool(tool) { globalThis.tools = [tool]; return tool; }\nconst context = createContext(registry);\nfunction createContext(value) { return { value }; }\nconst load =",
  ),
};

describe("entryBudget and importBudget", () => {
  it("makes a ceiling on the built files, with size-limit's esbuild plugin off", async () => {
    const root = await built(APART);
    const entry = join(root, "dist/index.js");

    expect(entryBudget({ name: "Core (.)", entry, limit: "17 kB" })).toEqual({
      name: "Core (.)",
      path: [entry, join(root, "dist/shared/helper.js")],
      brotli: true,
      limit: "17 kB",
      disablePlugins: ["@size-limit/esbuild"],
    });
    expect(() =>
      entryBudget({ name: "x", entry: join(root, "dist/no.js"), limit: "1 kB" }),
    ).toThrow(UsageError);
  });

  it("makes an import scenario that leaves out the host's packages, the family's and lazy chunks", () => {
    expect(
      importBudget({
        name: "Import: the floor",
        entry: "dist/index.js",
        imports: "{ PdfError }",
        limit: "0.9 kB",
      }),
    ).toEqual({
      name: "Import: the floor",
      path: "dist/index.js",
      import: "{ PdfError }",
      ignore: [
        "react",
        "react/*",
        "react-dom",
        "react-dom/*",
        "@hussmartinez/*",
        `${join(process.cwd(), "dist", "lazy")}/*`,
      ],
      brotli: true,
      limit: "0.9 kB",
      modifyEsbuildConfig: expect.any(Function),
    });
  });

  describe("the bundle of an import scenario", () => {
    /** A module with a branch for development only, as a library's warning is. */
    const WARNS = {
      "dist/index.js": [
        "export function small() {",
        '  if (process.env.NODE_ENV !== "production") {',
        '    console.warn("DEVELOPMENT-ONLY: small() was called");',
        "  }",
        "  return 1;",
        "}",
      ].join("\n"),
    };

    /**
     * What `@size-limit/esbuild` starts from (its `get-config.js`, 14.3.0),
     * for one import, kept in memory.
     *
     * @param {string} entry
     * @returns {import("esbuild").BuildOptions}
     */
    function pluginConfig(entry) {
      return {
        bundle: true,
        stdin: {
          contents: `import { small } from ${JSON.stringify(entry)};\nconsole.log(small);\n`,
          resolveDir: dirname(entry),
        },
        metafile: true,
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true,
        treeShaking: true,
        write: false,
        logLevel: "silent",
      };
    }

    /**
     * @param {import("esbuild").BuildOptions} config
     * @returns {Promise<string>} The bundle.
     */
    async function bundled(config) {
      const { build } = await import("esbuild");
      const result = await build({ ...config, write: false });
      return result.outputFiles?.[0]?.text.trim() ?? "";
    }

    it("is an ES module without development-only code, where the plugin alone wraps it as a script", async () => {
      const entry = join(await built(WARNS), "dist/index.js");
      const check = importBudget({ name: "x", entry, imports: "{ small }", limit: "1 kB" });

      const config = check.modifyEsbuildConfig(pluginConfig(entry));
      const bundle = await bundled(config);

      expect(config.format).toBe("esm");
      expect(config.define).toEqual({ "process.env.NODE_ENV": '"production"' });
      expect(bundle).not.toContain("DEVELOPMENT-ONLY");
      expect(bundle).not.toContain("process.env");
      expect(bundle).not.toMatch(/^\(\(\)=>\{/);
      // The plugin alone: the same code, inside a function a page would run.
      expect(await bundled(pluginConfig(entry))).toMatch(/^\(\(\)=>\{.*\}\)\(\);$/s);
    });

    it("drops development-only code even when the bundle isn't fully minified", async () => {
      const entry = join(await built(WARNS), "dist/index.js");
      const check = importBudget({
        name: "x",
        entry,
        imports: "{ small }",
        limit: "1 kB",
        modifyEsbuildConfig: (config) => ({ ...config, minifyIdentifiers: false }),
      });

      // esbuild itself defines "development" here; the budget's own define decides.
      const plugin = { ...pluginConfig(entry), minifyIdentifiers: false };
      expect(await bundled(plugin)).toContain("DEVELOPMENT-ONLY");
      expect(await bundled(check.modifyEsbuildConfig(pluginConfig(entry)))).not.toContain(
        "DEVELOPMENT-ONLY",
      );
    });

    it("keeps the plugin's settings and other defines, and lets a package's own change come last", () => {
      const check = importBudget({
        name: "x",
        entry: "dist/index.js",
        imports: "{ a }",
        limit: "1 kB",
        modifyEsbuildConfig: (config) => ({
          ...config,
          format: "iife",
          define: { ...config.define, __DEV__: "false" },
        }),
      });
      const plain = importBudget({
        name: "x",
        entry: "dist/index.js",
        imports: "{ a }",
        limit: "1 kB",
      });
      const theirs = { name: "theirs", setup() {} };
      const given = {
        bundle: true,
        external: ["react"],
        define: { VERSION: '"1"' },
        plugins: [theirs],
      };
      const unusedImports = expect.objectContaining({ name: "hm-unused-imports" });

      expect(plain.modifyEsbuildConfig(given)).toEqual({
        bundle: true,
        external: ["react"],
        format: "esm",
        define: { VERSION: '"1"', "process.env.NODE_ENV": '"production"' },
        // A plugin already there stays, ahead of ours.
        plugins: [theirs, unusedImports],
      });
      expect(given).toEqual({
        bundle: true,
        external: ["react"],
        define: { VERSION: '"1"' },
        plugins: [theirs],
      });
      expect(check.modifyEsbuildConfig(given)).toEqual({
        bundle: true,
        external: ["react"],
        format: "iife",
        define: { VERSION: '"1"', "process.env.NODE_ENV": '"production"', __DEV__: "false" },
        plugins: [theirs, unusedImports],
      });
      expect(plain.modifyEsbuildConfig({ bundle: true }).plugins).toEqual([unusedImports]);
    });

    describe("with names a shared chunk imports from a package left out of the bundle", () => {
      /**
       * A package whose shared chunk imports `names` from sdk-core and uses
       * each in a function of its own. A scenario that imports only the
       * error class keeps none of those functions.
       *
       * @param {string[]} names What the chunk imports beside `SdkError`.
       */
      const sharing = (names) => ({
        "dist/index.js": 'export { ImageError, helpers } from "./shared/chunk.js";\n',
        "dist/shared/chunk.js": [
          `import { ${["SdkError", ...names].join(", ")} } from "@hussmartinez/sdk-core";`,
          'import { useState } from "react";',
          "export class ImageError extends SdkError {}",
          `export const helpers = () => [useState, ${names.join(", ")}];`,
        ].join("\n"),
      });

      /**
       * Runs a check's build as `@size-limit/esbuild` does: from its own
       * starting configuration, written to a folder.
       *
       * @param {string} root The package.
       * @param {string} [imports] The import clause.
       * @returns {Promise<string>} The bundle, as written.
       */
      async function written(root, imports = "{ ImageError }") {
        const { build } = await import("esbuild");
        const entry = join(root, "dist/index.js");
        const check = importBudget({
          name: "x",
          entry,
          imports,
          limit: "1 kB",
        });
        const outdir = join(root, "out");
        await build(
          check.modifyEsbuildConfig({
            allowOverwrite: true,
            bundle: true,
            stdin: {
              contents: `import ${imports} from ${JSON.stringify(entry)};\nconsole.log(${importedNames(imports).join(", ")});\n`,
              resolveDir: dirname(entry),
            },
            external: check.ignore,
            metafile: true,
            minifyIdentifiers: true,
            minifySyntax: true,
            minifyWhitespace: true,
            outdir,
            treeShaking: true,
            write: true,
            logLevel: "silent",
          }),
        );
        return (await readFile(join(outdir, "stdin.js"), "utf8")).trim();
      }

      it("leaves out the names the scenario never uses, in the check's written bundle", async () => {
        const bundle = await written(
          await built(sharing(["cleanFileName", "MAX_FILE_NAME_LENGTH"])),
        );

        expect(bundle).toMatch(/^import\{SdkError as \w+\}from"@hussmartinez\/sdk-core";/);
        expect(bundle).not.toContain("cleanFileName");
        expect(bundle).not.toContain("MAX_FILE_NAME_LENGTH");
        // An import left with no name it uses goes altogether.
        expect(bundle).not.toContain("react");
      });

      it("measures the same whatever else the chunk imports from that package", async () => {
        const one = await built(sharing([]));
        const three = await built(sharing(["cleanFileName", "MAX_FILE_NAME_LENGTH"]));
        const nine = await built(
          sharing(["a", "b", "c", "d", "e", "f", "createWorkerClient", "exposeWorker"]),
        );

        const cost = async (/** @type {string} */ root) =>
          (await importCost(join(root, "dist/index.js"), "{ ImageError }")).size;
        expect(await cost(three)).toBe(await cost(one));
        expect(await cost(nine)).toBe(await cost(one));
        // The written bundles are the same length. Their bytes can differ in
        // which letters esbuild gave the names that are left, which it chose
        // while the dropped names were still there.
        const length = (await written(one)).length;
        expect((await written(three)).length).toBe(length);
        expect((await written(nine)).length).toBe(length);
        expect(await written(nine)).toMatch(
          /^import\{SdkError as (\w+)\}from"@hussmartinez\/sdk-core";var \w+=class extends \1\{\};console\.log\(\w+\);$/,
        );
      });

      it("keeps a name used only between two comparisons, which TypeScript would read as a type", async () => {
        // `limit<maximum>(strict||1)` is two comparisons in JavaScript, and
        // esbuild prints it with those brackets. Read as
        // TypeScript it's a call of `limit` with a type argument, and
        // `maximum` would look unused.
        const root = await built({
          "dist/index.js": [
            'import { limit, maximum, strict, unused } from "@hussmartinez/sdk-core";',
            "export const within = () => limit<maximum>(strict || 1);",
            "export const other = () => unused;",
          ].join("\n"),
        });
        const entry = join(root, "dist/index.js");

        const bundle = await written(root, "{ within }");

        expect(bundle).toMatch(/^import\{limit as (\w+),maximum as (\w+),strict as (\w+)\}from/);
        expect(bundle).not.toContain("unused");
        // The same three names, by the other measure.
        const three = await importCost(entry, "{ within }");
        const all = await importCost(entry, "{ within, other }");
        expect(all.size).toBeGreaterThan(three.size);
      });

      it("still counts a name the scenario does use", async () => {
        const root = await built(sharing(["cleanFileName"]));
        const entry = join(root, "dist/index.js");

        const floor = await importCost(entry, "{ ImageError }");
        const all = await importCost(entry, "{ ImageError, helpers }");

        expect(all.size).toBeGreaterThan(floor.size);
        expect(await written(root, "{ helpers }")).toMatch(
          /import\{cleanFileName as \w+\}from"@hussmartinez\/sdk-core";/,
        );
      });
    });
  });

  it("adds a package's own patterns to leave out, after the family's", () => {
    const { ignore } = importBudget({
      name: "x",
      entry: "dist/index.js",
      imports: "{ a }",
      limit: "1 kB",
      ignore: ["./workers/*"],
    });

    expect(ignore).toEqual([...HOST_PACKAGES, ...lazyChunks("dist/index.js"), "./workers/*"]);
    expect(Object.isFrozen(HOST_PACKAGES)).toBe(true);
    expect(lazyChunks("/work/pkg/dist/react.js")).toEqual(["/work/pkg/dist/lazy/*"]);
  });
});

describe("exportNames", () => {
  it("reads export lists, renamed exports and exported declarations, without default", async () => {
    const root = await built({
      "dist/index.js": [
        "const a = 1, b = 2, c = 3;",
        "export { a, b as renamed, c as default };",
        "export const declared = 4;",
        "export function fn() {}",
        "export async function later() {}",
        "export class Thing {}",
        'export { a as again } from "./other.js";',
      ].join("\n"),
    });

    expect(exportNames(join(root, "dist/index.js"))).toEqual([
      "a",
      "renamed",
      "again",
      "declared",
      "fn",
      "later",
      "Thing",
    ]);
    expect(() => exportNames(join(root, "dist/missing.js"))).toThrow(/Build the package first/);
  });

  it("follows star re-exports into relative files, through a cycle, and names a namespace", async () => {
    const root = await built({
      "dist/index.js": [
        'export * from "./shared/a.js";',
        'export * as tools from "./shared/tools.js";',
        'export * from "some-package";',
        "export const own = 1;",
      ].join("\n"),
      "dist/shared/a.js": 'export * from "./b.js";\nexport const fromA = 1;\nexport default 0;\n',
      "dist/shared/b.js": 'export * from "./a.js";\nexport function fromB() {}\n',
      "dist/shared/tools.js": "export const hidden = 1;\n",
    });

    expect(exportNames(join(root, "dist/index.js")).sort()).toEqual([
      "fromA",
      "fromB",
      "own",
      "tools",
    ]);
  });

  it("lists what can be imported: own names win, ambiguous ones are left out, default never passes", async () => {
    const root = await built({
      "dist/index.js": [
        'export * from "./a.js";',
        'export * from "./b.js";',
        'export * from "./also-a.js";',
        'export * as default from "./tools.js";',
        'export * as tools from "./tools.js";',
        'export const overridden = "the own one";',
      ].join("\n"),
      // Each declares its own `clash`: importing it from the entry is an error.
      "dist/a.js":
        "export const clash = 1;\nexport const onlyA = 1;\nexport const overridden = 1;\nexport default 0;\n",
      "dist/b.js": "export const clash = 2;\nexport const onlyB = 2;\n",
      // The same declaration by two paths isn't ambiguous.
      "dist/also-a.js": 'export * from "./a.js";\n',
      "dist/tools.js": "export const hidden = 1;\n",
    });
    const entry = join(root, "dist/index.js");

    expect(exportNames(entry).sort()).toEqual(["onlyA", "onlyB", "overridden", "tools"]);
    // And every listed name really can be imported and measured.
    expect((await exportCosts(entry)).map(({ name }) => name).sort()).toEqual([
      "onlyA",
      "onlyB",
      "overridden",
      "tools",
    ]);
  });

  it("keeps a name ambiguous through a barrel, unless a module on the way declares it", async () => {
    const files = {
      "dist/a.js": "export const clash = 1;\nexport const onlyA = 1;\n",
      "dist/b.js": "export const clash = 2;\n",
      // Ambiguous here already.
      "dist/barrel.js": 'export * from "./a.js";\nexport * from "./b.js";\n',
    };
    const through = await built({
      ...files,
      // The barrel's ambiguous `clash` and a.js's: still ambiguous.
      "dist/index.js": 'export * from "./barrel.js";\nexport * from "./a.js";\n',
    });
    const settled = await built({
      ...files,
      "dist/settling.js": 'export * from "./barrel.js";\nexport const clash = 3;\n',
      // A module on the way declares its own `clash`, which wins there.
      "dist/index.js": 'export * from "./settling.js";\n',
    });

    expect(exportNames(join(through, "dist/index.js"))).toEqual(["onlyA"]);
    expect((await exportCosts(join(through, "dist/index.js"))).map(({ name }) => name)).toEqual([
      "onlyA",
    ]);
    expect(exportNames(join(settled, "dist/index.js")).sort()).toEqual(["clash", "onlyA"]);
    expect(
      (await exportCosts(join(settled, "dist/index.js"))).map(({ name }) => name).sort(),
    ).toEqual(["clash", "onlyA"]);
  });

  it("says which file is missing when a re-exported file is gone", async () => {
    const root = await built({ "dist/index.js": 'export * from "./gone.js";\n' });

    expect(() => exportNames(join(root, "dist/index.js"))).toThrow(
      /gone\.js, which .*index\.js re-exports, doesn't exist/,
    );
  });
});

describe("importedNames", () => {
  it.each([
    ["{ a }", ["a"]],
    ["{ a, b }", ["a", "b"]],
    ["{ small as renamed }", ["renamed"]],
    ["{ a, b as c, d }", ["a", "c", "d"]],
    ["Thing", ["Thing"]],
    ["* as all", ["all"]],
    ["Thing, { a as b }", ["Thing", "b"]],
    ["Thing, * as all", ["Thing", "all"]],
  ])("reads the local names of %j", (clause, names) => {
    expect(importedNames(clause)).toEqual(names);
  });

  it.each(["", "{}", "{ a-b }", "a b"])("refuses %j", (clause) => {
    expect(() => importedNames(clause)).toThrow(UsageError);
  });
});

describe("importCost", () => {
  it("measures only what the import uses, when the entry comes apart", async () => {
    const root = await built(APART);
    const entry = join(root, "dist/index.js");

    const small = await importCost(entry, "{ small }");
    const large = await importCost(entry, "{ large }");
    const both = await importCost(entry, "{ small, large }");

    expect(small.imports).toBe("{ small }");
    expect(small.size).toBeLessThan(200);
    expect(large.size).toBeGreaterThan(small.size * 3);
    expect(both.size).toBeGreaterThanOrEqual(large.size);
  });

  it("leaves out react, the family's packages and lazy chunks", async () => {
    const root = await built(APART);
    const entry = join(root, "dist/index.js");

    // Neither package is installed here: bundling fails unless they're left out.
    expect((await importCost(entry, "{ hook }")).size).toBeLessThan(300);
    // The lazy chunk holds 400 lines that would dwarf everything else.
    expect((await importCost(entry, "{ load }")).size).toBeLessThan(200);
  });

  it("measures an import written with an alias, a default or a namespace", async () => {
    const root = await built({
      ...APART,
      "dist/index.js": `${APART["dist/index.js"]}\nexport default small;`,
    });
    const entry = join(root, "dist/index.js");
    const plain = (await importCost(entry, "{ small }")).size;

    // The same code; only the local name in the two-line module differs.
    expect(Math.abs((await importCost(entry, "{ small as renamed }")).size - plain)).toBeLessThan(
      8,
    );
    expect((await importCost(entry, "Small")).size).toBeGreaterThan(0);
    expect((await importCost(entry, "* as all")).size).toBeGreaterThan(plain);
    expect((await keptCode(entry, "{ small as renamed }")).calls).toEqual([]);
  });

  it("leaves out only the entry's own lazy chunks, not a dependency's lazy folder", async () => {
    const root = await built({
      "package.json": '{ "name": "with-lazy-dependency", "type": "module", "sideEffects": false }',
      "dist/index.js":
        'import { table } from "third-party";\nexport function plan() { return table(); }\nexport function alone() { return 1; }\n',
      "node_modules/third-party/package.json":
        '{ "name": "third-party", "type": "module", "main": "index.js", "sideEffects": false }',
      "node_modules/third-party/index.js":
        'import { TABLE } from "./lazy/table.js";\nexport function table() { return TABLE.length; }\n',
      "node_modules/third-party/lazy/table.js": `export const TABLE = [\n${heavy("dependency", 150)}\n];\n`,
    });
    const entry = join(root, "dist/index.js");

    expect((await importCost(entry, "{ plan }")).size).toBeGreaterThan(
      (await importCost(entry, "{ alone }")).size * 5,
    );
  });

  it("measures the same environment in both bundles, so keptCode sees what ships", async () => {
    const root = await built({
      "package.json": '{ "name": "with-development-code", "type": "module", "sideEffects": false }',
      "dist/index.js": [
        "function warn() { return 'only in development'; }",
        "function devOnly() { return warn(); }",
        'export function value() { return process.env.NODE_ENV !== "production" ? devOnly() : 1; }',
      ].join("\n"),
    });
    const entry = join(root, "dist/index.js");

    // Only value() itself is left: the development branch is gone, as in what ships.
    expect((await keptCode(entry, "{ value }")).functions).toBe(1);
  });

  it("counts a third-party runtime dependency", async () => {
    const root = await built({
      "package.json": '{ "name": "with-dependency", "type": "module", "sideEffects": false }',
      "dist/index.js":
        'import { schedule } from "third-party";\nexport function plan() { return schedule(); }\nexport function alone() { return 1; }\n',
      "node_modules/third-party/package.json":
        '{ "name": "third-party", "type": "module", "main": "index.js", "sideEffects": false }',
      "node_modules/third-party/index.js": `const TABLE = [\n${heavy("dependency", 150)}\n];\nexport function schedule() { return TABLE.length; }\n`,
    });
    const entry = join(root, "dist/index.js");

    const withDependency = await importCost(entry, "{ plan }");
    const without = await importCost(entry, "{ alone }");

    // The dependency's table is ten times the size of everything else here.
    expect(withDependency.size).toBeGreaterThan(without.size * 5);
  });

  it("refuses an entry that isn't built, and a name the entry doesn't export", async () => {
    const root = await built(APART);

    await expect(importCost(join(root, "dist/missing.js"), "{ a }")).rejects.toThrow(
      /Build the package first/,
    );
    await expect(importCost(join(root, "dist/index.js"), "{ nothing }")).rejects.toThrow(
      UsageError,
    );
  });
});

describe("exportCosts and keptCode", () => {
  it("lists every export's cost, cheapest first, so the first is the floor", async () => {
    const root = await built(APART);
    const costs = await exportCosts(join(root, "dist/index.js"));

    expect(costs.map(({ name }) => name).sort()).toEqual([
      "VALUE",
      "hook",
      "large",
      "load",
      "small",
    ]);
    expect(costs.at(-1)?.name).toBe("large");
    expect(costs.map(({ size }) => size)).toEqual(
      [...costs.map(({ size }) => size)].sort((a, b) => a - b),
    );
    expect(costs[0]?.size).toBeLessThan(100);
  });

  it("shows a floor near the largest export when a top-level call holds code for every import", async () => {
    const apart = await exportCosts(join(await built(APART), "dist/index.js"));
    const leaky = await exportCosts(join(await built(LEAKY), "dist/index.js"));
    const floor = (/** @type {Array<{ size: number }>} */ costs) => costs[0]?.size ?? 0;
    const largest = (/** @type {Array<{ size: number }>} */ costs) => costs.at(-1)?.size ?? 0;

    expect(floor(apart)).toBeLessThan(largest(apart) / 3);
    expect(floor(leaky)).toBeGreaterThan(largest(leaky) * 0.8);
  });

  it("names the top-level calls that keep the code, and counts the functions kept", async () => {
    const leaky = join(await built(LEAKY), "dist/index.js");
    const apart = join(await built(APART), "dist/index.js");

    expect(await keptCode(leaky, "{ VALUE }")).toEqual({
      functions: 3,
      calls: [
        { call: "createContext", count: 1 },
        { call: "defineTool", count: 1 },
      ],
    });
    expect(await keptCode(apart, "{ VALUE }")).toEqual({ functions: 0, calls: [] });
  });
});

describe("hm-size --exports and --import", () => {
  /** @param {string[]} args @param {string} cwd */
  const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });

  it("prints each export's cost, cheapest first, and names the floor", async () => {
    const root = await built(APART);
    const result = run(["--exports", "dist/index.js"], root);

    expect(result.status).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 5).every((line) => /^\w+\s+\d+\.\d\d kB$/.test(line))).toBe(true);
    expect(lines[4]).toMatch(/^large\s/);
    expect(lines[5]).toMatch(/^dist\/index\.js: 5 exports; the floor is \w+, 0\.\d\d kB$/);
  });

  it("prints one import's cost, and with --kept what holds its code", async () => {
    const root = await built(LEAKY);

    const cost = run(["--import", "{ VALUE }", "dist/index.js"], root);
    expect(cost.status).toBe(0);
    expect(cost.stdout).toMatch(/^dist\/index\.js: import \{ VALUE \} ships \d+\.\d\d kB\n$/);

    const kept = run(["--import", "{ VALUE }", "--kept", "dist/index.js"], root);
    expect(kept.stdout).toContain("It keeps 3 functions, and these top-level calls:");
    expect(kept.stdout).toContain("  1 × defineTool(…)");
    expect(kept.stdout).toContain("  1 × createContext(…)");
  });

  it("exits 2 for options that don't fit together, and for an entry that isn't built", async () => {
    const root = await built(APART);

    expect(run(["--exports", "--import", "{ a }", "dist/index.js"], root).status).toBe(2);
    expect(run(["--kept", "dist/index.js"], root).status).toBe(2);
    expect(run(["--exports", "dist/index.js", "dist/other.js"], root).status).toBe(2);
    const missing = run(["--exports", "dist/missing.js"], root);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe(
      "hm-size: dist/missing.js doesn't exist. Build the package first.\n",
    );
  });
});
