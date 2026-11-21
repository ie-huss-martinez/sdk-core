import { defineConfig } from "vitest/config";
import { unitTimeouts } from "./packages/sdk-config/src/testing/timeouts.js";

// Tests of the repository's own tooling, such as its Changesets
// configuration. Each package has its own Vitest config for its tests.
export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    // The same isolation as sdk-config's tests: these tests run git in
    // temporary repositories, possibly from inside a git hook.
    setupFiles: ["packages/sdk-config/test/isolate-git-env.js"],
    // The family's limits (ADR 0057). These are integration tests: each runs
    // scripts, git, pnpm and fake CLIs as separate processes, and takes a
    // second or two on a quiet machine. The limit only catches hangs; tests
    // that depend on timing check their own timestamps.
    ...unitTimeouts,
  },
});
