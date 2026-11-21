---
"@hussmartinez/sdk-config": patch
---

`hm-check-bundled-engines` no longer turns itself off when a repository builds on what `defineDependencyRules` returns, and it now fails when it finds no engine to check.

**What went wrong.** The declared engines were kept on the configuration as a hidden property. Spreading the configuration into a new object, to add an option, lost them. The check then printed "No bundled engines are declared" and passed.

**What changed:**

- **The engines are read back from the rules themselves,** so a copy of the configuration has them however it's made: spread, `structuredClone`, or written out and read back. Build on the result and keep its `forbidden` rules:

  ```js
  const rules = defineDependencyRules({ bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }] });

  export default {
    ...rules,
    forbidden: [...rules.forbidden, myOwnRule],
    options: { ...rules.options, exclude: { path: ["generated/"] } },
  };
  ```

- **Finding no engine fails the check.** If your package bundles none and still runs `hm-check-bundled-engines`, say so: `defineDependencyRules({ bundledEngines: [] })`. Leaving the option out says nothing either way, and the check then fails with what to write.

**If your check starts failing after this release,** it was passing without checking anything. Either your engines' declaration wasn't reaching it, which this release fixes for a spread configuration, or the package declares none and needs `bundledEngines: []`.

`bundledEnginesOf(configuration)` now returns one entry per package and folder, and there's a new `declaresNoBundledEngines(configuration)`.
