# 0063. A lint for what React components do while rendering

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0015](0015-verification-and-releases.md)'s code checks, by adding one for a class of mistake Biome doesn't look for

## Context

The family's code checks are Biome, stylelint and dependency-cruiser ([ADR 0015](0015-verification-and-releases.md)). Biome has two rules for React hooks: that they're called at the top level, and that their dependency lists are complete.

React asks more of a component than that. Rendering has to be pure: a component may not read or write a ref while it renders, call something impure such as `Math.random()`, or set state. React is free to render a component twice, to throw a render away, or to render ahead of time, and a component that isn't pure then shows stale or inconsistent values. These mistakes pass every test until a host uses a concurrent feature. One reached review in pdf-sdk: a component read the DOM while rendering.

React's own lint plugin, `eslint-plugin-react-hooks`, has checked for these since version 6, with the analysis the React Compiler uses. Biome has no equivalent. It needs ESLint to run.

### What it finds in the family today

Version 7.1.1, its `recommended-latest` rules, on each repository's published React source on its `main`, on 2026-11-21. Tests and stories were left out.

| Repository | Files | `refs` | `immutability` | `set-state-in-effect` | `exhaustive-deps` | Other | Total |
|---|---|---|---|---|---|---|---|
| pdf-sdk | 69 | 3 | 1 | 2 | 0 | 0 | 6 |
| image-sdk | 132 | 2 | 2 | 4 | 0 | 0 | 8 |
| video-sdk | 99 | 3 | 2 | 3 | 6 | 0 | 14 |
| audio-sdk | 95 | 4 | 6 | 2 | 1 | 0 | 13 |
| learn-sdk | 55 | 2 | 0 | 1 | 1 | 0 | 4 |
| ui | 66 | 7 | 4 | 0 | 0 | 1 | 12 |
| **All** | **516** | **21** | **15** | **12** | **8** | **1** | **57** |

No repository has a finding for `purity`, `set-state-in-render`, `rules-of-hooks`, `static-components` or the plugin's other rules.

What the findings are, from reading a sample of each:

- **`refs`, 21:** nearly all are one pattern, a ref kept up to date while rendering, so that an effect or a handler can call the latest version of a prop: `latest.current = onChange`. It works in today's React and isn't safe when a render is thrown away. Updating the ref in an effect instead is safe, works on every React the family supports, and passes the plugin.
- **`immutability`, 15:** helpers that merge a forwarded ref with a local one, and a local variable changed after render. Some are the plugin being strict about a legitimate pattern.
- **`set-state-in-effect`, 12:** local state that follows a prop, `useEffect(() => setLocal(value), [value])`, which costs a second render each time.
- **`exhaustive-deps`, 8:** two are deliberate and already suppressed for Biome, with the reason beside them. The other six are a dependency made anew on every render, such as `plan?.clips ?? []`, which defeats the `useMemo` that depends on it. Biome's rule doesn't report those: run on the same files, it's silent.

### What it catches, and what it doesn't

On components written for the purpose:

| A component that, while rendering | Reported |
|---|---|
| reads a ref, `box.current?.offsetWidth` | yes, `refs` |
| writes a ref, `latest.current = onChange` | yes, `refs` |
| calls `Math.random()` or `Date.now()` | yes, `purity` |
| sets state | yes, `set-state-in-render` |
| reads the document directly, `document.activeElement` | **no** |
| changes a prop, `items.push(1)` | **no** |
| updates a ref in an effect, `useInsertionEffect(() => { latest.current = value })` | no, and rightly |

So it isn't a proof of purity. I couldn't find which of those the pdf-sdk mistake was: its history doesn't say whether the DOM was read through a ref or directly. Through a ref, this would have caught it.

### What it costs

- **A second linter.** ESLint, its TypeScript parser and the plugin install 138 packages, 76 MB, in every repository with React. The standards ask for minimal, justified dependencies.
- **Time:** 3.3 seconds for image-sdk's 132 files, the largest.
- **57 findings to fix or to answer** before the rules can gate.

## Options

| | Option | In short |
|---|---|---|
| A | Leave it to review | Nothing new to install or run |
| **B** | **Run the plugin, alone, through `sdk-config`** | **ESLint with this one plugin and nothing else. Chosen** |
| C | A Biome plugin of the family's own | No new dependencies; can only match shapes, not follow values |
| D | Move the family's linting to ESLint | One linter again, by replacing the one that works |

## Decision

**Option B: React's own plugin, alone, through `sdk-config`.** Writing a ref while rendering is a real bug under concurrent rendering, and 21 of them passed review, so a tool should catch them. The cost is in development only.

- **ESLint runs one plugin, and only that.** `sdk-config` ships a preset with `eslint-plugin-react-hooks` and a parser for TypeScript, over the files that hold React. No other ESLint rule is turned on, now or later, without its own record: Biome stays the family's linter and formatter.
- **A command, `hm-lint-react`,** runs it, as `hm-lint-deps` runs dependency-cruiser. A repository adds it to its `lint` script.
- **ESLint, the plugin and the parser are optional peer dependencies of `sdk-config`,** marked optional in `peerDependenciesMeta`, so only repositories with React install them. Without them, the preset and the command fail at once with a message that names what to install.
- **They're pinned exactly** in each repository, and wait out the family's `minimumReleaseAge` like any other dependency. A second linter is 138 more packages to keep an eye on, and they get the same care as the rest.
- **The rules, in two groups:**
  - **On from the start, as errors,** because no repository has a finding: `purity`, `set-state-in-render`, `static-components`, `error-boundaries`, `globals`, `use-memo`, `void-use-memo`, `incompatible-library`, `unsupported-syntax`, `config` and `gating`. They cost nothing to adopt and stop the mistakes that are plainly wrong.
  - **Off in a repository while it has findings for them, then on as errors:** `refs`, `immutability`, `set-state-in-effect`, `exhaustive-deps` and `preserve-manual-memoization`, which has `ui`'s one other finding. A repository turns off exactly the rules it has findings for, by name, where its configuration says which backlog item fixes them. The pull request that fixes a rule's findings turns it on. **Never as a warning:** a rule set to warn stays at warn for ever.
- **`rules-of-hooks` stays Biome's.** It already checks that, and two reports of one mistake help nobody.
- **`exhaustive-deps` is the plugin's alone.** The shared Biome preset turns `useExhaustiveDependencies` off. The plugin found six problems Biome's rule missed, and with one rule a deliberate exception has one suppression, with its reason. A repository's existing `biome-ignore` comments for that rule become the plugin's, in the pull request that turns the plugin's rule on.
  - **No repository is left with neither.** video-sdk, audio-sdk and learn-sdk have `exhaustive-deps` findings, so the plugin's rule starts off there. Each turns Biome's rule back on in its own `biome.json`, in the pull request that adds the command, and takes that line out in the pull request that fixes its findings and turns the plugin's rule on. Dependency lists are checked by one of the two at every commit.
- **The latest-ref pattern gets one shared hook, `useLatest`, in `ui`.** It's most of the 21 `refs` findings, in every repository. `ui` exports it from `@hussmartinez/ui/react`, in a pull request and a patch of its own, and the SDKs use it. It returns a ref that holds the latest value of what it's given.
  - **When the ref updates is part of its contract.** A child's layout effect, and an event handler that fires right after a commit, must both read the latest value. A passive `useEffect` is too late for either: it runs after layout effects, and can run after the browser has painted.
  - **So it updates in `useInsertionEffect`.** Insertion effects run during the commit, before any component's layout effects. The hook exists in every React the family supports, from 18.3. Rendered on the server with React 18.3.1, a component that uses it logs nothing, where the same component with `useLayoutEffect` logs React's warning that the effect does nothing on the server.
  - **`ui`'s pull request tests both:** a child's layout effect and a handler fired straight after a commit read the latest value, and rendering on the server with React 18.3 logs no warning. If either fails, the choice of effect comes back here.
  - React's own answer for effects is `useEffectEvent`, which needs React 19.2. When the family's minimum moves, a use that's only called from effects can become it. One that's called from an event handler can't: React doesn't allow an Effect Event to be called from a handler. Those keep `useLatest`.
- **A suppression says why,** on the line, as Biome's do: `// eslint-disable-next-line react-hooks/immutability -- <reason>`. One without a reason fails.

### Adoption

In this order:

1. **`sdk-config`:** the preset, the command and its tests, and `useExhaustiveDependencies` turned off in the Biome preset, in one pull request. A minor: a repository that takes it loses Biome's dependency check. So the pull request that takes it always adds the command, and a repository with `exhaustive-deps` findings also turns Biome's rule back on in its own `biome.json`, in that same pull request.
2. **`ui`:** `useLatest`, with its timing tests.
3. **Each repository,** as its own backlog item: add the command, with the rules it has findings for turned off and listed; then fix them and turn each on. No source changes in the pull request that adds the command. Turning `refs` on needs the `ui` release with `useLatest`, so that step waits for it.

learn-sdk is nearest, with four findings.

## Alternatives considered

- **A, leaving it to review:** it's what caught the pdf-sdk mistake, once. Review doesn't reliably see that a line runs during render, and 21 ref writes across six repositories got through it.
- **C, a Biome plugin of the family's own:** Biome's plugins match the shape of code. "A ref's `current` is assigned at the top level of a component" can be matched; "this value came from a ref" can't, and neither can purity or state. It would cover the latest-ref pattern and little else, and the family would own an analysis React already maintains.
- **D, moving all linting to ESLint:** one tool, and the plugin would be at home. It would also replace a linter and formatter that every repository runs in milliseconds, for the sake of one plugin, and add far more than 138 packages.
- **The React Compiler itself, at build time:** it reports the same violations, by skipping the components it can't compile. The family doesn't compile its packages with it, and whether to is a larger question than a lint.
- **All the plugin's rules as errors at once:** 57 findings would block every repository's next pull request on fixes unrelated to it.
- **Rules with findings set to warn until they're fixed,** as this record first proposed: a warning that's always there stops being read, and nothing forces it to become an error. A rule that's off, with a backlog item beside it, says plainly that it isn't checked yet.
- **`exhaustive-deps` in both linters:** also first proposed. Every deliberate exception would need two suppressions that say the same thing.

## Consequences

- A component that reads or writes a ref while rendering, calls something the plugin knows to be impure, or sets state unconditionally fails `lint`, in every repository, once it has adopted the rule. The plugin allows a state update behind a condition, which is React's pattern for adjusting state when a prop changes, so not every state update during render is reported.
- Six unstable `useMemo` dependencies that Biome can't see are found.
- **Every repository with React installs ESLint beside Biome:** 138 packages that the family's supply-chain rules now have to cover, with their own updates.
- **It doesn't make rendering provably pure.** A direct read of the document while rendering, and a changed prop, still need review.
- **Follow-up work:** the shared hook in `ui`, then 57 findings across six repositories, the largest group of them one mechanical change.
