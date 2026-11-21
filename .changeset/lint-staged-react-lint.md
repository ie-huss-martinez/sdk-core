---
"@hussmartinez/sdk-config": patch
---

The React lint in the commit hook, without a function of your own. Two changes, for repositories that adopted `hm-lint-react`:

**The lint-staged preset ships the step.** `withReactLint` adds it after Biome:

```js
// lint-staged.config.js
import { withReactLint } from "@hussmartinez/sdk-config/lint-staged";

export default withReactLint();
```

Whenever a staged file is TypeScript under a `src` folder, it runs `hm-lint-react` with no file named, over the whole of `src`. Naming no file is on purpose: the lint needs every file to judge one, lint-staged splits a task's command at spaces in file names, and the check for `src` reads paths with either kind of separator, so it works on Windows. `withReactLint(yours)` adds the step to your own configuration's `"!(*.css)"` list.

**To migrate:** if your `lint-staged.config.js` has a hand-written function that runs plain `hm-lint-react`, delete it and use `withReactLint()`. If yours passes options, such as `--config` for a configuration under another name, or its own paths, keep it: the preset's step runs the command with none.

**`hm-lint-react` skips a file it's given that its configuration leaves out,** such as a test or a story, as ESLint's `--no-warn-ignored` does. It used to report the file as ignored and exit 1. With only such files given, it says there's nothing to lint and exits 0. A path that doesn't exist still fails, and so does a folder with nothing in it to lint.
