/// <reference lib="webworker" />
/**
 * Builds the PDF off the main thread. pdfmake and the DejaVu fonts (wide Unicode coverage,
 * including a monospace face for code) are loaded on first use and cached by the browser.
 */
import pdfMake from "pdfmake/build/pdfmake";
import type { DynamicContent } from "pdfmake/interfaces";
import sans from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import sansBold from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import sansIt from "dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url";
import sansBoldIt from "dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url";
import mono from "dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url";
import monoBold from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url";
import monoIt from "dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf?url";
import monoBoldIt from "dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf?url";
import { buildDocDefinition } from "./pdf";
import type { NoteItem, NotesOptions } from "./content";

const FILES: Record<string, string> = {
  "s.ttf": sans, "sb.ttf": sansBold, "si.ttf": sansIt, "sbi.ttf": sansBoldIt, "m.ttf": mono, "mb.ttf": monoBold, "mi.ttf": monoIt, "mbi.ttf": monoBoldIt,
};
const FONTS = {
  DejaVuSans: { normal: "s.ttf", bold: "sb.ttf", italics: "si.ttf", bolditalics: "sbi.ttf" },
  DejaVuSansMono: { normal: "m.ttf", bold: "mb.ttf", italics: "mi.ttf", bolditalics: "mbi.ttf" },
};

let vfs: Promise<Record<string, string>> | null = null;
function loadVfs() {
  vfs ??= Promise.all(Object.entries(FILES).map(async ([name, url]) => {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return [name, btoa(bin)] as const;
  })).then(Object.fromEntries);
  return vfs;
}

export interface PdfRequest { id: number; items: NoteItem[]; options: NotesOptions; generatedAt: string }
export type PdfResponse = { id: number; ok: true; pdf: ArrayBuffer; pages: number } | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<PdfRequest>) => {
  const { id, items, options, generatedAt } = e.data;
  try {
    const def = buildDocDefinition(items, options, generatedAt);
    let pages = 0;
    const footer = def.footer as DynamicContent;
    def.footer = (p, n, size) => { pages = n; return footer(p, n, size); };
    const doc = pdfMake.createPdf(def, undefined, FONTS, await loadVfs());
    const buf: ArrayBuffer = await new Promise((resolve) => doc.getBuffer((b: Uint8Array) => resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)));
    (self as unknown as Worker).postMessage({ id, ok: true, pdf: buf, pages } satisfies PdfResponse, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message || String(err) } satisfies PdfResponse);
  }
};
