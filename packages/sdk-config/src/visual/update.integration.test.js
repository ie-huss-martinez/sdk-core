import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINES, runInContainer } from "./run.js";

// The update, against Playwright itself (ADR 0054): its three passes rely on
// what Playwright does in each --update-snapshots mode, so this runs them for
// real. The scratch suite compares generated images with toMatchSnapshot,
// which shares toHaveScreenshot's comparison and update modes, so no browser
// starts. What each state "renders" comes from a file the test rewrites.

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const PRESET = pathToFileURL(fileURLToPath(new URL("../testing/visual.js", import.meta.url))).href;
const PLAYWRIGHT = join(PACKAGE, "node_modules", "@playwright", "test", "cli.js");

const SPEC = `
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { visualComparison } from ${JSON.stringify(PRESET)};

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A grey image as a PNG. */
function grey(level) {
  const width = 32;
  const height = 24;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set([level, level, level, 255], y * (width * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// { state: grey level, or [level, allowance] for a state with its own maxDiffPixelRatio }
const states = JSON.parse(readFileSync(new URL("../../states.json", import.meta.url), "utf8"));
for (const [state, value] of Object.entries(states)) {
  const [level, allowance] = Array.isArray(value) ? value : [value, undefined];
  test(state, () => {
    expect(grey(level)).toMatchSnapshot(
      state + ".png",
      allowance === undefined ? visualComparison : { ...visualComparison, maxDiffPixelRatio: allowance },
    );
  });
}
`;

const CONFIG = `
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "visual",
  reporter: "line",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  updateSnapshots: "none",
});
`;

/**
 * Long work (ADR 0057): each test runs Playwright three to six times, 4 s to
 * 8 s on a quiet machine, which is over the family's limit on a busy one.
 */
const LONG_WORK = 180_000;

/** @type {string[]} */
const scratch = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A repository with the scratch suite, inside the package so it resolves @playwright/test. */
async function repository() {
  const root = await mkdtemp(join(PACKAGE, ".tmp-visual-update-"));
  scratch.push(root);
  await mkdir(join(root, "e2e", "visual"), { recursive: true });
  await writeFile(join(root, "e2e", "playwright.visual.config.ts"), CONFIG);
  await writeFile(join(root, "e2e", "visual", "editor.spec.js"), SPEC);
  return root;
}

/**
 * Runs Playwright for `runInContainer`, which asks for it through pnpm. Before
 * each pass, the states render what `renders` gives for that pass.
 *
 * @param {string} root
 * @param {Array<Record<string, number | number[]>>} renders Each state's grey
 *   level, or its level and its own `maxDiffPixelRatio`.
 */
function playwright(root, renders) {
  let pass = 0;
  /** @type {import("../image/run.js").Run} */
  return (_command, args) => {
    const states = renders[Math.min(pass, renders.length - 1)];
    pass += 1;
    writeFileSync(join(root, "states.json"), JSON.stringify(states));
    const { status } = spawnSync(
      process.execPath,
      [PLAYWRIGHT, ...args.slice(args.indexOf("test"))],
      { cwd: join(root, "e2e"), encoding: "utf8" },
    );
    return status ?? 1;
  };
}

const DIR = `${BASELINES}/editor.spec.js`;
/** @param {string} root @returns {Promise<Record<string, Buffer>>} */
async function baselines(root) {
  /** @type {Record<string, Buffer>} */
  const found = {};
  for (const file of await readdir(join(root, DIR)).catch(() => [])) {
    found[file.replace(".png", "")] = readFileSync(join(root, DIR, file));
  }
  return found;
}

describe("hm-test-visual --update, against Playwright itself (ADR 0054)", () => {
  it(
    "keeps what's within the threshold or a state's allowance, rewrites what changed, adds and removes",
    async () => {
      const root = await repository();
      const first = { noise: 128, changed: 128, frame: [128, 1], removed: 128 };
      expect(runInContainer({ root, update: true, run: playwright(root, [first]) })).toBe(0);
      const before = await baselines(root);
      expect(Object.keys(before).sort()).toEqual(["changed", "frame", "noise", "removed"]);

      /** @type {string[]} */
      const messages = [];
      // "noise" is one level off; "frame" is far off but its assertion allows
      // every pixel to differ; "changed" is two levels off; one state is new,
      // and one is gone.
      const next = { noise: 129, changed: 130, frame: [200, 1], added: 50 };
      const status = runInContainer({
        root,
        update: true,
        run: playwright(root, [next]),
        log: (message) => messages.push(message),
      });

      expect(status).toBe(0);
      const after = await baselines(root);
      expect(Object.keys(after).sort()).toEqual(["added", "changed", "frame", "noise"]);
      expect(after["noise"]?.equals(/** @type {Buffer} */ (before["noise"]))).toBe(true);
      expect(after["frame"]?.equals(/** @type {Buffer} */ (before["frame"]))).toBe(true);
      expect(after["changed"]?.equals(/** @type {Buffer} */ (before["changed"]))).toBe(false);
      expect(messages).toEqual(["2 baselines written, 2 unchanged, 1 removed."]);
      expect(await readdir(join(root, "e2e", "visual"))).toEqual([
        "__screenshots__",
        "editor.spec.js",
      ]);

      // And the result passes a plain run.
      expect(runInContainer({ root, update: false, run: playwright(root, [next]) })).toBe(0);
    },
    LONG_WORK,
  );

  it(
    "changes nothing when a state renders differently in the proving run",
    async () => {
      const root = await repository();
      expect(runInContainer({ root, update: true, run: playwright(root, [{ open: 128 }]) })).toBe(
        0,
      );
      const before = await baselines(root);

      const status = runInContainer({
        root,
        update: true,
        // What changed, fresh captures, then a different render in the proof.
        run: playwright(root, [{ open: 140 }, { open: 140 }, { open: 150 }]),
      });

      expect(status).toBe(1);
      expect((await baselines(root))["open"]?.equals(/** @type {Buffer} */ (before["open"]))).toBe(
        true,
      );
      expect(await readdir(join(root, "e2e", "visual"))).toEqual([
        "__screenshots__",
        "editor.spec.js",
      ]);
    },
    LONG_WORK,
  );
});
