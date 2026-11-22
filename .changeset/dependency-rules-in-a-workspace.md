---
"@hussmartinez/sdk-config": patch
---

The dependency rules now hold when a family package is a workspace sibling. dependency-cruiser followed the symlink, so `@hussmartinez/ui` resolved to `../ui/dist/` and the rules that name a package stopped matching: `core-no-ui` missed a `ui` import from the core, and `layer-errors` refused `sdk-core`. The preset now sets `preserveSymlinks`, so a sibling is seen as `node_modules/@hussmartinez/<name>`, as an installed package is. Nothing changes for a repository that installs the family from npm.

`hm-in-image` and `hm-test-visual` also read a workspace whose packages hold packages of their own, such as `packages/*/examples/*` in `pnpm-workspace.yaml`. A star is now expanded in any segment of a pattern, where before only a trailing one was, and anything else stopped the run with an error.
