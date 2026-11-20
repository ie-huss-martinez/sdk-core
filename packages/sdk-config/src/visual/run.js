import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CONTAINER_ENV, defaultRun, EXIT_FAILED, EXIT_OK, runInImage } from "../image/run.js";

/** The visual Playwright configuration, relative to the repository. */
export const CONFIG = "e2e/playwright.visual.config.ts";
/** The committed baselines, relative to the repository. */
export const BASELINES = "e2e/visual/__screenshots__";

/** Playwright with the visual configuration, as `pnpm` arguments. */
const PLAYWRIGHT = [
  "--dir",
  "e2e",
  "exec",
  "playwright",
  "test",
  "--config",
  "playwright.visual.config.ts",
];

/**
 * Every file under a folder, relative to it, with `/` separators.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function filesIn(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

/**
 * Inside the browser test image: runs the visual configuration with
 * Playwright, comparing each screenshot with its committed baseline.
 *
 * With `update`, it rewrites the baselines that changed and keeps the rest
 * byte for byte, so a pull request's image diff holds only screenshots their
 * own test calls different (ADR 0054). It's all or nothing: the committed
 * baselines change only when every pass has passed, and are otherwise put
 * back as they were. In three passes over the suite:
 *
 * 1. **What changed:** with the committed baselines in place, Playwright
 *    rewrites those a new capture no longer matches, by each assertion's own
 *    settings. That only shows which ones: what it wrote isn't kept, because
 *    in this mode Playwright accepts a capture of a page that never settled.
 * 2. **Fresh captures:** with no baselines, every state is captured afresh,
 *    which Playwright only accepts once two captures in a row agree. It also
 *    shows which baselines are still produced.
 * 3. **Proof:** the result is assembled, the fresh capture for each baseline
 *    the first pass rewrote or that is new, the committed file for the
 *    others still produced, and nothing for the rest, and a plain run
 *    against it must pass.
 *
 * A run that finds an earlier update's leftovers, such as one that was
 * cancelled, first puts the baselines back as they were before it.
 *
 * @param {{ root: string, update: boolean, run?: import("../image/run.js").Run, log?: (message: string) => void }} options
 * @returns {number} The exit code: 0 when every screenshot matches, or the
 *   baselines were updated.
 */
export function runInContainer({ root, update, run = defaultRun, log = () => {} }) {
  const baselines = join(root, BASELINES);
  /**
   * The baselines as they were when the update started. Its presence marks an
   * unfinished update, and it's what a restore puts back, so it only ever
   * exists complete: it's built under `incomplete` and renamed, and renamed
   * to `discard` before it's deleted.
   */
  const previous = `${baselines}.previous`;
  /** A backup still being copied. Never restored from. */
  const incomplete = `${baselines}.previous-incomplete`;
  /** A backup that's no longer needed, being deleted. Never restored from. */
  const discard = `${baselines}.discard`;
  /** The second pass's captures. */
  const fresh = `${baselines}.fresh`;
  const restore = () => {
    rmSync(fresh, { recursive: true, force: true });
    if (existsSync(previous)) {
      rmSync(baselines, { recursive: true, force: true });
      // An update that started without baselines kept an empty folder here.
      if (filesIn(previous).length > 0) {
        renameSync(previous, baselines);
      } else {
        rmSync(previous, { recursive: true, force: true });
      }
    }
  };
  // Folders that only ever hold copies: an update stopped while making its
  // backup, or after its result was proven. The baselines are whole either way.
  rmSync(incomplete, { recursive: true, force: true });
  rmSync(discard, { recursive: true, force: true });
  if (existsSync(previous)) {
    log("an earlier update didn't finish; the baselines are put back as they were before it.");
  }
  restore();
  if (!update) {
    return run("pnpm", PLAYWRIGHT, { cwd: root });
  }

  const before = filesIn(baselines);
  // Copied under another name and renamed once complete, so a copy that's cut
  // short is never mistaken for the baselines to put back.
  mkdirSync(incomplete, { recursive: true });
  if (before.length > 0) {
    cpSync(baselines, incomplete, { recursive: true });
  }
  renameSync(incomplete, previous);
  const fail = (/** @type {number} */ status, /** @type {string} */ message) => {
    restore();
    log(`${message} The baselines are unchanged.`);
    return status === EXIT_OK ? EXIT_FAILED : status;
  };

  // 1. What changed, by each assertion's own settings.
  /** @type {Set<string>} */
  const rejected = new Set();
  if (before.length > 0) {
    const status = run("pnpm", [...PLAYWRIGHT, "--update-snapshots=changed"], { cwd: root });
    if (status !== EXIT_OK) {
      return fail(status, "the tests failed while looking for changed screenshots.");
    }
    for (const file of before) {
      const now = join(baselines, file);
      if (!existsSync(now) || !readFileSync(now).equals(readFileSync(join(previous, file)))) {
        rejected.add(file);
      }
    }
  }

  // 2. Fresh captures, which must be stable.
  rmSync(baselines, { recursive: true, force: true });
  const captured = run("pnpm", [...PLAYWRIGHT, "--update-snapshots=all"], { cwd: root });
  if (captured !== EXIT_OK) {
    return fail(captured, "the screenshots couldn't be captured afresh.");
  }
  const produced = filesIn(baselines);
  if (produced.length === 0) {
    return fail(EXIT_FAILED, "no screenshot was captured.");
  }
  renameSync(baselines, fresh);

  // 3. The result, proven by a plain run.
  const kept = [];
  for (const file of produced) {
    const keep = before.includes(file) && !rejected.has(file);
    const target = join(baselines, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(keep ? previous : fresh, file), target);
    if (keep) {
      kept.push(file);
    }
  }
  const proven = run("pnpm", PLAYWRIGHT, { cwd: root });
  if (proven !== EXIT_OK) {
    return fail(
      proven,
      "the updated baselines didn't pass a test run: a state renders differently from one run to the next by more than its assertion allows.",
    );
  }
  // The result is proven. The backup leaves the name a restore looks for in
  // one step, so a deletion that's cut short can't bring back half of it.
  renameSync(previous, discard);
  rmSync(discard, { recursive: true, force: true });
  rmSync(fresh, { recursive: true, force: true });
  const removed = before.filter((file) => !produced.includes(file)).length;
  log(
    `${produced.length - kept.length} baseline${produced.length - kept.length === 1 ? "" : "s"} written, ${kept.length} unchanged, ${removed} removed.`,
  );
  return EXIT_OK;
}

/**
 * Outside the image: runs `hm-test-visual` itself in the browser test image,
 * through `runInImage`.
 *
 * @param {{ root: string, update: boolean, owner: string, env?: Record<string, string | undefined>, run?: import("../image/run.js").Run, log?: (message: string) => void }} options
 * @returns {number} The exit code.
 * @throws {import("../image/run.js").UsageError} When the repository's image or pnpm can't be read.
 */
export function runInDocker({ root, update, owner, env = process.env, run = defaultRun, log }) {
  return runInImage({
    cwd: root,
    command: ["hm-test-visual", ...(update ? ["--update"] : [])],
    owner,
    env: { ...env, [CONTAINER_ENV]: undefined },
    run,
    ...(log ? { log } : {}),
  });
}
