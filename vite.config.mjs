import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    outDir: "assets",
    emptyOutDir: false,
    sourcemap: mode !== "production",
    minify: mode === "production",
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/kik-component.js"),
      formats: ["es"],
      fileName: () => "kik-component.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
}));
