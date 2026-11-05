/// <reference lib="webworker" />
/**
 * Builds the PDF off the main thread. Only the font variants the document uses are fetched:
 * small DejaVu "core" subsets normally, the full fonts only if the text needs a glyph the
 * subsets lack (see fonts.ts). Files are cached with the Cache API (and by the browser) under
 * content-hashed URLs, so later PDFs load no fonts at all.
 */
import pdfMake from "pdfmake/build/pdfmake";
import type { DynamicContent, TDocumentDefinitions } from "pdfmake/interfaces";
import coreSans from "./fonts/DejaVuSans.core.ttf?url";
import coreSansBold from "./fonts/DejaVuSans-Bold.core.ttf?url";
import coreSansIt from "./fonts/DejaVuSans-Oblique.core.ttf?url";
import coreMono from "./fonts/DejaVuSansMono.core.ttf?url";
import coreMonoBold from "./fonts/DejaVuSansMono-Bold.core.ttf?url";
import sans from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import sansBold from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import sansIt from "dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url";
import sansBoldIt from "dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url";
import mono from "dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url";
import monoBold from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url";
import monoIt from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf?url";
import monoBoldIt from "dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf?url";
import { buildDocDefinition } from "./pdf";
import { analyse, sanitize, type Family, type Variant } from "./fonts";
import type { NoteItem, NotesOptions } from "./content";

/** URL per family and variant. The core set has no separate bold-italic/mono-italic faces. */
const FILES: Record<"core" | "full", Record<Family, Record<Variant, string>>> = {
  core: {
    DejaVuSans: { normal: coreSans, bold: coreSansBold, italics: coreSansIt, bolditalics: coreSansBold },
    DejaVuSansMono: { normal: coreMono, bold: coreMonoBold, italics: coreMono, bolditalics: coreMonoBold },
  },
  full: {
    DejaVuSans: { normal: sans, bold: sansBold, italics: sansIt, bolditalics: sansBoldIt },
    DejaVuSansMono: { normal: mono, bold: monoBold, italics: monoIt, bolditalics: monoBoldIt },
  },
};
const CACHE = "df-pdf-fonts-v1";

const memory = new Map<string, Promise<{ b64: string; bytes: number; fromCache: boolean }>>();
function load(url: string) {
  let p = memory.get(url);
  if (!p) {
    p = (async () => {
      let res: Response | undefined, fromCache = false;
      const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => undefined) : undefined;
      if (cache) { res = await cache.match(url); fromCache = !!res; }
      if (!res) {
        res = await fetch(url);
        if (!res.ok) throw new Error(`Font download failed (${res.status})`);
        if (cache) await cache.put(url, res.clone()).catch(() => undefined);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(bin), bytes: buf.length, fromCache };
    })();
    memory.set(url, p);
    p.catch(() => memory.delete(url));
  }
  return p;
}

export interface FontReport { tier: "core" | "full"; files: string[]; downloadedBytes: number; cachedFiles: number; outside: string[] }
export interface PdfRequest { id: number; items: NoteItem[]; options: NotesOptions; generatedAt: string }
export type PdfResponse = { id: number; ok: true; pdf: ArrayBuffer; pages: number; fonts: FontReport } | { id: number; ok: false; error: string };

export async function fontsFor(def: TDocumentDefinitions, extra: unknown[]) {
  const needs = analyse(def as unknown as Record<string, unknown>, extra);
  const set = FILES[needs.tier];
  const fonts: Record<string, Record<Variant, string>> = {};
  const vfs: Record<string, string> = {};
  const report: FontReport = { tier: needs.tier, files: [], downloadedBytes: 0, cachedFiles: 0, outside: needs.outside };
  for (const family of ["DejaVuSans", "DejaVuSansMono"] as Family[]) {
    const used = (["normal", "bold", "italics", "bolditalics"] as Variant[]).filter((v) => needs.variants.has(`${family}:${v}`));
    if (!used.length) continue;
    const want = new Set<Variant>(["normal", ...used]);
    const entry = {} as Record<Variant, string>;
    for (const v of ["normal", "bold", "italics", "bolditalics"] as Variant[]) {
      // Variants the document never uses point at the normal face, so they aren't downloaded.
      const url = set[family][want.has(v) ? v : "normal"];
      const name = url.split("/").pop()!;
      if (!vfs[name]) {
        const f = await load(url);
        vfs[name] = f.b64;
        report.files.push(name);
        if (f.fromCache) report.cachedFiles++; else report.downloadedBytes += f.bytes;
      }
      entry[v] = name;
    }
    fonts[family] = entry;
  }
  return { fonts, vfs, report };
}

self.onmessage = async (e: MessageEvent<PdfRequest>) => {
  const { id, items, generatedAt } = e.data;
  const options = { ...e.data.options, title: sanitize(e.data.options.title) };
  try {
    const def = buildDocDefinition(items, options, generatedAt);
    let pages = 0;
    const footer = def.footer as DynamicContent;
    const header = def.header as DynamicContent;
    const size = { width: 595.28, height: 841.89, orientation: "portrait" as const };
    const { fonts, vfs, report } = await fontsFor(def, [header(2, 2, size), footer(2, 2, size)]);
    def.footer = (p, n, s) => { pages = n; return footer(p, n, s); };
    const doc = pdfMake.createPdf(def, undefined, fonts, vfs);
    const buf: ArrayBuffer = await new Promise((resolve) => doc.getBuffer((b: Uint8Array) => resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)));
    (self as unknown as Worker).postMessage({ id, ok: true, pdf: buf, pages, fonts: report } satisfies PdfResponse, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message || String(err) } satisfies PdfResponse);
  }
};
