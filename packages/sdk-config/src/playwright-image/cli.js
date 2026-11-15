#!/usr/bin/env node
import { checkPlaywrightImage, EXIT_OK, EXIT_USAGE, UsageError } from "./check.js";

const USAGE = `Usage: hm-check-playwright-image

Fails when the Playwright that pnpm-lock.yaml locks differs from the browser
test image's in ci/Dockerfile, or when playwright, playwright-core or
@playwright/test is specified, in the pnpm catalog or a package.json, as
anything but that exact version (sdk-core ADR 0025). A range lets the next
install drift to a version whose browsers the image doesn't have.

Run it from the repository's root.

Exit codes:
  0  Playwright is pinned to the image's version everywhere
  1  a version or specifier differs
  2  usage error, or a repository that can't be read
`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  process.stdout.write(USAGE);
  process.exit(EXIT_OK);
}
if (args.length > 0) {
  process.stderr.write(
    `hm-check-playwright-image: unexpected arguments: ${args.join(" ")}\n\n${USAGE}`,
  );
  process.exit(EXIT_USAGE);
}
try {
  const { exitCode, report } = checkPlaywrightImage({ root: process.cwd() });
  (exitCode === EXIT_OK ? process.stdout : process.stderr).write(report);
  process.exitCode = exitCode;
} catch (error) {
  if (!(error instanceof UsageError)) {
    throw error;
  }
  process.stderr.write(`hm-check-playwright-image: ${error.message}\n`);
  process.exitCode = EXIT_USAGE;
}
