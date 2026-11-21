import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FONT_CONFIG_ENV, FONT_CONFIG_FILE, fontLaunchEnv, usesFontRules } from "./fonts.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the fontconfig file", () => {
  const file = readFileSync(FONT_CONFIG_FILE, "utf8");

  it("is shipped beside the module, as an absolute path", () => {
    expect(isAbsolute(FONT_CONFIG_FILE)).toBe(true);
    expect(FONT_CONFIG_FILE.endsWith("/src/testing/fonts.conf")).toBe(true);
  });

  it("keeps the system's configuration", () => {
    expect(file).toContain('<include ignore_missing="yes">/etc/fonts/fonts.conf</include>');
  });

  it.each([
    ["system-ui", "Liberation Sans"],
    ["sans-serif", "Liberation Sans"],
    ["serif", "Liberation Serif"],
    ["monospace", "Liberation Mono"],
    ["ui-monospace", "Liberation Mono"],
  ])("prefers, for %s, %s", (family, preferred) => {
    const alias = new RegExp(
      `<alias binding="strong">\\s*<family>${family}</family>\\s*<prefer><family>${preferred}</family></prefer>\\s*</alias>`,
    );
    expect(file).toMatch(alias);
  });

  it("names five families and no others", () => {
    expect(file.match(/<alias /g)).toHaveLength(5);
  });
});

describe("fontLaunchEnv", () => {
  it("adds the file to the whole environment, in the browser test image", () => {
    const env = { HM_VISUAL_CONTAINER: "1", DISPLAY: ":0", PATH: "/usr/bin" };

    expect(fontLaunchEnv(env)).toEqual({
      HM_VISUAL_CONTAINER: "1",
      DISPLAY: ":0",
      PATH: "/usr/bin",
      FONTCONFIG_FILE: FONT_CONFIG_FILE,
    });
    expect(FONT_CONFIG_ENV).toBe("FONTCONFIG_FILE");
  });

  it.each([
    ["on a host", {}],
    ["in CI outside the image", { CI: "true" }],
    ["with the host bypass", { HM_ALLOW_HOST_BROWSER: "1" }],
    ["with the image's variable set to something else", { HM_VISUAL_CONTAINER: "true" }],
  ])(
    "is the environment unchanged %s, keeping a FONTCONFIG_FILE of the machine's own",
    (_label, extra) => {
      const env = { ...extra, DISPLAY: ":0", FONTCONFIG_FILE: "/home/me/fonts.conf" };

      expect(fontLaunchEnv(env)).toEqual(env);
      expect(fontLaunchEnv({ ...extra, DISPLAY: ":0" })).toEqual({ ...extra, DISPLAY: ":0" });
    },
  );

  it("returns a new object, without unset variables", () => {
    const env = { DISPLAY: ":0", UNSET: undefined };

    const launch = fontLaunchEnv(env);

    expect(launch).toEqual({ DISPLAY: ":0" });
    expect(launch).not.toBe(env);
    expect(Object.hasOwn(launch, "UNSET")).toBe(false);
  });

  it("replaces a FONTCONFIG_FILE the image was given, so the family's rules win there", () => {
    expect(
      fontLaunchEnv({ HM_VISUAL_CONTAINER: "1", FONTCONFIG_FILE: "/elsewhere/fonts.conf" }),
    ).toEqual({ HM_VISUAL_CONTAINER: "1", FONTCONFIG_FILE: FONT_CONFIG_FILE });
  });

  it("reads the process's environment by default", () => {
    vi.stubEnv("HM_VISUAL_CONTAINER", "1");
    expect(fontLaunchEnv()[FONT_CONFIG_ENV]).toBe(FONT_CONFIG_FILE);
    expect(usesFontRules()).toBe(true);

    vi.stubEnv("HM_VISUAL_CONTAINER", "");
    vi.stubEnv("FONTCONFIG_FILE", "");
    expect(fontLaunchEnv()[FONT_CONFIG_ENV]).toBe("");
    expect(usesFontRules()).toBe(false);
  });
});
