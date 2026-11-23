import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSC = createRequire(import.meta.url).resolve("typescript/bin/tsc");

it("ships declarations for the testing and size entries that match their JSDoc", async () => {
  const out = await mkdtemp(join(tmpdir(), "hm-sdk-config-types-"));
  try {
    execFileSync(process.execPath, [TSC, "-p", "tsconfig.types.json", "--outDir", out], {
      cwd: ROOT,
    });
    for (const name of [
      "testing/audio-output.d.ts",
      "testing/browser-instances.d.ts",
      "testing/conformance.d.ts",
      "testing/firefox-labelled-by.d.ts",
      "testing/firefox-labelled-by-setup.d.ts",
      "testing/fonts.d.ts",
      "testing/require-image.d.ts",
      "testing/screen-reader.d.ts",
      "testing/timeouts.d.ts",
      "testing/visual.d.ts",
      "size/entry.d.ts",
      "size/imports.d.ts",
      "size/index.d.ts",
    ]) {
      const generated = await readFile(join(out, name), "utf8");
      const committed = await readFile(join(ROOT, "src", name), "utf8");
      expect(committed, `src/${name} is out of date: run pnpm types:update`).toBe(generated);
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  // Long work (ADR 0057): it runs the TypeScript compiler, 2 s on a quiet
  // machine, which is over the family's limit on a busy one.
}, 60_000);
