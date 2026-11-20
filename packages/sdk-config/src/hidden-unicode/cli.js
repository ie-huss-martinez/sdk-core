#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkHiddenUnicode, EXIT_OK, EXIT_USAGE, IGNORE_FILE, UsageError } from "./check.js";

const USAGE = `Usage: hm-check-hidden-unicode [<file>...]

Fails when a text file holds a character that an editor and a diff don't
show, or that reorders the text around it (sdk-core ADR 0052): bidirectional
formatting characters, zero-width and other invisible characters, line and
paragraph separators, and tag characters. Write them as escapes, such as
\\u202E.

Without files, it checks every file git tracks. Run it from the repository's
root. Binary files are skipped.

Paths that may hold such characters, such as test fixtures, go in
${IGNORE_FILE} at the root: a glob per line, with # comments.

Options:
  -h, --help  show this help

Exit codes:
  0  no hidden characters
  1  a file has a hidden character
  2  usage error, or files that can't be read
`;

/** @returns {{ help: boolean, files: string[] }} */
function parseCommandLine() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h", default: false } },
    });
    return { help: values.help, files: positionals };
  } catch (error) {
    process.stderr.write(
      `hm-check-hidden-unicode: ${error instanceof Error ? error.message : error}\n\n${USAGE}`,
    );
    process.exit(EXIT_USAGE);
  }
}

const { help, files } = parseCommandLine();
if (help) {
  process.stdout.write(USAGE);
  process.exit(EXIT_OK);
}
try {
  const { exitCode, problems, checked } = checkHiddenUnicode({
    root: process.cwd(),
    ...(files.length > 0 ? { files } : {}),
  });
  for (const problem of problems) {
    process.stderr.write(`${problem}\n`);
  }
  if (problems.length > 0) {
    process.stderr.write(
      `hm-check-hidden-unicode: ${problems.length} hidden character${problems.length === 1 ? "" : "s"} found.\n`,
    );
  } else if (files.length === 0) {
    process.stdout.write(`No hidden characters in ${checked} text files.\n`);
  }
  process.exitCode = exitCode;
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-check-hidden-unicode: ${error.message}\n`);
  process.exitCode = EXIT_USAGE;
}
