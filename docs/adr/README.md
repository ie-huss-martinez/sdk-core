# Architecture decision records

Each record captures one significant decision: the context that forced it, what we chose, the alternatives we rejected and the consequences we accept. Records are numbered and immutable. To change a decision, write a new record that supersedes the old one and link the two.

Use [`template.md`](template.md) for new records. Name files `NNNN-short-title.md`, taking the next free number.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-one-repository-per-sdk.md) | One repository per SDK, with shared `sdk-core` and `ui` | Superseded by [0064](0064-one-repository-for-the-family.md); repositories moved to an organisation by [0024](0024-github-organisation-for-the-sdk-family.md); `sdk-ci` added by [0026](0026-share-ci-steps-from-sdk-ci.md); `ai-core` and non-media kinds added by [0035](0035-ai-core-and-host-configured-network.md) |
| [0003](0003-hm-namespace.md) | The `hm` namespace for everything that reaches the page | Accepted |
| [0004](0004-entry-points-and-module-format.md) | Package entry points and module format | Accepted; `ui` as an SDK dependency settled by [0036](0036-ui-as-a-dependency-of-the-sdks.md); `./native` added by [0069](0069-react-native-entry-points.md) |
| [0005](0005-plain-css-with-cascade-layers.md) | Plain CSS with cascade layers | Accepted; one required copy of `ui`'s stylesheet per host by [0036](0036-ui-as-a-dependency-of-the-sdks.md) |
| [0006](0006-design-tokens-and-theming.md) | Design tokens and full theming | Accepted |
| [0007](0007-server-rendering-and-nextjs.md) | Server rendering and Next.js compatibility | Accepted |
| [0008](0008-ports-adapters-and-session.md) | Ports and adapters with a framework-agnostic session | Accepted; its session primitives are shared through [0029](0029-session-store-and-history.md) |
| [0009](0009-features-as-tools.md) | Features as registered tool modules | Accepted; `defineTool` and the registries defined by [0030](0030-tools-and-keyboard-shortcuts.md) |
| [0010](0010-edits-as-commands.md) | Edits as commands with undo history | Accepted; its history is shared through [0029](0029-session-store-and-history.md) |
| [0011](0011-worker-messaging-and-assets.md) | Typed worker messaging, with inline or self-hosted assets | Accepted; refined for engines' own workers by [0028](0028-third-party-engines.md) |
| [0012](0012-hostile-input-and-no-network.md) | Treat every input file as hostile, and make no network requests | Accepted; its pdf.js `isEvalSupported` rule superseded by [0028](0028-third-party-engines.md); "parse only in workers" refined for page-only decoders by [0031](0031-platform-decoders-on-the-page.md); network rule superseded for `ai-core` by [0035](0035-ai-core-and-host-configured-network.md) |
| [0013](0013-browser-and-react-support.md) | Browser and React support | Accepted; React Native and Hermes added by [0069](0069-react-native-entry-points.md) |
| [0014](0014-accessibility-and-translatable-text.md) | Accessibility and translatable text | Accepted |
| [0015](0015-verification-and-releases.md) | Verification, releases and trusted publishing | Accepted; release tooling superseded by [0021](0021-version-and-release-with-changesets.md); the full local verify before a pull request superseded by [0053](0053-ci-is-the-merge-gate.md); what its size budgets measure set out in [0055](0055-what-the-size-budgets-measure.md); import budgets added by [0056](0056-size-budgets-for-what-applications-import.md) |
| [0016](0016-git-hooks-and-merge-guards.md) | Git hooks and merge guards | Accepted; its note on the full local verify superseded by [0053](0053-ci-is-the-merge-gate.md) |
| [0017](0017-core-errors-and-shared-runtime-imports.md) | Where `core/errors` and `@hussmartinez/sdk-core` sit in the core layers | Accepted; `ui`'s place outside the core extended by [0036](0036-ui-as-a-dependency-of-the-sdks.md) |
| [0018](0018-worker-rpc-protocol.md) | The worker RPC protocol, its errors and its buffer rules | Accepted; its abort-reason rule is superseded by [0020](0020-file-policy.md); refined for engines' own workers by [0028](0028-third-party-engines.md) |
| [0019](0019-message-catalogues.md) | Message catalogues as typed, plain-text data | Accepted; its error and warning lookups refined by [0050](0050-error-text-by-reason-and-warning-text.md) |
| [0020](0020-file-policy.md) | File policy: typed limits with warnings, shared by every SDK | Accepted; supersedes [0018](0018-worker-rpc-protocol.md)'s abort-reason rule; refined for page-only decoders by [0031](0031-platform-decoders-on-the-page.md) |
| [0021](0021-version-and-release-with-changesets.md) | Version and release with Changesets | Accepted; supersedes [0015](0015-verification-and-releases.md)'s release tooling; the App credentials' location superseded by [0024](0024-github-organisation-for-the-sdk-family.md); the rule for `package.json` changes narrowed by [0027](0027-dev-only-package-json-changes-need-no-changeset.md) |
| [0022](0022-storybook-for-the-component-catalogue.md) | Storybook for the component catalogue | Accepted |
| [0023](0023-verify-releases-in-an-unprivileged-job.md) | Verify releases in an unprivileged job | Accepted; refines how [0021](0021-version-and-release-with-changesets.md) verifies releases; the image's location superseded by [0025](0025-one-browser-test-image-in-one-place.md); amended by [0041](0041-publish-the-verified-tarballs.md) |
| [0024](0024-github-organisation-for-the-sdk-family.md) | A GitHub organisation for the SDK family | Accepted; supersedes where [0021](0021-version-and-release-with-changesets.md) keeps the App's credentials |
| [0025](0025-one-browser-test-image-in-one-place.md) | One browser test image, in one place | Accepted; supersedes where [0023](0023-verify-releases-in-an-unprivileged-job.md) keeps the image |
| [0026](0026-share-ci-steps-from-sdk-ci.md) | Share the family's CI steps from `sdk-ci` | Superseded by [0064](0064-one-repository-for-the-family.md) |
| [0027](0027-dev-only-package-json-changes-need-no-changeset.md) | Dev-only `package.json` changes need no changeset | Accepted; supersedes part of [0021](0021-version-and-release-with-changesets.md) |
| [0028](0028-third-party-engines.md) | Third-party engines: no code from file data, proven offline, and their own workers | Accepted; supersedes [0012](0012-hostile-input-and-no-network.md)'s pdf.js eval rule |
| [0029](0029-session-store-and-history.md) | Shared session primitives: a store, a history and a reducer type | Accepted; refines [0008](0008-ports-adapters-and-session.md) and [0010](0010-edits-as-commands.md) |
| [0030](0030-tools-and-keyboard-shortcuts.md) | Tools and keyboard shortcuts | Accepted; refines [0009](0009-features-as-tools.md) |
| [0031](0031-platform-decoders-on-the-page.md) | Platform decoders that only run on the page | Accepted; refines [0012](0012-hostile-input-and-no-network.md) and [0020](0020-file-policy.md) |
| [0032](0032-duration-format-and-hertz-unit.md) | A duration format for messages and a hertz unit for limits | Accepted; refines [0019](0019-message-catalogues.md) and [0020](0020-file-policy.md) |
| [0033](0033-api-reports-for-several-entry-points.md) | API reports for packages with several entry points | Accepted |
| [0034](0034-shared-error-helpers.md) | Shared helpers that adapt failures to an SDK's error class | Accepted; refines [0018](0018-worker-rpc-protocol.md) and [0020](0020-file-policy.md) |
| [0035](0035-ai-core-and-host-configured-network.md) | `ai-core` for AI providers, and network access only to host-configured endpoints | Accepted; refines [0002](0002-one-repository-per-sdk.md)'s family; supersedes [0012](0012-hostile-input-and-no-network.md)'s network rule for `ai-core` |
| [0036](0036-ui-as-a-dependency-of-the-sdks.md) | `@hussmartinez/ui` as a dependency of the SDKs | Accepted; refines [0004](0004-entry-points-and-module-format.md), [0005](0005-plain-css-with-cascade-layers.md) and [0017](0017-core-errors-and-shared-runtime-imports.md) |
| [0037](0037-windowed-blob-reader.md) | A windowed `Blob` reader for probes and parsers | Accepted |
| [0038](0038-self-hosted-assets-and-worker-version.md) | Self-hosted assets: one `assetsUrl`, and workers that must match the page's version | Accepted; refines [0011](0011-worker-messaging-and-assets.md) and [0018](0018-worker-rpc-protocol.md) |
| [0039](0039-test-applications-in-each-repository.md) | Test applications live in each repository's `examples/` | Accepted; refines [0007](0007-server-rendering-and-nextjs.md) |
| [0040](0040-editor-element-base.md) | A shared custom-element base: `@hussmartinez/sdk-core/element` | Accepted; refines [0004](0004-entry-points-and-module-format.md); supersedes the standalone styles in `pdf-sdk`'s ADR 0005 |
| [0041](0041-publish-the-verified-tarballs.md) | Publish the tarballs the verify job built and checked | Accepted; amends [0023](0023-verify-releases-in-an-unprivileged-job.md) |
| [0042](0042-timeline-sequence-helpers.md) | Timeline sequence helpers: offsets, locating a position, and snapping | Accepted |
| [0043](0043-no-audio-output-in-firefox-tests.md) | Firefox has no audio output in the browser test image | Accepted; refines [0025](0025-one-browser-test-image-in-one-place.md) |
| [0044](0044-release-age-and-our-own-packages.md) | A one-day release age for third-party packages, but not for our own | Accepted; refines [0012](0012-hostile-input-and-no-network.md) |
| [0045](0045-portable-formats-and-conformance-vectors.md) | Portable formats and language-neutral conformance vectors | Accepted |
| [0046](0046-ui-text-through-the-sdk.md) | `ui`'s text through the SDK's messages | Accepted; refines [0019](0019-message-catalogues.md) and [0036](0036-ui-as-a-dependency-of-the-sdks.md) |
| [0047](0047-one-copy-of-each-family-package.md) | Check that every repository installs one copy of each family package | Accepted; refines [0036](0036-ui-as-a-dependency-of-the-sdks.md) |
| [0048](0048-visual-regression-for-sdk-editors.md) | Visual regression tests for every SDK's editor | Accepted; refines [0039](0039-test-applications-in-each-repository.md); its comparison threshold set by [0054](0054-visual-comparison-tolerance.md); amended by [0068](0068-a-faster-pull-request-loop.md) to capture only the main states in every variant |
| [0049](0049-local-browser-tests-in-the-pinned-image.md) | Local browser tests run in the pinned image | Accepted; refines [0025](0025-one-browser-test-image-in-one-place.md) and [0048](0048-visual-regression-for-sdk-editors.md); amended with a guard, the container's environment and volumes per checkout |
| [0050](0050-error-text-by-reason-and-warning-text.md) | Error text by reason, and text for warnings | Accepted; refines [0019](0019-message-catalogues.md) |
| [0051](0051-clean-file-names.md) | Clean file names once, with `cleanFileName` | Accepted; refines [0012](0012-hostile-input-and-no-network.md) |
| [0052](0052-source-checks-for-hidden-characters-and-abort-listeners.md) | Source checks for hidden characters and abort listeners | Accepted; refines [0015](0015-verification-and-releases.md) and [0016](0016-git-hooks-and-merge-guards.md) |
| [0053](0053-ci-is-the-merge-gate.md) | CI is the merge gate, and the hooks are the local bar | Accepted; supersedes the full local verify before a pull request in [0015](0015-verification-and-releases.md) and [0016](0016-git-hooks-and-merge-guards.md); amended by [0068](0068-a-faster-pull-request-loop.md) for draft pull requests and the automated review |
| [0054](0054-visual-comparison-tolerance.md) | How strictly screenshots are compared | Accepted; refines [0048](0048-visual-regression-for-sdk-editors.md) |
| [0055](0055-what-the-size-budgets-measure.md) | What the size budgets measure | Accepted; refines [0015](0015-verification-and-releases.md) |
| [0056](0056-size-budgets-for-what-applications-import.md) | Size budgets for what applications import | Accepted; amends [0015](0015-verification-and-releases.md); builds on [0055](0055-what-the-size-budgets-measure.md); corrected on unused import names |
| [0057](0057-test-timeouts.md) | One set of test timeouts for the family | Accepted; refines [0015](0015-verification-and-releases.md) |
| [0058](0058-heading-levels-in-editors.md) | Heading levels in editors | Accepted; refines [0014](0014-accessibility-and-translatable-text.md) |
| [0059](0059-interface-text-outside-the-server-safe-entry.md) | Interface text stays out of the server-safe entry | Accepted; refines [0019](0019-message-catalogues.md) and [0046](0046-ui-text-through-the-sdk.md) |
| [0060](0060-leaving-inlined-workers-out-of-a-self-hosted-build.md) | Leaving inlined workers out of a self-hosted build | Accepted; refines [0011](0011-worker-messaging-and-assets.md) and [0038](0038-self-hosted-assets-and-worker-version.md) |
| [0061](0061-bundled-engines-declared-to-the-dependency-rules.md) | Bundled engines are declared to the dependency rules | Accepted; refines [0008](0008-ports-adapters-and-session.md) and [0028](0028-third-party-engines.md); corrected on what pdf-sdk imports |
| [0062](0062-fonts-in-browser-tests.md) | Fonts in browser tests | Accepted; refines [0048](0048-visual-regression-for-sdk-editors.md) and [0025](0025-one-browser-test-image-in-one-place.md) |
| [0063](0063-a-lint-for-what-react-components-do-while-rendering.md) | A lint for what React components do while rendering | Accepted; refines [0015](0015-verification-and-releases.md) |
| [0064](0064-one-repository-for-the-family.md) | One repository for the family | Accepted; supersedes [0002](0002-one-repository-per-sdk.md) and [0026](0026-share-ci-steps-from-sdk-ci.md); noted on releases; amended to run only what a change needs |
| [0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md) | Screen-reader tests with a virtual screen reader | Accepted; refines [0015](0015-verification-and-releases.md) |
| [0066](0066-real-screen-readers-on-a-schedule.md) | Real screen readers on a schedule | Accepted; refines [0065](0065-screen-reader-tests-with-a-virtual-screen-reader.md) |
| [0067](0067-editor-frame-modes-and-host-owned-preferences.md) | One editor frame, three modes and preferences the host keeps | Accepted; refines [0006](0006-design-tokens-and-theming.md) and [0030](0030-tools-and-keyboard-shortcuts.md); amended on one control per panel; its two open questions decided |
| [0068](0068-a-faster-pull-request-loop.md) | A faster pull-request loop | Accepted; amends [0053](0053-ci-is-the-merge-gate.md) and [0048](0048-visual-regression-for-sdk-editors.md) |
| [0069](0069-react-native-entry-points.md) | React Native entry points | Accepted; amends [0004](0004-entry-points-and-module-format.md) and [0013](0013-browser-and-react-support.md); amended to mark an entry experimental until it's checked on a device |
