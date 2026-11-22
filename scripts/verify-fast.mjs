#!/usr/bin/env node
// The pre-push hook's package checks (ADR 0053): each package's verify:fast,
// for the packages changed since main and the ones that depend on them (ADR
// 0064). A package is used from its built files, so those packages and what
// they depend on are built first.
//
// Usage: node scripts/verify-fast.mjs [base-ref]   (default: origin/main)

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { affectedPackages, readPackages } from "../.github/scripts/affected-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const base = git(["merge-base", process.argv[2] ?? "origin/main", "HEAD"]);
// Against the working tree, so that uncommitted changes count too.
const files = git(["diff", "--name-only", "--no-renames", base]).split("\n").filter(Boolean);
const affected = affectedPackages(files, readPackages(root));
if (affected.length === 0) {
  process.stdout.write("No package is affected by the changes since main.\n");
  process.exit(0);
}
process.stdout.write(`Affected packages: ${affected.join(", ")}\n`);

const steps = [
  // Each affected package and what it depends on, in dependency order.
  [
    ...affected.flatMap((folder) => ["--filter", `{./packages/${folder}}...`]),
    "--if-present",
    "build",
  ],
  [
    ...affected.flatMap((folder) => ["--filter", `{./packages/${folder}}`]),
    "--if-present",
    "verify:fast",
  ],
];
for (const args of steps) {
  const { status } = spawnSync("pnpm", args, { cwd: root, stdio: "inherit" });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}
