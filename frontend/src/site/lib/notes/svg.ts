/**
 * Vector diagrams for Visual Learning Notes, as standalone SVG strings (embedded as vectors by
 * pdfmake, and inline in the HTML preview). Every diagram is drawn from real data:
 * - schemaSvg: the question's tables from schema.json (columns, types, PK/FK). Cardinality is
 *   only shown where a foreign key proves it (many rows → one referenced row).
 * - flowSvg: the FlowGraph built by the AST-based query visualizer (lib/queryGraph).
 * - outlineSvg / pipelineSvg: the Python solution's own syntax tree (lib/notes/pyOutline).
 */
import type { SchemaTable } from "../../types";
import type { FlowGraph, FlowKind } from "../queryGraph";
import type { PyOutline, PyStep } from "./pyOutline";

export interface Theme { bg: string; panel: string; border: string; ink: string; muted: string; faint: string; accent: string; accentSoft: string; secondary: string; danger: string }
export const THEMES: Record<"light" | "dark", Theme> = {
  light: { bg: "#ffffff", panel: "#f8fafc", border: "#cbd5e1", ink: "#0f172a", muted: "#475569", faint: "#94a3b8", accent: "#0f766e", accentSoft: "#ccfbf1", secondary: "#6d28d9", danger: "#b91c1c" },
  dark: { bg: "#0b1220", panel: "#111a2e", border: "#334155", ink: "#e2e8f0", muted: "#94a3b8", faint: "#64748b", accent: "#2dd4bf", accentSoft: "#134e4a", secondary: "#a78bfa", danger: "#f87171" },
};

/** Fonts registered in the PDF (and matching CSS families in the preview). */
const SANS = "DejaVuSans";
const MONO = "DejaVuSansMono";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Approximate advance width (DejaVu is ~0.6 em mono, ~0.55 em sans on average). */
const width = (s: string, size: number, mono = false) => s.length * size * (mono ? 0.602 : 0.56);
function wrap(s: string, max: number, size: number, mono = false): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (width(next, size, mono) <= max || !line) line = next;
    else { out.push(line); line = word; }
    // Hard-break a single token longer than the box (long identifiers, expressions).
    while (width(line, size, mono) > max) {
      const n = Math.max(1, Math.floor(max / (size * (mono ? 0.602 : 0.56))));
      out.push(line.slice(0, n)); line = line.slice(n);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}
const svg = (w: number, h: number, t: Theme, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" fill="${t.bg}"/>${body}</svg>`;
const text = (x: number, y: number, s: string, o: { size?: number; fill: string; mono?: boolean; bold?: boolean; anchor?: "start" | "middle" | "end" }) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size ?? 9}"${o.bold ? ' font-weight="bold"' : ""} fill="${o.fill}" text-anchor="${o.anchor ?? "start"}">${esc(s)}</text>`;
const arrowHead = (x: number, y: number, dir: "down" | "right" | "left" | "up", fill: string) => {
  const p = { down: [[x - 4, y - 7], [x + 4, y - 7]], up: [[x - 4, y + 7], [x + 4, y + 7]], right: [[x - 7, y - 4], [x - 7, y + 4]], left: [[x + 7, y - 4], [x + 7, y + 4]] }[dir];
  return `<polygon points="${x},${y} ${p[0][0]},${p[0][1]} ${p[1][0]},${p[1][1]}" fill="${fill}"/>`;
};

// ── Schema ───────────────────────────────────────────────────────────────
export function schemaSvg(tables: SchemaTable[], t: Theme, maxWidth = 515): string | null {
  if (!tables.length) return null;
  const boxW = 160, gapX = 18, gapY = 34, row = 12, head = 18;
  const cols = Math.max(1, Math.min(3, Math.floor((maxWidth + gapX) / (boxW + gapX)), tables.length));
  const heights = tables.map((tb) => head + tb.columns.length * row + 6);
  const pos = new Map<string, { x: number; y: number; h: number }>();
  let y = 0;
  for (let r = 0; r * cols < tables.length; r++) {
    const rowTables = tables.slice(r * cols, r * cols + cols);
    const rowH = Math.max(...rowTables.map((_, i) => heights[r * cols + i]));
    const used = rowTables.length * boxW + (rowTables.length - 1) * gapX;
    const off = (maxWidth - used) / 2;
    rowTables.forEach((tb, i) => pos.set(tb.name, { x: off + i * (boxW + gapX), y: y + 4, h: heights[r * cols + i] }));
    y += rowH + gapY;
  }
  const H = y - gapY + 12;
  const names = new Set(tables.map((x) => x.name));
  let edges = "", boxes = "";
  for (const tb of tables) for (const c of tb.columns) {
    if (!c.fk || !names.has(c.fk.table) || c.fk.table === tb.name) continue;
    const a = pos.get(tb.name)!, b = pos.get(c.fk.table)!;
    const ci = tb.columns.indexOf(c), ti = tables.find((x) => x.name === c.fk!.table)!.columns.findIndex((x) => x.name === c.fk!.column);
    const ay = a.y + head + ci * row + row / 2, by = b.y + head + Math.max(0, ti) * row + row / 2;
    const right = b.x > a.x;
    const ax = right ? a.x + boxW : a.x, bx = right ? b.x : b.x + boxW;
    const same = Math.abs(a.x - b.x) < 1;
    const path = same
      ? `M${a.x + boxW},${ay} C${a.x + boxW + 30},${ay} ${b.x + boxW + 30},${by} ${b.x + boxW},${by}`
      : `M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by} ${bx},${by}`;
    edges += `<path d="${path}" fill="none" stroke="${t.accent}" stroke-width="1"/>`;
    edges += text(same ? a.x + boxW + 3 : ax + (right ? 3 : -3), ay - 2, "N", { size: 7, fill: t.accent, anchor: same || right ? "start" : "end" });
    edges += text(same ? b.x + boxW + 3 : bx + (right ? -3 : 3), by - 2, "1", { size: 7, fill: t.accent, anchor: same || !right ? "start" : "end" });
  }
  for (const tb of tables) {
    const p = pos.get(tb.name)!;
    boxes += `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${p.h}" rx="5" fill="${t.panel}" stroke="${t.border}"/>`;
    boxes += `<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${head}" rx="5" fill="${t.accentSoft}"/><rect x="${p.x}" y="${p.y + head - 5}" width="${boxW}" height="5" fill="${t.accentSoft}"/>`;
    boxes += text(p.x + 6, p.y + 12.5, tb.name, { size: 9, bold: true, fill: t.ink, mono: true });
    tb.columns.forEach((c, i) => {
      const cy = p.y + head + i * row + 9;
      const key = c.pk ? "PK" : c.fk ? "FK" : "";
      if (key) boxes += text(p.x + 6, cy, key, { size: 6.5, bold: true, fill: c.pk ? t.secondary : t.accent });
      const name = c.name.length > 17 ? `${c.name.slice(0, 16)}…` : c.name;
      boxes += text(p.x + 22, cy, name, { size: 7.5, fill: t.ink, mono: true, bold: !!c.pk });
      const type = c.type.length > 13 ? `${c.type.slice(0, 12)}…` : c.type;
      boxes += text(p.x + boxW - 5, cy, type, { size: 6.5, fill: t.faint, mono: true, anchor: "end" });
    });
  }
  return svg(maxWidth, H, t, edges + boxes);
}

// ── SQL logical flow ─────────────────────────────────────────────────────
const KIND_LABEL: Record<FlowKind, string> = {
  cte: "CTE", source: "TABLE", subquery: "SUBQUERY", join: "JOIN", where: "WHERE", group: "GROUP BY", having: "HAVING", window: "WINDOW",
  select: "SELECT", distinct: "DISTINCT", order: "ORDER BY", limit: "LIMIT", setop: "SET OPERATION", branch: "BRANCH", result: "RESULT",
};

interface Placed { x: number; y: number; w: number; h: number; lines: string[]; row: number }
export interface FlowLayout { width: number; height: number; rows: { y: number; h: number }[]; pos: Map<string, Placed>; widestLayer: number }

/**
 * Layered top-to-bottom layout: a node sits one layer below its deepest input. Boxes never get
 * narrower than `minBoxW`; a layer that doesn't fit wraps onto extra rows instead of shrinking.
 */
export function layoutFlow(g: FlowGraph, maxWidth = 515, minBoxW = 170): FlowLayout {
  const depth = new Map<string, number>();
  const ins = new Map<string, string[]>();
  for (const e of g.edges) ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]);
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = Math.max(-1, ...(ins.get(id) ?? []).map((p) => d(p, seen))) + 1;
    depth.set(id, v);
    return v;
  };
  g.nodes.forEach((n) => d(n.id));
  const layers: string[][] = [];
  for (const n of g.nodes) (layers[depth.get(n.id)!] ??= []).push(n.id);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const gapY = 22, gapX = 12;
  const perRow = Math.max(1, Math.floor((maxWidth + gapX) / (minBoxW + gapX)));
  const pos = new Map<string, Placed>();
  const rows: { y: number; h: number }[] = [];
  let y = 4;
  for (const layer of layers.filter(Boolean)) {
    for (let i = 0; i < layer.length; i += perRow) {
      const row = layer.slice(i, i + perRow);
      const w = Math.min(250, (maxWidth - (row.length - 1) * gapX) / row.length);
      const blocks = row.map((id) => {
        const lines = byId.get(id)!.detail.flatMap((x) => wrap(x, w - 12, 7, true)).slice(0, 8);
        return { id, lines, h: 30 + lines.length * 9 };
      });
      const h = Math.max(...blocks.map((bk) => bk.h));
      const used = row.length * w + (row.length - 1) * gapX;
      blocks.forEach((bk, k) => pos.set(bk.id, { x: (maxWidth - used) / 2 + k * (w + gapX), y, w, h: bk.h, lines: bk.lines, row: rows.length }));
      rows.push({ y, h });
      y += h + gapY;
    }
  }
  return { width: maxWidth, height: y - gapY + 8, rows, pos, widestLayer: Math.max(0, ...layers.filter(Boolean).map((l) => l.length)) };
}

/** Render rows [from, to) of a layout. Edges leaving or entering the slice get continuation stubs. */
function renderFlow(g: FlowGraph, L: FlowLayout, t: Theme, from = 0, to = L.rows.length, part?: { i: number; n: number }): string {
  const top = L.rows[from].y - 4 - (from > 0 ? 18 : 0);
  const bottom = L.rows[to - 1].y + L.rows[to - 1].h + (to < L.rows.length ? 26 : 8);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const inSlice = (id: string) => { const p = L.pos.get(id); return !!p && p.row >= from && p.row < to; };
  const Y = (y: number) => y - top;
  let body = "";
  if (part && from > 0) body += text(4, 11, `▲ continued from part ${part.i - 1}`, { size: 7, fill: t.faint });
  const outgoing: Record<string, string[]> = {}, incoming: Record<string, string[]> = {};
  const to_ = to;
  for (const e of g.edges) {
    const a = L.pos.get(e.from), b = L.pos.get(e.to);
    if (!a || !b) continue;
    const ia = inSlice(e.from), ib = inSlice(e.to);
    if (!ia && !ib) continue;
    const x1 = a.x + a.w / 2, x2 = b.x + b.w / 2;
    if (ia && ib) {
      const y1 = Y(a.y + a.h), y2 = Y(b.y);
      body += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 6}" fill="none" stroke="${t.faint}" stroke-width="1"/>` + arrowHead(x2, y2, "down", t.faint);
      if (e.label) body += text((x1 + x2) / 2 + 4, (y1 + y2) / 2 + 3, e.label.length > 40 ? `${e.label.slice(0, 39)}…` : e.label, { size: 6.5, fill: t.muted, mono: true });
    } else if (ia) {
      (outgoing[e.from] ??= []).push(byId.get(e.to)!.title);
    } else {
      (incoming[e.to] ??= []).push(byId.get(e.from)!.title);
    }
  }
  // One stub and one label per box (several edges to or from the same box would overlap).
  const names = (xs: string[]) => { const u = [...new Set(xs)]; return u.length > 2 ? `${u.slice(0, 2).join(", ")} +${u.length - 2}` : u.join(", "); };
  for (const [id, targets] of Object.entries(outgoing)) {
    const a = L.pos.get(id)!, x1 = a.x + a.w / 2, y1 = Y(a.y + a.h);
    body += `<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y1 + 12}" stroke="${t.faint}" stroke-dasharray="3 2"/>` + arrowHead(x1, y1 + 18, "down", t.faint);
    // Labels only where nothing else shares the gap: under the part's last row.
    if (a.row === to_ - 1) body += text(x1 + 6, y1 + 16, `to ${names(targets)} (next part)`.slice(0, Math.floor(a.w / 3.4)), { size: 6.5, fill: t.faint });
  }
  for (const [id, sources] of Object.entries(incoming)) {
    const b2 = L.pos.get(id)!, x2 = b2.x + b2.w / 2, y2 = Y(b2.y);
    body += `<line x1="${x2}" y1="${y2 - 16}" x2="${x2}" y2="${y2 - 6}" stroke="${t.faint}" stroke-dasharray="3 2"/>` + arrowHead(x2, y2, "down", t.faint);
    if (b2.row === from) body += text(x2 + 6, y2 - 8, `from ${names(sources)} (previous part)`.slice(0, Math.floor(b2.w / 3.4)), { size: 6.5, fill: t.faint });
  }
  for (const n of g.nodes) {
    if (!inSlice(n.id)) continue;
    const p = L.pos.get(n.id)!;
    const y = Y(p.y);
    const strong = n.kind === "result" || n.kind === "select";
    body += `<rect x="${p.x}" y="${y}" width="${p.w}" height="${p.h}" rx="6" fill="${strong ? t.accentSoft : t.panel}" stroke="${n.kind === "source" ? t.secondary : t.border}"/>`;
    body += text(p.x + 6, y + 10, KIND_LABEL[n.kind], { size: 6.5, bold: true, fill: n.kind === "source" ? t.secondary : t.accent });
    body += text(p.x + 6, y + 21, n.title.length > 42 ? `${n.title.slice(0, 41)}…` : n.title, { size: 8.5, bold: true, fill: t.ink, mono: true });
    p.lines.forEach((l, i) => { body += text(p.x + 6, y + 32 + i * 9, l, { size: 7, fill: t.muted, mono: true }); });
  }
  if (part && to < L.rows.length) body += text(4, bottom - top - 3, `▼ continues in part ${part.i + 1}`, { size: 7, fill: t.faint });
  return svg(L.width, bottom - top, t, body);
}

export function flowSvg(g: FlowGraph, t: Theme, maxWidth = 515): string | null {
  if (!g.nodes.length) return null;
  return renderFlow(g, layoutFlow(g, maxWidth), t);
}

/**
 * A query flow sized for print: one diagram when it fits, otherwise parts that each fit a page,
 * split between rows (a row is never cut), plus a compact overview of the whole flow.
 */
export function flowParts(g: FlowGraph, t: Theme, width: number, maxHeight: number): { parts: string[]; overview: string | null } {
  if (!g.nodes.length) return { parts: [], overview: null };
  const L = layoutFlow(g, width);
  if (L.height <= maxHeight) return { parts: [renderFlow(g, L, t)], overview: null };
  const chunks: [number, number][] = [];
  let start = 0;
  for (let r = 0; r < L.rows.length; r++) {
    const h = L.rows[r].y + L.rows[r].h - L.rows[start].y + 50;
    if (h > maxHeight && r > start) { chunks.push([start, r]); start = r; }
  }
  chunks.push([start, L.rows.length]);
  const parts = chunks.map(([a, b], i) => renderFlow(g, L, t, a, b, { i: i + 1, n: chunks.length }));
  // An overview only helps while every row still gets a legible 14pt-high box.
  return { parts, overview: L.rows.length * 20 <= maxHeight ? overviewSvg(g, L, t, maxHeight) : null };
}

/** Titles only, every node and edge, scaled to one page: the map that the detailed parts follow. */
function overviewSvg(g: FlowGraph, L: FlowLayout, t: Theme, maxHeight: number): string {
  // Leave room for the figure's heading and caption inside the same page.
  const s = Math.min(1, (maxHeight - 40) / L.height);
  let body = "";
  for (const e of g.edges) {
    const a = L.pos.get(e.from), b = L.pos.get(e.to);
    if (!a || !b) continue;
    body += `<line x1="${(a.x + a.w / 2)}" y1="${(a.y + a.h) * s}" x2="${(b.x + b.w / 2)}" y2="${b.y * s}" stroke="${t.faint}" stroke-width="0.8"/>`;
  }
  for (const n of g.nodes) {
    const p = L.pos.get(n.id)!;
    const h = Math.max(14, p.h * s);
    body += `<rect x="${p.x}" y="${p.y * s}" width="${p.w}" height="${h}" rx="4" fill="${t.panel}" stroke="${n.kind === "source" ? t.secondary : t.border}"/>`;
    const label = n.title.toUpperCase().startsWith(KIND_LABEL[n.kind]) || n.title === "Result" ? n.title : `${KIND_LABEL[n.kind]} ${n.title}`;
    body += text(p.x + 5, p.y * s + Math.min(h - 3, 10), label.slice(0, 40), { size: 7, fill: t.ink, mono: true });
  }
  return svg(L.width, L.height * s + 18, t, body);
}

// ── Python flowchart (from the solution's AST) ───────────────────────────
const STEP_COLOR = (k: PyStep["kind"], t: Theme) => (k === "loop" ? t.secondary : k === "branch" || k === "try" ? t.accent : k === "return" || k === "yield" ? t.accent : t.border);

export function outlineSvg(o: PyOutline, t: Theme, maxWidth = 515): string | null {
  const fns = o.functions.filter((f) => f.steps.length);
  if (!fns.length) return null;
  let y = 4, body = "";
  const draw = (steps: PyStep[], x: number, w: number, depth: number) => {
    steps.forEach((s, i) => {
      const lines = wrap(s.text, w - 70, 7.5, true).slice(0, 3);
      const h = 14 + lines.length * 9;
      if (i > 0) body += `<line x1="${x + 14}" y1="${y - 8}" x2="${x + 14}" y2="${y - 1}" stroke="${t.faint}"/>` + arrowHead(x + 14, y, "down", t.faint);
      const stroke = STEP_COLOR(s.kind, t);
      body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${s.kind === "branch" ? 2 : 6}" fill="${t.panel}" stroke="${stroke}"/>`;
      body += text(x + 6, y + 10, s.kind.toUpperCase(), { size: 6, bold: true, fill: stroke === t.border ? t.muted : stroke });
      body += text(x + w - 5, y + 10, `line ${s.line}`, { size: 6, fill: t.faint, anchor: "end" });
      lines.forEach((l, j) => { body += text(x + 50, y + 11 + j * 9, l, { size: 7.5, fill: t.ink, mono: true }); });
      const top = y;
      y += h + 9;
      if (s.children?.length && depth < 3) {
        draw(s.children, x + 18, w - 18, depth + 1);
        if (s.kind === "loop") {
          // Back edge: the loop body returns to the loop header.
          body += `<path d="M${x + 4},${y - 9} L${x - 6 + 0.01},${y - 9} L${x - 6},${top + h / 2} L${x - 1},${top + h / 2}" fill="none" stroke="${t.secondary}" stroke-dasharray="3 2"/>` + arrowHead(x, top + h / 2, "right", t.secondary);
          y += 4;
        }
      }
    });
  };
  for (const f of fns) {
    body += text(8, y + 10, `def ${f.name}(${f.args.join(", ")})`, { size: 9, bold: true, fill: t.ink, mono: true });
    y += 18;
    draw(f.steps, 14, Math.min(maxWidth - 20, 480), 0);
    y += 6;
  }
  return svg(maxWidth, y, t, body);
}

/** Left-to-right data flow of the operations the code really performs, in source order. */
export function pipelineSvg(stages: { label: string; line: number }[], t: Theme, maxWidth = 515): string | null {
  if (stages.length < 2) return null;
  const perRow = Math.min(5, stages.length);
  const gap = 16, w = (maxWidth - (perRow - 1) * gap) / perRow, h = 38;
  let body = "";
  stages.forEach((s, i) => {
    const r = Math.floor(i / perRow), c = i % perRow;
    const x = c * (w + gap), y = 4 + r * (h + 26);
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${i === 0 || i === stages.length - 1 ? t.accentSoft : t.panel}" stroke="${t.border}"/>`;
    wrap(s.label, w - 10, 8).slice(0, 2).forEach((l, j) => { body += text(x + w / 2, y + 16 + j * 10, l, { size: 8, bold: j === 0, fill: t.ink, anchor: "middle" }); });
    if (s.line) body += text(x + w / 2, y + h - 4, `line ${s.line}`, { size: 6, fill: t.faint, anchor: "middle" });
    if (i < stages.length - 1) {
      if (c < perRow - 1) body += `<line x1="${x + w}" y1="${y + h / 2}" x2="${x + w + gap - 6}" y2="${y + h / 2}" stroke="${t.accent}"/>` + arrowHead(x + w + gap, y + h / 2, "right", t.accent);
      else body += `<path d="M${x + w / 2},${y + h} L${x + w / 2},${y + h + 13} L${w / 2},${y + h + 13} L${w / 2},${y + h + 20}" fill="none" stroke="${t.accent}"/>` + arrowHead(w / 2, y + h + 26, "down", t.accent);
    }
  });
  const rows = Math.ceil(stages.length / perRow);
  return svg(maxWidth, 8 + rows * h + (rows - 1) * 26, t, body);
}

const svgH = (s: string) => Number(s.match(/height="([\d.]+)"/)?.[1] ?? 0);

/**
 * Flowchart parts that each fit `maxH` at full size: one per function, and a long function is
 * split between its top-level steps (a step and its nested body are never separated).
 */
export function outlineParts(o: PyOutline, t: Theme, width: number, maxH: number): { title: string; svg: string }[] {
  const out: { title: string; svg: string }[] = [];
  for (const f of o.functions.filter((fn) => fn.steps.length)) {
    const render = (a: number, b: number) => outlineSvg({ ...o, functions: [{ ...f, steps: f.steps.slice(a, b) }] }, t, width)!;
    for (let start = 0, part = 0; start < f.steps.length; part++) {
      // Grow the part one top-level step at a time while it still fits; one step always fits a part.
      let end = start + 1;
      while (end < f.steps.length && svgH(render(start, end + 1)) <= maxH) end++;
      let svgText = render(start, end);
      if (end === start + 1 && svgH(svgText) > maxH) {
        // One block taller than a page: show its first statements and point to the code for the rest.
        const step = f.steps[start], kids = step.children ?? [];
        for (let k = kids.length - 1; k >= 1; k--) {
          const trimmed = { ...step, children: [...kids.slice(0, k), { kind: "other" as const, text: `… ${kids.length - k} more statements in this block (see the code)`, line: kids[k].line }] };
          svgText = outlineSvg({ ...o, functions: [{ ...f, steps: [trimmed] }] }, t, width)!;
          if (svgH(svgText) <= maxH) break;
        }
      }
      out.push({ title: part === 0 ? f.name : `${f.name} (continued from line ${f.steps[start].line})`, svg: svgText });
      start = end;
    }
  }
  return out;
}

/** Schema diagram parts of whole table rows that fit `maxH`; links between parts are listed in text. */
export function schemaParts(tables: SchemaTable[], t: Theme, width: number, maxH: number): { svg: string; tables: string[] }[] {
  const whole = schemaSvg(tables, t, width);
  if (!whole) return [];
  if (svgH(whole) <= maxH) return [{ svg: whole, tables: tables.map((x) => x.name) }];
  const out: { svg: string; tables: string[] }[] = [];
  let start = 0;
  while (start < tables.length) {
    let end = start + 1;
    for (let k = start + 1; k <= tables.length; k++) {
      if (svgH(schemaSvg(tables.slice(start, k), t, width)!) > maxH) break;
      end = k;
    }
    out.push({ svg: schemaSvg(tables.slice(start, end), t, width)!, tables: tables.slice(start, end).map((x) => x.name) });
    start = end;
  }
  return out;
}
