#!/usr/bin/env node
import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_USAGE, lintReact, UsageError } from "./lint-react.js";

const USAGE = `Usage: hm-lint-react [--config <file>] [<path>...]

Runs ESLint with React's hooks plugin and nothing else (sdk-core ADR 0063):
what a component does while it renders, and hook dependency lists. Biome
stays the linter and formatter for everything else.

It reads eslint.config.js, which comes from defineReactLint in
@hussmartinez/sdk-config/eslint-react, and lints src by default. It fails on
any report, and on an eslint-disable comment that doesn't end with a reason:
"-- <reason>".

Options:
  -c, --config <file>  the ESLint configuration (default: eslint.config.js)
  -h, --help           show this help

Exit codes:
  0  nothing reported
  1  a rule reported, or a suppression doesn't say why
  2  usage error, a missing configuration, or ESLint isn't installed
`;

/**
 * @returns {{ config: string | undefined, help: boolean, paths: string[] }}
 */
function parseCommandLine() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    return { config: values.config, help: values.help, paths: positionals };
  } catch (error) {
    process.stderr.write(
      `hm-lint-react: ${error instanceof Error ? error.message : error}\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
}

const args = parseCommandLine();
if (args.help) {
  process.stdout.write(USAGE);
  process.exit(EXIT_OK);
}
try {
  const { exitCode, report } = await lintReact({
    ...(args.paths.length > 0 ? { paths: args.paths } : {}),
    ...(args.config === undefined ? {} : { configFile: args.config }),
  });
  (exitCode === EXIT_OK ? process.stdout : process.stderr).write(report);
  process.exitCode = exitCode;
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-lint-react: ${error.message}\n`);
  process.exitCode = EXIT_USAGE;
}
