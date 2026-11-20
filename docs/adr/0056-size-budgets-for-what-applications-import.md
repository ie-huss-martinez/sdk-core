# 0056. Size budgets for what applications import

- **Status:** Accepted
- **Date:** 2026-11-21
- **Amends:** [ADR 0015](0015-verification-and-releases.md)'s "bundle budgets: `size-limit`, per entry point", by adding a second kind of budget beside the entry's. Builds on [ADR 0055](0055-what-the-size-budgets-measure.md), which says what the entry's budget is

## Context

Every package has a size budget per entry point: a ceiling on the entry's built files ([ADR 0055](0055-what-the-size-budgets-measure.md)). That record ends on a question it leaves open: no application ships a whole entry, so what does a change cost an application?

Two repositories already answer it. `ui`'s [ADR 0012](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0012-size-budgets-per-import.md) added budgets for what an application imports from its React entry, bundled and minified as a host's bundler would, after seven pull requests in two days had each raised the entry's budget without anyone learning what an application paid. audio-sdk has the same for its core entry: eight scenarios, from one factory to "an editor's set". The other packages, sdk-core included, have ceilings only.

For this record, every entry in the family was measured the way those budgets measure: an application's import from the built entry, bundled and minified with esbuild, with packages (React, `ui`, sdk-core) left out and lazy chunks excluded, by marking both as external to the bundle, then compressed with brotli. The method reproduces `ui`'s own numbers: `Button` at 0.76 kB, as its ADR 0012 has it.

### What applications ship, against what the ceilings count

| Package | Entry | Ceiling counts | Whole entry, as shipped | The cheapest import | One typical import |
|---|---|---|---|---|---|
| sdk-core | headless | 15.57 kB | 11.54 kB | `SdkError`: 0.39 kB | `createWorkerClient`: 3.32 kB |
| sdk-core | element | 2.78 kB | 1.72 kB | `adoptSharedStyleSheet`: 0.70 kB | `createEditorElement`: 1.24 kB |
| ui | server-safe | 11.43 kB | 8.89 kB | `UiError`: 0.11 kB | `createTheme`: 7.20 kB |
| ui | React | 24.28 kB | 19.66 kB | `usePlatform`: 0.43 kB | `Button`: 0.76 kB |
| pdf-sdk | core | 14.78 kB | 11.17 kB | `PdfError`: 0.80 kB | `createPdfSession`: 6.61 kB |
| pdf-sdk | React | 23.51 kB | 18.28 kB | `pdfEditorMessages`: 2.61 kB | `PdfViewer`: 5.63 kB |
| audio-sdk | core | 23.36 kB | 17.60 kB | `AudioError`: 1.15 kB | `createAudioSession`: 9.81 kB |
| audio-sdk | React | 38.83 kB | 30.15 kB | `audioEditorMessages`: **16.98 kB** | `AudioEditor`: 29.94 kB |
| video-sdk | core | 20.67 kB | 16.13 kB | `VideoError`: 0.11 kB | `createVideoSession`: 10.58 kB |
| video-sdk | React | 34.55 kB | 26.35 kB | `VideoExportDialog`: **18.49 kB** | `VideoEditor`: 26.21 kB |
| image-sdk | core | 27.14 kB | 20.33 kB | `ImageError`: 1.41 kB | `createImageSession`: 12.24 kB |
| image-sdk | React | 53.94 kB | 40.68 kB | `imageEditorMessages`: **40.40 kB** | every export: about 40.5 kB |
| learn-sdk | core | 15.68 kB | 11.15 kB | `emptyProgress`: 0.26 kB | `createLearnPlayer`: 4.93 kB |
| learn-sdk | React | 14.28 kB | 10.66 kB | `playerCatalogue`: 3.60 kB | `LearnPlayer`: 10.56 kB |

The measurements left every package out, so learn-sdk's rows don't include `ts-fsrs`, which the rule below would count.

Measured from each repository's local build, at sdk-core 589ea92, ui 917a4a9, pdf-sdk b992a00, audio-sdk 785d2fc, video-sdk 6cafcc7, image-sdk d97a998 and learn-sdk e2afec8, without changing them.

### What this shows

- **Most imports cost a small part of the entry.** An application that uses sdk-core's errors ships 0.39 kB of the 15.57 kB its budget counts. In sdk-core, 29 of 33 exports cost under 1 kB each; in `ui`'s React entry, 84 of 97. A budget on the whole entry can't say which.
- **Three React entries don't come apart at all, and no budget says so.** In image-sdk, importing the message catalogue alone ships 40.40 kB of the entry's 40.68 kB. In audio-sdk the cheapest import ships 16.98 kB, and in video-sdk 18.49 kB. Their ceilings measure the same whichever is true.
- **The cause is visible in the bundle.** Importing only `imageEditorMessages` keeps 211 functions, held by calls at the top level of the entry's modules that a bundler can't prove are free of side effects: 18 `defineTool(…)`, with `createContext(…)`, `Object.freeze(…)` and `defineLimits(…)`. audio-sdk's and video-sdk's bundles keep the same kind of call: `forwardRef`, `createContext`, `defineMessages`, `createErrorHelpers`. pdf-sdk has seven `defineTool` calls too, and its floor is 2.61 kB, because what they hold is small. sdk-core marks such calls `/* @__PURE__ */` where a bundler needs it, as its message catalogue does, and its floor and `ui`'s are a few hundred bytes.
- **Today's editor applications don't feel it,** because each imports its whole editor. A host that composes its own interface from an SDK's parts would: one timeline, or one hook, would bring most of the editor. That's the use [ADR 0009](0009-features-as-tools.md)'s tools and the exported parts exist for.
- **This is the regression `ui`'s ADR 0012 calls a leak into everything,** and built its "floor" scenarios to catch. It has happened in three packages that have no floor.

## Options

**A. Leave it to each repository.** `ui` and audio-sdk keep theirs, and the rest add budgets if and when they see a reason. The table above is what that produced.

**B. Make import budgets a family rule, with a shared helper.** Every entry whose exports can be imported one at a time gets a few scenarios beside its ceiling, written the same way in every repository through `sdk-config`.

**C. Assert sizes in each package's `build.test.ts`** instead of in `size-limit`. `ui` considered and rejected it: `size-limit` is the family's tool and report, and a second place for budgets splits them.

**D. Replace the ceilings with import budgets.** A scenario covers only what it imports. The ceiling is the one number that covers everything in an entry, including code no scenario reaches ([ADR 0055](0055-what-the-size-budgets-measure.md)).

## Decision

**Option B: import budgets are a family rule, with a helper in `sdk-config`.**

### Which entries, and which scenarios

- **An entry gets import budgets when its exports can be used apart:** a package's core entry and its React entry. An entry that loads whole by design gets none and keeps its ceiling only: a stylesheet, a worker, and an element or standalone entry, whose one export mounts the whole editor. Its ceiling is its real cost.
- **Each such entry has at least these scenarios:**
  - **A floor:** the cheapest import a host would really make, such as the error class or the message catalogue. It catches code that leaks into everything. A floor that moves is a regression to fix, never a budget to raise.
  - **Each heavy piece on its own:** an export over about 2 kB by itself, such as a session, an engine, or a timeline.
  - **What a typical application imports:** for a core entry, the factories an editor uses together, as audio-sdk's "an editor's set"; for a React entry, the editor component.
- **A new export over about 2 kB adds its scenario in the pull request that adds it.**
- **sdk-core starts with these,** from the measurements above: the floor, `SdkError`; each piece over 2 kB, `createWorkerClient`, `exposeWorker`, `createShortcutRegistry`, and `createMessages` with `sdkCoreMessages`; and from the element base, `createEditorElement`, which the SDKs' element entries build on.

### How they're measured

- **As an application ships it:** the import bundled and minified, through `size-limit` with `@size-limit/esbuild` and its `import` option, compressed with brotli.
- **Without what's counted elsewhere,** and only that:
  - **the host's own packages,** `react` and `react-dom`;
  - **the family's packages,** such as `ui` and sdk-core, which have budgets of their own and are installed once ([ADR 0047](0047-one-copy-of-each-family-package.md));
  - **chunks loaded later with `import()`,** which have budgets of their own. A bundler without code splitting would inline them, so each scenario lists them to leave out, as the measurements here did.
- **Everything else an import brings is counted,** including a third-party runtime dependency. The family's packages bundle their engines into lazy chunks ([ADR 0028](0028-third-party-engines.md)), and one has a runtime dependency beside the family's: learn-sdk's `ts-fsrs`. Its scenarios count it, and a pull request that adds such a dependency anywhere sees it in its scenarios.
- **One bundler is enough.** `ui` measured esbuild and Rolldown within 0.31 kB of each other in every scenario, neither consistently larger.
- **`sdk-config` provides the helper,** beside `entryFiles`: a function that returns a scenario's `size-limit` entry from its name, the built entry, the imports and the limit, with the family's list of what to leave out. Two repositories have written that function already, differently.

### How they're used in review

- **Every budget is raised in the pull request that needs it,** to its measurement rounded up to the next 0.5 kB, with a table of the scenarios that moved, before and after, and the reason. That's the rule `ui` and the SDKs already follow for ceilings.
- **A floor's limit is tighter: its measurement rounded up to the next 0.1 kB.** A floor exists to notice small leaks, and half a kilobyte of slack would hide one. The table shows every floor's measured size, moved or not, because a limit only bounds a change and the measurement shows it.
- **A scenario's budget is never raised for code the scenario doesn't import.** If adding a component moves the floor, or another component's scenario, the change leaked, and the leak is fixed.
- **Review reads the scenarios; the ceiling is the backstop.** When a pull request raises an entry's ceiling and only the scenarios that import the new code move, the raise is expected growth, and the table shows it.
- **`build.test.ts` keeps checking which code ships.** A scenario can stay within budget while shipping the wrong code, so the size budgets don't replace those tests.

### The three entries that don't come apart: fix first, then adopt

A floor set at 40 kB would record the defect as the norm. So for image-sdk, video-sdk and audio-sdk, the order is:

1. **Fix,** in a `fix:` pull request in each repository: mark the top-level calls that have no side effects, such as `defineTool(…)` and `createContext(…)`, as `/* @__PURE__ */`, which is what sdk-core does, or restructure where an annotation wouldn't be honest, because the call really has an effect. Whether that's enough hasn't been tried; the measurement below is what shows it.
2. **Verify** with the same measurement as this record: the cheapest import from the React entry, before and after.
3. **Adopt** the budgets in a later pull request, with the floor at the fixed number.

If a fix can't bring an entry fully apart, that package adopts at its measured number, with the reason in an ADR of its own.

Every other package adopts when it next touches its size configuration, since its floors are already small.

### How to measure one import

So that any repository can repeat the numbers here, and check a fix:

1. Build the package.
2. Bundle a two-line module that imports the names from the built entry's file and uses them, such as `import { imageEditorMessages } from "./dist/react.js"; console.log(imageEditorMessages);`, with esbuild: `bundle`, `minify`, `format: "esm"`, tree shaking on.
3. Mark as external what the rule above leaves out, and nothing else: `react`, `react-dom`, the family's packages (`@hussmartinez/*`), and every path under the package's lazy chunks. A third-party runtime dependency stays in the bundle and is counted, so a fix that moved code into one would show its real cost.
4. Compress the output with brotli at quality 11, and read its length.

Bundling the same module without `minify` and reading what's left at the top level shows which calls keep code alive.

The table in this record left every package out, which gives the same numbers for every package but learn-sdk, the only one with such a dependency.

`sdk-config` ships this as a command with the helper, so no repository writes it again: it prints what each export of a built entry costs on its own, cheapest first. Until that release, the four steps above are the method.

## Alternatives considered

Beyond the options above:

- **Budgets for every export:** a number per export is a table nobody reads, and most are under 1 kB. The heavy ones are named, and the small ones are left to the ceiling, with the limit that follows.
- **Each editor application's real import list as the scenario:** that list changes in another repository, without a pull request here, and a budget here can't follow it. `ui` ruled the same.
- **Counting the host's packages in:** a scenario would then move whenever `ui` or sdk-core releases, with no change in the package measured.

## Consequences

- A pull request's size table says what the change costs an application that uses it, and what it costs one that doesn't, which should be nothing.
- A leak into everything fails a budget in the pull request that causes it. Three exist today, found only by measuring for this record.
- Each repository adds `@size-limit/esbuild`, which brings esbuild as a development dependency. `ui` and audio-sdk have it.
- Each repository gains a handful of budgets to keep. The rule that a floor isn't raised makes the important one cheap to keep.
- **A small export that grows on its own isn't measured as an import.** The floor catches code that reaches every import, not growth inside one small export that no scenario imports: such an export could grow by half a kilobyte and move only the entry's ceiling. It gets a scenario of its own when it passes about 2 kB, and a package may add one sooner for an export it wants watched.
- image-sdk, audio-sdk and video-sdk each have a fix to make before they adopt, and before their React entries serve hosts that compose their own interface.
