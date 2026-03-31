import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playgroundDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: playgroundDir,
  plugins: [vue()],
  resolve: {
    alias: {
      "three-effects": resolve(playgroundDir, "../src/index.ts"),
    },
  },
  server: {
    open: true,
  },
});
