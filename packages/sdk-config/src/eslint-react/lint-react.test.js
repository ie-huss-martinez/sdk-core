import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ALWAYS_ON, defineReactLint, installMessage, loadPeer, MAY_BE_OFF } from "./index.js";
import { EXIT_FAILED, EXIT_OK, lintReact, UsageError } from "./lint-react.js";

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const PRESET = pathToFileURL(fileURLToPath(new URL("./index.js", import.meta.url))).href;

/** @type {string[]} */
const roots = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** The configuration a repository writes, with the rules it has off. */
const configured = (/** @type {string[]} */ off = []) =>
  `import { defineReactLint } from ${JSON.stringify(PRESET)};\nexport default await defineReactLint({ off: ${JSON.stringify(off)} });\n`;

/**
 * A repository: its files, by path. Inside the package, so that ESLint, the
 * plugin and the parser resolve as they do for a repository that installed
 * them.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<string>} Its folder.
 */
async function repository(files) {
  const root = await mkdtemp(join(PACKAGE, ".tmp-lint-react-"));
  roots.push(root);
  const all = {
    "package.json": '{ "type": "module" }\n',
    "eslint.config.js": configured(),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const IMPORTS =
  'import { useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";\n';

/** One component per mistake, each in a file named for the rule that reports it. */
const MISTAKES = {
  "src/refs.tsx": `${IMPORTS}export function Reads() {\n  const box = useRef<HTMLDivElement>(null);\n  const width = box.current?.offsetWidth ?? 0;\n  return <div ref={box}>{width}</div>;\n}\n`,
  "src/purity.tsx": `${IMPORTS}export function Impure() {\n  const id = Math.random();\n  return <div>{id}</div>;\n}\n`,
  "src/set-state-in-render.tsx": `${IMPORTS}export function Sets({ value }: { value: number }) {\n  const [seen, setSeen] = useState(0);\n  setSeen(value);\n  return <div>{seen}</div>;\n}\n`,
  "src/set-state-in-effect.tsx": `${IMPORTS}export function Follows({ value }: { value: number }) {\n  const [local, setLocal] = useState(value);\n  useEffect(() => setLocal(value), [value]);\n  return <div>{local}</div>;\n}\n`,
  "src/exhaustive-deps.tsx": `${IMPORTS}export function Stale({ items }: { items?: number[] }) {\n  const list = items ?? [];\n  const total = useMemo(() => list.length, [list]);\n  return <div>{total}</div>;\n}\n`,
};

/** Components that do it the family's way. */
const CLEAN = {
  "src/clean.tsx": `${IMPORTS}export function useLatest<T>(value: T) {\n  const latest = useRef(value);\n  useInsertionEffect(() => {\n    latest.current = value;\n  });\n  return latest;\n}\nexport function Clean({ onChange }: { onChange: () => void }) {\n  const latest = useLatest(onChange);\n  useEffect(() => latest.current(), [latest]);\n  return <button type="button" onClick={() => latest.current()} />;\n}\n`,
};

/** The rules that reported, by file, from a run's report. */
function reportedRules(/** @type {string} */ report) {
  return [...report.matchAll(/react-hooks\/([\w-]+)/g)].map(([, rule]) => rule).sort();
}

describe("defineReactLint", () => {
  it("turns every rule of the plugin's on as an error, and rules-of-hooks off for Biome", async () => {
    const [, config] = await defineReactLint();

    const expected = Object.fromEntries(
      [...ALWAYS_ON, ...MAY_BE_OFF].map((name) => [`react-hooks/${name}`, "error"]),
    );
    expect(config?.rules).toEqual({ "react-hooks/rules-of-hooks": "off", ...expected });
    expect(Object.values(config?.rules ?? {})).not.toContain("warn");
    expect(config?.linterOptions).toEqual({
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    });
    expect(config?.files).toEqual(["src/**/*.{ts,tsx,mts,cts}"]);
  });

  it("covers every rule the plugin recommends, so a new one in a later version is noticed", async () => {
    const { default: plugin } = await import("eslint-plugin-react-hooks");
    const recommended = Object.keys(plugin.configs.flat["recommended-latest"].rules)
      .map((name) => name.replace("react-hooks/", ""))
      .sort();

    expect([...ALWAYS_ON, ...MAY_BE_OFF, "rules-of-hooks"].sort()).toEqual(recommended);
  });

  it("turns off only the rules a repository names, and never sets one to warn", async () => {
    const [, config] = await defineReactLint({ off: ["refs", "exhaustive-deps"] });

    expect(config?.rules?.["react-hooks/refs"]).toBe("off");
    expect(config?.rules?.["react-hooks/exhaustive-deps"]).toBe("off");
    expect(config?.rules?.["react-hooks/immutability"]).toBe("error");
    expect(config?.rules?.["react-hooks/purity"]).toBe("error");
    expect(Object.values(config?.rules ?? {})).not.toContain("warn");
  });

  it.each([
    ["a rule that's always on", "purity", /can't be turned off/],
    ["Biome's rule", "rules-of-hooks", /can't be turned off/],
    ["a rule with its prefix", "react-hooks/refs", /without the react-hooks\/ prefix/],
    ["a rule that doesn't exist", "no-such-rule", /isn't a rule that can be turned off/],
  ])("refuses to turn off %s", async (_label, name, message) => {
    await expect(defineReactLint({ off: [name] })).rejects.toThrow(TypeError);
    await expect(defineReactLint({ off: [name] })).rejects.toThrow(message);
  });

  it("takes a repository's own files and ignores", async () => {
    const [ignored, config] = await defineReactLint({
      files: ["packages/*/src/**/*.tsx"],
      ignores: ["**/*.stories.tsx"],
    });

    expect(config?.files).toEqual(["packages/*/src/**/*.tsx"]);
    expect(ignored?.ignores).toContain("**/*.stories.tsx");
    expect(ignored?.ignores).toContain("**/dist/**");
  });
});

describe("a missing package", () => {
  it("fails saying what to install, exactly pinned, without a stack trace", async () => {
    const failure = await loadPeer("@hussmartinez/not-installed-for-this-test").catch(
      (error) => error,
    );

    expect(failure.message).toBe(installMessage("@hussmartinez/not-installed-for-this-test"));
    expect(failure.message).toContain(
      "pnpm add --save-dev --save-exact eslint eslint-plugin-react-hooks @typescript-eslint/parser",
    );
    expect(failure.message).toContain("sdk-core ADR 0063");
    expect(failure.stack).toBe(`Error: ${failure.message}`);
  });
});

describe("lintReact", () => {
  it("reports each render-time mistake by its rule, and passes the family's own patterns", async () => {
    const root = await repository({ ...MISTAKES, ...CLEAN });

    const { exitCode, report } = await lintReact({ cwd: root });

    expect(exitCode).toBe(EXIT_FAILED);
    expect([...new Set(reportedRules(report))]).toEqual([
      "exhaustive-deps",
      "purity",
      "refs",
      "set-state-in-effect",
      "set-state-in-render",
    ]);
    expect(report).not.toContain("clean.tsx");
    for (const file of Object.keys(MISTAKES)) {
      expect(report).toContain(file.replace("src/", ""));
    }
  });

  it("passes, saying how many files it read, when nothing is reported", async () => {
    const root = await repository(CLEAN);

    expect(await lintReact({ cwd: root })).toEqual({
      exitCode: EXIT_OK,
      report: "React lint: nothing reported in 1 file.\n",
    });
  });

  it("doesn't report a rule the repository has off, and still reports the rest", async () => {
    const root = await repository({
      ...MISTAKES,
      "eslint.config.js": configured(["refs", "set-state-in-effect", "exhaustive-deps"]),
    });

    const { exitCode, report } = await lintReact({ cwd: root });

    expect(exitCode).toBe(EXIT_FAILED);
    expect([...new Set(reportedRules(report))]).toEqual(["purity", "set-state-in-render"]);
  });

  it("accepts a suppression that says why, and refuses one that doesn't", async () => {
    const suppressed = (/** @type {string} */ reason) =>
      `${IMPORTS}export function Impure() {\n  // eslint-disable-next-line react-hooks/purity${reason}\n  const id = Math.random();\n  return <div>{id}</div>;\n}\n`;
    const explained = await repository({
      "src/a.tsx": suppressed(" -- a throwaway id for a demo, never rendered twice"),
    });
    const bare = await repository({ "src/a.tsx": suppressed("") });

    expect((await lintReact({ cwd: explained })).exitCode).toBe(EXIT_OK);
    const refused = await lintReact({ cwd: bare });
    expect(refused.exitCode).toBe(EXIT_FAILED);
    expect(refused.report).toContain("react-hooks/purity is suppressed without a reason.");
    expect(refused.report).toContain('End the comment with "-- <reason>".');
  });

  it("reports a suppression that suppresses nothing", async () => {
    const root = await repository({
      "src/a.tsx": `${IMPORTS}export function Fine() {\n  // eslint-disable-next-line react-hooks/purity -- left behind after a fix\n  const id = 1;\n  return <div>{id}</div>;\n}\n`,
    });

    const { exitCode, report } = await lintReact({ cwd: root });

    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toMatch(/Unused eslint-disable directive/);
  });

  it("leaves a hook called in a condition to Biome", async () => {
    const root = await repository({
      "src/a.tsx": `${IMPORTS}export function Conditional({ on }: { on: boolean }) {\n  if (on) {\n    useEffect(() => {}, []);\n  }\n  return null;\n}\n`,
    });

    expect(reportedRules((await lintReact({ cwd: root })).report)).not.toContain("rules-of-hooks");
  });

  it("leaves out what never ships: fixtures, tests and stories", async () => {
    // A test's own component hands a value out through a variable, which
    // the plugin's globals rule reports in a published component.
    const handsOut = `${IMPORTS}let seen: number | undefined;\nexport function Probe({ value }: { value: number }) {\n  seen = value;\n  return <div>{seen}</div>;\n}\n`;
    const root = await repository({
      "src/fixtures/bad.tsx": MISTAKES["src/purity.tsx"],
      "src/Editor.test.tsx": handsOut,
      "src/Editor.browser.test.tsx": handsOut,
      "src/Editor.stories.tsx": handsOut,
      "src/clean.tsx": CLEAN["src/clean.tsx"],
    });

    expect(await lintReact({ cwd: root })).toEqual({
      exitCode: EXIT_OK,
      report: "React lint: nothing reported in 1 file.\n",
    });
  });

  it("reports the same component when it's published source", async () => {
    const root = await repository({
      "src/Probe.tsx": `${IMPORTS}let seen: number | undefined;\nexport function Probe({ value }: { value: number }) {\n  seen = value;\n  return <div>{seen}</div>;\n}\n`,
    });

    const { exitCode, report } = await lintReact({ cwd: root });

    expect(exitCode).toBe(EXIT_FAILED);
    expect(reportedRules(report)).toContain("globals");
  });

  it("refuses a comment that configures a rule for its file, which nothing would report", async () => {
    const configured = (/** @type {string} */ comment) =>
      `${comment}\n${IMPORTS}export function Impure() {\n  const id = Math.random();\n  return <div>{id}</div>;\n}\n`;
    const off = await repository({
      "src/a.tsx": configured('/* eslint react-hooks/purity: "off" */'),
    });
    const env = await repository({ "src/a.tsx": configured("/* eslint-env browser */") });

    const refused = await lintReact({ cwd: off });
    expect(refused.exitCode).toBe(EXIT_FAILED);
    expect(refused.report).toContain(
      "a.tsx:1  A comment that configures ESLint's rules isn't allowed.",
    );
    expect(refused.report).toContain("defineReactLint's off list");
    expect((await lintReact({ cwd: env })).report).toContain("isn't allowed");
  });

  it("refuses a path it's given that isn't there, or holds nothing it reads", async () => {
    const root = await repository({ ...CLEAN, "docs/notes.md": "# Notes\n" });

    await expect(lintReact({ cwd: root, paths: ["src/componets"] })).rejects.toThrow(
      /src\/componets doesn't exist, so nothing would be linted/,
    );
    await expect(lintReact({ cwd: root, paths: ["docs"] })).rejects.toThrow(UsageError);
    await expect(lintReact({ cwd: root, paths: ["docs"] })).rejects.toThrow(
      /No file under docs is one the React lint reads/,
    );
    expect((await lintReact({ cwd: root, paths: ["src"] })).exitCode).toBe(EXIT_OK);
  });

  it("passes with no src to read, by default, as a repository without React source does", async () => {
    const root = await repository({});

    expect(await lintReact({ cwd: root })).toEqual({
      exitCode: EXIT_OK,
      report: "React lint: nothing reported in 0 files.\n",
    });
  });

  it("refuses a repository without the configuration, saying what to write", async () => {
    const root = await mkdtemp(join(PACKAGE, ".tmp-lint-react-"));
    roots.push(root);

    await expect(lintReact({ cwd: root })).rejects.toThrow(UsageError);
    await expect(lintReact({ cwd: root })).rejects.toThrow(/defineReactLint/);
  });
});

describe("hm-lint-react", () => {
  /**
   * @param {string} cwd
   * @param {string[]} [args]
   */
  const run = (cwd, args = []) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

  it("exits 0 on stdout when nothing is reported", async () => {
    const result = run(await repository(CLEAN));

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("React lint: nothing reported in 1 file.\n");
    expect(result.status).toBe(0);
  });

  it("exits 1 on stderr when a rule reports", async () => {
    const result = run(await repository({ "src/purity.tsx": MISTAKES["src/purity.tsx"] }));

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("react-hooks/purity");
  });

  it("lints the paths it's given, with another configuration file", async () => {
    const root = await repository({
      "config/react.js": configured(),
      "eslint.config.js": "throw new Error('not this one');\n",
      "src/purity.tsx": MISTAKES["src/purity.tsx"],
      "src/clean/clean.tsx": CLEAN["src/clean.tsx"],
    });

    expect(run(root, ["--config", "config/react.js", "src/clean"]).status).toBe(0);
    expect(run(root, ["--config", "config/react.js", "src"]).status).toBe(1);
  });

  it("exits 2 without a stack trace for a missing configuration or an unknown option", async () => {
    const root = await mkdtemp(join(PACKAGE, ".tmp-lint-react-"));
    roots.push(root);

    const missing = run(root);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/^hm-lint-react: eslint\.config\.js doesn't exist\./);
    expect(missing.stderr).not.toMatch(/\n\s+at /);

    const unknown = run(root, ["--nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("Usage: hm-lint-react");
  });

  it("prints its usage", async () => {
    const result = run(PACKAGE, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: hm-lint-react [--config <file>] [<path>...]");
  });
});
