import { defineConfig } from "vite";
import { externalPackages } from "./vite.config.js";

const isExternal = (id: string): boolean =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

/**
 * The React Native entry (sdk-core ADR 0069), built on its own, after the
 * web entries and into the same folder.
 *
 * A build of its own keeps the web entries exactly as they were: in one
 * build, the modules both sides use, such as the error class, would move to
 * a chunk they share, and every web application would load one more file
 * because a native entry exists. The cost is a second copy of those few
 * modules in dist/native.js, which no application loads beside the first.
 *
 * It's one file, with no chunks: Metro resolves a package's `exports`, and
 * has nothing to gain from splitting.
 */
export default defineConfig({
  // The production JSX runtime, as in the web build.
  oxc: {
    jsx: { runtime: "automatic", development: false },
  },
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
        // Legal comments stay: the icons' data carries Lucide's licence line.
        comments: { legal: true, annotation: true, jsdoc: false },
      },
    },
  },
});
