// Render favicon PNGs and the default social card from public/favicon.svg.
// Usage: node scripts/build-brand-assets.mjs
import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const icon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
for (const [file, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  const png = new Resvg(icon, { fitTo: { mode: "width", value: size } }).render().asPng();
  await writeFile(new URL(`../public/${file}`, import.meta.url), png);
}
const mark = icon.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">', '<svg x="80" y="190" width="150" height="150" viewBox="0 0 64 64">');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#f8fafc"/><rect width="1200" height="12" fill="#4f46e5"/>
${mark}
<text x="260" y="265" font-size="88" font-weight="800" fill="#0f172a">DataForge</text>
<text x="262" y="325" font-size="36" font-weight="600" fill="#4f46e5">Learn. Practice. Build. Master Data.</text>
<text x="82" y="470" font-size="32" fill="#475569">SQL · Python · ETL · Data Warehousing · Spark · Airflow · dbt · Cloud</text>
<text x="82" y="530" font-size="28" fill="#64748b">Real PostgreSQL in your browser — free</text>
</svg>`;
await writeFile(new URL("../public/og-image.png", import.meta.url), new Resvg(og, { font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" } }).render().asPng());
console.log("brand assets written");
