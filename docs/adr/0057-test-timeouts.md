# 0057. One set of test timeouts for the family

- **Status:** Proposed
- **Date:** 2026-11-21
- **Refines:** [ADR 0015](0015-verification-and-releases.md)'s tests, by setting how long one may run before it's called hung

## Context

Tests in the family have failed with a timeout on work that was only slow: a click that took 6 s in audio-sdk, an element's first import in image-sdk, a property test that takes 0.3 s on a quiet machine and passed 5 s under load. None was hung. The machine was busy, with several agents' checks running at once.

Each such failure was answered where it happened, with a longer limit on that test or that project. The family now has many answers to one question.

### What the repositories do today

Counted in each repository's test files and configurations on 2026-11-21. Vitest's own defaults are 5 s for a test and 10 s for a hook, or 15 s and 30 s in browser mode; Playwright's are 30 s for a test and 5 s for an assertion.

| Repository | Tests with a limit of their own | Limits set for a whole project |
|---|---|---|
| sdk-core | 12 unit: 30 s, 60 s, 120 s | repository tests 30 s |
| ui | 3 unit: 30 s | none |
| pdf-sdk | 2 unit: 30 s; 2 browser: 3 s, 10 s; 2 end-to-end: 30 s | none |
| audio-sdk | 3 unit: 5 s, 30 s, 150 s | none |
| video-sdk | 5 unit: 30 s, 120 s; 10 browser: 10 s to 30 s | end-to-end 120 s, assertions 20 s |
| image-sdk | 1 unit: 30 s; 2 browser: 20 s, 120 s | browser tests 60 s, and a shared 30 s wait for the first open |
| learn-sdk | 1 unit: 60 s | end-to-end assertions 10 s |

About forty tests carry a limit of their own, in nine different values, and four repositories have settled on four different project limits. The same test, a property test of `cleanFileName`, got its 30 s separately in pdf-sdk, audio-sdk, video-sdk and sdk-core.

### How much slower tests run under load

Measured for this record on the family's shared machine, which has 12 cores: sdk-core's unit tests and the tests of `sdk-config` that start other processes, 581 tests, at idle and beside busy processes at the same priority. No browser was involved.

| | Idle | 24 busy processes (2 per core) | 48 busy processes (4 per core) |
|---|---|---|---|
| 95th percentile test | 51 ms | 131 ms | 241 ms |
| Slowest test | 0.80 s | 2.34 s | 2.30 s |
| Slowdown, median | | 2.5× | 2.9× |
| Slowdown, 90th percentile | | 3.4× | 5.1× |
| Slowdown, largest | | 4.9× | 9.1× |

Slowdown is each test's time against its own idle time, for the 51 tests that take 20 ms or more at idle.

- **A test can run nine times slower with nothing wrong.** The largest slowdowns were in tests that wait on timers or read files.
- **Real load has been worse than this measurement.** image-sdk reported tests of about 0.3 s passing 5 s at a load of about 52, which is over 16 times slower. Busy loops take processor time only; real checks also take memory, disk and browser processes.
- **None of these 581 tests came near 5 s,** because the slowest takes 0.8 s at idle. The default fails once a test takes about 0.3 s at idle and the machine is busy enough, which is the size of a property test or of a test that starts a process.
- **Browser and end-to-end tests weren't measured.** Their load is what the measurement would add to a shared machine, in container starts and browsers. What's known is what the repositories set after their failures: 60 s for image-sdk's browser tests, 120 s for video-sdk's end-to-end tests.

### Where tests run now

Since [ADR 0053](0053-ci-is-the-merge-gate.md), the merge gate is CI, on a machine doing nothing else. What runs on the shared machine is each repository's `pre-push` hook, which runs its unit tests, often while other agents' hooks and checks run, and browser tests run to diagnose a failure. So unit tests are the ones that routinely meet load.

## What a timeout is for

A test's timeout catches a test that will never finish. It isn't a measure of speed: a limit near a test's usual time fails on a busy machine, and says nothing about the code. A test that asserts timing, such as "cancelling stops within a second", measures that itself, with its own clock or fake timers, as the worker client's tests do.

So the limit only has to be longer than any honest run, and its cost is how long a real hang takes to report.

## Options

**A. Leave Vitest's and Playwright's defaults, and answer each failure where it happens.** It's what produced the table above, and each new failure costs an investigation first.

**B. One set of limits for the family, set from the measurements, in `sdk-config`.** Every repository's test configuration takes its limits from one place, and tests stop carrying their own.

**C. Scale limits with the machine,** such as a multiplier from an environment variable or the load average. It keeps limits tight on a quiet machine. It adds a setting that behaves differently per machine, for a number whose only job is to be large enough.

**D. Reduce the load instead,** by limiting each run's workers or queueing runs. It helps, and a shared machine can queue its heavy runs. It can't be the whole answer in the repositories: a contributor's machine has its own load, and the hook must pass there too.

## Decision

**Recommended: B. The reviewer rules before any code is written.**

### The limits

| Tests | Test | Hook | From |
|---|---|---|---|
| Unit (Vitest, Node) | 30 s | 30 s | measured: the slowest unit test here takes 0.8 s; 16 times slower is 13 s |
| Browser (Vitest browser mode) | 60 s | 60 s | image-sdk's, set after its failures; not measured here |
| End-to-end and visual (Playwright) | 60 s, assertions 10 s | | learn-sdk's assertions and half of video-sdk's test limit; not measured here |

- **A unit test that takes over 1.5 s at idle is the exception to look at,** not the limit: at 16 times slower, the worst slowdown reported, it takes 24 s, which leaves little room below 30 s. It's split, or given fewer cases, or carries its own limit with the reason.
- **The browser and end-to-end rows are a starting point taken from practice.** The first failure against them that isn't a hang is evidence for new limits, decided in a record that supersedes this table.

### How repositories use them

- **`sdk-config` exports the limits** as constants for each kind of test, to spread into a Vitest project's `test` options or a Playwright configuration. No repository writes the numbers.
- **A test carries a limit of its own only when it really does long work,** such as encoding a video, with a comment naming the work. The forty existing ones are removed when a repository adopts this, except those.
- **A wait inside a test may be longer than the default for a known slow first step,** such as image-sdk's first open, as a named constant with its reason. It stays shorter than the test's limit.
- **A limit is never raised to make a slow test pass without asking why it's slow.** A test that passes the limit on an idle machine is hung or doing too much.
- **Timing is asserted with the test's own clock,** never by setting a short limit.

## Alternatives considered

Beyond the options above:

- **A longer default only for the hook,** through an environment variable the hook sets: the same test would then have two limits, and a failure would depend on how it was started.
- **No limit at all:** a hung test would then hang the hook and CI until their own limits, which are minutes long, and name no test.
- **Retrying a test that timed out:** it hides real hangs and doubles the time of every failure.

## Consequences

- A unit test of ordinary size no longer fails with a timeout because the machine is busy: one that takes up to 1.5 s at idle has room for the worst slowdown reported. A timeout then points at a hang, at a test that's too large, or at a machine slower than anything measured here, which would be new evidence.
- A real hang takes 30 s to report instead of 5 s, once per hung test.
- About forty per-test limits go, and the four project limits become one.
- The browser and end-to-end limits aren't measured. They may move, with evidence, in a later record.
- Each repository changes its test configurations once, in an adoption pull request.
