// Tests the decision in .github/release/check-verified.mjs: whether a
// release's packages were verified on its commit (ADR 0023, ADR 0064).
import { describe, expect, it } from "vitest";
import {
  notVerifiedMessage,
  plannedNames,
  verification,
} from "../../.github/release/check-verified.mjs";

const done = (packages, conclusion = "success") => ({ status: "completed", conclusion, packages });
const running = (packages = []) => ({ status: "in_progress", conclusion: null, packages });

describe("verification", () => {
  it("is verified when a successful run ran every planned package", () => {
    expect(verification([done(["pdf-sdk", "ui"])], ["ui", "pdf-sdk"])).toEqual({
      state: "verified",
      missing: [],
      failed: false,
    });
  });

  it("adds up several successful runs on the commit", () => {
    expect(verification([done(["ui"]), done(["pdf-sdk"])], ["pdf-sdk", "ui"]).state).toBe(
      "verified",
    );
  });

  it("doesn't count a package from a run that failed as a whole", () => {
    expect(verification([done(["pdf-sdk", "ui"], "failure")], ["ui"])).toEqual({
      state: "missing",
      missing: ["ui"],
      failed: true,
    });
  });

  it("doesn't count a cancelled run", () => {
    expect(verification([done(["ui"], "cancelled")], ["ui"]).state).toBe("missing");
  });

  it("waits while a run on the commit is still going", () => {
    expect(verification([done(["ui"]), running()], ["pdf-sdk", "ui"])).toEqual({
      state: "waiting",
      missing: ["pdf-sdk"],
      failed: false,
    });
  });

  it("names what's missing when every run has finished without it", () => {
    expect(verification([done(["ui"])], ["video-sdk", "pdf-sdk", "ui"])).toEqual({
      state: "missing",
      missing: ["pdf-sdk", "video-sdk"],
      failed: false,
    });
  });

  it("is missing when there's no run at all", () => {
    expect(verification([], ["ui"]).state).toBe("missing");
  });

  it("waits for Verify to appear while it's early, since the two start independently", () => {
    expect(verification([], ["ui"], { early: true }).state).toBe("waiting");
  });

  it("doesn't wait early for a commit whose runs finished without the package", () => {
    expect(verification([done(["pdf-sdk"])], ["ui"], { early: true }).state).toBe("missing");
    expect(verification([done(["ui"], "failure")], ["ui"], { early: true }).state).toBe("missing");
  });
});

describe("notVerifiedMessage", () => {
  const sha = "a".repeat(40);

  it("says to re-run the failed Verify run, which keeps this commit", () => {
    expect(notVerifiedMessage(sha, ["ui"], true)).toContain(
      "A Verify run on this commit failed or was cancelled: re-run its failed jobs, then re-run this workflow.",
    );
  });

  it("says which Release run to re-run after a Verify by hand, since a re-run keeps its commit", () => {
    const message = notVerifiedMessage(sha, ["pdf-sdk", "ui"], false);
    expect(message).toContain(`No successful Verify run on ${sha} verified pdf-sdk, ui.`);
    expect(message).toContain(
      `re-run the Release run of the commit it verified: a re-run keeps its own commit, so if main has moved past ${sha}, that's main's latest Release run, not this one.`,
    );
  });
});

describe("plannedNames", () => {
  it("lists each published package once, sorted, and leaves out other steps", () => {
    const plan = {
      plan: [
        [
          { kind: "publish", name: "@hussmartinez/ui" },
          { kind: "tag", name: "@hussmartinez/sdk-core" },
        ],
        [
          { kind: "publish", name: "@hussmartinez/pdf-sdk" },
          { kind: "publish", name: "@hussmartinez/ui" },
        ],
      ],
    };
    expect(plannedNames(plan)).toEqual(["@hussmartinez/pdf-sdk", "@hussmartinez/ui"]);
  });

  it("is empty when nothing is published", () => {
    expect(plannedNames({ plan: [] })).toEqual([]);
  });
});
