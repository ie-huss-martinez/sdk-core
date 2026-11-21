#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkBundledEngines, EXIT_OK, EXIT_USAGE, UsageError } from "./check.js";

const USAGE = `Usage: hm-check-bundled-engines [--config <file>]

Fails when an engine the package declares with defineDependencyRules isn't an
exactly pinned devDependency (sdk-core ADR 0061): one that's missing from
devDependencies, that's also in dependencies, peerDependencies or
optionalDependencies, or whose version is a range or a tag. A "catalog:"
version counts by what the workspace's catalog gives, in pnpm-workspace.yaml.

Run it in the package's folder, where package.json is.

Options:
  -c, --config <file>  the dependency-cruiser configuration that declares the
                       engines (default: .dependency-cruiser.js)
  -h, --help           show this help

Exit codes:
  0  every declared engine is exactly pinned, or the configuration declares
     that the package bundles none: defineDependencyRules({ bundledEngines: [] })
  1  a declared engine isn't, or nothing is declared either way
  2  usage error, or a file that can't be read
`;

/**
 * @returns {{ config: string | undefined, help: boolean }}
 */
function parseCommandLine() {
  try {
    const { values } = parseArgs({
      options: {
        config: { type: "string", short: "c" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    return { config: values.config, help: values.help };
  } catch (error) {
    process.stderr.write(
      `hm-check-bundled-engines: ${error instanceof Error ? error.message : error}\n\n${USAGE}`,
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
  const { exitCode, report } = await checkBundledEngines(
    args.config === undefined ? {} : { configFile: args.config },
  );
  (exitCode === EXIT_OK ? process.stdout : process.stderr).write(report);
  process.exitCode = exitCode;
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-check-bundled-engines: ${error.message}\n`);
  process.exitCode = EXIT_USAGE;
}
