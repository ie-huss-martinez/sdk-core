import { mkdir, readFile, rm } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { build as esbuild, type Plugin } from "esbuild";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The built package where React Native runs it (sdk-core ADR 0069): on
 * Hermes, which has no DOM, and where `Intl` and
 * `String.prototype.normalize` can't be counted on.
 *
 * Each entry is bundled as Metro would bundle it, whole, and run in a realm
 * that has the ECMAScript language and nothing else: no `Intl`, no
 * `normalize`, and none of what a browser or Node adds, such as `document`,
 * `localStorage`, `Blob`, `TextEncoder`, `URL` or `setTimeout`.
 * That's less than Hermes has, so what runs here runs there.
 */

// Inside the package, so the built files resolve react from its dependencies.
const directory = new URL("temp/native-check/", import.meta.url);

/** `react-native` and `react-native-svg`, as modules whose every export is a component. */
const nativeStubs: Plugin = {
  name: "native-stubs",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react-native(?:-svg)?$/ }, (args) => ({
      path: args.path,
      namespace: "native-stub",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "native-stub" }, () => ({
      contents:
        "module.exports = new Proxy({}, { get: (_, name) => (name === '__esModule' ? false : function Stub() { return null; }) });",
      loader: "js",
    }));
  },
};

/** Bundles a built entry whole and runs `probe` on its exports in the bare realm. */
async function inBareRealm(entry: string, probe: string): Promise<unknown> {
  const bundle = await esbuild({
    stdin: {
      contents: `import * as entry from "./${entry}";\nglobalThis.result = JSON.stringify((${probe})(entry));\n`,
      resolveDir: directory.pathname,
      loader: "js",
    },
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [nativeStubs],
  });
  const realm = createContext({});
  runInContext("delete globalThis.Intl; delete String.prototype.normalize;", realm);
  expect(runInContext("typeof Intl + typeof ''.normalize + typeof setTimeout", realm)).toBe(
    "undefinedundefinedundefined",
  );
  runInContext(bundle.outputFiles[0]?.text ?? "", realm);
  return JSON.parse(runInContext("result", realm) as string);
}

beforeAll(async () => {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const config of ["vite.config.ts", "vite.native.config.ts"]) {
    await build({
      configFile: new URL(config, import.meta.url).pathname,
      logLevel: "silent",
      build: { outDir: directory.pathname, emptyOutDir: false },
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
