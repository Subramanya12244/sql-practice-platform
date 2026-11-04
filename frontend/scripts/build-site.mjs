// Build the public static site: client bundle, SSR bundle, then prerender every route.
// Usage: node scripts/build-site.mjs   (VITE_SITE_URL sets the canonical origin)
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-site");
const ssrOut = join(root, "dist-site-server");
const config = join(root, "vite.site.config.ts");
const siteUrl = (process.env.VITE_SITE_URL || "https://sql-practice.pages.dev").replace(/\/$/, "");

await build({ root, configFile: config, logLevel: "warn" });
await build({
  root,
  configFile: config,
  logLevel: "warn",
  build: { ssr: "src/site/entry-server.tsx", outDir: ssrOut, emptyOutDir: true, rollupOptions: { input: "src/site/entry-server.tsx" } },
});

const server = await import(pathToFileURL(join(ssrOut, "entry-server.js")).href);
server.setJsonFetcher(async (p) => JSON.parse(await readFile(join(out, p), "utf8")));

const template = await readFile(join(out, "site.html"), "utf8");
const paths = await server.allPaths();
const indexable = [];

for (const path of paths) {
  const { html, head, noindex, page } = await server.render(path);
  // index/topics are fetched by the client (shared, cached), so keep them out of each page.
  const { index: _i, topics: _t, ...rest } = page.data;
  const embedded = JSON.stringify({ ...page, data: rest }).replace(/</g, "\\u003c");
  const doc = template
    .replace("<!--head-->", head)
    .replace("<!--app-->", html)
    .replace("<!--page-data-->", `<script>window.__PAGE__=${embedded}</script>`);
  const file = path === "/404" ? join(out, "404.html") : join(out, path, "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, doc);
  if (!noindex) indexable.push(path);
}

const today = new Date().toISOString().slice(0, 10);
const priority = (p) => (p === "/" ? "1.0" : p.split("/").length === 2 ? "0.8" : "0.6");
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable
  .map((p) => `  <url><loc>${siteUrl}${p === "/" ? "/" : p}</loc><lastmod>${today}</lastmod><priority>${priority(p)}</priority></url>`)
  .join("\n")}
</urlset>
`;
await writeFile(join(out, "sitemap.xml"), sitemap);
await writeFile(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
await rm(join(out, "site.html"));
await rm(ssrOut, { recursive: true, force: true });

console.log(`Prerendered ${paths.length} pages (${indexable.length} in sitemap) → dist-site/`);
