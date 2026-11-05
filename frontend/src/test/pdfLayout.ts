/**
 * PDF layout checks for Visual Learning Notes, run on real PDFs (pdfmake with the production
 * fonts, then read back with pdf.js): text outside the page or margins, overlapping text,
 * near-empty and blank pages, and content that should be present but isn't.
 */
import fs from "node:fs";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { analyse, type Family, type Variant } from "../site/lib/notes/fonts";
import { PAGE } from "../site/lib/notes/layout";

const CORE = "src/site/lib/notes/fonts/";
const FULL = "node_modules/dejavu-fonts-ttf/ttf/";
const FILES: Record<"core" | "full", Record<Family, Record<Variant, string>>> = {
  core: {
    DejaVuSans: { normal: CORE + "DejaVuSans.core.ttf", bold: CORE + "DejaVuSans-Bold.core.ttf", italics: CORE + "DejaVuSans-Oblique.core.ttf", bolditalics: CORE + "DejaVuSans-Bold.core.ttf" },
    DejaVuSansMono: { normal: CORE + "DejaVuSansMono.core.ttf", bold: CORE + "DejaVuSansMono-Bold.core.ttf", italics: CORE + "DejaVuSansMono.core.ttf", bolditalics: CORE + "DejaVuSansMono-Bold.core.ttf" },
  },
  full: {
    DejaVuSans: { normal: FULL + "DejaVuSans.ttf", bold: FULL + "DejaVuSans-Bold.ttf", italics: FULL + "DejaVuSans-Oblique.ttf", bolditalics: FULL + "DejaVuSans-BoldOblique.ttf" },
    DejaVuSansMono: { normal: FULL + "DejaVuSansMono.ttf", bold: FULL + "DejaVuSansMono-Bold.ttf", italics: FULL + "DejaVuSansMono-Oblique.ttf", bolditalics: FULL + "DejaVuSansMono-BoldOblique.ttf" },
  },
};

/** Render like the worker does: sanitise, pick the font tier, embed only used faces. */
export async function render(def: TDocumentDefinitions): Promise<{ bytes: Uint8Array; tier: string; pages: number }> {
  const size = { width: PAGE.W, height: PAGE.H, orientation: "portrait" as const };
  const header = def.header as (p: number, n: number, s: unknown) => unknown, footer = def.footer as (p: number, n: number, s: unknown) => unknown;
  const needs = analyse(def as never, [header(2, 2, size), footer(2, 2, size)]);
  const fonts: Record<string, Record<Variant, string>> = {}, vfs: Record<string, string> = {};
  for (const fam of ["DejaVuSans", "DejaVuSansMono"] as Family[]) {
    fonts[fam] = {} as Record<Variant, string>;
    for (const v of ["normal", "bold", "italics", "bolditalics"] as Variant[]) {
      const path = FILES[needs.tier][fam][v];
      const name = path.split("/").pop()!;
      vfs[name] ??= fs.readFileSync(path).toString("base64");
      fonts[fam][v] = name;
    }
  }
  let pages = 0;
  def.footer = ((p: number, n: number, s: unknown) => { pages = n; return footer(p, n, s); }) as never;
  const pdfMake = (await import("pdfmake/build/pdfmake")).default as unknown as { createPdf: (d: unknown, a: unknown, f: unknown, v: unknown) => { getBuffer: (cb: (b: Uint8Array) => void) => void } };
  const bytes: Uint8Array = await new Promise((r) => pdfMake.createPdf(def, undefined, fonts, vfs).getBuffer(r));
  return { bytes, tier: needs.tier, pages };
}

export interface Box { str: string; x: number; y: number; w: number; h: number }
export interface PageInfo { n: number; width: number; height: number; boxes: Box[]; content: Box[] }
export interface Report {
  pages: PageInfo[]; text: string;
  outOfPage: string[]; outsideMargins: string[]; overlaps: string[]; nearEmpty: number[]; blank: number[];
  missing: (expected: string[]) => string[];
}

const BAND_TOP = PAGE.TOP - 8, BAND_BOTTOM = PAGE.BOTTOM - 8; // header/footer bands

export async function inspect(bytes: Uint8Array): Promise<Report> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true }).promise;
  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const tc = await p.getTextContent();
    const boxes: Box[] = [];
    for (const it of tc.items as { str: string; transform: number[]; width: number; height: number }[]) {
      if (!it.str.trim()) continue;
      const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
      boxes.push({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5] - h, w: it.width, h });
    }
    const content = boxes.filter((b) => b.y > BAND_TOP && b.y + b.h < vp.height - BAND_BOTTOM);
    pages.push({ n: i, width: vp.width, height: vp.height, boxes, content });
  }
  const outOfPage: string[] = [], outsideMargins: string[] = [], overlaps: string[] = [], nearEmpty: number[] = [], blank: number[] = [];
  for (const pg of pages) {
    for (const b of pg.boxes) {
      if (b.x < -0.5 || b.x + b.w > pg.width + 0.5 || b.y < -0.5 || b.y + b.h > pg.height + 0.5) outOfPage.push(`p${pg.n}: "${b.str.slice(0, 40)}"`);
      else if (b.x < PAGE.MARGIN - 2 || b.x + b.w > pg.width - PAGE.MARGIN + 2) outsideMargins.push(`p${pg.n}: "${b.str.slice(0, 40)}" x=${b.x.toFixed(1)}..${(b.x + b.w).toFixed(1)}`);
    }
    // Overlap: two text boxes that share real area (not just touching neighbours on one line).
    const c = pg.content;
    for (let a = 0; a < c.length; a++) for (let b = a + 1; b < c.length; b++) {
      const A = c[a], B = c[b];
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      if (ox > 1.5 && oy > Math.min(A.h, B.h) * 0.45) overlaps.push(`p${pg.n}: "${A.str.slice(0, 25)}" × "${B.str.slice(0, 25)}"`);
    }
    if (!c.length) blank.push(pg.n);
    else if (pg.n < pages.length) {
      const used = Math.max(...c.map((b) => b.y + b.h)) - (pg.height > pg.width ? PAGE.TOP : PAGE.TOP);
      const avail = pg.height - PAGE.TOP - PAGE.BOTTOM;
      if (used / avail < 0.15) nearEmpty.push(pg.n);
    }
  }
  const text = pages.map((p) => p.boxes.map((b) => b.str).join(" ")).join("\n");
  const squash = (s: string) => s.replace(/[\s↪]+/g, "");
  const all = squash(text);
  return {
    pages, text, outOfPage, outsideMargins, overlaps, nearEmpty, blank,
    missing: (expected) => expected.filter((e) => e.trim() && !all.includes(squash(e))),
  };
}
