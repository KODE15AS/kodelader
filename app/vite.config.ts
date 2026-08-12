import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

// To innganger: brukerside (index) og adminside (admin).
// base "./" gjør at bygget fungerer både bak Funnel-stien /kodelader og på rot.
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: resolve(__dirname, "web-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "web/index.html"),
        admin: resolve(__dirname, "web/admin.html")
      }
    }
  }
});
