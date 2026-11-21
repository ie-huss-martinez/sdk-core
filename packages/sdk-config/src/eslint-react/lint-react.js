import { existsSync } from "node:fs";
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
 * @typedef {object} LintReactOptions
 * @property {string[]} [paths] Files and folders to lint, relative to `cwd`.
 *   Defaults to `src`.
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
 * @throws {UsageError} If the configuration is missing, or ESLint isn't
 *   installed.
 */
export async function lintReact({
  paths = ["src"],
  cwd = process.cwd(),
  configFile = "eslint.config.js",
} = {}) {
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
    results = await eslint.lintFiles(paths);
  } catch (error) {
    throw new UsageError(
      `The React lint couldn't run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /** @type {string[]} */
  const unexplained = [];
  for (const result of results) {
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
