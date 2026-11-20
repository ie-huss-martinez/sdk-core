#!/usr/bin/env node
import { formatKilobytes, measureEntry, UsageError } from "./entry.js";

const USAGE = `Usage: hm-size <entry>...

Prints the size of built entry points (sdk-core ADR 0055), such as
dist/index.js: each entry with the chunks it loads statically, compressed
with brotli, as its size budget counts it, and the same files minified.

The minified size is information for a pull request's table. It's never a
budget, and this command never fails because of a size. Run it after a build.

Exit codes:
  0  the entries were measured
  2  usage error, or an entry that isn't built
`;

const entries = process.argv.slice(2);
if (entries.length === 0 || entries.includes("-h") || entries.includes("--help")) {
  (entries.length === 0 ? process.stderr : process.stdout).write(USAGE);
  process.exit(entries.length === 0 ? 2 : 0);
}
try {
  for (const entry of entries) {
    const { files, built, minified } = await measureEntry(entry);
    const less = built === 0 ? 0 : Math.round((1 - minified / built) * 100);
    process.stdout.write(
      `${entry}: ${formatKilobytes(built)} as built, ${formatKilobytes(minified)} minified (${less}% less), in ${files.length} file${files.length === 1 ? "" : "s"}\n`,
    );
  }
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-size: ${error.message}\n`);
  process.exitCode = 2;
}
