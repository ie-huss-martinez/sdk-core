---
"@hussmartinez/sdk-config": patch
---

Three fixes to how `importBudget` and `hm-size` measure an import, found by image-sdk.

**Unused names are now cut from every import statement, not only those at the top of a bundle.** esbuild writes a module's imports where that module's code starts, so a large bundle has import statements deep inside it, and those kept their unused names. In image-sdk, the React scenarios read 0.4 to 0.6 kB lower for it; its floors and its core scenarios don't move.

**A correction to 0.12.1's note.** It said every number would stay the same or go down. That's true of a bundle's bytes, and a new test holds it: a rewritten bundle is never longer than the one esbuild built, and a statement that loses no name stays exactly as written. It isn't true of the compressed size, which is what a budget counts. Cutting names can make a bundle a few bytes larger compressed, because the names had been helping compress the text after them: 10 B, in one of image-sdk's scenarios.

**`hm-size --import` and `--exports` no longer read the package's `tsconfig.json`,** and neither does `importBudget`'s check. esbuild found it from the built entry and followed its `paths`; in a package that maps an import to source there, for the type checker, the bundle failed. An application's bundler never reads that file. If your `.size-limit.js` wraps `importBudget` to set `tsconfigRaw: "{}"`, the wrapper can go.

**When you take this release:**

- Run `pnpm check:size`. Lower each floor that dropped by 0.1 kB or more to its new measurement rounded up to the next 0.1 kB, and other import budgets, if you like, to theirs rounded up to the next 0.5 kB.
- **Never raise a floor for a few bytes of compression.** If one fails by a few bytes with no code added to what its import keeps, round it up by 0.1 kB, with a note saying why.
