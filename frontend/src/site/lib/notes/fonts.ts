/**
 * Which font files a PDF needs. The worker loads only the variants the document actually uses,
 * from small "core" subsets (scripts/subset_pdf_fonts.py), and switches to the full DejaVu fonts
 * only when the text contains a character the full fonts can draw but the core subsets can't.
 */
import core from "./fonts/core-ranges.json";
import full from "./fonts/full-ranges.json";

export type Family = "DejaVuSans" | "DejaVuSansMono";
export type Variant = "normal" | "bold" | "italics" | "bolditalics";
export interface FontNeeds { variants: Set<`${Family}:${Variant}`>; tier: "core" | "full"; outside: string[] }

const inRanges = (r: number[][], cp: number) => {
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < r[mid][0]) hi = mid - 1;
    else if (cp > r[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
};
export const inCore = (cp: number) => inRanges(core, cp);
export const inFull = (cp: number) => inRanges(full, cp);

/** Emoji used in content have DejaVu equivalents; the variation selector has no glyph. */
const EMOJI: Record<string, string> = { "✅": "✓", "✔️": "✓", "❌": "✗", "🆕": "NEW", "⚠️": "⚠", "➡️": "→", "⬅️": "←", "⭐": "★" };
export function sanitize(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(EMOJI)) out = out.split(k).join(v);
  return out.replace(/️/g, "");
}

type Style = { font: Family; bold: boolean; italics: boolean };
const variant = (s: Style): Variant => (s.bold && s.italics ? "bolditalics" : s.bold ? "bold" : s.italics ? "italics" : "normal");

/**
 * Walk a pdfmake document definition (content, header/footer samples, SVG strings), applying
 * `sanitize` to every string in place and recording fonts and characters used.
 */
export function analyse(def: Record<string, unknown>, extra: unknown[] = []): FontNeeds {
  const variants = new Set<`${Family}:${Variant}`>();
  const outside = new Set<string>();
  let needFull = false;
  const chars = (s: string, st: Style) => {
    variants.add(`${st.font}:${variant(st)}`);
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x20 || inCore(cp)) continue;
      if (inFull(cp)) needFull = true;
      else outside.add(ch);
    }
  };
  const svgText = (svg: string) => {
    for (const m of svg.matchAll(/<text[^>]*font-family="(DejaVuSans(?:Mono)?)"([^>]*)>([^<]*)<\/text>/g)) {
      chars(m[3].replace(/&(amp|lt|gt|quot|#39);/g, "x"), { font: m[1] as Family, bold: /font-weight="bold"/.test(m[2]), italics: false });
    }
  };
  const walk = (node: unknown, st: Style): unknown => {
    if (typeof node === "string") { const s = sanitize(node); chars(s, st); return s; }
    if (Array.isArray(node)) return node.map((n) => walk(n, st));
    if (!node || typeof node !== "object") return node;
    const o = node as Record<string, unknown>;
    const next: Style = {
      font: (typeof o.font === "string" ? o.font : st.font) as Family,
      bold: typeof o.bold === "boolean" ? o.bold : st.bold,
      italics: typeof o.italics === "boolean" ? o.italics : st.italics,
    };
    if (typeof o.svg === "string") { o.svg = sanitize(o.svg); svgText(o.svg as string); }
    for (const k of ["text", "stack", "columns", "ul", "ol", "table", "body", "toc", "title", "content"]) {
      if (k in o && k !== "svg") o[k] = walk(o[k], next);
    }
    return o;
  };
  const ds = (def.defaultStyle ?? {}) as Partial<Style>;
  const base: Style = { font: (ds.font as Family) ?? "DejaVuSans", bold: !!ds.bold, italics: !!ds.italics };
  def.content = walk(def.content, base);
  if (def.info && typeof def.info === "object") for (const [k, v] of Object.entries(def.info)) if (typeof v === "string") (def.info as Record<string, string>)[k] = sanitize(v);
  for (const e of extra) walk(e, base);
  return { variants, tier: needFull ? "full" : "core", outside: [...outside] };
}
