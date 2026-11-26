# 0068. A faster pull-request loop

- **Status:** Accepted
- **Date:** 2026-11-26
- **Amends:** [ADR 0053](0053-ci-is-the-merge-gate.md), so a draft pull request runs its browser tests on Chromium only and the automated review starts once the pull request is ready; [ADR 0048](0048-visual-regression-for-sdk-editors.md), so only an editor's main states are captured in every theme and density
- **Amended:** 2026-11-26: whether a pull request is a draft is read from GitHub when the run starts, not from the event. Pushing and marking a pull request ready a moment apart started two runs in one concurrency group; the group cancelled the full run and kept the draft's, whose `verify` fails by design. See "How the workflow narrows it"

## Context

During the editor redesign, each pull request went round the same loop several times: a push, a 20 to 30 minute CI run on three browser engines, a new CodeRabbit review of the whole pull request, a fix, and another push. pdf-sdk's #230 did it about six times. Three costs added up:

- **Every push ran every engine,** including the pushes of work in progress that only needed to know whether Chromium still passed. Firefox and WebKit roughly tripled the browser suites' time.
- **CodeRabbit reviewed each push afresh,** with style points among its findings, and reviewed files nobody writes by hand, such as screenshots, API reports and the lockfile. Its default pauses automatic reviews after five reviewed commits, which stalled a pull request until someone asked it to resume.
- **Every editor state was captured in four variants,** light and dark, each compact and comfortable ([ADR 0048](0048-visual-regression-for-sdk-editors.md)). image-sdk had 33 states and 132 screenshots. A change to one panel rewrote four images, and the reviewer looked at each.

The maintainer approved three changes on 2026-11-26. Nothing merges with less checking than before: the full run, and a finished review of the current head, still gate every merge ([ADR 0053](0053-ci-is-the-merge-gate.md)).

## Decision

### CI: Chromium on a draft, every engine before a merge

- **A draft pull request runs its affected packages' `verify` with browser tests on Chromium only.** Everything else in it runs as before: the same packages, build, unit, size and API checks, and the visual tests, which are Chromium-only already.
- **Marking it ready runs every engine,** through the `ready_for_review` event, and so does every push to a pull request that isn't a draft, every push to `main`, and the weekly and manual runs.
- **How the workflow narrows it:** `verify.yml`'s `affected` job asks GitHub whether the pull request is a draft when the run starts, and the package jobs and the required check take `HM_BROWSERS` from its answer: `chromium` for a draft, and empty otherwise. A run whose answer can't be read fails. The event's own draft flag isn't used: of two runs started a moment apart, the one that survives the cancellation started after both events, so only the live state is right for it. Nothing else sets it: no input, branch name or label. `sdk-config`'s `testBrowsers` is the one copy of which engines a suite runs in, and every Vitest browser project and Playwright end-to-end configuration takes its list from it:
  - `all: true`, for `--mode all-browsers` or a capability table's update: every engine;
  - otherwise, with `HM_BROWSERS` set: only the engines it names, and an unknown name throws;
  - otherwise, with `CI` set: every engine;
  - otherwise: Chromium.
- **Why a draft's run can't satisfy the merge gate:** the required `verify` job fails whenever `HM_BROWSERS` is set, after checking the other jobs, with a message to mark the pull request ready. So no run of a draft ever turns `verify` green on its head. The only green `verify` comes from a run that found the pull request ready, and that run tested every engine. Re-running all of a run's jobs asks again: a draft's run fails again, and a run cancelled or narrowed before the pull request was marked ready runs every engine. Re-running only the failed jobs keeps the `affected` job's earlier answer, so it doesn't widen a narrowed run. GitHub also refuses to merge a draft, but the gate doesn't rely on that: when a draft is marked ready, the head keeps the red result until the full run replaces it. Marking it ready cancels a draft's run still in progress. Converting a pull request back to a draft starts no run, and the last full run's result stands. `test/verify-workflow.test.js` runs the job's script both ways.
- **Packages adopt `testBrowsers` as they're touched.** Every package's configuration uses it, except audio-sdk's, video-sdk's and notes-sdk's, which are being changed elsewhere and adopt it when they move onto the editor frame ([ADR 0067](0067-editor-frame-modes-and-host-owned-preferences.md)). Until then their drafts still run every engine: more than this decision asks, never less.

### Automated review: once when ready, then what each push changed

`.coderabbit.yaml`, at the repository's root, configures CodeRabbit for the family:

- **Drafts aren't reviewed.** Marking a pull request ready starts the full review, and each later push gets an incremental review of what it changed.
- **It doesn't pause:** `auto_pause_after_reviewed_commits` is 50, not the default 5.
- **The `chill` profile, with instructions** to report bugs, security problems, accessibility failures and breaches of `STANDARDS.md` and the ADRs, not style that the linters accept or optional refactors.
- **Files nobody writes by hand are left out:** screenshots, `ui`'s generated tokens, token docs and icons, API reports, Vitest snapshots, the lockfile and changelogs. Their sources, and the code that generates them, are reviewed instead.
- **The file is the configuration.** It's reviewed like code, and CodeRabbit's settings page isn't used for anything it covers.

[ADR 0053](0053-ci-is-the-merge-gate.md)'s rules still hold from the moment the pull request is ready: the review of the current head must have finished, and each thread is fixed or answered, then resolved.

### Screenshots: main states in every variant, the rest in one

- **An editor's main states are captured in all four variants:** `empty`, `open`, `settings`, `phone`, `advanced-open` and `easy-start`, which show the frame, its panels, its sheets and the phone layout, and every right-to-left and element state, which show how the page's direction and the host's styles meet each theme and density.
- **Every other state is captured in light-comfortable only,** the defaults a host gets. A theme or density changes tokens and spacing, which the main states already show across the frame; what another state adds is its own layout, which one variant shows. `ui`'s catalogue still checks every component in every theme.
- **`sdk-config`'s `variantsFor(state, { full })`** returns every variant for a state listed in `full`, and `primaryVisualVariant` alone for any other, so each spec lists its main states once.
- **It applies to image-sdk and pdf-sdk now,** whose updates removed the baselines no test produces any more. audio-sdk, video-sdk and notes-sdk follow when they move onto the editor frame. `ui`'s catalogue isn't affected: its themes are the design system's own check.

## Alternatives considered

- **Chromium on every pull request, every engine only on `main`:** a Firefox or WebKit failure would show after the merge, with `main` red and the author gone.
- **A label that asks for the full run:** easy to forget, and anyone who can label could leave it off. The draft flag is already how a pull request says it's unfinished.
- **Letting a draft's `verify` pass, and relying on GitHub refusing to merge drafts:** when the draft is marked ready, the head would show a green `verify` from the Chromium-only run until the full run's check replaced it. Failing it leaves no such window.
- **A second required check, such as `verify-full`:** it needs branch protection changed in every repository, and a skipped required check counts as passing, so the draft case would still need the same guard.
- **Choosing engines by the files a change touches:** what a browser difference depends on can't be read from a path.
- **CodeRabbit on request only:** the gate in ADR 0053 depends on a finished review of the current head, and a review nobody asked for is the one that catches what the author missed.
- **One variant for every state:** a dark-theme or compact-density regression in the frame itself would go unseen.

## Consequences

- An author opens a pull request as a draft while iterating, and gets Chromium's results in about a third of the browser time. A draft's `verify` is red by design; the package jobs show whether the change passed.
- Marking it ready starts the full run and the first review, so the wait ADR 0053 describes starts there. A push to a ready pull request is as slow as before.
- image-sdk keeps 69 screenshots instead of 132, and pdf-sdk 35 instead of 68. A regression that only shows in a secondary state's own layout in dark or compact density is no longer caught, which the main states make rare.
- The required checks are unchanged: `verify`, `changeset` and `pr-title`.
- Another repository that adopts `testBrowsers` passes `HM_BROWSERS` the same way, and fails its own required check on a narrowed run.
