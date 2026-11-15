---
"@hussmartinez/sdk-config": patch
---

`hm-in-image pnpm <script>` works. The image's `pnpm` was pnpm's placeholder script, because install scripts are off for the integrity-checked install. Commands that spawn `pnpm` directly, as `pnpm exec pnpm` does, failed with "Exec format error". The image now runs pnpm's own `install.js`, which copies the native binary from the checked `@pnpm/exe` package over the placeholders without downloading anything, and its build fails if `pnpm` still isn't a native executable. The image is rebuilt automatically on the next run.
