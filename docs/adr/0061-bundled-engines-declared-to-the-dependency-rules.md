# 0061. Bundled engines are declared to the dependency rules

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0008](0008-ports-adapters-and-session.md)'s layer rules as `sdk-config`'s dependency-cruiser preset enforces them, and [ADR 0028](0028-third-party-engines.md), by saying how an SDK tells the preset which engines it bundles
- **Corrected:** 2026-11-21, on running the rules against the SDKs' sources: one pdf-sdk worker imports an engine, and its declaration file doesn't need to move

## Context

`sdk-config`'s dependency-cruiser preset has a rule, `not-to-dev-dep`: published source must not import a `devDependency`, because an application that installs the package wouldn't have it.

An SDK that bundles a third-party engine breaks that rule on purpose. The engine is an exactly pinned `devDependency`, built into the package's own files, so applications never install it and never get a different version of it. The preset has no way to say so, and each SDK has written its own way round it.

### What the SDKs carry today

Read from each repository's `.dependency-cruiser.js` on its `main`, on 2026-11-21:

| Package | Bundled engines | Allowed from | Its exception |
|---|---|---|---|
| pdf-sdk | `pdfjs-dist`, `pdfstudio`, `@cantoo/pdf-lib` | all of `src/adapters/` and `src/workers/` | 17 lines, rule `not-to-dev-dep-except-bundled-engines` |
| image-sdk | `gifenc` | `src/adapters/gif/` | 17 lines, the same rule name |
| video-sdk | `mediabunny` | `src/adapters/mediabunny/` | 16 lines, rule `not-to-dev-dep-except-mediabunny` |
| audio-sdk | none | | none |
| learn-sdk, ui | none | | the preset as it is |

Each copy does the same thing: it finds `not-to-dev-dep` by name in the preset's list, narrows it to leave some folders out, and adds a second rule for those folders that allows only the named packages.

Two more exceptions are copied the same way, on the rule that every import must resolve:

| Package | Exception | What it's for |
|---|---|---|
| pdf-sdk, audio-sdk | `@hussmartinez/<package>/styles.css?url` | Browser tests load `ui`'s stylesheet as a URL, through Vite's `?url`, which dependency-cruiser can't resolve |
| pdf-sdk | `virtual:hm-pdfjs-data` and two more | Modules its Vite plugins generate |

### What's wrong with copies

- **They depend on the preset's insides.** Each one looks a rule up by its name and spreads its `from` and `to`. If the preset renames or reshapes `not-to-dev-dep`, the lookup finds nothing, the copy silently does nothing, and the SDK's engines start failing the original rule, or worse, the exception stays while the rule it narrowed has gone.
- **They've already drifted.** pdf-sdk lets any adapter or worker import any of its engines. image-sdk and video-sdk each allow one folder. Two rule names for one idea.
- **Nothing checks what they assume.** Every SDK's own record says its engine is exactly pinned. All five are today, through the workspace's catalog: `pdfjs-dist` 6.5.438, `pdfstudio` 0.4.0, `@cantoo/pdf-lib` 2.11.1, `gifenc` 1.0.3 and `mediabunny` 1.65.2. No check says so: a range such as `^1.2.0` would pass.
- **pdf-sdk's wide allowance isn't needed.** Its engines are imported from `src/adapters/pdfjs/` and `src/adapters/qpdf/` only. No worker imports one directly.
  - **Corrected, 2026-11-21:** one worker does. `src/workers/pdfjs.worker.ts` imports pdf.js's own worker build, `pdfjs-dist/build/pdf.worker.min.mjs`, for its side effects. The search behind this record looked for `from "pdfjs-dist…"`, which a bare `import "…"` doesn't match. The allowance is still wider than it needs to be: no other worker imports an engine, and no adapter outside those two.
- **The next SDK copies one of the three,** and picks whichever it reads first.

## Options

| | Option | In short |
|---|---|---|
| A | Keep the copies | The state above |
| **B** | **The preset takes a declared list** | **A function builds the rules from the engines an SDK names. Chosen** |
| C | The preset allows adapters and workers any `devDependency` | No list, and no check that a build tool wasn't imported by mistake |
| D | Engines become `dependencies` | Applications install them, in whatever version resolves |

## Decision

**Option B: a declared list, with a function that builds the rules and a command that checks the pins.**

### A function, beside the preset

`@hussmartinez/sdk-config/dependency-cruiser` keeps its default export, the preset as it is, and gains a function:

```js
// .dependency-cruiser.js
import { defineDependencyRules } from "@hussmartinez/sdk-config/dependency-cruiser";

export default defineDependencyRules({
  bundledEngines: [
    { packages: ["pdfjs-dist"], from: "adapters/pdfjs" },
    { packages: ["pdfstudio", "@cantoo/pdf-lib"], from: "adapters/qpdf" },
  ],
  virtualModules: ["virtual:hm-pdfjs-data", "virtual:hm-qpdf-wasm", "virtual:hm-qpdf-wasm-sha256"],
});
```

- **`bundledEngines`:** each entry names packages and the one folder under `src/` that may import them.
- **`virtualModules`:** exact names of modules the SDK's build generates, which can't be resolved from disk.
- **Everything else is the preset.** An SDK with nothing to declare keeps `export { default } from …`.
- **The function is pure.** It builds rules from what it's given, and reads no file: loading a lint configuration never parses the workspace. The engines it was given stay readable from what it returns, so nothing lists them twice.
  - **Corrected, 2026-11-21:** the engines were first kept on the result as a hidden property. A repository that spread the result into a new object, to add an option, lost them, and the pin check then found none and passed: the guard turned itself off, silently. They're now read back from the rules the function writes, one per engine, so any copy of the configuration has them, and they're the engines the rules really allow.

### What the rules enforce

- **An engine is imported only from its folder, as a value or as a type.** It's a rule of its own, by the engine's name, and it doesn't make `not-to-dev-dep`'s exception for type-only imports. An engine's types in another layer would tie that layer to the engine, and in the package's public types they'd name a package that applications don't have. Everywhere else in `src/`, `not-to-dev-dep` applies as it does today.
- **The folder is under `src/adapters/` or `src/workers/`.** Anything else is refused by the function, with a `TypeError`: engines are wrapped by adapters ([ADR 0008](0008-ports-adapters-and-session.md)) and run in workers ([ADR 0028](0028-third-party-engines.md)).
- **One folder per entry, as narrow as it can be:** the adapter that wraps the engine, not all adapters. An engine that two folders import gets two entries, so each is written down.
- **A folder that's declared imports no other `devDependency`.** A build tool imported from an adapter by mistake still fails.
- **Names are names:** packages and virtual modules are matched exactly, never as patterns an SDK writes.

### A command checks the pins

`hm-check-bundled-engines` reads the repository's `.dependency-cruiser.js` for the declared engines, its `package.json`, and the workspace's catalog in `pnpm-workspace.yaml`. It fails, naming the engine and the reason, when a declared engine:

- **isn't in `devDependencies`;**
- **is also in `dependencies`, `peerDependencies` or `optionalDependencies`.** A bundled engine is never something an application installs, so it's in `devDependencies` and nowhere else;
- **isn't exactly pinned:** its version is a range or a tag. A `catalog:` entry counts by the version its catalog gives, which is how every SDK pins its engines today.

An SDK runs it in `pnpm verify`, as it runs its other checks of the package. "Bundled from an exact version" then has a check behind it. With no engines declared, it passes and says so.

**Corrected, 2026-11-21:** with no engine declared, the command now fails rather than pass. A package that bundles none and still runs the check says so, with `bundledEngines: []`, which the function records as a rule that matches nothing.

### The stylesheet exception moves into the preset

`@hussmartinez/<package>/styles.css?url` is allowed from test files, for every SDK, with no declaration. It's the family's own test helper that needs it, so it isn't a per-SDK decision. It's narrowed to tests, where the copies allow it from anywhere.

### Adoption

Each SDK replaces its copy when it next takes an `sdk-config` release, in its own pull request. The stricter rules apply only once it does. An SDK that declares engines adds `hm-check-bundled-engines` to its `verify` script in the same pull request:

- **image-sdk and video-sdk:** one entry each, with the folder they have today. No change in what's allowed.
- **pdf-sdk:** names the folder that wraps each engine, `adapters/pdfjs` and `adapters/qpdf`, in place of all adapters and workers. No code it has today imports an engine from outside those two. Its declaration file for pdf.js's minified builds, `src/types/modules.d.ts`, re-exports the engine's types: it moves into `src/adapters/pdfjs/`, beside the code that uses it.
  - **Corrected, 2026-11-21:** it needs a third entry, for `pdfjs-dist` from its worker: `workers` as its files are laid out today, or a folder of the worker's own if it moves there. With that entry, the rules report nothing in its sources. Its declaration file stays where it is: the rules don't report it, because a `declare module` block in a declaration file isn't an import of the engine.
- **audio-sdk:** deletes its stylesheet exception, and goes back to the preset as it is.

Copies keep working until then: the preset's rule names don't change in this release.

## Alternatives considered

- **A, keeping the copies:** they work today. Each depends on a rule's name and shape inside another package, with nothing to fail if that changes.
- **C, allowing any `devDependency` from adapters and workers:** the shortest. But `devDependencies` are mostly build and test tools, and the rule exists to stop one of those reaching published code. A list keeps that.
- **D, engines as `dependencies`:** each SDK's own record chose bundling, so that an application can't get an engine version the SDK wasn't tested with, and so that the no-network and no-eval proofs of [ADR 0028](0028-third-party-engines.md) hold for the exact files shipped.
- **Patterns instead of names,** for packages or folders: more flexible, and the place mistakes hide. dependency-cruiser also refuses some patterns, which an SDK would find out by trial.
- **The pinning check inside the function,** as this record first proposed: loading a lint configuration would read `package.json` and parse the workspace's catalog, for editors and every other tool that loads it. A command does the same check once, in `verify`.

## Consequences

- An SDK states its bundled engines in a few lines, and the next SDK has one way to do it.
- The preset can change its rules' insides without breaking anyone, once the copies are gone.
- An engine whose version drifts to a range, or that's listed where an application would install it, fails `verify`.
- **pdf-sdk's allowance gets narrower,** to the two folders that use it today. A later import of an engine from somewhere else then has to be written down.
- **One more command in each adopting SDK's `verify`.** An SDK that declares engines and forgets the command gets the import rules without the pin check.
- `defineDependencyRules` and `hm-check-bundled-engines` become public API of `@hussmartinez/sdk-config`: additive and opt-in, a patch.
