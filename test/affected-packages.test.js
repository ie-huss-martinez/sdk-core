// Tests .github/scripts/affected-packages.mjs, which picks the packages the
// verify workflow runs for a pull request (ADR 0064).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { affectedPackages, readPackages } from "../.github/scripts/affected-packages.mjs";

const packages = new Map([
  ["sdk-config", { name: "@hussmartinez/sdk-config", uses: [] }],
  ["sdk-core", { name: "@hussmartinez/sdk-core", uses: ["@hussmartinez/sdk-config"] }],
  ["ui", { name: "@hussmartinez/ui", uses: ["@hussmartinez/sdk-config"] }],
  [
    "pdf-sdk",
    {
      name: "@hussmartinez/pdf-sdk",
      uses: ["@hussmartinez/sdk-core", "@hussmartinez/ui", "@hussmartinez/sdk-config"],
    },
  ],
  [
    "ai-core",
    { name: "@hussmartinez/ai-core", uses: ["@hussmartinez/sdk-core", "@hussmartinez/sdk-config"] },
  ],
]);
const ALL = ["ai-core", "pdf-sdk", "sdk-config", "sdk-core", "ui"];

describe("affectedPackages", () => {
  it("picks the package a file is in", () => {
    expect(affectedPackages(["packages/pdf-sdk/src/index.ts"], packages)).toEqual(["pdf-sdk"]);
  });

  it("picks a package for a change in its example or its e2e suite", () => {
    expect(affectedPackages(["packages/pdf-sdk/examples/vite/src/main.ts"], packages)).toEqual([
      "pdf-sdk",
    ]);
  });

  it("adds the packages that depend on a changed one, however far", () => {
    expect(affectedPackages(["packages/ui/src/button.tsx"], packages)).toEqual(["pdf-sdk", "ui"]);
    expect(affectedPackages(["packages/sdk-core/src/index.ts"], packages)).toEqual([
      "ai-core",
      "pdf-sdk",
      "sdk-core",
    ]);
    expect(affectedPackages(["packages/sdk-config/src/index.js"], packages)).toEqual(ALL);
  });

  it.each([
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "biome.json",
    "ci/Dockerfile",
    ".github/workflows/verify.yml",
    ".github/scripts/affected-packages.mjs",
    "package.json",
    "packages/removed-sdk/src/index.ts",
    "packages/notes.txt",
  ])("picks every package for %s", (file) => {
    expect(affectedPackages([file], packages)).toEqual(ALL);
  });

  it.each([
    "docs/adr/0064-one-repository.md",
    "README.md",
    "STANDARDS.md",
    ".changeset/a-note.md",
    "packages/ui/docs/adr/0001-a.md",
  ])("picks nothing for %s alone", (file) => {
    expect(affectedPackages([file], packages)).toEqual([]);
  });

  it("counts a package's README, which is published", () => {
    expect(affectedPackages(["packages/ai-core/README.md"], packages)).toEqual(["ai-core"]);
  });

  it("doesn't let documentation hide another change", () => {
    expect(affectedPackages(["README.md", "packages/ai-core/src/a.ts"], packages)).toEqual([
      "ai-core",
    ]);
    expect(affectedPackages(["README.md", "biome.json"], packages)).toEqual(ALL);
  });

  it("picks nothing for no changes", () => {
    expect(affectedPackages([], packages)).toEqual([]);
  });
});

describe("readPackages", () => {
  it("reads this workspace, where every package uses sdk-config", () => {
    const real = readPackages(fileURLToPath(new URL("..", import.meta.url)));
    expect([...real.keys()].sort()).toEqual([
      "ai-core",
      "audio-sdk",
      "image-sdk",
      "learn-sdk",
      "notes-sdk",
      "pdf-sdk",
      "sdk-config",
      "sdk-core",
      "ui",
      "video-sdk",
    ]);
    expect(affectedPackages(["packages/sdk-config/src/index.js"], real)).toEqual(
      [...real.keys()].sort(),
    );
    expect(affectedPackages(["packages/ui/src/index.ts"], real)).toEqual([
      "audio-sdk",
      "image-sdk",
      "learn-sdk",
      "notes-sdk",
      "pdf-sdk",
      "ui",
      "video-sdk",
    ]);
    // notes-sdk reads and writes PDFs through pdf-sdk, so a change there reaches it.
    expect(affectedPackages(["packages/pdf-sdk/src/index.ts"], real)).toEqual([
      "notes-sdk",
      "pdf-sdk",
    ]);
  });
});
