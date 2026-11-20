---
"@hussmartinez/sdk-config": patch
---

Add import budgets and import costs to `@hussmartinez/sdk-config/size` and `hm-size` (sdk-core ADR 0056).

**`importBudget({ name, entry, imports, limit })`** writes a `size-limit` check for what an application ships when it imports part of an entry: bundled and minified, without `react`, `react-dom`, the family's packages and the entry's lazy chunks. Everything else the import brings is counted. It needs `@size-limit/esbuild` beside `size-limit`.

**`entryBudget({ name, entry, limit })`** writes an entry's ceiling, as `entryFiles` did by hand, and turns the esbuild plugin off for it, so the ceiling keeps measuring the built files once that plugin is installed.

```js
import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";

export default [
  entryBudget({ name: "Core (.)", entry: "dist/index.js", limit: "17 kB" }),
  importBudget({ name: "Import: the floor, PdfError", entry: "dist/index.js", imports: "{ PdfError }", limit: "0.9 kB" }),
];
```

**`hm-size` shows what imports cost:**

- `hm-size --exports dist/react.js` prints what each export costs an application that imports only it, cheapest first, and names the floor. A floor close to the whole entry means the entry doesn't come apart.
- `hm-size --import "{ a, b }" --kept dist/react.js` prints one import's cost and what it keeps in its bundle: the functions, and the top-level calls that hold code, such as `defineTool(…)` without `/* @__PURE__ */`.

`importCost`, `exportCosts` and `keptCode` return the same to a script. They need `esbuild`, now an optional peer dependency.

Nothing changes for a repository that doesn't use them. To adopt: add `@size-limit/esbuild`, give each core and React entry a floor, each export over about 2 kB, and a typical application's set, and set each limit from `size-limit`'s number.
