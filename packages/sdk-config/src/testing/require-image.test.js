import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import requireBrowserTestImage, {
  ALLOW_HOST_ENV,
  browserTestImageProblem,
  CONTAINER_ENV,
  webServersFor,
} from "./require-image.js";

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const GUARD = fileURLToPath(new URL("./require-image.js", import.meta.url));
const VITEST = join(PACKAGE, "node_modules", "vitest", "vitest.mjs");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browserTestImageProblem", () => {
  it.each([
    ["in the browser test image", { HM_VISUAL_CONTAINER: "1" }],
    ["in CI", { CI: "true" }],
    ["in CI, as GitHub Actions and others spell it", { CI: "1" }],
    ["in both", { CI: "true", HM_VISUAL_CONTAINER: "1" }],
    ["on a host that asks for it, to debug", { HM_ALLOW_HOST_BROWSER: "1" }],
  ])("finds none %s", (_label, env) => {
    expect(browserTestImageProblem(env)).toBeUndefined();
  });

  it.each([
    ["on a host", {}],
    ["with the image's variable set to something else", { HM_VISUAL_CONTAINER: "0" }],
    ["with the image's variable empty", { HM_VISUAL_CONTAINER: "" }],
    ["with CI turned off", { CI: "false" }],
    ["with CI set to 0", { CI: "0" }],
    ["with CI empty", { CI: "" }],
    ["with the host bypass set to anything but 1", { HM_ALLOW_HOST_BROWSER: "true" }],
    ["with the host bypass empty", { HM_ALLOW_HOST_BROWSER: "" }],
  ])("says what to run instead %s", (_label, env) => {
    const problem = browserTestImageProblem(env);

    expect(problem).toContain("pinned browser test image (sdk-core ADR 0049)");
    expect(problem).toContain("hm-in-image");
    expect(problem).toContain("HM_ALLOW_HOST_BROWSER=1");
    expect(problem).toContain("Never use it to check a change.");
  });

  it("reads the process's environment by default", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv(CONTAINER_ENV, "");
    vi.stubEnv(ALLOW_HOST_ENV, "");
    expect(browserTestImageProblem()).toBeDefined();

    vi.stubEnv(CONTAINER_ENV, "1");
    expect(browserTestImageProblem()).toBeUndefined();
  });
});

describe("webServersFor", () => {
  const vite = { command: "vite preview", url: "http://localhost:4310" };
  const next = { command: "next start", url: "http://localhost:4311" };

  it.each([
    ["in the browser test image", { HM_VISUAL_CONTAINER: "1" }],
    ["in CI", { CI: "true" }],
    ["on a host that asks for it, to debug", { HM_ALLOW_HOST_BROWSER: "1" }],
  ])("lists the servers as given %s", (_label, env) => {
    const servers = [vite, next];

    const listed = webServersFor(servers, env);

    expect(listed).toEqual([vite, next]);
    expect(listed).not.toBe(servers);
    expect(listed[0]).toBe(vite);
  });

  it.each([
    ["on a host", {}],
    ["with CI turned off", { CI: "false" }],
    ["with the host bypass set to anything but 1", { HM_ALLOW_HOST_BROWSER: "true" }],
  ])("lists none %s, where the guard will refuse", (_label, env) => {
    expect(browserTestImageProblem(env)).toBeDefined();
    expect(webServersFor([vite, next], env)).toEqual([]);
    expect(webServersFor(vite, env)).toEqual([]);
  });

  it("takes one server, as Playwright's configuration does", () => {
    expect(webServersFor(vite, { CI: "true" })).toEqual([vite]);
  });

  it("lists none when the configuration has none, anywhere", () => {
    expect(webServersFor(undefined, { CI: "true" })).toEqual([]);
    expect(webServersFor(undefined, {})).toEqual([]);
    expect(webServersFor([], { CI: "true" })).toEqual([]);
  });

  it("reads the process's environment by default, and never throws", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv(CONTAINER_ENV, "");
    vi.stubEnv(ALLOW_HOST_ENV, "");
    expect(webServersFor([vite])).toEqual([]);

    vi.stubEnv(ALLOW_HOST_ENV, "1");
    expect(webServersFor([vite])).toEqual([vite]);
  });
});

describe("the global setup", () => {
  it("returns in the image, and throws the problem without a stack trace elsewhere", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv(ALLOW_HOST_ENV, "");
    vi.stubEnv(CONTAINER_ENV, "1");
    expect(requireBrowserTestImage()).toBeUndefined();

    vi.stubEnv(CONTAINER_ENV, "");
    let thrown;
    try {
      requireBrowserTestImage();
    } catch (error) {
      thrown = /** @type {Error} */ (error);
    }
    expect(thrown?.message).toBe(browserTestImageProblem({}));
    expect(thrown?.stack).toBe(`Error: ${thrown?.message}`);
  });

  it("says so on stderr when the host bypass lets it through, but not in the image or CI", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubEnv("CI", "");
    vi.stubEnv(CONTAINER_ENV, "");
    vi.stubEnv(ALLOW_HOST_ENV, "1");

    expect(requireBrowserTestImage()).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toContain(
      "HM_ALLOW_HOST_BROWSER=1: browser tests are running",
    );
    expect(write.mock.calls[0]?.[0]).toContain("debugging only");

    vi.stubEnv(CONTAINER_ENV, "1");
    requireBrowserTestImage();
    vi.stubEnv(CONTAINER_ENV, "");
    vi.stubEnv("CI", "true");
    requireBrowserTestImage();
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
  });

  describe("in a Vitest configuration with a unit project and a guarded one", () => {
    /** @type {string[]} */
    const scratch = [];
    afterEach(async () => {
      for (const dir of scratch.splice(0)) {
        await rm(dir, { recursive: true, force: true });
      }
    });

    /** A configuration as an SDK's: the guard on one project only. The guarded one needs no browser here. */
    async function workspace() {
      // Inside the package, so the configuration resolves vitest.
      const root = await mkdtemp(join(PACKAGE, ".tmp-require-image-"));
      scratch.push(root);
      await writeFile(
        join(root, "vitest.config.js"),
        [
          'import { defineConfig } from "vitest/config";',
          "export default defineConfig({ test: { projects: [",
          '  { test: { name: "unit", include: ["unit.test.js"] } },',
          `  { test: { name: "browser", include: ["guarded.test.js"], globalSetup: [${JSON.stringify(pathToFileURL(GUARD).href)}] } },`,
          "] } });",
          "",
        ].join("\n"),
      );
      const test = 'import { expect, it } from "vitest";\nit("runs", () => expect(1).toBe(1));\n';
      await writeFile(join(root, "unit.test.js"), test);
      await writeFile(join(root, "guarded.test.js"), test);
      return root;
    }

    /**
     * @param {string} root
     * @param {string} project
     * @param {Record<string, string>} env
     */
    function run(root, project, env) {
      const {
        CI: _ci,
        HM_VISUAL_CONTAINER: _image,
        HM_ALLOW_HOST_BROWSER: _allow,
        ...rest
      } = process.env;
      return spawnSync(process.execPath, [VITEST, "run", "--root", root, "--project", project], {
        encoding: "utf8",
        env: { ...rest, ...env },
      });
    }

    it("leaves the unit project alone on a host", async () => {
      const result = run(await workspace(), "unit", {});

      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("pinned browser test image");
    });

    it("refuses the guarded project on a host, before any test runs", async () => {
      const result = run(await workspace(), "browser", {});

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(
        "Browser tests run only in the pinned browser test image (sdk-core ADR 0049).",
      );
      expect(result.stdout + result.stderr).not.toMatch(/1 passed/);
    });

    it.each([
      ["in the image", { HM_VISUAL_CONTAINER: "1" }],
      ["in CI", { CI: "true" }],
    ])("runs the guarded project %s", async (_label, env) => {
      const result = run(await workspace(), "browser", env);

      expect(result.status, result.stdout + result.stderr).toBe(0);
    });

    it("lets the guarded project start on a host with the bypass, and says it's for debugging", async () => {
      const result = run(await workspace(), "browser", { HM_ALLOW_HOST_BROWSER: "1" });

      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/1 passed/);
      expect(result.stderr).toContain("HM_ALLOW_HOST_BROWSER=1: browser tests are running");
    });

    it("keeps refusing when the bypass is set to anything but 1", async () => {
      const result = run(await workspace(), "browser", { HM_ALLOW_HOST_BROWSER: "yes" });

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("HM_ALLOW_HOST_BROWSER=1 for that run");
    });
  });
});
