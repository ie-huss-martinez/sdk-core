---
"@hussmartinez/sdk-config": patch
---

`@hussmartinez/sdk-config/dependency-cruiser` now exports `defineDependencyRules`, and there's a new command, `hm-check-bundled-engines` (sdk-core ADR 0061). Together they replace the exception each SDK with a bundled engine wrote by hand.

**Declaring engines.** An SDK that builds a third-party engine into its package names it, with the one folder that wraps it:

```js
// .dependency-cruiser.js
import { defineDependencyRules } from "@hussmartinez/sdk-config/dependency-cruiser";

export default defineDependencyRules({
  bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }],
  virtualModules: ["virtual:hm-pdfjs-data"],
});
```

- Only that folder may import the engine, **as a value or as a type**, and it may import no other devDependency. A hand-written exception allowed type-only imports from anywhere; this doesn't.
- A folder must be under `src/adapters/` or `src/workers/`. An engine that two folders import gets two entries.
- `virtualModules` names modules your build generates, exactly.

**Checking the pins.** Add `hm-check-bundled-engines` to `verify`. It fails when a declared engine isn't in `devDependencies`, is also in `dependencies`, `peerDependencies` or `optionalDependencies`, or isn't one exact version. A `catalog:` version counts by what `pnpm-workspace.yaml` gives.

**To adopt,** in your own pull request: delete the code in `.dependency-cruiser.js` that looks `not-to-dev-dep` up by name, declare your engines instead, and add the command. Nothing changes until you do: the default export is the same preset, and a hand-written exception keeps working.

**One change for everyone:** the preset now allows `@hussmartinez/<package>/styles.css?url` from test code (test files, and anything under `test/` or `tests/`), which browser tests use to load a stylesheet with Vite. If you have your own `STYLESHEET_URLS` exception, you can delete it. Outside test code, that import is reported by a new rule, `stylesheet-url-only-in-tests`; before, it was reported by `not-to-unresolvable`, so nothing that passed now fails.
