import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      // Three pages: the player, the editor, and the editor's element.
      input: { player: "index.html", editor: "editor.html", element: "element.html" },
      // The client entries say "use client", which a bundle for the browser
      // only has no use for: that's expected here, not a problem to report.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
