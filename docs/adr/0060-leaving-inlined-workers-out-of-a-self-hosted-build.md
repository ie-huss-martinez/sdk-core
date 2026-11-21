# 0060. Leaving inlined workers out of a self-hosted build

- **Status:** Proposed
- **Date:** 2026-11-21
- **Refines:** [ADR 0011](0011-worker-messaging-and-assets.md) and [ADR 0038](0038-self-hosted-assets-and-worker-version.md), by letting a host that serves the assets itself build without the inlined copies

## Context

[ADR 0011](0011-worker-messaging-and-assets.md) inlines each SDK's workers and WebAssembly by default, so an SDK works in any bundler without configuration. A host with a strict Content Security Policy passes `assetsUrl` instead, and serves the package's `dist/assets/` itself ([ADR 0038](0038-self-hosted-assets-and-worker-version.md)).

Every SDK with workers chooses between the two the same way, when a worker starts:

```ts
const start = assetsUrl
  ? selfHostedWorker(assets)
  : (await import("./inline-worker.js")).createInlineWorker;
```

The inlined worker is a chunk of its own, loaded only when it's needed, so a page that passes `assetsUrl` never downloads it. But a bundler can't know what `assetsUrl` will be at run time. It sees an `import()` it can follow, and emits the chunk. So a host that serves the assets itself still builds and deploys the inlined copy, which nothing ever requests. [audio-sdk#54](https://github.com/ie-huss-martinez/audio-sdk/issues/54) reported it first.

### What it weighs

In each SDK's built package, uncompressed:

| Package | Inlined worker chunks | Bytes |
|---|---|---|
| pdf-sdk | the processing worker, the render worker, and two WebAssembly modules as text | 5,251,815 |
| video-sdk | the export worker and the media worker | 606,612 |
| image-sdk | the render worker and the job worker | 90,582 |
| audio-sdk | the audio worker | 47,652 |
| learn-sdk | no workers | none |

And in the family's own applications, which all pass `assetsUrl` to the React editor. Their `dist` folders, built on 2026-11-21:

| Application | Inlined chunks nothing loads | The whole build | Share |
|---|---|---|---|
| PDF editor | 5,250,238 | 14,299,562 | 36.7% |
| Video editor | 605,751 | 2,070,430 | 29.3% |
| Image editor | 89,729 | 1,090,655 | 8.2% |
| Audio editor | 47,240 | 957,872 | 4.9% |

Each of those builds also holds the self-hosted copy, under `<kind>-sdk/<version>/`, which is the one its pages load. The worker's code is deployed twice.

**What it costs, and what it doesn't:** no user downloads these bytes. The cost is the size of every deploy, the time to upload it, and a second copy of large third-party code for a security scanner or a reviewer to account for. For pdf-sdk that's a third of the application.

## Options

| | Option | In short |
|---|---|---|
| A | Document it | Say that the chunk is emitted and never loaded |
| **B** | **A resolve condition** | **The host sets one bundler option, and the inlined chunk resolves to a stub. Recommended** |
| C | A separate entry point | `./self-hosted`, whose factories and editor never import the inlined worker |
| D | Inlined workers on request | The host imports the inlined workers and passes them in |

### B, a resolve condition

A package can map an internal name to different files under different conditions, with `imports` in its `package.json`. The SDK imports the inlined worker by such a name, and the package gives it two targets:

```json
{
  "imports": {
    "#inline-worker": {
      "hm-self-hosted": "./dist/lazy/no-inline-worker.js",
      "default": "./dist/lazy/inline-worker.js"
    }
  }
}
```

A host that serves the assets itself adds the condition to its bundler:

```ts
// vite.config.ts
export default defineConfig({
  resolve: { conditions: ["hm-self-hosted", "module", "browser", "development|production"] },
});
```

Its build then holds the stub, which throws if a worker is started without `assetsUrl`.

**Probed,** with a package shaped like this and an application that passes `assetsUrl`:

| Bundler | Without the condition | With it |
|---|---|---|
| Vite 8 | the inlined chunk, 100,054 bytes | the stub, 119 bytes |
| esbuild 0.28 | the inlined chunk, 100,132 bytes | the stub, 203 bytes |

webpack (`resolve.conditionNames`), Rollup's node resolver (`exportConditions`) and Next.js weren't run. The probe was a package written for it, not an SDK's real build.

### C, a separate entry point

`@hussmartinez/pdf-sdk/self-hosted` would export the factories with no inlined worker behind them. The import that pulls the inlined worker in sits in the engine's adapter, which the headless factories, the React editor and the element all use. So one entry isn't enough:

- **The applications above all use the React editor.** A headless `./self-hosted` would do nothing for them. The editor needs a variant too, and then the element.
- **Each variant is a public entry point,** with its API report ([ADR 0033](0033-api-reports-for-several-entry-points.md)), its size budgets ([ADR 0056](0056-size-budgets-for-what-applications-import.md)) and its documentation, in every SDK with workers.
- **A host can mix them by mistake:** the editor from `./react` and a factory from `./self-hosted` build, work, and bring the inlined chunk back, with nothing to say so.

### The two compared

| | B, a condition | C, an entry point |
|---|---|---|
| What a host changes | one bundler option | every import of the SDK |
| What an SDK adds | one mapped import and a stub | two or three entry points, with reports, budgets and docs |
| Public API | unchanged | grows, in every SDK |
| Covers the editor and the element | yes, they share the import | only with a variant of each |
| A mistake a host can make | sets the condition without `assetsUrl`: the stub's error says what to do | mixes entries: the chunk returns silently |
| Needs from the host's bundler | custom resolve conditions | nothing |
| Visible in the host's code | no, it's in the build's configuration | yes, in the import |

C's one real advantage is that it needs nothing from the bundler. B's is that it's one decision in one place, for the SDK and for the host.

## Decision

**Recommended: B. The reviewer rules before any code is written.**

- **One condition for the family: `hm-self-hosted`.** A host sets it once, and it applies to every family SDK in its build.
- **Each SDK imports its inlined workers through `imports` in its `package.json`,** one name per worker, each with a `hm-self-hosted` target and a `default`.
- **The stub throws the SDK's `WORKER_START_FAILED`,** saying that the build left the inlined worker out and that `assetsUrl` is required. It's the error a host already handles for a worker that can't start ([ADR 0038](0038-self-hosted-assets-and-worker-version.md)).
- **Nothing changes for a host that doesn't set it.** Inlined workers stay the default, as [ADR 0011](0011-worker-messaging-and-assets.md) has it, and `assetsUrl` works as today, with the chunk emitted and never loaded.
- **Each SDK's README documents the option for the bundlers it has run it in,** and no others. An SDK's own examples are where it's run.
- **A test in each SDK builds its example with the condition** and fails if an inlined worker's chunk is in the output.

### Adoption

- **pdf-sdk goes first,** because it has the most to gain and the hardest build: 5.25 MB across four chunks, two of them WebAssembly. Its pull request proves the mapping in a real library build, in its Vite example and its Next.js example, before any other SDK copies it.
- **If it can't be made to work in pdf-sdk's real build,** this record is revisited before anyone else adopts, and C is the fallback.
- **video-sdk, image-sdk and audio-sdk** follow in that order, by weight.
- **The family's applications** set the condition once the SDK they use supports it.
- **sdk-core changes nothing in code.** If the stubs turn out identical across SDKs, a shared one is a later question.

## Alternatives considered

- **A, documenting it:** honest, and enough for audio-sdk's 48 kB. It isn't for a third of the PDF editor's deploy.
- **C, a separate entry point:** compared above. It multiplies entry points in every SDK and can be undone silently by one import.
- **D, inlined workers passed in by the host:** the cleanest for a bundler, since nothing is imported that isn't asked for. But it ends [ADR 0011](0011-worker-messaging-and-assets.md)'s default: every host, including the ones that inline today, would have to import and pass the workers. It breaks every SDK's simplest use to fix its least common one.
- **A build-time constant,** such as a `define` the host sets: only a bundler that replaces it inside dependencies and then removes the dead branch drops the chunk, and each does that differently. Resolution conditions are a standard that bundlers share.
- **Telling hosts to alias the chunk's file to an empty module:** the file's name has a hash that changes with each release.

## Consequences

- A host that serves the assets itself can build without the inlined copies: the PDF editor's deploy would drop by about 5.25 MB, a third.
- It's opt-in and additive: a patch or a minor in each SDK, with nothing for other hosts to do.
- **A host has one more thing to know,** and it lives in its bundler's configuration, where it's easy to forget when the bundler changes. The stub's error is what catches a build that set it without `assetsUrl`. Nothing catches a build that forgot it: that build is only larger, as today.
- **It depends on the host's bundler supporting custom conditions.** A host whose bundler doesn't is where it is today.
- **Unproven until pdf-sdk's pull request:** that a library build keeps the mapped import for the host's bundler to resolve, that the targets can have stable names, and that it works under Next.js. This record says so rather than promise it.
