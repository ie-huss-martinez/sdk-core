// Tests .github/workflows/verify.yml's draft switch (ADR 0068): a draft pull
// request runs Chromium only, and the required `verify` check fails on that
// run, so only a full run on a ready pull request can pass it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8"),
);

/** Runs the `verify` job's script as GitHub runs it, with these results. */
function verify(env) {
  const [step] = workflow.jobs.verify.steps;
  const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      IMAGE: "success",
      AFFECTED: "success",
      ANY: "true",
      REPOSITORY: "success",
      PACKAGES: "success",
      HM_BROWSERS: "",
      ...env,
    },
  });
  return { code: result.status, output: result.stdout + result.stderr };
}

describe("verify.yml on a draft pull request", () => {
  it("runs again, in full, when a draft is marked ready", () => {
    expect(workflow.on.pull_request.types).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
    ]);
  });

  it("narrows the browsers from the event's draft flag, and from nothing else", () => {
    expect(workflow.env).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, as the workflow has it.
      HM_BROWSERS: "${{ github.event.pull_request.draft && 'chromium' || '' }}",
    });
    // No job sets its own, which would bypass the check below.
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.env?.HM_BROWSERS, name).toBeUndefined();
    }
  });

  it("passes the required check on a full run", () => {
    expect(verify({}).code).toBe(0);
    expect(verify({ ANY: "false", PACKAGES: "skipped" }).code).toBe(0);
  });

  it("fails the required check on a draft's Chromium-only run, even when every job passed", () => {
    const run = verify({ HM_BROWSERS: "chromium" });
    expect(run.code).toBe(1);
    expect(run.output).toContain("Mark the pull request ready for review");
    expect(verify({ HM_BROWSERS: "chromium", ANY: "false", PACKAGES: "skipped" }).code).toBe(1);
  });

  it("still fails when a job failed", () => {
    expect(verify({ PACKAGES: "failure" }).code).toBe(1);
    expect(verify({ REPOSITORY: "cancelled" }).code).toBe(1);
  });
});
