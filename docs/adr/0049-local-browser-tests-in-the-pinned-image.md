# 0049. Local browser tests run in the pinned image

- **Status:** Accepted
- **Date:** 2026-11-14
- **Refines:** [0025](0025-one-browser-test-image-in-one-place.md), by using the browser test image for local runs too, and [0048](0048-visual-regression-for-sdk-editors.md), whose runner becomes the general one
- **Amended:** 2026-11-21, to refuse browser tests outside the image, and to fix which environment variables reach the container; 2026-11-26, to give each checkout its own `node_modules` volumes

## Context

Local browser tests failed intermittently in every SDK: an iframe that "did not become ready within 60000ms", or a module worker that "failed to load" ([video-sdk#55](https://github.com/ie-huss-martinez/video-sdk/issues/55)). Chromium's net log, recorded with `sdk-config`'s diagnostics, showed the cause. Chromium aborted the dev server's module requests with `ERR_NETWORK_CHANGED`.

- **Why the network changes:** Chromium cancels in-flight requests when the host's network configuration changes, even requests to `localhost`. Docker adds and removes an interface whenever a container or network starts or stops. On a shared machine, that happens all the time: other repositories' verifies, `hm-test-visual`, and the image scripts.
- **CI never sees it:** its verify job runs inside one container ([ADR 0025](0025-one-browser-test-image-in-one-place.md)), whose network namespace the host's changes don't reach.
- **The host's system libraries drift too:** after an Ubuntu upgrade replaced ICU 74 with ICU 78, Playwright's WebKit can't launch on the host at all, because it needs `libicudata.so.74`. The image keeps the libraries Playwright's browsers are built against.

The evidence, from a harness that loads 150 slow modules in Chromium for 12 rounds, and from `sdk-core`'s own browser tests:

| Run | Result |
|---|---|
| Harness on the host, with no Docker activity of its own | 126 imports lost; 252 `ERR_NETWORK_CHANGED` from other projects' containers |
| Harness on the host, while Docker networks are created and removed | 1,728 imports lost; 3,456 `ERR_NETWORK_CHANGED` |
| Harness in the pinned image, during the same churn | none lost; no `ERR_NETWORK_CHANGED` |
| `sdk-core`'s browser tests on the host, during churn | 3 of 3 runs failed: "did not become ready" |
| The same tests in the pinned image, during churn | 3 of 3 runs passed, all 55 tests |

## Decision

- **Local browser tests run in the pinned browser test image,** like CI's: Vitest's browser mode (`test:browser`, `test:browser:all`), the end-to-end suites (`test:e2e`), and the visual tests ([ADR 0048](0048-visual-regression-for-sdk-editors.md)).
- **`hm-in-image <command>`,** in `sdk-config`, runs them:
  - **outside the image,** it builds an image from `ci/Dockerfile`'s `FROM` line with the integrity-checked pnpm. It installs the locked dependencies into the container's own volumes, so the host's binaries never mix with Linux ones, runs the command through `pnpm exec` in the same folder of the checkout, and hands written files back;
  - **inside the image,** where `HM_VISUAL_CONTAINER=1`, as in CI's verify jobs, it runs the command directly.

  A script becomes `"test:browser": "hm-in-image vitest run --project browser"`, and CI is unchanged apart from setting that variable.
- **One image and one set of volumes per repository,** shared with `hm-test-visual`, which now runs through the same code.
  - **Amended, 2026-11-26** ([sdk-core#238](https://github.com/ie-huss-martinez/sdk-core/issues/238)): the `node_modules` volumes are one set per checkout, not per repository. Clones and worktrees of a repository share its workspace name, so two of them running at once installed into the same volumes, and one run failed on a module the other was still writing. Their names now carry the first ten hexadecimal digits of the SHA-256 of the checkout's real path. The image and the pnpm store stay one per repository, so a new checkout downloads nothing it already has, and each install holds a lock in the store's volume, so two never write to it at once.
- **Docker is a prerequisite of local `pnpm verify`,** as [ADR 0048](0048-visual-regression-for-sdk-editors.md) already made it. Without it, the command fails with a one-line message saying how to fix it; it never skips.
- **Git hooks don't change:** `pre-push` runs `verify:fast`, which has no browser tests.

### Amendment, 2026-11-21: a guard, and the container's environment

The decision above only changed the package scripts. Two gaps showed in use.

**Nothing stopped a browser test from starting on a host.** `vitest run --project browser` or `playwright test`, typed directly or run by an editor, still ran there, and failed at random with the `ERR_NETWORK_CHANGED` symptoms above ([audio-sdk#73](https://github.com/ie-huss-martinez/audio-sdk/issues/73)). Each such failure costs an investigation before anyone notices how the tests were started.

- **Every configuration that starts a browser lists a guard,** `@hussmartinez/sdk-config/testing/require-image`, as a global setup: the browser project of each Vitest configuration, and each Playwright end-to-end configuration. Outside the image it fails at once, saying to use `hm-in-image`.
  - **Noted, 2026-11-21:** Playwright starts a configuration's web servers before its global setup, so with servers listed the guard spoke only after each had been built and waited for. An end-to-end configuration therefore lists its servers through `webServersFor`, from the same entry, which lists none where the guard will refuse. It never throws, so the configuration still loads anywhere.
- **It's allowed where the tests are known to work:** in the image, where `HM_VISUAL_CONTAINER=1`, and in CI, where `CI` is set. CI's verify jobs already run in the image; `CI` covers jobs that run browsers on a fresh runner with no other containers, where the network doesn't change.
- **It fires only when a browser project starts,** never while a configuration is loaded. A Vitest configuration holds the unit project too, and editors and type checkers load configurations everywhere. A check inside the configuration, as the visual preset has, would break `pnpm test` on a host.
- **The visual preset keeps its own, stricter check:** it has no `CI` exception, because baselines must only ever be written in the image ([ADR 0048](0048-visual-regression-for-sdk-editors.md)).
- **One named bypass, for debugging only: `HM_ALLOW_HOST_BROWSER=1`.** Watching a headed browser needs the host's display, which the container doesn't have. Without a bypass, developers would set `CI=1` or `HM_VISUAL_CONTAINER=1` falsely, and both mislead: `CI` also changes the engines, retries, reporters and `forbidOnly`, so the run being debugged wouldn't be the usual one, and the image's variable would let the visual preset write baselines on the host. The bypass changes nothing else, the guard prints a notice whenever it's used, and its refusal message names it. It's never for gating: no script, hook or workflow sets it, and `hm-in-image` doesn't pass it on.

**`hm-in-image` passed only `CI` and `DEBUG` into the container.** End-to-end and smoke suites choose their target from the environment, and the browser diagnostics take their folder from it, so those settings were silently dropped ([audio-sdk#75](https://github.com/ie-huss-martinez/audio-sdk/pull/75)).

- **The list is fixed and short:** `CI`, `DEBUG`, `HM_BROWSER_DIAGNOSTICS`, `PLAYWRIGHT_BASE_URL`, `SMOKE_BASE_URL`, `SMOKE_ENGINES` and `SMOKE_ANALYTICS`. A new variable is added here, in `sdk-config`, not per repository.
- **Nothing else crosses,** so tokens and other secrets in a developer's shell never reach the tests, and a run doesn't depend on what one machine happens to export. That's why the list isn't a prefix such as `SMOKE_*`, and why there's no flag to pass arbitrary variables.
- **Variables are passed by name,** so their values don't appear in the `docker` command line.
- **`HM_BROWSER_DIAGNOSTICS` is a folder, so it must be inside the checkout,** the only part of the host the container sees. It's passed as that folder's path in the container, and a folder outside the checkout is a usage error before anything is built, instead of logs that vanish with the container.

## Alternatives considered

- **A Chromium flag that ignores network changes:** none exists. Chromium's switches and features include nothing that stops its network-change notifier, nor anything that ignores particular interfaces such as Docker's bridges.
- **The browser in its own network namespace (`unshare -rn`),** without Docker: lighter, but Ubuntu 24.04 blocks unprivileged user namespaces by default (`kernel.apparmor_restrict_unprivileged_userns=1`), and it doesn't exist on macOS.
- **Retrying a failed load or test:** a module graph that fails to load can't be retried inside the page. Retrying whole tests would also hide real failures, and slow every run that hits one.
- **The host's `node_modules` mounted into the image,** as video-sdk's `test:browser:image` script does: faster, but only while the host is Linux on the same architecture, because native packages such as rolldown and esbuild are built for the host.
- **Accepting the flake:** every SDK's local verify fails at random while other projects use Docker, and the failures say nothing about the change under test.

## Consequences

- Local browser tests behave like CI's: the same browsers, codecs and fonts, and no host network changes. That also makes Firefox and WebKit locally (`test:browser:all`) match CI.
- Each browser step pays for starting a container: about 3 seconds per package once the image and volumes are warm. The first run builds the image and installs the dependencies into the volumes.
- Every repository's CI verify jobs set `HM_VISUAL_CONTAINER: "1"`, an environment variable that `check-workflows` allows as an addition. Its name predates this decision; it marks the browser test image for every command.
- SDKs adopt it in their own pull requests, by changing their browser scripts and their workflows' environment, and drop scripts such as video-sdk's `test:browser:image`.
- Since the amendment, a browser test started the wrong way fails in a second with the command to use, and each SDK adds one line to each configuration that starts a browser. Debugging with a headed browser on the host needs `HM_ALLOW_HOST_BROWSER=1` for that run.
- Since the amendment, a suite that reads a new environment variable needs a release of `sdk-config` before it works through `hm-in-image`.
