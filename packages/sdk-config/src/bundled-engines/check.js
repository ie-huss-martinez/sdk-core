import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { bundledEnginesOf } from "../dependency-cruiser/index.js";

/** Exit code when every declared engine is an exactly pinned devDependency, or none is declared. */
export const EXIT_OK = 0;
/** Exit code when a declared engine isn't. */
export const EXIT_FAILED = 1;
/** Exit code for usage errors, or a file that can't be read. */
export const EXIT_USAGE = 2;

/**
 * An error the user can fix, reported as a message without a stack trace.
 */
export class UsageError extends Error {
  /** @override */
  name = "UsageError";
}

/** One exact version, with an optional prerelease and build: no range, tag, alias or URL. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Where an application would install a package from, which a bundled engine is never in. */
const INSTALLED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/**
 * @param {string} file
 * @param {string} what
 * @returns {string}
 */
function read(file, what) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`${what} ${file} can't be read.`);
  }
}

/**
 * The catalogs of the pnpm workspace a folder is in: the nearest
 * `pnpm-workspace.yaml`, in the folder or above it.
 *
 * @param {string} folder
 * @returns {{ file: string | undefined, catalogs: Record<string, Record<string, unknown>> }}
 *   The default catalog is under `default`.
 */
export function workspaceCatalogs(folder) {
  let current = resolve(folder);
  for (;;) {
    const file = join(current, "pnpm-workspace.yaml");
    if (existsSync(file)) {
      /** @type {unknown} */
      let workspace;
      try {
        workspace = parse(read(file, "The workspace file"));
      } catch (error) {
        if (error instanceof UsageError) {
          throw error;
        }
        throw new UsageError(`The workspace file ${file} isn't valid YAML.`);
      }
      const { catalog, catalogs } = /** @type {{ catalog?: unknown, catalogs?: unknown }} */ (
        workspace ?? {}
      );
      const named = /** @type {Record<string, Record<string, unknown>>} */ (
        typeof catalogs === "object" && catalogs !== null ? catalogs : {}
      );
      return {
        file,
        catalogs: {
          ...named,
          default: {
            ...(named["default"] ?? {}),
            .../** @type {Record<string, unknown>} */ (
              typeof catalog === "object" && catalog !== null ? catalog : {}
            ),
          },
        },
      };
    }
    const parent = dirname(current);
    if (parent === current) {
      return { file: undefined, catalogs: {} };
    }
    current = parent;
  }
}

/**
 * @typedef {object} EngineProblem
 * @property {string} engine The package.
 * @property {string} problem What's wrong, as a sentence.
 */

/**
 * Finds the declared engines that aren't exactly pinned devDependencies
 * (sdk-core ADR 0061). An engine is built into the package, so applications
 * never install it: it's in `devDependencies` and nowhere else, at one exact
 * version. A `catalog:` entry counts by the version its catalog gives.
 *
 * @param {object} options
 * @param {readonly string[]} options.engines The engines' package names.
 * @param {Record<string, unknown>} options.manifest The package's `package.json`.
 * @param {Record<string, Record<string, unknown>>} [options.catalogs] The
 *   workspace's catalogs, with the default one under `default`.
 * @returns {EngineProblem[]} One per problem, in the engines' order.
 */
export function findUnpinnedEngines({ engines, manifest, catalogs = {} }) {
  /** @param {string} field */
  const field = (field) =>
    /** @type {Record<string, unknown>} */ (
      typeof manifest[field] === "object" && manifest[field] !== null ? manifest[field] : {}
    );
  /** @type {EngineProblem[]} */
  const problems = [];
  for (const engine of [...new Set(engines)]) {
    for (const installed of INSTALLED_FIELDS) {
      if (Object.hasOwn(field(installed), engine)) {
        problems.push({
          engine,
          problem: `is in ${installed}. A bundled engine is built into the package, so it's in devDependencies and nowhere else.`,
        });
      }
    }
    if (!Object.hasOwn(field("devDependencies"), engine)) {
      problems.push({ engine, problem: "isn't in devDependencies." });
      continue;
    }
    const range = field("devDependencies")[engine];
    if (typeof range !== "string") {
      problems.push({ engine, problem: "has a version that isn't text." });
      continue;
    }
    if (!range.startsWith("catalog:")) {
      if (!EXACT_VERSION.test(range)) {
        problems.push({
          engine,
          problem: `is "${range}", which isn't one exact version, such as 1.2.3.`,
        });
      }
      continue;
    }
    const name = range.slice("catalog:".length) || "default";
    const catalog = catalogs[name];
    const version = catalog && Object.hasOwn(catalog, engine) ? catalog[engine] : undefined;
    if (typeof version !== "string") {
      problems.push({
        engine,
        problem: `is "${range}", and the workspace's ${name} catalog has no version for it.`,
      });
    } else if (!EXACT_VERSION.test(version)) {
      problems.push({
        engine,
        problem: `is "${version}" in the workspace's ${name} catalog, which isn't one exact version, such as 1.2.3.`,
      });
    }
  }
  return problems;
}

/**
 * @typedef {object} CheckOptions
 * @property {string} [cwd] The package's folder. Defaults to `process.cwd()`.
 * @property {string} [configFile] The dependency-cruiser configuration that
 *   declares the engines. Defaults to `.dependency-cruiser.js`.
 */

/**
 * @typedef {object} CheckResult
 * @property {number} exitCode {@link EXIT_OK} or {@link EXIT_FAILED}.
 * @property {string} report What to print.
 */

/**
 * Checks that every engine a package declares with `defineDependencyRules`
 * is an exactly pinned devDependency (sdk-core ADR 0061).
 *
 * @param {CheckOptions} [options]
 * @returns {Promise<CheckResult>}
 * @throws {UsageError} If the configuration, `package.json` or the workspace
 *   file can't be read.
 */
export async function checkBundledEngines({
  cwd = process.cwd(),
  configFile = ".dependency-cruiser.js",
} = {}) {
  const config = resolve(cwd, configFile);
  if (!existsSync(config)) {
    throw new UsageError(`The configuration ${config} doesn't exist.`);
  }
  /** @type {unknown} */
  let configuration;
  try {
    configuration = (await import(pathToFileURL(config).href)).default;
  } catch (error) {
    throw new UsageError(
      `The configuration ${config} couldn't be loaded: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    );
  }
  const engines = bundledEnginesOf(configuration).flatMap(({ packages }) => packages);
  if (engines.length === 0) {
    return { exitCode: EXIT_OK, report: `No bundled engines are declared in ${configFile}.\n` };
  }

  const manifestFile = join(resolve(cwd), "package.json");
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(read(manifestFile, "The manifest"));
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    throw new UsageError(`The manifest ${manifestFile} isn't valid JSON.`);
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new UsageError(`The manifest ${manifestFile} isn't an object.`);
  }

  const { catalogs } = workspaceCatalogs(cwd);
  const problems = findUnpinnedEngines({
    engines,
    manifest: /** @type {Record<string, unknown>} */ (manifest),
    catalogs,
  });
  const names = [...new Set(engines)];
  if (problems.length === 0) {
    return {
      exitCode: EXIT_OK,
      report: `${names.length === 1 ? "The bundled engine is an" : `All ${names.length} bundled engines are`} exactly pinned ${names.length === 1 ? "devDependency" : "devDependencies"}: ${names.join(", ")}.\n`,
    };
  }
  return {
    exitCode: EXIT_FAILED,
    report: [
      "Bundled engines must be exactly pinned devDependencies (sdk-core ADR 0061):",
      ...problems.map(({ engine, problem }) => `  ${engine} ${problem}`),
      "",
    ].join("\n"),
  };
}
