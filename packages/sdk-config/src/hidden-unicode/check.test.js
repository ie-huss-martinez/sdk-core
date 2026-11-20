import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkHiddenUnicode,
  findHiddenCharacters,
  HIDDEN_CHARACTERS,
  readIgnoreFile,
  readText,
  UsageError,
} from "./check.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

// Every hidden character in this file is written as an escape, as the check
// itself requires of the repository.
const RLO = "\u202E";
const ZWSP = "\u200B";
const TAG_A = "\u{E0041}";

/** @type {string[]} */
const roots = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A git repository with these files, all tracked.
 *
 * @param {Record<string, string | Uint8Array>} files
 * @returns {Promise<string>}
 */
async function repository(files) {
  const root = await mkdtemp(join(tmpdir(), "hm-hidden-unicode-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

describe("findHiddenCharacters", () => {
  it("finds nothing in ordinary text, in any script", () => {
    expect(findHiddenCharacters("const name = 'résumé 文書 😀 مرحبا';\n\ttabbed\r\n")).toEqual([]);
    expect(findHiddenCharacters("")).toEqual([]);
  });

  it("reports each character with its place, code point, name and escape", () => {
    const text = `first line\nconst file = "invoice${RLO}fdp.exe";${ZWSP}\n`;

    expect(findHiddenCharacters(text)).toEqual([
      {
        line: 2,
        column: 22,
        codePoint: "U+202E",
        name: "RIGHT-TO-LEFT OVERRIDE",
        escape: "\\u202E",
      },
      { line: 2, column: 32, codePoint: "U+200B", name: "ZERO WIDTH SPACE", escape: "\\u200B" },
    ]);
  });

  it("counts columns in code points, and writes astral escapes with braces", () => {
    expect(findHiddenCharacters(`😀😀${TAG_A}`)).toEqual([
      { line: 1, column: 3, codePoint: "U+E0041", name: "TAG CHARACTER", escape: "\\u{E0041}" },
    ]);
  });

  it("reports a byte order mark, and separators that only some tools break lines at", () => {
    expect(findHiddenCharacters("\uFEFFa\u2028b\u2029c").map(({ codePoint }) => codePoint)).toEqual(
      ["U+FEFF", "U+2028", "U+2029"],
    );
  });

  it("reports every character in its table, and the whole tag block", () => {
    for (const [codePoint, name] of HIDDEN_CHARACTERS) {
      expect(findHiddenCharacters(`a${String.fromCodePoint(codePoint)}b`), name).toMatchObject([
        { column: 2, name },
      ]);
    }
    for (const codePoint of [0xe0000, 0xe0001, 0xe0020, 0xe007f]) {
      expect(findHiddenCharacters(String.fromCodePoint(codePoint))).toHaveLength(1);
    }
  });

  it("leaves visible characters next to the ranges alone", () => {
    // A no-break space, variation selector 16 (in emoji such as "❇️"), the
    // ideographic space, and the characters just outside each range.
    const visible = [
      0x00a0, 0x00ac, 0x00ae, 0x200a, 0x2010, 0x2027, 0x202f, 0x205f, 0x2065, 0x206a, 0x3000,
      0xfe0f, 0xdffff, 0xe0080,
    ];
    for (const codePoint of visible) {
      expect(findHiddenCharacters(String.fromCodePoint(codePoint)), codePoint.toString(16)).toEqual(
        [],
      );
    }
  });
});

describe("readText", () => {
  it("reads UTF-8 text, keeps a byte order mark, and skips binary files", async () => {
    const root = await repository({
      "a.txt": "plain\n",
      "bom.txt": "\uFEFFwith a mark\n",
      "image.png": Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00),
      "latin1.txt": Uint8Array.of(0x63, 0x61, 0x66, 0xe9),
    });

    expect(readText(join(root, "a.txt"))).toBe("plain\n");
    expect(readText(join(root, "bom.txt"))).toBe("\uFEFFwith a mark\n");
    expect(readText(join(root, "image.png"))).toBeUndefined();
    expect(readText(join(root, "latin1.txt"))).toBeUndefined();
  });
});

describe("checkHiddenUnicode", () => {
  it("checks every tracked text file, whatever its type", async () => {
    const root = await repository({
      "src/a.ts": `export const a = "x${ZWSP}";\n`,
      "docs/guide.md": `# Guide\n\nSee ${RLO}here.\n`,
      ".github/workflows/ci.yml": `name: ci${TAG_A}\n`,
      "src/clean.ts": "export const clean = '\\u202E';\n",
      "logo.png": Uint8Array.of(0x89, 0x50, 0x00, 0xe2, 0x80, 0xae),
    });

    expect(checkHiddenUnicode({ root })).toEqual({
      exitCode: 1,
      checked: 4,
      problems: [
        ".github/workflows/ci.yml:1:9: hidden character U+E0041 TAG CHARACTER. Write it as the escape \\u{E0041}, or remove it.",
        "docs/guide.md:3:5: hidden character U+202E RIGHT-TO-LEFT OVERRIDE. Write it as the escape \\u202E, or remove it.",
        "src/a.ts:1:20: hidden character U+200B ZERO WIDTH SPACE. Write it as the escape \\u200B, or remove it.",
      ],
    });
  });

  it("passes a repository whose hidden characters are all escapes", async () => {
    const root = await repository({
      "src/a.ts": "export const rlo = '\\u202E';\n",
      "b.md": "ok\n",
    });

    expect(checkHiddenUnicode({ root })).toEqual({ exitCode: 0, checked: 2, problems: [] });
  });

  it("leaves untracked and ignored files to git, and skips tracked files that were deleted", async () => {
    const root = await repository({ "tracked.ts": "ok\n", "gone.ts": `x${ZWSP}\n` });
    await writeFile(join(root, "untracked.ts"), `x${ZWSP}\n`);
    await rm(join(root, "gone.ts"));

    expect(checkHiddenUnicode({ root })).toEqual({ exitCode: 0, checked: 1, problems: [] });
  });

  it("skips the globs in .hm-hidden-unicode-ignore, and only those", async () => {
    const root = await repository({
      ".hm-hidden-unicode-ignore":
        "# Test data, as files arrive from users.\ntest/fixtures/**\n\n*.snap\n",
      "test/fixtures/names/rlo.txt": `invoice${RLO}fdp.exe\n`,
      "test/fixtures.ts": `x${ZWSP}\n`,
      "a.snap": `x${ZWSP}\n`,
      "src/a.snap": `x${ZWSP}\n`,
    });

    expect(readIgnoreFile(root)).toEqual(["test/fixtures/**", "*.snap"]);
    expect(checkHiddenUnicode({ root }).problems.map((problem) => problem.split(":")[0])).toEqual([
      "src/a.snap",
      "test/fixtures.ts",
    ]);
  });

  it("checks only the files it's given, absolute or relative, as lint-staged passes them", async () => {
    const root = await repository({
      "src/a.ts": `x${ZWSP}\n`,
      "src/b.ts": `y${ZWSP}\n`,
      "test/fixtures/c.txt": `z${ZWSP}\n`,
      ".hm-hidden-unicode-ignore": "test/fixtures/**\n",
    });

    const result = checkHiddenUnicode({
      root,
      files: [join(root, "src", "a.ts"), "test/fixtures/c.txt"],
    });

    expect(result.problems).toEqual([expect.stringMatching(/^src\/a\.ts:1:2: /)]);
    expect(result.checked).toBe(1);
  });

  it("refuses a file outside the repository, or one it can't read", async () => {
    const root = await repository({ "a.ts": "ok\n" });

    expect(() => checkHiddenUnicode({ root, files: [join(root, "..", "elsewhere.ts")] })).toThrow(
      UsageError,
    );
    expect(() => checkHiddenUnicode({ root, files: ["missing.ts"] })).toThrow(/Can't read/);
  });

  it("needs git to list the files when none are given", async () => {
    const root = await mkdtemp(join(tmpdir(), "hm-hidden-unicode-plain-"));
    roots.push(root);

    expect(() => checkHiddenUnicode({ root })).toThrow(UsageError);
  });
});

describe("the command", () => {
  /** @param {string[]} args @param {string} cwd */
  const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });

  it("exits 0 with a count, and 1 with each character's place", async () => {
    const clean = await repository({ "a.ts": "ok\n", "b.md": "ok\n" });
    const ok = run([], clean);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("No hidden characters in 2 text files.\n");

    const dirty = await repository({ "a.ts": `x${RLO}\n` });
    const failed = run([], dirty);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toBe(
      "a.ts:1:2: hidden character U+202E RIGHT-TO-LEFT OVERRIDE. Write it as the escape \\u202E, or remove it.\nhm-check-hidden-unicode: 1 hidden character found.\n",
    );
  });

  it("checks the files it's given, and says nothing when they're clean", async () => {
    const root = await repository({ "a.ts": "ok\n", "b.ts": `x${ZWSP}\n` });

    const ok = run(["a.ts"], root);
    expect(ok.status).toBe(0);
    expect(ok.stdout + ok.stderr).toBe("");
    expect(run([join(root, "b.ts")], root).status).toBe(1);
  });

  it("exits 2 for usage errors, and outside a repository", async () => {
    const root = await repository({ "a.ts": "ok\n" });
    const plain = await mkdtemp(join(tmpdir(), "hm-hidden-unicode-plain-"));
    roots.push(plain);

    expect(run(["--unknown"], root).status).toBe(2);
    expect(run(["missing.ts"], root).status).toBe(2);
    const outside = run([], plain);
    expect(outside.status).toBe(2);
    expect(outside.stderr).toContain("git can't list this folder's files");
  });

  it("prints its usage with --help", async () => {
    const root = await repository({ "a.ts": "ok\n" });
    const help = run(["--help"], root);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: hm-check-hidden-unicode [<file>...]");
  });
});
