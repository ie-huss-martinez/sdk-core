/**
 * lint-staged preset for the `pre-commit` hook (ADR 0016): a secret scan, a
 * check for hidden characters (ADR 0052), Biome with safe fixes, and
 * stylelint for CSS, on staged files only.
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
