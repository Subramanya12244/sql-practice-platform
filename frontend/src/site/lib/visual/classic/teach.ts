/**
 * Teaching text and intermediate tables for the SQL Practice visualizer. OWNER: Agent 2 (SQL execution visualization and teaching logic).
 *
 * `buildTeach(viz, trace, stageIndex)` turns one logical stage into a TeachCard: the input tables, the operation in the learner's own
 * words, what changed, why, what to remember, the output tables, exact row counts and notes (NULL handling, sample limits, what could not
 * be fetched). It is synchronous and pure: every number and value comes from `viz.stages` (stage counts and samples) and, when it has
 * arrived, from `trace.teach` (rowTrace.ts: real rows read-only from the database). Without a trace the card is still correct; with it,
 * the card gains the per-row detail. Nothing is invented: what could not be fetched is said in `notes`.
 *
 * Logical order: stages follow SQL's logical processing order (FROM, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT). Every card says so
 * ("Logical step n of m") and never presents it as PostgreSQL's physical plan.
 */
import type { JoinStep, Stage, Visualization } from "../../visualize";
import type { ParsedQuery } from "../../sqlClauses";
import type { RowTrace } from "./rowTrace";
import type { TableSnapshot, TeachCard, TeachKind } from "./contract";
import type { CteData, JoinData, SubqueryData, TeachData } from "./teachData";
import { fmtCell, keyLabel, splitTopLevel, type FlowFrame, type TraceRow } from "./rowFlow";
import { aggLabel, findAggCalls, firstCalc, shapeSentence, workedLines, shownColumns, type AggCall, type AggGroupData } from "./aggregate";
import { isRankFn, windowTies } from "./windows";
import { kindWord } from "./relations";
import { nullsWord, tieRuns, keyText } from "./order";

const RAIL: Record<Stage["clause"], { label: string; kind: TeachKind }> = {
  from: { label: "FROM", kind: "from" }, where: { label: "WHERE", kind: "where" }, "group by": { label: "GROUP BY", kind: "group" },
  having: { label: "HAVING", kind: "having" }, window: { label: "WINDOW", kind: "window" }, select: { label: "SELECT", kind: "select" },
  distinct: { label: "DISTINCT", kind: "distinct" }, "order by": { label: "ORDER BY", kind: "order" }, limit: { label: "LIMIT", kind: "limit" },
  union: { label: "UNION", kind: "setop" }, intersect: { label: "INTERSECT", kind: "setop" }, except: { label: "EXCEPT", kind: "setop" },
};

/* ---------- small helpers ---------- */

const num = (n: number | undefined) => (n === undefined ? "?" : n.toLocaleString("en-US"));
const rows = (n: number | undefined, one = "row") => (n === undefined ? `rows` : `${num(n)} ${n === 1 ? one : `${one}s`}`);
const one = (s: string, max = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const describe = (columns: string[], cells: unknown[], max = 4) => cells.slice(0, max).map((v, i) => `${columns[i] ?? `col${i + 1}`} = ${fmtCell(v)}`).join(", ") + (cells.length > max ? ", …" : "");
const cap = <T,>(a: T[], n: number) => a.slice(0, n);
const join = (parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(" ");

const snap = (title: string, role: TableSnapshot["role"], columns: string[], data: unknown[][], total?: number, max = 20): TableSnapshot[] =>
  columns.length ? [{ title, role, columns, rows: data.slice(0, max), total }] : [];
const snapOf = (title: string, role: TableSnapshot["role"], s: Stage["sample"], total?: number, max = 20): TableSnapshot[] => (s && s.columns.length ? snap(title, role, s.columns, s.rows, total, max) : []);

interface Ctx {
  viz: Visualization;
  trace: RowTrace | undefined;
  td: TeachData | undefined;
  i: number;
  st: Stage;
  prev: Stage | undefined;
  n: number;
  p: ParsedQuery;
  c: ParsedQuery["clauses"];
  /** Rows entering this stage, exact when known. */
  rowsIn: number | undefined;
  notes: string[];
}
type Part = Partial<Omit<TeachCard, "stageIndex" | "provenance">>;

/** The count of rows leaving the closest earlier stage that has one (ORDER BY and LIMIT carry the previous count along). */
function countBefore(viz: Visualization, i: number): number | undefined {
  for (let k = i - 1; k >= 0; k--) {
    const s = viz.stages[k];
    if (s.clause !== "order by" && s.clause !== "limit" && s.rowsOut !== undefined) return s.rowsOut;
  }
  return undefined;
}

const NO_TRACE = "The row-level detail for this step is still loading; the card shows the stage's own counts and rows, and fills in when it arrives.";

/* ---------- CTEs and subqueries as inputs of the step that reads them ---------- */

function relationParts(x: Ctx, clause: "from" | "where" | "having" | "select"): { tables: TableSnapshot[]; lines: string[]; notes: string[] } {
  const out = { tables: [] as TableSnapshot[], lines: [] as string[], notes: [] as string[] };
  const td = x.td;
  if (!td) return out;
  const ctes: CteData[] = (td.ctes ?? []).filter((e) => e.firstClause === clause);
  for (const e of ctes) {
    if (e.error) { out.notes.push(`CTE ${e.name} could not be run on its own: ${e.error}`); continue; }
    out.tables.push(...snap(`CTE ${e.name} · ${rows(e.total)}`, "input", e.columns, e.rows, e.total));
    out.lines.push(`CTE ${e.name} is read here: its own result has ${rows(e.total)}${e.rows[0] ? ` (first: ${describe(e.columns, e.rows[0])})` : ""}.`);
  }
  if (clause === "from" && td.unusedCtes?.length) out.notes.push(`CTE ${td.unusedCtes.join(", ")} is defined but nothing reads it: PostgreSQL never evaluates an unused CTE.`);
  const subs: SubqueryData[] = (td.subqueries ?? []).filter((s) => s.ref.clause === clause);
  for (const s of subs) {
    const label = `${kindWord(s.ref)} (${one(s.ref.sql, 70)})`;
    if (s.error) {
      out.notes.push(s.correlated
        ? `The ${label} uses columns of the outer row (a correlated subquery), so it has no single result of its own: PostgreSQL evaluates it again for each outer row.`
        : `The ${label} could not be run on its own: ${s.error}`);
      continue;
    }
    out.tables.push(...snap(`${kindWord(s.ref)} result · ${rows(s.total)}`, "input", s.columns, s.rows, s.total));
    const first = s.rows[0]?.[0];
    const list = s.rows.slice(0, 5).map((r) => fmtCell(r[0])).join(", ");
    if (s.ref.kind === "scalar") {
      out.lines.push(s.rows.length === 0 ? `The ${label} returned no rows, so its value is NULL.` : s.rows.length === 1 ? `The ${label} returned one value: ${fmtCell(first)}. It is computed once and used as a constant here.` : `The ${label} returned ${rows(s.total)}, but a scalar subquery may return at most one row, so PostgreSQL raises an error.`);
      if (s.rows.length === 1 && first === null) out.notes.push("The scalar subquery returned NULL, so a comparison with it is unknown (NULL), not true: the rows it was meant to keep are removed.");
    } else if (s.ref.kind === "exists") {
      out.lines.push(`The ${label} returned ${rows(s.total)}, so ${s.ref.negated ? "NOT " : ""}EXISTS is ${(s.total ?? 0) > 0 !== s.ref.negated ? "true" : "false"} (EXISTS only asks whether at least one row exists, never what is in it).`);
    } else {
      out.lines.push(`The ${label} returned ${rows(s.total, "value")}${list ? `: ${list}${(s.total ?? 0) > 5 ? ", …" : ""}` : ""}. A row passes when its value is ${s.ref.negated ? "not " : ""}in this list.`);
      if (s.rows.some((r) => r[0] === null)) out.notes.push(s.ref.negated
        ? "The subquery's list contains NULL, so NOT IN can never be true (a value is never provably 'not equal to NULL'): no row passes. Use NOT EXISTS or filter the NULLs out."
        : "The subquery's list contains NULL; a NULL in the list never matches anything, so it adds no rows.");
    }
  }
  return out;
}

/* ---------- FROM and JOIN ---------- */

/** `a.x = b.y AND c = d` as `a.x = b.y, c = d` when the ON condition is only equalities. */
function matchKeys(on: string | undefined): string | undefined {
  if (!on) return undefined;
  const parts = on.split(/\s+and\s+/i).map((s) => s.trim());
  return parts.every((s) => /^[\w."]+\s*=\s*[\w."]+$/.test(s)) ? parts.join(", ") : undefined;
}

const isKeepLeft = (k: string) => /LEFT|FULL/i.test(k);
const isKeepRight = (k: string) => /RIGHT|FULL/i.test(k);

function joinLine(j: JoinStep, idx: number, total: number, jd: JoinData | undefined): { text: string; fanOut: boolean } {
  const k = j.kind.toUpperCase();
  const head = `Join ${idx + 1} of ${total}: ${j.kind} ${one(j.right, 50)}${j.on ? ` ON ${one(j.on, 60)}` : ""}`;
  const keys = matchKeys(j.on);
  const bits: string[] = [];
  bits.push(`${rows(j.leftRows)} on the left meet ${rows(j.rightRows)} on the right`);
  let fanOut = false;
  if (k.includes("CROSS")) bits.push(`with no condition every left row pairs with every right row: ${num(j.leftRows)} × ${num(j.rightRows)} = ${rows(j.resultRows)}`);
  else {
    if (keys) bits.push(`rows match where ${keys}`);
    else if (j.on) bits.push(`rows match where ${one(j.on, 80)} is true`);
    if (j.matchedPairs !== undefined) bits.push(`${rows(j.matchedPairs, "pair")} match`);
    if (j.matchedPairs !== undefined && j.leftRows !== undefined && j.matchedPairs > j.leftRows && !isKeepRight(k) || (isKeepRight(k) && !isKeepLeft(k) && j.matchedPairs !== undefined && j.rightRows !== undefined && j.matchedPairs > j.rightRows)) {
      fanOut = true;
      bits.push(`fan-out: ${num(j.matchedPairs)} pairs come from ${rows(isKeepRight(k) && !isKeepLeft(k) ? j.rightRows : j.leftRows)}, so a row with several partners repeats once per partner${jd?.maxMatches && jd.maxMatches > 1 ? ` (up to ${jd.maxMatches} partners among the drawn rows)` : ""}`);
    }
    if (j.unmatchedLeft) bits.push(`${rows(j.unmatchedLeft, "left row")} found no partner and ${isKeepLeft(k) ? "stay with NULLs for the right columns" : "are dropped"}`);
    if (j.unmatchedRight) bits.push(`${rows(j.unmatchedRight, "right row")} found no partner and ${isKeepRight(k) ? "stay with NULLs for the left columns" : "are dropped"}`);
    if (j.resultRows !== undefined) bits.push(`result: ${rows(j.resultRows)}`);
  }
  return { text: `${head}: ${bits.join("; ")}.`, fanOut };
}

function fromCard(x: Ctx): Part {
  const { st, c } = x;
  const parts = x.p.joins;
  const rel = relationParts(x, "from");
  const td = x.td;
  const notes = [...rel.notes];
  if (!c.from) {
    return {
      operation: "No FROM: the SELECT list is evaluated once.", what: "There is no FROM clause, so there are no source tables: PostgreSQL evaluates the SELECT list exactly once and produces one row.",
      changed: "One row is produced from nothing.", why: "Expressions such as SELECT 1 + 1 do not need a table.", remember: "Without FROM, the result is always exactly one row (before any LIMIT).", inputs: [], outputs: x.viz.final ? snap("the one row", "output", x.viz.final.columns, x.viz.final.rows, x.viz.final.rowCount) : [], notes,
    };
  }
  const joins = st.joins ?? [];
  const sources = td?.sources ?? [];
  const inputs: TableSnapshot[] = [...rel.tables];
  const cteNames = new Set((td?.ctes ?? []).filter((e) => e.firstClause === "from").map((e) => e.name.replace(/^"|"$/g, "").toLowerCase()));
  for (const s of sources) {
    if (cteNames.has(s.source.trim().split(/\s+/)[0].replace(/^"|"$/g, "").toLowerCase()) && sources.length === 1) continue;
    if (s.error) { notes.push(`${s.source}: its rows could not be fetched (${s.error}).`); continue; }
    inputs.push(...snap(`${one(s.source, 50)} · ${rows(s.total)}${s.total !== undefined && s.total > 5 ? ", first 5" : ""}`, "input", s.columns, s.rows, s.total, 5));
  }
  const isJoin = joins.length > 0;
  if (isJoin) {
    const total = joins.length;
    const lines = joins.map((j, k) => joinLine(j, k, total, td?.joins?.find((d) => d.index === k)));
    const last = joins[total - 1];
    const outputs: TableSnapshot[] = [];
    const sampleCols = st.sample?.columns ?? [];
    if (td?.joins?.length) {
      for (const jd of cap(td.joins, 4)) {
        const keepL = isKeepLeft(jd.kind), keepR = isKeepRight(jd.kind);
        const cols = [...jd.leftColumns, ...jd.rightColumns];
        const nullsR = jd.rightColumns.map(() => null), nullsL = jd.leftColumns.map(() => null);
        const body: unknown[][] = [
          ...cap(jd.matched, 4).map((m) => [...m.left, ...m.right]),
          ...(keepL ? cap(jd.unmatchedLeft, 3).map((l) => [...l, ...nullsR]) : []),
          ...(keepR ? cap(jd.unmatchedRight, 3).map((r) => [...nullsL, ...r]) : []),
        ];
        outputs.push(...snap(`${total > 1 ? `result of join ${jd.index + 1}` : "result of the join"}: ${one(jd.label, 60)} · ${rows(jd.counts.resultRows)}`, "output", cols, body, jd.counts.resultRows, 7));
        if (!keepL && jd.unmatchedLeft.length) outputs.push(...snap(`left rows with no partner, dropped by ${jd.kind} (${rows(jd.counts.unmatchedLeft, "row")})`, "removed", jd.leftColumns, jd.unmatchedLeft, jd.counts.unmatchedLeft, 3));
        if (!keepR && jd.unmatchedRight.length) outputs.push(...snap(`right rows with no partner, dropped by ${jd.kind} (${rows(jd.counts.unmatchedRight, "row")})`, "removed", jd.rightColumns, jd.unmatchedRight, jd.counts.unmatchedRight, 3));
        if (keepL && jd.unmatchedLeft.length) notes.push(`${jd.kind} keeps the ${rows(jd.counts.unmatchedLeft ?? jd.unmatchedLeft.length, "left row")} that found no partner, once each, with NULL in every column of ${one(jd.source, 40)}. NULL here means "no matching row", not a stored value; \`WHERE <right column> IS NULL\` finds exactly these rows.`);
        if (keepR && jd.unmatchedRight.length) notes.push(`${jd.kind} keeps the ${rows(jd.counts.unmatchedRight ?? jd.unmatchedRight.length, "right row")} that found no partner, with NULL in every column from the left side.`);
      }
    } else outputs.push(...snapOf(`result of FROM + JOIN · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut));
    if (td?.joins && joins.length > td.joins.length) notes.push(`${rows(joins.length - td.joins.length, "join")} could not be drawn row by row; their counts above are exact.`);
    if (lines.some((l) => l.fanOut)) notes.push("Fan-out: after this join there are more rows than the left table had. Aggregating now would count or add the repeated rows once per partner.");
    if (joins.length > 4) notes.push("Only the first 4 joins are drawn as tables; every join's counts are in the text.");
    if (!td && x.trace === undefined) notes.push(NO_TRACE);
    if (sources.length === 0 && td) notes.push("The source tables' own rows could not be fetched; the join counts are exact.");
    return {
      kind: "join", label: "FROM + JOIN",
      operation: `FROM ${one(parts[0].source, 50)} ${parts.slice(1).map((j) => `${j.kind} ${one(j.source, 40)}`).join(" ")}: combine the tables into one working set.`,
      what: join([
        ...lines.map((l) => l.text),
        rel.lines.join(" "),
      ]),
      changed: `${total > 1 ? `After all ${total} joins` : "After the join"}, the working set has ${rows(st.rowsOut)} (${sampleCols.length} columns, from ${parts.length} tables), up from ${rows(joins[0].leftRows)} in ${one(parts[0].source, 30)}${last.resultRows !== undefined && joins[0].leftRows !== undefined && last.resultRows !== joins[0].leftRows ? `: ${last.resultRows > joins[0].leftRows ? "+" : ""}${num(last.resultRows - joins[0].leftRows)} rows` : ""}.`,
      why: `A join builds one row for every pair of rows that satisfies its condition, so columns that live in different tables sit side by side and can be filtered, grouped and aggregated together.`,
      remember: `The ON condition decides which rows pair up. INNER JOIN drops rows without a partner; LEFT/RIGHT/FULL JOIN keep them with NULLs. Always compare the row count before and after a join: more rows means fan-out. (Logical order: PostgreSQL may join in another order.)`,
      inputs, outputs, rowsIn: joins[0].leftRows, rowsOut: st.rowsOut, notes,
    };
  }
  // One source (a table, a CTE, a derived table) or an implicit comma join.
  const comma = parts[0]?.kind.includes("comma");
  const first = st.sample?.rows[0];
  const srcName = one(c.from, 60);
  if (!td && x.trace === undefined) notes.push(NO_TRACE);
  if (comma && sources.length > 1) {
    const prodText = sources.map((s) => num(s.total)).join(" × ");
    return {
      kind: "join", label: "FROM (comma join)",
      operation: `FROM ${srcName}: a comma between tables is an implicit CROSS JOIN.`,
      what: `${sources.map((s) => `${one(s.source, 30)} has ${rows(s.total)}`).join(" and ")}. With a comma and no join condition every row pairs with every row: ${prodText} = ${rows(st.rowsOut)}.${rel.lines.length ? ` ${rel.lines.join(" ")}` : ""}`,
      changed: `${rows(st.rowsOut)} leave FROM, one per combination of rows. Nothing has been filtered yet.`,
      why: "FROM lists the relations the query reads. Without a join condition the result is every combination, which is rarely what you want.",
      remember: "A comma join needs a WHERE condition that links the tables (the same job as ON); otherwise the row count multiplies. Prefer explicit JOIN ... ON.",
      inputs, outputs: snapOf(`combined rows · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut), rowsIn: undefined, rowsOut: st.rowsOut, notes: notes.filter(Boolean),
    };
  }
  const isDerived = /^\(\s*(select|with)\b/i.test(c.from.trim());
  const cteHere = (td?.ctes ?? []).filter((e) => e.firstClause === "from");
  return {
    operation: `FROM ${srcName}: read the rows of ${isDerived ? "the derived table" : cteHere.length ? `the CTE ${cteHere.map((e) => e.name).join(", ")}` : "the table"}.`,
    what: join([
      `FROM ${srcName} supplies ${rows(st.rowsOut)} with ${st.sample?.columns.length ?? "?"} columns${st.sample?.columns.length ? ` (${st.sample.columns.slice(0, 6).join(", ")}${st.sample.columns.length > 6 ? ", …" : ""})` : ""}.`,
      first && st.sample ? `First row: ${describe(st.sample.columns, first)}.` : "",
      rel.lines.join(" "),
    ]),
    changed: `Nothing is filtered or computed yet: ${rows(st.rowsOut)} enter the pipeline, exactly the rows of the source.${(st.rowsOut ?? 0) > (st.sample?.rows.length ?? 0) ? ` The first ${st.sample?.rows.length} are shown; the count is exact.` : ""}`,
    why: "Every query starts by choosing the relation it works on. Later steps (WHERE, GROUP BY, SELECT ...) only ever see the rows FROM produced.",
    remember: "FROM comes first in SQL's logical processing order, whatever order you write the clauses in. (Logical order, not PostgreSQL's physical plan: the planner may read tables in a different order, use an index or skip columns nothing needs.)",
    inputs, outputs: snapOf(`rows leaving FROM · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut), rowsIn: undefined, rowsOut: st.rowsOut, notes: notes.filter(Boolean),
  };
}

/* ---------- WHERE and HAVING ---------- */

const withVerdict = (columns: string[], list: TraceRow[], head: string): { columns: string[]; data: unknown[][] } => ({
  columns: [...columns, head],
  data: list.map((r) => [...r.cells, r.verdict?.value ?? ""]),
});

function outcomeText(counts: { true: number; false: number; null: number } | undefined, noun: string): string {
  if (!counts) return "";
  return `${num(counts.true)} ${noun} give true, ${num(counts.false)} give false${counts.null ? `, ${num(counts.null)} give NULL (unknown)` : ""}`;
}

function whereCard(x: Ctx): Part {
  const { st, c } = x;
  const w = x.td?.where;
  const rel = relationParts(x, "where");
  const notes = [...rel.notes];
  const rin = x.rowsIn;
  const removed = rin !== undefined && st.rowsOut !== undefined ? rin - st.rowsOut : undefined;
  const inputs: TableSnapshot[] = [...rel.tables];
  const outputs: TableSnapshot[] = [];
  let example = "";
  if (w) {
    const tested = [...w.kept, ...w.removed];
    const v = withVerdict(w.columns, tested, "WHERE result");
    inputs.push(...snap(`rows tested by ${one(w.expr, 50)} · ${rows(rin)}, ${tested.length} shown with their result`, "input", v.columns, v.data, rin, 20));
    const kv = withVerdict(w.columns, w.kept, "WHERE result");
    outputs.push(...snap(`kept (true) · ${rows(st.rowsOut)}`, "output", kv.columns, kv.data, st.rowsOut, 12));
    const rv = withVerdict(w.columns, w.removed, "WHERE result");
    outputs.push(...snap(`removed (false or NULL) · ${rows(removed)}`, "removed", rv.columns, rv.data, removed, 8));
    const r0 = w.removed[0], k0 = w.kept[0];
    example = join([
      k0?.verdict ? `For example ${k0.verdict.detail ?? "a row"} gives ${k0.verdict.value}, so that row stays.` : "",
      r0?.verdict ? `${r0.verdict.detail ?? "A row"} gives ${r0.verdict.value}, so that row is removed.` : "",
    ]);
    if (w.counts && w.counts.null > 0) {
      const nullRow = w.removed.find((r) => r.verdict?.value === "NULL");
      notes.push(`${num(w.counts.null)} ${w.counts.null === 1 ? "row evaluates" : "rows evaluate"} to NULL (unknown), not true${nullRow?.verdict?.detail ? `, for example ${nullRow.verdict.detail}` : ""}. WHERE keeps only true, so NULL rows are removed together with the false ones. A comparison with NULL (even \`= NULL\`) is never true: test with IS NULL / IS NOT NULL.`);
    }
  } else {
    outputs.push(...snapOf(`kept · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut, 12));
    if (st.removed) outputs.push(...snapOf(`removed (false or NULL) · ${rows(removed)}`, "removed", st.removed, removed, 5));
    if (x.trace === undefined) notes.push(`${NO_TRACE} The per-row true / false / NULL result arrives with it.`);
    else if (!w) notes.push("The per-row results of the condition could not be fetched; the kept and removed rows come from the stage's own queries.");
  }
  if (/=\s*null\b|<>\s*null\b|!=\s*null\b/i.test(c.where ?? "")) notes.push("This condition compares with NULL using = or <>. That is never true (the result is unknown), so it removes every row; write IS NULL or IS NOT NULL instead.");
  const counts = w?.counts;
  return {
    operation: `WHERE ${one(c.where ?? "", 80)}: keep a row only when this condition is true.`,
    what: join([
      `WHERE ${one(c.where ?? "", 100)} is tested once for each of the ${rows(rin)} that FROM produced.`,
      counts ? `${outcomeText(counts, rin === 1 ? "row" : "rows")}.` : "",
      example, rel.lines.join(" "),
    ]),
    changed: `${num(rin)} → ${num(st.rowsOut)} rows: ${rows(removed)} removed${counts ? ` (${num(counts.false)} false${counts.null ? `, ${num(counts.null)} NULL` : ""})` : ""}. The columns are unchanged: WHERE removes whole rows, it never edits one.`,
    why: "Rows that fail the condition can never contribute to a group, a sum or the output, so they are discarded first. Filtering before grouping also means less work later.",
    remember: "Only true keeps a row: false and NULL both remove it. WHERE runs before GROUP BY and SELECT, so it cannot use aggregates (use HAVING) or SELECT aliases.",
    inputs, outputs, rowsIn: rin, rowsOut: st.rowsOut, notes,
  };
}

function havingCard(x: Ctx): Part {
  const { st, c } = x;
  const h = x.td?.having;
  const rel = relationParts(x, "having");
  const notes = [...rel.notes];
  const rin = x.rowsIn;
  const removed = rin !== undefined && st.rowsOut !== undefined ? rin - st.rowsOut : undefined;
  const inputs: TableSnapshot[] = [];
  const outputs: TableSnapshot[] = [...rel.tables];
  let example = "";
  if (h) {
    const keyN = c["group by"] ? splitTopLevel(c["group by"]).length : 0;
    const say = (r: TraceRow) => `Group ${keyN ? keyText(r.cells.slice(0, keyN)) : "(all rows)"}: ${describe(h.columns.slice(keyN), r.cells.slice(keyN), 3)} gives ${r.verdict?.value}`;
    const tested = [...h.kept, ...h.removed];
    const v = withVerdict(h.columns, tested, "HAVING result");
    inputs.push(...snap(`groups tested by ${one(h.expr, 50)} · ${rows(rin, "group")}, ${tested.length} shown with their result`, "input", v.columns, v.data, rin, 20));
    const kv = withVerdict(h.columns, h.kept, "HAVING result"), rv = withVerdict(h.columns, h.removed, "HAVING result");
    outputs.push(...snap(`groups kept · ${rows(st.rowsOut, "group")}`, "output", kv.columns, kv.data, st.rowsOut, 12));
    outputs.push(...snap(`groups removed · ${rows(removed, "group")}`, "removed", rv.columns, rv.data, removed, 8));
    const k0 = h.kept[0], r0 = h.removed[0];
    example = join([k0?.verdict ? `${say(k0)}, so the group stays.` : "", r0?.verdict ? `${say(r0)}, so the whole group is removed.` : ""]);
    if (h.counts?.null) notes.push(`${num(h.counts.null)} ${h.counts.null === 1 ? "group evaluates" : "groups evaluate"} to NULL (unknown) for this condition; HAVING keeps only true, so they are removed like the false ones.`);
  } else {
    outputs.push(...snapOf(`groups kept · ${rows(st.rowsOut, "group")}`, "output", st.sample, st.rowsOut, 12));
    if (st.removed) outputs.push(...snapOf(`groups removed · ${rows(removed, "group")}`, "removed", st.removed, removed, 5));
    notes.push(x.trace === undefined ? `${NO_TRACE} The aggregate values and the true / false result per group arrive with it.` : "The aggregate values per group could not be fetched; the kept and removed groups come from the stage's own queries.");
  }
  return {
    operation: `HAVING ${one(c.having ?? "", 80)}: keep a group only when this condition is true.`,
    what: join([`After grouping, HAVING ${one(c.having ?? "", 100)} is tested once for each of the ${rows(rin, "group")}.`, h?.counts ? `${outcomeText(h.counts, rin === 1 ? "group" : "groups")}.` : "", example, rel.lines.join(" ")]),
    changed: `${num(rin)} → ${num(st.rowsOut)} groups: ${rows(removed, "group")} removed together with all their rows. Each surviving group is unchanged.`,
    why: "An aggregate such as COUNT(*) or SUM(...) only has a value after the rows were grouped, so a condition on it cannot go into WHERE. HAVING is the filter that runs after aggregation.",
    remember: "WHERE filters rows before grouping; HAVING filters groups after aggregation. HAVING may use aggregates, WHERE may not.",
    inputs, outputs, rowsIn: rin, rowsOut: st.rowsOut, notes,
  };
}

/* ---------- GROUP BY ---------- */

function groupCard(x: Ctx): Part {
  const { st, c } = x;
  const key = c["group by"];
  const rin = x.rowsIn;
  const g = x.td?.group;
  const notes: string[] = [];
  const s = st.sample;
  const inputs: TableSnapshot[] = [];
  const outputs: TableSnapshot[] = [];
  if (!key) {
    outputs.push(...snap(`the one group · ${rows(rin)}`, "output", ["group", "rows_in_group"], rin !== undefined ? [["all rows", rin]] : [], 1));
    return {
      label: "ONE GROUP", kind: "group",
      operation: "No GROUP BY: all rows form one group.",
      what: `The SELECT list uses an aggregate and there is no GROUP BY, so the ${rows(rin)} that survived form a single group; the aggregate will be computed over all of them.`,
      changed: `${num(rin)} rows → 1 group. The result will have exactly one row, even when ${rin === 0 ? "no row survived (COUNT gives 0, the other aggregates NULL)" : "many rows went in"}.`,
      why: "An aggregate needs a group to work on; without GROUP BY the whole result is that group.",
      remember: "An aggregate without GROUP BY always returns exactly one row, even over zero rows: COUNT(*) is 0 and SUM, AVG, MIN, MAX are NULL.",
      inputs, outputs, rowsIn: rin, rowsOut: 1, notes: (rin === 0 ? ["No row reached the group (every row was removed earlier): SUM, AVG, MIN and MAX are NULL, COUNT is 0."] : []),
    };
  }
  const keyNames = s?.columns.slice(0, -1) ?? [];
  if (g) {
    const sorted = [...g.rows].sort((a, b) => (a.key ?? "") < (b.key ?? "") ? -1 : (a.key ?? "") > (b.key ?? "") ? 1 : 0);
    inputs.push(...snap(`rows entering GROUP BY with their group key · first ${sorted.length} of ${num(rin)}`, "input", [`key: ${g.keyNames.join(", ")}`, ...g.columns], sorted.map((r) => [keyLabel(r.key ?? "[]"), ...r.cells]), rin, 20));
  } else if (x.trace === undefined) notes.push(`${NO_TRACE} The member rows of each group arrive with it.`);
  if (s?.rows.length) outputs.push(...snapOf(`groups · ${rows(st.rowsOut, "group")}${(st.rowsOut ?? 0) > s.rows.length ? `, the ${s.rows.length} largest shown` : ""}`, "output", s, st.rowsOut, 20));
  const sizes = s?.rows.map((r) => ({ key: r.slice(0, -1), n: Number(r[r.length - 1]) })) ?? [];
  const all = (st.rowsOut ?? Infinity) <= sizes.length;
  const top = sizes.slice(0, 3).map((z) => `${keyText(z.key)} (${num(z.n)} rows)`).join(", ");
  const small = all && sizes.length > 1 ? sizes[sizes.length - 1] : undefined;
  const nullGroup = sizes.find((z) => z.key.some((v) => v === null));
  if (nullGroup) notes.push(`GROUP BY treats NULLs as equal: the ${rows(nullGroup.n)} whose ${keyNames.join(", ") || key} is NULL form one group of their own (shown as NULL), not ${nullGroup.n} separate groups.`);
  if ((st.rowsOut ?? 0) > (s?.rows.length ?? 0)) notes.push(`Only the ${s?.rows.length} largest of ${num(st.rowsOut)} groups are listed; the group count is exact.`);
  return {
    operation: `GROUP BY ${one(key, 80)}: rows with the same ${one(key, 40)} fall into one group.`,
    what: join([
      `The ${rows(rin)} gather into ${rows(st.rowsOut, "group")} by ${one(key, 60)}.`,
      top ? `Largest groups: ${top}${(st.rowsOut ?? 0) > 3 ? ", …" : ""}.` : "",
      small ? `Smallest: ${keyText(small.key)} with ${rows(small.n)}.` : "",
    ]),
    changed: `${num(rin)} rows → ${num(st.rowsOut)} groups. No aggregate has been computed yet: each group still holds its member rows${rin !== undefined && st.rowsOut ? ` (on average ${(rin / st.rowsOut).toLocaleString("en-US", { maximumFractionDigits: 1 })} rows per group)` : ""}.`,
    why: "Aggregates such as COUNT or SUM need to know which rows belong together. GROUP BY makes those buckets; the next steps produce one result per bucket.",
    remember: "Every column in SELECT must be a GROUP BY column or sit inside an aggregate. The number of groups, not the number of rows, is the number of result rows.",
    inputs, outputs, rowsIn: rin, rowsOut: st.rowsOut, notes,
  };
}

/* ---------- aggregation (the SELECT of a grouped query) ---------- */

const callWord = (k: AggCall) => (k.star ? `${k.fn.toUpperCase()}(*)` : `${k.fn.toUpperCase()}(${k.distinct ? "DISTINCT " : ""}${one(k.arg, 50)})`);

function aggFnSentence(k: AggCall, g: AggGroupData, ci: number): string {
  const r = g.calls[ci];
  const word = callWord(k);
  switch (k.fn) {
    case "count": return k.star ? `${word} counts the rows of the group: ${num(g.n)}.` : `${word} counts the rows where the value is not NULL${k.distinct ? " and different" : ""}: ${r.raw} (of ${num(g.n)} rows).`;
    case "sum": return `${word} adds the ${rows(r.used, "non-NULL value")}: ${r.raw}.`;
    case "avg": return `${word} adds the non-NULL values and divides by how many there are (${num(r.used)}): ${r.raw}.`;
    case "min": return `${word} is the smallest of the ${rows(r.used, "non-NULL value")}: ${r.raw}.`;
    default: return `${word} is the largest of the ${rows(r.used, "non-NULL value")}: ${r.raw}.`;
  }
}

function aggregateCard(x: Ctx, calls: AggCall[]): Part {
  const { st, c } = x;
  const a = x.td?.agg;
  // The groups that reach this step: all of them, or only those HAVING kept.
  const rin = x.rowsIn;
  const groups = rin;
  const notes: string[] = [];
  const inputs: TableSnapshot[] = [];
  const outputs = snapOf(`output of SELECT · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut, 20);
  const label = aggLabel(calls);
  let what = `Each of the ${rows(groups, "group")} is reduced to one output row: ${calls.map(callWord).join(", ")} ${calls.length === 1 ? "is" : "are"} computed over the rows of the group.`;
  let changed = `${rows(rin, "group")} → ${rows(st.rowsOut, "output row")}, one per group. The member rows are gone; only the group key and the aggregate values remain.`;
  if (a) {
    const d = a.detail;
    const g0 = d.groups[0];
    const fc = firstCalc(d);
    const worked = workedLines(d, 2);
    what += ` ${keyLabel(g0.key)} (${rows(g0.n)}): ${d.calls.map((k, ci) => aggFnSentence(k, g0, ci)).join(" ")}`;
    if (worked.length && fc) what += ` Each row first contributes ${one(fc.arg, 60)}, e.g. ${worked.join("; ")}.`;
    const wr = d.calls.findIndex((k) => k.wrapped);
    if (wr >= 0) changed += ` ${shapeSentence(d.calls[wr])} ${keyLabel(g0.key)}: ${g0.calls[wr].raw} → ${g0.calls[wr].result}.`;
    const show = shownColumns(d);
    for (const g of d.groups) {
      const cols = [...show.map((i) => d.columns[i]), ...d.args.map((arg) => `value of ${one(arg, 30)}`), ...(d.calls[0].star || d.calls[0].distinct ? [] : [`running ${d.calls[0].fn.toUpperCase()}`])];
      const body = g.members.map((m) => [...show.map((i) => m.cells[i]), ...m.values, ...(d.calls[0].star || d.calls[0].distinct ? [] : [m.running ?? null])]);
      inputs.push(...snap(`group ${keyLabel(g.key)} · ${rows(g.n)}${g.n > g.members.length ? `, first ${g.members.length}` : ""} · ${d.calls.map((k, ci) => `${k.fn.toUpperCase()} = ${g.calls[ci].raw}`).join(", ")}`, "input", cols, body, g.n, 8));
    }
    for (const g of d.groups) d.calls.forEach((k, ci) => {
      const r = g.calls[ci];
      if (!k.star && r.used < g.n && notes.length < 3) {
        notes.push(k.distinct
          ? `${callWord(k)} in group ${keyLabel(g.key)} counts ${num(r.used)} different non-NULL values among ${rows(g.n)}.`
          : `In group ${keyLabel(g.key)}, ${k.fn.toUpperCase()} ignores the ${rows(g.n - r.used, "NULL value")}: it used ${num(r.used)} of ${rows(g.n)}${k.fn === "count" ? `, so ${callWord(k)} is ${r.raw} while COUNT(*) would be ${num(g.n)}` : k.fn === "avg" ? ", so the average divides by the non-NULL count, not by all rows" : ""}.`);
      }
    });
    if (d.groups.some((g) => g.members.some((m) => m.values.some((v) => v === null)))) notes.push("Rows whose value is NULL are shown as NULL and marked ignored: SUM, AVG, MIN, MAX and COUNT(column) skip them. Only COUNT(*) counts every row.");
    if (c.having) notes.push(`The detail covers the first ${d.groups.length} groups by key as they are before HAVING ${one(c.having, 40)}; a group HAVING removed does not appear in the output table.`);
    if (d.groupCount !== undefined && d.groupCount > d.groups.length) notes.push(`The detail shows the first ${d.groups.length} of ${num(d.groupCount)} groups (and up to ${d.groups[0].members.length} rows of each); every result is exact for all rows of the group.`);
  } else {
    if (x.trace === undefined) notes.push(`${NO_TRACE} The rows each group contributes arrive with it.`);
    else notes.push(...(x.td?.notes.filter((n) => /aggregate|contribut|group results/i.test(n)) ?? []), "The values each row contributes could not be fetched; the output rows below are the real result of the SELECT.");
    notes.push("Rows with a NULL value are ignored by SUM, AVG, MIN, MAX and COUNT(column); only COUNT(*) counts every row.");
  }
  return {
    kind: "aggregate", label,
    operation: `SELECT ${one(calls.map((k) => k.item).join(", "), 80)}: collapse each group into one row.`,
    what, changed,
    why: "An aggregate turns many rows into one value, so the query can answer 'how many, how much, how large per group' instead of listing every row.",
    remember: "Aggregates skip NULLs (except COUNT(*)). After GROUP BY the output has one row per group, and any aggregate you also use in HAVING was computed in this same way before the groups were filtered.",
    inputs, outputs, rowsIn: rin, rowsOut: st.rowsOut, notes,
  };
}

/* ---------- SELECT, DISTINCT, WINDOW ---------- */

function selectCard(x: Ctx): Part {
  const { st, c, prev } = x;
  const cols = st.sample?.columns ?? [];
  const first = st.sample?.rows[0];
  const notes: string[] = [];
  if (st.error) return { operation: st.title, what: st.explanation, changed: "", why: "", remember: "", inputs: [], outputs: [], notes: [st.error] };
  const rin = x.rowsIn;
  const inputs = prev?.sample ? snapOf(`rows entering SELECT · ${rows(rin)}`, "input", prev.sample, rin, 8) : [];
  const rel = relationParts(x, "select");
  notes.push(...rel.notes);
  inputs.unshift(...rel.tables);
  const nullCols = cols.filter((_, i) => st.sample?.rows.some((r) => r[i] === null));
  if (nullCols.length) notes.push(`NULL in ${nullCols.slice(0, 3).join(", ")}${nullCols.length > 3 ? ", …" : ""} means the value is missing (or an outer join found no partner); it is shown as NULL, never as an empty string or 0.`);
  const items = splitTopLevel(c.select ?? "");
  const computed = items.filter((it) => /[()+\-*/|]|\bas\b/i.test(it) && !/^\s*\*\s*$/.test(it));
  return {
    operation: `SELECT ${one(c.select ?? "*", 80)}: compute the output columns.`,
    what: join([
      `SELECT builds ${cols.length} output ${cols.length === 1 ? "column" : "columns"} (${cols.slice(0, 6).join(", ")}${cols.length > 6 ? ", …" : ""}) for each of the ${rows(st.rowsOut)} that are left.`,
      first ? `First output row: ${describe(cols, first, 5)}.` : "",
      computed.length ? `Expressions and aliases (${computed.slice(0, 2).map((e) => one(e, 40)).join("; ")}) are evaluated now.` : "",
      rel.lines.join(" "),
    ]),
    changed: `${rin === st.rowsOut ? `${num(rin)} rows stay ${num(rin)} rows` : `${num(rin)} rows → ${num(st.rowsOut)} rows`}; the columns become ${cols.length}. No row is added or removed here.`,
    why: "SELECT runs late in the logical order, after WHERE, GROUP BY and HAVING, so it only computes values for rows that survived.",
    remember: "Because SELECT runs after WHERE, an alias defined in SELECT cannot be used in WHERE (it does not exist yet) but can be used in ORDER BY.",
    inputs, outputs: snapOf(`output of SELECT · ${rows(st.rowsOut)}`, "output", st.sample, st.rowsOut, 20), rowsIn: rin, rowsOut: st.rowsOut, notes: notes.filter(Boolean),
  };
}

function distinctCard(x: Ctx): Part {
  const { st, viz } = x;
  const rin = x.rowsIn, rout = st.rowsOut;
  const dup = rin !== undefined && rout !== undefined ? rin - rout : undefined;
  const f: FlowFrame | undefined = x.trace?.frames[x.i];
  const surv = f?.board?.cards.find((cd) => cd.tone === "survivor" && /×\d/.test(cd.badge ?? ""));
  const notes: string[] = [];
  const later = viz.stages.slice(x.i + 1).some((s) => s.clause === "order by" || s.clause === "limit");
  const outputs = !later && viz.final ? snap(`distinct rows · ${rows(rout)}`, "output", viz.final.columns, viz.final.rows, rout, 20) : [];
  if (later) notes.push("Which rows ORDER BY / LIMIT keep comes next; the final result is shown at those steps.");
  if (x.trace === undefined) notes.push(NO_TRACE);
  notes.push("DISTINCT compares rows column by column and treats NULL as equal to NULL, so two rows that are both NULL in a column can merge.");
  const prevSample = x.prev?.sample;
  return {
    operation: `SELECT DISTINCT ${one(x.c.select ?? "", 60)}: remove duplicate output rows.`,
    what: join([`DISTINCT keeps one row for each different combination of the output columns: ${num(rin)} → ${num(rout)} rows, so ${rows(dup, "duplicate")} merge into rows that already exist.`, surv ? `For example ${surv.text} (${surv.badge}).` : ""]),
    changed: `${num(rin)} → ${num(rout)} rows (${num(dup)} removed).`,
    why: "SQL tables and results are bags of rows, so identical rows can repeat. DISTINCT turns the bag into a set.",
    remember: "DISTINCT looks at every selected column together, not just the first. Which duplicate survives is not defined, so identical rows are interchangeable.",
    inputs: prevSample ? snapOf(`rows before DISTINCT · ${rows(rin)}`, "input", prevSample, rin, 8) : [], outputs, rowsIn: rin, rowsOut: rout, notes,
  };
}

function windowCard(x: Ctx): Part {
  const { st } = x;
  const d = x.td?.window;
  const items = (d?.items ?? []).map((i) => i.item);
  const notes: string[] = [];
  const text = (d ? items : x.p.windows).join("; ") || "window function";
  const inputs: TableSnapshot[] = [];
  const outputs: TableSnapshot[] = [];
  let what = `${one(text, 120)}. Every row stays; each gets a value computed over its window.`;
  const rin = x.rowsIn;
  if (d && d.rows.length) {
    const w0 = d.items[0];
    const inCols = [...d.partitionExprs, ...d.orderExprs];
    inputs.push(...snap(`rows entering the window · ${rows(d.rowsTotal)}, first ${d.rows.length} shown by partition`, "input", inCols, d.rows.map((r) => [...r.part, ...r.order]), d.rowsTotal, 20));
    outputs.push(...snap(`rows with their window value · ${rows(d.rowsTotal)}`, "output", [...inCols, ...d.valueNames, "rows in partition"], d.rows.map((r) => [...r.part, ...r.order, ...r.values, r.size]), d.rowsTotal, 20));
    const g1 = d.rows.filter((r) => r.g === 1);
    const partTxt = d.partitionExprs.length ? `${d.partitionCount !== undefined ? rows(d.partitionCount, "partition") : "partitions"} by ${d.partitionExprs.join(", ")}` : "one partition (no PARTITION BY: the whole result)";
    what = join([
      `${one(w0.item, 100)}: the ${rows(d.rowsTotal)} are split into ${partTxt}${w0.order.length ? `, and inside each partition ordered by ${w0.order.join(", ")}` : ""}.`,
      g1.length ? `Partition ${d.partitionExprs.length ? keyText(g1[0].part) : "(all rows)"} has ${rows(g1[0].size)}: ${g1.slice(0, 4).map((r) => `${r.order.length ? keyText(r.order) : `row ${r.r}`} → ${fmtCell(r.values[0])}`).join(", ")}${g1.length > 4 ? ", …" : ""}.` : "",
      w0.frame ? `The frame is ${w0.frame}.` : "",
    ]);
    const ties = windowTies(d);
    if (ties.size && isRankFn(w0.fn)) {
      const t = [...ties.values()][0];
      notes.push(`Ties: ${t.length} rows have the same ${w0.order.join(", ")} (${keyText(t.key)}). ${w0.fn === "row_number" ? "ROW_NUMBER still gives them different numbers, and which tied row gets which is not defined." : w0.fn === "dense_rank" ? "DENSE_RANK gives them the same value and does not skip the next one." : w0.fn === "rank" ? "RANK gives them the same value and then skips numbers." : "Tied rows get the same value."}`);
    } else if (ties.size) notes.push(`${ties.size} drawn rows tie on ${w0.order.join(", ")}; with ties the window's own order is not unique.`);
    if (d.rows.some((r) => r.part.some((v) => v === null))) notes.push("NULL partition key: all rows with a NULL key belong to one partition together.");
    if (d.rows.some((r) => r.values.some((v) => v === null))) notes.push("A NULL window value appears where the window function returns NULL (for example LAG/LEAD past the edge, or SUM over only NULLs).");
    if (d.rowsTotal !== undefined && d.rowsTotal > d.rows.length) notes.push(`The first ${d.rows.length} of ${num(d.rowsTotal)} rows are drawn (up to 6 rows of each of the first 3 partitions). Partition sizes are exact.`);
  } else {
    if (st.partitions) outputs.push(...snapOf(`partitions · ${rows(st.partitions.rows.length, "partition")} (largest first)`, "output", st.partitions, undefined, 20));
    notes.push(x.trace === undefined ? NO_TRACE : ((x.td?.notes.find((n) => /window/i.test(n))) ?? "The per-row window values could not be fetched."));
  }
  return {
    operation: `${one(text, 100)}: compute a value for every row over its window.`,
    what,
    changed: `${num(rin ?? st.rowsOut)} rows stay ${num(rin ?? st.rowsOut)} rows: no row is added, removed or merged. Each row gains ${(d?.valueNames ?? ["the window value"]).join(", ")}.`,
    why: "A window function looks at related rows (the same country, the previous row) without collapsing them, so a row can be compared with its peers.",
    remember: "GROUP BY collapses rows, a window function keeps them. PARTITION BY splits, the ORDER BY inside OVER orders within each partition (it is not the query's ORDER BY), and you cannot filter on a window value in WHERE: wrap the query in a subquery or CTE.",
    inputs, outputs, rowsIn: rin, rowsOut: rin ?? st.rowsOut, notes,
  };
}

/* ---------- ORDER BY and LIMIT ---------- */

function orderCard(x: Ctx): Part {
  const { c } = x;
  const o = x.td?.order;
  const keys = o?.keys ?? [];
  const notes: string[] = [];
  const inputs: TableSnapshot[] = [];
  const outputs: TableSnapshot[] = [];
  const total = x.rowsIn ?? o?.total;
  const keyWords = (o?.keys.length ? o.keys : []).map((k) => `${one(k.name, 40)} ${k.desc ? "descending" : "ascending"}`);
  const asWritten = one(c["order by"] ?? "", 80);
  let what = `ORDER BY ${asWritten} puts the ${rows(total)} in order${keyWords.length ? `: by ${keyWords.join(", then by ")}` : ""}.`;
  let changed = `The same ${num(total)} rows, in a new order. No row is added or removed.`;
  if (o && o.rows.length) {
    const have = o.hasPositions;
    const byPos = have ? [...o.rows].map((r, i) => ({ r, i })).sort((a, b) => (a.r.pos ?? 0) - (b.r.pos ?? 0) || a.i - b.i) : o.rows.map((r, i) => ({ r, i }));
    const place = (i: number) => `#${i + 1}`;
    inputs.push(...snap(`these ${o.rows.length} rows in the order they arrived (before sorting)`, "input", [have ? "position before" : "position", ...o.columns], byPos.map(({ r }, k) => [have ? r.pos : k + 1, ...r.cells]), total, 20));
    const kv = o.keyValues;
    outputs.push(...snap(`first ${o.rows.length} rows after sorting · ${rows(total)}`, "output", ["position after", ...(have ? ["was"] : []), ...o.columns], o.rows.map((r, i) => [i + 1, ...(have ? [r.pos] : []), ...r.cells]), total, 20));
    const moved = have ? o.rows.filter((r, i) => (r.pos ?? i + 1) !== i + 1).length : undefined;
    const top = o.rows[0];
    what = join([what, top ? `The first row is now ${describe(o.columns, top.cells, 3)}${have && top.pos !== 1 ? ` (it was ${place((top.pos ?? 1) - 1)} before)` : ""}.` : "", moved !== undefined ? `${moved} of the ${o.rows.length} rows drawn changed place.` : ""]);
    if (kv && keys.length) {
      const runs = tieRuns(kv);
      if (runs.length) {
        const t = runs[0];
        notes.push(`Ties: rows ${t.start + 1}–${t.start + t.length} have the same ${keys.map((k) => one(k.name, 30)).join(", ")} (${keyText(t.key)}), so ORDER BY does not decide which comes first. Add a tie-breaker such as a unique id${keys.length === 1 ? ` (ORDER BY ${asWritten}, <id>)` : ""} for a repeatable order.`);
      }
      const nullInSample = keys.map((k, i) => ({ k, i, n: kv.filter((row) => row[i] === null).length })).filter((z) => z.n > 0);
      keys.forEach((k, i) => {
        const exact = o.nullCounts?.[i];
        const count = exact ?? nullInSample.find((z) => z.i === i)?.n ?? 0;
        if (count > 0) notes.push(`${num(count)} ${exact !== undefined ? "" : "of the drawn "}${count === 1 ? "row has" : "rows have"} NULL in ${one(k.name, 40)}: ${nullsWord(k)}.${k.explicitNulls ? "" : ` Write NULLS ${k.desc ? "LAST" : "FIRST"} to put them the other way.`}`);
      });
    }
    if (o.total === undefined && total === undefined) notes.push("The total number of rows being sorted could not be fetched.");
    if (total !== undefined && total > o.rows.length) notes.push(`The first ${o.rows.length} of ${num(total)} sorted rows are drawn; the row count is exact.`);
    if (have) notes.push("Positions 'before sorting' are the order the rows arrived in, which SQL does not promise, so a row 'moved' only relative to that arrival order.");
    changed = `The same ${num(total)} rows in a new order: ${moved !== undefined ? `${moved} of the ${o.rows.length} rows drawn moved.` : "see the sorted rows."}`;
  } else {
    // Without row-level data the real final result is the sorted rows when nothing is cut after the sort.
    const cut = x.viz.stages.slice(x.i + 1).some((s) => s.clause === "limit");
    if (!cut && x.viz.final) outputs.push(...snap(`rows after sorting (your query's real result) · ${rows(x.viz.final.rowCount)}`, "output", x.viz.final.columns, x.viz.final.rows, x.viz.final.rowCount, 20));
    notes.push(x.trace === undefined ? `${NO_TRACE} The positions before and after the sort, ties and NULL placement arrive with it.` : "The rows before and after the sort could not be fetched.");
    const parsed = (c["order by"] ? splitTopLevel(c["order by"]) : []).map((s) => /\bnulls\s+(first|last)\b/i.exec(s)?.[0]).filter(Boolean);
    if (parsed.length) notes.push(`You wrote ${parsed.join(", ")}: that decides where NULLs sort.`);
  }
  return {
    operation: `ORDER BY ${asWritten}: sort the rows.`,
    what, changed,
    why: "Without ORDER BY, SQL promises no order at all. Sorting happens near the end so it only orders rows that remain, and it can use SELECT aliases because they exist by now.",
    remember: "ORDER BY is the only way to get a defined order. Rows that tie keep an unspecified order unless you add a tie-breaker. By default NULLs sort as the largest value: last for ASC, first for DESC.",
    inputs, outputs, rowsIn: total, rowsOut: total, notes,
  };
}

function limitCard(x: Ctx): Part {
  const { c, viz } = x;
  const o = x.td?.order;
  const total = x.rowsIn ?? o?.total;
  const lim = /^\d+$/.test((c.limit ?? "").trim()) ? Number((c.limit ?? "").trim()) : undefined;
  const off = c.offset === undefined ? 0 : /^\d+$/.test(c.offset.trim()) ? Number(c.offset.trim()) : undefined;
  const final = viz.final;
  const notes: string[] = [];
  const known = total !== undefined && off !== undefined && (c.limit === undefined || lim !== undefined);
  const skipped = known ? Math.min(off!, total!) : undefined;
  const kept = known ? Math.max(0, Math.min(total! - off!, lim ?? Infinity)) : final?.rowCount;
  const cutN = known && skipped !== undefined && kept !== undefined ? total! - skipped - kept : undefined;
  const inputs: TableSnapshot[] = [];
  const outputs: TableSnapshot[] = [];
  const hasOrder = viz.stages.some((s) => s.clause === "order by");
  if (final) outputs.push(...snap(`kept: your query's real result · ${rows(final.rowCount)}`, "output", final.columns, final.rows, final.rowCount, 20));
  if (o && o.rows.length && off !== undefined) {
    const sk = o.rows.slice(0, off), cutRows = o.rows.slice(off + (lim ?? o.rows.length));
    inputs.push(...snap(`sorted rows · ${rows(total)}, first ${o.rows.length} shown`, "input", o.columns, o.rows.map((r) => r.cells), total, 20));
    if (sk.length) outputs.push(...snap(`skipped by OFFSET ${off} · ${rows(skipped)}`, "removed", o.columns, sk.map((r) => r.cells), skipped, 10));
    if (cutRows.length) outputs.push(...snap(`cut by LIMIT · ${rows(cutN)}${cutRows.length < (cutN ?? 0) ? `, the next ${cutRows.length} shown` : ""}`, "removed", o.columns, cutRows.map((r) => r.cells), cutN, 10));
    if (off > o.rows.length) notes.push(`OFFSET ${off} is larger than the ${o.rows.length} rows drawn, so the skipped rows are counted but not drawn.`);
  } else if (x.trace === undefined) notes.push(`${NO_TRACE} The skipped and cut rows arrive with it; the kept rows below are already your real result.`);
  if (!hasOrder) notes.push("There is no ORDER BY, so SQL does not define which rows come first: LIMIT keeps whichever rows the database happens to produce first, and another run (or plan) may keep different ones.");
  if (!known) notes.push("The LIMIT / OFFSET is not a plain number (or the row count before it is unknown), so the skipped and cut counts could not be computed; the kept rows are your real result.");
  if (total !== undefined && kept !== undefined && kept < (lim ?? Infinity) && off !== undefined && total - off < (lim ?? Infinity)) notes.push(`Fewer rows exist than the LIMIT asks for: only ${rows(kept)} remain after skipping ${num(skipped)}.`);
  const parts = [c.offset !== undefined ? `OFFSET ${c.offset}` : "", c.limit !== undefined ? `LIMIT ${c.limit}` : ""].filter(Boolean).join(" ");
  return {
    operation: `${parts || "LIMIT"}: ${off ? `skip the first ${rows(off)}, then ` : ""}${lim !== undefined ? `keep ${lim}` : "keep the rest"}.`,
    what: join([
      `${parts}${hasOrder ? ` applies to the sorted rows` : ""}: ${known ? `of ${rows(total)}, ${rows(skipped)} ${skipped === 1 ? "is" : "are"} skipped by OFFSET, ${rows(kept)} ${kept === 1 ? "is" : "are"} kept and ${rows(cutN)} ${cutN === 1 ? "is" : "are"} cut off.` : `${rows(kept)} are kept.`}`,
    ]),
    changed: known ? `${num(total)} → ${num(kept)} rows (${num(skipped)} skipped + ${num(cutN)} cut). The kept rows are unchanged and keep their order.` : `${rows(kept)} remain.`,
    why: "LIMIT runs last, after sorting, so it keeps the top of the sorted rows; OFFSET lets you page through them.",
    remember: `LIMIT without ORDER BY keeps an undefined set of rows. OFFSET still reads and discards the skipped rows, so large offsets cost time.`,
    inputs, outputs, rowsIn: total, rowsOut: kept, notes,
  };
}

/* ---------- set operations ---------- */

function setOpCard(x: Ctx): Part {
  const { st } = x;
  const d = st.setOp;
  if (!d) return { operation: st.title, what: st.explanation, changed: "", why: "", remember: "", inputs: [], outputs: [], notes: [] };
  const name = `${d.op.toUpperCase()}${d.all ? " ALL" : ""}`;
  const notes = [...(d.compat?.notes ?? []), ...Object.values(d.unavailable ?? {})];
  if (d.error) notes.unshift(d.error);
  const inputs = [...snap(`left input · ${rows(d.leftCount)}`, "input", d.left?.columns ?? [], d.left?.rows ?? [], d.leftCount, 8), ...snap(`right input · ${rows(d.rightCount)}`, "input", d.right?.columns ?? [], d.right?.rows ?? [], d.rightCount, 8)];
  const outputs = [
    ...snap(`${name} result · ${rows(d.resultCount ?? st.rowsOut)}`, "output", d.result?.columns ?? [], d.result?.rows ?? [], d.resultCount ?? st.rowsOut, 20),
    ...(d.removed?.rows.length ? snap(`${d.removedLabel ?? "removed"} · ${rows(d.removedCount)}`, "removed", d.removed.columns, d.removed.rows, d.removedCount, 8) : []),
  ];
  const cue = d.op === "union" ? (d.all ? "UNION ALL keeps every row, duplicates included." : "UNION removes duplicate rows across both inputs (NULLs count as equal to each other).")
    : d.op === "intersect" ? "INTERSECT keeps only rows that appear in both inputs." : "EXCEPT keeps left rows that do not appear on the right; swapping the inputs changes the result.";
  return {
    operation: `${name}: combine two queries' rows.`, what: st.explanation,
    changed: `${num(d.leftCount)} left + ${num(d.rightCount)} right rows → ${num(d.resultCount ?? st.rowsOut)} result rows.`,
    why: d.rule || "A set operation combines whole rows of two queries that have the same number and compatible types of columns.",
    remember: `${cue} Column names come from the left query.`,
    inputs, outputs, rowsIn: st.rowsIn, rowsOut: st.rowsOut, notes,
  };
}

/* ---------- the card ---------- */

/** The teaching card for one stage. `trace` is the row-level data when it has arrived (the card must be correct without it). */
export function buildTeach(viz: Visualization, trace: RowTrace | undefined, stageIndex: number): TeachCard {
  const st = viz.stages[stageIndex];
  const base = RAIL[st.clause];
  const x: Ctx = {
    viz, trace, td: trace?.teach, i: stageIndex, st, prev: viz.stages[stageIndex - 1], n: viz.stages.length, p: viz.parsed, c: viz.parsed.clauses,
    // Rows in = what the closest earlier stage passed on (after HAVING that is the groups that survived), never the stage's own figure from further back.
    rowsIn: st.setOp ? st.rowsIn : countBefore(viz, stageIndex) ?? st.rowsIn, notes: [],
  };
  let part: Part;
  // The aggregate calls are read from the parse, so the rail label is the same before and after the rows arrive.
  const calls = viz.parsed.clauses.select && viz.stages.some((s) => s.clause === "group by") ? findAggCalls(viz.parsed.clauses.select) : [];
  if (st.error) part = errorCard(x);
  else if (st.setOp) part = setOpCard(x);
  else if (st.source === "parsed" && !st.sample && st.rowsOut === undefined && !st.joins?.length && st.clause !== "order by" && st.clause !== "limit" && st.clause !== "window" && !(st.clause === "from" && !x.c.from)) part = parsedCard(x);
  else switch (st.clause) {
    case "from": part = fromCard(x); break;
    case "where": part = whereCard(x); break;
    case "group by": part = groupCard(x); break;
    case "having": part = havingCard(x); break;
    case "window": part = windowCard(x); break;
    case "select": part = calls.length ? aggregateCard(x, calls) : selectCard(x); break;
    case "distinct": part = distinctCard(x); break;
    case "order by": part = orderCard(x); break;
    case "limit": part = limitCard(x); break;
    default: part = parsedCard(x);
  }
  const notes = [...(part.notes ?? [])];
  if (viz.volatile?.length) notes.unshift(`Your query uses ${viz.volatile.join(", ")}, which return different values on each run, so no stage query was run: this explanation comes from the query text only.`);
  // ORDER BY and LIMIT have no stage query of their own; their rows come from the trace and from the learner's real result.
  const own = (st.clause === "order by" && Boolean(x.td?.order || viz.final)) || (st.clause === "limit" && Boolean(x.td?.order || viz.final)) || (st.clause === "window" && Boolean(x.td?.window)) || (st.clause === "from" && !x.c.from && Boolean(viz.final));
  const executed = (st.source === "executed" || (own && !viz.volatile?.length)) && !st.error;
  if (!executed && !viz.volatile?.length && !st.error) notes.push("This step was explained from the query text only; nothing was run for it.");
  const rail = { label: part.label ?? base.label, kind: part.kind ?? base.kind };
  return {
    stageIndex, kind: rail.kind, label: rail.label,
    operation: `Logical step ${stageIndex + 1} of ${viz.stages.length}: ${part.operation ?? st.title}`,
    what: part.what ?? st.explanation, changed: part.changed ?? "", why: part.why ?? "", remember: part.remember ?? "",
    inputs: part.inputs ?? [], outputs: part.outputs ?? [], rowsIn: part.rowsIn ?? x.rowsIn, rowsOut: part.rowsOut ?? st.rowsOut,
    notes: notes.filter((n) => n.length > 0), provenance: executed ? "executed" : "parsed",
  };
}

/**
 * A stage that carries an error: the learner's real PostgreSQL message, said as it is, and what it means for the steps after it. Nothing
 * is drawn for it; the stage keeps its own rail label (an error in the FROM is a FROM step, the final "Your query has an error" is the SELECT).
 */
function errorCard(x: Ctx): Part {
  const { st, viz, i } = x;
  const msg = st.error ?? st.explanation;
  const later = viz.stages.slice(i + 1).filter((s) => !s.error).map((s) => RAIL[s.clause].label);
  const isFinal = st.title === "Your query has an error";
  const notes = [
    `PostgreSQL said: ${msg}`,
    isFinal
      ? "Because the query itself failed, no result exists. The earlier steps above show what each clause does on its own; they are explanations of your clauses, not of a successful run."
      : `This step could not be computed, so the steps that depend on it${later.length ? ` (${later.join(", ")})` : ""} may have no row data either: each shows only what could be explained from the query text.`,
  ];
  return {
    operation: isFinal ? "Your query failed: PostgreSQL rejected it." : `${st.title}: PostgreSQL could not run this step.`,
    what: `PostgreSQL returned this error: ${msg}`,
    changed: "No rows were produced: the step failed before it returned any.",
    why: "A step fails when PostgreSQL cannot resolve something in your clause (a name, a type, a grouping rule). Nothing after a failed step can run on real rows.",
    remember: "Read the error message first: it names the column, table or rule that failed, often with a position or a hint.",
    inputs: [], outputs: [], notes,
  };
}

function parsedCard(x: Ctx): Part {
  const { st } = x;
  return {
    operation: st.title, what: st.explanation,
    changed: x.rowsIn !== undefined && st.rowsOut !== undefined ? `${num(x.rowsIn)} rows in, ${num(st.rowsOut)} rows out.` : "",
    why: "", remember: "", inputs: [], outputs: snapOf(`after ${RAIL[st.clause].label}`, "output", st.sample, st.rowsOut), notes: [],
  };
}

/** One card per stage, in playback order. */
export const teachSteps = (viz: Visualization, trace: RowTrace | undefined): TeachCard[] => viz.stages.map((_, i) => buildTeach(viz, trace, i));
