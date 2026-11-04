import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Dev server: serve site.html for every page route (the prerender handles prod). */
function siteHtmlFallback(): Plugin {
  return {
    name: "site-html-fallback",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "/";
        const isPage = req.headers.accept?.includes("text/html") && !url.split("?")[0].includes(".");
        if (isPage) req.url = "/site.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), siteHtmlFallback()],
  build: {
    outDir: "dist-site",
    emptyOutDir: true,
    rollupOptions: { input: "site.html" },
  },
  // PGlite ships its own wasm/data files; pre-bundling breaks their URLs.
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  server: { port: 5174 },
  preview: { port: 4174 },
});
