/**
 * Row movement between SQL stages, as pure data. Nothing here touches a database or the DOM.
 *
 * A *frame* describes one stage: which row identities enter, leave, match, merge, group, reorder or get cut, plus a
 * *board* (lanes and cards with a "before" and an "after" slot) that RowFlow draws. Every card is a row that really
 * appears in a stage result; nothing is invented. When a sample is limited the frame says "showing N of M rows" and the
 * remaining rows are counted, not drawn.
 *
 * Row identity comes in two kinds, and every frame says which one it used:
 * - ctid: PostgreSQL's physical row id, carried through the stage by `rowTrace.ts` (a join uses one ctid per table alias).
 * - trace: no source identity exists (aggregates, expressions, subqueries, CTEs, volatile queries), so a row is matched by
 *   a hash of its content plus an occurrence counter. Two identical rows are told apart only by their order.
 */
import type { Stage } from "../visualize";
import type { SetOpData } from "./setOps";

export type IdKind = "ctid" | "trace";

export const identityLabel = (k: IdKind) => (k === "ctid" ? "Row identity: real (ctid)" : "Row identity: trace (matched by content)");
export const identityHint = (k: IdKind) => k === "ctid"
  ? "Each row is followed by PostgreSQL's own physical row id (ctid), so two identical-looking rows are never confused."
  : "These rows have no source row id here (aggregates, expressions, subqueries, CTEs). Rows are matched by a hash of their content plus an occurrence counter, so identical rows are told apart only by their order.";

/* ---------- identities ---------- */

export const canon = (cells: unknown[]) => JSON.stringify(cells, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v === undefined ? null : v));

/** 32-bit FNV-1a of the canonical text of a row, as 8 hex digits. */
export function hashContent(cells: unknown[]): string {
  let h = 0x811c9dc5;
  const s = canon(cells);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Trace identities: `t:<hash of content>#<occurrence>`. The n-th identical row gets `#n`, so duplicates stay distinct. */
export function traceIds(rows: unknown[][]): string[] {
  const seen = new Map<string, number>();
  return rows.map((cells) => {
    const h = hashContent(cells);
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return `t:${h}#${n}`;
  });
}

/** Real identity: one ctid per participating table alias; `null` is the NULL-padded side of an outer join. */
export const ctidId = (parts: (string | null)[]) => `c:${parts.map((p) => p ?? "-").join("|")}`;

const ctidNums = (id: string) => [...id.matchAll(/\((\d+),(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
/** Physical order of two ctid identities (page, then tuple, alias by alias). Non-ctid ids keep their order. */
export function ctidOrder(a: string, b: string): number {
  const x = ctidNums(a), y = ctidNums(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i][0] !== y[i][0]) return x[i][0] - y[i][0];
    if (x[i][1] !== y[i][1]) return x[i][1] - y[i][1];
  }
  return 0;
}

/* ---------- types ---------- */

/** What a predicate (WHERE or HAVING) evaluated to for one row or group. NULL is not true, so it removes the row too. */
export interface Verdict { value: "true" | "false" | "NULL"; /** The values the predicate looked at, e.g. "freight = 11.61". */ detail?: string }

export interface TraceRow {
  id: string;
  cells: unknown[];
  /** What the stage's predicate evaluated to for this row (WHERE, HAVING). */
  verdict?: Verdict;
  /** Projected values (the SELECT list) for a row whose `cells` are the full source row. */
  after?: unknown[];
  /** Position the row had before a sort (arrival order). */
  pos?: number;
  /** Group key as JSON text. */
  key?: string;
}

export type Tone = "normal" | "kept" | "removed" | "matched" | "unmatched" | "dup" | "survivor" | "group" | "new" | "cut";
export interface Slot { lane: number; row: number }
export interface Lane { label: string; count?: string }
export interface BoardCard {
  id: string;
  text: string;
  /** Text shown once the move has happened (SELECT narrows the columns). */
  textAfter?: string;
  title: string;
  from: Slot;
  to: Slot;
  /** Fades in at `to` (it does not exist before this stage). */
  appear?: boolean;
  /** Fades out at `to` (it merged into another row). */
  vanish?: boolean;
  toneBefore: Tone;
  tone: Tone;
  badge?: string;
  /** The row as a table row: column names and formatted values, so a card can be drawn as a real relation row. */
  cols?: string[];
  cells?: string[];
  /** What the stage's predicate evaluated to for this row (WHERE, HAVING). */
  verdict?: Verdict;
  /** Aggregate result for a group bucket, e.g. "COUNT(*) = 13". */
  calc?: string;
  /** Which group the card belongs to (0, 1, 2 ...), so rows of one group share a colour. */
  group?: number;
  /** The same row after the move, when its columns change (SELECT narrows a row to the output columns). */
  after?: { cols: string[]; cells: string[] };
}
export interface Board { lanes: Lane[]; cards: BoardCard[]; rows: number }

export interface FlowFacts {
  entered: string[];
  kept: string[];
  removed: string[];
  matched: [string, string][];
  unmatchedLeft: string[];
  unmatchedRight: string[];
  /** Result rows that carry NULLs for the side that found no partner. */
  padded: string[];
  duplicates: { survivor: string; merged: string[] }[];
  groups: { key: string; members: string[]; total?: number }[];
  moves: { id: string; from: number; to: number }[];
  skipped: string[];
  cut: string[];
}
export const emptyFacts = (): FlowFacts => ({ entered: [], kept: [], removed: [], matched: [], unmatchedLeft: [], unmatchedRight: [], padded: [], duplicates: [], groups: [], moves: [], skipped: [], cut: [] });

export type FrameKind = "scan" | "join" | "filter" | "group" | "aggregate" | "project" | "distinct" | "sort" | "limit" | "setop" | "none";
export interface FrameVariant { label: string; board: Board; summary: string; limited?: string; facts: FlowFacts; /** The ON condition of a join step. */ on?: string; /** Join kind, e.g. "LEFT JOIN". */ kind?: string; /** Which join of the FROM this is (0 = the first JOIN). */ index?: number }
export interface FlowFrame {
  stageIndex: number;
  clause: string;
  kind: FrameKind;
  identity: IdKind;
  identityNote?: string;
  board?: Board;
  /** One board per join step when the FROM has several joins. */
  variants?: FrameVariant[];
  /** Plain-language description of what the rows do; read out by screen readers. */
  summary: string;
  /** "showing N of M rows" when only a sample is drawn. */
  limited?: string;
  facts: FlowFacts;
  /** trace = built from row-level derived queries; stage = built from the stage's own sample only. */
  source: "trace" | "stage";
  /** The predicate (WHERE, HAVING) or key expression this stage applies, as written in the query. */
  expr?: string;
}

export interface Ctx { stageIndex: number; clause: string; identity: IdKind; source?: "trace" | "stage" }

/* ---------- text helpers ---------- */

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString().replace(/T00:00:00(\.000)?Z$/, "");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const cardText = (cells: unknown[], max = 3) => cells.slice(0, max).map((c) => clip(fmtCell(c), 14)).join(" · ") + (cells.length > max ? " …" : "");
const cardTitle = (columns: string[], cells: unknown[]) => cells.map((c, i) => `${columns[i] ?? `col${i + 1}`} = ${fmtCell(c)}`).join("\n");
export const keyLabel = (key: string) => { try { return (JSON.parse(key) as unknown[]).map(fmtCell).join(", ") || "all rows"; } catch { return key; } };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const limitedText = (shown: number, total: number | undefined, noun = "rows") =>
  total !== undefined && total > shown ? `showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${noun}` : undefined;

const card = (id: string, cells: unknown[], columns: string[], from: Slot, to: Slot, tone: Tone, extra: Partial<BoardCard> = {}): BoardCard => ({
  id, text: cardText(cells), title: cardTitle(columns, cells), from, to, toneBefore: "normal", tone,
  ...(cells.length ? { cols: cells.map((_, i) => columns[i] ?? `col${i + 1}`), cells: cells.map(fmtCell) } : {}), ...extra,
});
const boardOf = (lanes: Lane[], cards: BoardCard[]): Board => ({ lanes, cards, rows: Math.max(1, ...cards.map((c) => Math.max(c.from.row, c.to.row) + 1)) });
const frame = (ctx: Ctx, kind: FrameKind, f: Partial<FlowFrame> & { summary: string }): FlowFrame =>
  ({ stageIndex: ctx.stageIndex, clause: ctx.clause, kind, identity: ctx.identity, source: ctx.source ?? "trace", facts: emptyFacts(), ...f });

/* ---------- scan: FROM reads rows ---------- */

export function scanFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; total?: number; label: string }): FlowFrame {
  const cards = p.rows.map((r, i) => card(r.id, r.cells, p.columns, { lane: -0.7, row: i }, { lane: 0, row: i }, "new", { appear: true }));
  const facts = { ...emptyFacts(), entered: p.rows.map((r) => r.id) };
  const lim = limitedText(p.rows.length, p.total);
  return frame(ctx, "scan", {
    board: boardOf([{ label: p.label, count: p.total !== undefined ? `${p.rows.length} of ${p.total.toLocaleString()}` : String(p.rows.length) }], cards),
    facts, limited: lim,
    summary: `${ctx.clause.toUpperCase()}: ${plural(p.rows.length, "row")}${p.total !== undefined && p.total > p.rows.length ? ` of ${p.total.toLocaleString()}` : ""} enter from ${p.label}.${p.total !== undefined && p.total > p.rows.length ? ` The other ${(p.total - p.rows.length).toLocaleString()} rows are counted, not drawn.` : ""}`,
  });
}

/* ---------- filter: WHERE and HAVING, rows or groups go to a kept lane or a removed lane ---------- */

export function filterFrame(ctx: Ctx, p: { kept: TraceRow[]; removed: TraceRow[]; columns: string[]; noun?: "rows" | "groups"; totalIn?: number; totalOut?: number; input?: TraceRow[]; expr?: string }): FlowFrame {
  const noun = p.noun ?? "rows";
  const keptIds = new Set(p.kept.map((r) => r.id));
  const input = p.input ?? [...p.kept, ...p.removed];
  const cards: BoardCard[] = [];
  let k = 0, rm = 0;
  input.forEach((r, i) => {
    const isKept = keptIds.has(r.id);
    cards.push(card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: isKept ? 1 : 2, row: isKept ? k++ : rm++ }, isKept ? "kept" : "removed", r.verdict ? { verdict: r.verdict } : {}));
  });
  const totalRemoved = p.totalIn !== undefined && p.totalOut !== undefined ? p.totalIn - p.totalOut : undefined;
  const lanes: Lane[] = [
    { label: noun === "groups" ? "Groups in" : "Input rows", count: p.totalIn !== undefined ? p.totalIn.toLocaleString() : undefined },
    { label: "Kept", count: p.totalOut !== undefined ? `${k} of ${p.totalOut.toLocaleString()}` : String(k) },
    { label: "Removed", count: totalRemoved !== undefined ? `${rm} of ${totalRemoved.toLocaleString()}` : String(rm) },
  ];
  const facts = { ...emptyFacts(), kept: p.kept.map((r) => r.id), removed: p.removed.map((r) => r.id) };
  const shown = input.length;
  return frame(ctx, "filter", {
    board: boardOf(lanes, cards), facts, expr: p.expr,
    limited: limitedText(shown, p.totalIn, noun),
    summary: `${ctx.clause.toUpperCase()}: of the ${plural(shown, noun === "groups" ? "group" : "row")} drawn, ${k} stay in the kept lane and ${rm} move to the removed lane${
      p.totalIn !== undefined && p.totalOut !== undefined ? `. Overall ${p.totalIn.toLocaleString()} → ${p.totalOut.toLocaleString()} ${noun}` : ""}.`,
  });
}

/* ---------- join ---------- */

export interface JoinInput {
  kind: string;
  /** The ON condition, as written. */
  on?: string;
  /** Which join of the FROM this is (0 = the first JOIN). */
  index?: number;
  label: string;
  matched: { left: TraceRow; right: TraceRow }[];
  unmatchedLeft: TraceRow[];
  unmatchedRight: TraceRow[];
  leftColumns: string[];
  rightColumns: string[];
  counts: { leftRows?: number; rightRows?: number; matchedPairs?: number; unmatchedLeft?: number; unmatchedRight?: number; resultRows?: number };
}

export function joinVariant(p: JoinInput): FrameVariant {
  const k = p.kind.toUpperCase();
  const cross = k.includes("CROSS");
  const keepL = /LEFT|FULL/.test(k), keepR = /RIGHT|FULL/.test(k);
  const uniq = (rows: TraceRow[]) => { const m = new Map<string, TraceRow>(); for (const r of rows) if (!m.has(r.id)) m.set(r.id, r); return [...m.values()]; };
  const lefts = uniq([...p.matched.map((m) => m.left), ...p.unmatchedLeft]);
  const rights = uniq([...p.matched.map((m) => m.right), ...p.unmatchedRight]);
  const pairNo = new Map<string, number[]>();
  const lSeen = new Map<string, number[]>(), rSeen = new Map<string, number[]>();
  const pairIds: string[] = [];
  p.matched.forEach((m, i) => {
    let id = `pair:${m.left.id}~${m.right.id}`;
    while (pairNo.has(id)) id += "'";
    pairNo.set(id, [i + 1]);
    pairIds.push(id);
    lSeen.set(m.left.id, [...(lSeen.get(m.left.id) ?? []), i + 1]);
    rSeen.set(m.right.id, [...(rSeen.get(m.right.id) ?? []), i + 1]);
  });
  // Rows that match each other share a colour: the left row's index, so a fan-out (one left row, several right rows) reads as one family.
  const leftIndex = new Map<string, number>();
  lefts.forEach((r) => { if (lSeen.has(r.id)) leftIndex.set(r.id, leftIndex.size); });
  const rightOwner = new Map<string, number>();
  p.matched.forEach((m) => { if (!rightOwner.has(m.right.id)) rightOwner.set(m.right.id, leftIndex.get(m.left.id)!); });
  const nums = (a: number[] | undefined) => (a ? `↔ #${a.slice(0, 3).join(", #")}${a.length > 3 ? ` +${a.length - 3}` : ""}` : undefined);
  const nullsR = `NULL ×${p.rightColumns.length || 1}`, nullsL = `NULL ×${p.leftColumns.length || 1}`;
  const cards: BoardCard[] = [];
  const unL = new Set(p.unmatchedLeft.map((r) => r.id)), unR = new Set(p.unmatchedRight.map((r) => r.id));
  lefts.forEach((r, i) => {
    const un = unL.has(r.id) && !lSeen.has(r.id);
    cards.push(card(`L:${r.id}`, r.cells, p.leftColumns, { lane: 0, row: i }, { lane: 0, row: i }, un ? (keepL ? "unmatched" : "removed") : "matched",
      { badge: un ? (keepL ? "no match, kept" : "no match, dropped") : nums(lSeen.get(r.id)), group: un ? undefined : leftIndex.get(r.id) }));
  });
  rights.forEach((r, i) => {
    const un = unR.has(r.id) && !rSeen.has(r.id);
    cards.push(card(`R:${r.id}`, r.cells, p.rightColumns, { lane: 1, row: i }, { lane: 1, row: i }, un ? (keepR ? "unmatched" : "removed") : "matched",
      { badge: un ? (keepR ? "no match, kept" : "no match, dropped") : nums(rSeen.get(r.id)), group: un ? undefined : rightOwner.get(r.id) }));
  });
  let m = 0;
  const padded: string[] = [];
  p.matched.forEach((pair, i) => {
    const id = pairIds[i];
    cards.push({ ...card(id, [...pair.left.cells, ...pair.right.cells], [...p.leftColumns, ...p.rightColumns], { lane: 1.3, row: m }, { lane: 2, row: m }, "matched", { appear: true, badge: `#${i + 1}`, group: leftIndex.get(pair.left.id) }),
      text: `${cardText(pair.left.cells, 2)} ⟷ ${cardText(pair.right.cells, 2)}` });
    m++;
  });
  if (keepL) for (const r of p.unmatchedLeft) {
    const id = `pad:L:${r.id}`;
    padded.push(id);
    cards.push({ ...card(id, r.cells, p.leftColumns, { lane: 1.3, row: m }, { lane: 2, row: m }, "unmatched", { appear: true, badge: "NULL-padded" }), text: `${cardText(r.cells, 2)} ⟷ ${nullsR}` });
    m++;
  }
  if (keepR) for (const r of p.unmatchedRight) {
    const id = `pad:R:${r.id}`;
    padded.push(id);
    cards.push({ ...card(id, r.cells, p.rightColumns, { lane: 1.3, row: m }, { lane: 2, row: m }, "unmatched", { appear: true, badge: "NULL-padded" }), text: `${nullsL} ⟷ ${cardText(r.cells, 2)}` });
    m++;
  }
  const c = p.counts;
  const lanes: Lane[] = [
    { label: "Left rows", count: c.leftRows !== undefined ? c.leftRows.toLocaleString() : undefined },
    { label: "Right rows", count: c.rightRows !== undefined ? c.rightRows.toLocaleString() : undefined },
    { label: "Result", count: c.resultRows !== undefined ? c.resultRows.toLocaleString() : undefined },
  ];
  const facts: FlowFacts = {
    ...emptyFacts(),
    matched: p.matched.map((x) => [x.left.id, x.right.id]),
    unmatchedLeft: p.unmatchedLeft.map((r) => r.id),
    unmatchedRight: p.unmatchedRight.map((r) => r.id),
    padded,
    removed: [...(keepL ? [] : p.unmatchedLeft), ...(keepR ? [] : p.unmatchedRight)].map((r) => r.id),
  };
  const drawn = m;
  const bits: string[] = [];
  if (cross) bits.push(`CROSS JOIN pairs every left row with every right row${c.leftRows !== undefined && c.rightRows !== undefined ? `: ${c.leftRows.toLocaleString()} × ${c.rightRows.toLocaleString()} = ${(c.leftRows * c.rightRows).toLocaleString()} result rows` : ""}`);
  else {
    bits.push(`${p.label}: ${p.matched.length} matched ${p.matched.length === 1 ? "pair" : "pairs"} drawn${c.matchedPairs !== undefined ? ` of ${c.matchedPairs.toLocaleString()}` : ""}`);
    if (c.leftRows !== undefined && c.matchedPairs !== undefined && c.matchedPairs > c.leftRows) bits.push("one left row matches several right rows, so the result has more rows than the left side (fan-out)");
    if (p.unmatchedLeft.length || c.unmatchedLeft) bits.push(`${plural(c.unmatchedLeft ?? p.unmatchedLeft.length, "left row")} found no partner and ${keepL ? "are kept with NULLs for the right columns" : "are dropped"}`);
    if (p.unmatchedRight.length || c.unmatchedRight) bits.push(`${plural(c.unmatchedRight ?? p.unmatchedRight.length, "right row")} found no partner and ${keepR ? "are kept with NULLs for the left columns" : "are dropped"}`);
  }
  const lim = c.resultRows !== undefined && c.resultRows > drawn ? `showing ${drawn.toLocaleString()} of ${c.resultRows.toLocaleString()} rows` : undefined;
  return { label: p.label, kind: p.kind, on: p.on, index: p.index, board: boardOf(lanes, cards), facts, limited: lim, summary: `${bits.join("; ")}.` };
}

export function joinFrame(ctx: Ctx, variants: FrameVariant[]): FlowFrame {
  const last = variants[variants.length - 1];
  return frame(ctx, "join", { board: last.board, variants, facts: last.facts, limited: last.limited, summary: last.summary });
}

/* ---------- group: rows gather into buckets; aggregate: buckets collapse into one output row each ---------- */

export function groupFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; keyNames: string[]; totals?: Record<string, number>; totalIn?: number; groupCount?: number }): FlowFrame {
  const buckets = new Map<string, TraceRow[]>();
  for (const r of p.rows) { const k = r.key ?? "[]"; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r); }
  const cards: BoardCard[] = [];
  p.rows.forEach((r, i) => cards.push(card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: 1, row: 0 }, "normal")));
  let row = 0, g = 0;
  const facts = emptyFacts();
  for (const [key, members] of buckets) {
    const total = p.totals?.[key];
    const more = total !== undefined && total > members.length ? total - members.length : 0;
    for (const mem of members) { const c = cards.find((x) => x.id === mem.id)!; c.group = g; }
    cards.push({ ...card(`bucket:${key}`, [], [], { lane: 1, row }, { lane: 1, row }, "group", { appear: true, group: g++, badge: more ? `+${more.toLocaleString()} more rows not drawn` : undefined }),
      text: `${keyLabel(key)} · ×${(total ?? members.length).toLocaleString()}`, title: `${p.keyNames.join(", ") || "all rows"} = ${keyLabel(key)}` });
    row++;
    for (const mem of members) { const c = cards.find((x) => x.id === mem.id)!; c.to = { lane: 1, row }; row++; }
    facts.groups.push({ key, members: members.map((x) => x.id), total });
  }
  facts.entered = p.rows.map((r) => r.id);
  const groups = buckets.size;
  return frame(ctx, "group", {
    board: boardOf([{ label: "Rows", count: p.totalIn !== undefined ? p.totalIn.toLocaleString() : undefined }, { label: "Group buckets", count: p.groupCount !== undefined ? `${groups} of ${p.groupCount.toLocaleString()}` : String(groups) }], cards),
    facts, limited: limitedText(p.rows.length, p.totalIn),
    summary: `GROUP BY ${p.keyNames.join(", ") || "(nothing: one group)"}: the ${plural(p.rows.length, "row")} drawn gather into ${plural(groups, "bucket")}${p.groupCount !== undefined ? ` (${p.groupCount.toLocaleString()} groups overall)` : ""}. ${
      [...buckets].slice(0, 4).map(([k, m]) => `${keyLabel(k)}: ${m.length} drawn${p.totals?.[k] !== undefined ? ` of ${p.totals[k]}` : ""}`).join("; ")}.`,
  });
}

/** Group buckets only (no member rows): used when per-row group keys could not be fetched. Counts are exact. */
export function bucketsFrame(ctx: Ctx, p: { buckets: { key: string; n: number }[]; keyNames: string[]; totalIn?: number; groupCount?: number }): FlowFrame {
  const cards = p.buckets.map((b, i) => ({ ...card(`bucket:${b.key}`, [], [], { lane: -0.7, row: i }, { lane: 0, row: i }, "group", { appear: true }), text: `${keyLabel(b.key)} · ×${b.n.toLocaleString()}`, title: `${p.keyNames.join(", ")} = ${keyLabel(b.key)}` }));
  const facts = { ...emptyFacts(), groups: p.buckets.map((b) => ({ key: b.key, members: [], total: b.n })) };
  return frame(ctx, "group", {
    board: boardOf([{ label: "Groups (rows each)", count: p.groupCount !== undefined ? `${p.buckets.length} of ${p.groupCount.toLocaleString()}` : String(p.buckets.length) }], cards),
    facts, limited: limitedText(p.buckets.length, p.groupCount, "groups"), source: "stage",
    summary: `GROUP BY ${p.keyNames.join(", ")}: ${p.totalIn !== undefined ? `${p.totalIn.toLocaleString()} rows` : "the rows"} collapse into ${p.groupCount !== undefined ? p.groupCount.toLocaleString() : plural(p.buckets.length, "")} groups. The largest groups are drawn with their exact row counts.`,
  });
}

export function aggregateFrame(ctx: Ctx, p: { outputs: TraceRow[]; counts: Record<string, number>; columns: string[]; keyNames: string[]; groupCount?: number; totalIn?: number }): FlowFrame {
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  p.outputs.forEach((o, i) => {
    const key = o.key ?? "[]";
    const n = p.counts[key];
    cards.push({ ...card(`bucket:${key}`, [], [], { lane: 0, row: i }, { lane: 1, row: i }, "group", { vanish: true }), text: `${keyLabel(key)}${n !== undefined ? ` · ${n.toLocaleString()} rows` : ""}`, title: `${p.keyNames.join(", ") || "all rows"} = ${keyLabel(key)}` });
    cards.push({ ...card(o.id, o.cells, p.columns, { lane: 0.3, row: i }, { lane: 1, row: i }, "new", { appear: true, badge: n !== undefined ? `from ${n.toLocaleString()} rows` : undefined }) });
    facts.groups.push({ key, members: [o.id], total: n });
    facts.entered.push(o.id);
  });
  return frame(ctx, "aggregate", {
    board: boardOf([{ label: "Groups", count: p.groupCount !== undefined ? `${p.outputs.length} of ${p.groupCount.toLocaleString()}` : String(p.outputs.length) }, { label: "Output rows", count: p.groupCount !== undefined ? p.groupCount.toLocaleString() : undefined }], cards),
    facts, limited: limitedText(p.outputs.length, p.groupCount, "groups"),
    identityNote: "Output rows have no source row, so they are matched by their group key and content.",
    summary: `SELECT with aggregates: each of the ${plural(p.outputs.length, "group")} drawn collapses into one output row${p.totalIn !== undefined ? ` (${p.totalIn.toLocaleString()} input rows become ${p.groupCount !== undefined ? p.groupCount.toLocaleString() : p.outputs.length} output rows)` : ""}.`,
  });
}

/* ---------- project (SELECT) and distinct ---------- */

export function projectFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; outColumns: string[]; total?: number }): FlowFrame {
  const cards = p.rows.map((r, i) => ({ ...card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: 1, row: i }, "new"), textAfter: cardText(r.after ?? r.cells), title: cardTitle(p.outColumns, r.after ?? r.cells),
    after: { cols: p.outColumns, cells: (r.after ?? r.cells).map(fmtCell) } }));
  return frame(ctx, "project", {
    board: boardOf([{ label: `All columns (${p.columns.length})` }, { label: `SELECT output (${p.outColumns.length})` }], cards),
    facts: { ...emptyFacts(), kept: p.rows.map((r) => r.id) }, limited: limitedText(p.rows.length, p.total),
    summary: `SELECT: the same ${plural(p.rows.length, "row")} drawn keep their identity, but each row is reduced to ${plural(p.outColumns.length, "output column")} (${p.outColumns.slice(0, 4).join(", ")}${p.outColumns.length > 4 ? ", …" : ""}). No row is added or removed here.`,
  });
}

export function distinctFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; totalIn?: number; totalOut?: number }): FlowFrame {
  const survivors = new Map<string, number>();
  const merged = new Map<string, string[]>();
  const order: TraceRow[] = [];
  const slot = p.rows.map((r) => {
    const h = hashContent(r.after ?? r.cells);
    if (!survivors.has(h)) { survivors.set(h, survivors.size); merged.set(h, []); order.push(r); } else merged.get(h)!.push(r.id);
    return survivors.get(h)!;
  });
  const hashes = [...survivors.keys()];
  const cards = p.rows.map((r, i) => {
    const h = hashContent(r.after ?? r.cells), isSurvivor = order[survivors.get(h)!] === r;
    const dups = merged.get(h)!.length;
    return card(r.id, r.after ?? r.cells, p.columns, { lane: 0, row: i }, { lane: 1, row: slot[i] }, isSurvivor ? "survivor" : "dup",
      { vanish: !isSurvivor, badge: isSurvivor ? (dups ? `×${dups + 1}, ${dups} merged in` : "unique in sample") : "duplicate, merged" });
  });
  const facts: FlowFacts = { ...emptyFacts(), kept: order.map((r) => r.id), removed: [...merged.values()].flat(), duplicates: hashes.filter((h) => merged.get(h)!.length).map((h) => ({ survivor: order[survivors.get(h)!].id, merged: merged.get(h)! })) };
  const dupCount = facts.removed.length;
  return frame(ctx, "distinct", {
    board: boardOf([{ label: "Rows", count: p.totalIn !== undefined ? p.totalIn.toLocaleString() : undefined }, { label: "Distinct rows", count: p.totalOut !== undefined ? p.totalOut.toLocaleString() : undefined }], cards),
    facts, limited: limitedText(p.rows.length, p.totalIn),
    identityNote: "PostgreSQL does not say which duplicate it keeps; the first one in the sample is drawn as the survivor.",
    summary: `DISTINCT: of the ${plural(p.rows.length, "row")} drawn, ${plural(dupCount, "duplicate")} merge into ${plural(order.length, "surviving row")}${dupCount ? "" : " (no duplicates inside this sample)"}${
      p.totalIn !== undefined && p.totalOut !== undefined ? `. Overall ${p.totalIn.toLocaleString()} → ${p.totalOut.toLocaleString()} rows` : ""}.`,
  });
}

/* ---------- sort and limit ---------- */

/** `rows` are in their sorted (after) order; `pos` is each row's place in arrival order before the sort. */
export function sortFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; total?: number; orderBy?: string; hasPositions?: boolean }): FlowFrame {
  const has = p.hasPositions ?? p.rows.every((r) => r.pos !== undefined);
  const before = [...p.rows.keys()];
  if (has) before.sort((a, b) => p.rows[a].pos! - p.rows[b].pos! || a - b);
  const rankBefore = new Array<number>(p.rows.length);
  before.forEach((idx, rank) => { rankBefore[idx] = rank; });
  const cards = p.rows.map((r, i) => {
    const moved = has && rankBefore[i] !== i;
    return card(r.id, r.cells, p.columns, { lane: 0, row: has ? rankBefore[i] : i }, { lane: 0, row: i }, "normal",
      { badge: moved ? `#${rankBefore[i] + 1} → #${i + 1}` : `#${i + 1}` });
  });
  cards.forEach((c, i) => { if (has && rankBefore[i] !== i) c.tone = "new"; });
  const moves = p.rows.map((r, i) => ({ id: r.id, from: has ? rankBefore[i] : i, to: i }));
  const movedN = moves.filter((m) => m.from !== m.to).length;
  const facts = { ...emptyFacts(), moves, kept: p.rows.map((r) => r.id) };
  return frame(ctx, "sort", {
    board: boardOf([{ label: has ? "Rows reorder (before → after)" : "Rows after sorting", count: p.total !== undefined ? `${p.rows.length} of ${p.total.toLocaleString()}` : undefined }], cards),
    facts, limited: limitedText(p.rows.length, p.total),
    identityNote: has ? "Before-positions are the order the rows arrived in before sorting (SQL promises no particular order there)." : "Positions before sorting were not available, so only the sorted order is shown.",
    summary: has
      ? `ORDER BY ${p.orderBy ?? ""}: ${plural(movedN, "row")} of the ${p.rows.length} drawn moved to a new position${p.rows.length ? `; the first row is now ${cardText(p.rows[0].cells, 2)}` : ""}.`
      : `ORDER BY ${p.orderBy ?? ""}: the first ${p.rows.length} rows in their sorted order. Their positions before sorting were not available.`,
  });
}

export function limitFrame(ctx: Ctx, p: { rows: TraceRow[]; columns: string[]; limit?: number; offset?: number; total?: number }): FlowFrame {
  const off = p.offset ?? 0, lim = p.limit ?? Infinity;
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  let k = 0, c = 0;
  p.rows.forEach((r, i) => {
    if (i < off) { facts.skipped.push(r.id); cards.push(card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: 2, row: c++ }, "cut", { badge: "skipped by OFFSET" })); }
    else if (i < off + lim) { facts.kept.push(r.id); cards.push(card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: 1, row: k++ }, "kept")); }
    else { facts.cut.push(r.id); cards.push(card(r.id, r.cells, p.columns, { lane: 0, row: i }, { lane: 2, row: c++ }, "cut", { badge: "cut" })); }
  });
  const cutTotal = p.total !== undefined && Number.isFinite(lim) ? Math.max(0, p.total - off - lim) + Math.min(off, p.total) : undefined;
  const keptTotal = p.total !== undefined ? Math.max(0, Math.min(p.total - off, lim)) : undefined;
  const more = cutTotal !== undefined && cutTotal > facts.cut.length + facts.skipped.length ? cutTotal - facts.cut.length - facts.skipped.length : 0;
  return frame(ctx, "limit", {
    board: boardOf([{ label: "Sorted rows", count: p.total !== undefined ? p.total.toLocaleString() : undefined }, { label: "Kept", count: keptTotal !== undefined ? `${k} of ${keptTotal.toLocaleString()}` : String(k) }, { label: "Cut off", count: cutTotal !== undefined ? `${c} of ${cutTotal.toLocaleString()}` : String(c) }], cards),
    facts, limited: limitedText(p.rows.length, p.total),
    summary: `LIMIT${off ? " / OFFSET" : ""}: ${off ? `the first ${off} rows are skipped, then ` : ""}${Number.isFinite(lim) ? `${lim} rows are kept` : "the rest are kept"}. Of the ${plural(p.rows.length, "row")} drawn, ${k} stay and ${c} are cut off${more ? `; ${more.toLocaleString()} more rows are cut but not drawn` : ""}.`,
  });
}

/* ---------- set operations ---------- */

const OP_TEXT = { union: "UNION", intersect: "INTERSECT", except: "EXCEPT" } as const;

export function setOpFrame(ctx: Ctx, d: SetOpData): FlowFrame {
  const cols = d.left?.columns ?? [];
  const lRows = d.left?.rows ?? [], rRows = d.right?.rows ?? [], res = d.result?.rows ?? [];
  const remaining = new Map<string, number>();
  for (const r of res) { const h = hashContent(r); remaining.set(h, (remaining.get(h) ?? 0) + 1); }
  const resultHashes = new Set(remaining.keys());
  const lIds = traceIds(lRows), rIds = traceIds(rRows);
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  let out = 0;
  const reasonFor = (side: "left" | "right", h: string): { tone: Tone; badge: string } => {
    if (resultHashes.has(h)) return { tone: "dup", badge: d.op === "intersect" ? "matched in both" : "duplicate merged" };
    if (d.op === "except") return side === "left" ? { tone: "removed", badge: "also in right: removed" } : { tone: "removed", badge: "subtracted" };
    if (d.op === "intersect") return { tone: "removed", badge: "not in both" };
    return { tone: "removed", badge: "removed" };
  };
  const place = (rows: unknown[][], ids: string[], lane: number, side: "left" | "right") => rows.forEach((r, i) => {
    const h = hashContent(r), left = remaining.get(h) ?? 0;
    if (left > 0 && !(d.op === "except" && side === "right")) {
      remaining.set(h, left - 1);
      cards.push(card(`${side}:${ids[i]}`, r, cols, { lane, row: i }, { lane: 2, row: out++ }, "survivor", { badge: "in result" }));
      facts.kept.push(`${side}:${ids[i]}`);
    } else {
      const why = reasonFor(side, h);
      cards.push(card(`${side}:${ids[i]}`, r, cols, { lane, row: i }, { lane, row: i }, why.tone, { badge: why.badge }));
      if (why.tone === "dup") (facts.duplicates[0] ??= { survivor: "", merged: [] }).merged.push(`${side}:${ids[i]}`); else facts.removed.push(`${side}:${ids[i]}`);
    }
  });
  place(lRows, lIds, 0, "left");
  place(rRows, rIds, 1, "right");
  // Result rows the input samples did not cover (the inputs are samples) are drawn as new rows, never invented.
  for (const [h, n] of remaining) for (let i = 0; i < n; i++) {
    const r = res.find((x) => hashContent(x) === h)!;
    cards.push(card(`result:${h}#${i}`, r, cols, { lane: 1.3, row: out }, { lane: 2, row: out }, "new", { appear: true })); out++;
  }
  if (facts.duplicates[0]) facts.duplicates[0].survivor = facts.kept[0] ?? "";
  facts.duplicates = facts.duplicates.filter((x) => x.merged.length);
  const lc = d.leftCount ?? lRows.length, rc = d.rightCount ?? rRows.length, tc = d.resultCount ?? res.length;
  const lims = [limitedText(lRows.length, lc, "left rows"), limitedText(rRows.length, rc, "right rows"), limitedText(res.length, tc, "result rows")].filter(Boolean);
  return frame(ctx, "setop", {
    board: boardOf([{ label: "Left input", count: lc.toLocaleString() }, { label: "Right input", count: rc.toLocaleString() }, { label: "Result", count: tc.toLocaleString() }], cards),
    facts, limited: lims.length ? lims.join(", ") : undefined, source: "stage",
    summary: `${OP_TEXT[d.op]}${d.all ? " ALL" : ""}: ${lc.toLocaleString()} left rows and ${rc.toLocaleString()} right rows combine into ${tc.toLocaleString()} result rows. ${
      d.op === "union" ? (d.all ? "Every row is kept, duplicates included." : "Duplicates across both sides merge into one row.")
        : d.op === "intersect" ? "Only rows present on both sides stay." : "Left rows that also appear on the right are removed."}`,
  });
}

/* ---------- frames built from a stage alone (no row-level query) ---------- */

const keyOfCols = (cols: string[]) => cols.slice(0, -1);

/**
 * What can be drawn from the stage's own sample (counts are exact, rows are the visualizer's samples). `rowTrace.ts` replaces
 * these with row-level frames (real ctids and per-row movement) when it can. Identity here is always trace.
 */
export function baseFrame(stage: Stage, prev: Stage | undefined, stageIndex: number): FlowFrame {
  const ctx: Ctx = { stageIndex, clause: stage.clause, identity: "trace", source: "stage" };
  const none = (summary: string) => frame(ctx, "none", { summary });
  const mk = (s?: { rows: unknown[][] }) => { const ids = traceIds(s?.rows ?? []); return (s?.rows ?? []).map((cells, i): TraceRow => ({ id: ids[i], cells })); };
  if (stage.setOp) return setOpFrame(ctx, stage.setOp);
  if (stage.source === "parsed" || stage.error) return none(`${stage.clause.toUpperCase()}: no row data for this stage (${stage.error ? "it could not be computed" : "it was explained from the query text only"}).`);
  const rowsIn = stage.rowsIn ?? prev?.rowsOut;
  switch (stage.clause) {
    case "from": {
      if (!stage.sample?.columns.length) return none("FROM: no rows to show.");
      return scanFrame(ctx, { rows: mk(stage.sample), columns: stage.sample.columns, total: stage.rowsOut, label: stage.joins?.length ? "FROM + JOIN result" : "Table rows" });
    }
    case "where": {
      if (!stage.sample) return none("WHERE: no row data.");
      const kept = mk(stage.sample).slice(0, 12);
      const removed = mk(stage.removed).filter((r) => !kept.some((k) => k.id === r.id));
      return filterFrame(ctx, { kept, removed, columns: stage.sample.columns, totalIn: rowsIn, totalOut: stage.rowsOut });
    }
    case "having": {
      if (!stage.sample) return none("HAVING: no group data.");
      const kept = mk(stage.sample).slice(0, 12);
      const removed = mk(stage.removed);
      return filterFrame(ctx, { kept, removed, columns: stage.sample.columns, noun: "groups", totalIn: rowsIn, totalOut: stage.rowsOut });
    }
    case "group by": {
      if (stage.sample?.columns.length && stage.sample.rows.length) {
        const keyNames = keyOfCols(stage.sample.columns);
        const buckets = stage.sample.rows.map((r) => ({ key: JSON.stringify(r.slice(0, -1)), n: Number(r[r.length - 1]) }));
        return bucketsFrame(ctx, { buckets, keyNames, totalIn: rowsIn, groupCount: stage.rowsOut });
      }
      return none(`GROUP BY: ${rowsIn !== undefined ? `${rowsIn.toLocaleString()} rows` : "the rows"} collapse into ${stage.rowsOut !== undefined ? stage.rowsOut.toLocaleString() : "one"} group${stage.rowsOut === 1 ? "" : "s"}.`);
    }
    case "window": return none("Window functions: every row stays where it is; each row gets a value computed over its window. No row is added, removed or merged.");
    case "select": return none(`SELECT: computes the output columns for ${stage.rowsOut !== undefined ? stage.rowsOut.toLocaleString() : "each"} row${stage.rowsOut === 1 ? "" : "s"}.`);
    case "distinct": return none(`DISTINCT: ${stage.rowsIn !== undefined && stage.rowsOut !== undefined ? `${stage.rowsIn.toLocaleString()} → ${stage.rowsOut.toLocaleString()} rows (${(stage.rowsIn - stage.rowsOut).toLocaleString()} duplicates merged)` : "duplicate rows merge"}.`);
    case "order by": return none("ORDER BY: the same rows are put into the sorted order.");
    case "limit": return none("LIMIT / OFFSET: rows past the limit are cut off.");
    default: return none("");
  }
}

/** All classes of card tone present in a frame, for the legend. */
export function tonesIn(board: Board | undefined): Tone[] {
  return [...new Set((board?.cards ?? []).map((c) => c.tone))].filter((t) => t !== "normal");
}
export const TONE_WORD: Record<Tone, string> = { normal: "row", kept: "kept", removed: "removed", matched: "matched", unmatched: "no match", dup: "duplicate", survivor: "survivor", group: "group", new: "new or moved", cut: "cut off" };
export const TONE_GLYPH: Record<Tone, string> = { normal: "", kept: "✓", removed: "✕", matched: "↔", unmatched: "∅", dup: "≡", survivor: "★", group: "▣", new: "＋", cut: "✂" };

/** Pure helper for tests and for RowFlow: which identities does a frame say enter, leave, match, merge, group, reorder or get cut. */
export function transitions(f: FlowFrame) {
  const x = f.variants?.length ? f.variants[f.variants.length - 1].facts : f.facts;
  return { entered: x.entered, kept: x.kept, left: [...x.removed, ...x.cut, ...x.skipped], matched: x.matched, unmatchedLeft: x.unmatchedLeft, unmatchedRight: x.unmatchedRight, duplicates: x.duplicates, groups: x.groups, moved: x.moves.filter((m) => m.from !== m.to) };
}

/** Pure helper: a top-level comma split that ignores commas inside parentheses, strings and quoted identifiers. */
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "", q = "";
  for (const ch of text) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Turn a `::text` result of a predicate into a verdict: NULL (unknown) is its own value, because it removes a row just like false. */
export const verdictOf = (v: unknown): Verdict["value"] => (v === null || v === undefined ? "NULL" : String(v).toLowerCase() === "true" || v === true ? "true" : "false");

/**
 * The values a predicate looked at for one row: every column the expression names, as `column = value`, at most three.
 * Matching is by full name (`o.freight`) and, for single-table rows whose columns carry no alias, by the part after the dot.
 */
export function predicateDetail(expr: string, columns: string[], cells: unknown[], max = 3): string | undefined {
  const names = [...expr.matchAll(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?/g)].map((m) => m[0]);
  const seen = new Set<number>();
  const out: string[] = [];
  const lower = columns.map((c) => c.toLowerCase());
  for (const n of names) {
    const l = n.toLowerCase();
    let i = lower.indexOf(l);
    if (i < 0 && l.includes(".")) i = lower.indexOf(l.split(".").pop()!);
    if (i < 0 && !l.includes(".")) i = lower.findIndex((c) => c.endsWith(`.${l}`));
    if (i >= 0 && !seen.has(i)) { seen.add(i); out.push(`${columns[i]} = ${fmtCell(cells[i])}`); }
    if (out.length >= max) break;
  }
  return out.length ? out.join(", ") : undefined;
}
