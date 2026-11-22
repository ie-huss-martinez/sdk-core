#!/usr/bin/env node
// Runs the verify of each package a release publishes, one after another,
// in the release's verify job (ADR 0023, ADR 0064). Their workspace
// dependencies are built first, as CI's package jobs do.
//
// Usage: node .github/release/verify-planned.mjs <publish-plan.json>

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The names of the packages a publish plan publishes, sorted.
 *
 * @param {{ plan: Array<Array<{ kind: string, name: string }>> }} plan
 * @returns {string[]}
 */
export function plannedNames(plan) {
  return [
    ...new Set(
      plan.plan
        .flat()
        .filter((step) => step.kind === "publish")
        .map((step) => step.name),
    ),
  ].sort();
}

/** @param {string[]} args */
function pnpm(args) {
  process.stdout.write(`$ pnpm ${args.join(" ")}\n`);
  const { status } = spawnSync("pnpm", args, { stdio: "inherit" });
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

if (import.meta.main) {
  const [file] = process.argv.slice(2);
  if (!file) {
    process.stderr.write("Usage: node .github/release/verify-planned.mjs <publish-plan.json>\n");
    process.exit(2);
  }
  const names = plannedNames(JSON.parse(readFileSync(file, "utf8")));
  if (names.length === 0) {
    process.stdout.write("The plan publishes nothing.\n");
    process.exit(0);
  }
  process.stdout.write(`Verifying ${names.join(", ")}.\n`);
  pnpm([...names.flatMap((name) => ["--filter", `${name}^...`]), "--if-present", "build"]);
  for (const name of names) {
    pnpm(["--filter", name, "verify"]);
  }
}
