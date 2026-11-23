#!/usr/bin/env node
// Waits until the Verify workflow has verified, on this commit, every package
// a release publishes, and fails if it can't have (ADR 0023, ADR 0064). The
// release then only builds and packs: the tests ran in Verify, without the
// release's permissions.
//
// A package counts as verified when a Verify run on this commit succeeded as
// a whole and ran that package's job. A push to main verifies the packages it
// changed, which include every package its version pull request releases.
// When none did, such as for a release left pending from an earlier commit, a
// Verify run started by hand on main verifies every package on main's commit.
//
// Usage: node .github/release/check-verified.mjs <publish-plan.json>
// It uses `gh`, with GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA from the
// workflow. VERIFIED_TIMEOUT_MS, VERIFIED_POLL_MS and VERIFIED_GRACE_MS change
// how long it waits, how often it looks, and how long it waits for a Verify
// run to appear at all.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readPackages } from "../scripts/affected-packages.mjs";

/** A package's job in verify.yml is named after its folder. */
const PACKAGE_JOB = /^package \(([a-z0-9-]+)\)$/;

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

/**
 * @typedef {{ status: string, conclusion: string | null, packages: string[] }} VerifyRun
 *   A Verify run on the commit, with the folders whose package job succeeded.
 */

/**
 * Whether the planned packages are verified on this commit, may still be, or
 * can't be without another Verify run. Release and Verify start on the same
 * push independently, so while `early` is true, no run at all means Verify
 * hasn't shown up yet, not that it won't.
 *
 * @param {VerifyRun[]} runs
 * @param {string[]} planned Folder names under packages/.
 * @param {{ early?: boolean }} [options]
 * @returns {{ state: "verified" | "waiting" | "missing", missing: string[], failed: boolean }}
 */
export function verification(runs, planned, { early = false } = {}) {
  const verified = new Set(
    runs
      .filter((run) => run.status === "completed" && run.conclusion === "success")
      .flatMap((run) => run.packages),
  );
  const missing = planned.filter((folder) => !verified.has(folder)).sort();
  // A run on this commit that finished without succeeding.
  const failed = runs.some((run) => run.status === "completed" && run.conclusion !== "success");
  if (missing.length === 0) {
    return { state: "verified", missing, failed };
  }
  const pending = runs.some((run) => run.status !== "completed") || (early && runs.length === 0);
  return { state: pending ? "waiting" : "missing", missing, failed };
}

/**
 * What to do when a planned package can't be verified on this commit. A
 * re-run of a workflow keeps its commit, and Verify by hand runs on main's
 * latest commit, so the advice depends on why.
 *
 * @param {string} sha
 * @param {string[]} missing
 * @param {boolean} failed
 */
export function notVerifiedMessage(sha, missing, failed) {
  const what = `No successful Verify run on ${sha} verified ${missing.join(", ")}.`;
  return failed
    ? `${what} A Verify run on this commit failed or was cancelled: re-run its failed jobs, then re-run this workflow.`
    : `${what} Verify on this commit didn't run them. Run the Verify workflow by hand on main, which verifies every package, then re-run the Release run of the commit it verified: a re-run keeps its own commit, so if main has moved past ${sha}, that's main's latest Release run, not this one.`;
}

/** @param {string[]} args */
const gh = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));

/** The Verify runs on a commit, each with its successful package jobs. */
function verifyRuns(repository, sha) {
  const { workflow_runs: runs } = gh([
    "api",
    `repos/${repository}/actions/workflows/verify.yml/runs?head_sha=${sha}&per_page=100`,
  ]);
  return runs.map((run) => {
    const jobs = gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`,
    ]).flatMap((page) => page.jobs);
    const packages = jobs
      .filter((job) => job.conclusion === "success")
      .map((job) => PACKAGE_JOB.exec(job.name)?.[1])
      .filter((folder) => folder !== undefined);
    return { status: run.status, conclusion: run.conclusion, packages };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha } = process.env;
  if (!file || !repository || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    process.stderr.write(
      "Usage: node .github/release/check-verified.mjs <publish-plan.json>, with GITHUB_REPOSITORY set and GITHUB_SHA a full commit SHA.\n",
    );
    process.exit(2);
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const folderOf = new Map([...readPackages(root)].map(([folder, { name }]) => [name, folder]));
  const planned = plannedNames(JSON.parse(readFileSync(file, "utf8"))).map((name) => {
    const folder = folderOf.get(name);
    if (!folder) {
      throw new Error(`${name} is in the publish plan, but not a folder under packages/.`);
    }
    return folder;
  });
  const timeout = Number(process.env.VERIFIED_TIMEOUT_MS ?? 60 * 60_000);
  const poll = Number(process.env.VERIFIED_POLL_MS ?? 30_000);
  // How long to wait for Verify's run to appear at all.
  const grace = Number(process.env.VERIFIED_GRACE_MS ?? 5 * 60_000);
  const start = Date.now();
  const deadline = start + timeout;
  for (;;) {
    const early = Date.now() - start < grace;
    const { state, missing, failed } = verification(verifyRuns(repository, sha), planned, {
      early,
    });
    if (state === "verified") {
      process.stdout.write(`Verify succeeded on ${sha} for ${planned.join(", ")}.\n`);
      process.exit(0);
    }
    if (state === "missing") {
      process.stdout.write(
        `::error title=Not verified::${notVerifiedMessage(sha, missing, failed)}\n`,
      );
      process.exit(1);
    }
    if (Date.now() >= deadline) {
      process.stdout.write(
        `::error title=Verify still running::Verify hasn't finished on ${sha} after ${timeout / 60_000} minutes. Re-run this workflow once it has.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`Waiting for Verify on ${sha}: ${missing.join(", ")} not verified yet.\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, poll);
  }
}
