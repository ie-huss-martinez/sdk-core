import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { externalPackages } from "./vite.config.js";

const isExternal = (id: string): boolean =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

/** The core entry's source, which this build never bundles. */
const core = fileURLToPath(new URL("src/index.ts", import.meta.url));

/**
 * The React Native entry (ADR 0010), built on its own, after the other
 * entries and into the same folder, as sdk-core ADR 0069 asks: in one build,
 * what it shares with the React entry would move to a chunk both load, and
 * the web entries would change because a native one exists.
 *
 * It bundles no copy of the core either. Its source imports the core entry,
 * and the build leaves that as an import of `./index.js`, the built core
 * beside it. An application imports both, and so runs one copy of the
 * session's code and one `LearnError` class.
 */
export default defineConfig({
  // The production JSX runtime, as in the web build.
  oxc: {
    jsx: { runtime: "automatic", development: false },
  },
  plugins: [
    {
      name: "core-entry-stays-an-import",
      enforce: "pre",
      async resolveId(source, importer) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        return resolved?.id === core ? { id: "./index.js", external: true } : null;
      },
    },
  ],
  build: {
    lib: {
      entry: { native: "src/native.ts" },
      formats: ["es"],
    },
    // The web build has already written dist/.
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: isExternal,
      output: {
        comments: { legal: true, annotation: true, jsdoc: false },
      },
    },
  },
});
