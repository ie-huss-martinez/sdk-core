import { existsSync, readFileSync } from "node:fs";
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
const INLINE_CONFIGURATION = /\/\*\s*eslint(?:-env)?\s+[^-\s]/;

/**
 * @typedef {object} LintReactOptions
 * @property {string[]} [paths] Files and folders to lint, relative to `cwd`.
 *   Defaults to `src`. A path given here must exist and hold a file the
 *   lint reads.
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
    throw new UsageError(
      `No file under ${targets.join(", ")} is one the React lint reads, so nothing would be linted.`,
    );
  }

  /** @type {string[]} */
  const unexplained = [];
  for (const result of results) {
    // A comment such as `/* eslint react-hooks/purity: "off" */` changes a
    // rule for its file before the rule runs, so nothing is reported and
    // nothing counts as suppressed. Rules change in one place, the `off`
    // list, with the backlog item beside it.
    const source = result.source ?? readFileSync(result.filePath, "utf8");
    for (const [index, text] of source.split("\n").entries()) {
      if (INLINE_CONFIGURATION.test(text)) {
        unexplained.push(
          `${result.filePath}:${index + 1}  A comment that configures ESLint's rules isn't allowed. Turn a rule off in defineReactLint's off list, or suppress one report with "eslint-disable-next-line <rule> -- <reason>".`,
        );
      }
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
