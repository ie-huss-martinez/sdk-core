---
"@hussmartinez/sdk-config": patch
---

Add `@hussmartinez/sdk-config/size` and the `hm-size` command, for size budgets (sdk-core ADR 0055).

**`entryFiles(entry)`** lists the files a built entry loads up front: the entry and every chunk it imports statically, directly or through other chunks. It's what an entry's `size-limit` budget should count. If your `.size-limit.js` carries its own `loadedFiles` function, replace it:

```js
import { entryFiles } from "@hussmartinez/sdk-config/size";

export default [
  { name: "Core (.)", path: entryFiles("dist/index.js"), brotli: true, limit: "17 kB" },
];
```

`entryFiles("dist/index.js")` returns what `loadedFiles("index.js")` did, so no budget changes. Unlike the copies, it fails with a clear message when the package isn't built, instead of returning nothing.

**`hm-size <entry>...`** prints each entry's size as its budget counts it, and the same files minified, for the table in a pull request that raises a budget:

```text
dist/index.js: 15.57 kB as built, 11.72 kB minified (25% less), in 2 files
```

The minified number is information only. It's never a budget, and the command never fails because of a size. It uses Vite's minifier, so it needs `vite`, now an optional peer dependency. `measureEntry(entry)` returns both numbers to a script.
