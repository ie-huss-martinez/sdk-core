import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadPeer } from "./index.js";

/** Exit code when nothing is reported. */
export const EXIT_OK = 0;
/** Exit code when a rule reports, or a suppression doesn't say why. */
export const EXIT_FAILED = 1;
/** Exit code for usage errors, a missing configuration, or a missing package. */
export const EXIT_USAGE = 2;

/**
 * An error the user can fix, reported as a message without a stack trace.
 */
export class UsageError extends Error {
  /** @override */
  name = "UsageError";
}

/**
 * A comment that sets rules for its file, `/* eslint rule: "off" *\/` or
 * `/* eslint-env … *\/`, as opposed to `eslint-disable` and `eslint-enable`,
 * which suppress reports and say why.
 */
const INLINE_CONFIGURATION = /^\s*eslint(?:-env)?\s+[^-\s]/;

/**
 * The lines of a file's comments that configure ESLint's rules. It reads the
 * file's comments as the parser finds them, as ESLint does, so the same text
 * inside a string isn't one.
 *
 * @param {{ parse(code: string, options: object): { comments?: Array<{ type: string, value: string, loc: { start: { line: number } } }> } }} parser
 * @param {import("eslint").ESLint.LintResult} result
 * @returns {number[]}
 */
function configurationComments(parser, result) {
  const source = result.source ?? readFileSync(result.filePath, "utf8");
  if (!source.includes("eslint")) {
    return [];
  }
  /** @type {Array<{ type: string, value: string, loc: { start: { line: number } } }>} */
  let comments;
  try {
    comments =
      parser.parse(source, {
        comment: true,
        loc: true,
        // The family's source is ES modules.
        sourceType: "module",
        ecmaFeatures: { jsx: /\.[cm]?[jt]sx$/.test(result.filePath) },
        filePath: result.filePath,
      }).comments ?? [];
  } catch {
    // A file that doesn't parse is already reported by ESLint itself.
    return [];
  }
  return comments
    .filter(({ type, value }) => type === "Block" && INLINE_CONFIGURATION.test(value))
    .map(({ loc }) => loc.start.line);
}

/**
 * @typedef {object} LintReactOptions
 * @property {string[]} [paths] Files and folders to lint, relative to `cwd`.
 *   Defaults to `src`. A path given here must exist. A file the
 *   configuration leaves out, such as a test, is skipped; a folder must
 *   hold a file the lint reads.
 * @property {string} [cwd] Working directory. Defaults to `process.cwd()`.
 * @property {string} [configFile] The ESLint configuration. Defaults to
 *   `eslint.config.js`.
 */

/**
 * @typedef {object} LintReactResult
 * @property {number} exitCode {@link EXIT_OK} or {@link EXIT_FAILED}.
 * @property {string} report What to print.
 */

/**
 * Runs ESLint with the repository's configuration, which comes from
 * `defineReactLint` (sdk-core ADR 0063). It fails on any report, and on a
 * suppression that doesn't say why: every `eslint-disable` comment ends with
 * `-- <reason>`.
 *
 * @param {LintReactOptions} [options]
 * @returns {Promise<LintReactResult>}
 * @throws {UsageError} If the configuration is missing, ESLint isn't
 *   installed, or a path that was given holds nothing to lint.
 */
export async function lintReact({
  paths,
  cwd = process.cwd(),
  configFile = "eslint.config.js",
} = {}) {
  // A path the caller names must be there: a misspelt one would otherwise
  // lint nothing and pass. The default, `src`, may be empty or missing.
  for (const path of paths ?? []) {
    if (!existsSync(resolve(cwd, path))) {
      throw new UsageError(`${path} doesn't exist, so nothing would be linted.`);
    }
  }
  const given = paths !== undefined && paths.length > 0;
  const targets = given ? paths : ["src"];
  const config = resolve(cwd, configFile);
  if (!existsSync(config)) {
    throw new UsageError(
      `${configFile} doesn't exist. It holds the React lint's configuration:\n  import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";\n  export default await defineReactLint();`,
    );
  }
  /** @type {typeof import("eslint")} */
  let eslintModule;
  try {
    eslintModule = await loadPeer("eslint");
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const eslint = new eslintModule.ESLint({
    cwd,
    overrideConfigFile: config,
    errorOnUnmatchedPattern: false,
    // A file that's given and that the configuration leaves out is skipped,
    // not reported: a commit hook passes whatever is staged.
    warnIgnored: false,
  });
  /** @type {import("eslint").ESLint.LintResult[]} */
  let results;
  try {
    results = await eslint.lintFiles(targets);
  } catch (error) {
    throw new UsageError(
      `The React lint couldn't run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (given && results.length === 0) {
    // Files that were given, and that the lint leaves out: a test, a story,
    // a stylesheet. There's nothing to lint, and that isn't a mistake.
    if (targets.every((path) => statSync(resolve(cwd, path)).isFile())) {
      const count = targets.length;
      return {
        exitCode: EXIT_OK,
        report: `React lint: nothing to lint. The ${count === 1 ? "file" : `${count} files`} given ${count === 1 ? "isn't one" : "aren't ones"} it reads.\n`,
      };
    }
    // A folder with nothing in it to read is more likely misspelt, or the wrong one.
    throw new UsageError(
      `No file under ${targets.join(", ")} is one the React lint reads, so nothing would be linted.`,
    );
  }

  const parser = await loadPeer("@typescript-eslint/parser");
  /** @type {string[]} */
  const unexplained = [];
  for (const result of results) {
    // A comment such as `/* eslint react-hooks/purity: "off" */` changes a
    // rule for its file before the rule runs, so nothing is reported and
    // nothing counts as suppressed. Rules change in one place, the `off`
    // list, with the backlog item beside it.
    for (const line of configurationComments(parser, result)) {
      unexplained.push(
        `${result.filePath}:${line}  A comment that configures ESLint's rules isn't allowed. Turn a rule off in defineReactLint's off list, or suppress one report with "eslint-disable-next-line <rule> -- <reason>".`,
      );
    }
    for (const message of result.suppressedMessages) {
      if (message.suppressions.some(({ justification }) => justification.trim() === "")) {
        unexplained.push(
          `${result.filePath}:${message.line}:${message.column}  ${message.ruleId} is suppressed without a reason. End the comment with "-- <reason>".`,
        );
      }
    }
  }
  const reported = results.reduce(
    (count, result) => count + result.errorCount + result.warningCount,
    0,
  );
  const formatter = await eslint.loadFormatter("stylish");
  const formatted = await formatter.format(results);
  const files = results.length;
  if (reported === 0 && unexplained.length === 0) {
    return {
      exitCode: EXIT_OK,
      report: `React lint: nothing reported in ${files} ${files === 1 ? "file" : "files"}.\n`,
    };
  }
  return {
    exitCode: EXIT_FAILED,
    report: [formatted.trimEnd(), ...unexplained, ""]
      .filter((part, index) => part !== "" || index > 0)
      .join("\n"),
  };
}
