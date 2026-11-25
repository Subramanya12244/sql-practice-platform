/**
 * Aggregation in detail for the SQL Practice visualizer: for a query such as
 * `SELECT country, COUNT(*), ROUND(SUM(unit_price * quantity * (1 - discount))::numeric, 2) ... GROUP BY country`
 *
 *   CALC   the value each row contributes: the aggregate's argument evaluated with that row's own column values (NULL when it is NULL)
 *   SUM    those values collected per group (COUNT, AVG, MIN, MAX alike), with a running result, and the group's exact result
 *   ROUND  what the query applies to the aggregate afterwards (a cast, ROUND(...), another expression)
 *
 * Adapted from the ideas of the Cinema's aggDetail.ts (classic files must not import the Cinema, so what is needed is copied here and
 * extended: several aggregates in one SELECT, COUNT(*), COUNT(col), DISTINCT, NULL contributions that are ignored).
 * Everything is a value the database returned (queries built by `aggQueries`, run by rowTrace.ts); the frames only arrange it.
 */
import { buildQuery, type ParsedQuery } from "../../sqlClauses";
import {
  boardOf, canon, card, emptyFacts, fmtCell, frame, keyLabel, limitedText, splitTopLevel, type BoardCard, type Ctx, type FlowFrame, type FrameVariant,
} from "./rowFlow";

export type AggFn = "sum" | "avg" | "min" | "max" | "count";

export interface AggCall {
  fn: AggFn;
  /** The expression inside the call, e.g. `od.unit_price * od.quantity * (1 - od.discount)`; `*` for COUNT(*). */
  arg: string;
  star: boolean;
  distinct: boolean;
  /** The call itself, e.g. `SUM(od.unit_price * ...)`. */
  call: string;
  /** The whole select item without its alias, e.g. `ROUND(SUM(...)::numeric, 2)`. */
  item: string;
  alias?: string;
  /** The argument is one plain column (or `*`): a per-row calculation step would show nothing new. */
  trivial: boolean;
  casts: string[];
  round?: number;
  /** The item is more than the bare call, so something is applied to the aggregate's result. */
  wrapped: boolean;
}

/** Groups and rows per group the aggregate boards draw; the group results are exact for every row of those groups. */
export const AGG_GROUPS = 3;
export const AGG_ROWS_PER_GROUP = 5;
/** Above this many rows entering GROUP BY the detail query is not run. */
export const AGG_ROW_LIMIT = 50_000;
export const AGG_MAX_CALLS = 3;

const AGG_FN = /\b(sum|avg|min|max|count)\s*\(/gi;
const PLAIN = /^(?:"[^"]+"|[A-Za-z_]\w*)(?:\.(?:"[^"]+"|[A-Za-z_]\w*))*$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (c: string) => c.split(".").pop()!;

function closing(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The aggregates of a SELECT list, one per select item (the first aggregate call of the item), taken apart. Items with OVER (window
 * functions), FILTER or WITHIN GROUP, and calls with several arguments are left out: no single per-row value exists to show.
 */
export function findAggCalls(select: string | undefined, max = AGG_MAX_CALLS): AggCall[] {
  if (!select) return [];
  const out: AggCall[] = [];
  for (const raw of splitTopLevel(select.replace(/^\s*distinct\b/i, ""))) {
    if (out.length >= max) break;
    const aliasMatch = /\s+as\s+("[^"]+"|[A-Za-z_]\w*)\s*$/i.exec(raw);
    const item = (aliasMatch ? raw.slice(0, aliasMatch.index) : raw).trim();
    if (/\bover\b/i.test(item)) continue;
    AGG_FN.lastIndex = 0;
    const m = AGG_FN.exec(item);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    const close = closing(item, open);
    if (close < 0) continue;
    let arg = item.slice(open + 1, close).trim();
    if (!arg || splitTopLevel(arg).length > 1 || /^\s*(filter|within)\b/i.test(item.slice(close + 1))) continue;
    const distinct = /^distinct\b/i.test(arg);
    if (distinct) arg = arg.replace(/^distinct\s+/i, "").trim();
    const star = arg === "*";
    if (star && distinct) continue;
    const call = item.slice(m.index, close + 1);
    const casts = [
      ...[...item.matchAll(/::\s*([A-Za-z_]\w*)/g)].map((x) => x[1].toLowerCase()),
      ...[...item.matchAll(/\bcast\s*\([^]*?\bas\s+([A-Za-z_]\w*)/gi)].map((x) => x[1].toLowerCase()),
    ];
    let round: number | undefined;
    const rm = /\bround\s*\(/i.exec(item);
    if (rm) {
      const o = rm.index + rm[0].length - 1;
      const c = closing(item, o);
      const parts = c > o ? splitTopLevel(item.slice(o + 1, c)) : [];
      if (parts.length === 2 && /^\d+$/.test(parts[1].trim())) round = Number(parts[1].trim());
    }
    out.push({ fn: m[1].toLowerCase() as AggFn, arg, star, distinct, call, item, alias: aliasMatch?.[1].replace(/"/g, ""), trivial: star || PLAIN.test(arg), casts, round, wrapped: item !== call });
  }
  return out;
}

/** What the query applies to the aggregate's result, in a sentence. Only what was found in the query is claimed. */
export function shapeSentence(c: AggCall): string {
  const fn = c.fn.toUpperCase();
  const parts: string[] = [];
  const casts = [...new Set(c.casts)];
  if (casts.length) parts.push(`casts it to ${casts.join(" and ")}`);
  if (c.round !== undefined) parts.push(`rounds it to ${c.round} decimal ${c.round === 1 ? "place" : "places"}`);
  if (!parts.length) parts.push(`applies ${c.item.replace(c.call, `${fn}(…)`)} to it`);
  return `${fn} first gives the group's full result. Then the query ${parts.join(" and ")}.`;
}
export const shapeLabel = (c: AggCall) => (c.round !== undefined ? "ROUND" : c.casts.length ? "CAST" : "EXPR");

/** Short rail label: `SUM`, `COUNT`, or `COUNT + SUM`; `AGGREGATES` when there are more than two kinds. */
export function aggLabel(calls: AggCall[]): string {
  const fns = [...new Set(calls.map((c) => c.fn.toUpperCase()))];
  return fns.length === 0 ? "AGGREGATE" : fns.length <= 2 ? fns.join(" + ") : "AGGREGATES";
}

/* ---------- worked values ---------- */

const word = (name: string) => new RegExp(`(^|[^\\w.])${esc(name)}(?![\\w(])`, "i");
/** A column that carries no alias prefix (one table in FROM) is written in the expression with or without one: `od.quantity` or `quantity`. */
const wordAliased = (name: string) => new RegExp(`(^|[^\\w.])(?:(?:"[^"]+"|[A-Za-z_]\\w*)\\.)?${esc(name)}(?![\\w(])`, "gi");

/** Indexes of the columns an expression reads (one per bare name, so `p.id` and `od.id` do not both count for `id`). */
export function operandColumns(expr: string, columns: string[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  columns.forEach((c, i) => {
    const b = bare(c).toLowerCase();
    if (seen.has(b)) return;
    if (word(c).test(expr) || word(bare(c)).test(expr) || (!c.includes(".") && wordAliased(c).test(expr))) { seen.add(b); out.push(i); }
  });
  return out;
}

/** The expression with each column replaced by that row's value: `18 * 12 * (1 - 0)`. A text substitution only; the result comes from the database. */
export function substituteValues(expr: string, columns: string[], cells: unknown[]): string {
  let out = expr.replace(/\s+/g, " ").trim();
  const held: string[] = [];
  const order = columns.map((c, i) => ({ c, i })).sort((a, b) => b.c.length - a.c.length);
  for (const { c, i } of order) {
    const v = fmtCell(cells[i]);
    const rep = /^-/.test(v) ? `(${v})` : v;
    for (const re of c.includes(".") ? [word(c), word(bare(c))].map((w) => new RegExp(w.source, "gi")) : [wordAliased(c)]) {
      if (re.test(out)) {
        out = out.replace(re, (_m, pre: string) => { held.push(rep); return `${pre}\u0000${held.length - 1}\u0000`; });
        break;
      }
    }
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_m, k: string) => held[Number(k)]);
}

/* ---------- queries ---------- */

export interface AggQueryLayout {
  nKeys: number;
  /** The distinct argument expressions (COUNT(*) has none), in column order. */
  args: string[];
  /** The aggregate (index into the calls) that has a running column, if any. */
  runCall?: number;
}

const argsOf = (calls: AggCall[]) => [...new Set(calls.filter((c) => !c.star).map((c) => c.arg))];

/**
 * Two read-only queries for the first AGG_GROUPS groups (in key order):
 * - rows: every row of those groups would be too many, so the first AGG_ROWS_PER_GROUP rows of each, with the argument values, the
 *   group's exact size and a running result (a window function numbers the groups and rows, so only the first few come back);
 * - totals: each group's exact size, aggregate result, final value and the number of non-NULL contributions.
 * `payload` is the SQL that returns the joined row (one `to_json(alias)` per table), `rowOrder` a deterministic row order for it.
 */
export function aggQueries(p: ParsedQuery, calls: AggCall[], keyExprs: string[], payload: string, rowOrder: string): { rows: string; totals: string; layout: AggQueryLayout } {
  const c = p.clauses;
  const keys = keyExprs.map((k) => `(${k})`);
  const part = keys.join(", ");
  const args = argsOf(calls);
  const first = calls[0];
  const runCall = !first.star && !first.distinct ? 0 : undefined;
  const ord = first.fn === "min" && !first.star ? `(${first.arg}) ASC NULLS LAST, ${rowOrder}` : first.fn === "max" && !first.star ? `(${first.arg}) DESC NULLS LAST, ${rowOrder}` : rowOrder;
  const win = `${part ? `PARTITION BY ${part} ` : ""}ORDER BY ${ord}`;
  const inner = buildQuery(p, {
    select: [
      ...keys.map((k, i) => `${k} AS _k${i}`), payload, ...args.map((a, i) => `(${a})::text AS _a${i}`),
      part ? `dense_rank() OVER (ORDER BY ${part}) AS _g` : "1 AS _g",
      `row_number() OVER (${win}) AS _n`,
      `count(*) OVER (${part ? `PARTITION BY ${part}` : ""}) AS _c`,
      ...(runCall !== undefined ? [`${first.fn}(${first.arg}) OVER (${win} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text AS _run`] : []),
    ].join(", "),
    from: c.from, where: c.where,
  });
  const body = p.with ? inner.slice(p.with.length).trim() : inner;
  const rows = `${p.with ? `${p.with}\n` : ""}SELECT * FROM (\n${body}\n) AS _t WHERE _g <= ${AGG_GROUPS} AND _n <= ${AGG_ROWS_PER_GROUP}\nORDER BY _g, _n`;
  const totals = buildQuery(p, {
    select: ["COUNT(*)", ...calls.flatMap((k) => [`(${k.call})::text`, `(${k.item})::text`, k.star ? "COUNT(*)" : `COUNT(${k.distinct ? "DISTINCT " : ""}${k.arg})`]), ...keys].join(", "),
    from: c.from, where: c.where, groupBy: c["group by"], orderBy: part || undefined, limit: String(AGG_GROUPS),
  });
  return { rows, totals, layout: { nKeys: keyExprs.length, args, runCall } };
}

/* ---------- data ---------- */

export interface AggMember {
  /** The joined row, aligned with `AggDetail.columns`. */
  cells: unknown[];
  /** The value of each distinct argument for this row, as text from the database (null = NULL, which the aggregate ignores). */
  values: (string | null)[];
  /** The first aggregate over this group's drawn rows up to and including this one, from the database. */
  running?: string | null;
}
export interface AggCallResult {
  /** `SUM(...)` for the whole group, as text. */
  raw: string | null;
  /** The select item for the whole group (after any cast or rounding), as text. */
  result: string | null;
  /** Rows of the group whose argument is not NULL (the rows the aggregate really used); for COUNT(*), all rows. */
  used: number;
}
export interface AggGroupData {
  key: string;
  keyCells: unknown[];
  /** Rows in the group (exact, not only the ones drawn). */
  n: number;
  members: AggMember[];
  calls: AggCallResult[];
}
export interface AggDetail {
  calls: AggCall[];
  args: string[];
  columns: string[];
  keyExprs: string[];
  groups: AggGroupData[];
  /** Rows entering GROUP BY, exact. */
  rowsIn?: number;
  /** Groups overall, exact. */
  groupCount?: number;
}
export interface AggTrace { detail: AggDetail; calc?: FlowFrame; sum: FlowFrame; round?: FlowFrame }

const txt = (v: unknown): string | null => (v === null || v === undefined ? null : fmtCell(v));

/** Put the two result sets together. `joined` are the decoded joined rows of `rows` (aligned), `columns` their names. */
export function assembleAgg(a: {
  calls: AggCall[]; keyExprs: string[]; layout: AggQueryLayout; rows: unknown[][]; nAlias: number; joined: unknown[][]; columns: string[]; totals: unknown[][];
  rowsIn?: number; groupCount?: number;
}): AggDetail | null {
  const { layout, calls } = a;
  const e = layout.nKeys, nArgs = layout.args.length;
  const base = e + a.nAlias + nArgs;
  const groups = new Map<string, AggGroupData>();
  a.rows.forEach((row, i) => {
    const keyCells = row.slice(0, e);
    const key = canon(keyCells);
    const g = groups.get(key) ?? groups.set(key, { key, keyCells, n: Number(row[base + 2]), members: [], calls: [] }).get(key)!;
    g.members.push({
      cells: a.joined[i], values: layout.args.map((_, j) => txt(row[e + a.nAlias + j])),
      running: layout.runCall !== undefined ? txt(row[base + 3]) : undefined,
    });
  });
  for (const t of a.totals) {
    const key = canon(t.slice(1 + calls.length * 3));
    const g = groups.get(key);
    if (!g) continue;
    g.n = Number(t[0]);
    g.calls = calls.map((_, k) => ({ raw: txt(t[1 + k * 3]), result: txt(t[2 + k * 3]), used: Number(t[3 + k * 3]) }));
  }
  const list = [...groups.values()];
  if (!list.length || list.some((g) => g.calls.length !== calls.length)) return null;
  return { calls, args: layout.args, columns: a.columns, keyExprs: a.keyExprs, groups: list, rowsIn: a.rowsIn, groupCount: a.groupCount };
}

const fnName = (c: AggCall) => c.fn.toUpperCase();
const keyIndex = (expr: string | undefined, columns: string[]) => {
  const e = (expr ?? "").trim().toLowerCase();
  return e ? columns.findIndex((c) => c.toLowerCase() === e || bare(c).toLowerCase() === e) : -1;
};
const drawn = (d: AggDetail) => d.groups.reduce((s, g) => s + g.members.length, 0);
/** The first argument that needs a per-row calculation, with its index in `args`. */
export function firstCalc(d: AggDetail): { arg: string; index: number } | undefined {
  const index = d.args.findIndex((a) => !PLAIN.test(a));
  return index >= 0 ? { arg: d.args[index], index } : undefined;
}

/** Up to `max` worked lines: the argument with one drawn row's values in it, and the value the database returned for that row. */
export function workedLines(d: AggDetail, max = 3): string[] {
  const fc = firstCalc(d);
  const out: string[] = [];
  if (!fc) return out;
  for (const g of d.groups) for (const m of g.members) {
    if (out.length >= max) return out;
    if (m.values[fc.index] === null) continue;
    out.push(`${substituteValues(fc.arg, d.columns, m.cells)} = ${m.values[fc.index]}`);
  }
  return out;
}

/** Columns of the joined row the aggregate arguments read, or the first two when none is named (COUNT(*)). */
export function shownColumns(d: AggDetail): number[] {
  const idx = [...new Set(d.args.flatMap((a) => operandColumns(a, d.columns)))];
  const k = keyIndex(d.keyExprs[0], d.columns);
  const base = idx.length ? idx : d.columns.slice(0, 2).map((_, i) => i);
  return [...(k >= 0 && !base.includes(k) ? [k] : []), ...base].slice(0, 5);
}

/* ---------- frames ---------- */

const IDENTITY_NOTE = `Rows are real joined rows. Up to ${AGG_ROWS_PER_GROUP} rows of each of the first ${AGG_GROUPS} groups are drawn; the group results are exact for every row of those groups.`;

/** CALC: each drawn row, with the values the expression reads, gains the value the expression gives. */
export function calcFrame(ctx: Ctx, d: AggDetail): FlowFrame | undefined {
  const fc = firstCalc(d);
  if (!fc) return undefined;
  const show = shownColumns(d);
  const names = show.map((i) => d.columns[i]);
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  let row = 0;
  d.groups.forEach((g, gi) => g.members.forEach((m, mi) => {
    const cells = show.map((i) => m.cells[i]);
    const id = `calc:${gi}:${mi}`;
    const isNull = m.values[fc.index] === null;
    cards.push({ ...card(id, cells, names, { lane: 0, row }, { lane: 0, row }, isNull ? "unmatched" : "new", { group: gi, badge: isNull ? "NULL: ignored" : undefined }), after: { cols: [...names, "line value"], cells: [...cells.map(fmtCell), fmtCell(m.values[fc.index])] } });
    facts.entered.push(id);
    row++;
  }));
  const first = workedLines(d, 1)[0];
  return frame(ctx, "calc", {
    board: boardOf([{ label: "Row → line value", count: d.rowsIn !== undefined ? `${row} of ${d.rowsIn.toLocaleString()}` : String(row) }], cards),
    facts, limited: limitedText(row, d.rowsIn), identityNote: IDENTITY_NOTE, expr: fc.arg,
    summary: `${fc.arg} is evaluated for every row, using that row's own values.${first ? ` First row drawn: ${first}.` : ""}`,
  });
}

const callsText = (d: AggDetail, g: AggGroupData) => d.calls.map((c, k) => `${fnName(c)}${c.star ? "(*)" : c.distinct ? "(DISTINCT)" : ""} = ${fmtCell(g.calls[k].raw)}`).join(", ");

/** SUM (or AVG, MIN, MAX, COUNT): each group's values slide together and become one result. */
export function sumFrame(ctx: Ctx, d: AggDetail): FlowFrame {
  const fn = d.calls.map(fnName).filter((x, i, a) => a.indexOf(x) === i).join(" + ");
  const first = d.calls[0];
  const vi = first.star ? -1 : d.args.indexOf(first.arg);
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  let row = 0;
  d.groups.forEach((g, gi) => {
    const label = keyLabel(g.key);
    const ids: string[] = [];
    g.members.forEach((m, mi) => {
      const id = `sum:${gi}:${mi}`;
      ids.push(id);
      const v = vi >= 0 ? m.values[vi] : "1";
      const ignored = vi >= 0 && v === null;
      cards.push({
        ...card(id, [label, v], ["group", "line value"], { lane: 0, row }, { lane: 0, row }, ignored ? "unmatched" : "new", { group: gi, badge: ignored ? "NULL: ignored" : undefined }),
        after: { cols: ["group", "line value", `running ${fnName(first)}`], cells: [label, fmtCell(v), m.running === undefined ? "" : fmtCell(m.running)] },
      });
      row++;
    });
    const more = g.n - g.members.length;
    // The group's result sits next to the first value it combines; the values stay in the left lane, so both lanes hold something once settled.
    const top = row - g.members.length;
    cards.push({
      ...card(`total:${gi}`, [], [], { lane: 0.3, row: top }, { lane: 1, row: top }, "group", { appear: true, group: gi, badge: more > 0 ? `+${more.toLocaleString()} more rows` : undefined }),
      text: "→ ", calc: callsText(d, g), title: `${label}\n${callsText(d, g)}\nover ${g.n.toLocaleString()} ${g.n === 1 ? "row" : "rows"}`,
    });
    facts.groups.push({ key: g.key, members: ids, total: g.n });
    facts.entered.push(...ids);
    row++;
  });
  const g0 = d.groups[0];
  return frame(ctx, "aggregate", {
    board: boardOf([{ label: "Line values" }, { label: `${fn} per group`, count: `${d.groups.length} groups` }], cards),
    facts, limited: limitedText(drawn(d), d.rowsIn), identityNote: IDENTITY_NOTE,
    summary: `${fn} combines each group's line values into one result.${g0 ? ` ${keyLabel(g0.key)}: ${g0.n.toLocaleString()} ${g0.n === 1 ? "row" : "rows"} → ${callsText(d, g0)}.` : ""}`,
  });
}

/** ROUND / CAST: each group's full result becomes the value the query returns. */
export function roundFrame(ctx: Ctx, d: AggDetail): FlowFrame | undefined {
  const ci = d.calls.findIndex((c) => c.wrapped);
  if (ci < 0) return undefined;
  const call = d.calls[ci];
  const fn = fnName(call);
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  d.groups.forEach((g, gi) => {
    const label = keyLabel(g.key);
    const id = `shape:${gi}`;
    // The full result stays in the left lane; the value the query returns appears in the right lane.
    cards.push(card(id, [label, g.calls[ci].raw], ["group", `${fn} result`], { lane: 0, row: gi }, { lane: 0, row: gi }, "new", { group: gi }));
    cards.push(card(`shaped:${gi}`, [label, g.calls[ci].result], ["group", call.alias ?? "result"], { lane: 0.3, row: gi }, { lane: 1, row: gi }, "new", { group: gi, appear: true }));
    facts.groups.push({ key: g.key, members: [id], total: g.n });
    facts.entered.push(id);
  });
  const g0 = d.groups[0];
  return frame(ctx, "aggregate", {
    board: boardOf([{ label: `${fn} result` }, { label: `After ${shapeLabel(call)}` }], cards),
    facts, identityNote: IDENTITY_NOTE,
    summary: `${shapeSentence(call)}${g0 ? ` ${keyLabel(g0.key)}: ${fmtCell(g0.calls[ci].raw)} → ${fmtCell(g0.calls[ci].result)}.` : ""}`,
  });
}

/** The boards of one aggregate stage as selectable variants (CALC, the aggregate itself, ROUND), last one the aggregate's own result. */
export function aggVariants(t: AggTrace): FrameVariant[] {
  const out: FrameVariant[] = [];
  const add = (label: string, f: FlowFrame | undefined, index: number) => { if (f?.board) out.push({ label, board: f.board, summary: f.summary, limited: f.limited, facts: f.facts, kind: f.kind, index }); };
  const fn = t.detail.calls.map(fnName).filter((x, i, a) => a.indexOf(x) === i).join(" + ");
  add(`CALC: ${firstCalc(t.detail)?.arg ?? ""}`, t.calc, 0);
  add(`${fn} per group`, t.sum, 1);
  add(`${shapeLabel(t.detail.calls.find((c) => c.wrapped) ?? t.detail.calls[0])} of the result`, t.round, 2);
  return out;
}

export function aggTrace(ctx: Ctx, detail: AggDetail): AggTrace {
  return { detail, calc: calcFrame(ctx, detail), sum: sumFrame(ctx, detail), round: roundFrame(ctx, detail) };
}
