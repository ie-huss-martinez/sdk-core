import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PRESET = fileURLToPath(new URL("../../biome/base.jsonc", import.meta.url));
const BIOME = fileURLToPath(new URL("../../node_modules/.bin/biome", import.meta.url));

/** @type {string} */
let project;

/**
 * Lints TypeScript with the preset, in a project that extends it the way a
 * consuming repository does, and returns the diagnostic categories.
 *
 * @param {string} code
 * @returns {Promise<string[]>}
 */
async function lint(code) {
  await writeFile(join(project, "probe.ts"), code);
  const { stdout } = spawnSync(BIOME, ["lint", "--reporter=json", "probe.ts"], {
    cwd: project,
    encoding: "utf8",
  });
  /** @type {{ diagnostics: Array<{ category: string }> }} */
  const report = JSON.parse(stdout);
  return report.diagnostics.map((diagnostic) => diagnostic.category);
}

beforeAll(async () => {
  project = await mkdtemp(join(tmpdir(), "hm-biome-"));
  // The preset reads .gitignore through Biome's git integration.
  execFileSync("git", ["init", "-q"], { cwd: project });
  await writeFile(join(project, ".gitignore"), "");
  await writeFile(join(project, "biome.json"), JSON.stringify({ extends: [PRESET] }));
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("Biome preset", () => {
  it("allows bracket access on index signatures, which the tsconfig preset requires", async () => {
    const code =
      'const values: Record<string, unknown> = {};\nexport const name = values["name"];\n';
    await expect(lint(code)).resolves.toEqual([]);
  });

  it("applies the preset's own rules", async () => {
    await expect(lint("export const value: any = 1;\n")).resolves.toEqual([
      "lint/suspicious/noExplicitAny",
    ]);
  });

  it("doesn't pin a Biome schema version", async () => {
    // A $schema here would be checked against each consumer's own Biome CLI,
    // so any other version would print a notice. Consumers keep their own.
    const preset = await readFile(PRESET, "utf8");

    expect(preset).not.toMatch(/"\$schema"/);
  });

  it("doesn't make Biome print a schema version notice", async () => {
    await writeFile(join(project, "probe.ts"), "export const value = 1;\n");
    const { stdout, stderr } = spawnSync(BIOME, ["lint", "probe.ts"], {
      cwd: project,
      encoding: "utf8",
    });

    expect(`${stdout}${stderr}`).not.toContain("schema version does not match");
  });
});

describe("noUncheckedAbortListener (ADR 0052)", () => {
  /**
   * The lines the rule reports in a snippet, 1-based.
   *
   * @param {string[]} lines
   * @returns {Promise<number[]>}
   */
  async function reported(lines) {
    await writeFile(join(project, "probe.ts"), `${lines.join("\n")}\n`);
    const { stdout } = spawnSync(
      BIOME,
      ["lint", "--reporter=json", "--only=lint/plugin", "probe.ts"],
      { cwd: project, encoding: "utf8" },
    );
    /** @type {{ diagnostics: Array<{ category: string, location: { start: { line: number } } }> }} */
    const report = JSON.parse(stdout);
    return report.diagnostics
      .filter((diagnostic) => diagnostic.category === "plugin")
      .map((diagnostic) => diagnostic.location.start.line);
  }

  it("reports a listener whose function never looks at the signal", async () => {
    await expect(
      reported([
        "export function declared(signal: AbortSignal, stop: () => void) {",
        '  signal.addEventListener("abort", stop);',
        "}",
        "export const arrow = (signal: AbortSignal, stop: () => void) => {",
        '  signal.addEventListener("abort", stop, { once: true });',
        "};",
        "export const expression = (signal: AbortSignal, stop: () => void) =>",
        '  signal.addEventListener("abort", stop);',
        "export const optional = (signal: AbortSignal | undefined, stop: () => void) => {",
        '  signal?.addEventListener("abort", stop);',
        "};",
        "export class Job {",
        "  run(options: { signal: AbortSignal }, stop: () => void) {",
        "    options.signal.addEventListener('abort', stop);",
        "  }",
        "}",
        "declare const outside: AbortSignal;",
        'outside.addEventListener("abort", () => undefined);',
      ]),
    ).resolves.toEqual([2, 5, 8, 10, 14, 18]);
  });

  it("reports a listener when the check is on another signal", async () => {
    await expect(
      reported([
        "export function mixed(mine: AbortSignal, theirs: AbortSignal, stop: () => void) {",
        "  if (mine.aborted) return;",
        '  theirs.addEventListener("abort", stop);',
        "}",
      ]),
    ).resolves.toEqual([3]);
  });

  it("accepts a listener whose function, or one around it, checks the same signal", async () => {
    await expect(
      reported([
        "declare function throwIfAborted(signal: AbortSignal | undefined): void;",
        "export function checked(signal: AbortSignal, stop: () => void) {",
        "  if (signal.aborted) return;",
        '  signal.addEventListener("abort", stop, { once: true });',
        "}",
        "export const optional = (signal: AbortSignal | undefined, stop: () => void) => {",
        "  if (signal?.aborted) return;",
        '  signal?.addEventListener("abort", stop);',
        "};",
        "export function thrown(signal: AbortSignal, stop: () => void) {",
        "  signal.throwIfAborted();",
        '  signal.addEventListener("abort", stop);',
        "}",
        "export function helper(signal: AbortSignal, stop: () => void) {",
        "  throwIfAborted(signal);",
        '  signal.addEventListener("abort", stop);',
        "}",
        "export function member(options: { signal: AbortSignal }, stop: () => void) {",
        "  if (options.signal.aborted) return;",
        '  options.signal.addEventListener("abort", stop);',
        "}",
        "export function around(signal: AbortSignal) {",
        "  if (signal.aborted) return Promise.resolve();",
        "  return new Promise<void>((resolve) => {",
        '    signal.addEventListener("abort", () => resolve(), { once: true });',
        "  });",
        "}",
        "export function afterwards(signal: AbortSignal, stop: () => void) {",
        '  signal.addEventListener("abort", stop, { once: true });',
        "  if (signal.aborted) stop();",
        "}",
        "export function bracket(signal: AbortSignal, stop: () => void) {",
        '  if (signal["aborted"]) return;',
        '  signal.addEventListener("abort", stop);',
        "}",
      ]),
    ).resolves.toEqual([]);
  });

  it("accepts a guarded listener inside another signal's abort handler", async () => {
    await expect(
      reported([
        "export function attach(signal: AbortSignal, other: AbortSignal, stop: () => void) {",
        "  if (other.aborted) return;",
        '  other.addEventListener("abort", () => {',
        "    if (signal.aborted) return;",
        '    signal.addEventListener("abort", stop);',
        "  });",
        "}",
      ]),
    ).resolves.toEqual([]);
  });

  it("doesn't count a check inside an abort handler, which is what never runs", async () => {
    await expect(
      reported([
        "export function inside(signal: AbortSignal, stop: () => void) {",
        '  signal.addEventListener("abort", () => {',
        "    if (signal.aborted) stop();",
        "  });",
        "}",
        "export function insideAnother(signal: AbortSignal, other: AbortSignal, stop: () => void) {",
        "  if (other.aborted) return;",
        '  other.addEventListener("abort", () => {',
        "    if (signal.aborted) stop();",
        "  });",
        '  signal.addEventListener("abort", stop);',
        "}",
        "export function both(signal: AbortSignal, stop: () => void) {",
        "  if (signal.aborted) return;",
        '  signal.addEventListener("abort", () => {',
        "    if (signal.aborted) stop();",
        "  });",
        "}",
      ]),
    ).resolves.toEqual([2, 11]);
  });

  it("leaves other events and other methods alone", async () => {
    await expect(
      reported([
        "export function other(target: EventTarget, signal: AbortSignal, stop: () => void) {",
        '  target.addEventListener("click", stop);',
        '  signal.removeEventListener("abort", stop);',
        "}",
      ]),
    ).resolves.toEqual([]);
  });

  it("can be suppressed by name, with the reason", async () => {
    await expect(
      reported([
        "export function trusted(signal: AbortSignal, stop: () => void) {",
        "  // biome-ignore lint/plugin/noUncheckedAbortListener: the caller refuses an aborted signal.",
        '  signal.addEventListener("abort", stop);',
        "}",
      ]),
    ).resolves.toEqual([]);
  });
});
