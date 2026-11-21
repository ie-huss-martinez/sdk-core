import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { describe, expect, it } from "vitest";
import config, {
  bundledEnginesOf,
  declaresNoBundledEngines,
  defineDependencyRules,
} from "./index.js";

/**
 * Cruises a fixture package with the preset and lists each violation as
 * `rule: from -> to`, with paths relative to the fixture's `src/`.
 *
 * @param {string} fixture Folder name under `test/fixtures`.
 * @returns {Promise<string[]>}
 */
async function violations(fixture) {
  const baseDir = fileURLToPath(new URL(`../../test/fixtures/${fixture}`, import.meta.url));
  const { output } = await cruise(["src"], {
    ...config.options,
    baseDir,
    ruleSet: { forbidden: config.forbidden ?? [] },
    validate: true,
  });
  if (typeof output === "string") {
    throw new TypeError("expected a structured cruise result");
  }
  /** @param {string} path */
  const relative = (path) => path.replace(/^src\//, "");
  return output.summary.violations
    .map(({ rule, from, to }) => `${rule.name}: ${relative(from)} -> ${relative(to)}`)
    .sort();
}

/**
 * @param {string[]} list
 * @param {string} rule
 * @returns {string[]}
 */
const withRule = (list, rule) => list.filter((violation) => violation.startsWith(`${rule}:`));

/**
 * @param {string[]} list
 * @param {string} rule
 * @returns {string[]}
 */
const withoutRule = (list, rule) => list.filter((violation) => !violation.startsWith(`${rule}:`));

/**
 * Cruises the `ai-core-import` fixture's `src/` and `examples/`, and lists the
 * `no-ai-core` violations as `from -> to`.
 *
 * @returns {Promise<string[]>}
 */
async function aiCoreViolations() {
  const baseDir = fileURLToPath(new URL("../../test/fixtures/ai-core-import", import.meta.url));
  const { output } = await cruise(["src", "examples"], {
    ...config.options,
    baseDir,
    ruleSet: { forbidden: config.forbidden ?? [] },
    validate: true,
  });
  if (typeof output === "string") {
    throw new TypeError("expected a structured cruise result");
  }
  return output.summary.violations
    .filter(({ rule }) => rule.name === "no-ai-core")
    .map(({ from, to }) => `${from} -> ${to}`)
    .sort();
}

describe("dependency-cruiser preset", () => {
  it("reports every forbidden edge between the layers of ADR 0008 and ADR 0017", async () => {
    // The fixture installs no packages, so its npm imports are also unresolvable.
    const layerViolations = withoutRule(await violations("layered-sdk"), "not-to-unresolvable");
    expect(layerViolations).toEqual([
      "core-no-ui: core/operations/rotate.ts -> @hussmartinez/ui",
      "core-no-ui: core/session/store.ts -> react",
      "layer-adapters: adapters/engine/engine.ts -> core/session/events.ts",
      "layer-core: core/session/store.ts -> adapters/engine/engine.ts",
      "layer-errors: core/errors/errors.ts -> core/session/events.ts",
      "layer-features: features/rotate/rotate.operation.ts -> adapters/engine/engine.ts",
      "layer-model: core/model/page.ts -> core/session/events.ts",
      "layer-operations: core/operations/rotate.ts -> core/ports/engine.ts",
    ]);
  });

  it("reports imports that don't resolve", async () => {
    expect(withRule(await violations("layered-sdk"), "not-to-unresolvable")).toEqual([
      "not-to-unresolvable: core/errors/errors.ts -> @hussmartinez/sdk-core",
      "not-to-unresolvable: core/operations/rotate.ts -> @hussmartinez/ui",
      "not-to-unresolvable: core/session/store.ts -> @hussmartinez/sdk-core",
      "not-to-unresolvable: core/session/store.ts -> react",
    ]);
  });

  it("keeps React and ui out of the core, adapters and workers (ADR 0017, ADR 0036)", async () => {
    // The fixture installs no packages, so its npm imports are also unresolvable.
    expect(withRule(await violations("ui-reach"), "core-no-ui")).toEqual([
      "core-no-ui: adapters/engine/engine.ts -> react",
      // Even ui's root entry, and even as types.
      "core-no-ui: core/session/icons.ts -> @hussmartinez/ui",
      "core-no-ui: workers/render.worker.ts -> @hussmartinez/ui",
    ]);
  });

  it("keeps React and ui's React entry out of everything the . entry reaches, even as types", async () => {
    expect(withRule(await violations("ui-reach"), "entry-no-react")).toEqual([
      "entry-no-react: index.ts -> @hussmartinez/ui/react",
      "entry-no-react: index.ts -> react",
    ]);
  });

  it("lets a feature the . entry reaches import ui's root entry, types and values", async () => {
    const reported = withoutRule(await violations("ui-reach"), "not-to-unresolvable");
    expect(
      reported.filter((violation) => violation.includes("features/tools/rotate.tool.ts")),
    ).toEqual([]);
    // Nothing reports the root entry itself as reached from index.ts.
    expect(reported).not.toContain("entry-no-react: index.ts -> @hussmartinez/ui");
  });

  it("matches React and ui's React entry as installed, but not ui's root entry", () => {
    const rule = /** @type {{ to: { path?: string | string[] } } | undefined} */ (
      (config.forbidden ?? []).find(({ name }) => name === "entry-no-react")
    );
    const patterns = [rule?.to.path ?? []].flat().map((path) => new RegExp(path));
    const matches = (/** @type {string} */ path) => patterns.some((pattern) => pattern.test(path));
    const ui = "node_modules/.pnpm/@hussmartinez+ui@0.3.0/node_modules/@hussmartinez/ui";
    for (const path of [
      "react",
      "react-dom/client",
      "node_modules/.pnpm/react@19.3.1/node_modules/react/index.js",
      "@hussmartinez/ui/react",
      `${ui}/dist/react.js`,
      `${ui}/dist/react.d.ts`,
      "node_modules/react/index.js",
      "node_modules/@hussmartinez/ui/dist/react.js",
    ]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of [
      "@hussmartinez/ui",
      `${ui}/dist/index.js`,
      `${ui}/dist/index.d.ts`,
      `${ui}/dist/shared/pair-BrwWt2Rz.js`,
      "node_modules/react-markdown/index.js",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("keeps ai-core out of published source, as values and as types (ADR 0035)", async () => {
    expect(await aiCoreViolations()).toEqual([
      "src/core/ports/assistant.ts -> @hussmartinez/ai-core",
      "src/features/summary/summary.ts -> @hussmartinez/ai-core",
    ]);
  });

  it("lets examples import ai-core", async () => {
    // Tests are covered in lint-deps.test.js: a fixture test file here would
    // be collected by Vitest.
    const reported = await aiCoreViolations();
    expect(reported.filter((violation) => violation.startsWith("examples/"))).toEqual([]);
  });

  it("says why ai-core is forbidden and what to do instead", () => {
    const rule = (config.forbidden ?? []).find(({ name }) => name === "no-ai-core");
    expect(rule?.comment).toContain("ADR 0035");
    expect(rule?.comment).toContain("provider port");
  });

  it("matches ai-core as written and as installed, but no other package", () => {
    const rule = /** @type {{ to: { path?: string | string[] } } | undefined} */ (
      (config.forbidden ?? []).find(({ name }) => name === "no-ai-core")
    );
    const patterns = [rule?.to.path ?? []].flat().map((path) => new RegExp(path));
    const matches = (/** @type {string} */ path) => patterns.some((pattern) => pattern.test(path));
    for (const path of [
      "@hussmartinez/ai-core",
      "@hussmartinez/ai-core/server",
      "node_modules/@hussmartinez/ai-core/dist/index.js",
      "node_modules/.pnpm/@hussmartinez+ai-core@0.1.0/node_modules/@hussmartinez/ai-core/dist/index.d.ts",
    ]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of [
      "@hussmartinez/ai-core-extra",
      "@hussmartinez/sdk-core",
      "node_modules/@other/ai-core/index.js",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("names the path from the . entry to React", async () => {
    const baseDir = fileURLToPath(new URL("../../test/fixtures/ui-reach", import.meta.url));
    const { output } = await cruise(["src"], {
      ...config.options,
      baseDir,
      ruleSet: { forbidden: config.forbidden ?? [] },
      validate: true,
    });
    if (typeof output === "string") {
      throw new TypeError("expected a structured cruise result");
    }
    const paths = output.summary.violations
      .filter(({ rule }) => rule.name === "entry-no-react")
      .map(({ via }) => via?.map(({ name }) => name));
    expect(paths).toEqual(
      expect.arrayContaining([
        ["src/features/toolbar/toolbar.ts", "@hussmartinez/ui/react"],
        ["src/features/tools/render.ts", "react"],
      ]),
    );
  });

  describe("with installed packages that live in dist/", () => {
    /**
     * A package with real `node_modules`, written to a temporary directory
     * because git doesn't keep `node_modules` in fixtures. Its packages keep
     * their code in `dist/`, as most published packages do.
     */
    const FILES = {
      "package.json": JSON.stringify({
        name: "installed-sdk",
        type: "module",
        dependencies: { "@hussmartinez/ui": "0.3.0", engine: "1.0.0" },
        devDependencies: { tester: "1.0.0" },
      }),
      "node_modules/@hussmartinez/ui/package.json": JSON.stringify({
        name: "@hussmartinez/ui",
        type: "module",
        exports: { ".": "./dist/index.js", "./react": "./dist/react.js" },
      }),
      "node_modules/@hussmartinez/ui/dist/index.js": "export const Button = 1;\n",
      "node_modules/@hussmartinez/ui/dist/react.js": "export const Toolbar = 1;\n",
      "node_modules/engine/package.json": JSON.stringify({
        name: "engine",
        type: "module",
        main: "dist/index.js",
      }),
      "node_modules/engine/dist/index.js": "export const decode = 1;\n",
      "node_modules/tester/package.json": JSON.stringify({
        name: "tester",
        type: "module",
        main: "dist/index.js",
      }),
      "node_modules/tester/dist/index.js": "export const it = 1;\n",
      "src/index.ts": 'export { Toolbar } from "@hussmartinez/ui/react";\n',
      "src/core/model/page.ts":
        'import { Button } from "@hussmartinez/ui";\nexport const page = Button;\n',
      "src/adapters/engine.ts": 'import { it } from "tester";\nexport const engine = it;\n',
      "src/core/errors/errors.ts":
        'import { decode } from "engine";\nexport const errors = decode;\n',
      "src/core/errors/errors.test.ts":
        'import { it } from "tester";\nimport { errors } from "./errors.ts";\nit(errors);\n',
      // The package's own build output and fixtures stay out of the cruise.
      "dist/index.js": 'import "@hussmartinez/ui/react";\n',
      "src/fixtures/leak.ts": 'import "@hussmartinez/ui/react";\n',
    };

    /** @returns {Promise<string[]>} */
    async function installedViolations() {
      const baseDir = await mkdtemp(join(tmpdir(), "hm-installed-sdk-"));
      try {
        for (const [path, content] of Object.entries(FILES)) {
          await mkdir(dirname(join(baseDir, path)), { recursive: true });
          await writeFile(join(baseDir, path), content);
        }
        const { output } = await cruise(["src", "dist"], {
          ...config.options,
          baseDir,
          ruleSet: { forbidden: config.forbidden ?? [] },
          validate: true,
        });
        if (typeof output === "string") {
          throw new TypeError("expected a structured cruise result");
        }
        return output.summary.violations
          .map(({ rule, from, to }) => `${rule.name}: ${from} -> ${to}`)
          .sort();
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    }

    it("checks imports that resolve into a package's dist/, and only the package's own dist/ is left out", async () => {
      expect(await installedViolations()).toEqual([
        "core-no-ui: src/core/model/page.ts -> node_modules/@hussmartinez/ui/dist/index.js",
        "entry-no-react: src/index.ts -> node_modules/@hussmartinez/ui/dist/react.js",
        "layer-errors: src/core/errors/errors.ts -> node_modules/engine/dist/index.js",
        "not-to-dev-dep: src/adapters/engine.ts -> node_modules/tester/dist/index.js",
      ]);
    });
  });

  it("leaves out the repository's build output and fixtures, but not packages' dist/", () => {
    const exclude = /** @type {{ path: string[] }} */ (config.options?.exclude);
    const patterns = exclude.path.map((path) => new RegExp(path));
    const excluded = {
      test: (/** @type {string} */ path) => patterns.some((pattern) => pattern.test(path)),
    };
    for (const path of [
      "dist/index.js",
      "temp/types/index.d.ts",
      "coverage/index.html",
      "packages/sdk-core/dist/index.js",
      "apps/docs/dist/main.js",
      "src/worker/fixtures/echo.ts",
      "test/fixtures/layered-sdk/src/index.ts",
    ]) {
      expect(excluded.test(path), path).toBe(true);
    }
    for (const path of [
      "node_modules/@hussmartinez/ui/dist/react.js",
      "node_modules/.pnpm/mediabunny@1.0.0/node_modules/mediabunny/dist/bundles/mediabunny.mjs",
      "node_modules/react/cjs/react.production.js",
      "node_modules/some-package/fixtures/x.js",
      "src/core/model/page.ts",
      "src/dist-helpers/format.ts",
    ]) {
      expect(excluded.test(path), path).toBe(false);
    }
  });

  it("reports cycles", async () => {
    await expect(violations("cycle")).resolves.toEqual(["no-circular: a.ts -> b.ts"]);
  });
});

describe("defineDependencyRules", () => {
  /** @param {string} name */
  const installed = (name) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      type: "module",
      main: "index.js",
      types: "index.d.ts",
    }),
    [`node_modules/${name}/index.js`]: "export const run = 1;\n",
    [`node_modules/${name}/index.d.ts`]:
      "export declare const run: number;\nexport type Frame = number;\n",
  });

  /** A package with two engines, a test tool, and imports of each from the right and the wrong places. */
  const FILES = {
    "package.json": JSON.stringify({
      name: "engine-sdk",
      type: "module",
      devDependencies: { gifenc: "1.0.3", "@cantoo/pdf-lib": "2.11.1", tester: "1.0.0" },
    }),
    ...installed("gifenc"),
    ...installed("@cantoo/pdf-lib"),
    ...installed("tester"),
    // The engine's own folder: the engine, as a value and as a type.
    "src/adapters/gif/encoder.ts":
      'import { run } from "gifenc";\nimport type { Frame } from "gifenc";\nexport const encode: Frame = run;\n',
    // The engine's folder still can't import a test tool, or another folder's engine.
    "src/adapters/gif/leak.ts":
      'import { run } from "tester";\nimport { run as other } from "@cantoo/pdf-lib";\nexport const leak = [run, other];\n',
    "src/adapters/gif/encoder.test.ts":
      'import { run } from "tester";\nimport { encode } from "./encoder.ts";\nrun;\nencode;\n',
    // Another adapter, a worker and the core: none may import the engine, even as a type.
    "src/adapters/png/encoder.ts": 'import { run } from "gifenc";\nexport const png = run;\n',
    "src/workers/job.worker.ts":
      'import type { Frame } from "gifenc";\nexport const frame: Frame = 1;\n',
    "src/core/model/frame.ts": 'import type { Frame } from "gifenc";\nexport type Model = Frame;\n',
    // A test elsewhere may, as it may import any devDependency.
    "src/core/model/frame.test.ts": 'import { run } from "gifenc";\nrun;\n',
    // The second engine, declared for two folders.
    "src/adapters/pdf/write.ts":
      'import { run } from "@cantoo/pdf-lib";\nexport const write = run;\n',
    "src/workers/pdf/job.ts": 'import { run } from "@cantoo/pdf-lib";\nexport const job = run;\n',
    // Modules the build generates, and a stylesheet as a URL.
    "src/adapters/pdf/data.ts":
      'import data from "virtual:hm-data";\nimport other from "virtual:hm-data-2";\nexport const all = [data, other];\n',
    "src/react/Editor.tsx":
      'import url from "@hussmartinez/ui/styles.css?url";\nexport const editor = url;\n',
    "src/react/Editor.browser.test.tsx":
      'import url from "@hussmartinez/ui/styles.css?url";\nurl;\n',
    "test/react.tsx":
      'import url from "@hussmartinez/ui/styles.css?url";\nexport const page = url;\n',
  };

  /**
   * @param {import("dependency-cruiser").IConfiguration} rules
   * @returns {Promise<string[]>} Each violation, as `rule: from -> to`.
   */
  async function cruised(rules) {
    const baseDir = await mkdtemp(join(tmpdir(), "hm-engine-sdk-"));
    try {
      for (const [path, content] of Object.entries(FILES)) {
        await mkdir(dirname(join(baseDir, path)), { recursive: true });
        await writeFile(join(baseDir, path), content);
      }
      const { output } = await cruise(["src", "test"], {
        ...rules.options,
        baseDir,
        ruleSet: { forbidden: rules.forbidden ?? [] },
        validate: true,
      });
      if (typeof output === "string") {
        throw new TypeError("expected a structured cruise result");
      }
      return output.summary.violations
        .map(({ rule, from, to }) => `${rule.name}: ${from} -> ${to}`)
        .sort();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  }

  const declared = () =>
    defineDependencyRules({
      bundledEngines: [
        { packages: ["gifenc"], from: "adapters/gif" },
        { packages: ["@cantoo/pdf-lib"], from: "adapters/pdf" },
        { packages: ["@cantoo/pdf-lib"], from: "workers/pdf" },
      ],
      virtualModules: ["virtual:hm-data"],
    });

  it("lets each engine's folder import it, and reports it everywhere else, even as a type", async () => {
    expect(await cruised(declared())).toEqual([
      // The folder's own engine is fine; another folder's engine and a test tool aren't.
      "engine-folder-only-its-engines: src/adapters/gif/leak.ts -> node_modules/@cantoo/pdf-lib/index.js",
      "engine-folder-only-its-engines: src/adapters/gif/leak.ts -> node_modules/tester/index.js",
      "engine-only-from-its-folder: src/adapters/gif/leak.ts -> node_modules/@cantoo/pdf-lib/index.js",
      "engine-only-from-its-folder: src/adapters/png/encoder.ts -> node_modules/gifenc/index.js",
      // Type-only imports, which not-to-dev-dep lets through.
      "engine-only-from-its-folder: src/core/model/frame.ts -> node_modules/gifenc/index.js",
      "engine-only-from-its-folder: src/workers/job.worker.ts -> node_modules/gifenc/index.js",
      "not-to-dev-dep: src/adapters/png/encoder.ts -> node_modules/gifenc/index.js",
      // Only the virtual module that was named.
      "not-to-unresolvable: src/adapters/pdf/data.ts -> virtual:hm-data-2",
      // A stylesheet as a URL, outside test code.
      "stylesheet-url-only-in-tests: src/react/Editor.tsx -> @hussmartinez/ui/styles.css?url",
    ]);
  });

  it("is the preset when nothing is declared, where an engine is a devDependency like any other", async () => {
    expect(defineDependencyRules().forbidden).toEqual(config.forbidden);
    expect(defineDependencyRules({}).options).toBe(config.options);

    const reported = await cruised(config);
    expect(reported.filter((line) => line.startsWith("not-to-dev-dep:"))).toEqual([
      "not-to-dev-dep: src/adapters/gif/encoder.ts -> node_modules/gifenc/index.js",
      "not-to-dev-dep: src/adapters/gif/leak.ts -> node_modules/@cantoo/pdf-lib/index.js",
      "not-to-dev-dep: src/adapters/gif/leak.ts -> node_modules/tester/index.js",
      "not-to-dev-dep: src/adapters/pdf/write.ts -> node_modules/@cantoo/pdf-lib/index.js",
      "not-to-dev-dep: src/adapters/png/encoder.ts -> node_modules/gifenc/index.js",
      "not-to-dev-dep: src/workers/pdf/job.ts -> node_modules/@cantoo/pdf-lib/index.js",
    ]);
    // The stylesheet rule is the preset's own, with nothing declared.
    expect(reported).toContain(
      "stylesheet-url-only-in-tests: src/react/Editor.tsx -> @hussmartinez/ui/styles.css?url",
    );
    // Nothing is reported from test code: test files, and helpers under test/.
    expect(reported.filter((line) => /: (?:test\/|\S+\.test\.)/.test(line))).toEqual([]);
  });

  /**
   * Cruises files written for one case, with one engine installed per name.
   *
   * @param {import("dependency-cruiser").IConfiguration} rules
   * @param {string[]} packages
   * @param {Record<string, string>} sources
   * @returns {Promise<string[]>} Each violation, as `rule: from -> to`.
   */
  async function cruisedCase(rules, packages, sources) {
    const baseDir = await mkdtemp(join(tmpdir(), "hm-engine-case-"));
    try {
      const files = {
        "package.json": JSON.stringify({
          name: "case-sdk",
          type: "module",
          devDependencies: Object.fromEntries(packages.map((name) => [name, "1.0.0"])),
        }),
        ...Object.assign({}, ...packages.map(installed)),
        ...sources,
      };
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(baseDir, path)), { recursive: true });
        await writeFile(join(baseDir, path), content);
      }
      const { output } = await cruise(["src"], {
        ...rules.options,
        baseDir,
        ruleSet: { forbidden: rules.forbidden ?? [] },
        validate: true,
      });
      if (typeof output === "string") {
        throw new TypeError("expected a structured cruise result");
      }
      return output.summary.violations
        .map(({ rule, from, to }) => `${rule.name}: ${from} -> ${to}`)
        .sort();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  }

  it("reads a folder's name as text: a dot in it matches only a dot", async () => {
    const rules = defineDependencyRules({
      bundledEngines: [{ packages: ["pdfjs-dist"], from: "adapters/pdf.js" }],
    });
    const use = 'import { run } from "pdfjs-dist";\nexport const use = run;\n';

    expect(
      await cruisedCase(rules, ["pdfjs-dist"], {
        "src/adapters/pdf.js/engine.ts": use,
        "src/adapters/pdfXjs/engine.ts": use,
      }),
    ).toEqual([
      "engine-only-from-its-folder: src/adapters/pdfXjs/engine.ts -> node_modules/pdfjs-dist/index.js",
      "not-to-dev-dep: src/adapters/pdfXjs/engine.ts -> node_modules/pdfjs-dist/index.js",
    ]);
  });

  it("lets a declared folder inside another keep its own engine, and use the outer one's", async () => {
    const rules = defineDependencyRules({
      bundledEngines: [
        { packages: ["pdfjs-dist"], from: "workers" },
        { packages: ["gifenc"], from: "workers/gif" },
      ],
    });
    const gif = 'import { run } from "gifenc";\nexport const gif = run;\n';
    const pdf = 'import { run } from "pdfjs-dist";\nexport const pdf = run;\n';
    const tool = 'import { run } from "tester";\nexport const tool = run;\n';

    expect(
      await cruisedCase(rules, ["pdfjs-dist", "gifenc", "tester"], {
        // The inner folder: its own engine, and the outer folder's, which it's inside.
        "src/workers/gif/job.ts": gif,
        "src/workers/gif/shared.ts": pdf,
        // The outer folder: its engine, but not the inner folder's.
        "src/workers/pdf.worker.ts": pdf,
        "src/workers/leak.ts": gif,
        // A folder beside the inner one, whose name starts the same way.
        "src/workers/gifts/job.ts": gif,
        // Neither folder may import a test tool.
        "src/workers/gif/tool.ts": tool,
        "src/workers/tool.ts": tool,
      }),
    ).toEqual([
      "engine-folder-only-its-engines: src/workers/gif/tool.ts -> node_modules/tester/index.js",
      "engine-folder-only-its-engines: src/workers/gifts/job.ts -> node_modules/gifenc/index.js",
      "engine-folder-only-its-engines: src/workers/leak.ts -> node_modules/gifenc/index.js",
      "engine-folder-only-its-engines: src/workers/tool.ts -> node_modules/tester/index.js",
      "engine-only-from-its-folder: src/workers/gifts/job.ts -> node_modules/gifenc/index.js",
      "engine-only-from-its-folder: src/workers/leak.ts -> node_modules/gifenc/index.js",
    ]);
  });

  it("keeps the engines it was given readable, and out of the configuration's own keys", () => {
    const rules = declared();

    expect(bundledEnginesOf(rules)).toEqual([
      { packages: ["gifenc"], from: "adapters/gif" },
      { packages: ["@cantoo/pdf-lib"], from: "adapters/pdf" },
      { packages: ["@cantoo/pdf-lib"], from: "workers/pdf" },
    ]);
    expect(Object.keys(rules).sort()).toEqual(Object.keys(config).sort());
    expect(JSON.parse(JSON.stringify(rules))).toEqual(
      JSON.parse(JSON.stringify({ ...config, forbidden: rules.forbidden })),
    );
    expect(bundledEnginesOf(config)).toEqual([]);
    expect(bundledEnginesOf(defineDependencyRules())).toEqual([]);
    expect(bundledEnginesOf(undefined)).toEqual([]);
    expect(bundledEnginesOf({ forbidden: [] })).toEqual([]);
  });

  it("keeps its engines in a copy, however the copy was made", () => {
    const rules = declared();
    const expected = bundledEnginesOf(rules);
    expect(expected).toHaveLength(3);

    // Spread into a new object, as a repository does to add an option.
    expect(bundledEnginesOf({ ...rules, options: { ...rules.options } })).toEqual(expected);
    expect(bundledEnginesOf(Object.assign({}, rules))).toEqual(expected);
    expect(bundledEnginesOf(structuredClone(rules))).toEqual(expected);
    expect(bundledEnginesOf(JSON.parse(JSON.stringify(rules)))).toEqual(expected);
  });

  it("reads the engines from the rules, so they're the ones the rules allow", () => {
    const rules = declared();
    const without = {
      ...rules,
      forbidden: (rules.forbidden ?? []).filter(
        (rule) =>
          rule.name !== "engine-only-from-its-folder" || !JSON.stringify(rule).includes("gifenc"),
      ),
    };

    expect(bundledEnginesOf(without)).toEqual([
      { packages: ["@cantoo/pdf-lib"], from: "adapters/pdf" },
      { packages: ["@cantoo/pdf-lib"], from: "workers/pdf" },
    ]);
    expect(bundledEnginesOf({ ...rules, forbidden: config.forbidden })).toEqual([]);
  });

  it("reads back a package and a folder with characters that patterns escape", () => {
    const rules = defineDependencyRules({
      bundledEngines: [{ packages: ["@scope/pdf.js-dist"], from: "adapters/pdf.js" }],
    });

    expect(bundledEnginesOf(structuredClone(rules))).toEqual([
      { packages: ["@scope/pdf.js-dist"], from: "adapters/pdf.js" },
    ]);
  });

  it("says a package bundles none only when it was told so, and keeps saying it in a copy", async () => {
    const none = defineDependencyRules({ bundledEngines: [] });

    expect(declaresNoBundledEngines(none)).toBe(true);
    expect(declaresNoBundledEngines({ ...none })).toBe(true);
    expect(declaresNoBundledEngines(structuredClone(none))).toBe(true);
    expect(bundledEnginesOf(none)).toEqual([]);
    // Nothing said either way.
    expect(declaresNoBundledEngines(defineDependencyRules())).toBe(false);
    expect(declaresNoBundledEngines(defineDependencyRules({ virtualModules: ["virtual:x"] }))).toBe(
      false,
    );
    expect(declaresNoBundledEngines(config)).toBe(false);
    expect(declaresNoBundledEngines(declared())).toBe(false);
    expect(declaresNoBundledEngines(undefined)).toBe(false);
    // The rule that says so matches nothing: the same violations as the preset's.
    expect(await cruised(none)).toEqual(await cruised(config));
  });

  it("doesn't change the preset it builds on", () => {
    const before = JSON.stringify(config);
    declared();
    expect(JSON.stringify(config)).toBe(before);
  });

  it.each([
    [
      "a folder outside adapters and workers",
      { packages: ["gifenc"], from: "core/model" },
      /below src\/adapters\/ or src\/workers\//,
    ],
    [
      "a folder with a pattern",
      { packages: ["gifenc"], from: "adapters/.*" },
      /below src\/adapters\//,
    ],
    [
      "a folder that climbs out",
      { packages: ["gifenc"], from: "adapters/../core" },
      /below src\/adapters\//,
    ],
    ["no folder", { packages: ["gifenc"] }, /below src\/adapters\//],
    [
      "a package written as a pattern",
      { packages: ["gif.*"], from: "adapters/gif" },
      /isn't an npm package name/,
    ],
    [
      "a package path",
      { packages: ["gifenc/dist"], from: "adapters/gif" },
      /isn't an npm package name/,
    ],
    ["no packages", { packages: [], from: "adapters/gif" }, /at least one package/],
    ["packages that aren't a list", { packages: "gifenc", from: "adapters/gif" }, /list of names/],
  ])("refuses %s", (_label, entry, message) => {
    expect(() => defineDependencyRules({ bundledEngines: [/** @type {never} */ (entry)] })).toThrow(
      TypeError,
    );
    expect(() => defineDependencyRules({ bundledEngines: [/** @type {never} */ (entry)] })).toThrow(
      message,
    );
  });

  it("refuses lists that aren't lists", () => {
    expect(() => defineDependencyRules({ bundledEngines: /** @type {never} */ ({}) })).toThrow(
      TypeError,
    );
    expect(() =>
      defineDependencyRules({ virtualModules: /** @type {never} */ ("virtual:x") }),
    ).toThrow(TypeError);
    expect(() => defineDependencyRules({ virtualModules: [""] })).toThrow(TypeError);
  });

  it("matches a virtual module's name exactly, not as a pattern", () => {
    const rule = defineDependencyRules({ virtualModules: ["virtual:a.b"] }).forbidden?.find(
      ({ name }) => name === "not-to-unresolvable",
    );
    const { to } = /** @type {{ to: { pathNot?: string | string[] } }} */ (rule ?? { to: {} });
    const patterns = [to.pathNot ?? []].flat().map((pattern) => new RegExp(pattern));
    const allowed = (/** @type {string} */ path) => patterns.some((pattern) => pattern.test(path));

    expect(allowed("virtual:a.b")).toBe(true);
    expect(allowed("virtual:aXb")).toBe(false);
    expect(allowed("virtual:a.b.c")).toBe(false);
    expect(allowed("x-virtual:a.b")).toBe(false);
  });
});
