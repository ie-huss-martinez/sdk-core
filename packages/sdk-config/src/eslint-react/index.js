// ESLint, with React's own hooks plugin and nothing else (sdk-core ADR 0063).
// Biome is the family's linter and formatter. It has no check for what a
// component does while it renders: reading or writing a ref, calling
// something impure, setting state. React's plugin has, with the analysis the
// React Compiler uses, and it needs ESLint to run. So ESLint runs this one
// plugin, over the files that hold React, and no other rule.

/**
 * The plugin's rules that are always on, as errors: no repository of the
 * family had a finding for them when they were adopted.
 */
export const ALWAYS_ON = Object.freeze([
  "purity",
  "set-state-in-render",
  "static-components",
  "error-boundaries",
  "globals",
  "use-memo",
  "void-use-memo",
  "incompatible-library",
  "unsupported-syntax",
  "config",
  "gating",
]);

/**
 * The plugin's rules a repository may turn off while it still has findings
 * for them. Each is on, as an error, unless the repository names it.
 */
export const MAY_BE_OFF = Object.freeze([
  "refs",
  "immutability",
  "set-state-in-effect",
  "exhaustive-deps",
  "preserve-manual-memoization",
]);

const PEERS = ["eslint", "eslint-plugin-react-hooks", "@typescript-eslint/parser"];

/**
 * What to show when ESLint, the plugin or the parser isn't installed: they're
 * optional peer dependencies, which only repositories with React install.
 *
 * @param {string} missing The package that couldn't be loaded.
 * @returns {string}
 */
export function installMessage(missing) {
  return [
    `${missing} isn't installed. The React lint (sdk-core ADR 0063) needs three packages, which only repositories with React install:`,
    `  pnpm add --save-dev --save-exact ${PEERS.join(" ")}`,
    "Pin them exactly, as the family's other tools are.",
  ].join("\n");
}

/**
 * Loads one of the optional peers, or fails saying what to install.
 *
 * @param {string} name
 * @returns {Promise<any>} The module.
 */
export async function loadPeer(name) {
  try {
    return await import(name);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === "ERR_MODULE_NOT_FOUND") {
      const failure = new Error(installMessage(name));
      // The stack would point into this file, which helps nobody.
      failure.stack = `${failure.name}: ${failure.message}`;
      throw failure;
    }
    throw error;
  }
}

/**
 * @typedef {object} ReactLintOptions
 * @property {readonly string[]} [files] The files that hold React, as globs
 *   from the repository's root. Defaults to `src/**` TypeScript files.
 * @property {readonly string[]} [ignores] Globs to leave out, beside tests'
 *   fixtures and build output.
 * @property {readonly string[]} [off] Rules the repository still has
 *   findings for, by name without the `react-hooks/` prefix, from
 *   {@link MAY_BE_OFF}. Each is turned off, never set to warn. Name the
 *   backlog item that fixes it in a comment beside it, and take the name out
 *   in the pull request that does.
 */

/**
 * The family's ESLint configuration for React: the hooks plugin's rules for
 * what a component does while it renders, and for hook dependency lists.
 *
 * - `rules-of-hooks` is left to Biome, which already checks it.
 * - Hook dependency lists are this plugin's to check: the family's Biome
 *   preset has its own rule for them turned off.
 * - A rule is an error or it's off. None is a warning: a warning that's
 *   always there stops being read.
 * - A suppression that suppresses nothing is an error, and `hm-lint-react`
 *   refuses one that doesn't say why.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";
 *
 * export default await defineReactLint({
 *   // Backlog item 12: the latest-ref pattern, once ui has useLatest.
 *   off: ["refs"],
 * });
 * ```
 *
 * @param {ReactLintOptions} [options]
 * @returns {Promise<import("eslint").Linter.Config[]>} A flat configuration.
 * @throws {TypeError} If `off` names a rule that isn't in {@link MAY_BE_OFF}.
 * @throws {Error} If ESLint's plugin or parser isn't installed, saying what
 *   to install.
 */
export async function defineReactLint({
  files = ["src/**/*.{ts,tsx,mts,cts}"],
  ignores = [],
  off = [],
} = {}) {
  if (!Array.isArray(off)) {
    throw new TypeError("off must be a list of rule names.");
  }
  for (const name of off) {
    if (!MAY_BE_OFF.includes(name)) {
      throw new TypeError(
        ALWAYS_ON.includes(name) || name === "rules-of-hooks"
          ? `"${name}" can't be turned off: no repository had a finding for it (sdk-core ADR 0063).`
          : `"${name}" isn't a rule that can be turned off. Use one of: ${MAY_BE_OFF.join(", ")}, without the react-hooks/ prefix.`,
      );
    }
  }
  const { default: reactHooks } = await loadPeer("eslint-plugin-react-hooks");
  const parser = await loadPeer("@typescript-eslint/parser");

  /** @type {Record<string, "error" | "off">} */
  const rules = { "react-hooks/rules-of-hooks": "off" };
  for (const name of ALWAYS_ON) {
    rules[`react-hooks/${name}`] = "error";
  }
  for (const name of MAY_BE_OFF) {
    rules[`react-hooks/${name}`] = off.includes(name) ? "off" : "error";
  }
  return [
    { ignores: ["**/dist/**", "**/coverage/**", "**/temp/**", "**/fixtures/**", ...ignores] },
    {
      name: "@hussmartinez/sdk-config/eslint-react",
      files: [...files],
      languageOptions: {
        parser: parser.default ?? parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      linterOptions: {
        reportUnusedDisableDirectives: "error",
        reportUnusedInlineConfigs: "error",
      },
      plugins: { "react-hooks": reactHooks },
      rules,
    },
  ];
}
