---
"@hussmartinez/sdk-config": patch
---

`hm-lint-react` now fails when it reads no file, and the lint-staged preset's `withReactLint` takes the folders to lint.

**What went wrong.** Run bare in a repository with no `src` at its root, such as a monorepo whose source is in `packages/ui/src`, `hm-lint-react` printed "nothing reported in 0 files" and exited 0. So `withReactLint()` there checked nothing, with nothing to show it.

**What changed:**

- **Reading no file is a failure.** The message says where it looked and what to write.
- **`withReactLint(preset, { paths })`** runs the step when a staged TypeScript file is under one of those folders, and passes them to `hm-lint-react`.
- **`defineReactLint({ allowNoFiles: true })`** is how a repository says, on purpose, that there may be nothing to lint yet.

**If your React source isn't under `src` at the repository's root, pass `paths`,** and give `defineReactLint` matching `files`:

```js
// lint-staged.config.js
export default withReactLint(undefined, { paths: ["packages/ui/src"] });

// eslint.config.js
export default await defineReactLint({ files: ["packages/*/src/**/*.{ts,tsx}"] });

// package.json
{ "scripts": { "lint": "biome check . && hm-lint-react packages/ui/src" } }
```

**If your check starts failing after this release,** it was passing without linting anything. Name the folder, as above.

Unchanged: given only files its configuration leaves out, such as a staged test, `hm-lint-react` still says there's nothing to lint and exits 0.
