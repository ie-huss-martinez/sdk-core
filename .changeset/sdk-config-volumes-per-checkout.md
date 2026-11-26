---
"@hussmartinez/sdk-config": patch
---

`hm-in-image` and `hm-test-visual` give each checkout of a repository its own `node_modules` volumes, so clones and worktrees can run browser tests at the same time.

- **What was wrong:** the volumes were named after the root `package.json`'s name alone, so every checkout of a repository installed into the same ones. Two runs at once could fail with `ERR_MODULE_NOT_FOUND` for a module the other was still writing.
- **Now:** a `node_modules` volume's name carries a short hash of the checkout's path, such as `hm-browser-sdk-core-workspace-d11d92ab5f-root-modules`. The image and the pnpm store are still one per repository, and each install waits for a lock in the store's volume, so a new checkout reuses what's already downloaded.
- **After updating:** the first run in each checkout installs into new volumes. The old ones, `hm-browser-<workspace name>-…-modules` without a hash, are no longer used: remove them with `docker volume rm`. The volumes of a checkout you delete stay until you remove them too; `docker volume ls --filter name=hm-browser-` lists them.
