// Writes every brand asset from src/brandGeometry.js: logo SVGs, favicons, app icons and the default social card.
// Usage: node scripts/build-brand-assets.mjs   (outputs are committed; run it after changing the geometry)
// Design rationale and usage rules: docs/DATAFORGE_BRAND_IDENTITY.md
import { mkdir, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { BRAND_COLORS as C, MARK_BOX, MARK_PATH, MARK_ROWS, WORDMARK, lockupMetrics } from "../src/brandGeometry.js";

const out = (p) => new URL(`../public/${p}`, import.meta.url);
await mkdir(out("brand/"), { recursive: true });

const TITLE = "DataForge";
const svg = (viewBox, body, { w, h, title = TITLE } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${w ? ` width="${w}" height="${h}"` : ""} role="img" aria-labelledby="t"><title id="t">${title}</title>${body}</svg>\n`;

// ── The mark ─────────────────────────────────────────────────────────────
const mark = (fill) => `<path fill="${fill}" d="${MARK_PATH}"/>`;
const markHeated = (face, rest) => `<path fill="${face}" d="${MARK_ROWS[0]}"/><path fill="${rest}" d="${MARK_ROWS[1]}${MARK_ROWS[2]}"/>`;

const markFiles = {
  "brand/mark.svg": svg("0 0 64 64", mark(C.blue)),
  "brand/mark-on-dark.svg": svg("0 0 64 64", mark(C.blueOnDark)),
  "brand/mark-mono-dark.svg": svg("0 0 64 64", mark(C.ink)),
  "brand/mark-mono-light.svg": svg("0 0 64 64", mark(C.white)),
  "brand/mark-heated.svg": svg("0 0 64 64", markHeated(C.ember, C.blue)),
};

// ── The horizontal lockup: mark + wordmark ───────────────────────────────
const L = lockupMetrics();
const lockup = (markFill, wordFill) =>
  svg(`0 0 ${L.width} ${L.height}`, `<g transform="scale(${L.scale})">${mark(markFill)}</g><g fill="${wordFill}" transform="translate(${L.textX} ${L.baseline})"><path d="${WORDMARK.data}"/><path d="${WORDMARK.forge}"/></g>`);
const lockupFiles = {
  "brand/logo-horizontal.svg": lockup(C.blue, C.inkSoft), // for light backgrounds
  "brand/logo-horizontal-on-dark.svg": lockup(C.blueOnDark, "#E2E8F0"), // for dark backgrounds
  "brand/logo-mono-dark.svg": lockup(C.ink, C.ink), // one colour, for light backgrounds and print
  "brand/logo-mono-light.svg": lockup(C.white, C.white), // one colour, for dark or coloured backgrounds
};

// ── Favicon: follows the browser's colour scheme ─────────────────────────
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>DataForge</title><style>path{fill:${C.blue}}@media (prefers-color-scheme:dark){path{fill:${C.blueOnDark}}}</style><path d="${MARK_PATH}"/></svg>\n`;

for (const [file, content] of Object.entries({ ...markFiles, ...lockupFiles, "favicon.svg": favicon })) await writeFile(out(file), content);

// ── PNG renders ──────────────────────────────────────────────────────────
const png = (s, px) => new Resvg(s, { fitTo: { mode: "width", value: px } }).render().asPng();
const plainMark = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${mark(fill)}</svg>`;

/** The mark on a solid tile. `fraction` is the mark's width as a share of the tile; `radius` rounds the tile (0 = full bleed). */
function tile({ bg, fill, fraction, radius }) {
  const k = (64 * fraction) / MARK_BOX.width; // scale so the ink box is `fraction` of the tile width
  const tx = 32 - (MARK_BOX.x + MARK_BOX.width / 2) * k;
  const ty = 32 - (MARK_BOX.y + MARK_BOX.height / 2) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${radius}" fill="${bg}"/><g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${k.toFixed(4)})">${mark(fill)}</g></svg>`;
}

// favicon sizes: the mark alone on transparent
const faviconPngs = {};
for (const px of [16, 32, 48]) {
  faviconPngs[px] = png(plainMark(C.blue), px);
  await writeFile(out(`brand/favicon-${px}.png`), faviconPngs[px]);
}

// favicon.ico: three PNG images in one ICO container
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0); e.writeUInt8(size, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}
await writeFile(out("favicon.ico"), ico([16, 32, 48].map((size) => ({ size, data: faviconPngs[size] }))));

// app icons: white mark on the product blue
await writeFile(out("icon-192.png"), png(tile({ bg: C.blue, fill: C.white, fraction: 0.64, radius: 14 }), 192));
await writeFile(out("icon-512.png"), png(tile({ bg: C.blue, fill: C.white, fraction: 0.64, radius: 14 }), 512));
// maskable: full bleed, mark inside the central 60% so any mask shape keeps it whole
await writeFile(out("icon-maskable-512.png"), png(tile({ bg: C.blue, fill: C.white, fraction: 0.5, radius: 0 }), 512));
// iOS draws its own rounded corners
await writeFile(out("apple-touch-icon.png"), png(tile({ bg: C.blue, fill: C.white, fraction: 0.62, radius: 0 }), 180));

// ── Social card ──────────────────────────────────────────────────────────
const k = 2.2; // lockup scale on the card
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${C.ink}"/>
<rect x="0" y="0" width="1200" height="10" fill="${C.blue}"/>
<g transform="translate(80 150) scale(${k})"><g transform="scale(${L.scale})">${mark(C.blueOnDark)}</g><g fill="#F1F5F9" transform="translate(${L.textX} ${L.baseline})"><path d="${WORDMARK.data}"/><path d="${WORDMARK.forge}"/></g></g>
<rect x="80" y="290" width="72" height="5" fill="${C.ember}"/>
<text x="80" y="370" font-size="46" font-weight="600" fill="#F1F5F9">Learn. Practice. Build. Master Data.</text>
<text x="80" y="450" font-size="30" fill="#94A3B8">SQL · Python · Data Analytics · Data Engineering</text>
<text x="80" y="540" font-size="28" fill="#64748B">Real PostgreSQL and Python in your browser. Free.</text>
</svg>`;
await writeFile(out("og-image.png"), new Resvg(og, { font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" } }).render().asPng());
console.log("brand assets written");
