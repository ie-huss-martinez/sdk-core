/**
 * Writes the files generated from the token source: src/tokens/tokens.css,
 * docs/tokens.md and the React Native themes, src/native/theme.generated.ts
 * (sdk-core ADR 0069). Vite's module runner loads the TypeScript source, so
 * no extra tool is needed. A unit test fails when the committed files are
 * stale.
 */
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = new URL("../", import.meta.url);
const { module } = await runnerImport<typeof import("../src/tokens/generate.js")>(
  fileURLToPath(new URL("src/tokens/generate.ts", root)),
);
const require = createRequire(root);
for (const [path, source] of Object.entries(module.generateTokenFiles())) {
  // TypeScript is formatted as the repository formats it, so the committed
  // file passes Biome and the staleness test can compare it exactly.
  const content = path.endsWith(".ts")
    ? execFileSync(
        require.resolve("@biomejs/biome/bin/biome"),
        ["format", `--stdin-file-path=${path}`],
        { input: source, encoding: "utf8" },
      )
    : source;
  await writeFile(new URL(path, root), content);
  process.stdout.write(`Wrote ${path}\n`);
}
