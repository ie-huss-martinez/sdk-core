// A peer range states the oldest version a package supports, so it's written
// out in the package. Taken from the workspace's catalog, or from a sibling
// with workspace:, it would rise with every update there, which narrows the
// range, a breaking change under the family's 0.x rule.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packages = fileURLToPath(new URL("../packages", import.meta.url));
const manifests = readdirSync(packages, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(readFileSync(join(packages, entry.name, "package.json"), "utf8")))
  .filter((manifest) => !manifest.private);

describe("published packages' peer ranges", () => {
  it("covers every published package", () => {
    expect(manifests.length).toBeGreaterThanOrEqual(9);
  });

  it.each(manifests.map((manifest) => [manifest.name, manifest]))(
    "%s writes its peer ranges out",
    (_, manifest) => {
      const derived = Object.entries(manifest.peerDependencies ?? {}).filter(([, range]) =>
        /^(?:catalog|workspace):/.test(range),
      );
      expect(derived).toEqual([]);
    },
  );
});
