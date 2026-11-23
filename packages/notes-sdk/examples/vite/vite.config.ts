import { defineConfig } from "vite";

// A plain Vite setup: the package must work in one (ADR 0007 in sdk-core).
export default defineConfig({
  build: { target: "es2022" },
});
