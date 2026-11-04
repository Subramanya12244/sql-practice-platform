// Build the public static site: client bundle, SSR bundle, then prerender every route.
// Usage: node scripts/build-site.mjs   (VITE_SITE_URL sets the canonical origin)
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-site");
const ssrOut = join(root, "dist-site-server");
const config = join(root, "vite.site.config.ts");
const siteUrl = (process.env.VITE_SITE_URL || "https://sql-practice-lab.sql-practice-frontend.workers.dev").replace(/\/$/, "");
const attr = (v) => String(v).replace(/[^A-Za-z0-9_\-.:=]/g, "");
// Search Console ownership tag and Cloudflare Web Analytics (cookie-free), both optional.
const extraHead = process.env.VITE_GSC_TOKEN
  ? `<meta name="google-site-verification" content="${attr(process.env.VITE_GSC_TOKEN)}" />`
  : "";
const beacon = process.env.VITE_CF_BEACON
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${attr(process.env.VITE_CF_BEACON)}"}'></script>`
  : "";

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
  const embedded = JSON.stringify({ ...page, data: rest }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const doc = template
    // Function replacers: a string replacement would expand "$'" / "$&" found in content.
    .replace("<!--head-->", () => head + extraHead)
    .replace("<!--app-->", () => html)
    .replace("<!--page-data-->", () => `<script>window.__PAGE__=${embedded}</script>${beacon}`);
  if (!doc.includes(`window.__PAGE__=${embedded}</script>`) || !doc.includes(html)) {
    throw new Error(`Prerender of ${path} mangled its content`);
  }
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

// One 1200×630 social card per question.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrap(text, max = 30) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
const diffColor = { Easy: "#16a34a", Medium: "#d97706", Hard: "#dc2626" };
const index = JSON.parse(await readFile(join(out, "data", "index.json"), "utf8"));
await mkdir(join(out, "og"), { recursive: true });
for (const q of index) {
  const title = wrap(q.title).map((l, i) => `<text x="80" y="${300 + i * 76}" font-size="64" font-weight="700" fill="#0f172a">${esc(l)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#f8fafc"/><rect width="1200" height="12" fill="#4f46e5"/>
<text x="80" y="130" font-size="34" font-weight="600" fill="#4f46e5">SQL Practice Lab · Q${q.number}</text>
<rect x="80" y="160" rx="20" width="${q.difficulty.length * 20 + 40}" height="44" fill="${diffColor[q.difficulty] ?? "#475569"}"/>
<text x="100" y="191" font-size="26" font-weight="700" fill="#ffffff">${esc(q.difficulty)}</text>
<text x="${q.difficulty.length * 20 + 140}" y="191" font-size="28" fill="#475569">${esc(q.topicLabel)}</text>
${title}
<text x="80" y="560" font-size="30" fill="#475569">Solve it free in your browser — real PostgreSQL</text>
</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" } }).render().asPng();
  await writeFile(join(out, "og", `${q.slug}.png`), png);
}
await writeFile(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
await rm(join(out, "site.html"));
await rm(ssrOut, { recursive: true, force: true });

console.log(`Prerendered ${paths.length} pages (${indexable.length} in sitemap) → dist-site/`);
