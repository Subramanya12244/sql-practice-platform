// @vitest-environment node
// The brand assets are generated from one geometry file. These tests read the committed files, so a hand edit or a stale
// regeneration shows up: same shape everywhere, one flat colour, right sizes, readable contrast, a maskable icon that survives a mask.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS as C, MARK_BOX, MARK_PATH, MARK_ROWS, WORDMARK, lockupMetrics } from "../brandGeometry.js";
import { BRAND } from "../brand";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const bin = (p: string) => readFileSync(join(root, p));
const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const fills = (svg: string) => new Set([...svg.matchAll(/fill="(#[0-9A-Fa-f]{3,8})"/g)].map((m) => m[1].toUpperCase()));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/** Bounding box of the painted pixels in a render, as fractions of the image. */
function inkBox(svg: string, px: number) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  const { width, height, pixels } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height };
}

describe("the mark's geometry", () => {
  it("is three rows with 3-unit cuts between them, inside the 64 grid", () => {
    expect(MARK_ROWS).toHaveLength(3);
    expect(MARK_PATH).toBe(MARK_ROWS.join(""));
    const rows = MARK_ROWS.map((r) => [...r.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])));
    const [face, waist, base] = [rows[0], rows[1], rows[2]];
    expect(Math.max(...face.filter((_, i) => i % 2 === 1))).toBe(23); // face bottom
    expect(waist[1]).toBe(26); // waist top: a 3-unit cut
    expect(Math.max(...waist.filter((_, i) => i % 2 === 1))).toBe(36);
    expect(base[1]).toBe(39); // base top: a 3-unit cut
  });

  it("paints exactly the declared ink box, centred on the grid", () => {
    const b = inkBox(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${MARK_PATH}"/></svg>`, 640);
    const tol = 0.012;
    expect(b.x0).toBeCloseTo(MARK_BOX.x / 64, 1);
    expect(Math.abs(b.x0 - MARK_BOX.x / 64)).toBeLessThan(tol);
    expect(Math.abs(b.x1 - (MARK_BOX.x + MARK_BOX.width) / 64)).toBeLessThan(tol);
    expect(Math.abs(b.y0 - MARK_BOX.y / 64)).toBeLessThan(tol);
    expect(Math.abs(b.y1 - (MARK_BOX.y + MARK_BOX.height) / 64)).toBeLessThan(tol);
    expect(Math.abs((b.y0 + b.y1) / 2 - 0.5)).toBeLessThan(0.02);
  });

  it("keeps the cuts visible at 32 px and the whole shape visible at 16 px", () => {
    const render = (px: number) => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#000" d="${MARK_PATH}"/></svg>`, { fitTo: { mode: "width", value: px } }).render();
    for (const px of [16, 32]) {
      const { width, height, pixels } = render(px);
      const midX = Math.floor(width * (35 / 64)); // a column through the waist
      const alpha = (y: number) => pixels[(y * width + midX) * 4 + 3];
      const cutY = Math.floor(height * (24.5 / 64)); // inside the first cut
      const faceY = Math.floor(height * (16 / 64));
      expect(alpha(faceY), `${px}px face`).toBeGreaterThan(200);
      expect(alpha(cutY), `${px}px cut`).toBeLessThan(160); // the cut is lighter than solid ink
    }
  });
});

describe("logo files", () => {
  const marks = ["mark", "mark-on-dark", "mark-mono-dark", "mark-mono-light", "mark-heated"].map((n) => `public/brand/${n}.svg`);
  const lockups = ["logo-horizontal", "logo-horizontal-on-dark", "logo-mono-dark", "logo-mono-light"].map((n) => `public/brand/${n}.svg`);

  it("every file has a title for assistive technology and a viewBox, and no raster, filter, gradient, text or script", () => {
    for (const f of [...marks, ...lockups, "public/favicon.svg"]) {
      const s = read(f);
      expect(s, f).toContain("<title");
      expect(s, f).toMatch(/viewBox="[^"]+"/);
      for (const bad of ["<image", "<filter", "Gradient", "<text", "<script", "font-family"]) expect(s, `${f} has ${bad}`).not.toContain(bad);
    }
  });

  it("every mark uses the shared geometry, and every lockup adds the outlined wordmark", () => {
    for (const f of marks.filter((m) => !m.includes("heated"))) expect(read(f), f).toContain(`d="${MARK_PATH}"`);
    expect(read("public/brand/mark-heated.svg")).toContain(MARK_ROWS[0]);
    for (const f of lockups) {
      const s = read(f);
      expect(s, f).toContain(MARK_PATH);
      expect(s, f).toContain(WORDMARK.data);
      expect(s, f).toContain(WORDMARK.forge);
    }
    const L = lockupMetrics();
    expect(read("public/brand/logo-horizontal.svg")).toContain(`viewBox="0 0 ${L.width} ${L.height}"`);
  });

  it("the primary mark is one flat colour, so it never depends on a gradient", () => {
    expect(fills(read("public/brand/mark.svg"))).toEqual(new Set([C.blue.toUpperCase()]));
    expect(fills(read("public/brand/mark-on-dark.svg"))).toEqual(new Set([C.blueOnDark.toUpperCase()]));
    expect(fills(read("public/brand/logo-mono-dark.svg"))).toEqual(new Set([C.ink.toUpperCase()]));
    expect(fills(read("public/brand/logo-mono-light.svg"))).toEqual(new Set([C.white.toUpperCase()]));
    expect(fills(read("public/brand/mark-heated.svg"))).toEqual(new Set([C.ember.toUpperCase(), C.blue.toUpperCase()]));
  });

  it("the lockup's mark and wordmark do not overlap and the wordmark is vertically centred on the mark", () => {
    const L = lockupMetrics();
    const markRight = (MARK_BOX.x + MARK_BOX.width) * L.scale;
    expect(L.textX - markRight).toBeGreaterThanOrEqual(12);
    const markCenter = (MARK_BOX.y + MARK_BOX.height / 2) * L.scale;
    expect(Math.abs(L.baseline - WORDMARK.cap / 2 - markCenter)).toBeLessThan(0.1);
    const b = inkBox(read("public/brand/logo-horizontal.svg"), 880);
    expect(b.x0).toBeGreaterThan(0);
    expect(b.x1).toBeLessThanOrEqual(1);
  });
});

describe("favicons and app icons", () => {
  it("favicon PNGs, the ICO, the app icons and the social card have their stated sizes", () => {
    for (const px of [16, 32, 48]) expect(pngSize(bin(`public/brand/favicon-${px}.png`)), `favicon-${px}`).toEqual({ w: px, h: px });
    expect(pngSize(bin("public/icon-192.png"))).toEqual({ w: 192, h: 192 });
    expect(pngSize(bin("public/icon-512.png"))).toEqual({ w: 512, h: 512 });
    expect(pngSize(bin("public/icon-maskable-512.png"))).toEqual({ w: 512, h: 512 });
    expect(pngSize(bin("public/apple-touch-icon.png"))).toEqual({ w: 180, h: 180 });
    expect(pngSize(bin("public/og-image.png"))).toEqual({ w: 1200, h: 630 });
    const ico = bin("public/favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1); // an icon file
    expect(ico.readUInt16LE(4)).toBe(3); // three images
    expect([0, 1, 2].map((i) => ico.readUInt8(6 + i * 16))).toEqual([16, 32, 48]);
  });

  it("the favicon SVG follows the browser's colour scheme with the two brand blues", () => {
    const s = read("public/favicon.svg");
    expect(s).toContain(C.blue);
    expect(s).toContain("prefers-color-scheme:dark");
    expect(s).toContain(C.blueOnDark);
    expect(s).toContain(MARK_PATH);
  });

  it("the maskable icon keeps the whole mark inside the central 60%, where any mask shape leaves it intact", () => {
    const img = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${bin("public/icon-maskable-512.png").toString("base64")}"/></svg>`).render();
    const { width, height, pixels } = img;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const o = (y * width + x) * 4; if (pixels[o] > 200 && pixels[o + 1] > 200 && pixels[o + 2] > 200) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    expect(x0 / width).toBeGreaterThan(0.2);
    expect(x1 / width).toBeLessThan(0.8);
    expect(y0 / height).toBeGreaterThan(0.2);
    expect(y1 / height).toBeLessThan(0.8);
  });
});

describe("manifest, HTML head and tokens agree", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest")) as { name: string; short_name: string; theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
  const html = read("site.html");

  it("the manifest lists real icons at their real sizes, including a maskable one", () => {
    for (const i of manifest.icons.filter((x) => x.type === "image/png")) {
      const [w] = i.sizes.split("x").map(Number);
      expect(pngSize(bin(`public${i.src}`)).w, i.src).toBe(w);
    }
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.name).toBe(BRAND.name);
    expect(manifest.theme_color.toUpperCase()).toBe(C.ink);
    expect(manifest.background_color.toUpperCase()).toBe(C.ink);
  });

  it("the page links every icon it relies on, and each file exists", () => {
    const hrefs = [...html.matchAll(/<link rel="(?:icon|shortcut icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(expect.arrayContaining(["/favicon.svg", "/brand/favicon-32.png", "/brand/favicon-16.png", "/favicon.ico", "/apple-touch-icon.png", "/manifest.webmanifest"]));
    for (const h of hrefs) expect(() => bin(`public${h}`), h).not.toThrow();
    expect(html).toMatch(new RegExp(`name="theme-color" content="${C.ink}"`, "i"));
  });

  it("the CSS tokens equal the brand colours, light and dark", () => {
    const css = read("src/site/site.css");
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
    const values = [...css.matchAll(/--color-brand: ([\d ]+);/g)].map((m) => m[1]);
    expect(values).toEqual([rgb(C.blue), rgb(C.blueOnDark), rgb(C.blueOnDark)]); // light, .dark, prefers-dark
    expect(css.match(/--color-brand-ember: 255 122 47;/g)).toHaveLength(3);
    expect(read("tailwind.config.js")).toContain('"rgb(var(--color-brand) / <alpha-value>)"');
    expect(BRAND.colors.primary).toBe(C.blue);
  });

  it("the per-question social cards draw the outlined lockup, so the brand name never depends on the build machine's fonts", () => {
    const s = read("scripts/build-site.mjs");
    expect(s).toContain("WORDMARK.data");
    expect(s).toContain("WORDMARK.forge");
    expect(s).toContain("lockupMetrics()");
    expect(s).not.toMatch(/>DataForge/); // no typed brand name in the card template
  });

  it("the old gradient identity is gone", () => {
    for (const f of ["public/manifest.webmanifest", "public/favicon.svg", "src/components/BrandMark.tsx", "src/brand.ts", "scripts/build-site.mjs"]) {
      const s = read(f).toLowerCase();
      expect(s, f).not.toContain("#4f46e5");
      expect(s, f).not.toContain("lineargradient");
    }
  });
});

describe("contrast", () => {
  it("the mark is at least 3:1 on every surface it sits on, and the wordmark at least 7:1", () => {
    expect(contrast(C.blue, C.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(C.blue, C.white)).toBeGreaterThanOrEqual(3);
    expect(contrast(C.blueOnDark, C.ink)).toBeGreaterThanOrEqual(3);
    expect(contrast(C.blueOnDark, "#0F172A")).toBeGreaterThanOrEqual(3);
    expect(contrast(C.inkSoft, C.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast("#E2E8F0", C.ink)).toBeGreaterThanOrEqual(7);
    expect(contrast(C.white, C.blue)).toBeGreaterThanOrEqual(4.5); // the app icon: white mark on the blue tile
  });

  it("the PNG favicon blue still reads (3:1) on a light tab and on a dark browser tab strip", () => {
    expect(contrast(C.blue, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrast(C.blue, "#202124")).toBeGreaterThanOrEqual(3);
  });
});
