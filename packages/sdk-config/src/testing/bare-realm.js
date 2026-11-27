// Runs a built entry where an engine has the ECMAScript language and
// nothing else, for packages with a React Native entry (sdk-core ADR 0069):
// the check that a `.` or `./native` entry is safe on Hermes.
//
// Test code only: this entry is never imported by published runtime code.

import { dirname } from "node:path";
import { createContext, runInContext } from "node:vm";

/**
 * What the realm lacks that Hermes may lack too, beyond what no bare realm
 * has: these are part of the language, so they're deleted.
 */
const REMOVED = "delete globalThis.Intl; delete String.prototype.normalize;";

/** What a caller can count on being absent, checked before the entry runs. */
const ABSENT = [
  "Intl",
  "''.normalize",
  "document",
  "localStorage",
  "Blob",
  "TextEncoder",
  "URL",
  "structuredClone",
  "crypto",
  "setTimeout",
  "process",
];

/**
 * Bundles a built entry whole, as Metro does without tree shaking, and runs
 * `probe` on its exports in a realm with the ECMAScript language and
 * nothing else: no `Intl`, no `String.prototype.normalize`, and none of
 * what a browser or Node adds, such as `document`, `localStorage`, `Blob`,
 * `TextEncoder`, `URL`, `structuredClone`, `crypto` or `setTimeout`.
 *
 * That's less than Hermes has, so what runs here runs there, as far as the
 * engine's globals go. It doesn't run Hermes itself: an Expo application
 * built with `expo export` proves Hermes compiles the code.
 *
 * Importing the entry runs every module it reaches, so a module that
 * touches a missing global when it loads fails the call. `probe` then says
 * what to exercise.
 *
 * It needs `esbuild`.
 *
 * @example
 * ```ts
 * const result = await runInBareRealm({
 *   entry: fileURLToPath(new URL("temp/check/native.js", import.meta.url)),
 *   stubs: ["react-native"],
 *   probe: `(sdk) => ({ rtl: sdk.isRTL("ar") })`,
 * });
 * expect(result).toEqual({ rtl: true });
 * ```
 *
 * @param {{ entry: string, probe: string, stubs?: readonly string[], provided?: readonly string[] }} options
 *   `entry` is the built entry's path. `probe` is the source of a function
 *   that takes the entry's exports and returns what to check, or a
 *   promise of it, as JSON carries it; it runs inside the realm, so it
 *   sees nothing of the test.
 *   `stubs` names packages to replace with a module whose every export is a
 *   function that returns `null`, such as `react-native`, which only runs
 *   on a device. `provided` names globals to take from this process, for
 *   what React Native itself sets up beside Hermes, such as
 *   `AbortController` and `setTimeout`: naming one records that the entry
 *   relies on it.
 * @returns {Promise<unknown>} What `probe` returned, through JSON.
 * @throws What the bundle or the probe threw: an error from inside the
 *   realm, such as a `ReferenceError` naming a global it lacks.
 */
export async function runInBareRealm({ entry, probe, stubs = [], provided = [] }) {
  const { build } = await import("esbuild");
  const names = new Set(stubs);
  const bundle = await build({
    stdin: {
      contents: `import * as entry from ${JSON.stringify(entry)};\nglobalThis.__result = Promise.resolve((${probe})(entry)).then((value) => JSON.stringify(value));\n`,
      resolveDir: dirname(entry),
      loader: "js",
    },
    bundle: true,
    // Everything the entry reaches, as Metro ships it: nothing dropped for
    // being unused or marked pure, or a module that touches a missing
    // global when it loads could pass by not being there.
    treeShaking: false,
    ignoreAnnotations: true,
    format: "iife",
    write: false,
    logLevel: "silent",
    // A production bundle, as a device runs: nothing reads `process` there.
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "bare-realm-stubs",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /.*/ }, (args) =>
            names.has(args.path) ? { path: args.path, namespace: "bare-realm-stub" } : undefined,
          );
          // The bundle reads a CommonJS module's names from an object that
          // inherits from the module's prototype, so the names it doesn't
          // know in advance are answered there, by a proxy.
          pluginBuild.onLoad({ filter: /.*/, namespace: "bare-realm-stub" }, () => ({
            contents:
              "module.exports = Object.create(new Proxy({}, { get: (_, name) => (name === '__esModule' ? false : function Stub() { return null; }) }));",
            loader: "js",
          }));
        },
      },
    ],
  });
  const realm = createContext({});
  runInContext(REMOVED, realm);
  for (const name of provided) {
    if (!(name in globalThis)) {
      throw new Error(`There's no ${name} here to provide.`);
    }
    realm[name] = /** @type {Record<string, unknown>} */ (globalThis)[name];
  }
  const present = ABSENT.filter((name) => !provided.includes(name)).filter(
    (name) =>
      runInContext(`typeof (${name === "''.normalize" ? name : `globalThis.${name}`})`, realm) !==
      "undefined",
  );
  if (present.length > 0) {
    throw new Error(`The bare realm isn't bare: it has ${present.join(", ")}.`);
  }
  runInContext(bundle.outputFiles[0]?.text ?? "", realm);
  // A promise of the realm's own: its jobs run on this process's queue.
  const result = await /** @type {Promise<string | undefined>} */ (
    runInContext("globalThis.__result", realm)
  );
  return result === undefined ? undefined : JSON.parse(result);
}
