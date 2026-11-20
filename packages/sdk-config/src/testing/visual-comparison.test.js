import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The specification of the visual preset's threshold (sdk-core ADR 0054).
// It runs Playwright's own comparison, the one `toHaveScreenshot` uses, on
// small generated images, through `toMatchSnapshot` in a scratch Playwright
// project. No browser starts. If an upgrade of Playwright changes what the
// preset's settings accept, this fails here, not in an SDK's baselines.

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const PRESET = pathToFileURL(fileURLToPath(new URL("./visual.js", import.meta.url))).href;
const PLAYWRIGHT = join(PACKAGE, "node_modules", "@playwright", "test", "cli.js");

/** The scratch project's spec: each case compares a generated image with a generated baseline. */
const SPEC = `
import { mkdirSync, writeFileSync } from "node:fs";
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
/** An opaque RGB image as a PNG. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      raw.set([r, g, b, 255], offset);
    }
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

const W = 64;
const H = 48;
const fill = (colour) => png(W, H, () => colour);
const grey = (level) => fill([level, level, level]);
/** A one-pixel horizontal line on white, as a border is. */
const line = (y, colour) => png(W, H, (_x, row) => (row === y ? colour : [255, 255, 255]));

/** [name, baseline, screenshot, comparison settings] */
const cases = [
  ["one level on every channel", grey(128), grey(129), visualComparison],
  ["one level on one channel", fill([128, 128, 128]), fill([128, 129, 128]), visualComparison],
  ["one level, up on one channel and down on another", fill([128, 128, 128]), fill([129, 127, 128]), visualComparison],
  ["two levels on every channel", grey(128), grey(130), visualComparison],
  ["two levels on red alone", fill([128, 128, 128]), fill([130, 128, 128]), visualComparison],
  ["a colour token one step apart", fill([0x25, 0x63, 0xeb]), fill([0x3b, 0x82, 0xf6]), visualComparison],
  ["text a few shades lighter", fill([0, 0, 0]), fill([52, 52, 52]), visualComparison],
  ["a light border moved by a pixel", line(20, [0xe2, 0xe8, 0xf0]), line(21, [0xe2, 0xe8, 0xf0]), visualComparison],
  ["a single pixel two levels off", grey(128), png(W, H, (x, y) => (x === 7 && y === 9 ? [130, 130, 130] : [128, 128, 128])), visualComparison],
  ["identical images", grey(128), grey(128), visualComparison],
  // What Playwright's default lets through, which is why the preset sets its own.
  ["default: a colour token one step apart", fill([0x25, 0x63, 0xeb]), fill([0x3b, 0x82, 0xf6]), { maxDiffPixelRatio: 0 }],
  ["default: a light border moved by a pixel", line(20, [0xe2, 0xe8, 0xf0]), line(21, [0xe2, 0xe8, 0xf0]), { maxDiffPixelRatio: 0 }],
  // A threshold of zero would count the noise of an unchanged page.
  ["zero: one level on every channel", grey(128), grey(129), { threshold: 0, maxDiffPixelRatio: 0 }],
];

mkdirSync(new URL("./snaps/", import.meta.url), { recursive: true });
cases.forEach(([name, baseline, screenshot, settings], index) => {
  writeFileSync(new URL("./snaps/case-" + index + ".png", import.meta.url), baseline);
  test(name, () => {
    expect(screenshot).toMatchSnapshot("case-" + index + ".png", settings);
  });
});
`;

const CONFIG = `
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  reporter: "json",
  snapshotPathTemplate: "{testDir}/snaps/{arg}{ext}",
  updateSnapshots: "none",
});
`;

/** @type {string} */
let project;
/** @type {Record<string, string>} */
let outcome = {};

beforeAll(async () => {
  // Inside the package, so the scratch project resolves @playwright/test.
  project = await mkdtemp(join(PACKAGE, ".tmp-visual-comparison-"));
  await writeFile(join(project, "playwright.config.js"), CONFIG);
  await writeFile(join(project, "comparison.spec.js"), SPEC);
  const { stdout, stderr } = spawnSync(
    process.execPath,
    [PLAYWRIGHT, "test", "--config", join(project, "playwright.config.js")],
    { encoding: "utf8", cwd: project },
  );
  /** @type {{ suites: Array<{ specs: Array<{ title: string, tests: Array<{ results: Array<{ status: string }> }> }> }> }} */
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`Playwright printed no report.\n${stdout}\n${stderr}`);
  }
  outcome = Object.fromEntries(
    report.suites.flatMap((suite) =>
      suite.specs.map((spec) => [spec.title, spec.tests[0]?.results[0]?.status ?? "missing"]),
    ),
  );
}, 60_000);

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("the visual preset's comparison, as Playwright applies it (ADR 0054)", () => {
  it.each([
    "one level on every channel",
    "one level on one channel",
    "one level, up on one channel and down on another",
    "identical images",
  ])("accepts %s, the noise of an unchanged page", (name) => {
    expect(outcome[name]).toBe("passed");
  });

  it.each([
    "two levels on every channel",
    "two levels on red alone",
    "a colour token one step apart",
    "text a few shades lighter",
    "a light border moved by a pixel",
    "a single pixel two levels off",
  ])("refuses %s", (name) => {
    expect(outcome[name]).toBe("failed");
  });

  it("is needed: Playwright's default accepts a token step and a moved light border", () => {
    expect(outcome["default: a colour token one step apart"]).toBe("passed");
    expect(outcome["default: a light border moved by a pixel"]).toBe("passed");
  });

  it("can't be zero: that refuses a difference of one level, which unchanged pages have", () => {
    expect(outcome["zero: one level on every channel"]).toBe("failed");
  });

  it("ran every case", () => {
    expect(Object.keys(outcome)).toHaveLength(13);
  });
});
