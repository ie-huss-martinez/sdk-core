---
"@hussmartinez/sdk-config": patch
---

`importBudget`'s checks now bundle the way an application's production build does, and the way `hm-size --import` already measured: as an ES module, with `process.env.NODE_ENV` defined as `"production"`.

`@size-limit/esbuild` sets neither by itself. Its bundle was wrapped in a function, as a script for a page is, and whether development-only code was dropped depended on esbuild's own default, which only applies when a bundle is fully minified.

**Measurements shift slightly.** sdk-core's import scenarios read 0 to 0.02 kB smaller without the wrapper, and `ui` saw its own move by 0.01 to 0.05 kB either way. When you take this release, run `pnpm check:size` and re-check your floors: a floor is its measurement rounded up to the next 0.1 kB, so one that now measures under the step below moves down, as sdk-core's did from 0.4 kB to 0.3 kB.

`importBudget` also takes `modifyEsbuildConfig`, for a package that needs to change the bundle further. It receives the configuration with the format and the define already set, and what it returns is used:

```js
importBudget({
  name: "Import: the floor",
  entry: "dist/index.js",
  imports: "{ PdfError }",
  limit: "0.9 kB",
  modifyEsbuildConfig: (config) => ({ ...config, define: { ...config.define, __DEV__: "false" } }),
});
```

If your `.size-limit.js` spreads `importBudget(...)` and sets its own `modifyEsbuildConfig` beside it, pass it as the option instead, or it replaces this one.
