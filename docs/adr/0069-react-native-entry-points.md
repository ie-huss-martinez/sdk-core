# 0069. React Native entry points

- **Status:** Accepted
- **Date:** 2026-11-26
- **Amends:** [ADR 0004](0004-entry-points-and-module-format.md), which gains a `./native` entry, and [ADR 0013](0013-browser-and-react-support.md), which gains React Native as a platform and a rule for the engine it runs on
- **Amended:** 2026-11-26, to mark a native entry as experimental until it's checked on a device, and to record that sdk-core's gaps are closed; 2026-11-27, when the bare-realm test moved to sdk-config and learn-sdk's gaps closed

## Context

The family's packages were written for browsers. React Native applications will use them soon: the first is Remindable, an Expo application in Spanish, English and Arabic, for older adults and people recovering from a brain injury. It needs `ui`'s tokens, icons and a few large-target components now, and learn-sdk's scheduling and grading next.

A React Native application can't use the web entries:

- **There's no DOM and no CSS.** `./react` renders HTML elements and `./styles.css` styles them with layers, custom properties, `oklch()`, `rem` and `var()`. React Native has views, a style object per view, and none of those.
- **The engine is Hermes, not a browser's.** It has no `document` and no `localStorage`, and `Blob`, `Intl` and `String.prototype.normalize` can't be counted on to exist or to behave as a browser's do: they depend on how the engine was built and on the platform under it. A headless `.` entry that calls one of them without checking fails deep inside, on a device, where it's hardest to see.
- **The bundler is Metro.** It resolves a package's `exports` by default from React Native 0.79. Unless an application turns tree shaking on, it ships an entry whole, so what an entry holds is what an application pays.

Some of what exists is already right. `ui`'s `.` entry and each SDK's core have no React and touch no DOM on import ([ADR 0004](0004-entry-points-and-module-format.md), [ADR 0007](0007-server-rendering-and-nextjs.md)). The token source, the icon manifest and the preferences reader are plain data and pure functions.

## Decision

### A `./native` entry

- **A package may add a `./native` entry,** for what only React Native can use: components on React Native's views, hooks over its APIs, and adapters to its storage. What both platforms can use stays in `.`.
- **It's an entry like the others** ([ADR 0004](0004-entry-points-and-module-format.md)): ES modules only, `types` first, in the same package and version. It has:
  - **its own API report,** `api/<package>-native.api.md`, checked with the others ([ADR 0033](0033-api-reports-for-several-entry-points.md));
  - **its own size budgets:** a ceiling on the built entry, and import budgets with a floor, each heavy piece, and what a typical screen imports ([ADR 0056](0056-size-budgets-for-what-applications-import.md)). The ceiling matters more here than on the web, because Metro may ship the whole file.
- **It never changes the web entries.** It's built in a build of its own, into one file. In one build with the web entries, the modules both sides use would move into a chunk they share, and every web application would load one more file because a native entry exists. The second copy of those few modules is in a file no application loads beside the first. The web entries' budgets and tests are the proof: none moves in the pull request that adds a native entry.
- **`react-native` is an optional peer dependency,** `>=0.81`. Metro resolves `exports` without configuration from 0.79, and `Pressable` passes `onFocus` and `onBlur` on from 0.81: before that it replaces them with handlers of its own that call nothing, so a component couldn't show focus. A package that draws vectors adds `react-native-svg`, `>=15`, as an optional peer too. Neither is ever a dependency.
  - **What CI proves is one point in those ranges:** the Expo application's versions, which the workspace's catalog pins. Today that's Expo SDK 58 with React Native 0.88.1, `react-native-svg` 15.16.0 and React 19.3.0. The ranges are wider on purpose: Remindable runs Expo SDK 57 with React Native 0.86.3 and `react-native-svg` 15.15.4, which they accept, and which no check here builds. The lower bounds are where the features the entries rely on begin, not versions that were tested. A package's changeset says so when its native entry is released.
- **It imports no DOM entry,** not `./react`, `react-dom` or a stylesheet, and a test on the built file checks what it imports.
- **No text of its own.** A native component takes its visible text and accessible names from the application, as props. The family's message catalogues are English only so far ([ADR 0019](0019-message-catalogues.md)); native components don't add a second way to translate before the first has more than one language.

### The root entry runs on Hermes

- **Every package's `.` entry stays safe to import and run on Hermes.** Nothing it reaches calls, without checking first:
  - `String.prototype.normalize`;
  - `Intl`;
  - `Blob`, `File`, `TextEncoder` or `URL`;
  - `localStorage`, or any other DOM global.
- **What needs one of them detects it** and fails with `UNSUPPORTED_ENVIRONMENT`, naming the feature, as [ADR 0013](0013-browser-and-react-support.md) already says for browsers. Where a pure fallback is cheap and exact, such as leaving text as it is when it can't be normalised, the function uses it and says so in its documentation.
- **A package meets the rule in the pull request that adds its `./native` entry.** A package that another one's native entry imports meets it before a release publishes that entry, and before that entry calls anything of it that needs one of these. Until then it's a known gap, listed below.

### How native code is tested

Three layers, cheapest first:

1. **Unit tests in Vitest for everything pure.** Native code is written so that its decisions are plain functions: which state a choice is in, what a button's colours and measures are, how a token resolves. Those are tested like any other unit, in Node, with no React Native.
2. **The built entries run in a bare realm.** A test bundles the built `.` and `./native` entries whole, as Metro would, and runs them in a realm with the ECMAScript language and nothing else: no `Intl`, no `normalize`, no DOM, no Node. `react-native` is a stub. That's less than Hermes has, so what runs there runs on Hermes. It's the check for the rule above.
3. **A small Expo application in `examples/native`** ([ADR 0039](0039-test-applications-in-each-repository.md)), which uses every export of the native entry. `pnpm verify` type-checks it against the built package and builds it with `expo export --platform android`, offline and with Expo's telemetry off. That proves Metro resolves the ESM-only `exports`, and that Hermes compiles the result to bytecode.

**No test renders on a device or an emulator.** CI has neither, and an emulator in the browser test image would cost more than the entry it tests. What the three layers can't see is how a component looks and how a screen reader reads it. The first application that uses an entry is where that's checked, by hand.

**A native entry is experimental until that check is done** (amended 2026-11-26). A release doesn't wait for a phone. Instead, the package's README marks the entry as experimental, and says why: it hasn't been looked at on a device, or listened to with VoiceOver and TalkBack. While it's marked, its API may change in any release, patches included, which is the one exception to the family's rule that a breaking change bumps the minor ([ADR 0021](0021-version-and-release-with-changesets.md)); each changeset still says what changed. The mark comes off in the pull request that records the check: who ran it, on which devices, and with which application.

Each package starts with a test of its own for layer 2. If a second package copies it, the helper moves to `sdk-config` ([ADR 0039](0039-test-applications-in-each-repository.md)'s rule for duplication).

**Amended, 2026-11-27:** learn-sdk was the second, so the helper is now `runInBareRealm`, from `@hussmartinez/sdk-config/testing/bare-realm`, and `ui` and learn-sdk both use it. A test names the globals it takes from React Native itself, which sets some up beside Hermes, such as `AbortController`: the list is the record of what a package relies on there.

### `ui`'s native entry

`@hussmartinez/ui/native` is the first:

- **Themes resolved when `ui` is built.** A generator resolves the built-in light and dark themes from the same token source as the stylesheet: `oklch()` to hex, `rem` to density-independent pixels at 16 to one, durations to milliseconds, curves to four numbers, `var()` followed. A test fails when the committed result is stale, as for `tokens.css`. The entry ships the result as plain objects, with no colour maths and no CSS parser.
  - **Token names are the web's,** without `--hm-`, so one vocabulary covers both.
  - **Only semantic tokens,** which components use ([ADR 0006](0006-design-tokens-and-theming.md)). Font stacks, shadow lists and the outline shorthand describe CSS and are left out.
  - **Density tokens take their coarse-pointer values:** a device is a touch screen, so targets are 44 dp ([ADR 0014](0014-accessibility-and-translatable-text.md)).
  - **`createNativeTheme`** extends a theme with native values, validates each against its token's kind, and fails with `INVALID_THEME_TOKEN`.
- **Four tokens only the native themes have:**
  - `color-hint`, `color-hint-subtle` and `color-hint-text`: a gentle tone for "not this one, look again". An errorless interface never answers a wrong pick with the danger colours, because the error is then what's remembered;
  - `control-height-large`, 64 dp, for people who need a large target.

  The web's tokens don't gain them yet. A new semantic token is a new required value in every complete theme, which breaks them, and more stylesheet for every application. They move to the shared source when a web component needs them.
- **The icons as data.** The icon generator writes each icon's shapes as a plain object too, from the same manifest and the same allowlist. `Icon` draws them with `react-native-svg`, and mirrors the ones marked `mirror` inside right-to-left content.
- **Primitives:** `Text`, which follows a text scale; `Button`, with a `large` 64 dp size; and `ChoiceList`, whose feedback is the success colours with a check for the right choice and the hint colours for a pick that wasn't it. No button variant uses a danger colour, and a test says so.
- **Direction:** `isRTL`, from fixed lists of languages and scripts, with no `Intl`; `Dir`, which lays out a subtree in its content's direction with the `direction` style, so Arabic content can sit in a Spanish interface without restarting the application; and `NoFlip`, for layouts that are physical.
- **Preferences the application keeps** ([ADR 0067](0067-editor-frame-modes-and-host-owned-preferences.md)): a theme, a text scale from 1 to 2, and motion. `readNativePreferences` reads them from anything, as `readEditorPreferences` does. `useReducedMotion` follows the device's setting, and answers "reduced" until it's known.
- **`announce`,** through React Native's `AccessibilityInfo`.

## Alternatives considered

- **A separate package, `@hussmartinez/ui-native`:** a second version to keep in step with the first, and a second release, for code generated from the first's sources. [ADR 0004](0004-entry-points-and-module-format.md) rejected packages per surface for the same reason.
- **`react-native-web`, so one set of components serves both:** it would put a second styling system and its runtime under the web components, which are plain CSS by decision ([ADR 0005](0005-plain-css-with-cascade-layers.md)), to save writing a few native ones.
- **Resolve the tokens on the device:** ships the CSS value parser and the OKLCH maths to every application, to compute the same constants on every launch.
- **Add the hint colours to the web's tokens now:** breaks every complete custom theme, and changes every application's stylesheet, for a tone no web component uses yet.
- **One build for every entry:** simpler configuration, but it changes what web applications load, as described above.
- **Jest with `jest-expo`, or a renderer under Vitest, for component tests:** a second test runner, or a stand-in for React Native that has to be kept faithful. The pure-function layer covers the decisions, and neither would show how a component looks.
- **Expo SDK 57, which Remindable uses:** the workspace's `trustPolicy: no-downgrade` refuses it. Expo's 58 releases are published with provenance, and the later patch releases of 57 aren't, which the policy reads as a downgrade. The test application uses SDK 58, with React Native 0.88. It proves the same two things, and no supply-chain rule was loosened for it.

## Consequences

- A React Native application installs the same packages as a web one, and imports `./native`.
- Each native entry is more to build, report and budget: a third API report, a second Vite configuration and an Expo application in the workspace. The Expo application adds about 370 packages to the lockfile, all development-only.
- `ui` lists `react-native` as a peer, which turns Biome's React Native rules on for the whole package. The root `biome.json` keeps them to the native sources and the Expo application; the web components draw text in elements, which those rules would report.
- The native components are fewer and plainer than the web's, and grow as applications need them. They share tokens and icons with the web, not behaviour: a fix to the web `Button` doesn't reach the native one.
- **Known gaps in the root entries,** to close before a native entry relies on them:
  - **sdk-core:** closed on 2026-11-26, before the release that publishes `@hussmartinez/ui/native`. `createMessages` checks for each `Intl` constructor before using it and fails with `UNSUPPORTED_ENVIRONMENT`, naming it; plain text needs none. `cleanFileName` leaves a name uncomposed where there's no `normalize`. Its other uses of platform types, such as `Blob` in the file policy and `URL` for worker assets, belong to features a native entry doesn't reach yet, and are checked when one does.
  - **learn-sdk:** closed on 2026-11-27, with its native entry ([learn-sdk ADR 0010](../../packages/learn-sdk/docs/adr/0010-react-native-and-memory-training.md)): `normalize`, `structuredClone`, `TextEncoder`, `Blob` and `crypto.getRandomValues` are each replaced or checked.
- [`STANDARDS.md`](../../STANDARDS.md) gains the `./native` entry, the optional peers, and the rule for the root entry.
