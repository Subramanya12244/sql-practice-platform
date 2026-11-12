/**
 * Row-level data for the stage animations. For each logical stage this issues extra derived SELECTs (through the same
 * rolled-back `Run` that `visualize()` uses) that carry every sampled source row's identity through the stage:
 * PostgreSQL's `ctid` per table alias where it exists, otherwise a labelled trace identity (hash of content plus an
 * occurrence counter). It never changes what the learner's query runs or returns: the final result still comes from
 * running exactly their query once, in `visualize()`.
 *
 * Guards: with volatile functions (random(), now(), nextval() …) nothing is run, as in `visualize()`. Sources with no
 * ctid (subqueries, CTEs, views, functions) fall back to trace identity. Whatever cannot be fetched keeps the frame that
 * `baseFrame()` draws from the stage's own sample, or none.
 */
import type { ExecuteResult } from "../../../types";
import { SAMPLE, type Run, type Visualization } from "../visualize";
import { buildQuery, type JoinPart, type ParsedQuery } from "../sqlClauses";
import {
  aggregateFrame, baseFrame, canon, ctidId, ctidOrder, distinctFrame, filterFrame, groupFrame, joinFrame, joinVariant, limitFrame,
  predicateDetail, projectFrame, scanFrame, sortFrame, splitTopLevel, traceIds, hashContent, verdictOf, fmtCell, type Ctx, type FlowFrame, type FrameVariant, type IdKind, type TraceRow,
} from "./rowFlow";

export interface RowTrace {
  /** ctid when any frame follows real physical row ids; trace when every frame matches rows by content. */
  identity: IdKind;
  /** Aligned with `viz.stages`; a frame is always present for an executed stage (from the stage sample when rows could not be traced). */
  frames: (FlowFrame | undefined)[];
  notes: string[];
  /** Number of derived queries run (all read-only and rolled back). */
  queries: number;
}

/* ---------- aliases ---------- */

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const TABLE_RE = new RegExp(`^(?:ONLY\\s+)?(${IDENT}(?:\\.${IDENT})*)(?:\\s+(?:AS\\s+)?(${IDENT}))?$`, "i");
const NOT_ALIAS = /^(tablesample|natural|cross|left|right|full|inner|join|on|using|where|group|order|limit|lateral)$/i;

/** The alias a FROM item is known by, and whether it names a plain table (the only thing that has a ctid to ask for). */
export function aliasOf(source: string): { alias: string; table: boolean } | null {
  const s = source.trim().replace(/\s+USING\s*\([^)]*\)\s*$/i, "").trim();
  if (!s || /,/.test(s.replace(/\([^()]*\)/g, ""))) return null;
  const t = TABLE_RE.exec(s);
  if (t) {
    if (t[2] && NOT_ALIAS.test(t[2])) return null;
    const last = t[1].split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/).pop()!;
    return { alias: t[2] ?? last, table: true };
  }
  const sub = /^\(.*\)\s*(?:AS\s+)?(["\w$]+)$/is.exec(s);
  return sub && !NOT_ALIAS.test(sub[1]) ? { alias: sub[1], table: false } : null;
}

interface Spec { aliases: string[]; tables: boolean; parts: JoinPart[] }
export function specOf(p: ParsedQuery): Spec | null {
  if (!p.joins.length || p.joins[0].kind.includes("comma")) return null;
  const al = p.joins.map((j) => aliasOf(j.source));
  if (al.some((a) => !a)) return null;
  return { aliases: al.map((a) => a!.alias), tables: al.every((a) => a!.table), parts: p.joins };
}

/* ---------- decoding ---------- */

interface Dec { extras: unknown[]; objs: (Record<string, unknown> | null)[]; ctids: (string | null)[]; plain: unknown[] }
const asObj = (v: unknown): Record<string, unknown> | null => (v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : (v as Record<string, unknown>));

function decode(res: ExecuteResult, e: number, spec: Spec | null, nAlias: number, ctid: boolean): Dec[] {
  return res.rows.map((row) => {
    const extras = row.slice(0, e);
    if (!spec) return { extras, objs: [], ctids: [], plain: row.slice(e) };
    return { extras, objs: Array.from({ length: nAlias }, (_, k) => asObj(row[e + k])), ctids: ctid ? Array.from({ length: nAlias }, (_, k) => (row[e + nAlias + k] ?? null) as string | null) : [], plain: [] };
  });
}

/** Column names per alias, learned from the first non-NULL row so NULL-padded rows can still be drawn with the right width. */
type Cols = Map<string, string[]>;

/**
 * Turn decoded rows into TraceRows. `aliasIdx[j]` is the alias that decoded position j belongs to; `sel` picks the positions
 * that make up the row (all of them by default; a join draws its left and right sides separately).
 */
function rowsFrom(decs: Dec[], res: ExecuteResult, e: number, spec: Spec | null, ctid: boolean, cols: Cols, aliasIdx: number[], sel: number[] = aliasIdx.map((_, j) => j), counter = true): { columns: string[]; rows: TraceRow[] } {
  if (!spec) {
    const ids = traceIds(decs.map((d) => d.plain));
    return { columns: res.columns.slice(e), rows: decs.map((d, i) => ({ id: ids[i], cells: d.plain })) };
  }
  for (const d of decs) aliasIdx.forEach((k, j) => { const o = d.objs[j]; const a = spec.aliases[k]; if (o && !cols.has(a)) cols.set(a, Object.keys(o)); });
  const multi = spec.aliases.length > 1;
  const colsOf = (j: number) => cols.get(spec.aliases[aliasIdx[j]]) ?? [];
  const columns = sel.flatMap((j) => colsOf(j).map((c) => (multi ? `${spec.aliases[aliasIdx[j]]}.${c}` : c)));
  const cellList = decs.map((d) => sel.flatMap((j) => colsOf(j).map((c) => (d.objs[j] ? d.objs[j]![c] : null))));
  const ids = ctid ? decs.map((d) => ctidId(sel.map((j) => d.ctids[j] ?? null))) : counter ? traceIds(cellList) : cellList.map((c) => `t:${hashContent(c)}#1`);
  return { columns, rows: cellList.map((cells, i) => ({ id: ids[i], cells })) };
}

/* ---------- the trace ---------- */

const num = (s?: string) => (s !== undefined && /^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined);

export async function traceRows(sql: string, realRun: Run, viz: Visualization): Promise<RowTrace> {
  const stages = viz.stages;
  const out: RowTrace = { identity: "trace", frames: stages.map((s, i) => baseFrame(s, stages[i - 1], i)), notes: [], queries: 0 };
  const { volatileFunctions } = await import("../sqlAst");
  const volatile = volatileFunctions(sql);
  if (viz.unsupported || !stages.length) return out;
  if (volatile.length || viz.volatile?.length) {
    out.notes.push(`Your query uses ${(volatile.length ? volatile : viz.volatile!).join(", ")}, which return different values on each run, so no row-level query was run.`);
    return out;
  }
  const p = viz.parsed, c = p.clauses;
  if (!c.from) return out;
  const spec = specOf(p);
  let useCtid = Boolean(spec?.tables);
  let anyCtid = false;
  const run: Run = async (q) => { out.queries++; return realRun(q); };
  const cols: Cols = new Map();
  const allIdx = spec ? spec.aliases.map((_, i) => i) : [];
  const payload = (ctid: boolean, idx: number[] = allIdx) => !spec ? "*"
    : [...idx.map((k) => `to_json(${spec.aliases[k]}) AS _r${k}`), ...(ctid ? idx.map((k) => `${spec.aliases[k]}.ctid::text AS _c${k}`) : [])].join(", ");
  const withPrefix = p.with ? `${p.with}\n` : "";
  const stageOf = (clause: string) => stages.findIndex((s) => s.clause === clause && s.source === "executed" && !s.error && !s.setOp);
  const ident = (ctid: boolean): IdKind => (ctid ? "ctid" : "trace");
  const ctxFor = (i: number, ctid: boolean): Ctx => ({ stageIndex: i, clause: stages[i].clause, identity: ident(ctid), source: "trace" });
  const lastCount = (i: number) => { for (let k = i - 1; k >= 0; k--) { const s = stages[k]; if (s.clause !== "order by" && s.clause !== "limit" && s.rowsOut !== undefined) return s.rowsOut; } return undefined; };

  /** Try with ctid first; if that fails and the same query without it works, ctid was the problem for this source: stop asking. */
  const attempt = async (build: (ctid: boolean) => string): Promise<{ res: ExecuteResult; ctid: boolean } | null> => {
    if (useCtid) {
      const r = await run(build(true));
      if (r.success) { anyCtid = true; return { res: r, ctid: true }; }
      const r2 = await run(build(false));
      if (r2.success) { useCtid = false; return { res: r2, ctid: false }; }
      return null;
    }
    const r = await run(build(false));
    return r.success ? { res: r, ctid: false } : null;
  };
  const universe = (extras: string[], where: string | undefined, limit: number, extra: Partial<{ groupBy: string; having: string }> = {}) => (ctid: boolean) =>
    buildQuery(p, { select: [...extras, payload(ctid)].join(", "), from: c.from, where, limit: String(limit), ...extra });
  const guard = async (what: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { out.notes.push(`${what}: ${err instanceof Error ? err.message : String(err)}`); } };

  /* FROM */
  const iFrom = stageOf("from");
  if (iFrom >= 0) await guard("FROM", async () => {
    const st = stages[iFrom];
    if (spec && spec.parts.length > 1) {
      const variants: FrameVariant[] = [];
      let ctidUsed = false;
      for (let i = 1; i < Math.min(spec.parts.length, 5); i++) {
        const j = spec.parts[i], step = st.joins?.[i - 1];
        const leftText = spec.parts.slice(0, i).map((jp, k) => (k === 0 ? jp.source : `${jp.kind} ${jp.source}${jp.on ? ` ON ${jp.on}` : ""}`)).join("\n");
        const lIdx = Array.from({ length: i }, (_, k) => k), rIdx = [i], pairIdx = [...lIdx, i];
        const pairs = await attempt((ctid) => `${withPrefix}SELECT ${payload(ctid, pairIdx)}\nFROM ${leftText}\n${j.on ? "JOIN" : j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}\nLIMIT ${j.on ? 14 : 12}`);
        if (!pairs) continue;
        ctidUsed ||= pairs.ctid;
        const pd = decode(pairs.res, 0, spec, pairIdx.length, pairs.ctid);
        const L = rowsFrom(pd, pairs.res, 0, spec, pairs.ctid, cols, pairIdx, lIdx, false);
        const R = rowsFrom(pd, pairs.res, 0, spec, pairs.ctid, cols, pairIdx, [i], false);
        const matched: { left: TraceRow; right: TraceRow }[] = [];
        const unL: TraceRow[] = [], unR: TraceRow[] = [];
        pd.forEach((d, n) => {
          const leftNull = d.objs.slice(0, i).every((o) => o === null), rightNull = d.objs[i] === null;
          if (!j.on && rightNull && !leftNull) unL.push(L.rows[n]);
          else if (!j.on && leftNull && !rightNull) unR.push(R.rows[n]);
          else matched.push({ left: L.rows[n], right: R.rows[n] });
        });
        const fetchSide = async (sqlOf: (ctid: boolean) => string, idx: number[]) => {
          const r = await attempt(sqlOf);
          if (!r) return [] as TraceRow[];
          ctidUsed ||= r.ctid;
          return rowsFrom(decode(r.res, 0, spec, idx.length, r.ctid), r.res, 0, spec, r.ctid, cols, idx, undefined, false).rows;
        };
        if (j.on && step?.unmatchedLeft !== 0) unL.push(...await fetchSide((ctid) => `${withPrefix}SELECT ${payload(ctid, lIdx)}\nFROM ${leftText}\nWHERE NOT EXISTS (SELECT 1 FROM ${j.source} WHERE ${j.on})\nLIMIT 3`, lIdx));
        if (j.on && step?.unmatchedRight !== 0) unR.push(...await fetchSide((ctid) => `${withPrefix}SELECT ${payload(ctid, rIdx)}\nFROM ${j.source}\nWHERE NOT EXISTS (SELECT 1 FROM ${leftText} WHERE ${j.on})\nLIMIT 3`, rIdx));
        const lc = lIdx.flatMap((k) => (cols.get(spec.aliases[k]) ?? []).map((n) => (spec.aliases.length > 1 ? `${spec.aliases[k]}.${n}` : n)));
        const rc = (cols.get(spec.aliases[i]) ?? []).map((n) => `${spec.aliases[i]}.${n}`);
        variants.push(joinVariant({
          kind: j.kind, on: j.on, index: i - 1, label: `${j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}`, matched, unmatchedLeft: unL, unmatchedRight: unR, leftColumns: lc, rightColumns: rc,
          counts: { leftRows: step?.leftRows, rightRows: step?.rightRows, matchedPairs: step?.matchedPairs ?? (j.on ? undefined : step?.resultRows), unmatchedLeft: step?.unmatchedLeft, unmatchedRight: step?.unmatchedRight, resultRows: step?.resultRows },
        }));
      }
      if (variants.length) out.frames[iFrom] = joinFrame(ctxFor(iFrom, useCtid && variants.length > 0 && ctidUsed), variants);
      return;
    }
    const r = await attempt(universe([], undefined, SAMPLE));
    if (!r) return;
    const d = decode(r.res, 0, spec, allIdx.length, r.ctid);
    const rows = rowsFrom(d, r.res, 0, spec, r.ctid, cols, allIdx);
    const label = spec ? `rows of ${spec.parts[0].source}` : st.joins?.length ? "FROM result" : "Table rows";
    out.frames[iFrom] = scanFrame(ctxFor(iFrom, r.ctid), { rows: rows.rows, columns: rows.columns, total: st.rowsOut, label });
  });

  /* WHERE */
  const iWhere = stageOf("where");
  if (iWhere >= 0 && c.where) await guard("WHERE", async () => {
    const st = stages[iWhere];
    // Each row also carries what the predicate evaluated to: true stays, false and NULL (unknown) are removed.
    const verdict = `(${c.where})::text`;
    const kept = await attempt(universe([verdict], c.where, 12));
    if (!kept) return;
    const removed = await run(universe([verdict], `(${c.where}) IS NOT TRUE`, 8)(kept.ctid));
    if (!removed.success) return;
    const kd = decode(kept.res, 1, spec, allIdx.length, kept.ctid), rd = decode(removed, 1, spec, allIdx.length, kept.ctid);
    const all = rowsFrom([...kd, ...rd], kept.res, 1, spec, kept.ctid, cols, allIdx);
    [...kd, ...rd].forEach((d, i) => { all.rows[i].verdict = { value: verdictOf(d.extras[0]), detail: predicateDetail(c.where!, all.columns, all.rows[i].cells) }; });
    const keptRows = all.rows.slice(0, kd.length), removedRows = all.rows.slice(kd.length);
    const input = kept.ctid ? [...all.rows].sort((a, b) => ctidOrder(a.id, b.id)) : undefined;
    out.frames[iWhere] = filterFrame(ctxFor(iWhere, kept.ctid), { kept: keptRows, removed: removedRows, columns: all.columns, totalIn: st.rowsIn ?? stages[iFrom]?.rowsOut, totalOut: st.rowsOut, input, expr: c.where });
  });

  /* GROUP BY */
  const iGroup = stageOf("group by");
  const grouped = stages.some((s) => s.clause === "group by");
  const gexprs = c["group by"] ? splitTopLevel(c["group by"]) : [];
  const gUsable = gexprs.length > 0 && !gexprs.some((e) => /^\d+$/.test(e.trim()));
  if (iGroup >= 0 && (!c["group by"] || gUsable)) await guard("GROUP BY", async () => {
    const st = stages[iGroup];
    const r = await attempt(universe(gexprs.map((e) => `(${e})`), c.where, SAMPLE));
    if (!r) return;
    const e = gexprs.length;
    const d = decode(r.res, e, spec, allIdx.length, r.ctid);
    const rows = rowsFrom(d, r.res, e, spec, r.ctid, cols, allIdx);
    rows.rows.forEach((row, i) => { row.key = canon(d[i].extras); });
    const totals: Record<string, number> = {};
    if (c["group by"] && st.sample && st.sample.columns.length === e + 1) for (const sr of st.sample.rows) totals[canon(sr.slice(0, e))] = Number(sr[e]);
    if (!c["group by"]) totals["[]"] = st.rowsIn ?? 0;
    out.frames[iGroup] = groupFrame(ctxFor(iGroup, r.ctid), { rows: rows.rows, columns: rows.columns, keyNames: gexprs, totals: Object.keys(totals).length ? totals : undefined, totalIn: st.rowsIn, groupCount: st.rowsOut });
  });

  /* Aggregate values per group, for the GROUP BY and HAVING boards (every group, before HAVING removes any). */
  const AGG_ITEM = /\b(?:count|sum|avg|min|max|string_agg|array_agg|bool_and|bool_or|every|stddev|variance)\s*\(/i;
  const aggLabel = (item: string) => /\s+as\s+("[^"]+"|\w+)\s*$/i.exec(item)?.[1].replace(/"/g, "") ?? item.trim();
  if (grouped && c.select && (!c["group by"] || gUsable)) await guard("group aggregates", async () => {
    const items = splitTopLevel(c.select!).filter((it) => AGG_ITEM.test(it));
    if (!items.length) return;
    const r = await run(buildQuery(p, { select: [...items, ...gexprs.map((e) => `(${e})`)].join(", "), from: c.from, where: c.where, groupBy: c["group by"], limit: "500" }));
    if (!r.success) return;
    const calc = new Map<string, string>();
    for (const row of r.rows) calc.set(canon(row.slice(items.length)), items.map((it, i) => `${aggLabel(it)} = ${fmtCell(row[i])}`).join(", "));
    const g = iGroup >= 0 ? out.frames[iGroup] : undefined;
    for (const cardOf of g?.board?.cards ?? []) if (cardOf.id.startsWith("bucket:")) { const v = calc.get(cardOf.id.slice(7)); if (v) cardOf.calc = v; }
  });

  /* HAVING: every group is shown with the aggregates the condition looks at, and what the condition evaluated to. */
  const iHaving = stageOf("having");
  if (iHaving >= 0 && c.having && grouped && (!c["group by"] || gUsable)) await guard("HAVING", async () => {
    const st = stages[iHaving];
    const aggs = [...new Set(c.having!.match(/\b(?:count|sum|avg|min|max)\s*\((?:[^()]|\([^()]*\))*\)/gi) ?? [])].slice(0, 3);
    const keys = gexprs.map((e) => `(${e})`);
    const sel = [...keys, ...aggs, `(${c.having})::text`].join(", ");
    const q = (having: string, limit: number) => buildQuery(p, { select: sel, from: c.from, where: c.where, groupBy: c["group by"], having, limit: String(limit) });
    const kept = await run(q(c.having!, 12));
    const removed = await run(q(`(${c.having}) IS NOT TRUE`, 8));
    if (!kept.success || !removed.success) return;
    const columns = [...gexprs, ...aggs];
    const mk = (rows: unknown[][]): TraceRow[] => {
      const cellList = rows.map((row) => row.slice(0, columns.length));
      const ids = traceIds(cellList);
      return rows.map((row, i) => ({ id: ids[i], cells: cellList[i], verdict: { value: verdictOf(row[columns.length]), detail: predicateDetail(c.having!, columns, cellList[i]) } }));
    };
    const keptRows = mk(kept.rows), removedRows = mk(removed.rows);
    out.frames[iHaving] = filterFrame(ctxFor(iHaving, false), { kept: keptRows, removed: removedRows, columns, noun: "groups", totalIn: st.rowsIn, totalOut: st.rowsOut, expr: c.having });
  });

  /* SELECT (projection, or aggregation when grouped) and DISTINCT */
  const iSel = stageOf("select");
  const distinctOn = /^distinct\s+on\b/i.test(c.select ?? "");
  let distinctRows: TraceRow[] | undefined;
  let distinctCols: string[] = [];
  let distinctIdentity: IdKind = "trace";
  if (iSel >= 0 && c.select && !distinctOn && stages[iSel].sample?.columns.length && !(grouped && c["group by"] && !gUsable)) await guard("SELECT", async () => {
    const st = stages[iSel];
    const k = st.sample!.columns.length;
    if (grouped) {
      const e = gexprs.length;
      const q = buildQuery(p, { select: `${c.select}, ${gexprs.map((x) => `(${x})`).concat("COUNT(*)").join(", ")}`, from: c.from, where: c.where, groupBy: c["group by"], having: c.having, limit: String(SAMPLE) });
      const r = await run(q);
      if (!r.success) return;
      const cellList = r.rows.map((row) => row.slice(0, k));
      const ids = traceIds(cellList);
      const outputs: TraceRow[] = r.rows.map((row, i) => ({ id: ids[i], cells: cellList[i], key: canon(row.slice(k, k + e)) }));
      const counts: Record<string, number> = {};
      r.rows.forEach((row, i) => { counts[outputs[i].key!] = Number(row[k + e]); });
      const total = stages[iGroup]?.rowsIn;
      out.frames[iSel] = aggregateFrame(ctxFor(iSel, false), { outputs, counts, columns: st.sample!.columns, keyNames: gexprs, groupCount: st.rowsOut, totalIn: total });
      distinctRows = outputs; distinctCols = st.sample!.columns;
      return;
    }
    if (p.windows.length) return;
    const r = await attempt(universe([c.select!], c.where, SAMPLE));
    if (!r) return;
    const d = decode(r.res, k, spec, allIdx.length, r.ctid);
    const rows = rowsFrom(d, r.res, k, spec, r.ctid, cols, allIdx);
    rows.rows.forEach((row, i) => { row.after = d[i].extras; });
    out.frames[iSel] = projectFrame(ctxFor(iSel, r.ctid), { rows: rows.rows, columns: rows.columns, outColumns: st.sample!.columns, total: st.rowsOut });
    distinctRows = rows.rows; distinctCols = st.sample!.columns; distinctIdentity = ident(r.ctid);
  });
  const iDistinct = stageOf("distinct");
  if (iDistinct >= 0 && distinctRows?.length) {
    const st = stages[iDistinct];
    out.frames[iDistinct] = distinctFrame(ctxFor(iDistinct, (distinctIdentity as IdKind) === "ctid"), { rows: distinctRows, columns: distinctCols, totalIn: st.rowsIn, totalOut: st.rowsOut });
  }

  /* ORDER BY and LIMIT share one query: the first SAMPLE rows in sorted order, each with its position before the sort. */
  const iOrder = stages.findIndex((s) => s.clause === "order by");
  const iLimit = stages.findIndex((s) => s.clause === "limit");
  if ((iOrder >= 0 || iLimit >= 0) && c.select && !distinctOn && !(grouped && c["group by"] && !gUsable) && !stages.some((s) => s.error)) await guard("ORDER BY", async () => {
    const orderBy = c["order by"];
    const sel = c.select!;
    let rows: TraceRow[] = [];
    let columns: string[] = [];
    let hasPos = true;
    let ctid = false;
    if (p.distinct) {
      const inner = buildQuery(p, { select: `DISTINCT ${sel}`, from: c.from, where: c.where, groupBy: c["group by"], having: c.having });
      let r = await run(`SELECT *, ROW_NUMBER() OVER () AS _pos\nFROM (\n${inner}\n) AS _d${orderBy ? `\nORDER BY ${orderBy}` : ""}\nLIMIT ${SAMPLE}`);
      if (!r.success) { hasPos = false; r = await run(buildQuery(p, { select: `DISTINCT ${sel}`, from: c.from, where: c.where, groupBy: c["group by"], having: c.having, orderBy, limit: String(SAMPLE) })); }
      if (!r.success) return;
      const k = r.columns.length - (hasPos ? 1 : 0);
      const cells = r.rows.map((row) => row.slice(0, k));
      const ids = traceIds(cells);
      rows = r.rows.map((row, i) => ({ id: ids[i], cells: cells[i], pos: hasPos ? Number(row[k]) : undefined }));
      columns = r.columns.slice(0, k);
    } else {
      const r = await attempt((withCtid) => buildQuery(p, {
        select: `${sel}, ${withCtid && spec ? allIdx.map((k) => `${spec.aliases[k]}.ctid::text AS _c${k}`).join(", ") + ", " : ""}ROW_NUMBER() OVER () AS _pos`,
        from: c.from, where: c.where, groupBy: c["group by"], having: c.having, orderBy, limit: String(SAMPLE),
      }));
      if (!r) return;
      // Source row ids only mean something when each output row is exactly one source row.
      ctid = r.ctid && !grouped;
      const nId = r.ctid && spec ? allIdx.length : 0;
      const k = r.res.columns.length - 1 - nId;
      const cells = r.res.rows.map((row) => row.slice(0, k));
      const ids = ctid ? r.res.rows.map((row) => ctidId(row.slice(k, k + nId) as (string | null)[])) : traceIds(cells);
      rows = r.res.rows.map((row, i) => ({ id: ids[i], cells: cells[i], pos: Number(row[k + nId]) }));
      columns = r.res.columns.slice(0, k);
    }
    const total = lastCount(iOrder >= 0 ? iOrder : iLimit);
    if (iOrder >= 0) out.frames[iOrder] = sortFrame(ctxFor(iOrder, ctid), { rows, columns, total, orderBy, hasPositions: hasPos });
    if (iLimit >= 0) {
      const lim = num(c.limit), off = num(c.offset);
      if ((c.limit === undefined || lim !== undefined) && (c.offset === undefined || off !== undefined)) {
        out.frames[iLimit] = limitFrame(ctxFor(iLimit, ctid), { rows, columns, limit: lim, offset: off, total });
      }
    }
  });

  out.identity = anyCtid ? "ctid" : "trace";
  return out;
}
