// Tests .github/workflows/verify.yml's draft switch (ADR 0068): a draft pull
// request runs Chromium only, read from the pull request when the run starts,
// and the required `verify` check fails on that run, so only a full run on a
// ready pull request can pass it.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * Runs the `affected` job's draft step with a stand-in `gh` that prints this
 * answer, and returns what the step wrote to its outputs.
 */
function browsers(answer) {
  const step = workflow.jobs.affected.steps.find((each) => each.id === "browsers");
  const dir = mkdtempSync(join(tmpdir(), "verify-workflow-"));
  try {
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`);
    chmodSync(gh, 0o755);
    const outputs = join(dir, "outputs");
    writeFileSync(outputs, "");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: outputs,
        NUMBER: "1",
        REPOSITORY: "owner/repository",
      },
    });
    return { code: result.status, outputs: readFileSync(outputs, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  it("narrows the browsers from the pull request's live draft state, and from nothing else", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, as the workflow has it.
    const fromAffected = "${{ needs.affected.outputs.browsers }}";
    expect(workflow.env?.HM_BROWSERS).toBeUndefined();
    expect(workflow.jobs.affected.outputs.browsers).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, as the workflow has it.
      "${{ steps.browsers.outputs.browsers }}",
    );
    expect(workflow.jobs.affected.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
    // The package jobs and the required check read the same value; no job
    // sets one of its own, which would bypass the check below.
    expect(workflow.jobs.package.env.HM_BROWSERS).toBe(fromAffected);
    expect(workflow.jobs.verify.steps[0].env.HM_BROWSERS).toBe(fromAffected);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "package") expect(job.env?.HM_BROWSERS, name).toBeUndefined();
    }
  });

  it("reads Chromium for a draft, every engine for a ready pull request, and fails when unsure", () => {
    expect(browsers("true")).toEqual({ code: 0, outputs: "browsers=chromium\n" });
    expect(browsers("false")).toEqual({ code: 0, outputs: "" });
    expect(browsers("null").code).toBe(1);
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
