import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playgroundDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: playgroundDir,
  resolve: {
    alias: {
      "three-group-effects": resolve(playgroundDir, "../src/index.ts"),
    },
  },
  server: {
    open: true,
  },
});
