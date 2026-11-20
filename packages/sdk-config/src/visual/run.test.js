import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanUp, IMAGE, PINNED, repository } from "../../test/image-repository.js";
import { dockerfile } from "../image/run.js";
import { BASELINES, runInContainer, runInDocker } from "./run.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

afterEach(cleanUp);

describe("runInContainer", () => {
  it("compares with the visual configuration, writing nothing", async () => {
    const root = await repository();
    /** @type {string[][]} */
    const calls = [];
    const run = (/** @type {string} */ command, /** @type {string[]} */ args) => {
      calls.push([command, ...args]);
      return 0;
    };
    expect(runInContainer({ root, update: false, run })).toBe(0);
    expect(calls).toEqual([
      [
        "pnpm",
        "--dir",
        "e2e",
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.visual.config.ts",
      ],
    ]);
  });
});

describe("runInContainer with --update (ADR 0054)", () => {
  const DIR = `${BASELINES}/editor.spec.ts`;
  const name = (/** @type {string} */ state) => `${state}-light-compact-chromium-linux.png`;

  /**
   * Stands in for Playwright. Each pass captures `captures[pass]`, a map of
   * state to content, and `accepts` says whether an assertion takes a capture
   * for its baseline, as a threshold or a state's own allowance would.
   *
   * - `--update-snapshots=changed` rewrites the baselines it doesn't accept,
   *   and writes missing ones.
   * - `--update-snapshots=all`, with no baselines, writes every capture.
   * - A plain run fails if a baseline is missing or isn't accepted.
   *
   * @param {{
   *   captures: Array<Record<string, string>>,
   *   accepts?: (baseline: string, capture: string) => boolean,
   *   status?: Partial<Record<"changed" | "all" | "plain", number>>,
   * }} options
   */
  function playwright({ captures, accepts = (baseline, capture) => baseline === capture, status }) {
    /** @type {string[]} */
    const modes = [];
    /** @type {import("../image/run.js").Run} */
    const run = (_command, args, { cwd }) => {
      const flag = args.find((arg) => arg.startsWith("--update-snapshots="));
      const mode = /** @type {"changed" | "all" | "plain"} */ (flag ? flag.split("=")[1] : "plain");
      const capture = captures[modes.length] ?? {};
      modes.push(mode);
      const dir = join(cwd, DIR);
      let result = 0;
      for (const [state, content] of Object.entries(capture)) {
        const file = join(dir, name(state));
        const baseline = existsSync(file) ? readFileSync(file, "utf8") : undefined;
        if (mode === "plain") {
          if (baseline === undefined || !accepts(baseline, content)) {
            result = 1;
          }
        } else if (baseline === undefined || !accepts(baseline, content)) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, content);
        }
      }
      return status?.[mode] ?? result;
    };
    return { run, modes };
  }

  /** @param {string} root @returns {Promise<Record<string, string>>} The baselines, by state. */
  async function baselines(root) {
    /** @type {Record<string, string>} */
    const found = {};
    for (const file of await readdir(join(root, DIR)).catch(() => [])) {
      found[file.replace("-light-compact-chromium-linux.png", "")] = await readFile(
        join(root, DIR, file),
        "utf8",
      );
    }
    return found;
  }

  /** @param {Record<string, string>} states */
  const committed = (states) =>
    repository(
      Object.fromEntries(
        Object.entries(states).map(([state, content]) => [`${DIR}/${name(state)}`, content]),
      ),
    );

  /** Noise: captures that differ only after the "~" are within the threshold. */
  const withinThreshold = (/** @type {string} */ a, /** @type {string} */ b) =>
    a.split("~")[0] === b.split("~")[0];

  it("rewrites what changed, keeps the rest byte for byte, adds new states and removes stale ones", async () => {
    const root = await committed({ empty: "empty~a", open: "open-v1~a", removed: "gone~a" });
    const capture = { empty: "empty~b", open: "open-v2~b", added: "added~b" };
    const { run, modes } = playwright({
      captures: [capture, capture, capture],
      accepts: withinThreshold,
    });
    /** @type {string[]} */
    const messages = [];

    expect(runInContainer({ root, update: true, run, log: (m) => messages.push(m) })).toBe(0);

    expect(modes).toEqual(["changed", "all", "plain"]);
    expect(await baselines(root)).toEqual({
      // Within the threshold: the committed bytes stay, not the re-capture's.
      empty: "empty~a",
      open: "open-v2~b",
      added: "added~b",
    });
    expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
    expect(messages).toEqual(["2 baselines written, 1 unchanged, 1 removed."]);
  });

  it("leaves the repository untouched when nothing changed beyond the threshold", async () => {
    const root = await committed({ empty: "empty~a", open: "open~a" });
    const { run } = playwright({
      captures: [
        { empty: "empty~b", open: "open~c" },
        { empty: "empty~d", open: "open~e" },
        { empty: "empty~f", open: "open~g" },
      ],
      accepts: withinThreshold,
    });

    expect(runInContainer({ root, update: true, run })).toBe(0);
    expect(await baselines(root)).toEqual({ empty: "empty~a", open: "open~a" });
  });

  it("decides by each assertion's own settings, so a codec state's allowance is honoured", async () => {
    const root = await committed({ frame: "frame:100", empty: "empty:100" });
    // The frame's assertion allows a difference of up to 5; the preset's allows none.
    const accepts = (/** @type {string} */ baseline, /** @type {string} */ capture) => {
      const [state, was] = baseline.split(":");
      const [, is] = capture.split(":");
      return Math.abs(Number(was) - Number(is)) <= (state === "frame" ? 5 : 0);
    };
    const capture = { frame: "frame:103", empty: "empty:103" };
    const { run } = playwright({ captures: [capture, capture, capture], accepts });

    expect(runInContainer({ root, update: true, run })).toBe(0);
    expect(await baselines(root)).toEqual({ frame: "frame:100", empty: "empty:103" });
  });

  it("writes the fresh, stable capture, never what the first pass wrote", async () => {
    const root = await committed({ open: "open-v1" });
    const { run } = playwright({
      captures: [{ open: "unsettled" }, { open: "open-v2" }, { open: "open-v2" }],
    });

    expect(runInContainer({ root, update: true, run })).toBe(0);
    expect(await baselines(root)).toEqual({ open: "open-v2" });
  });

  it("captures the first baselines of a repository that has none", async () => {
    const root = await repository();
    const capture = { empty: "empty" };
    const { run, modes } = playwright({ captures: [capture, capture] });

    expect(runInContainer({ root, update: true, run })).toBe(0);
    expect(modes).toEqual(["all", "plain"]);
    expect(await baselines(root)).toEqual({ empty: "empty" });
    expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
  });

  describe("is all or nothing", () => {
    const before = { empty: "empty-v1", open: "open-v1", removed: "gone" };
    const capture = { empty: "empty-v2", open: "open-v2" };

    it.each([
      ["the first pass fails, as when a test errors", { changed: 1 }, 1],
      ["a capture never settles in the second pass", { all: 1 }, 1],
      ["Playwright is stopped by a signal", { all: 130 }, 130],
    ])("changes nothing when %s", async (_label, status, exitCode) => {
      const root = await committed(before);
      const { run } = playwright({ captures: [capture, capture, capture], status });
      /** @type {string[]} */
      const messages = [];

      expect(runInContainer({ root, update: true, run, log: (m) => messages.push(m) })).toBe(
        exitCode,
      );
      expect(await baselines(root)).toEqual(before);
      expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
      expect(messages.at(-1)).toMatch(/The baselines are unchanged\.$/);
    });

    it("changes nothing when the result doesn't pass a plain run, because the page differs between runs", async () => {
      const root = await committed(before);
      const { run, modes } = playwright({
        captures: [capture, capture, { empty: "empty-v3", open: "open-v2" }],
      });
      /** @type {string[]} */
      const messages = [];

      expect(runInContainer({ root, update: true, run, log: (m) => messages.push(m) })).toBe(1);
      expect(modes).toEqual(["changed", "all", "plain"]);
      expect(await baselines(root)).toEqual(before);
      expect(messages.at(-1)).toContain("renders differently from one run to the next");
    });

    it("changes nothing when the second pass captures no screenshot at all", async () => {
      const root = await committed(before);
      const { run } = playwright({ captures: [capture, {}, {}] });

      expect(runInContainer({ root, update: true, run })).toBe(1);
      expect(await baselines(root)).toEqual(before);
    });

    it("never removes a baseline because a pass didn't reach its state", async () => {
      const root = await committed(before);
      // The second pass stops early: it captured one state, then failed.
      const { run } = playwright({
        captures: [capture, { empty: "empty-v2" }, capture],
        status: { all: 1 },
      });

      expect(runInContainer({ root, update: true, run })).toBe(1);
      expect(await baselines(root)).toEqual(before);
    });
  });

  describe("after an update that didn't finish", () => {
    /** A repository as a cancelled update leaves it: half-written baselines, and the earlier ones set aside. */
    async function interrupted() {
      return repository({
        [`${DIR}/${name("empty")}`]: "half-written",
        [`${BASELINES}.previous/editor.spec.ts/${name("empty")}`]: "empty-v1",
        [`${BASELINES}.previous/editor.spec.ts/${name("open")}`]: "open-v1",
        [`${BASELINES}.fresh/editor.spec.ts/${name("empty")}`]: "fresh",
      });
    }

    it("puts the baselines back before comparing", async () => {
      const root = await interrupted();
      /** @type {Record<string, string>} */
      let seen = {};
      /** @type {string[]} */
      const messages = [];
      const status = runInContainer({
        root,
        update: false,
        run: () => {
          seen = Object.fromEntries(
            readdirSync(join(root, DIR)).map((file) => [
              file,
              readFileSync(join(root, DIR, file), "utf8"),
            ]),
          );
          return 0;
        },
        log: (m) => messages.push(m),
      });

      expect(status).toBe(0);
      expect(seen).toEqual({ [name("empty")]: "empty-v1", [name("open")]: "open-v1" });
      expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
      expect(messages).toEqual([
        "an earlier update didn't finish; the baselines are put back as they were before it.",
      ]);
    });

    it("puts the baselines back before updating again", async () => {
      const root = await interrupted();
      const capture = { empty: "empty-v1", open: "open-v2" };
      const { run } = playwright({ captures: [capture, capture, capture] });

      expect(runInContainer({ root, update: true, run })).toBe(0);
      expect(await baselines(root)).toEqual({ empty: "empty-v1", open: "open-v2" });
    });

    it("ignores a backup that was cut short while being copied, and keeps the baselines", async () => {
      const root = await repository({
        [`${DIR}/${name("empty")}`]: "empty-v1",
        [`${DIR}/${name("open")}`]: "open-v1",
        // Only one of the two files had been copied.
        [`${BASELINES}.previous-incomplete/editor.spec.ts/${name("empty")}`]: "empty-v1",
      });
      /** @type {string[]} */
      const messages = [];

      expect(
        runInContainer({ root, update: false, run: () => 0, log: (m) => messages.push(m) }),
      ).toBe(0);
      expect(await baselines(root)).toEqual({ empty: "empty-v1", open: "open-v1" });
      expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
      expect(messages).toEqual([]);
    });

    it("keeps a proven result when the old backup's deletion was cut short", async () => {
      const root = await repository({
        [`${DIR}/${name("empty")}`]: "empty-v2",
        [`${DIR}/${name("open")}`]: "open-v2",
        // Half of the old baselines, left behind while being deleted.
        [`${BASELINES}.discard/editor.spec.ts/${name("open")}`]: "open-v1",
        [`${BASELINES}.fresh/editor.spec.ts/${name("empty")}`]: "empty-v2",
      });

      expect(runInContainer({ root, update: false, run: () => 0 })).toBe(0);
      expect(await baselines(root)).toEqual({ empty: "empty-v2", open: "open-v2" });
      expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
    });

    it("only ever restores from a complete backup: it's renamed into place, and out of it", async () => {
      const root = await committed({ empty: "empty-v1", open: "open-v1" });
      const capture = { empty: "empty-v2", open: "open-v1" };
      /** @type {string[][]} */
      const seen = [];
      const { run } = playwright({ captures: [capture, capture, capture] });

      const status = runInContainer({
        root,
        update: true,
        run: (command, args, options) => {
          // During every pass, the backup is complete and under its final name.
          seen.push(readdirSync(join(root, "e2e", "visual")).sort());
          expect(readdirSync(join(root, `${BASELINES}.previous`, "editor.spec.ts")).sort()).toEqual(
            [name("empty"), name("open")],
          );
          return run(command, args, options);
        },
      });

      expect(status).toBe(0);
      expect(seen).toEqual([
        ["__screenshots__", "__screenshots__.previous"],
        ["__screenshots__.previous"],
        ["__screenshots__", "__screenshots__.fresh", "__screenshots__.previous"],
      ]);
      expect(await readdir(join(root, "e2e", "visual"))).toEqual(["__screenshots__"]);
    });

    it("removes the leftovers of an interrupted first capture, which had no baselines before it", async () => {
      const root = await repository({
        [`${DIR}/${name("empty")}`]: "half-written",
        [`${BASELINES}.previous/.keep`]: "",
      });
      await rm(join(root, `${BASELINES}.previous/.keep`));

      expect(runInContainer({ root, update: false, run: () => 0 })).toBe(0);
      expect(await readdir(join(root, "e2e", "visual"))).toEqual([]);
    });
  });
});

describe("runInDocker", () => {
  it("builds the image from ci/Dockerfile and runs the tests in it", async () => {
    const root = await repository();
    /** @type {Array<{ command: string, args: string[], input?: string | undefined }>} */
    const calls = [];
    const status = runInDocker({
      root,
      update: false,
      owner: "1000:1000",
      run: (command, args, { input }) => {
        calls.push({ command, args, input });
        return 0;
      },
    });
    expect(status).toBe(0);
    expect(calls.map((call) => call.args[0])).toEqual(["info", "build", "run"]);
    expect(calls[1]?.args).toEqual([
      "build",
      "--quiet",
      "--tag",
      "hm-browser-hussmartinez-image-sdk-workspace",
      "-",
    ]);
    expect(calls[1]?.input).toBe(dockerfile(IMAGE, PINNED));
    expect(calls[2]?.args.at(-1)).toContain("pnpm exec hm-test-visual;");
  });

  it("fails with a one-line fix when Docker isn't available, and never skips", async () => {
    const root = await repository();
    /** @type {string[]} */
    const messages = [];
    const status = runInDocker({
      root,
      update: false,
      owner: "1000:1000",
      run: () => 1,
      log: (message) => messages.push(message),
    });
    expect(status).toBe(1);
    expect(messages).toEqual([expect.stringMatching(/^Docker isn't available\. Install Docker/)]);
  });
});

describe("hm-test-visual", () => {
  /**
   * Runs the command with fake `docker` and `pnpm` executables first on the
   * PATH, which record their arguments.
   *
   * @param {string} root
   * @param {string[]} args
   * @param {Record<string, string>} env
   */
  async function cli(root, args, env = {}) {
    const bin = join(root, ".bin");
    await mkdir(bin);
    /** @type {Array<[string, number]>} */
    const fakes = [
      ["docker", 1],
      ["pnpm", 0],
    ];
    for (const [name, status] of fakes) {
      await writeFile(
        join(bin, name),
        `#!/bin/sh\necho "${name} $*" >> "${root}/calls.log"\nexit ${status}\n`,
      );
      await chmod(join(bin, name), 0o755);
    }
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"]}`,
        HM_VISUAL_CONTAINER: "",
        ...env,
      },
    });
    const calls = await readFile(join(root, "calls.log"), "utf8").catch(() => "");
    return { ...result, calls };
  }

  it("runs Playwright directly inside the image", async () => {
    const root = await repository();
    const { status, calls } = await cli(root, [], { HM_VISUAL_CONTAINER: "1" });
    expect(status).toBe(0);
    expect(calls).toBe(
      "pnpm --dir e2e exec playwright test --config playwright.visual.config.ts\n",
    );
  });

  it("fails outside the image without Docker, with how to fix it", async () => {
    const root = await repository();
    const { status, stderr } = await cli(root, []);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^hm-test-visual: Docker isn't available\./);
  });

  it("reports a repository it can't read as a usage error", async () => {
    const root = await repository({ "ci/Dockerfile": "# nothing\n" });
    const { status, stderr } = await cli(root, []);
    expect(status).toBe(2);
    expect(stderr).toBe("hm-test-visual: ci/Dockerfile must have exactly one FROM line, not 0.\n");
  });

  it("rejects unknown options", async () => {
    const root = await repository();
    const { status, stderr } = await cli(root, ["--grep", "empty"]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/^hm-test-visual: Unknown option '--grep'/);
  });
});
