/**
 * lint-staged preset for the `pre-commit` hook (ADR 0016): a secret scan, a
 * check for hidden characters (ADR 0052), Biome with safe fixes, and
 * stylelint for CSS, on staged files only. A repository with React adds the
 * React lint with {@link withReactLint}.
 *
 * The globs don't overlap, because lint-staged runs globs concurrently and two
 * tools writing the same file would race. Within a glob, the secret scan runs
 * first, before anything rewrites the file, and both checks that only read
 * run before the tools that write.
 */
const SECRETLINT = "secretlint --maskSecrets";
const HIDDEN_UNICODE = "hm-check-hidden-unicode";
const BIOME = "biome check --write --no-errors-on-unmatched --files-ignore-unknown=true";
const STYLELINT = "stylelint --allow-empty-input";

/** @type {Record<string, string[]>} */
const config = {
  "*.css": [SECRETLINT, HIDDEN_UNICODE, BIOME, STYLELINT],
  "!(*.css)": [SECRETLINT, HIDDEN_UNICODE, BIOME],
};

export default config;

/** The glob whose files may hold React: everything but CSS. */
const NOT_CSS = "!(*.css)";

/** TypeScript under a `src` folder, in a path with either kind of separator. */
const REACT_SOURCE = /(?:^|[\\/])src[\\/].*\.[cm]?tsx?$/;

/**
 * Whether a staged file is one the React lint reads: TypeScript under
 * `src`. lint-staged gives absolute paths, with backslashes on Windows.
 *
 * @param {string} file
 * @returns {boolean}
 */
export const isReactSource = (file) => REACT_SOURCE.test(file);

/**
 * The React lint's step (sdk-core ADR 0063), as a lint-staged task: when a
 * staged file is TypeScript under `src`, it runs `hm-lint-react` over the
 * whole of `src`, and otherwise nothing.
 *
 * It names no file. The lint needs every file to judge one, the same as
 * `pnpm lint` runs it, and a command built from staged file names breaks on
 * a name with a space in it, since lint-staged splits a task's command at
 * spaces.
 *
 * @param {readonly string[]} files The staged files that matched the glob.
 * @returns {string[]} The commands to run.
 */
export const reactLintTask = (files) => (files.some(isReactSource) ? ["hm-lint-react"] : []);

/**
 * Adds the React lint to a lint-staged configuration, after Biome, for a
 * repository with React (sdk-core ADR 0063). Biome runs first, on the staged
 * files, and may rewrite them; the React lint then reads what Biome left.
 *
 * @example
 * ```js
 * // lint-staged.config.js
 * import { withReactLint } from "@hussmartinez/sdk-config/lint-staged";
 *
 * export default withReactLint();
 * ```
 *
 * @param {Record<string, Array<string | ((files: readonly string[]) => string | string[])>>} [preset]
 *   The configuration to add it to, the family's by default. Its
 *   `"!(*.css)"` list gets the step at its end.
 * @returns {Record<string, Array<string | ((files: readonly string[]) => string | string[])>>}
 *   A new configuration; the one given isn't changed.
 * @throws {TypeError} If the configuration has no `"!(*.css)"` list to add
 *   it to.
 */
export function withReactLint(preset = config) {
  const tasks = preset[NOT_CSS];
  if (!Array.isArray(tasks)) {
    throw new TypeError(
      `withReactLint adds its step to the "${NOT_CSS}" list, which this configuration doesn't have.`,
    );
  }
  return { ...preset, [NOT_CSS]: [...tasks, reactLintTask] };
}
