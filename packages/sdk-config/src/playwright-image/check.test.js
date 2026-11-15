import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkPlaywrightImage, EXIT_FAILED, EXIT_OK, UsageError } from "./check.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const IMAGE = `mcr.microsoft.com/playwright:v1.65.0-noble@sha256:${"9".repeat(64)}`;

/** @type {string[]} */
const scratch = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * A lockfile as pnpm 12 writes it: the package manager's own document, then
 * the workspace's, with the catalog, an importer and the packages.
 *
 * @param {{ catalog?: string, importer?: string, locked?: string, core?: string }} [options]
 */
const lockfile = ({
  catalog = "1.65.0",
  importer = "'catalog:'",
  locked = "1.65.0",
  core = locked,
} = {}) => `---
lockfileVersion: '9.0'

importers:

  .:
    configDependencies: {}

packages: {}

snapshots: {}

---
lockfileVersion: '9.0'

catalogs:
  default:
    '@playwright/test':
      specifier: ${catalog}
      version: ${locked}

importers:

  .:
    devDependencies:
      '@playwright/test':
        specifier: ${importer}
        version: ${locked}

  e2e:
    devDependencies:
      '@axe-core/playwright':
        specifier: ^4.11.0
        version: 4.11.0(playwright-core@${core})

packages:

  '@axe-core/playwright@4.11.0':
    resolution: {integrity: sha512-x}

  '@playwright/test@${locked}':
    resolution: {integrity: sha512-x}

  playwright-core@${core}:
    resolution: {integrity: sha512-x}

  playwright@${locked}:
    resolution: {integrity: sha512-x}
`;

/** @param {{ lock?: string, dockerfile?: string }} [files] */
async function repository({ lock = lockfile(), dockerfile = `FROM ${IMAGE}\n` } = {}) {
  const root = await mkdtemp(join(tmpdir(), "hm-playwright-image-"));
  scratch.push(root);
  await mkdir(join(root, "ci"));
  await writeFile(join(root, "ci", "Dockerfile"), dockerfile);
  await writeFile(join(root, "pnpm-lock.yaml"), lock);
  return root;
}

describe("checkPlaywrightImage", () => {
  it("passes when everything is pinned exactly to the image's version", async () => {
    const { exitCode, report } = checkPlaywrightImage({ root: await repository() });
    expect(exitCode).toBe(EXIT_OK);
    expect(report).toBe("Playwright is pinned to 1.65.0, the version of ci/Dockerfile's image.\n");
  });

  it("fails when a caret range has drifted past the image, as chat-example's did", async () => {
    const root = await repository({ lock: lockfile({ catalog: "^1.65.0", locked: "1.65.1" }) });
    const { exitCode, report } = checkPlaywrightImage({ root });
    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toBe(
      [
        "@playwright/test is specified as ^1.65.0 in the default catalog; pin it exactly to 1.65.0.",
        "@playwright/test 1.65.1 is locked, but ci/Dockerfile's image is Playwright 1.65.0.",
        "playwright-core 1.65.1 is locked, but ci/Dockerfile's image is Playwright 1.65.0.",
        "playwright 1.65.1 is locked, but ci/Dockerfile's image is Playwright 1.65.0.",
        "Playwright's packages and ci/Dockerfile's image move together, in one pull request (sdk-core ADR 0025).",
        "",
      ].join("\n"),
    );
  });

  it("fails on a range that hasn't drifted yet, because the next install could", async () => {
    const root = await repository({ lock: lockfile({ importer: "^1.65.0" }) });
    const { exitCode, report } = checkPlaywrightImage({ root });
    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toContain(
      "@playwright/test is specified as ^1.65.0 in package.json; pin it exactly to 1.65.0.",
    );
  });

  it("fails when only a transitive playwright-core differs", async () => {
    const root = await repository({ lock: lockfile({ core: "1.66.0" }) });
    const { exitCode, report } = checkPlaywrightImage({ root });
    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toContain(
      "playwright-core 1.66.0 is locked, but ci/Dockerfile's image is Playwright 1.65.0.",
    );
  });

  it("fails when the image moved without the packages", async () => {
    const root = await repository({
      dockerfile: `FROM mcr.microsoft.com/playwright:v1.66.0-noble@sha256:${"9".repeat(64)}\n`,
    });
    expect(checkPlaywrightImage({ root }).exitCode).toBe(EXIT_FAILED);
  });

  it("is a usage error without a pinned image or a lockfile", async () => {
    const unpinned = await repository({
      dockerfile: "FROM mcr.microsoft.com/playwright:v1.65.0-noble\n",
    });
    expect(() => checkPlaywrightImage({ root: unpinned })).toThrow(UsageError);
    const root = await repository();
    await rm(join(root, "pnpm-lock.yaml"));
    expect(() => checkPlaywrightImage({ root })).toThrow(/pnpm-lock.yaml can't be read/);
  });
});

describe("hm-check-playwright-image", () => {
  /** @param {string} root @param {string[]} [args] */
  const run = (root, args = []) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });

  it("exits 0 with the version on stdout, and 1 with the problems on stderr", async () => {
    const pinned = run(await repository());
    expect(pinned.status).toBe(0);
    expect(pinned.stdout).toContain("pinned to 1.65.0");
    const drifted = run(await repository({ lock: lockfile({ locked: "1.65.1" }) }));
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("playwright 1.65.1 is locked");
  });

  it("exits 2 for a repository it can't read, or unexpected arguments", async () => {
    const root = await repository({ dockerfile: "# nothing\n" });
    const unreadable = run(root);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toBe(
      "hm-check-playwright-image: ci/Dockerfile must have exactly one FROM line, not 0.\n",
    );
    expect(run(await repository(), ["--fix"]).status).toBe(2);
  });
});
