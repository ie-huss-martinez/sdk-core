import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkBundledEngines,
  EXIT_FAILED,
  EXIT_OK,
  findUnpinnedEngines,
  UsageError,
  workspaceCatalogs,
} from "./check.js";

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const PRESET = pathToFileURL(
  fileURLToPath(new URL("../dependency-cruiser/index.js", import.meta.url)),
).href;

/** @type {string[]} */
const roots = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A configuration that declares engines, as an SDK's does. */
const declaring = (/** @type {string[]} */ ...engines) =>
  [
    `import { defineDependencyRules } from ${JSON.stringify(PRESET)};`,
    `export default defineDependencyRules({ bundledEngines: [{ packages: ${JSON.stringify(engines)}, from: "adapters/engine" }] });`,
    "",
  ].join("\n");

/**
 * A repository: its files, by path.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<string>} Its folder.
 */
async function repository(files) {
  // Inside the package, so that no pnpm-workspace.yaml above a temporary folder is found by accident.
  const root = await mkdtemp(join(PACKAGE, ".tmp-bundled-engines-"));
  roots.push(root);
  // A workspace file of its own stops the search here, below this repository's.
  for (const [path, content] of Object.entries({ "pnpm-workspace.yaml": "{}\n", ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** A package.json for an ES module package, as an SDK's is. */
const manifest = (/** @type {Record<string, unknown>} */ fields) =>
  JSON.stringify({ type: "module", ...fields });

describe("findUnpinnedEngines", () => {
  it("finds nothing for exact versions, direct or through a catalog", () => {
    expect(
      findUnpinnedEngines({
        engines: ["gifenc", "pdfjs-dist", "mediabunny", "@cantoo/pdf-lib"],
        manifest: {
          devDependencies: {
            gifenc: "1.0.3",
            "pdfjs-dist": "catalog:",
            mediabunny: "catalog:engines",
            "@cantoo/pdf-lib": "2.11.1-beta.2+build.5",
            vitest: "^5.0.0",
          },
        },
        catalogs: { default: { "pdfjs-dist": "6.5.438" }, engines: { mediabunny: "1.65.2" } },
      }),
    ).toEqual([]);
  });

  it.each([
    ["a caret range", "^1.0.3"],
    ["a tilde range", "~1.0.3"],
    ["a comparison", ">=1.0.3"],
    ["a partial version", "1.0"],
    ["a wildcard", "1.x"],
    ["any version", "*"],
    ["a tag", "latest"],
    ["an alias", "npm:other@1.0.3"],
    ["a workspace link", "workspace:*"],
    ["a URL", "https://example.com/gifenc.tgz"],
    ["nothing", ""],
  ])("reports %s", (_label, range) => {
    expect(
      findUnpinnedEngines({
        engines: ["gifenc"],
        manifest: { devDependencies: { gifenc: range } },
      }),
    ).toEqual([
      { engine: "gifenc", problem: `is "${range}", which isn't one exact version, such as 1.2.3.` },
    ]);
  });

  it("reports a range in the catalog, and a catalog without the engine", () => {
    expect(
      findUnpinnedEngines({
        engines: ["gifenc", "mediabunny", "pdfstudio"],
        manifest: {
          devDependencies: {
            gifenc: "catalog:",
            mediabunny: "catalog:default",
            pdfstudio: "catalog:engines",
          },
        },
        catalogs: { default: { gifenc: "^1.0.3" } },
      }),
    ).toEqual([
      {
        engine: "gifenc",
        problem: `is "^1.0.3" in the workspace's default catalog, which isn't one exact version, such as 1.2.3.`,
      },
      {
        engine: "mediabunny",
        problem: `is "catalog:default", and the workspace's default catalog has no version for it.`,
      },
      {
        engine: "pdfstudio",
        problem: `is "catalog:engines", and the workspace's engines catalog has no version for it.`,
      },
    ]);
  });

  it("reports an engine that isn't a devDependency, or is one an application would install", () => {
    expect(
      findUnpinnedEngines({
        engines: ["missing", "runtime", "peer", "optional"],
        manifest: {
          dependencies: { runtime: "1.0.0" },
          peerDependencies: { peer: "1.0.0" },
          optionalDependencies: { optional: "1.0.0" },
          devDependencies: { peer: "1.0.0", optional: "1.0.0" },
        },
      }),
    ).toEqual([
      { engine: "missing", problem: "isn't in devDependencies." },
      {
        engine: "runtime",
        problem:
          "is in dependencies. A bundled engine is built into the package, so it's in devDependencies and nowhere else.",
      },
      { engine: "runtime", problem: "isn't in devDependencies." },
      {
        engine: "peer",
        problem:
          "is in peerDependencies. A bundled engine is built into the package, so it's in devDependencies and nowhere else.",
      },
      {
        engine: "optional",
        problem:
          "is in optionalDependencies. A bundled engine is built into the package, so it's in devDependencies and nowhere else.",
      },
    ]);
  });

  it("reports each engine once, and isn't fooled by inherited names", () => {
    expect(
      findUnpinnedEngines({
        engines: ["gifenc", "gifenc", "constructor"],
        manifest: { devDependencies: { gifenc: "^1.0.3" } },
      }),
    ).toEqual([
      { engine: "gifenc", problem: `is "^1.0.3", which isn't one exact version, such as 1.2.3.` },
      { engine: "constructor", problem: "isn't in devDependencies." },
    ]);
  });
});

describe("workspaceCatalogs", () => {
  it("reads the nearest workspace file, from the folder or above it", async () => {
    const root = await repository({
      "pnpm-workspace.yaml": [
        "catalog:",
        "  gifenc: 1.0.3",
        "catalogs:",
        "  engines:",
        "    mediabunny: 1.65.2",
        "  default:",
        "    pdfstudio: 0.4.0",
        "",
      ].join("\n"),
      "packages/sdk/package.json": "{}",
    });

    const expected = {
      file: join(root, "pnpm-workspace.yaml"),
      catalogs: {
        default: { gifenc: "1.0.3", pdfstudio: "0.4.0" },
        engines: { mediabunny: "1.65.2" },
      },
    };
    expect(workspaceCatalogs(root)).toEqual(expected);
    expect(workspaceCatalogs(join(root, "packages/sdk"))).toEqual(expected);
  });

  it("has an empty default catalog for a workspace file without one", async () => {
    const root = await repository({ "pnpm-workspace.yaml": "packages:\n  - packages/*\n" });
    expect(workspaceCatalogs(root).catalogs).toEqual({ default: {} });
  });

  it("refuses a workspace file that isn't YAML", async () => {
    const root = await repository({ "pnpm-workspace.yaml": "catalog: [unclosed\n" });
    expect(() => workspaceCatalogs(root)).toThrow(UsageError);
  });
});

describe("checkBundledEngines", () => {
  it("passes when every declared engine is exactly pinned, through the catalog too", async () => {
    const root = await repository({
      ".dependency-cruiser.js": declaring("gifenc", "mediabunny"),
      "package.json": manifest({
        devDependencies: { gifenc: "catalog:", mediabunny: "1.65.2" },
      }),
      "pnpm-workspace.yaml": "catalog:\n  gifenc: 1.0.3\n",
    });

    expect(await checkBundledEngines({ cwd: root })).toEqual({
      exitCode: EXIT_OK,
      report: "All 2 bundled engines are exactly pinned devDependencies: gifenc, mediabunny.\n",
    });
  });

  it("fails, naming each engine and what's wrong with it", async () => {
    const root = await repository({
      ".dependency-cruiser.js": declaring("gifenc", "mediabunny"),
      "package.json": manifest({
        peerDependencies: { mediabunny: "^1.0.0" },
        devDependencies: { gifenc: "catalog:", mediabunny: "1.65.2" },
      }),
      "pnpm-workspace.yaml": "catalog:\n  gifenc: ^1.0.3\n",
    });

    expect(await checkBundledEngines({ cwd: root })).toEqual({
      exitCode: EXIT_FAILED,
      report: [
        "Bundled engines must be exactly pinned devDependencies (sdk-core ADR 0061):",
        `  gifenc is "^1.0.3" in the workspace's default catalog, which isn't one exact version, such as 1.2.3.`,
        "  mediabunny is in peerDependencies. A bundled engine is built into the package, so it's in devDependencies and nowhere else.",
        "",
      ].join("\n"),
    });
  });

  it("passes, and says so, when the configuration declares none", async () => {
    const root = await repository({
      ".dependency-cruiser.js": `export { default } from ${JSON.stringify(PRESET)};\n`,
      // No devDependencies at all: with nothing declared, nothing is checked.
      "package.json": manifest({}),
    });

    expect(await checkBundledEngines({ cwd: root })).toEqual({
      exitCode: EXIT_OK,
      report: "No bundled engines are declared in .dependency-cruiser.js.\n",
    });
  });

  it("reads another configuration file when given one", async () => {
    const root = await repository({
      "config/deps.js": declaring("gifenc"),
      "package.json": manifest({ devDependencies: { gifenc: "1.0.3" } }),
    });

    expect(await checkBundledEngines({ cwd: root, configFile: "config/deps.js" })).toEqual({
      exitCode: EXIT_OK,
      report: "The bundled engine is an exactly pinned devDependency: gifenc.\n",
    });
  });

  it.each([
    ["a missing configuration", { "package.json": manifest({}) }, /doesn't exist/],
    [
      "a configuration that throws",
      { ".dependency-cruiser.js": 'throw new Error("broken");\n', "package.json": manifest({}) },
      /couldn't be loaded: broken/,
    ],
    ["a missing package.json", { ".dependency-cruiser.js": declaring("gifenc") }, /can't be read/],
    [
      // Node reads it first, to load the configuration as a module.
      "a package.json that isn't JSON",
      { ".dependency-cruiser.js": declaring("gifenc"), "package.json": "{" },
      /couldn't be loaded/,
    ],
    [
      "a package.json that isn't an object",
      { ".dependency-cruiser.js": declaring("gifenc"), "package.json": "[]" },
      /isn't an object/,
    ],
  ])("refuses %s", async (_label, files, message) => {
    const root = await repository(files);
    await expect(checkBundledEngines({ cwd: root })).rejects.toThrow(UsageError);
    await expect(checkBundledEngines({ cwd: root })).rejects.toThrow(message);
  });
});

describe("hm-check-bundled-engines", () => {
  /**
   * @param {string} cwd
   * @param {string[]} [args]
   */
  const run = (cwd, args = []) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

  it("exits 0 and reports on stdout when the engines are pinned", async () => {
    const root = await repository({
      ".dependency-cruiser.js": declaring("gifenc"),
      "package.json": manifest({ devDependencies: { gifenc: "1.0.3" } }),
    });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("The bundled engine is an exactly pinned devDependency: gifenc.\n");
    expect(result.stderr).toBe("");
  });

  it("exits 1 and reports on stderr when one isn't", async () => {
    const root = await repository({
      ".dependency-cruiser.js": declaring("gifenc"),
      "package.json": manifest({ devDependencies: { gifenc: "^1.0.3" } }),
    });

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`gifenc is "^1.0.3", which isn't one exact version`);
  });

  it("exits 2 without a stack trace for a missing configuration or an unknown option", async () => {
    const root = await repository({ "package.json": manifest({}) });

    const missing = run(root);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(
      /^hm-check-bundled-engines: The configuration .* doesn't exist\.\n$/,
    );

    const unknown = run(root, ["--nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Usage: hm-check-bundled-engines");
  });

  it("prints its usage", async () => {
    const root = await repository({});
    const result = run(root, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: hm-check-bundled-engines [--config <file>]");
  });
});
