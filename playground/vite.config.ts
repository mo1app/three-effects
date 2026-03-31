import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playgroundDir = dirname(fileURLToPath(import.meta.url));

/** GitHub project Pages: `/repo-name/`. Custom domain (apex): `/`. Set in CI via `VITE_BASE`. */
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  root: playgroundDir,
  base,
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
