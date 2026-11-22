// Tests .github/release/verify-planned.mjs, which picks the packages a
// release's verify job runs.
import { describe, expect, it } from "vitest";
import { plannedNames } from "../../.github/release/verify-planned.mjs";

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
