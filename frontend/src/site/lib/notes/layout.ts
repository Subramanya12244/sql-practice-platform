/**
 * The one PDF layout system for Visual Learning Notes. SQL and Python generators supply content
 * and diagrams; every heading, paragraph, callout, table, code block, figure, page frame, cover
 * and contents page comes from here, so pagination rules are the same everywhere:
 *
 * - Headings never end a page: each is grouped with the start of its content, and a
 *   pageBreakBefore rule moves any heading left at the bottom of a page.
 * - Code is pre-wrapped at a fixed column count (continuation lines keep the indentation and
 *   carry a ↪ marker), kept whole when it fits on a page, and otherwise split only at top-level
 *   statement or blank-line boundaries with "continued" markers.
 * - Figures are never scaled down to fit: callers split tall diagrams into parts (see svg.ts),
 *   and a figure moves to the next page whole if it doesn't fit.
 * - Tables repeat their header row on each page and never split a row.
 * - A new problem starts a new page only when the current one is mostly used.
 */
import type { Content, ContextPageSize, Node, TDocumentDefinitions } from "pdfmake/interfaces";
import { highlight, type TokenKind } from "./highlight";
import type { Theme } from "./svg";

export const PAGE = { W: 595.28, H: 841.89, MARGIN: 40, TOP: 52, BOTTOM: 46 } as const;
export const CONTENT_W = PAGE.W - 2 * PAGE.MARGIN;
/** Usable heights for a figure (page content box minus a heading and caption). */
export const FIGURE_H = { portrait: PAGE.H - PAGE.TOP - PAGE.BOTTOM - 60, landscape: PAGE.W - PAGE.TOP - PAGE.BOTTOM - 60 } as const;
export const LANDSCAPE_W = PAGE.H - 2 * PAGE.MARGIN;

export interface Ctx { t: Theme; dark: boolean }

// ── Text ─────────────────────────────────────────────────────────────────
/** Inline Markdown: `code`, **bold** and *italics* become styled runs. */
export function inline(s: string, { t }: Ctx): Content[] {
  const out: Content[] = [];
  for (const m of s.matchAll(/(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|([^`*]+|\*)/g)) {
    if (m[1]) out.push({ text: m[1].slice(1, -1), font: "DejaVuSansMono", fontSize: 8.5, color: t.accent });
    else if (m[2]) out.push({ text: m[2].slice(2, -2).replace(/`/g, ""), bold: true });
    else if (m[3]) out.push({ text: m[3].slice(1, -1), italics: true });
    else out.push({ text: m[4] });
  }
  return out;
}
export const para = (s: string, c: Ctx, extra: Record<string, unknown> = {}): Content => ({ text: inline(s, c), margin: [0, 0, 0, 6], ...extra } as Content);
export const note = (s: string, { t }: Ctx): Content => ({ text: s, fontSize: 7, color: t.faint, margin: [0, 2, 0, 6] });
export const muted = (s: string, { t }: Ctx): Content => ({ text: s, fontSize: 8, color: t.faint, italics: true, margin: [0, 0, 0, 6] });

/** Block Markdown subset used by the content: paragraphs, - and 1. lists, pipe tables, fenced code. */
export function md(src: string, c: Ctx): Content[] {
  const out: Content[] = [];
  const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const lang = /sql/i.test(l) ? "sql" : "python";
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(...code(body.join("\n"), lang, c, { numbers: false }));
      continue;
    }
    if (/^\|/.test(l)) {
      const rows: string[][] = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) {
        if (/^\|\s*:?-{2,}/.test(lines[i])) continue;
        rows.push(lines[i].replace(/^\||\|\s*$/g, "").split("|").map((x) => x.trim()));
      }
      out.push(table(rows[0] ?? [], rows.slice(1), c));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: Content[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
        // Continuation lines (wrapped text, not a new item or block) belong to the same item.
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+|^(```|\|)/.test(lines[i])) item += " " + lines[i++].trim();
        items.push({ text: inline(item, c), margin: [0, 0, 0, 2] });
      }
      out.push(ordered ? { ol: items, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] });
      continue;
    }
    const p: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(```|\||\s*([-*]|\d+\.)\s+)/.test(lines[i]); i++) p.push(lines[i].trim());
    out.push(para(p.join(" "), c));
  }
  return out;
}

// ── Headings and sections ────────────────────────────────────────────────
/** headlineLevel marks nodes the pageBreakBefore rule keeps away from a page bottom. */
export const heading = (text: string, { t }: Ctx, sub = false): Content =>
  (sub ? { text, bold: true, fontSize: 9, margin: [0, 4, 0, 2], headlineLevel: 1 } : { text, fontSize: 10.5, bold: true, color: t.accent, margin: [0, 10, 0, 4], headlineLevel: 1 }) as Content;

/**
 * A heading with its content. The heading and the first block are one unbreakable stack, so a
 * heading is never left alone; the remaining blocks flow normally.
 */
export function section(title: string, blocks: Content[], c: Ctx, sub = false): Content[] {
  if (!blocks.length) return [];
  const [first, ...rest] = blocks;
  const f = first as { unbreakable?: boolean; stack?: Content[]; table?: unknown; ul?: unknown; ol?: unknown };
  // A self-bounded block (code chunk, figure: each sized to fit a page) absorbs the heading.
  if (f.unbreakable && f.stack) return [{ ...(first as object), stack: [heading(title, c, sub), ...f.stack] } as Content, ...rest];
  // Short text is grouped with the heading. Tables, lists and long text may run across pages, so
  // they are never made unbreakable (pdfmake drops an unbreakable block taller than a page); the
  // heading is kept off the page bottom by the pageBreakBefore rule instead.
  if (!f.table && !f.ul && !f.ol && JSON.stringify(first).length < 1500) return [{ stack: [heading(title, c, sub), first], unbreakable: true } as Content, ...rest];
  return [heading(title, c, sub), ...blocks];
}

/** A highlighted label + text box, shared by both note types (objective, relevance, key point…). */
export function callout(label: string, body: string, c: Ctx): Content {
  return {
    table: { widths: ["*"], body: [[{ text: [{ text: `${label}: `, bold: true, color: c.t.accent }, ...inline(body, c)], fontSize: 8.5 }]] },
    layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => c.t.accent, fillColor: () => c.t.panel, paddingLeft: () => 8, paddingTop: () => 4, paddingBottom: () => 4 },
    margin: [0, 2, 0, 8], unbreakable: true,
  } as Content;
}
export const chip = (s: string, { t }: Ctx) => ({ text: ` ${s} `, fontSize: 7.5, color: t.accent, background: t.accentSoft });

// ── Tables ───────────────────────────────────────────────────────────────
/** Header row repeats on every page; rows never split; long cells wrap (no silent cut-off). */
export function table(head: string[], rows: string[][], { t }: Ctx, mono = false): Content {
  const w = head.length;
  const fix = (r: string[]) => Array.from({ length: w }, (_, i) => r[i] ?? "");
  const font = mono ? "DejaVuSansMono" : undefined;
  return {
    table: {
      headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: Array(w).fill("*"),
      body: [head.map((h) => ({ text: h, bold: true, fontSize: 8, color: t.ink, fillColor: t.accentSoft, font })),
        ...rows.map((r) => fix(r).map((x) => ({ text: x, fontSize: 7.5, color: t.ink, font })))],
    },
    layout: { hLineColor: () => t.border, vLineColor: () => t.border, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 2, 0, 8],
  } as Content;
}

// ── Code ─────────────────────────────────────────────────────────────────
// DejaVu Sans Mono: advance 0.602 em; line box = (ascent + descent) 1.164 em × lineHeight 1.25.
const CODE_SIZE = 7.6, CHAR_W = CODE_SIZE * 0.6021, LINE_H = CODE_SIZE * 1.164 * 1.25 + 1.2;
/**
 * Lines per code chunk on a portrait page, with room for a heading, continuation marks and a
 * 10% safety margin. pdfmake silently drops an unbreakable block taller than a page, so a chunk
 * must never exceed it.
 */
export const CODE_LINES_PER_PAGE = Math.floor(((PAGE.H - PAGE.TOP - PAGE.BOTTOM - 70) / LINE_H) * 0.9);

const colors = (t: Theme, dark: boolean): Record<TokenKind, string> => ({
  kw: dark ? "#c4b5fd" : "#6d28d9", fn: dark ? "#5eead4" : "#0f766e", str: dark ? "#fcd34d" : "#a16207", num: dark ? "#fda4af" : "#be123c",
  com: t.faint, op: t.muted, plain: t.ink,
});

export interface CodeLine { no: number | null; runs: { text: string; kind: TokenKind }[]; cont: boolean }

/** Wrap highlighted lines at `cols`; continuations keep the line's indentation plus two spaces. */
export function wrapCode(src: string, lang: "sql" | "python", cols: number): CodeLine[] {
  const out: CodeLine[] = [];
  highlight(src.replace(/\s+$/, ""), lang).forEach((runs, i) => {
    const full = runs.map((r) => r.text).join("");
    const indent = (full.match(/^\s*/)?.[0].length ?? 0);
    let cur: CodeLine = { no: i + 1, runs: [], cont: false }, used = 0;
    const room = () => (cur.cont ? cols - indent - 4 : cols);
    for (const r of runs) {
      let text = r.text;
      while (text.length) {
        const free = room() - used;
        if (text.length <= free) { cur.runs.push({ text, kind: r.kind }); used += text.length; break; }
        // Prefer breaking after a space or comma inside the run when it is close to the limit.
        let cut = free;
        const soft = Math.max(text.lastIndexOf(" ", free), text.lastIndexOf(",", free - 1) + 1);
        if (soft > free * 0.6) cut = soft;
        if (cut <= 0 && used > 0) cut = 0; else if (cut <= 0) cut = free;
        if (cut > 0) cur.runs.push({ text: text.slice(0, cut), kind: r.kind });
        text = text.slice(cut).replace(/^ /, "");
        out.push(cur);
        cur = { no: null, runs: [{ text: " ".repeat(indent + 2) + "↪ ", kind: "com" }], cont: true };
        used = 0;
      }
    }
    out.push(cur);
  });
  return out;
}

/** Split points that keep logical units together: before a top-level line or after a blank line. */
export function chunkCode(lines: CodeLine[], per = CODE_LINES_PER_PAGE): [number, number][] {
  if (lines.length <= per) return [[0, lines.length]];
  const text = (l: CodeLine) => l.runs.map((r) => r.text).join("");
  const goodBreak = (i: number) => {
    const l = lines[i];
    if (!l || l.cont) return 0;
    const s = text(l);
    if (!s.trim()) return 3; // blank line
    if (!/^\s/.test(s) && !/^[)\]}]/.test(s)) return 2; // top-level statement
    if (/^ {4}\S/.test(s)) return 1; // one indent level
    return 0;
  };
  const out: [number, number][] = [];
  let start = 0;
  while (lines.length - start > per) {
    const lo = start + Math.floor(per * 0.6), hi = start + per;
    let best = hi, score = -1;
    for (let i = hi; i >= lo; i--) { const g = goodBreak(i); if (g > score) { score = g; best = i; } if (g === 3) break; }
    while (best > start + 1 && lines[best]?.cont) best--; // never split inside a wrapped line
    out.push([start, best]);
    start = best;
  }
  out.push([start, lines.length]);
  return out;
}

/**
 * Highlighted code with line numbers. Returns one unbreakable block when it fits a page,
 * otherwise several blocks split at logical boundaries, each marked as a continuation.
 */
export function code(src: string, lang: "sql" | "python", c: Ctx, o: { numbers?: boolean; width?: number } = {}): Content[] {
  const numbers = o.numbers ?? true;
  const width = o.width ?? CONTENT_W;
  const cols = Math.floor((width - (numbers ? 16 + 4 : 0) - 10 - 2) / CHAR_W);
  const lines = wrapCode(src, lang, cols);
  const pal = colors(c.t, c.dark);
  const chunks = chunkCode(lines);
  return chunks.map(([a, b], k) => {
    const rows = lines.slice(a, b).map((l) => {
      const textRuns = l.runs.length ? l.runs.map((r) => ({ text: r.text, color: pal[r.kind], bold: r.kind === "kw" })) : [{ text: " " }];
      const cell = { text: textRuns, preserveLeadingSpaces: true, noWrap: true };
      return numbers ? [{ text: l.no ? String(l.no) : "", color: c.t.faint, alignment: "right" as const, fontSize: 7 }, cell] : [cell];
    });
    const mark = (s: string) => ({ text: s, fontSize: 7, italics: true, color: c.t.faint, font: "DejaVuSans", margin: [0, 1, 0, 1] });
    return {
      stack: [
        ...(k > 0 ? [mark(`continued from the previous page (from line ${lines[a].no ?? ""})`)] : []),
        {
          table: { widths: numbers ? [16, "*"] : ["*"], body: rows },
          layout: {
            fillColor: () => c.t.panel, hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.5 : 0),
            vLineWidth: (i: number) => (i === 0 || i === (numbers ? 2 : 1) ? 0.5 : 0), hLineColor: () => c.t.border, vLineColor: () => c.t.border,
            paddingTop: () => 0.6, paddingBottom: () => 0.6, paddingLeft: (i: number) => (i === 0 ? 4 : 6), paddingRight: () => 4,
          },
          font: "DejaVuSansMono", fontSize: CODE_SIZE,
        },
        ...(k < chunks.length - 1 ? [mark("continues on the next page")] : []),
      ],
      unbreakable: true, margin: [0, 2, 0, 10],
    } as Content;
  });
}

// ── Figures ──────────────────────────────────────────────────────────────
/** A diagram at its natural size with optional caption; kept whole. The SVG must already fit. */
export const svgHeight = (svg: string) => Number(svg.match(/height="([\d.]+)"/)?.[1] ?? 0);
/** Figures that had to be scaled down (callers split diagrams so this stays empty; tests check it). */
export const oversized: string[] = [];
export function figure(svgText: string, caption: string | undefined, c: Ctx, width = CONTENT_W, brk: Record<string, string> = {}): Content {
  const maxH = width > CONTENT_W + 1 ? FIGURE_H.landscape : FIGURE_H.portrait;
  const h = svgHeight(svgText) * (width / (Number(svgText.match(/width="([\d.]+)"/)?.[1]) || width));
  // Last resort only: pdfmake drops an unbreakable block taller than the page, so an SVG that
  // still exceeds it is scaled down rather than lost.
  const img = h > maxH ? (oversized.push(svgText.slice(0, 60)), { svg: svgText, fit: [width, maxH] }) : { svg: svgText, width };
  return { stack: [img, ...(caption ? [note(caption, c)] : [])], unbreakable: true, margin: [0, 2, 0, 4], ...brk } as Content;
}

// ── Page frame, cover, contents ──────────────────────────────────────────
export interface Frame { title: string; branding: boolean; pageNumbers: boolean; date: boolean; generatedAt: string; coverPage: boolean }

export function frame(f: Frame, c: Ctx): Pick<TDocumentDefinitions, "pageSize" | "pageMargins" | "defaultStyle" | "background" | "header" | "footer" | "pageBreakBefore"> {
  const { t } = c;
  const skip = (page: number) => page === 1 && f.coverPage;
  return {
    pageSize: "A4", pageMargins: [PAGE.MARGIN, PAGE.TOP, PAGE.MARGIN, PAGE.BOTTOM],
    defaultStyle: { font: "DejaVuSans", fontSize: 9, lineHeight: 1.25, color: t.ink },
    background: c.dark ? (_p: number, size: ContextPageSize) => ({ canvas: [{ type: "rect", x: 0, y: 0, w: size.width, h: size.height, color: t.bg }] }) : undefined,
    header: (page) => (skip(page) ? null : {
      columns: [{ text: f.branding ? "DataForge · Visual Learning Notes" : "", fontSize: 7, color: t.faint }, { text: f.title, fontSize: 7, color: t.faint, alignment: "right" }],
      margin: [PAGE.MARGIN, 22, PAGE.MARGIN, 0],
    }),
    footer: (page, pages) => (f.pageNumbers && !skip(page) ? {
      columns: [{ text: f.date ? f.generatedAt : "", fontSize: 7, color: t.faint }, { text: `${page} / ${pages}`, fontSize: 7, color: t.faint, alignment: "right" }],
      margin: [PAGE.MARGIN, 14, PAGE.MARGIN, 0],
    } : null),
    pageBreakBefore: keepRules,
  };
}

/**
 * Pagination rules applied while laying out:
 * - a heading with nothing after it on the page moves to the next page;
 * - a problem title (headlineLevel 2) starts a new page unless the current one is under 60% used,
 *   so short problems share pages instead of leaving most of a page empty.
 */
export function keepRules(node: Node & { headlineLevel?: number }, following: Node[]): boolean {
  if (node.headlineLevel === 2) return (node.startPosition?.verticalRatio ?? 0) > 0.6;
  // Fewer than two nodes after a heading on its page: the heading would sit alone at the bottom.
  if (node.headlineLevel === 1) return following.length < 2;
  return false;
}

export function cover(title: string, subtitle: string, topics: string, f: Frame, c: Ctx): Content[] {
  return [
    ...(f.branding ? [{ text: "DataForge", fontSize: 13, bold: true, color: c.t.accent, margin: [0, 80, 0, 6] } as Content] : [{ text: " ", margin: [0, 80, 0, 0] } as Content]),
    { text: title, fontSize: 28, bold: true, color: c.t.ink, margin: [0, 0, 0, 10] },
    { text: subtitle, fontSize: 12, color: c.t.muted },
    { text: topics, fontSize: 9, color: c.t.faint, margin: [0, 8, 0, 0] },
    ...(f.date ? [{ text: `Generated ${f.generatedAt}`, fontSize: 9, color: c.t.faint, margin: [0, 24, 0, 0] } as Content] : []),
  ];
}
/** Contents, placed on the cover page below the title (a separate page would be mostly empty). */
export const contents = (c: Ctx): Content => ({ toc: { title: { text: "Contents", fontSize: 13, bold: true, color: c.t.ink, margin: [0, 36, 0, 8] }, numberStyle: { color: c.t.muted } } } as Content);

/** Title block of one problem; starts a new page only when needed (see keepRules). */
export function problemTitle(label: string, title: string, chips: string[], concepts: string[], first: boolean, c: Ctx, id: string): Content {
  return {
    stack: [
      { text: `${label}  ${title}`, fontSize: 16, bold: true, color: c.t.ink, tocItem: true, tocStyle: { fontSize: 9.5, color: c.t.ink }, tocMargin: [0, 2, 0, 0], tocNumberStyle: { fontSize: 9, color: c.t.muted }, id, margin: [0, 0, 0, 4] },
      ...(chips.length ? [{ text: chips.flatMap((x) => [chip(x, c), "  "]), margin: [0, 0, 0, 2] }] : []),
      ...(concepts.length ? [{ text: `Concepts: ${concepts.join(", ")}`, fontSize: 8, color: c.t.muted, margin: [0, 2, 0, 4] }] : []),
    ],
    unbreakable: true,
    headlineLevel: first ? undefined : 2,
    // A rule separates problems that share a page.
    ...(first ? {} : { margin: [0, 18, 0, 0] }),
  } as Content;
}
