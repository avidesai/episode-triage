import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Source lives in web/, the built app lands in ../docs next to the data the engine writes.
// In dev, ../docs is served as the public directory so data.json, incidents/ and live/
// resolve exactly as they do on GitHub Pages and under `triage serve`.
export default defineConfig(({ command }) => ({
  root: ".",
  base: "./",
  plugins: [preact()],
  publicDir: command === "serve" ? "../docs" : false,
  build: {
    outDir: "../docs",
    emptyOutDir: false,
    assetsDir: "assets",
    target: "es2020",
    sourcemap: false,
  },
  server: { port: 5173 },
}));
