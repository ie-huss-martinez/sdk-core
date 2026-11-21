# @hussmartinez/sdk-config

## 0.13.4

### Patch Changes

- [#188](https://github.com/ie-huss-martinez/sdk-core/pull/188) [`c9d5d22`](https://github.com/ie-huss-martinez/sdk-core/commit/c9d5d224fa5b221a744f4305644d745fb7762711) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `size-limit` now fails when an import budget is measured without `importBudget`'s own esbuild settings, instead of reporting a number that looks like any other.
  
  **What could go wrong.** A configuration that wrote `{ ...importBudget(…), modifyEsbuildConfig: mine }` replaced the budget's own `modifyEsbuildConfig` rather than adding to it. The bundle was then built as a script, without the production define, read with the package's `tsconfig.json`, and with every unused import name still counted. `ui` ran that way for a release and missed 0.12.1's correction, with nothing to show it.
  
  **What happens now.** When `size-limit` builds an import budget's bundle and the budget's own settings weren't applied, the run fails after printing its results, naming the budgets:
  
  ```text
  An import budget was measured without importBudget's own esbuild settings (sdk-core ADR 0056): Import: PdfEditor.
  ```
  
  **If your check starts failing with that message,** pass your function to `importBudget` as an option, which runs it after its own:
  
  ```js
  // Before: replaces importBudget's settings.
  { ...importBudget({ name, entry, imports, limit }), modifyEsbuildConfig: mine }
  
  // After: runs both.
  importBudget({ name, entry, imports, limit, modifyEsbuildConfig: mine })
  ```
  
  Two smaller changes with it:
  
  - **`entryBudget` refuses `modifyEsbuildConfig`,** with a `TypeError`. A ceiling measures the built files and bundles nothing, so the function never ran there.
  - **`importBudget`'s `import` field is now an object,** `{ [entry]: clause }`, where it was the clause's text. `size-limit` reads both the same way and the numbers don't change. If your configuration reads that field itself, read `check.import[entry]`.

## 0.13.3

### Patch Changes

- [#186](https://github.com/ie-huss-martinez/sdk-core/pull/186) [`197332f`](https://github.com/ie-huss-martinez/sdk-core/commit/197332fbea8190607cb7429d5e1487197bbb1c1e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The React lint in the commit hook, without a function of your own. Two changes, for repositories that adopted `hm-lint-react`:
  
  **The lint-staged preset ships the step.** `withReactLint` adds it after Biome:
  
  ```js
  // lint-staged.config.js
  import { withReactLint } from "@hussmartinez/sdk-config/lint-staged";
  
  export default withReactLint();
  ```
  
  Whenever a staged file is TypeScript under a `src` folder, it runs `hm-lint-react` with no file named, over the whole of `src`. Naming no file is on purpose: the lint needs every file to judge one, lint-staged splits a task's command at spaces in file names, and the check for `src` reads paths with either kind of separator, so it works on Windows. `withReactLint(yours)` adds the step to your own configuration's `"!(*.css)"` list.
  
  **To migrate:** if your `lint-staged.config.js` has a hand-written function that runs plain `hm-lint-react`, delete it and use `withReactLint()`. If yours passes options, such as `--config` for a configuration under another name, or its own paths, keep it: the preset's step runs the command with none.
  
  **`hm-lint-react` skips a file it's given that its configuration leaves out,** such as a test or a story, as ESLint's `--no-warn-ignored` does. It used to report the file as ignored and exit 1. With only such files given, it says there's nothing to lint and exits 0. A path that doesn't exist still fails, and so does a folder with nothing in it to lint.

## 0.13.2

### Patch Changes

- [#184](https://github.com/ie-huss-martinez/sdk-core/pull/184) [`1d8bcf2`](https://github.com/ie-huss-martinez/sdk-core/commit/1d8bcf2a855768a116675631bcdd546b595c1ec8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Three fixes to how `importBudget` and `hm-size` measure an import, found by image-sdk.
  
  **Unused names are now cut from every import statement, not only those at the top of a bundle.** esbuild writes a module's imports where that module's code starts, so a large bundle has import statements deep inside it, and those kept their unused names. In image-sdk, the React scenarios read 0.4 to 0.6 kB lower for it; its floors and its core scenarios don't move.
  
  **A correction to 0.12.1's note.** It said every number would stay the same or go down. That's true of a bundle's bytes, and a new test holds it: a rewritten bundle is never longer than the one esbuild built, and a statement that loses no name stays exactly as written. It isn't true of the compressed size, which is what a budget counts. Cutting names can make a bundle a few bytes larger compressed, because the names had been helping compress the text after them: 10 B, in one of image-sdk's scenarios.
  
  **`hm-size --import` and `--exports` no longer read the package's `tsconfig.json`,** and neither does `importBudget`'s check. esbuild found it from the built entry and followed its `paths`; in a package that maps an import to source there, for the type checker, the bundle failed. An application's bundler never reads that file. If your `.size-limit.js` wraps `importBudget` to set `tsconfigRaw: "{}"`, the wrapper can go.
  
  **When you take this release:**
  
  - Run `pnpm check:size`. Lower each floor that dropped by 0.1 kB or more to its new measurement rounded up to the next 0.1 kB, and other import budgets, if you like, to theirs rounded up to the next 0.5 kB.
  - **Never raise a floor for a few bytes of compression.** If one fails by a few bytes with no code added to what its import keeps, round it up by 0.1 kB, with a note saying why.

## 0.13.1

### Patch Changes

- [#182](https://github.com/ie-huss-martinez/sdk-core/pull/182) [`b3f7097`](https://github.com/ie-huss-martinez/sdk-core/commit/b3f7097d5e6551ed12b15f5f5694776138156e03) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `hm-check-bundled-engines` no longer turns itself off when a repository builds on what `defineDependencyRules` returns, and it now fails when it finds no engine to check.
  
  **What went wrong.** The declared engines were kept on the configuration as a hidden property. Spreading the configuration into a new object, to add an option, lost them. The check then printed "No bundled engines are declared" and passed.
  
  **What changed:**
  
  - **The engines are read back from the rules themselves,** so a copy of the configuration has them however it's made: spread, `structuredClone`, or written out and read back. Build on the result and keep its `forbidden` rules:
  
    ```js
    const rules = defineDependencyRules({ bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }] });
  
    export default {
      ...rules,
      forbidden: [...rules.forbidden, myOwnRule],
      options: { ...rules.options, exclude: { path: ["generated/"] } },
    };
    ```
  
  - **Finding no engine fails the check.** If your package bundles none and still runs `hm-check-bundled-engines`, say so: `defineDependencyRules({ bundledEngines: [] })`. Leaving the option out says nothing either way, and the check then fails with what to write.
  
  **If your check starts failing after this release,** it was passing without checking anything. Either your engines' declaration wasn't reaching it, which this release fixes for a spread configuration, or the package declares none and needs `bundledEngines: []`.
  
  `bundledEnginesOf(configuration)` now returns one entry per package and folder, and there's a new `declaresNoBundledEngines(configuration)`.

## 0.13.0

### Minor Changes

- [#180](https://github.com/ie-huss-martinez/sdk-core/pull/180) [`f31a9d3`](https://github.com/ie-huss-martinez/sdk-core/commit/f31a9d3e7293f89073b7578012ba2d12ce901fb9) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A lint for what React components do while they render (sdk-core ADR 0063), and **the Biome preset no longer checks hook dependency lists: in a repository with React, add `hm-lint-react` in the pull request that takes this release.**
  
  Biome doesn't check that rendering is pure: no reading or writing a ref, no impure call, no setting state while a component renders. React's own plugin, `eslint-plugin-react-hooks`, does. So there's a new entry, `@hussmartinez/sdk-config/eslint-react`, and a command, `hm-lint-react`: ESLint with that one plugin and nothing else. Biome stays the linter and formatter.
  
  **In a repository with React:**
  
  1. Install the three packages, pinned exactly: `pnpm add --save-dev --save-exact eslint eslint-plugin-react-hooks @typescript-eslint/parser`. They're optional peer dependencies.
  2. Add `eslint.config.js`:
  
     ```js
     import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";
  
     export default await defineReactLint({
       // Rules you still have findings for, each with its backlog item.
       off: ["refs"],
     });
     ```
  
  3. Add `hm-lint-react` to your `lint` script.
  4. Turn off, by name, exactly the rules you have findings for: `refs`, `immutability`, `set-state-in-effect`, `exhaustive-deps` or `preserve-manual-memoization`. A rule is an error or it's off, never a warning. Fix them in later pull requests, and take each name out in the one that fixes it. Change no source in this pull request.
  5. **If `exhaustive-deps` is in your `off` list,** turn Biome's rule back on in your own `biome.json`, `"correctness": { "useExhaustiveDependencies": "error" }`, until it isn't, so that published source's dependency lists are still checked.
  
  **What changed in the Biome preset:** `useExhaustiveDependencies` is off for published source. Tests (`*.test.*`) and stories (`*.stories.*`), which the plugin doesn't read, keep it. The plugin's rule replaces it: it also reports a dependency made anew on every render, which Biome's doesn't, and with one rule a deliberate exception is suppressed once. When you turn the plugin's rule on, move your `biome-ignore lint/correctness/useExhaustiveDependencies` comments to `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>`. `hm-lint-react` fails on a suppression without a reason.
  
  **In a repository without React:** nothing to do, and nothing to install.

## 0.12.3

### Patch Changes

- [#177](https://github.com/ie-huss-martinez/sdk-core/pull/177) [`b2d5e57`](https://github.com/ie-huss-martinez/sdk-core/commit/b2d5e57860e3296f5f5a08714064495f0542e18e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A new test entry, `@hussmartinez/sdk-config/testing/firefox-labelled-by`: the family's guard against a crash in Playwright's Firefox 159 (ui#61), in place of each repository's own copy.
  
  That Firefox crashes the page when an element's `ariaLabelledByElements` is read from two JavaScript worlds. Playwright's locators by role or label read it in one, and so does Vitest's `userEvent`; axe-core reads it in the other. So a click by accessible name and an axe run on the same page crash it. The guard removes the property from the page, in Firefox only, before any script runs; axe then resolves `aria-labelledby` by ID and reports the same results.
  
  **In a Vitest browser project:**
  
  ```ts
  setupFiles: ["@hussmartinez/sdk-config/testing/firefox-labelled-by/setup"],
  ```
  
  **In Playwright's end-to-end tests:**
  
  ```ts
  // e2e/fixtures.ts
  import { test as base } from "@playwright/test";
  import { withFirefoxLabelledByGuard } from "@hussmartinez/sdk-config/testing/firefox-labelled-by";
  
  export const test = withFirefoxLabelledByGuard(base);
  ```
  
  **To adopt:** add those where your tests click by accessible name and run axe, and delete your own `delete Element.prototype.ariaLabelledByElements` setup file or fixture. Nothing changes until you do.
  
  The entry also exports `removeLabelledByElements()` and `CRASHING_FIREFOX`. A test in `sdk-config` fails when the pinned Playwright brings another Firefox, so the guard is re-checked then and removed once the crash is fixed.

## 0.12.2

### Patch Changes

- [#175](https://github.com/ie-huss-martinez/sdk-core/pull/175) [`3aceb86`](https://github.com/ie-huss-martinez/sdk-core/commit/3aceb86f72252e67ecb213bb3a2866032fb628d2) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `importBudget` and `hm-size` no longer risk measuring an import too small. To find the names a bundle imports and never uses, they read the bundle as JavaScript, which it is, instead of as TypeScript.
  
  Read as TypeScript, `limit<maximum>(strict || 1)` is a call with a type argument rather than two comparisons, so a name used only in the middle of such an expression looked unused and was cut from the measurement. A floor that measures too small hides the leaks it exists to catch. It needed that exact shape in a minified bundle, so no budget is known to have been affected, and you have nothing to change.

## 0.12.1

### Patch Changes

- [#173](https://github.com/ie-huss-martinez/sdk-core/pull/173) [`e847a08`](https://github.com/ie-huss-martinez/sdk-core/commit/e847a081e47e3824890db119c31c46a0eb9fd835) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `importBudget`, `hm-size --import` and `hm-size --exports` now measure only what an import keeps. They no longer count the names a bundle imports from a package left out of it and never uses.
  
  esbuild drops a name a file imports and doesn't use, but only as it reads that file. A name whose uses were tree-shaken away afterwards stayed in the import statement. So a scenario that used one thing from a shared chunk carried the chunk's whole list of names from `react` and from the family's packages. No application pays for that list: its bundler resolves the package and the names are gone. Two things followed:
  
  - **Floors read far too high.** In image-sdk, the React floor's bundle was 1,712 bytes, of which 1,465 were unused names. It measured 704 B; what it keeps is 126 B.
  - **A floor moved without a leak.** When a shared chunk imported two more names from sdk-core, every React scenario grew, with no code added to what any import keeps.
  
  The unused names are now cut out of the bundle's import statements before it's measured. Nothing else in the bundle is changed, so **every number stays the same or goes down, and no check turns red.**
  
  **When you take this release, lower your floors.** Run `pnpm check:size`, and set each floor to its new measurement rounded up to the next 0.1 kB, as sdk-core ADR 0056 has it: a floor that's left too high can't notice a small leak. Other import budgets may be lowered to their measurement rounded up to the next 0.5 kB. Scenarios whose imports use everything their chunk imports don't move.

## 0.12.0

### Minor Changes

- [#171](https://github.com/ie-huss-martinez/sdk-core/pull/171) [`fb36eeb`](https://github.com/ie-huss-martinez/sdk-core/commit/fb36eeb51deff3b0168bcbbfc729c8c8bea80265) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Browser tests now render text in fonts with a real bold face (sdk-core ADR 0062). **Taking this release changes every screenshot with text in it: retake your baselines in the same pull request.**
  
  In the pinned browser test image, `system-ui` resolved to a font with one style. `ui`'s text asks for `system-ui` first, so every label was drawn in it, and in Chromium text at weight 600 came out as the same pixels as regular text. A lost font weight couldn't show in a screenshot.
  
  `sdk-config` now ships a fontconfig file that prefers the Liberation fonts the image already has: Liberation Sans for `system-ui` and `sans-serif`, Liberation Serif for `serif`, and Liberation Mono for `monospace` and `ui-monospace`. The image itself doesn't change.
  
  - **`defineVisualConfig` and `browserInstances` pass it** to every browser they launch in the image. You change nothing for those.
  - **A configuration that launches browsers its own way** takes the same environment from the new entry, `@hussmartinez/sdk-config/testing/fonts`. Add it to your end-to-end configuration, so end-to-end tests lay text out as screenshots do:
  
    ```ts
    // e2e/playwright.config.ts
    import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";
  
    export default defineConfig({
      use: { launchOptions: { env: fontLaunchEnv() } },
    });
    ```
  
    `fontLaunchEnv()` returns the whole environment, the process's own with the file added. Never pass the one variable alone: Playwright replaces the browser's environment, so the browser would lose `DISPLAY` and the rest. The entry also exports `FONT_CONFIG_FILE`, `FONT_CONFIG_ENV` and `usesFontRules()`.
  - **Only in the image,** where `HM_VISUAL_CONTAINER=1`. On your own machine, a browser keeps your fonts.
  
  **To adopt:**
  
  1. Take the release, and add `fontLaunchEnv()` to any configuration that launches browsers without the presets.
  2. Run `pnpm test:visual:update`, and commit the baselines in the same pull request.
  3. Say in it that the font is the cause. Text changes everywhere. Where a label got wider or narrower, or now wraps, what's beside or below it moves too: explain each such move by the font, because anything that can't be is a real difference.
  4. A browser or end-to-end test that asserts a text's size in pixels may need its number updated, for the same reason.
  
  Liberation has two weights, so 400 and 500 draw alike, and 600 and 700 draw alike.

## 0.11.6

### Patch Changes

- [#168](https://github.com/ie-huss-martinez/sdk-core/pull/168) [`51b1792`](https://github.com/ie-huss-martinez/sdk-core/commit/51b1792587f9e104adb60b970e7f7d5f7575c822) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `@hussmartinez/sdk-config/dependency-cruiser` now exports `defineDependencyRules`, and there's a new command, `hm-check-bundled-engines` (sdk-core ADR 0061). Together they replace the exception each SDK with a bundled engine wrote by hand.
  
  **Declaring engines.** An SDK that builds a third-party engine into its package names it, with the one folder that wraps it:
  
  ```js
  // .dependency-cruiser.js
  import { defineDependencyRules } from "@hussmartinez/sdk-config/dependency-cruiser";
  
  export default defineDependencyRules({
    bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }],
    virtualModules: ["virtual:hm-pdfjs-data"],
  });
  ```
  
  - Only that folder may import the engine, **as a value or as a type**, and it may import no other devDependency. A hand-written exception allowed type-only imports from anywhere; this doesn't.
  - A folder must be under `src/adapters/` or `src/workers/`. An engine that two folders import gets two entries.
  - `virtualModules` names modules your build generates, exactly.
  
  **Checking the pins.** Add `hm-check-bundled-engines` to `verify`. It fails when a declared engine isn't in `devDependencies`, is also in `dependencies`, `peerDependencies` or `optionalDependencies`, or isn't one exact version. A `catalog:` version counts by what `pnpm-workspace.yaml` gives.
  
  **To adopt,** in your own pull request: delete the code in `.dependency-cruiser.js` that looks `not-to-dev-dep` up by name, declare your engines instead, and add the command. Nothing changes until you do: the default export is the same preset, and a hand-written exception keeps working.
  
  **One change for everyone:** the preset now allows `@hussmartinez/<package>/styles.css?url` from test code (test files, and anything under `test/` or `tests/`), which browser tests use to load a stylesheet with Vite. If you have your own `STYLESHEET_URLS` exception, you can delete it. Outside test code, that import is reported by a new rule, `stylesheet-url-only-in-tests`; before, it was reported by `not-to-unresolvable`, so nothing that passed now fails.

## 0.11.5

### Patch Changes

- [#164](https://github.com/ie-huss-martinez/sdk-core/pull/164) [`4d9973c`](https://github.com/ie-huss-martinez/sdk-core/commit/4d9973c5456b8bd1bed6ac887ff54300022b3dd5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `importBudget`'s checks now bundle the way an application's production build does, and the way `hm-size --import` already measured: as an ES module, with `process.env.NODE_ENV` defined as `"production"`.
  
  `@size-limit/esbuild` sets neither by itself. Its bundle was wrapped in a function, as a script for a page is, and whether development-only code was dropped depended on esbuild's own default, which only applies when a bundle is fully minified.
  
  **Measurements shift slightly.** sdk-core's import scenarios read 0 to 0.02 kB smaller without the wrapper, and `ui` saw its own move by 0.01 to 0.05 kB either way. When you take this release, run `pnpm check:size` and re-check your floors: a floor is its measurement rounded up to the next 0.1 kB, so one that now measures under the step below moves down, as sdk-core's did from 0.4 kB to 0.3 kB.
  
  `importBudget` also takes `modifyEsbuildConfig`, for a package that needs to change the bundle further. It receives the configuration with the format and the define already set, and what it returns is used:
  
  ```js
  importBudget({
    name: "Import: the floor",
    entry: "dist/index.js",
    imports: "{ PdfError }",
    limit: "0.9 kB",
    modifyEsbuildConfig: (config) => ({ ...config, define: { ...config.define, __DEV__: "false" } }),
  });
  ```
  
  If your `.size-limit.js` spreads `importBudget(...)` and sets its own `modifyEsbuildConfig` beside it, pass it as the option instead, or it replaces this one.

## 0.11.4

### Patch Changes

- [#162](https://github.com/ie-huss-martinez/sdk-core/pull/162) [`770a7d5`](https://github.com/ie-huss-martinez/sdk-core/commit/770a7d519b3d63da573fe07e69db8c937185f51e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `@hussmartinez/sdk-config/testing/require-image` now exports `webServersFor(servers)`, for a Playwright configuration's `webServer`.
  
  Playwright starts its web servers before the global setup, so on a host the guard only refused after every example's server had been built and waited for, or a server failed first and the guard's explanation never appeared. `webServersFor` returns the servers where browser tests can run (in the browser test image, in CI, and with `HM_ALLOW_HOST_BROWSER=1`) and an empty list where the guard will refuse, so the guard's message is the first and only thing shown. It takes one server, a list or `undefined`, always returns an array, and never throws.
  
  To adopt, wrap the list in each `e2e/playwright.config.ts` that names the guard, and remove any local copy of this check:
  
  ```ts
  import { webServersFor } from "@hussmartinez/sdk-config/testing/require-image";
  
  export default defineConfig({
    globalSetup: "@hussmartinez/sdk-config/testing/require-image",
    webServer: webServersFor([{ command: "…", url: "http://localhost:4310" }]),
  });
  ```
  
  `defineVisualConfig` is unchanged: it already refuses outside the image as the configuration loads, before any server starts.

## 0.11.3

### Patch Changes

- [#158](https://github.com/ie-huss-martinez/sdk-core/pull/158) [`0b0d6ff`](https://github.com/ie-huss-martinez/sdk-core/commit/0b0d6ffaf27818fc15d308ce6142fa216fc52661) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `@hussmartinez/sdk-config/testing/timeouts`, the family's test timeouts (sdk-core ADR 0057), so a test doesn't fail only because the machine was busy, and no repository writes the numbers.
  
  ```ts
  import {
    browserTimeouts,   // Vitest browser mode: 60 s for a test and for a hook
    endToEndTimeouts,  // Playwright: 60 s for a test, 10 s for an assertion that waits
    unitTimeouts,      // Vitest on Node: 30 s for a test and for a hook
  } from "@hussmartinez/sdk-config/testing/timeouts";
  
  // vitest.config.ts
  { test: { name: "unit", ...unitTimeouts, include: ["src/**/*.test.ts"] } }
  
  // e2e/playwright.config.ts
  export default defineConfig({ ...endToEndTimeouts, testDir: "tests" });
  ```
  
  **To adopt:** spread them into each Vitest project and Playwright configuration, and remove the limits your tests carry individually. Keep one only where a test really does long work, such as encoding a video or waiting out a real deadline, with a comment saying why. A timeout only catches a hang: a test that asserts timing uses its own clock.
  
  **`defineVisualConfig` now uses `endToEndTimeouts`:** visual tests get 60 s instead of Playwright's 30 s, and waiting assertions 10 s instead of 5 s. A visual test that passes today still passes.

## 0.11.2

### Patch Changes

- [#155](https://github.com/ie-huss-martinez/sdk-core/pull/155) [`42d2b56`](https://github.com/ie-huss-martinez/sdk-core/commit/42d2b5672eae37a3e1af2982f20881f648e9530c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add import budgets and import costs to `@hussmartinez/sdk-config/size` and `hm-size` (sdk-core ADR 0056).
  
  **`importBudget({ name, entry, imports, limit })`** writes a `size-limit` check for what an application ships when it imports part of an entry: bundled and minified, without `react`, `react-dom`, the family's packages and the entry's own lazy chunks (the `lazy/` folder beside it). Everything else the import brings is counted, including a third-party dependency. It needs `@size-limit/esbuild` beside `size-limit`.
  
  **`entryBudget({ name, entry, limit })`** writes an entry's ceiling, as `entryFiles` did by hand, and turns the esbuild plugin off for it, so the ceiling keeps measuring the built files once that plugin is installed.
  
  ```js
  import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";
  
  export default [
    entryBudget({ name: "Core (.)", entry: "dist/index.js", limit: "17 kB" }),
    importBudget({ name: "Import: the floor, PdfError", entry: "dist/index.js", imports: "{ PdfError }", limit: "0.9 kB" }),
  ];
  ```
  
  **`hm-size` shows what imports cost:**
  
  - `hm-size --exports dist/react.js` prints what each export costs an application that imports only it, cheapest first, and names the floor. A floor close to the whole entry means the entry doesn't come apart.
  - `hm-size --import "{ a, b }" --kept dist/react.js` prints one import's cost and what it keeps in its bundle: the functions, and the top-level calls that hold code, such as `defineTool(…)` without `/* @__PURE__ */`.
  
  `importCost`, `exportCosts` and `keptCode` return the same to a script. They need `esbuild`, now an optional peer dependency.
  
  Nothing changes for a repository that doesn't use them. To adopt: add `@size-limit/esbuild`, give each core and React entry a floor, each export over about 2 kB, and a typical application's set, and set each limit from `size-limit`'s number.

## 0.11.1

### Patch Changes

- [#152](https://github.com/ie-huss-martinez/sdk-core/pull/152) [`589ea92`](https://github.com/ie-huss-martinez/sdk-core/commit/589ea92b28c2788e2bf24d2b6c064e3ae46a7403) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `@hussmartinez/sdk-config/size` and the `hm-size` command, for size budgets (sdk-core ADR 0055).
  
  **`entryFiles(entry)`** lists the files a built entry loads up front: the entry and every chunk it imports statically, directly or through other chunks. It's what an entry's `size-limit` budget should count. If your `.size-limit.js` carries its own `loadedFiles` function, replace it:
  
  ```js
  import { entryFiles } from "@hussmartinez/sdk-config/size";
  
  export default [
    { name: "Core (.)", path: entryFiles("dist/index.js"), brotli: true, limit: "17 kB" },
  ];
  ```
  
  `entryFiles("dist/index.js")` returns what `loadedFiles("index.js")` did, so no budget changes. Unlike the copies, it fails with a clear message when the package isn't built, instead of returning nothing.
  
  **`hm-size <entry>...`** prints each entry's size as its budget counts it, and the same files minified, for the table in a pull request that raises a budget:
  
  ```text
  dist/index.js: 15.57 kB as built, 11.72 kB minified (25% less), in 2 files
  ```
  
  The minified number is information only. It's never a budget, and the command never fails because of a size. It uses Vite's minifier, so it needs `vite`, now an optional peer dependency. `measureEntry(entry)` returns both numbers to a script.

## 0.11.0

### Minor Changes

- [#148](https://github.com/ie-huss-martinez/sdk-core/pull/148) [`6eadcfe`](https://github.com/ie-huss-martinez/sdk-core/commit/6eadcfe2b814e3323708978e0ab75fe2cf433573) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Compare screenshots strictly, and keep unchanged baselines when updating (sdk-core ADR 0054). This is a minor release because it can fail visual tests that pass today: take it in a pull request of its own.
  
  **The visual preset now sets `threshold: 0.0038`** beside `maxDiffPixelRatio: 0`, exported as `visualComparison`. Until now it left Playwright's default threshold of 0.2, under which a colour token one step apart, text a few shades lighter, or a light border moved by a pixel counted as no difference at all. Now a pixel counts as changed when its colour is further from the baseline's than one level (1/255) on every channel is, by the perceived-colour distance Playwright measures (YIQ colour space). It isn't a bound per channel: one level on any channel passes, and so does two levels on blue alone, while two levels on red, on green or on every channel are refused. One level is the noise the browser test image shows between two captures of the same page.
  
  **What to expect when you update:** run `pnpm test:visual`. Every failure is a difference the old threshold was hiding. For each one, look at the diff image in `e2e/test-results/visual/`:
  
  - if it shows a mistake in the code, fix it;
  - if the committed baseline is simply out of date, run `pnpm test:visual:update` and commit the new image.
  
  Don't raise the threshold, and don't add `maxDiffPixelRatio` to a state, to get past a failure. Content that really varies is masked, as before.
  
  **`hm-test-visual --update` now rewrites only the baselines that changed.** It used to capture every baseline afresh, so pull requests carried images that differed from `main` only by rendering noise. Now a baseline its own assertion still accepts is kept byte for byte, new states are added and stale baselines removed, as before. It runs the suite three times and is all or nothing: if a state never settles, or the result doesn't pass a plain run, the baselines are left exactly as they were. Nothing changes in how you call it.
  
  **A known limit, unchanged:** Playwright doesn't compare pixels it classifies as anti-aliasing, so a change confined to the edges of text or of a rounded corner can still pass.

## 0.10.0

### Minor Changes

- [#144](https://github.com/ie-huss-martinez/sdk-core/pull/144) [`d19178d`](https://github.com/ie-huss-martinez/sdk-core/commit/d19178d14e74dbf6584ea3783c712b8b49fc5592) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add two source checks for the whole family (sdk-core ADR 0052). Both are on as soon as you update, through the lint-staged and Biome presets, so this is a minor release: take it in a pull request of its own, and expect to fix or list what it finds.
  
  **What to expect when you update:**
  
  - **Commits are checked for hidden characters** at once, by the lint-staged preset. `pnpm lint` checks the whole repository once you add the command to it.
  - **`biome check` may report `"abort"` listeners** you have today, through the preset's new plugin.
  - **Repositories with hidden characters on 2026-11-21:** image-sdk (19: its conformance vectors, two regular expressions in `src/core`, and three layer tests) and learn-sdk (130: its conformance vectors and two test generators). pdf-sdk, audio-sdk, video-sdk, ui, editor-apps and chat-example have none.
  - **How to settle each finding:** in source and tests, write the character as an escape, which changes nothing at run time. Conformance vectors and other test data that must hold the characters go in `.hm-hidden-unicode-ignore`, or their generator writes escapes.
  
  **`hm-check-hidden-unicode`,** a new command. It fails when a tracked text file of any type holds a character that an editor and a diff don't show, or that reorders the text around it: bidirectional formatting characters, zero-width and other invisible characters, line and paragraph separators, and tag characters. Each is reported with its place, its name and the escape to write instead:
  
  ```text
  src/names.ts:12:27: hidden character U+202E RIGHT-TO-LEFT OVERRIDE. Write it as the escape \u202E, or remove it.
  ```
  
  Add it to your `lint` script: `"lint": "biome check . && hm-check-hidden-unicode"`. Write such characters as escapes in source. Test data that must hold them is listed, by glob, in `.hm-hidden-unicode-ignore` at the repository's root.
  
  **The lint-staged preset now runs `hm-check-hidden-unicode`** on staged files, after the secret scan. This starts as soon as you update: a commit that stages a file with a hidden character is refused until the character is written as an escape, or the file's path is in `.hm-hidden-unicode-ignore`.
  
  **The Biome preset now includes a plugin, `noUncheckedAbortListener`.** An `"abort"` listener added to a signal that has already aborted never fires. The rule reports `signal.addEventListener("abort", …)` unless a function around it also reads the same signal's `aborted`, calls its `throwIfAborted()`, or passes it to a `throwIfAborted()` helper. This also starts as soon as you update, so `biome check` may report listeners you have today. For each one: check `signal.aborted` first, use `AbortSignal.any()` instead of listening, or, when a caller already guarantees the signal isn't aborted, say so:
  
  ```ts
  // biome-ignore lint/plugin/noUncheckedAbortListener: call() refuses an aborted signal first.
  signal.addEventListener("abort", onAbort, { once: true });
  ```

## 0.9.2

### Patch Changes

- [#142](https://github.com/ie-huss-martinez/sdk-core/pull/142) [`7371e93`](https://github.com/ie-huss-martinez/sdk-core/commit/7371e9330af4c7a4efc23435b0537299bb6dd74f) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add a guard against browser tests outside the browser test image, and pass more of the environment through `hm-in-image` (sdk-core ADR 0049, as amended).
  
  **`@hussmartinez/sdk-config/testing/require-image`,** a global setup that refuses to start browser tests on a host, where Docker's network changes make them fail at random. It fails at once, saying to use `hm-in-image`. It allows the image (`HM_VISUAL_CONTAINER=1`) and CI (`CI` set), and it never runs for a unit project. Add it to every configuration that starts a browser:
  
  ```ts
  // vitest.config.ts, in the browser project only
  globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
  
  // e2e/playwright.config.ts
  globalSetup: "@hussmartinez/sdk-config/testing/require-image",
  ```
  
  Your `test:browser` and `test:e2e` scripts already run through `hm-in-image`, so they keep working. A browser test started directly on a host, such as `pnpm exec vitest run --project browser` or from an editor, is now refused once you add the guard.
  
  To debug with a headed browser on your machine, set `HM_ALLOW_HOST_BROWSER=1` for that run. The guard prints a notice and lets it start. It's for debugging only: a run on a host can fail at random, so never set it in a script, a hook or a workflow.
  
  **`hm-in-image` now passes these variables into the container,** when they're set: `HM_BROWSER_DIAGNOSTICS`, `PLAYWRIGHT_BASE_URL`, `SMOKE_BASE_URL`, `SMOKE_ENGINES` and `SMOKE_ANALYTICS`, as well as `CI` and `DEBUG`. Nothing else of your environment reaches it. If you worked around this with a wrapper script or `docker run` of your own, you can remove it.
  
  **`HM_BROWSER_DIAGNOSTICS` must be a folder inside the checkout,** because the container sees nothing else of your machine. It's passed as that folder's path in the container, so `HM_BROWSER_DIAGNOSTICS=test-results/diagnostics pnpm test:browser` writes the net logs where you can read them. A folder outside the checkout, such as `/tmp/hm-diagnostics`, is now a usage error (exit code 2) instead of logs that vanish with the container.

## 0.9.1

### Patch Changes

- [#138](https://github.com/ie-huss-martinez/sdk-core/pull/138) [`38a9e6e`](https://github.com/ie-huss-martinez/sdk-core/commit/38a9e6ecb6932850ba4c0ff995462c936812f1ae) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix `hm-check-api-reports` flagging types that share a name with a global. API Extractor renames such a type in every report: an SDK's `AudioSampleFormat` (also a WebCodecs type) or `Scheduler` (also a DOM type) appears in the main report as `export { AudioSampleFormat_2 as AudioSampleFormat }`, and other entry points' reports refer to `AudioSampleFormat_2`. The command read only the name after `as`, so it failed with `"AudioSampleFormat_2" is copied from the package, but the main entry point doesn't export it.`
  
  It now counts both names as exported, with the kind of the declaration behind them. So a renamed class is still checked for `private`, `protected` and `#private` members, under the name the declaration rollup gives it.
  
  Nothing to change in your repository: update `@hussmartinez/sdk-config` and remove any workaround, such as a type renamed only to avoid the clash.

## 0.9.0

### Minor Changes

- [#129](https://github.com/ie-huss-martinez/sdk-core/pull/129) [`93b54fc`](https://github.com/ie-huss-martinez/sdk-core/commit/93b54fc3d156b36d6be31a60ce7c11ce768cb155) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `hm-check-playwright-image`, which fails when a repository's Playwright can differ from its browser test image's (sdk-core ADR 0025). It reports each locked `playwright`, `playwright-core` or `@playwright/test` whose version isn't `ci/Dockerfile`'s tag, and each specifier for them that isn't that exact version, because a range such as `^1.65.0` drifts to 1.65.1 under a 1.65.0 image at the next install.
  
  To adopt it:
  - pin `playwright` and `@playwright/test` exactly to the image's version;
  - add `"check:playwright-image": "hm-check-playwright-image"` to `verify` and `verify:fast`;
  - delete your own `ci-image` test.
  
  The sdk-config README has the Dependabot group that keeps the packages together.

## 0.8.1

### Patch Changes

- [#127](https://github.com/ie-huss-martinez/sdk-core/pull/127) [`eb62efa`](https://github.com/ie-huss-martinez/sdk-core/commit/eb62efa2b20706422f6d12943f57656e8a192e6a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `hm-in-image pnpm <script>` works. The image's `pnpm` was pnpm's placeholder script, because install scripts are off for the integrity-checked install. Commands that spawn `pnpm` directly, as `pnpm exec pnpm` does, failed with "Exec format error". The image now runs pnpm's own `install.js`, which copies the native binary from the checked `@pnpm/exe` package over the placeholders without downloading anything, and its build fails if `pnpm` still isn't a native executable. The image is rebuilt automatically on the next run.

## 0.8.0

### Minor Changes

- [#125](https://github.com/ie-huss-martinez/sdk-core/pull/125) [`ccc584a`](https://github.com/ie-huss-martinez/sdk-core/commit/ccc584a7f0baad5ff8e48ae0542de33b738bb3aa) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `hm-in-image`, which runs a command in the browser test image that `ci/Dockerfile` pins, locally as CI does (sdk-core ADR 0049). On a host, Chromium aborts dev-server requests with `ERR_NETWORK_CHANGED` whenever Docker adds or removes a network interface, so browser tests failed at random with "did not become ready" or "failed to load". Inside the image, the host's network changes don't reach the browser.
  
  To adopt it, run every browser step through it, such as `"test:browser": "hm-in-image vitest run --project browser"`, and `"test:e2e": "hm-in-image playwright test"`. Also set `HM_VISUAL_CONTAINER: "1"` in your CI verify jobs' `env`, so that it runs the commands directly there. It needs Docker locally.
  
  `hm-test-visual` now runs through the same code, and shares its image and volumes, named `hm-browser-<workspace>`. Volumes named `hm-visual-*` from earlier versions are no longer used, and can be removed with `docker volume rm`.

## 0.7.0

### Minor Changes

- [#121](https://github.com/ie-huss-martinez/sdk-core/pull/121) [`3262db1`](https://github.com/ie-huss-martinez/sdk-core/commit/3262db1404d6017002115b6e73ba542da015d43a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add opt-in diagnostics for browser tests that fail without a reason, such as an iframe that "did not become ready" or a module worker that "failed to load".
  
  - `@hussmartinez/sdk-config/testing/browser-instances` exports `browserInstances(browsers)`, Vitest's `browser.instances` with Playwright. Adopt it by replacing `instances: browsers.map((browser) => ({ browser }))` with `instances: browserInstances(browsers)`. By default nothing changes. With `HM_BROWSER_DIAGNOSTICS=<folder>`, Chromium records every request and its network error in a net log in that folder, and writes its console to stderr, which `DEBUG=pw:browser` shows. Firefox and WebKit are never changed.
  - `hm-netlog-errors <netlog>...` lists the failed requests in those logs: Chromium's error and the URL.

### Patch Changes

- [#119](https://github.com/ie-huss-martinez/sdk-core/pull/119) [`2c419ee`](https://github.com/ie-huss-martinez/sdk-core/commit/2c419ee925268c2997628fbcbcdc2e26532f32e9) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `hm-test-visual` now installs pnpm in its image only after checking it against `pnpm-lock.yaml`. It downloads the `pnpm` package and the native binary for the image's architecture (`@pnpm/exe.linux-x64` or `linux-arm64`), checks each against the sha512 integrity that the lockfile records for the package manager, and installs those files with no install scripts. Before, it installed `pnpm@<version>` by name, trusting the registry. If `pnpm-lock.yaml` doesn't record the `packageManager` version of pnpm with these integrities, it stops with a usage error that says to run `pnpm install` with that version.

## 0.6.1

### Patch Changes

- [#115](https://github.com/ie-huss-martinez/sdk-core/pull/115) [`70b7441`](https://github.com/ie-huss-martinez/sdk-core/commit/70b7441ee6bd53a194db3f917568fa141147177e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `hm-test-visual` no longer fails with "Duplicate mount point: /work/node_modules" in a workspace whose `pnpm-workspace.yaml` lists the root as `"."`, as Changesets needs. It mounts the root's `node_modules` once, and ignores entries that point outside the repository.

## 0.6.0

### Minor Changes

- [#112](https://github.com/ie-huss-martinez/sdk-core/pull/112) [`d8ccdb3`](https://github.com/ie-huss-martinez/sdk-core/commit/d8ccdb3778a80f76c65002382739407b832f8877) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add visual regression testing for SDK editors (sdk-core ADR 0048).
  
  - `@hussmartinez/sdk-config/testing/visual` exports `defineVisualConfig({ baseURL, webServer })`, the Playwright configuration for `e2e/playwright.visual.config.ts`: Chromium in a fixed 1280 × 800 page with `en-US`, `UTC` and reduced motion, screenshots without animations or carets, compared with no tolerance, and baselines named `<state>-<theme>-<density>-chromium-linux.png`. It also exports `visualVariants`, the four theme and density combinations, and `applyVisualVariant(page, variant)`.
  - The `hm-test-visual` command runs those tests inside the browser test image that `ci/Dockerfile` pins, through Docker locally and directly in CI. `hm-test-visual --update` rewrites the baselines and removes the ones no state produces any more.
  
  To adopt it, install `@playwright/test`, add `"test:visual": "hm-test-visual"` and `"test:visual:update": "hm-test-visual --update"`, and run `test:visual` in `verify` after `test:e2e`.

## 0.5.0

### Minor Changes

- [#105](https://github.com/ie-huss-martinez/sdk-core/pull/105) [`50528e2`](https://github.com/ie-huss-martinez/sdk-core/commit/50528e2af66ccb2cea1b38c32de05a9ea590bbb9) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `hm-check-single-copy`, which fails when `pnpm-lock.yaml` resolves more than one version of any `@hussmartinez` package (or of the scopes given with `--scope`). It names each version and what depends on it, such as `0.3.0, through @hussmartinez/ui@0.5.0`. Workspace links aren't copies, and versions that differ only in their peer dependencies count once. Add `"check:single-copy": "hm-check-single-copy"` to your scripts and run it in `verify`. It adds `yaml` as a dependency.

### Patch Changes

- [#103](https://github.com/ie-huss-martinez/sdk-core/pull/103) [`1b730b6`](https://github.com/ie-huss-martinez/sdk-core/commit/1b730b654f37123d198a93cedfbe90dd5c0bcadb) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `testing/audio-output` and `testing/conformance` now ship TypeScript declarations, so TypeScript test projects can import them without a shim. `describeConformance` and `checkCase` take a generic `Input`, the type of the cases' inputs, instead of `any`.
  
  The `audioOutput()` documentation now says to probe inside the tests that need audio, never at a file's top level: the probe clicks, which gives the page user activation, so a test of behaviour before any gesture, such as autoplay, would see that click. The README shows a `needAudio(context)` helper that skips the test with the reason.

## 0.4.0

### Minor Changes

- [#94](https://github.com/ie-huss-martinez/sdk-core/pull/94) [`11cba26`](https://github.com/ie-huss-martinez/sdk-core/commit/11cba269f62a8f9771867d5277e2ce3774d9604c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds `@hussmartinez/sdk-config/testing/audio-output`, a helper for browser tests that need real-time audio output. `audioOutput({ activate })` probes the browser once per test run and returns `{ available, reason, clockRatio }`: audio counts as available only when an `AudioContext` runs, and its clock keeps real time. Firefox in the family's test image has no audio output, so tests that need it skip there with `it.skipIf(!audio.available)(\`name${audio.reason}\`, …)`. Pass `activate: (button) => userEvent.click(button)` from `vitest/browser` for browsers that start audio only after a user gesture. Import it only from tests.

- [#98](https://github.com/ie-huss-martinez/sdk-core/pull/98) [`ffc0217`](https://github.com/ie-huss-martinez/sdk-core/commit/ffc021703a931a035601170f90da9f3f8889e53a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds the shared pieces for conformance vectors (sdk-core ADR 0045):
  
  - `@hussmartinez/sdk-config/formats/hm-conformance/v1.schema.json`, the JSON Schema of an `hm-conformance` case file.
  - `@hussmartinez/sdk-config/testing/conformance`, a test-only Vitest loader. `describeConformance(file, run)` validates a case file and registers one test per case. It compares results exactly, or within a case's `tolerance` for numbers, and matches a rejection by its `code` and `details.reason`, never its message. `schemaValidator(schemaFile)` checks values against an SDK's own format schemas in tests.
  
  The loader needs `vitest` and `ajv`, which are optional peer dependencies. Import it only from tests.

## 0.3.0

### Minor Changes

- [#93](https://github.com/ie-huss-martinez/sdk-core/pull/93) [`20c2f29`](https://github.com/ie-huss-martinez/sdk-core/commit/20c2f29d7d365fea7bfd96d4880cb7c3bc9569bf) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The dependency-cruiser preset adds a `no-ai-core` rule: published source under `src/` may no longer import `@hussmartinez/ai-core`, not even its types (ADR 0035). Tests and anything under `examples/` may still import it, so examples can show hosts how to pass an `ai-core` provider.
  
  If your SDK needs AI, define a provider port in `src/core/ports` with only what it needs, such as `complete()` and `stream()` taking an `AbortSignal`, plus a fake and contract tests, and let the host pass a provider built with `ai-core` or its own backend. No package in the family imports `ai-core` today, so `hm-lint-deps` passes unchanged for existing repositories.

## 0.2.1

### Patch Changes

- [#82](https://github.com/ie-huss-martinez/sdk-core/pull/82) [`e4c8dfd`](https://github.com/ie-huss-martinez/sdk-core/commit/e4c8dfd9cda0bfe7e7a4af56b389e0121a9a1ee4) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The dependency-cruiser preset now checks imports that resolve into a dependency's `dist/`. It used to leave out every path with a `dist/` segment, including `node_modules/<package>/dist/`, where most packages keep their code, such as `@hussmartinez/ui`, so rules such as `core-no-ui`, `entry-no-react` and `not-to-dev-dep` couldn't see imports of them. Only the repository's own `dist/`, `temp/` and `coverage/`, and fixtures under `src/`, `test/` or `tests/`, are left out now. Packages installed flat, as `node_modules/<name>`, are matched as well as pnpm's store paths, and `layer-errors` lets tests in `core/errors` import test tools. `hm-lint-deps` may now report violations it missed before: fix them, as the rule's message says.

- [#85](https://github.com/ie-huss-martinez/sdk-core/pull/85) [`64a998d`](https://github.com/ie-huss-martinez/sdk-core/commit/64a998d88c65fbaa258880265f64e8252da70f28) Thanks [@hussmartinez](https://github.com/hussmartinez)! - 0.2.0 was never published; its changes ship in this release.

## 0.2.0

### Minor Changes

- [#65](https://github.com/ie-huss-martinez/sdk-core/pull/65) [`16a28aa`](https://github.com/ie-huss-martinez/sdk-core/commit/16a28aa2705bea21b8657f95258e7dc540aa91bb) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Adds an api-extractor preset and the `hm-check-api-reports` command, for packages with more than one entry point.
  
  - **`@hussmartinez/sdk-config/api-extractor/base.json`:** extend it from each entry point's `api-extractor.json`, using that full path, and set only the paths. It lists the package types a secondary entry point copies in its API report (`ae-forgotten-export`), instead of failing or hiding them.
  - **`hm-check-api-reports --main <report> --types <rollup> [<report>...]`:** run it after api-extractor. It fails when another entry point copies a type the main entry point doesn't export, or a class with `private`, `protected` or `#private` members, whose copy TypeScript would treat as a different type.
  
  If your configuration turns `ae-forgotten-export` off, extend the preset and run the command instead. It needs `@microsoft/api-extractor`, an optional peer dependency.

- [#67](https://github.com/ie-huss-martinez/sdk-core/pull/67) [`267f273`](https://github.com/ie-huss-martinez/sdk-core/commit/267f273681160a664f488614eddec2b2145e42a2) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The api-extractor preset now fails when a public type references an `@internal` one (`ae-incompatible-release-tags`). api-extractor trims `@internal` declarations from the published declaration rollup, so that public type would reach users broken; api-extractor's own default only notes it in the report. To fix the failure, export the referenced type as `@public`, or leave it unexported without a release tag.

- [#80](https://github.com/ie-huss-martinez/sdk-core/pull/80) [`6360866`](https://github.com/ie-huss-martinez/sdk-core/commit/63608667c83da50ed0833cc3b77ba052f570862d) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The dependency-cruiser preset's `entry-no-ui` rule is now `entry-no-react` (ADR 0036, amended). Nothing the `.` entry reaches may import `react`, `react-dom` or `@hussmartinez/ui/react`, even as types, but it may now reach `@hussmartinez/ui`'s root entry through `src/features`, so headless tool definitions can import `IconName`. `core-no-ui` still keeps `src/core`, `src/adapters` and `src/workers` free of ui entirely. If your `.dependency-cruiser.js` adjusts the rule by name, rename `entry-no-ui` to `entry-no-react`.

- [#72](https://github.com/ie-huss-martinez/sdk-core/pull/72) [`f007269`](https://github.com/ie-huss-martinez/sdk-core/commit/f007269b245925f0ffd89557d2bd3c15fd5abb54) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The dependency-cruiser preset keeps React and `@hussmartinez/ui` out of every headless part of an SDK (ADR 0036). `core-no-ui` now also covers `src/adapters` and `src/workers`, and the new `entry-no-ui` rule fails when anything the `.` entry module, `src/index.*`, reaches imports `react`, `react-dom` or `@hussmartinez/ui`, naming the path it took. A headless entry that reaches them through a feature or an adapter now fails `hm-lint-deps`: move that import behind the `./react` or `./element` entry.

## 0.1.5

### Patch Changes

- [#41](https://github.com/ie-huss-martinez/sdk-core/pull/41) [`d8d674a`](https://github.com/ie-huss-martinez/sdk-core/commit/d8d674a48bd5a60bd4cc136562511cd86bd8aea1) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The source repository has moved to the `ie-huss-martinez` GitHub organisation: `https://github.com/ie-huss-martinez/sdk-core`. The package's `repository`, its README links and the ADR links in stylelint's messages point there, and it now has `bugs` and `homepage` links too. Old `github.com/hussmartinez/sdk-core` links redirect. The npm package name doesn't change, and there's nothing to migrate.

## 0.1.4

### Patch Changes

- [#39](https://github.com/hussmartinez/sdk-core/pull/39) [`e00470d`](https://github.com/hussmartinez/sdk-core/commit/e00470d0cceb2ac1cd0111e083a0f7cdbb60cf2c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The stylelint preset now also ignores `.next/` and `dist-server/`, at any depth: Next.js builds, and server-rendered Vite builds. Their CSS inlines the token values, so stylelint reported it as `hm/no-literal-values` errors when an editor, lint-staged or an explicit path linted it. If your repository lists these two in a `.stylelintignore`, you can remove them once you're on this version. As before, the ignores apply when your `stylelint.config.js` re-exports the preset.

## 0.1.3

### Patch Changes

- [#31](https://github.com/hussmartinez/sdk-core/pull/31) [`f09363f`](https://github.com/hussmartinez/sdk-core/commit/f09363fc67c4ee759d9a3a3c4cc3eb1cdebade06) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The stylelint preset now ignores build output and tool caches: `dist/`, `temp/`, `coverage/`, `storybook-static/` and `node_modules/`, at any depth. Running `stylelint "**/*.css"` after a build no longer reports `hm/no-literal-values` errors for built CSS, which inlines the token values. This applies when your `stylelint.config.js` re-exports the preset (`export { default } from "@hussmartinez/sdk-config/stylelint"`). If you use `extends` instead, stylelint resolves the preset's ignore globs against the preset's own directory, so add the same `ignoreFiles` to your config.

## 0.1.2

### Patch Changes

- [#27](https://github.com/hussmartinez/sdk-core/pull/27) [`ca8ccff`](https://github.com/hussmartinez/sdk-core/commit/ca8ccff1dcd82d4a9e54ae41f8a905e1604a9be2) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The Biome preset no longer pins a `$schema` version, so `biome check` no longer prints "The configuration schema version does not match the CLI version", whichever Biome version you use. Your own `biome.json` keeps its `$schema`. The `@biomejs/biome` peer dependency is now `^2.6.2`, the oldest release that accepts the preset's options.

## 0.1.1

### Patch Changes

- [#22](https://github.com/hussmartinez/sdk-core/pull/22) [`06f2162`](https://github.com/hussmartinez/sdk-core/commit/06f2162f3563d6329ee8664ea22d6ff95c5c8ac4) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add npm version, CI and licence badges to the README, and replace the outdated "not published yet" status with the package's `0.x` status.

## 0.1.0

### Minor Changes

- [#18](https://github.com/hussmartinez/sdk-core/pull/18) [`eb00396`](https://github.com/hussmartinez/sdk-core/commit/eb003962dce7f1922bb2906788f1d43d10210c18) Thanks [@hussmartinez](https://github.com/hussmartinez)! - First release of `@hussmartinez/sdk-config`, the shared development configuration for the `@hussmartinez` SDKs. Each repository extends these presets instead of copying configuration, so a rule changes in one place. Install the tools for the presets you use; each is an optional peer dependency.
  
  - **TypeScript:** `tsconfig/base`, `tsconfig/browser` and `tsconfig/node`, strict and ES2022 with `nodenext` modules, plus `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
  - **Biome:** formatting and linting for code, JSON and CSS, with rules that keep public code explicit about types and imports.
  - **stylelint:** the family's CSS rules.
    - Everything is namespaced with `hm-`: classes, ids, custom properties, keyframes, `data-hm-*` attributes and cascade layers.
    - Selectors can only match elements inside an `hm` root.
    - Every colour, length, duration, easing, z-index, opacity and font value must come from a `--hm-*` design token, except in token files.
  - **dependency-cruiser:** the layer rules for SDK repositories, for example that the core never imports React, adapters or UI. It also rejects cycles, unresolvable or undeclared imports, devDependencies in published code and imports of tests.
  - **`hm-lint-deps`:** a command that runs dependency-cruiser with your configuration and also fails when a source file wasn't analysed, such as every `.ts` file when no supported TypeScript is installed. It exits 0 when clean, 1 for violations, and 2 for usage errors.
  - **Git hooks:** presets for commitlint (Conventional Commits with a lowercase subject and a 72-character header), lint-staged (a secret scan, then Biome and stylelint on staged files) and secretlint (cloud, npm and GitHub credentials, and private keys).
