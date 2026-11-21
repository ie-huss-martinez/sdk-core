---
"@hussmartinez/sdk-config": patch
---

`size-limit` now fails when an import budget is measured without `importBudget`'s own esbuild settings, instead of reporting a number that looks like any other.

**What could go wrong.** A configuration that wrote `{ ...importBudget(…), modifyEsbuildConfig: mine }` replaced the budget's own `modifyEsbuildConfig` rather than adding to it. The bundle was then built as a script, without the production define, read with the package's `tsconfig.json`, and with every unused import name still counted. `ui` ran that way for a release and missed 0.12.1's correction, with nothing to show it.

**What happens now.** When `size-limit` builds an import budget's bundle and the budget's own settings weren't applied, the run fails after printing its results, naming the budgets:

```text
An import budget was measured without importBudget's own esbuild settings (sdk-core ADR 0056): Import: PdfEditor.
```

**If your check starts failing with that message,** pass your function to `importBudget` as an option, which runs it after its own:

```js
// Before: replaces importBudget's settings.
{ ...importBudget({ name, entry, imports, limit }), modifyEsbuildConfig: mine }

// After: runs both.
importBudget({ name, entry, imports, limit, modifyEsbuildConfig: mine })
```

Two smaller changes with it:

- **`entryBudget` refuses `modifyEsbuildConfig`,** with a `TypeError`. A ceiling measures the built files and bundles nothing, so the function never ran there.
- **`importBudget`'s `import` field is now an object,** `{ [entry]: clause }`, where it was the clause's text. `size-limit` reads both the same way and the numbers don't change. If your configuration reads that field itself, read `check.import[entry]`.
