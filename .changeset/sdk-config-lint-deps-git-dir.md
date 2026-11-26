---
"@hussmartinez/sdk-config": patch
---

`hm-lint-deps` now works in git hooks run from a linked worktree. Git sets `GIT_DIR` for hooks, which made `git ls-files` treat the package folder as the top of the work tree, so it found no tracked files and failed with "git tracks no source files". It now runs git without `GIT_DIR` and `GIT_WORK_TREE`, so it always uses the repository the package is in. Nothing changes for you otherwise.
