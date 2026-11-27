import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInBareRealm } from "@hussmartinez/sdk-config/testing/bare-realm";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The built package where React Native runs it (sdk-core ADR 0069): on
 * Hermes, which has no DOM, and where `Intl` and
 * `String.prototype.normalize` can't be counted on.
 *
 * Each entry runs through sdk-config's `runInBareRealm`: bundled whole, as
 * Metro would bundle it, in a realm that has the ECMAScript language and
 * nothing else. That's less than Hermes has, so what runs here runs there.
 */

// Inside the package, so the built files resolve react from its dependencies.
const directory = new URL("temp/native-check/", import.meta.url);

/** Runs `probe` on a built entry's exports in the bare realm, with React Native's packages stubbed. */
const inBareRealm = (entry: string, probe: string): Promise<unknown> =>
  runInBareRealm({
    entry: fileURLToPath(new URL(entry, directory)),
    probe,
    stubs: ["react-native", "react-native-svg"],
  });

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const config of ["vite.config.ts", "vite.native.config.ts"]) {
    await build({
      configFile: fileURLToPath(new URL(config, import.meta.url)),
      logLevel: "silent",
      build: { outDir: fileURLToPath(directory), emptyOutDir: false },
    });
  }
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

// Two Vite builds and two bundles: about two seconds alone, and several
// times that beside other suites.
describe("the built package on Hermes", { timeout: 60_000 }, () => {
  it("runs the native entry's themes, direction and preferences in a bare realm", async () => {
    const result = await inBareRealm(
      "native.js",
      `(ui) => ({
        accent: ui.createNativeTheme({ extends: "dark", tokens: { "color-accent": "#1f5f5b" } }).tokens["color-accent"],
        body: ui.lightNativeTheme.tokens["font-size-body"],
        rtl: [ui.isRTL("ar"), ui.isRTL("es")],
        preferences: ui.readNativePreferences({ textScale: 1.4 }),
        wrong: ui.choiceState("a", "a", "b"),
        components: [ui.Button, ui.ChoiceList, ui.Text, ui.Icon, ui.Dir, ui.NoFlip, ui.NativeUiProvider].map((c) => typeof c),
        icon: ui.undoIcon.mirror,
        refused: (() => { try { ui.createNativeTheme({ extends: "light", tokens: { "color-accent": "red" } }); } catch (error) { return error.code; } })(),
      })`,
    );
    expect(result).toEqual({
      accent: "#1f5f5b",
      body: 14,
      rtl: [true, false],
      preferences: { theme: "system", textScale: 1.4, motion: "system" },
      wrong: "hint",
      components: ["object", "object", "object", "function", "object", "object", "function"],
      icon: true,
      refused: "INVALID_THEME_TOKEN",
    });
  });

  it("runs the server-safe entry's themes and preferences there too", async () => {
    const result = await inBareRealm(
      "index.js",
      `(ui) => {
        const theme = ui.createTheme({ extends: "light", tokens: { "color-accent": "#6d28d9" } });
        return {
          accent: theme.tokens["color-accent"],
          css: ui.themeToCss(theme).includes("--hm-color-accent"),
          contrast: ui.checkContrast(ui.darkTheme).failures.length,
          mode: ui.readEditorPreferences({ mode: "expert" }).mode,
          heading: ui.nestedHeadingLevel(2),
          messages: Object.keys(ui.uiMessages).length > 0,
          tokens: ui.tokens.length > 0,
        };
      }`,
    );
    expect(result).toEqual({
      accent: "#6d28d9",
      css: true,
      contrast: 0,
      mode: "expert",
      heading: 3,
      messages: true,
      tokens: true,
    });
  });

  it("imports only React, React Native, react-native-svg and sdk-core from the native entry", async () => {
    const code = await readFile(new URL("native.js", directory), "utf8");
    const imported = [...code.matchAll(/^import .* from "([^"]+)";$/gm)].map(([, name]) => name);
    expect(imported.sort()).toEqual([
      "@hussmartinez/sdk-core",
      "react",
      "react-native",
      "react-native-svg",
      "react/jsx-runtime",
    ]);
    // One file: nothing it shares with the web entries became a chunk of theirs.
    expect(code).not.toMatch(/from "\.\//);
    expect(code).not.toContain("react-dom");
  });

  it("keeps Lucide's licence line with the icons' shapes", async () => {
    const code = await readFile(new URL("native.js", directory), "utf8");
    expect(code).toContain("/*! Icons from Lucide (https://lucide.dev), ISC licence");
  });
});
