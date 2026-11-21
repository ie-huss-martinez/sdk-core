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

/** Where the React lint looks, unless a repository says otherwise. */
const DEFAULT_PATHS = Object.freeze(["src"]);

/** A TypeScript file's extension. */
const TYPESCRIPT = /\.[cm]?tsx?$/;

/** @param {string} text */
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a staged file is one the React lint reads: TypeScript under one
 * of the folders it lints, `src` by default. lint-staged gives absolute
 * paths, with backslashes on Windows; a folder is matched as a run of whole
 * path segments, with either separator.
 *
 * @param {string} file
 * @param {readonly string[]} [paths] The folders the lint reads, from the
 *   repository's root, such as `["packages/ui/src"]`.
 * @returns {boolean}
 */
export function isReactSource(file, paths = DEFAULT_PATHS) {
  const normal = file.replaceAll("\\", "/");
  return (
    TYPESCRIPT.test(normal) &&
    paths.some((path) =>
      new RegExp(`(?:^|/)${escaped(path.replaceAll("\\", "/").replace(/\/+$/, ""))}/`).test(normal),
    )
  );
}

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
export const reactLintTask = (files) =>
  files.some((file) => isReactSource(file)) ? ["hm-lint-react"] : [];

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
 * A repository whose React source isn't under `src` at its root names where
 * it is, and the step lints there:
 *
 * ```js
 * export default withReactLint(undefined, { paths: ["packages/ui/src"] });
 * ```
 *
 * @param {Record<string, Array<string | ((files: readonly string[]) => string | string[])>>} [preset]
 *   The configuration to add it to, the family's by default. Its
 *   `"!(*.css)"` list gets the step at its end.
 * @param {{ paths?: readonly string[] }} [options] `paths` are the folders
 *   the lint reads, from the repository's root, `["src"]` by default. The
 *   step runs when a staged TypeScript file is under one of them, and
 *   passes them to `hm-lint-react`.
 * @returns {Record<string, Array<string | ((files: readonly string[]) => string | string[])>>}
 *   A new configuration; the one given isn't changed.
 * @throws {TypeError} If the configuration has no `"!(*.css)"` list to add
 *   it to, or a path is empty or has a space in it, which lint-staged would
 *   split the command at.
 */
export function withReactLint(preset = config, { paths } = {}) {
  const tasks = preset[NOT_CSS];
  if (!Array.isArray(tasks)) {
    throw new TypeError(
      `withReactLint adds its step to the "${NOT_CSS}" list, which this configuration doesn't have.`,
    );
  }
  if (paths === undefined) {
    return { ...preset, [NOT_CSS]: [...tasks, reactLintTask] };
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError("withReactLint's paths must name at least one folder.");
  }
  for (const path of paths) {
    if (typeof path !== "string" || path === "" || /\s/.test(path)) {
      throw new TypeError(
        `withReactLint's paths are folders without spaces in their names, since lint-staged splits a command at spaces; got ${JSON.stringify(path)}.`,
      );
    }
  }
  const command = `hm-lint-react ${paths.join(" ")}`;
  /** @param {readonly string[]} files */
  const task = (files) => (files.some((file) => isReactSource(file, paths)) ? [command] : []);
  return { ...preset, [NOT_CSS]: [...tasks, task] };
}
