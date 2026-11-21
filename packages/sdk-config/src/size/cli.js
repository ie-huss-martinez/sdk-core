#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  exportCosts,
  formatKilobytes,
  importCost,
  keptCode,
  measureEntry,
  UsageError,
} from "./index.js";

const USAGE = `Usage: hm-size <entry>...
       hm-size --exports <entry>
       hm-size --import <clause> [--kept] <entry>

Prints sizes of built entry points, such as dist/index.js. It's information
for a pull request's table and for finding what an import costs. It's never
a budget, and it never fails because of a size. Run it after a build.

Without options, for each entry: its size as its budget counts it (the entry
with the chunks it loads statically, compressed with brotli), and the same
files minified (sdk-core ADR 0055).

Options (sdk-core ADR 0056):
  -e, --exports         what each export of the entry costs an application
                        that imports only it, cheapest first: bundled and
                        minified, without react, react-dom, the family's
                        packages and lazy chunks, compressed with brotli.
                        The first line is the entry's floor
  -i, --import <clause> what one import costs, such as "{ Button, Dialog }"
  -k, --kept            with --import: what the import keeps in its bundle,
                        the functions and the top-level calls that hold code
  -h, --help            show this help

Exit codes:
  0  the entries were measured
  2  usage error, or an entry that isn't built
`;

/** @returns {{ exports: boolean, import: string | undefined, kept: boolean, help: boolean, entries: string[] }} */
function parseCommandLine() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        exports: { type: "boolean", short: "e", default: false },
        import: { type: "string", short: "i" },
        kept: { type: "boolean", short: "k", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (values.exports && values.import !== undefined) {
      throw new Error("Give --exports or --import, not both.");
    }
    if (values.kept && values.import === undefined) {
      throw new Error("--kept needs --import.");
    }
    if ((values.exports || values.import !== undefined) && positionals.length !== 1) {
      throw new Error("Give one entry with --exports or --import.");
    }
    return {
      exports: values.exports,
      import: values.import,
      kept: values.kept,
      help: values.help,
      entries: positionals,
    };
  } catch (error) {
    process.stderr.write(`hm-size: ${error instanceof Error ? error.message : error}\n\n${USAGE}`);
    process.exit(2);
  }
}

const args = parseCommandLine();
if (args.help || args.entries.length === 0) {
  (args.help ? process.stdout : process.stderr).write(USAGE);
  process.exit(args.help ? 0 : 2);
}
const [entry = ""] = args.entries;
try {
  if (args.exports) {
    const costs = await exportCosts(entry);
    const width = Math.max(...costs.map(({ name }) => name.length), 0);
    for (const { name, size } of costs) {
      process.stdout.write(`${name.padEnd(width)}  ${formatKilobytes(size)}\n`);
    }
    const floor = costs[0];
    if (floor !== undefined) {
      process.stdout.write(
        `${entry}: ${costs.length} exports; the floor is ${floor.name}, ${formatKilobytes(floor.size)}\n`,
      );
    }
  } else if (args.import !== undefined) {
    const { size } = await importCost(entry, args.import);
    process.stdout.write(`${entry}: import ${args.import} ships ${formatKilobytes(size)}\n`);
    if (args.kept) {
      const { functions, calls } = await keptCode(entry, args.import);
      process.stdout.write(`It keeps ${functions} function${functions === 1 ? "" : "s"}`);
      process.stdout.write(
        calls.length === 0
          ? ", and no top-level call.\n"
          : `, and these top-level calls:\n${calls.map(({ call, count }) => `  ${String(count).padStart(3)} × ${call}(…)\n`).join("")}`,
      );
    }
  } else {
    for (const each of args.entries) {
      const { files, built, minified } = await measureEntry(each);
      const less = built === 0 ? 0 : Math.round((1 - minified / built) * 100);
      process.stdout.write(
        `${each}: ${formatKilobytes(built)} as built, ${formatKilobytes(minified)} minified (${less}% less), in ${files.length} file${files.length === 1 ? "" : "s"}\n`,
      );
    }
  }
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-size: ${error.message}\n`);
  process.exitCode = 2;
}
