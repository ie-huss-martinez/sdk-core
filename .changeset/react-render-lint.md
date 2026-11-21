---
"@hussmartinez/sdk-config": minor
---

A lint for what React components do while they render (sdk-core ADR 0063), and **the Biome preset no longer checks hook dependency lists: in a repository with React, add `hm-lint-react` in the pull request that takes this release.**

Biome doesn't check that rendering is pure: no reading or writing a ref, no impure call, no setting state while a component renders. React's own plugin, `eslint-plugin-react-hooks`, does. So there's a new entry, `@hussmartinez/sdk-config/eslint-react`, and a command, `hm-lint-react`: ESLint with that one plugin and nothing else. Biome stays the linter and formatter.

**In a repository with React:**

1. Install the three packages, pinned exactly: `pnpm add --save-dev --save-exact eslint eslint-plugin-react-hooks @typescript-eslint/parser`. They're optional peer dependencies.
2. Add `eslint.config.js`:

   ```js
   import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";

   export default await defineReactLint({
     // Rules you still have findings for, each with its backlog item.
     off: ["refs"],
   });
   ```

3. Add `hm-lint-react` to your `lint` script.
4. Turn off, by name, exactly the rules you have findings for: `refs`, `immutability`, `set-state-in-effect`, `exhaustive-deps` or `preserve-manual-memoization`. A rule is an error or it's off, never a warning. Fix them in later pull requests, and take each name out in the one that fixes it. Change no source in this pull request.
5. **If `exhaustive-deps` is in your `off` list,** turn Biome's rule back on in your own `biome.json`, `"correctness": { "useExhaustiveDependencies": "error" }`, until it isn't, so that dependency lists are always checked by one of the two.

**What changed in the Biome preset:** `useExhaustiveDependencies` is off. The plugin's rule replaces it: it also reports a dependency made anew on every render, which Biome's doesn't, and with one rule a deliberate exception is suppressed once. When you turn the plugin's rule on, move your `biome-ignore lint/correctness/useExhaustiveDependencies` comments to `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>`. `hm-lint-react` fails on a suppression without a reason.

**In a repository without React:** nothing to do, and nothing to install.
