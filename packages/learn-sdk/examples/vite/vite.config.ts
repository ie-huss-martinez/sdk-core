import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      // Two pages: the player and the editor.
      input: { player: "index.html", editor: "editor.html" },
      // The client entries say "use client", which a bundle for the browser
      // only has no use for: that's expected here, not a problem to report.
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
