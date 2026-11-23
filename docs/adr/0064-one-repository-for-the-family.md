# 0064. One repository for the family

- **Status:** Accepted
- **Date:** 2026-11-22
- **Supersedes:** [ADR 0002](0002-one-repository-per-sdk.md) and [ADR 0026](0026-share-ci-steps-from-sdk-ci.md)

## Context

[ADR 0002](0002-one-repository-per-sdk.md) gave each SDK a repository of its own, so that each could be read, versioned and released alone. Nine packages then lived in eight repositories, with a ninth, `sdk-ci`, for the CI steps they shared ([ADR 0026](0026-share-ci-steps-from-sdk-ci.md)).

What that cost, in practice:

- **A change to a shared package took a pull request per repository.** A new `sdk-config` preset was one pull request here, a release, and then an adoption pull request in each SDK, each with its own review and its own release. One decision took seven or more pull requests to land, and the repositories sat on different versions of the family's own packages in between. ai-core was on an older `sdk-config`, and two of the family's checks had findings there that nothing had reported.
- **A cross-package change couldn't be tested before it was published.** `ui`'s change and the SDK that needed it met only after `ui`'s release.
- **The same files were kept in every repository:** workflows, hooks, lint configuration, the browser test image's one line, a catalog of the same dependencies. `sdk-ci` and `sdk-config` removed most of the copies' contents, not the copies.

The maintainer decided on 2026-11-22 to bring the family into one repository.

## Decision

**The family is one pnpm workspace, in this repository, which keeps its name.**

- **Members:** `sdk-core`, `sdk-config`, `ui`, `pdf-sdk`, `audio-sdk`, `video-sdk`, `image-sdk`, `learn-sdk` and `ai-core`, each in `packages/<name>`, with its examples, its end-to-end suite and its own `docs/adr` beside it.
- **Package names and versions don't change.** Each package is still versioned and released on its own, through Changesets ([ADR 0021](0021-version-and-release-with-changesets.md)). An application sees no difference.
- **The family's packages depend on each other as `workspace:^`.** A change to `ui` and to the SDK that uses it is one pull request, tested together. Published, each range is the sibling's version at that release.
- **One catalog, one lockfile, one browser test image.** The catalog is the union of the eight, at the newest version each had. `ci/Dockerfile` here is the only copy of the image's line ([ADR 0025](0025-one-browser-test-image-in-one-place.md)).
- **One Biome configuration, at the root.** Biome refuses a second root configuration in a folder below, so a package's exceptions are entries in the root's file.
- **No history is imported.** Each package came in as one commit that names its repository and commit, listed below. The old repositories stay public and are archived, with a pointer here, so their history, issues and pull requests can still be read.
- **Records keep their numbers.** A package's own records stay in `packages/<name>/docs/adr`. "ADR 0048, in sdk-core" in a package's record or comment still means this folder.
- **`editor-apps` stays a repository of its own.** The applications consume published versions, as any host does, which keeps the published packages honest.

### CI

- **Plain workflows here replace `sdk-ci`'s shared actions.** With one repository there's nothing to share them with. `verify.yml` and `pr-title.yml` hold the steps themselves; the release workflow follows in its own pull request.
- **A pull request verifies the packages it can affect:** a package with a changed file, and every package that depends on one, through any dependency on a workspace package. A change outside `packages/` that isn't documentation, such as the lockfile, the catalog or a workflow, affects all of them. A push to `main` verified all of them, until the amendment below.
- **One job per affected package,** in the browser test image: it builds what the package depends on, then runs the package's own `verify`. A job for the repository runs what isn't any one package's: Biome and the hidden-character check over every file, the single-copy and image checks on the one lockfile, and the tests of the repository's scripts.
- **The required checks keep their names, `verify` and `changeset`.** `verify` passes only when every job above did.

### Releases

- **Noted, 2026-11-22, on moving the release steps here:** `release.yml` holds the steps `sdk-ci` shared, with its scripts and their tests under `.github/release` and `test/release`. Its verify job runs the `verify` of each package the release publishes, one after another, then packs and checks the tarballs ([ADR 0041](0041-publish-the-verified-tarballs.md)).
  - **A version a package's old repository released isn't finished here.** The step that repairs incomplete GitHub Releases would otherwise find each moved package's current version on npm, with no release in this repository, and attest a tarball it never built. It now skips a version whose npm provenance names another repository, or none. A tag, release, plan or this run's publish is enough to count as this repository's; without one, provenance decides, so a version published here whose tag then failed isn't silently skipped. Its release needs the tag, which the workflow never creates from what the registry serves: the step stops, names the commit npm's provenance gives, and says how to tag it.
  - **No npm token.** The workflow's bootstrap token, for a package's first publish, is gone. Every package publishes through its trusted publisher, which names this repository. A package that isn't on npm yet needs its first publish decided when it's added.

### What was imported

On 2026-11-22, each from its repository's `main`:

| Package | From | Commit |
|---|---|---|
| ui | `ie-huss-martinez/ui` | `032252d245a05e53b14b09d3160a7c25e076ea00` |
| pdf-sdk | `ie-huss-martinez/pdf-sdk` | `6a924b607751aed1eb5777cdb573eefec9333269` |
| audio-sdk | `ie-huss-martinez/audio-sdk` | `2d9b3568fcd8bfb76a174581da4870ffb08ee32a` |
| video-sdk | `ie-huss-martinez/video-sdk` | `65012c925421f3d9420e4925ed81960aa2be75b6` |
| image-sdk | `ie-huss-martinez/image-sdk` | `d39bd16bfc22e90f285247891023e0b6a7442062` |
| learn-sdk | `ie-huss-martinez/learn-sdk` | `7ef2d931e16c084ffb0fac806ab081bce5e28b98` |
| ai-core | `ie-huss-martinez/ai-core` | `f6e01674942def737adcf5d4281709077f70d15d` |

Each repository's own tooling files weren't carried: its workflows, hooks, lockfile, workspace file, and its copies of the contributor documents. `ui` was a workspace itself; its package, catalogue, examples and end-to-end suite are all under `packages/ui`.

### Amendment, 2026-11-23: run only what a change needs

The first release from here showed the cost of the rules above: its `verify release` job re-ran the full `verify` of eight packages, browser suites included, for 31 minutes, on a commit whose push had just verified all nine. A one-package pull request cost a full nine-package run again on its push to `main`.

- **A push to `main` verifies the packages it can affect,** by the same rules as a pull request, against the commit `main` was on before it. When that commit isn't known, it verifies every package.
- **A weekly run, and a run started by hand, verify every package.** They're the safety net for what a change's affected list can't see, such as a dependency that broke without a change here.
- **A release doesn't run the tests again.** Its read-only job waits for a Verify run on the same commit that succeeded and ran every package the release publishes, then builds them, packs them from the publish plan and checks the tarballs, which stays the gate before anything publishes ([ADR 0041](0041-publish-the-verified-tarballs.md)). [ADR 0023](0023-verify-releases-in-an-unprivileged-job.md)'s rule still holds: the tests ran in Verify, without the release's permissions, and the publish job runs none. A version pull request's push changes every package it releases, so its own Verify run covers them. Release and Verify start independently, so the job waits a few minutes for a Verify run to appear before it counts none as missing. A release whose commit Verify didn't cover needs a Verify run by hand on `main`, then a re-run of the Release run of the commit it verified, since a re-run keeps its own commit; the job's error says which case applies.
- **Each Verify run on `main` has a concurrency group of its own commit,** so none waits behind or replaces another, and every commit keeps its own result for a release to check.
- **Changesets needs no setting to keep a patch from releasing its dependents.** Under 0.x, a patch already releases only its own package: Changesets brings a dependent along only when the new version leaves its range, which `^0.16.0` does for 0.17.0 and not for 0.16.1. Probed in this workspace, `updateInternalDependencies: "minor"` and the experimental option to update peer dependents only when out of range released exactly the same packages, so neither is set. The patterns that decide which files need a changeset now include what's published from outside `src/`: `formats/`, `api-extractor/` and the notice files. They leave out stories, snapshots and `.test.tsx` files.

## Alternatives considered

- **Staying as it was:** each repository reads well alone. The cost above grew with every shared change and every new SDK.
- **Importing each repository's history:** `git log` would follow a file back to its first commit. It would also interleave eight histories of pull request numbers that mean different things, and the old repositories keep all of it, linked from the import commits.
- **A new repository with a new name:** this one already holds the standards, the records and two of the packages, and its name is in every record that says "in sdk-core".
- **One version for the whole family:** simpler to explain, but a fix to one SDK would release nine packages.
- **Running every package for every pull request:** always safe, and nine browser suites for a one-line change to one SDK. The dependency graph already says which packages a change can reach.
- **A build system with a cache,** such as Turborepo or Nx: it would skip more. It's a dependency and a configuration to keep, for a saving nobody has measured yet. The affected list is one short script, with tests.

## Consequences

- A shared change lands in one pull request, with every package that uses it verified on the same commit. Adoption pull requests, and packages on old versions of the family's own tools, are gone.
- **A change to `sdk-config` or `sdk-core` verifies every package,** because every package depends on them. That's the honest cost of the change, paid once and in parallel.
- **The repository is larger:** more to clone, and one issue tracker for nine packages. Labels by package take the place of separate trackers.
- **A release must publish from this repository.** Each package's trusted publisher on npm is bound to its old repository, so it has to be set again, by the maintainer, before that package's next release. Until then releases are frozen in the old repositories and none is made from here.
- **A break in the root's configuration stops everyone,** where before it stopped one repository. The root holds little, and its own tests run in every pull request.
- **Three packages haven't adopted the React lint** ([ADR 0063](0063-a-lint-for-what-react-components-do-while-rendering.md)): pdf-sdk, audio-sdk and learn-sdk. The root's Biome configuration keeps `useExhaustiveDependencies` on for them until each does, so no dependency list goes unchecked.
- `STANDARDS.md` and the contributor documents still describe one repository per SDK in places. They're brought into line as follow-up work, as are the scripts that create a new SDK's repository.
