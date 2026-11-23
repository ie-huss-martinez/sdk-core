# 0066. Real screen readers on a schedule

- **Status:** Accepted
- **Date:** 2026-11-23
- **Refines:** [ADR 0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md), with the real screen readers its virtual one stands in for

## Context

[ADR 0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md) checks what a virtual screen reader says on every pull request. It can't hear what only a real one does: the containers focus enters, a control's changing state, how NVDA's browse and focus modes treat a `grid` or a `listbox`. Those stay with the manual passes in ui and learn-sdk, which nobody has run yet.

[Guidepup](https://github.com/guidepup/guidepup) drives NVDA on Windows and VoiceOver on macOS from JavaScript, at the OS level: it presses keys as a person would, and logs what the screen reader says.

### What the hosted runners can do

Probed on GitHub's hosted runners, 2026-11-23, on a page with two buttons, a toggle, a listbox and a polite live region, pressing Tab, Shift+Tab and Enter:

| Pairing | Result |
|---|---|
| NVDA, real Chrome through Playwright's `chrome` channel, `windows-latest` | Every control's name, role and state, and the live announcement. The same in two runs. |
| NVDA, real Firefox 160, opened by the OS | The same, once Firefox's first-run Terms of Use and onboarding are skipped by its enterprise policies. Before that, NVDA read the dialog instead of the page. |
| VoiceOver, real Safari 27.2, opened by the OS, `macos-26-arm64` | Every control and the live announcement in one run. The next run read VoiceOver's "You are currently on an image…" hint first, and the live announcement came back empty. |
| A Thai voice for NVDA | Installed as Windows' `Language.TextToSpeech~~~th-TH` feature: the OneCore voice Pattara. It takes about 14 minutes. |

- **The browsers must be the real ones.** A screen reader reads the accessibility tree the browser engine builds, so Playwright's patched Firefox or its WebKit build isn't evidence for a person using Firefox or Safari. Playwright can't drive Safari at all. Guidepup doesn't need Playwright: it presses keys at the OS level, so the OS can open the page in the runner's own browser.
- **NVDA** is GPL-2.0. Guidepup downloads it from its own GitHub releases and checks each download's SHA-256. It's run, never redistributed.
- **VoiceOver** needs permissions written to macOS's TCC database, which System Integrity Protection guards. It's off on the hosted macOS runner, so guidepup's setup can write them.

## Decision

**A workflow runs real screen readers on the manual passes' steps, weekly and by hand, never on every pull request.**

- **Pairings, all real browsers:** NVDA with Chrome and with Firefox on Windows, and VoiceOver with Safari on macOS. Chrome opens through Playwright's `chrome` channel; Firefox and Safari through the OS. Every key goes through guidepup.
- **Scripts follow the manual passes** ([ui's](../../packages/ui/docs/testing/manual-pass.md) list, lanes and moving-clips tables, and the multiple-choice table of [learn-sdk's](../../packages/learn-sdk/docs/testing/screen-reader-pass.md)), on the catalogue's static build and learn-sdk's Vite example, served on the runner.
- **NVDA asserts.** Each step names fragments that must be said: a control's name and role, a toggle's state, and each live announcement. They're matched as whole words, without case or punctuation, and a state never matches its opposite ("pressed" isn't in "not pressed"). So NVDA's phrasing can drift without failing, and a missing name, role, state or announcement fails the job.
- **A known bug is a strict expected failure.** A step that fails today for a bug in a component keeps its expected fragments and names the bug's issue and the pairings it fails on. There it must fail: if it passes, the job fails and says to remove the marker. So a fix can't go unnoticed, and a marker can't outlive its bug. An unmarked step that fails, or a marked step that fails on another pairing, fails the job as before.
- **A problem in the runner is reported, not judged** (amended 2026-11-24). A step that the runner, not a component, keeps from working on a pairing, such as NVDA in Firefox starting outside the page in a job's second script ([#213](https://github.com/ie-huss-martinez/sdk-core/issues/213)), is marked report-only there, with the runner's issue. It's reported on the run and never fails it, since it may pass in one run and fail in the next, which a strict marker can't hold. A component's bug is never marked so.
- **Every utterance counts.** Guidepup keeps only the first utterance of each command by default; these runs capture all of it, or a control's name said after its container, or an announcement after a focus change, would be lost.
- **VoiceOver reports, and fails only when it can't start,** until its transcripts are steady across runs. Its spoken hints are turned off, the page settles before the first key, and each step waits until speech has stopped, counting phrases as [ADR 0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md)'s entry does. A pull request that changes the workflow runs each of its scripts three times, and the differences go in the pull request.
- **Every run saves a transcript per script,** with what was said at each step, what was missing, and the operating system, browser and screen reader versions, as an artifact and on the run's summary page.
- **The Thai voice is installed only in learn-sdk's job,** since it takes most of that job's time.
- **When it runs:** weekly, by hand before a release, and on pull requests that change the workflow or its scripts. A Windows and a macOS runner for every pull request would cost more than the changes it would catch, and its transcripts are read by a person.
- **The scripts install with their own lockfile, without install scripts.** The one they have, `ffmpeg-static`'s, downloads ffmpeg for guidepup's screen recordings, which these runs don't make.

## Alternatives considered

- **Playwright's own Firefox and WebKit, through `@guidepup/playwright`:** simpler, and not the browsers people use. A transcript from them would be presented as evidence it isn't.
- **Every pull request:** the earliest warning, at the price of two more runner types on every change, for checks that a person still reads.
- **Asserting full phrases:** NVDA's wording changes with its versions and settings. Fragments for the meaning, the manual passes' own rule, catch what matters without failing on punctuation.
- **VoiceOver asserting from the start:** its probe runs differed, so it would fail at random until steadied. Report-only keeps its transcripts coming without a check nobody trusts.
- **A self-hosted Mac or Windows machine:** steadier, and a machine to keep, secure and pay for.

## Consequences

- What NVDA says for ui's list and timeline, and for learn-sdk's player in Thai, is checked weekly in real Chrome and Firefox, and a regression in a name, role, state or announcement fails the run.
- **The manual passes shrink, and don't go away.** Browse mode, how the structure reads as a page, and anything VoiceOver says until it's steady stay with a person.
- **A schedule finds a regression after it's merged,** up to a week later, where the virtual screen reader of [ADR 0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md) finds most of them on the pull request.
- **Hosted runners can change under it:** a new macOS image could turn SIP on, or a Firefox could show a new first-run screen. The run then fails to start, says so, and the probe's findings above are where to start.
- **Follow-up:** VoiceOver moves to asserting once its transcripts are steady.
