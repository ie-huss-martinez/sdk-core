import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { brotliSize, entryFiles, formatKilobytes, measureEntry, UsageError } from "./entry.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

/** @type {string[]} */
const roots = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A built package: its dist files, by path.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<string>} Its folder.
 */
async function built(files) {
  const root = await mkdtemp(join(tmpdir(), "hm-size-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** A package shaped like the SDKs': two entries, shared chunks, and a lazy one. */
const PACKAGE = {
  "dist/index.js": [
    'import { a } from "./shared/a-1.js";',
    'export { b } from "./shared/b-2.js";',
    'export const load = () => import("./lazy/worker-3.js");',
    "export const index = a;",
  ].join("\n"),
  "dist/react.js": ['import { a } from "./shared/a-1.js";', "export const react = a;"].join("\n"),
  "dist/shared/a-1.js": ['import "./side-effect-4.js";', "export const a = 1;"].join("\n"),
  "dist/shared/b-2.js": ["import { c } from './c-5.js';", "export const b = c;"].join("\n"),
  "dist/shared/c-5.js": "export const c = 3;\n",
  "dist/shared/side-effect-4.js": "globalThis.loaded = true;\n",
  "dist/shared/only-react-uses-nothing-6.js": "export const unused = 0;\n",
  "dist/lazy/worker-3.js": 'import { c } from "../shared/c-5.js";\nexport const worker = c;\n',
};

describe("entryFiles", () => {
  it("lists the entry, then every chunk it imports statically, each once", async () => {
    const root = await built(PACKAGE);
    const at = (/** @type {string} */ path) => join(root, path);

    expect(entryFiles(at("dist/index.js"))).toEqual([
      at("dist/index.js"),
      at("dist/shared/a-1.js"),
      at("dist/shared/side-effect-4.js"),
      at("dist/shared/b-2.js"),
      at("dist/shared/c-5.js"),
    ]);
  });

  it("counts only what this entry loads, not every shared chunk", async () => {
    const root = await built(PACKAGE);
    const at = (/** @type {string} */ path) => join(root, path);

    expect(entryFiles(at("dist/react.js"))).toEqual([
      at("dist/react.js"),
      at("dist/shared/a-1.js"),
      at("dist/shared/side-effect-4.js"),
    ]);
  });

  it("leaves out chunks loaded later with import(), and what only they load", async () => {
    const root = await built({
      "dist/index.js": 'export const load = () => import("./lazy/worker.js");\n',
      "dist/lazy/worker.js": 'import "./only-the-worker.js";\n',
      "dist/lazy/only-the-worker.js": "export {};\n",
    });

    expect(entryFiles(join(root, "dist/index.js"))).toEqual([join(root, "dist/index.js")]);
  });

  it("follows imports as a minifier writes them, and in a cycle", async () => {
    const root = await built({
      "dist/index.js": 'import"./a.js";import{b}from"./b.js";export{b};',
      "dist/a.js": 'import"./index.js";',
      "dist/b.js": "export const b=1;",
    });

    expect(entryFiles(join(root, "dist/index.js")).map((path) => path.slice(root.length))).toEqual([
      "/dist/index.js",
      "/dist/a.js",
      "/dist/b.js",
    ]);
  });

  it("ignores packages and files that aren't JavaScript", async () => {
    const root = await built({
      "dist/index.js": [
        'import { SdkError } from "@hussmartinez/sdk-core";',
        'import "./styles.css";',
        'import data from "./data.json";',
        "export { SdkError, data };",
      ].join("\n"),
    });

    expect(entryFiles(join(root, "dist/index.js"))).toHaveLength(1);
  });

  it("takes a path relative to the working directory, as .size-limit.js gives it", async () => {
    const root = await built(PACKAGE);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(entryFiles("dist/react.js")).toEqual([
        "dist/react.js",
        "dist/shared/a-1.js",
        "dist/shared/side-effect-4.js",
      ]);
      expect(entryFiles("./dist/react.js")[0]).toBe("dist/react.js");
    } finally {
      process.chdir(cwd);
    }
  });

  it("says to build when the entry isn't there, or a chunk it imports is gone", async () => {
    const root = await built({ "dist/index.js": 'import "./shared/gone.js";\n' });

    expect(() => entryFiles(join(root, "dist/missing.js"))).toThrow(UsageError);
    expect(() => entryFiles(join(root, "dist/missing.js"))).toThrow(
      /missing\.js doesn't exist\. Build the package first\./,
    );
    expect(() => entryFiles(join(root, "dist/index.js"))).toThrow(
      /gone\.js, which .*index\.js imports, doesn't exist/,
    );
  });
});

describe("measureEntry", () => {
  it("sums the brotli size of the entry's files, as built and minified", async () => {
    const code = [
      "export function describeTheLimit(theMaximumNumberOfFiles) {",
      "  const theMessageForTheUser = 'You can add up to ' + theMaximumNumberOfFiles + ' files.';",
      "  return theMessageForTheUser;",
      "}",
      "",
    ].join("\n");
    const root = await built({
      "dist/index.js": `import { helper } from "./shared/helper.js";\n${code}export { helper };\n`,
      "dist/shared/helper.js":
        "export function helper(aLongParameterName) {\n  return aLongParameterName + 1;\n}\n",
      "dist/shared/unrelated.js": "export const unrelated = 'x'.repeat(1000);\n",
    });
    const entry = join(root, "dist/index.js");

    const size = await measureEntry(entry);

    expect(size.entry).toBe(entry);
    expect(size.files).toEqual([entry, join(root, "dist/shared/helper.js")]);
    expect(size.built).toBe(
      brotliSize(`import { helper } from "./shared/helper.js";\n${code}export { helper };\n`) +
        brotliSize(
          "export function helper(aLongParameterName) {\n  return aLongParameterName + 1;\n}\n",
        ),
    );
    // Minifying drops the whitespace and shortens the local names.
    expect(size.minified).toBeLessThan(size.built);
    expect(size.minified).toBeGreaterThan(0);
  });

  it("refuses an entry that isn't built", async () => {
    await expect(measureEntry(join(tmpdir(), "hm-size-missing", "index.js"))).rejects.toThrow(
      UsageError,
    );
  });
});

describe("formatKilobytes and brotliSize", () => {
  it("prints sizes as size-limit does, in kilobytes of 1,000 bytes", () => {
    expect(formatKilobytes(15_567)).toBe("15.57 kB");
    expect(formatKilobytes(999)).toBe("1.00 kB");
    expect(formatKilobytes(0)).toBe("0.00 kB");
  });

  it("measures text and bytes alike", () => {
    const text = "export const value = 1;\n".repeat(50);
    expect(brotliSize(text)).toBe(brotliSize(Buffer.from(text)));
    expect(brotliSize(text)).toBeLessThan(text.length);
  });
});

describe("hm-size", () => {
  /** @param {string[]} args @param {string} cwd */
  const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });

  it("prints each entry's size as built and minified, and never fails on a size", async () => {
    const root = await built(PACKAGE);
    const result = run(["dist/index.js", "dist/react.js"], root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n").slice(0, 2)).toEqual([
      expect.stringMatching(
        /^dist\/index\.js: \d+\.\d\d kB as built, \d+\.\d\d kB minified \(-?\d+% less\), in 5 files$/,
      ),
      expect.stringMatching(
        /^dist\/react\.js: \d+\.\d\d kB as built, \d+\.\d\d kB minified \(-?\d+% less\), in 3 files$/,
      ),
    ]);
  });

  it("exits 2 for an entry that isn't built, and without arguments", async () => {
    const root = await built(PACKAGE);

    const missing = run(["dist/missing.js"], root);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe(
      "hm-size: dist/missing.js doesn't exist. Build the package first.\n",
    );
    expect(run([], root).status).toBe(2);
    expect(run(["--help"], root).status).toBe(0);
  });
});
