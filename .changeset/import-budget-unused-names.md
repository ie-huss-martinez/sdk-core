---
"@hussmartinez/sdk-config": patch
---

`importBudget`, `hm-size --import` and `hm-size --exports` now measure only what an import keeps. They no longer count the names a bundle imports from a package left out of it and never uses.

esbuild drops a name a file imports and doesn't use, but only as it reads that file. A name whose uses were tree-shaken away afterwards stayed in the import statement. So a scenario that used one thing from a shared chunk carried the chunk's whole list of names from `react` and from the family's packages. No application pays for that list: its bundler resolves the package and the names are gone. Two things followed:

- **Floors read far too high.** In image-sdk, the React floor's bundle was 1,712 bytes, of which 1,465 were unused names. It measured 704 B; what it keeps is 126 B.
- **A floor moved without a leak.** When a shared chunk imported two more names from sdk-core, every React scenario grew, with no code added to what any import keeps.

The unused names are now cut out of the bundle's import statements before it's measured. Nothing else in the bundle is changed, so **every number stays the same or goes down, and no check turns red.**

**When you take this release, lower your floors.** Run `pnpm check:size`, and set each floor to its new measurement rounded up to the next 0.1 kB, as sdk-core ADR 0056 has it: a floor that's left too high can't notice a small leak. Other import budgets may be lowered to their measurement rounded up to the next 0.5 kB. Scenarios whose imports use everything their chunk imports don't move.
