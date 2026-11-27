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
export function runInBareRealm({ entry, probe, stubs, provided }: {
    entry: string;
    probe: string;
    stubs?: readonly string[];
    provided?: readonly string[];
}): Promise<unknown>;
