/**
 * Detail views the Query Cinema does not have, each built by running a real query against the learner's own SQL and rolled back:
 * the result set of every CTE, of every uncorrelated subquery, window partitions (rows, order and window values), the rows that
 * belong to each group with their aggregates and the HAVING verdict, and how a predicate or CASE splits rows into TRUE, FALSE
 * and NULL. Nothing is invented: when a query for a view fails, the view is left out and the reason goes into `notes`.
 */
import type { ExecuteResult } from "../../../../types";
import { buildQuery, type ParsedQuery } from "../../../lib/sqlClauses";
import { lint } from "../../../lib/compareSolutions";
import { SAMPLE, type Run } from "../../../lib/visualize";
import type { Structure } from "../../../lib/sqlAst";
import { canon } from "../../../lib/visual/rowFlow";
import { findCaseExprs, findSubqueries, findWindowCalls, matchParen, maskSql, oneLine, orderExpr, splitList, type SubqueryKind } from "./sqlText";

export interface RowsSet { columns: string[]; rows: unknown[][] }

export interface CteSet extends RowsSet {
  name: string;
  /** 1-based position in the order PostgreSQL needs them: a CTE can only read the ones before it. */
  order: number;
  dependsOn: string[];
  recursive: boolean;
  /** Names that read this CTE: other CTEs, and "main query". */
  usedBy: string[];
  rowCount?: number;
  error?: string;
}

export interface SubquerySet extends RowsSet {
  id: string;
  kind: SubqueryKind;
  clause?: string;
  text: string;
  depth: number;
  /** executed: ran on its own. outer-dependent: it reads a column of the outer query (correlated), so it has no result of its own. */
  status: "executed" | "outer-dependent";
  rowCount?: number;
  error?: string;
}

export interface WindowView {
  spec: string;
  partitionBy: string[];
  orderBy?: string;
  frame?: string;
  calls: string[];
  /** Partition expressions, order expressions, then one column per window call. */
  columns: string[];
  rows: { cells: unknown[]; partition: number; rowInPartition: number; partitionSize: number }[];
  partitions: { key: string; size: number; shown: number }[];
  totalPartitions?: number;
  totalRows?: number;
  truncated: boolean;
}

export interface GroupMember { cells: unknown[] }
export interface GroupEntry { key: string; values: unknown[]; rowCount: number; having?: "true" | "false" | "NULL"; members: GroupMember[] }
export interface GroupView {
  keys: string[];
  /** Output columns of the SELECT list (aggregates and grouped columns). */
  columns: string[];
  /** The expressions the aggregates read, shown for each member row. */
  memberColumns: string[];
  having?: string;
  groups: GroupEntry[];
  totalGroups?: number;
  groupsKept?: number;
  noGroupBy: boolean;
}

export interface Split3 { true: number; false: number; unknown: number; total: number }
export interface CaseView {
  text: string;
  conditions: string[];
  hasElse: boolean;
  contextColumns: string[];
  sample: { context: unknown[]; verdicts: ("true" | "false" | "NULL")[]; result: unknown }[];
  /** Rows per outcome, by first matching WHEN (index) or no branch (-1: ELSE, or a NULL result when there is no ELSE). */
  branches: { branch: number; rows: number }[];
  unknownPerCondition: number[];
}
export interface NullView {
  where?: { expr: string; split: Split3 };
  cases: CaseView[];
  /** Observations read from the SQL text. */
  notes: string[];
}

export interface SqlExtras {
  ctes: CteSet[];
  subqueries: SubquerySet[];
  windows: WindowView[];
  groups?: GroupView;
  nulls?: NullView;
  /** What could not be shown, and why. */
  notes: string[];
  queries: number;
}

export const emptyExtras = (): SqlExtras => ({ ctes: [], subqueries: [], windows: [], notes: [], queries: 0 });

const AGG_NAMES = "count|sum|avg|min|max|string_agg|array_agg|bool_and|bool_or|every|stddev|variance";
const AGG_RE = new RegExp(`\\b(${AGG_NAMES})\\s*\\(`, "i");
const verdict = (v: unknown): "true" | "false" | "NULL" => (v === null || v === undefined ? "NULL" : String(v).toLowerCase() === "true" || v === true ? "true" : "false");

const MAX_CTES = 8;
const MAX_SUBQUERIES = 8;
const MAX_WINDOW_SPECS = 3;
const GROUPS_SHOWN = 6;
const MEMBERS_PER_GROUP = 8;
const WINDOW_ROWS = 40;

interface Inputs {
  /** The statement text, trimmed, without the trailing semicolon. The offsets in `parsed.ranges` refer to it. */
  body: string;
  parsed: ParsedQuery;
  structure: Structure | null;
  run: Run;
  volatile: boolean;
}

const num = (r: ExecuteResult) => (r.success && r.rows[0] ? Number(r.rows[0][0]) : undefined);

export async function buildExtras({ body, parsed: p, structure, run: realRun, volatile }: Inputs): Promise<SqlExtras> {
  const out = emptyExtras();
  if (volatile) {
    out.notes.push("The query uses a function whose value changes on every run (random(), now(), nextval() ...), so no extra query was run.");
    return out;
  }
  const run: Run = async (q) => { out.queries++; return realRun(q); };
  const guard = async (what: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { out.notes.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); } };

  await guard("CTE result sets", () => cteSets(body, p, structure, run, out));
  await guard("Subquery result sets", () => subquerySets(body, p, run, out));
  const c = p.clauses;
  if (c.from && c.select && !p.unsupported) {
    await guard("Window partitions", () => windowViews(p, run, out));
    await guard("Group members", () => groupView(p, run, out));
    await guard("NULL and CASE", () => nullView(body, p, run, out));
  }
  return out;
}

/* ------------------------------------------------------------------ CTEs ------------------------------------------------ */

async function cteSets(body: string, p: ParsedQuery, st: Structure | null, run: Run, out: SqlExtras) {
  if (!st?.ctes.length || !p.with) return;
  const mainText = maskSql(body.slice(p.with.length));
  const reads = (name: string) => new RegExp(`(^|[^\\w"])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w"]|$)`, "i").test(mainText);
  let order = 0;
  for (const cte of st.ctes.slice(0, MAX_CTES)) {
    order++;
    const usedBy = [...st.ctes.filter((o) => o.dependsOn.includes(cte.name)).map((o) => o.name), ...(reads(cte.name) ? ["main query"] : [])];
    const set: CteSet = { name: cte.name, order, dependsOn: cte.dependsOn, recursive: cte.recursive, usedBy, columns: [], rows: [] };
    const ident = `"${cte.name.replace(/"/g, '""')}"`;
    const sample = await run(`${p.with}\nSELECT * FROM ${ident} LIMIT ${SAMPLE}`);
    if (sample.success) {
      set.columns = sample.columns;
      set.rows = sample.rows.slice(0, SAMPLE);
      set.rowCount = num(await run(`${p.with}\nSELECT COUNT(*) FROM ${ident}`));
    } else set.error = sample.message ?? "The CTE could not be read on its own.";
    out.ctes.push(set);
  }
  if (st.ctes.length > MAX_CTES) out.notes.push(`Only the first ${MAX_CTES} of ${st.ctes.length} CTEs are shown.`);
  if (st.ctes.some((x) => x.recursive)) out.notes.push("A recursive CTE shows its final result set, not each round of the recursion.");
}

/* ------------------------------------------------------------------ subqueries ----------------------------------------- */

function clauseAt(p: ParsedQuery, at: number): string | undefined {
  let best: [string, number] | undefined;
  for (const [name, r] of Object.entries(p.ranges)) {
    if (!r || at < r[0] || at >= r[1]) continue;
    const size = r[1] - r[0];
    if (!best || size < best[1]) best = [name, size];
  }
  return best?.[0].toUpperCase();
}

async function subquerySets(body: string, p: ParsedQuery, run: Run, out: SqlExtras) {
  const { subqueries } = findSubqueries(body);
  if (!subqueries.length) return;
  let n = 0;
  for (const sq of subqueries.slice(0, MAX_SUBQUERIES)) {
    n++;
    const prefix = /^\s*with\b/i.test(sq.text) || !p.with ? "" : `${p.with}\n`;
    const set: SubquerySet = { id: `sq${n}`, kind: sq.kind, clause: clauseAt(p, sq.range[0]), text: sq.text, depth: sq.depth, status: "executed", columns: [], rows: [] };
    const r = await run(`${prefix}SELECT * FROM (\n${sq.text}\n) AS _sq LIMIT ${SAMPLE}`);
    if (r.success) {
      set.columns = r.columns; set.rows = r.rows.slice(0, SAMPLE);
      set.rowCount = num(await run(`${prefix}SELECT COUNT(*) FROM (\n${sq.text}\n) AS _sq`));
    } else {
      set.status = "outer-dependent";
      set.error = r.message ?? "The subquery could not run on its own.";
    }
    out.subqueries.push(set);
  }
  if (subqueries.length > MAX_SUBQUERIES) out.notes.push(`Only the first ${MAX_SUBQUERIES} of ${subqueries.length} subqueries are shown.`);
  if (out.subqueries.some((s) => s.status === "outer-dependent")) out.notes.push("A correlated subquery reads a column of the outer row, so it has no result set of its own: it is evaluated once per outer row. The stages above still run it as part of the full condition.");
}

/* ------------------------------------------------------------------ windows ------------------------------------------- */

async function windowViews(p: ParsedQuery, run: Run, out: SqlExtras) {
  const c = p.clauses;
  if (!/\bover\b/i.test(maskSql(c.select!))) return;
  if (c["group by"] || c.having) { out.notes.push("Window functions over grouped rows are shown as stages only: the partition view needs the plain rows."); return; }
  if (p.joins.some((j) => /comma/i.test(j.kind))) { out.notes.push("Window partitions are not shown for a comma-separated FROM."); }
  const { calls, unsupported } = findWindowCalls(c.select!, c.window);
  for (const u of unsupported) out.notes.push(`Window partitions: ${u}.`);
  const bySpec = new Map<string, typeof calls>();
  for (const call of calls) {
    const key = [call.spec.partitionBy.join(","), call.spec.orderBy ?? "", call.spec.frame ?? ""].join("|").replace(/\s+/g, " ").toLowerCase();
    bySpec.set(key, [...(bySpec.get(key) ?? []), call]);
  }
  for (const group of [...bySpec.values()].slice(0, MAX_WINDOW_SPECS)) {
    const spec = group[0].spec;
    const pby = spec.partitionBy.map((e) => `(${e})`);
    const orderItems = spec.orderBy ? splitList(spec.orderBy) : [];
    const oexprs = orderItems.map(orderExpr);
    const partClause = pby.length ? `PARTITION BY ${pby.join(", ")}` : "";
    const select = [
      ...pby.map((e, i) => `${e} AS _p${i}`),
      ...oexprs.map((e, i) => `(${e}) AS _o${i}`),
      ...group.map((g, k) => `${g.call} OVER (${spec.text}) AS _w${k}`),
      `ROW_NUMBER() OVER (${[partClause, spec.orderBy ? `ORDER BY ${spec.orderBy}` : ""].filter(Boolean).join(" ")}) AS _rn`,
      `COUNT(*) OVER (${partClause}) AS _size`,
    ].join(", ");
    const orderBy = [...pby, ...(spec.orderBy ? [spec.orderBy] : [])].join(", ") || undefined;
    const r = await run(buildQuery(p, { select, from: c.from, where: c.where, orderBy, limit: String(WINDOW_ROWS) }));
    if (!r.success) { out.notes.push(`Window partitions for OVER (${oneLine(spec.text, 50)}): ${r.message ?? "the query failed"}`); continue; }
    const nP = pby.length, nO = oexprs.length, nW = group.length;
    const view: WindowView = {
      spec: spec.text, partitionBy: spec.partitionBy, orderBy: spec.orderBy, frame: spec.frame,
      calls: group.map((g) => g.call), columns: [...spec.partitionBy, ...oexprs, ...group.map((g) => g.call)], rows: [], partitions: [], truncated: false,
    };
    const seen = new Map<string, number>();
    for (const row of r.rows) {
      const key = canon(row.slice(0, nP));
      let idx = seen.get(key);
      if (idx === undefined) { idx = view.partitions.length; seen.set(key, idx); view.partitions.push({ key, size: Number(row[nP + nO + nW + 1]), shown: 0 }); }
      view.partitions[idx].shown++;
      view.rows.push({ cells: row.slice(0, nP + nO + nW), partition: idx, rowInPartition: Number(row[nP + nO + nW]), partitionSize: Number(row[nP + nO + nW + 1]) });
    }
    view.totalRows = num(await run(buildQuery(p, { select: "COUNT(*)", from: c.from, where: c.where })));
    if (nP) view.totalPartitions = num(await run(`SELECT COUNT(*) FROM (\n${buildQuery(p, { select: "1", from: c.from, where: c.where, groupBy: pby.join(", ") })}\n) AS _parts`));
    else view.totalPartitions = 1;
    view.truncated = view.totalRows !== undefined ? view.totalRows > view.rows.length : r.rows.length >= WINDOW_ROWS;
    out.windows.push(view);
  }
  if (bySpec.size > MAX_WINDOW_SPECS) out.notes.push(`Only the first ${MAX_WINDOW_SPECS} distinct window definitions are shown.`);
}

/* ------------------------------------------------------------------ groups -------------------------------------------- */

/** Arguments of every aggregate call in an expression (`SUM(a * b)` gives `a * b`); `*` is skipped, nested aggregates are not entered. */
function aggregateArgs(item: string): string[] {
  const m = maskSql(item);
  const re = new RegExp(`\\b(${AGG_NAMES})\\s*\\(`, "ig");
  const args: string[] = [];
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(m))) {
    const open = hit.index + hit[0].length - 1;
    const close = matchParen(m, open);
    if (close < 0) continue;
    const first = splitList(item.slice(open + 1, close))[0]?.replace(/^(distinct|all)\s+/i, "").trim();
    if (first && first !== "*") args.push(first);
    re.lastIndex = close + 1;
  }
  return args;
}

async function groupView(p: ParsedQuery, run: Run, out: SqlExtras) {
  const c = p.clauses;
  const items = splitList(c.select!);
  const aggItems = items.filter((it) => AGG_RE.test(maskSql(it)));
  const grouped = Boolean(c["group by"]) || (aggItems.length > 0 && !/\bover\b/i.test(maskSql(c.select!))) || Boolean(c.having);
  if (!grouped || /\bover\b/i.test(maskSql(c.select!))) return;
  if (c["group by"] && /\b(rollup|cube|grouping\s+sets)\b/i.test(maskSql(c["group by"]))) { out.notes.push("Group members are not shown for ROLLUP, CUBE or GROUPING SETS."); return; }
  const stripAlias = (it: string) => it.replace(/\s+as\s+("[^"]+"|\w+)\s*$/i, "").trim();
  const keys = c["group by"] ? splitList(c["group by"]).map((g) => (/^\d+$/.test(g) ? stripAlias(items[Number(g) - 1] ?? g) : g)) : [];
  const kexprs = keys.map((k) => `(${k})`);
  const k = kexprs.length;
  const args = [...new Set(aggItems.flatMap(aggregateArgs))].slice(0, 4);

  const noWith = (q: string) => (p.with && q.startsWith(p.with) ? q.slice(p.with.length).trimStart() : q);
  const groupsSql = (having: string | undefined, limit: number, keysOnly: boolean) => buildQuery(p, {
    select: keysOnly ? kexprs.map((e, i) => `${e} AS _k${i}`).join(", ")
      : [...items, "COUNT(*) AS _n", ...(c.having ? [`(${c.having})::text AS _having`] : []), ...kexprs.map((e, i) => `${e} AS _k${i}`)].join(", "),
    from: c.from, where: c.where, groupBy: c["group by"], having, orderBy: kexprs.join(", ") || undefined, limit: String(limit),
  });
  // With HAVING, show both fates: groups it keeps and groups it removes (up to three of each when there are that many), not just
  // the first six by key. Without HAVING, the first six groups in key order.
  let rowsOf: unknown[][] = [];
  let selection: string[] = [];
  const failed = (m?: string | null) => out.notes.push(`Group members: ${m ?? "the grouped query failed"}${/alias/i.test(m ?? "") ? "" : " (a GROUP BY on a SELECT alias cannot be shown)"}`);
  let resultColumns: string[] = [];
  if (c.having) {
    const [kept, removed] = [await run(groupsSql(`(${c.having}) IS TRUE`, GROUPS_SHOWN, false)), await run(groupsSql(`(${c.having}) IS NOT TRUE`, GROUPS_SHOWN, false))];
    if (!kept.success || !removed.success) { failed((!kept.success ? kept : removed).message); return; }
    const nk = Math.min(kept.rows.length, GROUPS_SHOWN - Math.min(removed.rows.length, GROUPS_SHOWN / 2));
    const nr = Math.min(removed.rows.length, GROUPS_SHOWN - nk);
    rowsOf = [...kept.rows.slice(0, nk), ...removed.rows.slice(0, nr)];
    resultColumns = kept.columns;
    selection = [nk ? noWith(groupsSql(`(${c.having}) IS TRUE`, nk, true)) : "", nr ? noWith(groupsSql(`(${c.having}) IS NOT TRUE`, nr, true)) : ""].filter(Boolean);
  } else {
    const g = await run(groupsSql(undefined, GROUPS_SHOWN, false));
    if (!g.success) { failed(g.message); return; }
    rowsOf = g.rows; resultColumns = g.columns;
    selection = [noWith(groupsSql(undefined, GROUPS_SHOWN, true))];
  }
  const nI = items.length;
  const view: GroupView = { keys, columns: resultColumns.slice(0, nI), memberColumns: args, having: c.having, groups: [], noGroupBy: !c["group by"] };
  for (const row of rowsOf) {
    view.groups.push({
      key: canon(row.slice(nI + 1 + (c.having ? 1 : 0))),
      values: row.slice(0, nI), rowCount: Number(row[nI]),
      having: c.having ? verdict(row[nI + 1]) : undefined, members: [],
    });
  }
  const inner = noWith(buildQuery(p, {
    select: [...kexprs.map((e, i) => `${e} AS _k${i}`), ...args.map((a, i) => `(${a}) AS _a${i}`),
      `ROW_NUMBER() OVER (${k ? `PARTITION BY ${kexprs.join(", ")}` : ""}) AS _rn`].join(", "),
    from: c.from, where: c.where,
  }));
  const join = k ? `\nJOIN (${selection.map((x) => `(${x})`).join("\nUNION ALL\n")}) AS g ON ${kexprs.map((_, i) => `m._k${i} IS NOT DISTINCT FROM g._k${i}`).join(" AND ")}` : "";
  const m = await run(`${p.with ? p.with + "\n" : ""}SELECT m.* FROM (\n${inner}\n) AS m${join}\nWHERE m._rn <= ${MEMBERS_PER_GROUP}\nORDER BY m._rn`);
  if (m.success) {
    const byKey = new Map(view.groups.map((x) => [x.key, x]));
    for (const row of m.rows) byKey.get(canon(row.slice(0, k)))?.members.push({ cells: row.slice(k, k + args.length) });
  } else out.notes.push(`Group members: ${m.message ?? "the member query failed"}`);
  const base = { select: "1", from: c.from, where: c.where, groupBy: c["group by"] };
  if (c["group by"]) {
    view.totalGroups = num(await run(`SELECT COUNT(*) FROM (\n${buildQuery(p, base)}\n) AS _g`));
    if (c.having) view.groupsKept = num(await run(`SELECT COUNT(*) FROM (\n${buildQuery(p, { ...base, having: c.having })}\n) AS _g`));
  } else {
    view.totalGroups = 1;
    if (c.having) view.groupsKept = num(await run(`SELECT COUNT(*) FROM (\n${buildQuery(p, { ...base, having: c.having })}\n) AS _g`));
  }
  out.groups = view;
}

/* ------------------------------------------------------------------ NULL and CASE ------------------------------------- */

async function nullView(body: string, p: ParsedQuery, run: Run, out: SqlExtras) {
  const c = p.clauses;
  const view: NullView = { cases: [], notes: [] };
  const masked = maskSql(body);
  for (const n of lint(body)) if (/NULL/.test(n.text)) view.notes.push(n.text);
  if (/\bis\s+(not\s+)?distinct\s+from\b/i.test(masked)) view.notes.push("IS [NOT] DISTINCT FROM treats two NULLs as equal, unlike = and <>.");
  if (/\bcoalesce\s*\(|\bnullif\s*\(/i.test(masked)) view.notes.push("COALESCE returns its first non-NULL argument; NULLIF(a, b) returns NULL when a = b.");

  if (c.where) {
    const w = c.where;
    const r = await run(buildQuery(p, {
      select: [`COUNT(CASE WHEN (${w}) IS TRUE THEN 1 END)`, `COUNT(CASE WHEN (${w}) IS FALSE THEN 1 END)`, `COUNT(CASE WHEN (${w}) IS NULL THEN 1 END)`, "COUNT(*)"].join(", "),
      from: c.from,
    }));
    if (r.success && r.rows[0]) { const [t, f, u, total] = r.rows[0].map(Number); view.where = { expr: w, split: { true: t, false: f, unknown: u, total } }; }
    else out.notes.push(`WHERE verdict counts: ${r.message ?? "the query failed"}`);
  }

  const aggregated = Boolean(c["group by"]) || Boolean(c.having) || AGG_RE.test(maskSql(c.select!));
  if (!aggregated) {
    const items = splitList(c.select!);
    const caseItems = items.flatMap((it) => findCaseExprs(it));
    const context = items.filter((it) => !/\bcase\b/i.test(maskSql(it))).slice(0, 3);
    for (const cs of caseItems.slice(0, 3)) {
      const conds = cs.whens.map((w) => (cs.operand ? `(${cs.operand}) = (${w.when})` : w.when));
      const sel = [...context.map((x) => `(${x})`), ...conds.map((x) => `(${x})::text`), `(${cs.text})`].join(", ");
      const rows = await run(buildQuery(p, { select: sel, from: c.from, where: c.where, limit: "12" }));
      const branchExpr = `CASE ${conds.map((x, i) => `WHEN (${x}) THEN ${i}`).join(" ")} ELSE -1 END`;
      const split = await run(`${p.with ? p.with + "\n" : ""}SELECT b, COUNT(*) FROM (\n${buildQuery(p, { select: `${branchExpr} AS b`, from: c.from, where: c.where }).replace(p.with, "").trim()}\n) AS _b GROUP BY b ORDER BY b`);
      const unknown = await run(buildQuery(p, { select: conds.map((x) => `COUNT(CASE WHEN (${x}) IS NULL THEN 1 END)`).join(", "), from: c.from, where: c.where }));
      if (!rows.success || !split.success || !unknown.success) { out.notes.push(`CASE evaluation: ${rows.message ?? split.message ?? unknown.message ?? "a query failed"}`); continue; }
      const nC = context.length;
      view.cases.push({
        text: cs.text, conditions: conds, hasElse: cs.elseExpr !== undefined, contextColumns: context.map((x) => oneLine(stripAs(x), 24)),
        sample: rows.rows.map((r) => ({ context: r.slice(0, nC), verdicts: r.slice(nC, nC + conds.length).map(verdict), result: r[nC + conds.length] })),
        branches: split.rows.map((r) => ({ branch: Number(r[0]), rows: Number(r[1]) })),
        unknownPerCondition: unknown.rows[0].map(Number),
      });
    }
  }
  if (view.where || view.cases.length || view.notes.length) out.nulls = view;
}

const stripAs = (it: string) => it.replace(/\s+as\s+("[^"]+"|\w+)\s*$/i, "").trim();
