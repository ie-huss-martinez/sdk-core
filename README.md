# sdk-core

[![npm version of @hussmartinez/sdk-core](https://img.shields.io/npm/v/@hussmartinez/sdk-core)](https://www.npmjs.com/package/@hussmartinez/sdk-core) [![npm version of @hussmartinez/sdk-config](https://img.shields.io/npm/v/@hussmartinez/sdk-config)](https://www.npmjs.com/package/@hussmartinez/sdk-config) [![Verify workflow status on main](https://github.com/ie-huss-martinez/sdk-core/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/ie-huss-martinez/sdk-core/actions/workflows/verify.yml?query=branch%3Amain) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

The `@hussmartinez` SDK family: client-side SDKs for working with PDFs, images, video, audio and learning content, where files never leave the user's device.

This repository is one pnpm workspace that holds every package of the family ([ADR 0064](docs/adr/0064-one-repository-for-the-family.md)). Each is versioned and published on its own:

| Package | What it is |
|---|---|
| [`@hussmartinez/sdk-core`](packages/sdk-core) | Headless runtime code shared by every SDK, with no UI framework |
| [`@hussmartinez/sdk-config`](packages/sdk-config) | Shared development configuration and checks: TypeScript, Biome, stylelint, dependency-cruiser, test and size presets |
| [`@hussmartinez/ui`](packages/ui) | The family's design tokens, styles and React components |
| [`@hussmartinez/ai-core`](packages/ai-core) | Shared AI plumbing, with a network the host configures |
| [`@hussmartinez/pdf-sdk`](packages/pdf-sdk) | PDF |
| [`@hussmartinez/image-sdk`](packages/image-sdk) | Images |
| [`@hussmartinez/video-sdk`](packages/video-sdk) | Video |
| [`@hussmartinez/audio-sdk`](packages/audio-sdk) | Audio |
| [`@hussmartinez/learn-sdk`](packages/learn-sdk) | Learning content |
| [`@hussmartinez/notes-sdk`](packages/notes-sdk) | Handwritten notes |

The standards every package follows live in [`STANDARDS.md`](STANDARDS.md). The reasoning behind them is recorded as architecture decision records in [`docs/adr`](docs/adr); a package's own records are in its `docs/adr`.

> Status: `0.x`. The packages are published, and their APIs may still change between minor versions.

## Development

You need Node 24 (see [`.node-version`](.node-version)) and pnpm. The exact pnpm version is pinned in `package.json`, and pnpm switches to it automatically.

```sh
pnpm install       # also installs the git hooks
pnpm verify:fast   # the subset the pre-push hook runs, for the packages changed since main
pnpm verify        # every package's verify, one after another; it needs Docker for the browser tests
pnpm --filter @hussmartinez/pdf-sdk verify   # one package's
```

CI runs a package's `verify` only when a pull request can affect it. A package's `verify` runs, in order, the steps it has of:

| Step | Script | Tool |
|---|---|---|
| Format and lint | `lint`, once for the whole repository | Biome |
| CSS rules | `lint:css` | stylelint |
| Types | `typecheck` | TypeScript |
| Layer rules | `lint:deps` | dependency-cruiser, through [`hm-lint-deps`](packages/sdk-config#hm-lint-deps) |
| Build | `build` | per package |
| Unit tests | `test` | Vitest |
| Browser tests | `test:browser` | per package |
| Bundle budgets | `check:size` | per package |
| API report | `check:api` | per package |
| Package checks | `check:package` | per package |

Steps marked "per package" run each package's script of the same name, and pass while no package defines one yet.

The git hooks ([ADR 0016](docs/adr/0016-git-hooks-and-merge-guards.md)) run automatically: a secret scan and lint of staged files on commit, a Conventional Commits check of the message, and `pnpm verify:fast` on push.

## Releases

Each package is versioned and released on its own, from changesets ([ADR 0021](docs/adr/0021-version-and-release-with-changesets.md)). Versions stay at `0.x` until the API settles, and during `0.x` a breaking change bumps the minor version.

- **Changelogs:** each package's `CHANGELOG.md`, written for users. The first release creates them.
- **Release notes and files:** the [Releases page](https://github.com/ie-huss-martinez/sdk-core/releases) has each version's notes, its npm tarball and a `SHA256SUMS` file, tagged like `@hussmartinez/sdk-core@0.1.0`.
- **npm:** [`@hussmartinez/sdk-core`](https://www.npmjs.com/package/@hussmartinez/sdk-core) and [`@hussmartinez/sdk-config`](https://www.npmjs.com/package/@hussmartinez/sdk-config), published from GitHub Actions with provenance.
- **Checking a download:** confirm that a tarball was built by this repository's release workflow:

  ```sh
  gh attestation verify hussmartinez-sdk-core-0.1.0.tgz --repo ie-huss-martinez/sdk-core
  sha256sum --check SHA256SUMS
  ```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Coding agents also start with [`AGENTS.md`](AGENTS.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in the [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE)
