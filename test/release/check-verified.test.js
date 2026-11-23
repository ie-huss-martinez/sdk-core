// Tests the decision in .github/release/check-verified.mjs: whether a
// release's packages were verified on its commit (ADR 0023, ADR 0064).
import { describe, expect, it } from "vitest";
import { plannedNames, verification } from "../../.github/release/check-verified.mjs";

const done = (packages, conclusion = "success") => ({ status: "completed", conclusion, packages });
const running = (packages = []) => ({ status: "in_progress", conclusion: null, packages });

describe("verification", () => {
  it("is verified when a successful run ran every planned package", () => {
    expect(verification([done(["pdf-sdk", "ui"])], ["ui", "pdf-sdk"])).toEqual({
      state: "verified",
      missing: [],
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
    });
  });

  it("doesn't count a cancelled run", () => {
    expect(verification([done(["ui"], "cancelled")], ["ui"]).state).toBe("missing");
  });

  it("waits while a run on the commit is still going", () => {
    expect(verification([done(["ui"]), running()], ["pdf-sdk", "ui"])).toEqual({
      state: "waiting",
      missing: ["pdf-sdk"],
    });
  });

  it("names what's missing when every run has finished without it", () => {
    expect(verification([done(["ui"])], ["video-sdk", "pdf-sdk", "ui"])).toEqual({
      state: "missing",
      missing: ["pdf-sdk", "video-sdk"],
    });
  });

  it("is missing when there's no run at all", () => {
    expect(verification([], ["ui"]).state).toBe("missing");
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
