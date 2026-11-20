# @hussmartinez/sdk-config

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
