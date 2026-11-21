import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import picomatch from "picomatch";
import { afterAll, describe, expect, it } from "vitest";
import config, { isReactSource, reactLintTask, withReactLint } from "./index.js";

/**
 * Lists the globs that match a staged file, with the options lint-staged
 * itself uses (`lib/matchFiles.js` in lint-staged 17), minus `posixSlashes`,
 * which only affects Windows paths.
 *
 * @param {string} file
 * @returns {string[]}
 */
function globsFor(file) {
  return Object.keys(config).filter((pattern) =>
    picomatch(pattern, {
      dot: true,
      matchBase: !pattern.includes("/"),
      strictBrackets: true,
    })(file),
  );
}

describe("lint-staged preset", () => {
  it.each([
    "packages/sdk-core/src/index.ts",
    "packages/ui/src/button/button.css",
    "styles.css",
    ".husky/pre-commit",
    ".github/workflows/verify.yml",
    "README.md",
    "LICENSE",
  ])("runs exactly one task list for %s", (file) => {
    expect(globsFor(file)).toHaveLength(1);
  });

  it("runs stylelint on CSS only", () => {
    const [css] = globsFor("src/a.css");
    const [ts] = globsFor("src/a.ts");
    expect(config[css ?? ""]?.some((command) => command.startsWith("stylelint"))).toBe(true);
    expect(config[ts ?? ""]?.some((command) => command.startsWith("stylelint"))).toBe(false);
  });

  it("scans for secrets before any tool rewrites the file", () => {
    for (const commands of Object.values(config)) {
      expect(commands[0]).toBe("secretlint --maskSecrets");
    }
  });

  it("checks every staged file for hidden characters, before Biome rewrites it", () => {
    for (const commands of Object.values(config)) {
      expect(commands[1]).toBe("hm-check-hidden-unicode");
      expect(commands.findIndex((command) => command.startsWith("biome"))).toBeGreaterThan(1);
    }
  });
});

describe("withReactLint", () => {
  it("adds the React lint after Biome, to everything but CSS, and changes nothing else", () => {
    const withLint = withReactLint();

    expect(withLint["!(*.css)"]).toEqual([...(config["!(*.css)"] ?? []), reactLintTask]);
    expect(withLint["*.css"]).toEqual(config["*.css"]);
    expect(Object.keys(withLint)).toEqual(Object.keys(config));
    const tasks = withLint["!(*.css)"] ?? [];
    expect(tasks.indexOf(reactLintTask)).toBeGreaterThan(
      tasks.findIndex((task) => typeof task === "string" && task.startsWith("biome")),
    );
  });

  it("doesn't change the preset, or a configuration it's given", () => {
    const before = JSON.stringify(config);
    const own = { "!(*.css)": ["biome check"], "*.md": ["markdownlint"] };

    const withLint = withReactLint(own);

    expect(JSON.stringify(config)).toBe(before);
    expect(own["!(*.css)"]).toEqual(["biome check"]);
    expect(withLint).toEqual({
      "!(*.css)": ["biome check", reactLintTask],
      "*.md": ["markdownlint"],
    });
  });

  it("refuses a configuration with nowhere to add the step", () => {
    expect(() => withReactLint({ "*.ts": ["biome check"] })).toThrow(TypeError);
    expect(() => withReactLint({ "*.ts": ["biome check"] })).toThrow(/"!\(\*\.css\)" list/);
  });
});

describe("the React lint's task", () => {
  it.each([
    "/repo/src/react/Editor.tsx",
    "/repo/src/index.ts",
    "/repo/packages/ui/src/components/button/Button.tsx",
    "/repo/src/workers/render.worker.mts",
    // As lint-staged gives them on Windows.
    "C:\\repo\\src\\react\\Editor.tsx",
    "C:\\Users\\A Name\\repo\\src\\react\\My Editor.tsx",
    "src/react/Editor.tsx",
  ])("runs hm-lint-react, with no file named, when %s is staged", (file) => {
    expect(isReactSource(file)).toBe(true);
    expect(reactLintTask(["/repo/README.md", file])).toEqual(["hm-lint-react"]);
  });

  it.each([
    "/repo/README.md",
    "/repo/package.json",
    "/repo/vite.config.ts",
    "/repo/e2e/editor.spec.ts",
    "/repo/src/styles.css.d.json",
    "/repo/src/messages/en.json",
    "/repo/resrc/a.ts",
  ])("runs nothing when only %s is staged", (file) => {
    expect(isReactSource(file)).toBe(false);
    expect(reactLintTask([file])).toEqual([]);
  });

  it("runs once however many source files are staged", () => {
    expect(reactLintTask(["/repo/src/a.ts", "/repo/src/b.tsx", "/repo/src/c.tsx"])).toEqual([
      "hm-lint-react",
    ]);
  });
});

describe("under lint-staged itself", () => {
  const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
  const PRESET = pathToFileURL(fileURLToPath(new URL("./index.js", import.meta.url))).href;
  const REACT_LINT = pathToFileURL(
    fileURLToPath(new URL("../eslint-react/index.js", import.meta.url)),
  ).href;
  const LINT_STAGED = join(PACKAGE, "node_modules", "lint-staged", "bin", "lint-staged.js");

  /** @type {string[]} */
  const roots = [];
  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  /**
   * Runs lint-staged in a repository with these files staged. Its
   * configuration has only the React lint's step, so no other tool has to
   * be there, and `hm-lint-react` is the real one, from this package.
   *
   * @param {Record<string, string>} staged The files, by path.
   */
  async function commit(staged) {
    // Inside the package, so lint-staged finds hm-lint-react and the lint its packages.
    const root = await mkdtemp(join(PACKAGE, ".tmp-lint-staged-"));
    roots.push(root);
    const git = (/** @type {string[]} */ ...args) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    await writeFile(
      join(root, "lint-staged.config.js"),
      `import { withReactLint } from ${JSON.stringify(PRESET)};\nexport default withReactLint({ "!(*.css)": [] });\n`,
    );
    await writeFile(
      join(root, "eslint.config.js"),
      `import { defineReactLint } from ${JSON.stringify(REACT_LINT)};\nexport default await defineReactLint();\n`,
    );
    await writeFile(join(root, "package.json"), '{ "type": "module" }\n');
    git("add", "lint-staged.config.js", "eslint.config.js", "package.json");
    git("commit", "-q", "-m", "start");
    for (const [file, content] of Object.entries(staged)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), content);
    }
    git("add", ...Object.keys(staged));
    const result = spawnSync(process.execPath, [LINT_STAGED], { cwd: root, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  const CLEAN = "export const value = 1;\n";
  const IMPURE =
    "export function Impure() {\n  const id = Math.random();\n  return <div>{id}</div>;\n}\n";

  it("runs hm-lint-react, with no file named, for a source file whose name has a space", async () => {
    const { status, output } = await commit({
      "src/react/My Editor.tsx": CLEAN,
      "src/index.ts": CLEAN,
    });

    expect(output).toContain("hm-lint-react");
    expect(output).not.toMatch(/Failed to run tasks/);
    expect(status).toBe(0);
  });

  it("fails the commit on what the lint reports, in a file that wasn't itself staged alone", async () => {
    const { status, output } = await commit({
      "src/react/My Editor.tsx": IMPURE,
      "src/Editor.test.tsx": IMPURE,
    });

    expect(status).toBe(1);
    expect(output).toContain("react-hooks/purity");
    // The test file does the same and isn't reported: the lint leaves tests out.
    expect(output).toContain("My Editor.tsx");
    expect(output).not.toContain("Editor.test.tsx");
  });

  it("doesn't run it when nothing staged is source", async () => {
    const { status, output } = await commit({
      "README.md": "# Notes\n",
      "e2e/editor.spec.ts": CLEAN,
    });

    expect(status).toBe(0);
    expect(output).not.toContain("hm-lint-react");
  });
});
