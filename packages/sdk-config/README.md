# @hussmartinez/sdk-config

[![npm version of @hussmartinez/sdk-config](https://img.shields.io/npm/v/@hussmartinez/sdk-config)](https://www.npmjs.com/package/@hussmartinez/sdk-config) [![Verify workflow status on main](https://github.com/ie-huss-martinez/sdk-core/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/ie-huss-martinez/sdk-core/actions/workflows/verify.yml?query=branch%3Amain) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/ie-huss-martinez/sdk-core/blob/main/LICENSE)

Shared development configuration for the `@hussmartinez` SDK family. Every repository extends these presets instead of copying configuration, so a rule changes in one place ([STANDARDS.md](../../STANDARDS.md#tooling)).

> Status: `0.x`, so presets may still change between minor versions. Inside this workspace, the root configuration files use these presets.

## Presets

Install, as devDependencies, the tools for the presets you use. They are optional peer dependencies, so a repository without CSS doesn't need stylelint, for example. Plugins that a preset loads itself, such as `@commitlint/config-conventional`, come with the preset.

| Preset | Install |
|---|---|
| `tsconfig/*` | `typescript` (and `@types/node` for `tsconfig/node`) |
| `biome` | `@biomejs/biome` |
| `hm-check-hidden-unicode` | Nothing, but it lists files with git |
| `size`, `hm-size` | Nothing for `entryFiles` and `entryBudget`; `@size-limit/esbuild` for `importBudget`'s checks; `vite` for minified sizes; `esbuild` for import costs |
| `stylelint` | `stylelint` |
| `eslint-react`, `hm-lint-react` | `eslint`, `eslint-plugin-react-hooks`, `@typescript-eslint/parser` |
| `dependency-cruiser`, `hm-lint-deps` | `dependency-cruiser` |
| `hm-check-bundled-engines` | Nothing |
| `commitlint` | `@commitlint/cli` |
| `lint-staged` | `lint-staged`, plus `secretlint`, `@biomejs/biome` and `stylelint`, which it runs |
| `secretlint` | `secretlint` |
| `api-extractor/base.json`, `hm-check-api-reports` | `@microsoft/api-extractor` |
| `testing/conformance` | `vitest`, `ajv` |
| `hm-in-image` | Docker outside the browser test image |
| `hm-check-playwright-image` | Nothing |
| `testing/visual`, `hm-test-visual` | `@playwright/test`, and Docker outside the browser test image |
| `testing/browser-instances`, `hm-netlog-errors` | `@vitest/browser-playwright` |
| `testing/require-image` | Nothing |
| `testing/timeouts` | Nothing |
| `testing/fonts` | Nothing |
| `testing/firefox-labelled-by` | Nothing |

### TypeScript

Strict, ES2022, `nodenext` modules. `browser` adds the DOM library, and `node` adds Node's types (install `@types/node`).

```jsonc
// tsconfig.json
{ "extends": "@hussmartinez/sdk-config/tsconfig/browser" }
```

TypeScript is pinned to 6.0, because TypeScript 7 doesn't have the JavaScript compiler API that dependency-cruiser and api-extractor use yet.

### Biome

Formatting and linting for code, JSON and CSS. Markdown isn't formatted, so tables stay hand-aligned and diffs stay small.

```jsonc
// biome.json
{ "extends": ["@hussmartinez/sdk-config/biome"] }
```

#### `noUncheckedAbortListener`

The preset includes one rule of the family's own, as a Biome plugin ([ADR 0052](../../docs/adr/0052-source-checks-for-hidden-characters-and-abort-listeners.md)). An `"abort"` listener added to a signal that has already aborted never fires, so the work it should have stopped runs on, and nothing reports it. The rule reports a listener unless a function around it also looks at the same signal:

```ts
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {                       // without this check, the rule reports the listener below
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort); // or a long-lived signal keeps every finished wait's listener
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
```

- **What counts as looking:** reading `signal.aborted`, calling `signal.throwIfAborted()`, or calling a `throwIfAborted(signal)` helper, such as sdk-core's, in the same function or one that encloses it. The signal must be written the same way in both places, such as `options.signal`. A check inside an abort handler doesn't count, because on an aborted signal the handler is what never runs, unless the listener is inside that same handler.
- **Better, don't listen:** `AbortSignal.any([signal, other])` combines signals without listeners, and `AbortSignal.timeout()` needs none.
- **It can't see a check made by a caller.** When the function's contract is that it's never given an aborted signal, say so where the listener is:

  ```ts
  // biome-ignore lint/plugin/noUncheckedAbortListener: call() refuses an aborted signal first.
  signal.addEventListener("abort", onAbort, { once: true });
  ```

It needs nothing set up: it comes with `extends`, and works with every Biome the preset supports.

### stylelint

The family's CSS rules. General CSS correctness is left to Biome.

| Rule | Enforces | ADR |
|---|---|---|
| `selector-class-pattern`, `selector-id-pattern`, `custom-property-pattern`, `keyframes-name-pattern`, `selector-attribute-name-disallowed-list` | `.hm-<part>`, `.hm-<part>--<variant>`, `#hm-*`, `--hm-*`, `hm-*` keyframes and `data-hm-*` attributes. No generic state classes | [0003](../../docs/adr/0003-hm-namespace.md) |
| `hm/layer-name-pattern` | Cascade layers are `hm` or `hm.*` | [0003](../../docs/adr/0003-hm-namespace.md) |
| `hm/selector-scope` | Selectors only match elements inside an hm root. `:root` may only declare `--hm-*` tokens | [0005](../../docs/adr/0005-plain-css-with-cascade-layers.md) |
| `hm/no-literal-values` | Colours, lengths, durations, easings, z-indexes, opacities and font values come from `--hm-*` tokens, except in `*.tokens.css` and `tokens/` files | [0006](../../docs/adr/0006-design-tokens-and-theming.md) |

Disable comments need a description, such as `/* stylelint-disable-next-line hm/no-literal-values -- the visually hidden pattern needs a 1px box */`.

```js
// stylelint.config.js
export { default } from "@hussmartinez/sdk-config/stylelint";
```

It ignores build output and tool caches: `dist/`, `temp/`, `coverage/`, `storybook-static/`, `node_modules/`, `.next/` and `dist-server/`, at any depth. Built CSS inlines the token values, so it would fail `hm/no-literal-values`. Stylelint resolves these globs against the config file that declares them, so they apply when your config re-exports the preset as above. A config that uses `extends` instead must list its own `ignoreFiles`.

### React: `hm-lint-react`

For repositories with React. Biome checks that hooks are called at the top level. It doesn't check what a component does while it renders, and React needs rendering to be pure: no reading or writing a ref, no impure call such as `Math.random()`, no setting state. Those mistakes pass every test until a host uses a concurrent feature. React's own lint plugin checks for them, with the analysis the React Compiler uses, and it needs ESLint to run. So ESLint runs that one plugin and nothing else ([ADR 0063](../../docs/adr/0063-a-lint-for-what-react-components-do-while-rendering.md)). Biome stays the linter and formatter.

Install the three packages, pinned exactly, as the family's other tools are:

```sh
pnpm add --save-dev --save-exact eslint eslint-plugin-react-hooks @typescript-eslint/parser
```

```js
// eslint.config.js
import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";

export default await defineReactLint();
```

```json
{ "scripts": { "lint": "biome check . && hm-lint-react" } }
```

- **What it checks:** every rule the plugin recommends, as an error, except `rules-of-hooks`, which Biome already checks. That includes `refs`, `purity`, `set-state-in-render`, `immutability`, `set-state-in-effect` and `exhaustive-deps`.
- **Hook dependency lists are this plugin's.** The Biome preset turns its own `useExhaustiveDependencies` off: the plugin also reports a dependency made anew on every render, such as `plan?.clips ?? []`, which Biome doesn't, and with one rule a deliberate exception is suppressed once.
- **A rule is an error or it's off, never a warning.** A repository that still has findings for a rule turns it off by name, with the backlog item that fixes it beside it, and takes the name out in the pull request that fixes them:

  ```js
  export default await defineReactLint({
    // Backlog item 12: the latest-ref pattern, once ui has useLatest.
    off: ["refs"],
  });
  ```

  Only `refs`, `immutability`, `set-state-in-effect`, `exhaustive-deps` and `preserve-manual-memoization` can be turned off. The others had no finding in any repository, so they stay on.
- **Tests and stories keep Biome's dependency rule.** The plugin reads published source only, so the Biome preset leaves `useExhaustiveDependencies` on for `*.test.*` and `*.stories.*`. A file outside both, such as JavaScript under `src`, isn't checked by either: add it with `files` in `defineReactLint`.
- **While `exhaustive-deps` is off, turn Biome's rule back on for published source too,** so its dependency lists are still checked:

  ```jsonc
  // biome.json
  { "extends": ["@hussmartinez/sdk-config/biome"], "linter": { "rules": { "correctness": { "useExhaustiveDependencies": "error" } } } }
  ```

  Take that out in the pull request that turns the plugin's rule on, and move your `biome-ignore` comments for it to the plugin's.
- **A suppression says why:** `// eslint-disable-next-line react-hooks/immutability -- <reason>`. `hm-lint-react` fails on one without a reason, and on one that suppresses nothing. A comment that configures a rule for its file, `/* eslint react-hooks/purity: "off" */`, is refused: rules change in the `off` list.
- **A path you give it must exist:** `hm-lint-react src/componets` fails. **A file its configuration leaves out is skipped,** a test or a story for instance, as ESLint's `--no-warn-ignored` does, so a hook can pass it whatever is staged.
- **Reading no file is a failure, not a pass.** Run bare where there's no `src`, as at the root of a repository whose source is in `packages/ui/src`, it used to print "nothing reported in 0 files" and exit 0: a lint that looks in the wrong place would pass for ever. It now fails, saying where it looked.
  - **Source somewhere else:** name the folder, `hm-lint-react packages/ui/src`, and give `defineReactLint` matching `files`, such as `["packages/*/src/**/*.{ts,tsx}"]`.
  - **Nothing to lint, on purpose:** say so, with `defineReactLint({ allowNoFiles: true })`.
- **In the commit hook,** add it with the lint-staged preset's `withReactLint`, [below](#commitlint-lint-staged-and-secretlint).
- **The latest value of a prop,** for an effect or a handler, comes from `ui`'s `useLatest`, not from a ref written while rendering.
- **It lints published source:** TypeScript files under `src` by default, without build output, fixtures, tests (`*.test.*`) or stories (`*.stories.*`). A test's own component may hand a value out through a variable, which the rules for published components would report. Give `defineReactLint` your own `files` and `ignores`, and `hm-lint-react` your own paths, for another layout.
- **What it doesn't catch:** a direct read of the document while rendering, such as `document.activeElement`, and a changed prop. Those still need review.
- **Without the three packages,** the configuration and the command fail at once, saying what to install. A repository without React installs nothing and doesn't run it.

```text
Usage: hm-lint-react [--config <file>] [<path>...]
```

| Exit code | Meaning |
|---|---|
| 0 | Nothing reported |
| 1 | A rule reported, or a suppression doesn't say why |
| 2 | Usage error, a missing configuration, or ESLint isn't installed |

### dependency-cruiser

The layer rules of [ADR 0008](../../docs/adr/0008-ports-adapters-and-session.md), as clarified by [ADR 0017](../../docs/adr/0017-core-errors-and-shared-runtime-imports.md), as forbidden imports between `src/core/*`, `src/adapters`, `src/features`, `src/react`, `src/element` and `src/workers`. The core may import `@hussmartinez/sdk-core` but never `@hussmartinez/ui` or React. Neither may `src/adapters` and `src/workers` (`core-no-ui`). Nothing `src/index.*`, the `.` entry, reaches, however indirectly, may import React or `@hussmartinez/ui/react`, even as types; it may reach `ui`'s server-safe root entry through `src/features` (`entry-no-react`, [ADR 0036](../../docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)). The report names the path. No published source under `src/`, tests aside, may import `@hussmartinez/ai-core`, even as types: an SDK that needs AI defines its own provider port, and the host passes a provider. Examples under `examples/` and tests may import it to show hosts the wiring (`no-ai-core`, [ADR 0035](../../docs/adr/0035-ai-core-and-host-configured-network.md)). `src/core/errors` imports only `src/core/model` and `@hussmartinez/sdk-core`. It also rejects cycles, unresolvable and undeclared imports, devDependencies in published code and imports of tests.

```js
// .dependency-cruiser.js
export { default } from "@hussmartinez/sdk-config/dependency-cruiser";
```

It leaves out the repository's own build output and coverage (`dist/`, `temp/` and `coverage/`, at the root or in a workspace package under `packages/` or `apps/`) and fixtures under `src/`, `test/` or `tests/`. A dependency's files are always checked, including those in its `node_modules/<package>/dist/`, where most packages, such as `@hussmartinez/ui`, keep their code.

#### Stylesheets as URLs, in tests

Browser tests load a family package's stylesheet as a URL, with Vite's `?url`: `import url from "@hussmartinez/ui/styles.css?url"`. dependency-cruiser can't resolve that, so the preset allows it from test code, which is test files and anything under `test/` or `tests/`. Anywhere else it's reported, as `stylesheet-url-only-in-tests`. If your `.dependency-cruiser.js` has its own `STYLESHEET_URLS` exception, delete it.

#### Bundled engines and virtual modules: `defineDependencyRules`

The preset forbids published source from importing a `devDependency` (`not-to-dev-dep`). An SDK that builds a third-party engine into its package does so on purpose: the engine is an exactly pinned `devDependency`, and applications never install it. Declare it, with the one folder that wraps it ([ADR 0061](../../docs/adr/0061-bundled-engines-declared-to-the-dependency-rules.md)):

```js
// .dependency-cruiser.js
import { defineDependencyRules } from "@hussmartinez/sdk-config/dependency-cruiser";

export default defineDependencyRules({
  bundledEngines: [
    { packages: ["pdfjs-dist"], from: "adapters/pdfjs" },
    { packages: ["pdfstudio", "@cantoo/pdf-lib"], from: "adapters/qpdf" },
  ],
  virtualModules: ["virtual:hm-pdfjs-data"],
});
```

- **`bundledEngines`:** each entry names packages, exactly, and one folder below `src/`, under `adapters/` or `workers/`. An engine that two folders import gets two entries, such as an adapter and the worker that loads the engine's own worker build.
  - **Only that folder imports the engine,** as a value or as a type. Anywhere else in `src/`, tests aside, it's reported as `engine-only-from-its-folder`. An engine's types in another layer would tie that layer to the engine, and in the package's public types they'd name a package applications don't have.
  - **That folder imports no other `devDependency`:** a build tool there is reported as `engine-folder-only-its-engines`.
  - **A declared folder inside another keeps both:** with `pdfjs-dist` from `workers` and `gifenc` from `workers/gif`, files in `workers/gif` may import either, and the rest of `workers` only `pdfjs-dist`.
  - **A folder's name is text:** a `.` in it matches only a dot.
- **`virtualModules`:** exact names of modules the build generates, which can't be resolved from disk.
- **Names are names, never patterns.** A folder outside `adapters/` and `workers/`, or a package written as a pattern, is a `TypeError` when the configuration loads.
- **It only builds rules.** It reads no file, so loading the configuration stays cheap. Pinning is checked by `hm-check-bundled-engines`, below.
- **With nothing to declare,** keep `export { default } from …`: `defineDependencyRules()` returns the same rules.
- **Extending what it returns:** build on the result, and keep its `forbidden` rules. The engines are read back from those rules, so a copy has them however it's made:

  ```js
  const rules = defineDependencyRules({ bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }] });

  export default {
    ...rules,
    forbidden: [...rules.forbidden, myOwnRule],        // add to them; don't replace them
    options: { ...rules.options, exclude: { path: ["generated/"] } },
  };
  ```

  Replace `forbidden` with another list and the engines' rules are gone, with the engines: `hm-check-bundled-engines` then fails, saying none is declared.
- **A package that bundles no engine says so,** if it runs the check: `defineDependencyRules({ bundledEngines: [] })`. An empty list is a statement; leaving the option out says nothing either way.

**Replacing a copied exception:** if your `.dependency-cruiser.js` looks `not-to-dev-dep` up by name and splits it for your engines, delete that and declare the engines instead. Name the narrowest folder: the adapter that wraps the engine, not all adapters.

#### `hm-check-bundled-engines`

Fails when a declared engine isn't an exactly pinned `devDependency`. Run it in `verify`, in a package that declares engines:

```json
{ "scripts": { "check:bundled-engines": "hm-check-bundled-engines" } }
```

It reads the engines from `.dependency-cruiser.js`, and checks each against `package.json`:

- **it's in `devDependencies`,** and not also in `dependencies`, `peerDependencies` or `optionalDependencies`: a bundled engine is never something an application installs;
- **its version is one exact version,** such as `1.2.3`: not a range, a tag, an alias or a URL. A `catalog:` version counts by what the workspace's catalog gives, in the nearest `pnpm-workspace.yaml`.

```text
Bundled engines must be exactly pinned devDependencies (sdk-core ADR 0061):
  gifenc is "^1.0.3" in the workspace's default catalog, which isn't one exact version, such as 1.2.3.
  mediabunny is in peerDependencies. A bundled engine is built into the package, so it's in devDependencies and nowhere else.
```

**Finding no engine isn't passing.** With none declared, it fails, unless the configuration says on purpose that the package bundles none, with `bundledEngines: []`. A declaration that was lost, or never written, would otherwise turn the check off without a word.

```text
Usage: hm-check-bundled-engines [--config <file>]
```

| Exit code | Meaning |
|---|---|
| 0 | Every declared engine is exactly pinned, or the configuration declares that the package bundles none |
| 1 | A declared engine isn't, or nothing is declared either way |
| 2 | Usage error, or a file that can't be read |

#### `hm-lint-deps`

Run dependency-cruiser through `hm-lint-deps` rather than `depcruise`:

```json
{ "scripts": { "lint:deps": "hm-lint-deps src" } }
```

When dependency-cruiser can't parse a file type, it skips those files without failing. Without a supported TypeScript, for example, it leaves out every `.ts` file and still reports no violations. `hm-lint-deps` runs the same check, with the same report, and also fails when a source file wasn't analysed.

- **Expected files:** the files git tracks under the given paths whose extension the configuration resolves (`enhancedResolveOptions.extensions`) and dependency-cruiser can parse. Declaration files, non-code files and anything matched by the configuration's `exclude`, `doNotFollow` or `includeOnly` are left out.
- **Analysed:** a file is analysed when it's in the cruise result and dependency-cruiser can parse its file type in the current environment.
- **Missing files:** the command names up to 20 of them, with a count of the rest and the likely cause.

```text
Usage: hm-lint-deps [--config <file>] <path>...
```

| Exit code | Meaning |
|---|---|
| 0 | No violations, and every expected file was analysed |
| 1 | Rule violations, or expected files that weren't analysed |
| 2 | Usage or configuration error, including running outside a git repository |

It reads `.dependency-cruiser.js` by default and needs `dependency-cruiser` installed. Configurations that use `webpackConfig` or `babelConfig` aren't supported.

### api-extractor

The family's API report settings ([ADR 0033](../../docs/adr/0033-api-reports-for-several-entry-points.md)). Each entry point's configuration extends the preset and sets only its paths:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "extends": "@hussmartinez/sdk-config/api-extractor/base.json",
  "mainEntryPointFilePath": "<projectFolder>/temp/types/react.d.ts",
  "apiReport": {
    "enabled": true,
    "reportFileName": "<unscopedPackageName>-react.api.md",
    "reportFolder": "<projectFolder>/api/",
    "reportTempFolder": "<projectFolder>/temp/react/"
  },
  "dtsRollup": { "enabled": true, "publicTrimmedFilePath": "<projectFolder>/dist/react.d.ts" }
}
```

Use the file's full path in `extends`, because api-extractor resolves it without reading the package's `exports`.

api-extractor rolls up one entry point at a time, so an entry point such as `./react` carries its own copies of the package's types that its API uses. The preset doesn't fail on those copies (`ae-forgotten-export`); it lists each one in the entry point's committed report, so a new copy shows up in review.

It fails when a public type references an `@internal` one (`ae-incompatible-release-tags`). api-extractor trims `@internal` declarations from the published rollup, so that public type would reach users broken, while api-extractor's own default only notes it in the report.

#### `hm-check-api-reports`

Packages with more than one entry point run it after api-extractor:

```json
{
  "scripts": {
    "check:api": "api-extractor run -c api-extractor.json && api-extractor run -c api-extractor.react.json && hm-check-api-reports --main api/pdf-sdk.api.md --types dist/index.d.ts api/pdf-sdk-react.api.md"
  }
}
```

For each symbol that another entry point's report lists as copied, it checks that:

- **the main entry point exports it,** so users can name the type, and a copy never hides a type the package forgot to export;
- **it isn't a class with `private`, `protected` or `#private` members.** TypeScript treats two declarations of such a class as different types, even when one is a copy of the other, so a value typed with the copy couldn't be passed where the original is expected. API reports leave those members out, so the command reads the main entry point's declaration rollup.

A type that shares its name with a global, such as the DOM's `Scheduler` or WebCodecs' `AudioSampleFormat`, is renamed by api-extractor in every report: the main report has `export { Scheduler_2 as Scheduler }`, and other entry points refer to `Scheduler_2`. The command counts both names as exported, and checks a renamed class like any other.

```text
Usage: hm-check-api-reports --main <report> --types <rollup> [<report>...]
```

| Exit code | Meaning |
|---|---|
| 0 | Every report passes |
| 1 | A report copies a type the main entry point doesn't export, or a class with non-public members |
| 2 | Usage error, or a file that can't be read |

### Testing: conformance vectors

For the language-neutral conformance cases each SDK keeps in `conformance/` ([ADR 0045](../../docs/adr/0045-portable-formats-and-conformance-vectors.md)). A case file is an `hm-conformance` document, whose JSON Schema is `@hussmartinez/sdk-config/formats/hm-conformance/v1.schema.json`:

```json
{
  "format": "hm-conformance",
  "version": 1,
  "subject": "hm-video-commands",
  "cases": [
    { "name": "splits a clip", "input": { "plan": {}, "command": {} }, "expected": {} },
    { "name": "rejects a split at a clip's edge", "input": {}, "expected": { "error": { "code": "INVALID_COMMAND", "reason": "split-at-edge" } } }
  ]
}
```

`describeConformance(file, run)` validates the file and registers a Vitest test for each case. `run` gets the case's `input` and returns the result, or throws:

```ts
import { describeConformance } from "@hussmartinez/sdk-config/testing/conformance";

describeConformance(new URL("../../conformance/commands.json", import.meta.url), (input) =>
  applyCommand(input.plan, input.command),
);
```

- **Results** are compared exactly, or, for numbers, within the case's `tolerance` when it has one (only for computed floats).
- **A rejection** is matched by the thrown error's `code` and `details.reason`, never its message.
- **`schemaValidator(schemaFile)`** checks a value against a JSON Schema 2020-12 file, such as an SDK's own format schema, and returns the problems.

It's test code only, and needs `vitest` and `ajv`, which are optional peer dependencies.

### Testing: `browserInstances`

For Vitest's browser mode. Some failures leave no reason: an iframe that "did not become ready within 60000ms", or a module worker that "failed to load" ([video-sdk#55](https://github.com/ie-huss-martinez/video-sdk/issues/55)). Chromium's error event for a module that failed to load carries no message, so the diagnostics record the requests themselves.

Adopt it by replacing the `instances` line of the browser project, and keeping `provider: playwright()`:

```ts
import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";

browser: {
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: browserInstances(browsers), // was: browsers.map((browser) => ({ browser }))
},
```

- **In the browser test image, every browser gets the family's font rules** ([ADR 0062](../../docs/adr/0062-fonts-in-browser-tests.md)), so a browser test lays text out as a screenshot does. See [Testing: fonts](#testing-fonts).
- **Otherwise nothing changes:** the same browsers, with plain Playwright providers and the same output.
- **With `HM_BROWSER_DIAGNOSTICS` set to a folder,** Chromium records every request and its network error in a net log there, `chromium-<pid>.netlog.json`, and writes its console to stderr, which Playwright prints with `DEBUG=pw:browser`. Firefox and WebKit are never changed, because they refuse to launch with Chromium's flags.
- **`hm-netlog-errors <netlog>...`** lists the requests that failed, one line each: Chromium's error, such as `ERR_EMPTY_RESPONSE`, and the URL. It reads a log that a killed browser left unfinished, and leaves out WebSocket upgrades, which aren't failures. It exits with 0 once the logs are read, and with 2 for a usage error or a log it can't read.

```sh
HM_BROWSER_DIAGNOSTICS=test-results/diagnostics DEBUG=pw:browser pnpm test:browser 2>&1 | tee diagnostics.log
pnpm exec hm-netlog-errors test-results/diagnostics/*.netlog.json
```

The folder must be inside the checkout, because `pnpm test:browser` runs in the browser test image through `hm-in-image`, and the container sees nothing else of the host. A relative folder is taken from where the command runs, so the net logs of a package's tests land in that package. `hm-in-image` refuses a folder outside the checkout before it starts anything.

It's test code only: import it only from Vitest configurations.

### Testing: the Firefox `ariaLabelledByElements` guard

Playwright's Firefox 159 crashes the page when an element's `ariaLabelledByElements` is read from two JavaScript worlds ([ui#61](https://github.com/ie-huss-martinez/ui/issues/61)). Playwright's role and label locators read it in their isolated world, as does Vitest's `userEvent`, which builds such locators. axe-core reads it in the page's world. So a click by accessible name and an axe run on the same page crash Firefox, in either order. Two lines reproduce it: `<button aria-labelledby="x"></button><span id="x">Undo</span>`.

The guard removes the property from the page's world, in Firefox only, before any script runs. axe then resolves `aria-labelledby` by ID, as it does in browsers without the property, and reports the same results. Playwright's world keeps its own copy, and product code never reads the property.

**In a Vitest browser project,** list the setup file:

```ts
// vitest.config.ts: in the browser project only.
{
  test: {
    name: "browser",
    setupFiles: ["@hussmartinez/sdk-config/testing/firefox-labelled-by/setup"],
    browser: { /* … */ },
  },
}
```

**In Playwright's end-to-end tests,** wrap the repository's `test`, so its other fixtures stay:

```ts
// e2e/fixtures.ts
import { test as base } from "@playwright/test";
import { withFirefoxLabelledByGuard } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";

export const test = withFirefoxLabelledByGuard(base);
export { expect } from "@playwright/test";
```

- **It guards the browser context, not the page.** Playwright builds the context first, so the guard is in place before a `page` fixture of your own opens a page or navigates, and it covers every page the context opens. A context a test makes itself, with `browser.newContext()`, isn't covered: add `context.addInitScript(removeLabelledByElements)` to it.
- **It's listed, not built in:** each repository names the guard where it applies, so it's visible and easy to take out.
- **`removeLabelledByElements()`** is the function itself, for a runner that adds init scripts its own way. It uses nothing from outside itself, so it can be sent to a page as text.
- **It comes out when Firefox is fixed.** `CRASHING_FIREFOX` records the build, revision 1572, version 159.0. A test in this package fails when the pinned Playwright installs another, saying to re-check ui#61 and remove the guard if the crash is gone. Remove your lines when a release of `sdk-config` drops the entry.
- **It doesn't cover the Firefox your users have,** only the one tests run in. That's checked by hand.
- **Replacing a copy:** delete your own `delete Element.prototype.ariaLabelledByElements` setup file or fixture, and use these.

It's test code only: import it only from tests and their configurations.

### Testing: fonts

In the pinned browser test image, `system-ui` and the generic font families resolve to WenQuanYi Zen Hei, a font with one style. `ui`'s text asks for `system-ui` first, so every label was drawn in it, and in Chromium text at weight 600 came out as the same pixels as regular text: a lost font weight couldn't show in a screenshot ([ADR 0062](../../docs/adr/0062-fonts-in-browser-tests.md)).

`sdk-config` ships a fontconfig file that keeps the system's configuration and prefers the Liberation fonts the image already has, each in regular, bold, italic and bold italic:

| Asked for | Drawn in |
|---|---|
| `system-ui`, `sans-serif` | Liberation Sans |
| `serif` | Liberation Serif |
| `monospace`, `ui-monospace` | Liberation Mono |

**The presets pass it to every browser they launch in the image,** as `FONTCONFIG_FILE` in the launch environment: `defineVisualConfig` for screenshots and `browserInstances` for Vitest's browser projects. Nothing in the image changes, so CI and local runs match.

**A configuration that launches browsers its own way** takes the same environment from `fontLaunchEnv()`. An SDK's end-to-end configuration:

```ts
// e2e/playwright.config.ts
import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";

export default defineConfig({
  use: { launchOptions: { env: fontLaunchEnv() } },
  // …
});
```

And a Vitest browser project that doesn't use `browserInstances`:

```ts
import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";

browser: { provider: playwright({ launchOptions: { env: fontLaunchEnv() } }), /* … */ },
```

- **It's a whole environment,** the process's own with the file added. Playwright replaces a browser's environment with `launchOptions.env` rather than adding to it, so never pass `{ FONTCONFIG_FILE: … }` alone: the browser would lose `DISPLAY` and everything else.
- **Only in the image,** where `HM_VISUAL_CONTAINER=1`. Anywhere else it returns the process's environment unchanged, so a browser on your machine keeps your fonts.
- **`FONT_CONFIG_FILE`** is the file's absolute path, and `usesFontRules()` says whether the rules apply here, for a runner that takes a path or an environment in another shape.
- **Two weights:** Liberation has regular and bold, so 400 and 500 draw alike, and 600 and 700 draw alike.

**Taking this release changes every screenshot with text in it.** Retake the baselines in the same pull request, with `pnpm test:visual:update`, and say the font is the cause. Text changes everywhere; where a label got wider or narrower, or now wraps, what's beside or below it moves too. Explain each such move by the font: anything that can't be is a real difference.

It's test code only: import it only from test configurations.

### Testing: timeouts

One set of test timeouts for the family ([ADR 0057](../../docs/adr/0057-test-timeouts.md)), so no repository writes the numbers and no test fails only because the machine was busy:

| Constant | For | Limits |
|---|---|---|
| `unitTimeouts` | Unit tests, in Vitest on Node | 30 s for a test, 30 s for a hook |
| `browserTimeouts` | Tests in Vitest's browser mode | 60 s for a test, 60 s for a hook |
| `endToEndTimeouts` | End-to-end and visual tests, in Playwright | 60 s for a test, 10 s for an assertion that waits |

Spread them into each project's options:

```ts
// vitest.config.ts
import { browserTimeouts, unitTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          ...unitTimeouts,
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.browser.test.ts"],
        },
      },
      { test: { name: "browser", ...browserTimeouts, include: ["src/**/*.browser.test.ts"], browser: { /* … */ } } },
    ],
  },
});

// e2e/playwright.config.ts
import { endToEndTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";

export default defineConfig({ ...endToEndTimeouts, testDir: "tests" /* … */ });
```

`defineVisualConfig` already uses `endToEndTimeouts`.

- **A timeout catches a test that will never finish. It isn't a measure of speed.** A test that asserts timing, such as "cancelling stops within a second", uses its own clock or fake timers.
- **Where the numbers come from:** the unit limit is measured. Beside four busy processes per core, unit tests ran up to 9 times slower, and 16 times has been reported, so a test of 1.5 s on a quiet machine still fits. The browser and end-to-end limits are from the SDKs' practice, not measured under load.
- **Don't give a test its own limit,** unless it really does long work, such as running a compiler, starting another test runner, encoding a video or waiting out a real deadline. Then say why beside the limit:

  ```ts
  it("ships declarations that match", async () => {
    // …
    // Long work (ADR 0057): it runs the TypeScript compiler.
  }, 60_000);
  ```
- **A unit test that takes over 1.5 s on a quiet machine is the thing to look at:** split it, give it fewer cases, or mark it as long work.
- **Never raise a limit to get past a slow test without asking why it's slow.**

### Testing: `require-image`

A global setup that refuses to start browser tests outside the pinned browser test image ([ADR 0049](../../docs/adr/0049-local-browser-tests-in-the-pinned-image.md)). On a host, Docker's network changes make Chromium abort requests, and tests fail at random with errors that say nothing about the change under test. With the guard, running them the wrong way fails at once, with what to run instead:

```text
Error: Browser tests run only in the pinned browser test image (sdk-core ADR 0049).
On a host, Docker's network changes make Chromium abort requests, and tests fail at random.
Run them through hm-in-image, as the package scripts do: "pnpm test:browser" or "pnpm test:e2e",
or "pnpm exec hm-in-image <command>" for another command.
To debug with a headed browser on this machine, set HM_ALLOW_HOST_BROWSER=1 for that run. Never use it to check a change.
```

List it by its package path, in every configuration that starts a browser:

```ts
// vitest.config.ts: in the browser project only.
{
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.ts"],
    globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
    browser: { enabled: true, headless: true, provider: playwright(), instances: browserInstances(browsers) },
  },
}

// e2e/playwright.config.ts
import { webServersFor } from "@hussmartinez/sdk-config/testing/require-image";

export default defineConfig({
  globalSetup: "@hussmartinez/sdk-config/testing/require-image",
  webServer: webServersFor([
    {
      command: "node node_modules/vite/bin/vite.js preview --port 4310 --strictPort",
      cwd: "../examples/vite",
      url: "http://localhost:4310",
      reuseExistingServer: false,
    },
  ]),
  // …
});
```

**List an end-to-end configuration's web servers through `webServersFor`.** Playwright starts its web servers before the global setup. Without the helper, a run on a host builds and waits for every example's server before the guard speaks, or fails on a server first and never shows the guard's explanation. `webServersFor(servers)` returns the servers where browser tests can run, which is in the image, in CI and with `HM_ALLOW_HOST_BROWSER=1`, and an empty list where the guard will refuse. It takes one server, a list or `undefined`, always returns an array, and never throws, so the configuration loads anywhere.

`defineVisualConfig` needs no helper: it refuses outside the image as the configuration loads, before any server starts.

- **It runs only when a browser project starts.** A global setup belongs to its project, so `vitest run --project unit` on a host never reaches it, and the configuration itself loads anywhere, as editors and `tsc` need.
- **It allows the image and CI:** `HM_VISUAL_CONTAINER=1`, which `hm-in-image` and CI's verify jobs set, or `CI` set to anything but an empty string, `0` or `false`.
- **`HM_ALLOW_HOST_BROWSER=1` lets them start on a host, for debugging only,** such as watching a headed browser, which needs your display:

  ```sh
  HM_ALLOW_HOST_BROWSER=1 pnpm exec vitest --project browser --browser.headless=false
  ```

  The guard prints a notice when it's used. It changes nothing else, unlike setting `CI`, which also switches engines, retries and reporters. A run on a host can fail at random, so it never shows that a change works: don't put the variable in a script, a hook or a workflow. `hm-in-image` doesn't pass it on.
- **The visual configuration needs nothing added:** `defineVisualConfig` already refuses outside the image, and more strictly, because baselines must never be written anywhere else.
- **`browserTestImageProblem(env)`** returns the same message, or `undefined`, for a script of your own that starts a browser. `CONTAINER_ENV` and `ALLOW_HOST_ENV` are the two variables' names.

It needs nothing installed.

### Testing: `audioOutput`

For browser tests that need real-time audio output ([ADR 0043](../../docs/adr/0043-no-audio-output-in-firefox-tests.md)). Firefox in the family's test image has no sound server, so its `AudioContext` never starts. `audioOutput()` probes the browser once per test run and says whether audio plays at real-time speed, so every repository skips the same tests in the same way.

**Probe inside the tests that need audio, never at the top of a file.** The probe clicks a button, which gives the page user activation. A probe at the top level, such as `const audio = await audioOutput(…)` before an `it.skipIf`, runs while the file is collected, before any test. A test that checks autoplay, that audio stays silent until a gesture, would then see the gesture that the probe made, and could skip itself or pass for the wrong reason without any warning. Call it from each test that needs audio instead:

```ts
import { audioOutput } from "@hussmartinez/sdk-config/testing/audio-output";
import { type TestContext } from "vitest";
import { userEvent } from "vitest/browser";

/** Skips the calling test, with the reason, where the browser has no audio output. */
async function needAudio(context: TestContext): Promise<void> {
  const audio = await audioOutput({ activate: (button) => userEvent.click(button) });
  if (!audio.available) {
    context.skip(audio.reason.trim());
  }
}

it("keeps audio and video in sync", async (context) => {
  await needAudio(context);
  // …
});
```

Tests that check behaviour before any gesture, such as autoplay, run in a file that never calls `audioOutput()`, because the activation it grants lasts for the rest of the page.

It returns `{ available, reason, clockRatio }`. `reason` is empty when audio is available, and otherwise says why, such as ` (skipped: the AudioContext stays "suspended", so there's no audio output; sdk-core ADR 0043)`. It's test code only, with TypeScript declarations: import it only from tests.

### Testing: visual regression

For every SDK's editor and element ([ADR 0048](../../docs/adr/0048-visual-regression-for-sdk-editors.md)): screenshots of each designed state on the built example page, in light and dark and both densities, compared with committed baselines on Chromium, inside the browser test image that `ci/Dockerfile` pins.

`e2e/playwright.visual.config.ts` uses the preset, with the example's server as the end-to-end configuration has it:

```ts
import { defineVisualConfig } from "@hussmartinez/sdk-config/testing/visual";

export default defineVisualConfig({
  baseURL: "http://localhost:4320",
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --port 4320 --strictPort",
    cwd: "../examples/vite",
    url: "http://localhost:4320",
    reuseExistingServer: false,
  },
});
```

The preset fixes the page: a 1280 × 800 viewport at a device scale factor of 1, `en-US`, `UTC` and reduced motion, with text in [the family's fonts](#testing-fonts). Screenshots are taken without animations or carets. Specs live in `e2e/visual/`, and each state is captured in every variant:

```ts
import { expect, test } from "@playwright/test";
import { applyVisualVariant, visualVariants } from "@hussmartinez/sdk-config/testing/visual";

for (const variant of visualVariants) {
  test(`empty in ${variant.name}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-01-01T12:00:00Z"));
    await page.goto("/editor.html");
    await applyVisualVariant(page, variant);
    await expect(page).toHaveScreenshot(`empty-${variant.name}.png`);
  });
}
```

Baselines go to `e2e/visual/__screenshots__/<spec>/<state>-<theme>-<density>-chromium-linux.png`. Mask content that varies by nature with `toHaveScreenshot`'s `mask` option. A state may set `maxDiffPixelRatio` up to `0.001` only for a frame drawn by a codec that can't be masked, with a comment naming the cause.

**How strictly they're compared** ([ADR 0054](../../docs/adr/0054-visual-comparison-tolerance.md)): no pixel may differ, and a pixel counts as changed when its colour is further from the baseline's than one level (1/255) on every channel is, by the perceived-colour distance Playwright measures. The preset sets `maxDiffPixelRatio: 0` and `threshold: 0.0038`, exported as `visualComparison`.

- **It's a colour distance, not a bound per channel.** Playwright measures distance in YIQ space, which weighs channels as the eye does. Measured: one level on any channel passes, as do 24 of the 26 ways to move the three channels by at most one level, and two levels on blue alone. Red one level one way with green and blue the other is refused, and so are two levels on red, on green or on every channel.

- **Why not Playwright's default threshold, 0.2:** it doesn't count a colour token one step apart, text a few shades lighter, or a light border moved by a pixel.
- **Why not 0:** the same page, captured twice in the same image, differs by one level on some anti-aliased edges, so tests would fail at random.
- **Never raise it to make a test pass.** A screenshot that differs by more is a real change, or content to mask.
- **A known limit:** Playwright doesn't compare pixels it classifies as anti-aliasing, at any threshold. A change confined to the edges of text or of a rounded corner can pass.

Run it through `hm-test-visual`, after building the examples:

```json
{
  "scripts": {
    "test:visual": "hm-test-visual",
    "test:visual:update": "hm-test-visual --update"
  }
}
```

```text
Usage: hm-test-visual [--update]
```

- **Outside the image,** it needs Docker. It builds an image from `ci/Dockerfile`'s `FROM` line and the pnpm version in `packageManager`, and runs itself there. pnpm and its native binary are installed from tarballs checked against the integrity that `pnpm-lock.yaml` records for them, so the lockfile must come from that pnpm version. The container gets its own `node_modules` and pnpm store volumes, and hands every file it writes back to you. Without Docker, it fails with a one-line message saying how to fix it; it never skips.
- **Inside the image,** where `HM_VISUAL_CONTAINER=1`, as in CI's verify job, it runs Playwright directly. The preset refuses to run anywhere else, so baselines can't be written outside the image.
- **`--update`** rewrites the baselines that changed, and keeps the others byte for byte, so every image in a pull request's diff is one its own test calls different. It also adds new states' baselines and removes those no state produces any more. It runs the suite three times, which takes seconds each:
  1. with the committed baselines in place, to see which ones each assertion no longer accepts, by that assertion's own settings;
  2. with no baselines, to capture every state afresh, which Playwright only accepts once two captures in a row agree;
  3. against the result, as a plain test run, which must pass.

  It's all or nothing: unless all three pass, the baselines are left exactly as they were, and it says why. If an update is cancelled part-way, the next run of `hm-test-visual` puts them back first.
- **Failures** leave the expected, actual and diff images in `e2e/test-results/visual/`.

| Exit code | Meaning |
|---|---|
| 0 | Every screenshot matches, or the baselines were updated |
| 1 | A screenshot differs, a test fails, or Docker isn't available |
| 2 | Usage error, or a repository it can't read |

### `hm-check-playwright-image`

Fails when the repository's Playwright can differ from its browser test image's ([ADR 0025](../../docs/adr/0025-one-browser-test-image-in-one-place.md)). The image's browsers are built for one Playwright version, so `playwright` and `@playwright/test` are pinned exactly to the version in `ci/Dockerfile`'s tag, and move with it. Run it in `verify` and `verify:fast`:

```json
{ "scripts": { "check:playwright-image": "hm-check-playwright-image" } }
```

It reports:

- each locked `playwright`, `playwright-core` or `@playwright/test` whose version isn't the tag's, including one that another package brings;
- each specifier for them, in the pnpm catalog or a package.json, that isn't the tag's exact version, because a range like `^1.65.0` drifts at the next install.

```text
@playwright/test is specified as ^1.65.0 in the default catalog; pin it exactly to 1.65.0.
playwright 1.65.1 is locked, but ci/Dockerfile's image is Playwright 1.65.0.
```

It exits with 0 when everything matches, 1 when something differs, and 2 for a usage error or a repository it can't read. It replaces a repository's own `ci-image` test. That test's remaining case, that no workflow has an image of its own, is `sdk-ci`'s `check-workflows`.

**Dependabot** should propose the packages together, apart from other updates, and that pull request is merged together with the docker update for `ci/Dockerfile`:

```yaml
  - package-ecosystem: npm
    directory: /
    groups:
      playwright:
        patterns: ["playwright", "playwright-core", "@playwright/test"]
      npm:
        patterns: ["*"]
        exclude-patterns: ["playwright", "playwright-core", "@playwright/test"]
        update-types: [minor, patch]
```

Dependabot's `multi-ecosystem-groups` could put the docker and npm updates in a single pull request. It isn't used yet: GitHub's documentation doesn't say what it does to an npm entry's other dependencies, so it needs a trial in one repository first.

### `hm-in-image`

Runs a command in the browser test image that `ci/Dockerfile` pins, locally as CI does ([ADR 0049](../../docs/adr/0049-local-browser-tests-in-the-pinned-image.md)). On a host, Chromium aborts in-flight requests with `ERR_NETWORK_CHANGED` whenever Docker adds or removes a network interface, and browser tests fail at random. Inside the image, the host's network changes don't reach the browser. Use it for every browser step:

```json
{
  "scripts": {
    "test:browser": "hm-in-image vitest run --project browser",
    "test:browser:all": "hm-in-image vitest run --project browser --mode all-browsers",
    "test:e2e": "hm-in-image playwright test"
  }
}
```

```text
Usage: hm-in-image [--] <command> [<argument>...]
```

- **Outside the image,** it needs Docker:
  - it builds an image from `ci/Dockerfile`'s `FROM` line, with the pnpm that `packageManager` names, checked against the integrity in `pnpm-lock.yaml`;
  - it installs the locked dependencies into the container's own `node_modules` and pnpm store volumes, so the host's binaries never mix with the container's;
  - it runs the command through `pnpm exec`, in the same folder of the checkout, and hands every file the container wrote back to you.

  Without Docker, it fails with a one-line message saying how to fix it; it never skips.
- **Only these variables reach the container,** when they're set, and nothing else of your environment:

  | Variable | For |
  |---|---|
  | `CI`, `DEBUG` | What CI and debugging read, such as `DEBUG=pw:browser` |
  | `HM_BROWSER_DIAGNOSTICS` | The folder for [`browserInstances`](#testing-browserinstances)' net logs. It must be inside the checkout, and is passed as that folder's path in the container; a folder outside the checkout is a usage error |
  | `PLAYWRIGHT_BASE_URL`, `SMOKE_BASE_URL` | The origin an end-to-end or smoke suite tests instead of its own server |
  | `SMOKE_ENGINES`, `SMOKE_ANALYTICS` | Which engines a smoke suite runs, and whether it checks analytics |

  A URL on your machine's `localhost` isn't reachable from the container, which has its own. Point these at a deployed origin, or let the suite start its server inside the container.
- **Inside the image,** where `HM_VISUAL_CONTAINER=1`, it runs the command directly. CI's verify jobs set that variable, because they run in the image already.
- **One image and one set of volumes per repository,** `hm-browser-<workspace name>`, shared with `hm-test-visual`.

| Exit code | Meaning |
|---|---|
| The command's | The command ran |
| 1 | Docker isn't available, or the image didn't build |
| 2 | Usage error, or a repository it can't read |

### Size budgets: `entryBudget`, `importBudget` and `hm-size`

Every package has size budgets, measured by `size-limit` after a build ([ADR 0015](../../docs/adr/0015-verification-and-releases.md)). There are two kinds, and `@hussmartinez/sdk-config/size` writes both:

```js
// .size-limit.js
import { globSync } from "node:fs";
import { entryBudget, entryFiles, importBudget } from "@hussmartinez/sdk-config/size";

export default [
  // Ceilings: each entry, with the chunks it loads statically.
  entryBudget({ name: "Core (.)", entry: "dist/index.js", limit: "17 kB" }),
  entryBudget({ name: "React (./react)", entry: "dist/react.js", limit: "24 kB" }),
  // A chunk loaded later with import() is an entry of its own. Its name has a hash.
  {
    name: "Worker (lazy)",
    path: globSync("dist/lazy/worker-*.js").flatMap(entryFiles),
    brotli: true,
    limit: "60 kB",
    disablePlugins: ["@size-limit/esbuild"],
  },
  // Import budgets: what an application ships for one import.
  importBudget({ name: "Import: the floor, PdfError", entry: "dist/index.js", imports: "{ PdfError }", limit: "0.9 kB" }),
  importBudget({ name: "Import: createPdfSession", entry: "dist/index.js", imports: "{ createPdfSession }", limit: "7 kB" }),
  importBudget({ name: "Import: PdfEditor", entry: "dist/react.js", imports: "{ PdfEditor }", limit: "18.5 kB" }),
];
```

#### Entry ceilings ([ADR 0055](../../docs/adr/0055-what-the-size-budgets-measure.md))

`entryBudget` is a ceiling on the brotli size of a built entry and every chunk it imports statically, directly or through other chunks. `entryFiles(entry)` is that list of files, for a check you write yourself.

- **Only what the entry loads up front:** a chunk that only another entry imports isn't counted, and neither is one loaded later with `import()`, which an application receives only when it uses what the chunk holds.
- **A lazy chunk is an entry of its own.** Give it a budget through `entryFiles` too, as above, so the budget covers the chunk and whatever it imports statically. A plain glob counts only the files it matches, which is the whole cost only when the chunk imports nothing, as a worker inlined as a string does.
- **It replaces a copied function.** If your `.size-limit.js` has its own `loadedFiles`, delete it: `entryFiles("dist/index.js")` returns what `loadedFiles("index.js")` did.
- **It fails clearly before a build:** `dist/index.js doesn't exist. Build the package first.`
- **It measures the files as built,** which are unminified so that applications' bundlers can tree-shake and minify them. Measured across the family, the same files minified are a fifth to a quarter smaller, in every entry. The build already drops comments, so documentation never counts. Local names do, by tens of bytes: never shorten names to meet a budget.
- **`entryBudget` turns `size-limit`'s esbuild plugin off for its check,** so the ceiling still measures files once that plugin is installed for the import budgets. `size-limit` then labels every check "with all dependencies, minified and brotlied"; for a ceiling that's only a label.

#### Import budgets ([ADR 0056](../../docs/adr/0056-size-budgets-for-what-applications-import.md))

No application ships a whole entry: its bundler keeps what it imports. `importBudget` is a budget for one import, bundled and minified as an application ships it, through `@size-limit/esbuild`, which the repository installs beside `size-limit`.

- **Which entries:** those whose exports can be used apart, the core entry and the React entry. An entry that loads whole by design keeps its ceiling only: a stylesheet, a worker, an element or standalone entry.
- **Which imports, at least:**
  - **a floor,** the cheapest import a host would really make, such as the error class or the message catalogue. It catches code that leaks into everything;
  - **each heavy piece on its own,** an export over about 2 kB by itself;
  - **what a typical application imports,** such as the factories an editor uses together, or the editor component.
- **What's left out, and nothing else:** `react` and `react-dom`, the family's packages (`@hussmartinez/*`), and the entry's own lazy chunks, the `lazy/` folder beside it. Everything else an import brings is counted, including a third-party runtime dependency and anything inside it. Pass `ignore` for a package that puts its lazy chunks somewhere else.
- **How it's bundled:** as an ES module, with `process.env.NODE_ENV` defined as `"production"`, as an application's production build is and as `hm-size --import` measures. `@size-limit/esbuild` sets neither by itself, so `importBudget` does. To change the bundle further, pass `modifyEsbuildConfig`: it receives the configuration with both set, and what it returns is used.
- **Give it your own esbuild settings as an option, never by spreading.** `importBudget({ …, modifyEsbuildConfig })` runs your function after its own. Writing `{ ...importBudget(…), modifyEsbuildConfig }` instead replaces its own: the bundle is then a script, without the production define, read with your `tsconfig.json`, and with every unused name still counted, and the number says nothing about it. So `size-limit` fails when that happens, after printing its results:

  ```text
  An import budget was measured without importBudget's own esbuild settings (sdk-core ADR 0056): Import: PdfEditor.
    A configuration that writes { ...importBudget(…), modifyEsbuildConfig } replaces them.
    Pass the function to importBudget instead, which runs it after its own: importBudget({ …, modifyEsbuildConfig }).
  ```

  `entryBudget` refuses the option: a ceiling measures the built files and bundles nothing, so the function would never run.

  The check reports after `size-limit` has printed its results, which look fine until then. It works by noticing when `size-limit` reads a budget's import clause, so it depends on how `size-limit` does that: this package's tests run the real `size-limit` on such a configuration, and an upgrade of `size-limit` has to keep them passing.
- **Only what the import keeps:** names the bundle imports from a package left out of it, and never uses, are cut out of its import statements before it's measured, wherever in the bundle those statements are. esbuild leaves them in when their uses were tree-shaken away, so an import that used one thing from a shared chunk used to carry the chunk's whole list of names from `react` and the family's packages, which no application pays for. Nothing else in the bundle is changed, and a statement that loses no name stays as it was written, so the bundle never gets longer. Its compressed size usually goes down too, but can go up by a few bytes: a name that's cut may have been helping compress what follows. `hm-size --import` and `--exports` measure the same way.
- **Without the package's `tsconfig.json`.** An application's bundler never reads it. esbuild would find it from the built entry and follow its `paths`, back into source if they map an import there, so both `importBudget` and `hm-size` bundle with an empty one. A wrapper that sets `tsconfigRaw: "{}"` yourself can go.
- **Setting and raising one:** a limit is the measurement rounded up to the next 0.5 kB, raised in the pull request that needs it, with a table of the scenarios that moved.
- **A floor is different.** Its limit is set once, to its measurement rounded up to the next 0.1 kB, and then it isn't raised: a floor that grows means code has leaked into every import, which is fixed. It only moves down, in the pull request that makes the floor cheaper. The table shows every floor's size, moved or not.
- **A floor isn't raised for a few bytes of compression.** If a floor fails by a few bytes with no code added to what its import keeps, round it up by 0.1 kB, with a note saying why. That's the one case; a floor that grows by more is a leak.
- **Never raise a budget for code its import doesn't use.** If adding a component moves the floor, or another component's scenario, the change leaked, and the leak is fixed.

#### `hm-size`: what things cost

```text
Usage: hm-size <entry>...
       hm-size --exports <entry>
       hm-size --import <clause> [--kept] <entry>
```

It prints sizes, for a pull request's table and for finding what an import costs. It's never a budget, and it never fails because of a size.

- **`hm-size <entry>...`** prints what the ceiling counts, and the same files minified with Vite's minifier:

  ```text
  $ pnpm exec hm-size dist/index.js dist/element.js
  dist/index.js: 15.57 kB as built, 11.72 kB minified (25% less), in 2 files
  dist/element.js: 2.78 kB as built, 2.14 kB minified (23% less), in 2 files
  ```
- **`hm-size --exports <entry>`** prints what each export costs an application that imports only it, cheapest first. The last line names the floor:

  ```text
  $ pnpm exec hm-size --exports dist/index.js
  MAX_FILE_NAME_LENGTH     0.03 kB
  …
  createWorkerClient       3.22 kB
  dist/index.js: 33 exports; the floor is MAX_FILE_NAME_LENGTH, 0.03 kB
  ```

  **A floor close to the whole entry means the entry doesn't come apart:** any import brings most of it.
- **`hm-size --import "{ a, b }" --kept <entry>`** prints one import's cost and, with `--kept`, what it keeps in its bundle: the functions, and the calls at the top level whose result is assigned.

  ```text
  $ pnpm exec hm-size --import "{ editorMessages }" --kept dist/react.js
  dist/react.js: import { editorMessages } ships 40.40 kB
  It keeps 211 functions, and these top-level calls:
     18 × defineTool(…)
      2 × createContext(…)
  ```

  A bundler keeps such a call, and everything it refers to, unless it can prove the call has no effect. Mark a call that has none as `/* @__PURE__ */ defineTool(…)`, or move it into the function that needs it. `--kept` reads the bundle's text, so it's a guide to where to look.
- **Its numbers and `size-limit`'s:** the first form matches `size-limit` exactly. For an import, `size-limit` reports up to about 0.1 kB less, because it subtracts an empty bundle. Set a limit from `size-limit`'s number, and use `hm-size` to compare imports, and before with after.

`measureEntry`, `importCost`, `exportCosts` and `keptCode` return the same numbers to a script. The first needs `vite`, and the import measurements need `esbuild`; both are optional peer dependencies.

| Exit code | Meaning |
|---|---|
| 0 | The entries were measured |
| 2 | Usage error, or an entry that isn't built |

### `hm-check-hidden-unicode`

Fails when a text file holds a character that an editor and a diff don't show, or that reorders the text around it ([ADR 0052](../../docs/adr/0052-source-checks-for-hidden-characters-and-abort-listeners.md)). A reviewer can't see what such a line really holds: a right-to-left override makes code read differently from what runs ("Trojan Source"), and a zero-width character makes two names that look the same differ. They also arrive by accident, when a tool that writes a file turns an escape such as `\u202E` into the character itself.

```json
{
  "scripts": {
    "lint": "biome check . && hm-check-hidden-unicode"
  }
}
```

```text
Usage: hm-check-hidden-unicode [<file>...]
```

- **Without files,** it checks every file git tracks, of any type: source, Markdown, YAML, JSON. Binary files are skipped. Run it from the repository's root.
- **With files,** it checks those, which is how the [lint-staged preset](#commitlint-lint-staged-and-secretlint) runs it on every commit.
- **What it reports:**

  | Characters | Why |
  |---|---|
  | U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069 | Bidirectional formatting: they reorder what's shown |
  | U+00AD, U+180E, U+200B–U+200D, U+2060–U+2064, U+FEFF | Invisible: the soft hyphen, zero-width characters and the byte order mark |
  | U+2028, U+2029 | Line and paragraph separators, which only some tools break lines at |
  | U+E0000–U+E007F | Tag characters: invisible copies of ASCII, which can carry text nobody sees |

  Each one is reported with its place, name and the escape to write instead:

  ```text
  src/names.ts:12:27: hidden character U+202E RIGHT-TO-LEFT OVERRIDE. Write it as the escape \u202E, or remove it.
  ```
- **Write them as escapes** in source, such as `"\u202E"`, or build them with `String.fromCodePoint()`. Emoji that join with U+200D, such as a family, are written with the escape too.
- **Test data may hold them.** List paths that are allowed to in `.hm-hidden-unicode-ignore` at the root, a glob per line, with `#` comments:

  ```text
  # Files as they arrive from users.
  test/fixtures/**
  ```

  Keep the list to data. Source and documentation have no reason to be on it.

| Exit code | Meaning |
|---|---|
| 0 | No hidden characters |
| 1 | A file has a hidden character |
| 2 | Usage error, or files that can't be read |

### `hm-check-single-copy`

Fails when `pnpm-lock.yaml` resolves more than one version of any `@hussmartinez` package ([ADR 0047](../../docs/adr/0047-one-copy-of-each-family-package.md)), which [ADR 0036](../../docs/adr/0036-ui-as-a-dependency-of-the-sdks.md) forbids. Run it in `verify`:

```json
{ "scripts": { "check:single-copy": "hm-check-single-copy" } }
```

It names every version and what brings it:

```text
@hussmartinez/sdk-core resolves to 2 versions in pnpm-lock.yaml:
  0.3.0, through @hussmartinez/ui@0.5.0
  0.4.1, through the workspace (.)
```

Workspace links aren't copies, and versions that differ only in their peer dependencies count once.

```text
Usage: hm-check-single-copy [--scope <scope>]... [<lockfile>]
```

| Exit code | Meaning |
|---|---|
| 0 | Every package resolves to one version |
| 1 | A package resolves to more than one version |
| 2 | Usage error, or a lockfile that can't be read |

### commitlint, lint-staged and secretlint

The git hook rules of [ADR 0016](../../docs/adr/0016-git-hooks-and-merge-guards.md). commitlint accepts the same types and subject pattern as the `pr-title` workflow. lint-staged runs secretlint, [`hm-check-hidden-unicode`](#hm-check-hidden-unicode), Biome and stylelint on staged files.

```js
// commitlint.config.js
export { default } from "@hussmartinez/sdk-config/commitlint";

// lint-staged.config.js
export { default } from "@hussmartinez/sdk-config/lint-staged";
```

**A repository with React** adds [the React lint](#react-hm-lint-react) to the hook with `withReactLint`:

```js
// lint-staged.config.js
import { withReactLint } from "@hussmartinez/sdk-config/lint-staged";

export default withReactLint();
```

- **When it runs:** whenever a staged file is TypeScript under a `src` folder. After Biome, in the same list, so it reads what Biome left.
- **What it runs:** `hm-lint-react`, with no file named, over the whole of `src`, as `pnpm lint` does. The lint needs every file to judge one, and a command built from staged file names breaks on a name with a space, since lint-staged splits a task's command at spaces.
- **Your own configuration:** `withReactLint(yours)` adds the step to the end of its `"!(*.css)"` list, and returns a new object.
- **Source that isn't under `src` at the root:** name where it is, and the step lints there, when a staged file is under one of those folders:

  ```js
  export default withReactLint(undefined, { paths: ["packages/ui/src"] });
  ```

  Without `paths`, the step runs bare `hm-lint-react`, which fails in such a repository because it reads no file. A folder's name can't have a space in it, since lint-staged splits a command at spaces.
- **Replacing a function of your own:** if your `lint-staged.config.js` has a hand-written function that runs plain `hm-lint-react`, delete it and use this. Keep yours if it passes options, such as `--config` or its own paths: this step runs the command with none, so it reads `eslint.config.js` and lints `src`.

secretlint loads its configuration as CommonJS:

```js
// .secretlintrc.cjs
module.exports = require("@hussmartinez/sdk-config/secretlint").default;
```

## License

[Apache-2.0](../../LICENSE)
