/**
 * Window functions: read the `OVER (...)` of the learner's SELECT items, build the read-only query that returns the drawn rows with
 * their partition and window value, and arrange those rows on a board. The values are PostgreSQL's own: the learner's window
 * expression is run unchanged, in the same SELECT as the partition and order expressions, so nothing is recomputed in the browser.
 */
import { buildQuery, type ParsedQuery } from "../../sqlClauses";
import { blankOpaque, matchParen } from "./relations";
import { sortKeys, tieRuns } from "./order";
import { boardOf, card, emptyFacts, fmtCell, frame, keyLabel, limitedText, splitTopLevel, canon, type BoardCard, type Ctx, type FlowFrame } from "./rowFlow";

export interface WindowItem {
  /** The select item without its alias, e.g. `RANK() OVER (PARTITION BY country ORDER BY n DESC)`. */
  item: string;
  alias?: string;
  /** Function name, lower case: rank, row_number, sum ... */
  fn: string;
  /** The text between the parentheses of OVER, or of the named window it uses. */
  spec: string;
  partition: string[];
  /** ORDER BY items of the window, as written (with DESC / NULLS). */
  order: string[];
  frame?: string;
}

/** Rows drawn per partition and partitions drawn. Counts are exact; the rows are the first ones in the window's own order. */
export const WIN_PARTS = 3;
export const WIN_ROWS = 6;
/** Above this many rows entering the window the window query is not run. */
export const WIN_ROW_LIMIT = 50_000;

const RANKISH = new Set(["rank", "dense_rank", "row_number", "percent_rank", "cume_dist", "ntile"]);
export const isRankFn = (fn: string) => RANKISH.has(fn);

/** Positions at parenthesis depth 0 where each keyword group starts. */
function topLevel(spec: string): { partition?: number; order?: number; frame?: number } {
  const t = blankOpaque(spec);
  const out: { partition?: number; order?: number; frame?: number } = {};
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") depth--;
    else if (depth === 0 && (i === 0 || !/[\w$]/.test(t[i - 1]))) {
      const rest = t.slice(i);
      if (out.partition === undefined && /^partition\s+by\b/i.test(rest)) out.partition = i;
      else if (out.order === undefined && /^order\s+by\b/i.test(rest)) out.order = i;
      else if (out.frame === undefined && /^(rows|range|groups)\b/i.test(rest)) out.frame = i;
    }
  }
  return out;
}

/** Split a window specification into PARTITION BY items, ORDER BY items and the frame. */
export function parseWindowSpec(spec: string): { partition: string[]; order: string[]; frame?: string } {
  const pos = topLevel(spec);
  const cuts = [pos.partition, pos.order, pos.frame].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  const slice = (start: number | undefined, skip: RegExp) => {
    if (start === undefined) return undefined;
    const next = cuts.find((c) => c > start) ?? spec.length;
    return spec.slice(start, next).replace(skip, "").trim();
  };
  const part = slice(pos.partition, /^partition\s+by\s*/i), ord = slice(pos.order, /^order\s+by\s*/i), frame = slice(pos.frame, /^$/);
  return { partition: part ? splitTopLevel(part) : [], order: ord ? splitTopLevel(ord) : [], frame: frame || undefined };
}

/** Every select item that is a window function call. `windowClause` is the text of the WINDOW clause, for `OVER w`. */
export function findWindowItems(select: string | undefined, windowClause?: string): WindowItem[] {
  if (!select) return [];
  const out: WindowItem[] = [];
  for (const raw of splitTopLevel(select)) {
    const aliasMatch = /\s+as\s+("[^"]+"|[A-Za-z_]\w*)\s*$/i.exec(raw);
    const item = (aliasMatch ? raw.slice(0, aliasMatch.index) : raw).trim();
    const blank = blankOpaque(item);
    const over = /\bover\b/i.exec(blank);
    if (!over) continue;
    const fnm = /([A-Za-z_]\w*)\s*\(/.exec(blank.slice(0, over.index));
    let j = over.index + over[0].length;
    while (j < item.length && /\s/.test(item[j])) j++;
    let spec: string;
    if (item[j] === "(") {
      const e = matchParen(item, j);
      if (e < 0) continue;
      spec = item.slice(j + 1, e).trim();
    } else {
      const name = /^("[^"]+"|[A-Za-z_]\w*)/.exec(item.slice(j));
      if (!name || !windowClause) continue;
      const def = new RegExp(`(?:^|,)\\s*${name[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+as\\s*\\(`, "i").exec(windowClause);
      if (!def) continue;
      const open = def.index + def[0].length - 1;
      const e = matchParen(windowClause, open);
      if (e < 0) continue;
      spec = windowClause.slice(open + 1, e).trim();
    }
    const parsed = parseWindowSpec(spec);
    out.push({ item, alias: aliasMatch?.[1].replace(/"/g, ""), fn: (fnm?.[1] ?? "").toLowerCase(), spec, ...parsed });
  }
  return out;
}

export interface WindowLayout { nPart: number; nOrder: number; nItems: number }

/**
 * The read-only query: the first WIN_PARTS partitions (in key order), the first WIN_ROWS rows of each in the window's own order,
 * each with the partition key, the order key, every window value and the partition's exact size. The windows are evaluated over all
 * rows in the inner query; only the display is cut afterwards.
 */
export function windowQuery(p: ParsedQuery, items: WindowItem[]): { sql: string; layout: WindowLayout } | null {
  const c = p.clauses;
  if (!items.length || !c.from && !c.select) return null;
  const w0 = items[0];
  const part = w0.partition.map((e) => `(${e})`).join(", ");
  const orderKeys = sortKeys(w0.order.join(", "));
  if (w0.order.length && !orderKeys.length) return null;
  const select = [
    ...w0.partition.map((e, i) => `(${e}) AS _p${i}`),
    ...orderKeys.map((k, i) => `(${k.expr}) AS _o${i}`),
    ...items.map((it, i) => `${it.item} AS _w${i}`),
    part ? `dense_rank() OVER (ORDER BY ${part}) AS _g` : "1 AS _g",
    `row_number() OVER (${part ? `PARTITION BY ${part} ` : ""}${w0.order.length ? `ORDER BY ${w0.order.join(", ")}` : ""}) AS _r`,
    `count(*) OVER (${part ? `PARTITION BY ${part}` : ""}) AS _c`,
  ].join(", ");
  const inner = buildQuery(p, { select, from: c.from, where: c.where, groupBy: c["group by"], having: c.having });
  const body = p.with ? inner.slice(p.with.length).trim() : inner;
  const sql = `${p.with ? `${p.with}\n` : ""}SELECT * FROM (\n${body}\n) AS _t WHERE _g <= ${WIN_PARTS} AND _r <= ${WIN_ROWS}\nORDER BY _g, _r`;
  return { sql, layout: { nPart: w0.partition.length, nOrder: orderKeys.length, nItems: items.length } };
}

export interface WindowRow {
  part: unknown[];
  order: unknown[];
  values: unknown[];
  /** Partition number among the drawn ones (1-based) and the row's place in its partition's window order. */
  g: number;
  r: number;
  /** Rows in the partition (exact). */
  size: number;
}
export interface WindowData {
  items: WindowItem[];
  partitionExprs: string[];
  orderExprs: string[];
  /** Names of the value columns: the alias, or the item text. */
  valueNames: string[];
  rows: WindowRow[];
  /** Number of partitions and rows overall, when known. */
  partitionCount?: number;
  rowsTotal?: number;
}

export function windowDataFrom(items: WindowItem[], layout: WindowLayout, rows: unknown[][]): WindowData {
  const { nPart, nOrder, nItems } = layout;
  const w0 = items[0];
  const okeys = sortKeys(w0.order.join(", "));
  return {
    items, partitionExprs: w0.partition, orderExprs: okeys.map((k) => k.expr),
    valueNames: items.map((it) => it.alias ?? it.item),
    rows: rows.map((row) => ({
      part: row.slice(0, nPart), order: row.slice(nPart, nPart + nOrder), values: row.slice(nPart + nOrder, nPart + nOrder + nItems),
      g: Number(row[nPart + nOrder + nItems]), r: Number(row[nPart + nOrder + nItems + 1]), size: Number(row[nPart + nOrder + nItems + 2]),
    })),
  };
}

/** Rows in a tie on the window's ORDER BY inside one partition (same order values, next to each other). */
export function windowTies(d: WindowData): Map<number, { length: number; key: unknown[] }> {
  const out = new Map<number, { length: number; key: unknown[] }>();
  if (!d.orderExprs.length) return out;
  const byPart = new Map<number, number[]>();
  d.rows.forEach((r, i) => { (byPart.get(r.g) ?? byPart.set(r.g, []).get(r.g)!).push(i); });
  for (const idx of byPart.values()) {
    for (const run of tieRuns(idx.map((i) => d.rows[i].order))) for (let k = 0; k < run.length; k++) out.set(idx[run.start + k], { length: run.length, key: run.key });
  }
  return out;
}

/** The board: every row stays a row (no row is added, removed or merged); rows gather under their partition and gain the window value. */
export function windowFrame(ctx: Ctx, d: WindowData): FlowFrame {
  const cards: BoardCard[] = [];
  const facts = emptyFacts();
  const ties = windowTies(d);
  const inCols = [...d.partitionExprs, ...d.orderExprs];
  const outCols = [...inCols, ...d.valueNames];
  let row = 0, lastG = 0;
  const parts = new Set(d.rows.map((r) => r.g)).size;
  d.rows.forEach((r, i) => {
    if (r.g !== lastG) {
      lastG = r.g;
      const label = d.partitionExprs.length ? keyLabel(canon(r.part)) : "all rows";
      cards.push({ ...card(`part:${r.g}`, [], [], { lane: 1, row }, { lane: 1, row }, "group", { appear: true, group: r.g - 1 }), text: `${label} · ×${r.size.toLocaleString()}`, title: `${d.partitionExprs.join(", ") || "no PARTITION BY: one partition"} = ${label}\n${r.size.toLocaleString()} rows in this partition` });
      row++;
    }
    const cells = [...r.part, ...r.order];
    const id = `win:${i}`;
    const tie = ties.get(i);
    cards.push({
      ...card(id, cells, inCols, { lane: 0, row: i }, { lane: 1, row }, "new", { group: r.g - 1, badge: `${d.valueNames[0]} = ${fmtCell(r.values[0])}${tie ? " (tie)" : ""}`, note: tie ? `${tie.length} rows tie on ${tie.key.map(fmtCell).join(", ")}` : undefined }),
      textAfter: `${fmtCell(r.values[0])} · ${cells.map(fmtCell).join(" · ")}`,
      after: { cols: outCols, cells: [...cells.map(fmtCell), ...r.values.map(fmtCell)] },
    });
    facts.entered.push(id);
    facts.kept.push(id);
    row++;
  });
  for (const g of new Set(d.rows.map((r) => r.g))) facts.groups.push({ key: canon(d.rows.find((r) => r.g === g)!.part), members: d.rows.filter((r) => r.g === g).map((r) => `win:${d.rows.indexOf(r)}`), total: d.rows.find((r) => r.g === g)!.size });
  const lim = d.rowsTotal !== undefined ? limitedText(d.rows.length, d.rowsTotal) : undefined;
  return frame(ctx, "window", {
    board: boardOf([{ label: "Rows", count: d.rowsTotal !== undefined ? d.rowsTotal.toLocaleString() : undefined }, { label: "Partitions, each row with its value", count: d.partitionCount !== undefined ? `${parts} of ${d.partitionCount.toLocaleString()}` : String(parts) }], cards),
    facts, limited: lim, expr: d.items.map((it) => it.item).join("; "),
    identityNote: "Window values come from running your window expression for real. Rows are shown in each partition's own window order; the first partitions are drawn, partition sizes are exact.",
    summary: `${d.items[0].item}: the ${d.rows.length} rows drawn gather into ${parts} ${parts === 1 ? "partition" : "partitions"}${d.partitionCount !== undefined ? ` (${d.partitionCount.toLocaleString()} overall)` : ""} and each keeps its place while gaining ${d.valueNames[0]}. No row is added, removed or merged.`,
  });
}
