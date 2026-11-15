import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { readImage, UsageError } from "../image/run.js";
import { parseKey } from "../single-copy/check.js";

/** Exit code when Playwright is pinned to the image's version everywhere. */
export const EXIT_OK = 0;
/** Exit code when a Playwright package differs from the image, or isn't pinned exactly. */
export const EXIT_FAILED = 1;
/** Exit code for usage errors, or a repository that can't be read. */
export const EXIT_USAGE = 2;

export { UsageError };

/** The packages whose browsers and protocol must match the image's (sdk-core ADR 0025). */
export const PLAYWRIGHT_PACKAGES = Object.freeze([
  "playwright",
  "playwright-core",
  "@playwright/test",
]);

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/**
 * Finds every way a repository's Playwright can differ from its browser test
 * image's: a locked version other than the image tag's, and a specifier,
 * in the pnpm catalog or a package.json, that isn't that exact version, so
 * the next install could drift.
 *
 * @param {{ root: string }} options The repository.
 * @returns {{ exitCode: number, report: string }}
 * @throws {UsageError} When ci/Dockerfile or pnpm-lock.yaml can't be read.
 */
export function checkPlaywrightImage({ root }) {
  const image = readImage(root);
  const expected = /** @type {string} */ (/playwright:v(\d+\.\d+\.\d+)-/.exec(image)?.[1]);
  let text;
  try {
    text = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  } catch {
    throw new UsageError("pnpm-lock.yaml can't be read.");
  }
  /** @type {string[]} */
  const problems = [];
  const found = new Set();
  const specifier = (
    /** @type {string} */ name,
    /** @type {unknown} */ value,
    /** @type {string} */ where,
  ) => {
    if (
      typeof value !== "string" ||
      value.startsWith("catalog:") ||
      value.startsWith("workspace:")
    ) {
      return;
    }
    found.add(name);
    if (value !== expected) {
      problems.push(`${name} is specified as ${value} in ${where}; pin it exactly to ${expected}.`);
    }
  };
  for (const document of parseAllDocuments(text)) {
    if (document.errors.length > 0) {
      throw new UsageError(`pnpm-lock.yaml isn't valid YAML: ${document.errors[0]?.message}`);
    }
    const lockfile = /** @type {Record<string, any> | null} */ (document.toJS());
    if (!lockfile || typeof lockfile !== "object") {
      continue;
    }
    for (const [catalog, entries] of Object.entries(lockfile["catalogs"] ?? {})) {
      for (const name of PLAYWRIGHT_PACKAGES) {
        specifier(name, entries?.[name]?.specifier, `the ${catalog} catalog`);
      }
    }
    for (const [path, importer] of Object.entries(lockfile["importers"] ?? {})) {
      for (const field of DEPENDENCY_FIELDS) {
        for (const name of PLAYWRIGHT_PACKAGES) {
          specifier(
            name,
            importer?.[field]?.[name]?.specifier,
            `${path === "." ? "" : `${path}/`}package.json`,
          );
        }
      }
    }
    for (const key of Object.keys(lockfile["packages"] ?? {})) {
      const parsed = parseKey(key);
      if (parsed && PLAYWRIGHT_PACKAGES.includes(parsed.name)) {
        found.add(parsed.name);
        if (parsed.version !== expected) {
          problems.push(
            `${parsed.name} ${parsed.version} is locked, but ci/Dockerfile's image is Playwright ${expected}.`,
          );
        }
      }
    }
  }
  const unique = [...new Set(problems)];
  if (unique.length > 0) {
    return {
      exitCode: EXIT_FAILED,
      report: `${unique.join("\n")}\nPlaywright's packages and ci/Dockerfile's image move together, in one pull request (sdk-core ADR 0025).\n`,
    };
  }
  return {
    exitCode: EXIT_OK,
    report:
      found.size === 0
        ? `No Playwright package is installed; ci/Dockerfile's image is Playwright ${expected}.\n`
        : `Playwright is pinned to ${expected}, the version of ci/Dockerfile's image.\n`,
  };
}
