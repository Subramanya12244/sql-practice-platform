import type { ExecuteResult } from "../../types";
import { arithmetic, collapsedSql, countSql, distinctCountSql, markedSampleSql, matchedLabel, onlyOneSideSql, opName, removedLabel, rowMark, ruleText, setExpr, stageTitle, typeProbeSql, type ColumnPair, type SetOpData, type SetSample } from "./visual/setOps";
import { buildQuery, parseSelect, parseSetOperation, type JoinPart, type ParsedQuery, type SetOpNode, type SetOpQuery, type SetTail, type SetTree } from "./sqlClauses";

/** Rows shown per stage; counts are always exact. */
export const SAMPLE = 20;

export type Run = (sql: string) => Promise<ExecuteResult>;

export interface Sample {
  columns: string[];
  rows: unknown[][];
}

export interface JoinStep {
  kind: string;
  left: string;
  right: string;
  on?: string;
  leftRows?: number;
  rightRows?: number;
  matchedPairs?: number;
  unmatchedLeft?: number;
  unmatchedRight?: number;
  unmatchedLeftSample?: Sample;
  unmatchedRightSample?: Sample;
  resultRows?: number;
}

/**
 * Where a stage's information comes from:
 * - executed: real rows/counts from running a valid query built only from the user's own clauses
 *   (e.g. FROM + WHERE). It shows what that logical stage produces — not how PostgreSQL ran it.
 * - parsed: explanation from the query text only; nothing was run for this stage.
 */
export type Provenance = "executed" | "parsed";

export interface Stage {
  source?: Provenance;
  clause: "from" | "where" | "group by" | "having" | "window" | "select" | "distinct" | "order by" | "limit" | "union" | "intersect" | "except";
  title: string;
  explanation: string;
  /** The derived query that produced this stage's data (shown to the user). */
  sql?: string;
  rowsIn?: number;
  rowsOut?: number;
  sample?: Sample;
  removed?: Sample;
  joins?: JoinStep[];
  /** Set-operation stage (UNION, INTERSECT, EXCEPT): both inputs, compatibility, matches, removals and the result. */
  setOp?: SetOpData;
  partitions?: Sample;
  /** Position of this stage's part of the query in the original text (set-operation stages; there can be several of one kind). */
  range?: [number, number];
  error?: string;
}

export interface Visualization {
  /** Volatile functions found; when present, no derived stage queries were run. */
  volatile?: string[];
  parsed: ParsedQuery;
  stages: Stage[];
  final?: Sample & { rowCount: number };
  unsupported?: string;
}

const AGG = /\b(count|sum|avg|min|max|string_agg|array_agg|bool_and|bool_or|every|stddev|variance)\s*\(/i;

async function rows(run: Run, sql: string): Promise<Sample & { count?: number; error?: string }> {
  const r = await run(sql);
  if (!r.success) return { columns: [], rows: [], error: r.message ?? "query failed" };
  return { columns: r.columns, rows: r.rows.slice(0, SAMPLE), count: r.row_count ?? r.rows.length };
}

async function count(run: Run, p: ParsedQuery, inner: string): Promise<number | undefined> {
  const r = await run(`${p.with ? p.with + "\n" : ""}SELECT COUNT(*) FROM (\n${inner.replace(p.with, "").trim()}\n) AS _stage`);
  return r.success ? Number(r.rows[0]?.[0]) : undefined;
}

const limited = (sql: string) => `${sql}\nLIMIT ${SAMPLE}`;

async function joinSteps(run: Run, p: ParsedQuery): Promise<JoinStep[]> {
  const out: JoinStep[] = [];
  const parts: JoinPart[] = p.joins;
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).map((j, k) => (k === 0 ? j.source : `${j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}`)).join("\n");
    const j = parts[i];
    const step: JoinStep = { kind: j.kind, left, right: j.source, on: j.on };
    const c = async (sql: string) => {
      const r = await run(`${p.with ? p.with + "\n" : ""}${sql}`);
      return r.success ? Number(r.rows[0]?.[0]) : undefined;
    };
    step.leftRows = await c(`SELECT COUNT(*) FROM ${left}`);
    step.rightRows = await c(`SELECT COUNT(*) FROM ${j.source}`);
    step.resultRows = await c(`SELECT COUNT(*) FROM ${left}\n${j.kind} ${j.source}${j.on ? ` ON ${j.on}` : ""}`);
    if (j.on) {
      step.matchedPairs = await c(`SELECT COUNT(*) FROM ${left}\nJOIN ${j.source} ON ${j.on}`);
      step.unmatchedLeft = await c(`SELECT COUNT(*) FROM ${left}\nWHERE NOT EXISTS (SELECT 1 FROM ${j.source} WHERE ${j.on})`);
      step.unmatchedRight = await c(`SELECT COUNT(*) FROM ${j.source}\nWHERE NOT EXISTS (SELECT 1 FROM ${left} WHERE ${j.on})`);
      if (step.unmatchedLeft) step.unmatchedLeftSample = await rows(run, `${p.with}\nSELECT * FROM ${left}\nWHERE NOT EXISTS (SELECT 1 FROM ${j.source} WHERE ${j.on})\nLIMIT 5`);
      if (step.unmatchedRight) step.unmatchedRightSample = await rows(run, `${p.with}\nSELECT * FROM ${j.source}\nWHERE NOT EXISTS (SELECT 1 FROM ${left} WHERE ${j.on})\nLIMIT 5`);
    }
    out.push(step);
  }
  return out;
}

function joinExplanation(kind: string): string {
  const k = kind.toUpperCase();
  if (k.includes("LEFT")) return "keeps every row from the left side; left rows with no match get NULLs for the right side's columns";
  if (k.includes("RIGHT")) return "keeps every row from the right side; unmatched right rows get NULLs for the left side's columns";
  if (k.includes("FULL")) return "keeps unmatched rows from both sides, padding the missing side with NULLs";
  if (k.includes("CROSS")) return "pairs every left row with every right row (no condition)";
  return "keeps only pairs of rows where the ON condition is true; unmatched rows on either side are dropped";
}

/**
 * Walk a SELECT through SQL's logical processing order, computing each stage with a derived
 * query. This is the *logical* order the standard defines; PostgreSQL's planner may physically
 * execute things differently (see the execution plan).
 */
export async function visualize(sql: string, realRun: Run): Promise<Visualization> {
  const p = parseSelect(sql);
  // Derived stage queries re-run parts of the query. With random()/now()/nextval() etc. those
  // re-runs would produce different rows than the user's query, so only explain, don't execute.
  const { volatileFunctions } = await import("./sqlAst");
  const volatile = volatileFunctions(sql);
  const run: Run = volatile.length
    ? async () => ({ success: false, columns: [], rows: [], message: "not executed" })
    : realRun;
  // Set operations (UNION / INTERSECT / EXCEPT) are read by their own parser: parseSelect handles one SELECT only.
  const so = parseSetOperation(sql);
  if (so.kind === "unsupported") return { parsed: { ...p, unsupported: so.reason }, stages: [], unsupported: so.reason };
  if (so.kind === "setop") return visualizeSetOp(sql, so.query, run, realRun, volatile);
  if (p.unsupported) return { parsed: p, stages: [], unsupported: p.unsupported };
  const c = p.clauses;
  const stages: Stage[] = [];
  const base = { from: c.from, where: c.where, groupBy: c["group by"], having: c.having };
  const grouped = Boolean(c["group by"]) || (AGG.test(c.select ?? "") && !p.windows.length) || Boolean(c.having);

  // 1. FROM / JOIN
  if (c.from) {
    const q = buildQuery(p, { select: "*", from: c.from });
    const s = await rows(run, limited(q));
    const joins = p.joins.length > 1 ? await joinSteps(run, p) : [];
    stages.push({
      clause: "from",
      title: joins.length ? "FROM + JOIN — build the working row set" : "FROM — read the source rows",
      explanation: joins.length
        ? `The tables are combined first. ${joins.map((j) => `${j.kind} ${joinExplanation(j.kind)}`).join(". ")}.`
        : "Everything starts from the table(s) in FROM. No filtering has happened yet.",
      sql: q,
      rowsOut: await count(run, p, q),
      sample: s,
      joins,
      error: s.error,
    });
  } else {
    stages.push({ clause: "from", title: "No FROM", explanation: "Without FROM, PostgreSQL evaluates the SELECT list once, producing one row." });
  }

  // 2. WHERE
  if (c.where) {
    const before = stages[0].rowsOut;
    const q = buildQuery(p, { select: "*", from: c.from, where: c.where });
    const kept = await rows(run, limited(q));
    const removed = await rows(run, `${buildQuery(p, { select: "*", from: c.from, where: `(${c.where}) IS NOT TRUE` })}\nLIMIT 5`);
    const after = await count(run, p, q);
    stages.push({
      clause: "where",
      title: "WHERE — filter individual rows",
      explanation: `Each row is tested against the condition before any grouping. Rows where it is false or NULL (unknown) are removed${
        before !== undefined && after !== undefined ? `: ${before} → ${after} rows (${before - after} removed)` : ""
      }. WHERE cannot use aggregates or SELECT aliases, because neither exists yet.`,
      sql: q,
      rowsIn: before,
      rowsOut: after,
      sample: kept,
      removed: removed.rows.length ? removed : undefined,
      error: kept.error,
    });
  }
  const afterWhere = stages[stages.length - 1].rowsOut;

  // 3. GROUP BY
  if (grouped) {
    if (c["group by"]) {
      const q = buildQuery(p, { select: `${c["group by"]}, COUNT(*) AS rows_in_group`, from: c.from, where: c.where, groupBy: c["group by"] });
      const s = await rows(run, `${q}\nORDER BY rows_in_group DESC\nLIMIT ${SAMPLE}`);
      const groups = await count(run, p, q);
      stages.push({
        clause: "group by",
        title: "GROUP BY — form groups",
        explanation: `Rows with equal values of ${c["group by"]} collapse into one group each${
          afterWhere !== undefined && groups !== undefined ? `: ${afterWhere} rows → ${groups} groups` : ""
        }. From here on, every expression must be a grouping column or an aggregate.`,
        sql: q,
        rowsIn: afterWhere,
        rowsOut: groups,
        sample: s,
        error: s.error ? `${s.error} (if GROUP BY uses a SELECT alias, the groups can't be shown separately)` : undefined,
      });
    } else {
      stages.push({
        clause: "group by",
        title: "Aggregation without GROUP BY",
        explanation: "The SELECT list uses an aggregate but there is no GROUP BY, so all remaining rows form a single group and the result has one row.",
        rowsIn: afterWhere,
        rowsOut: 1,
      });
    }
  }

  // 4. HAVING
  if (c.having) {
    const groupsBefore = stages[stages.length - 1].rowsOut;
    const q = buildQuery(p, { select: c["group by"] ? `${c["group by"]}, COUNT(*) AS rows_in_group` : "COUNT(*) AS rows_in_group", ...base });
    const kept = await rows(run, limited(q));
    const dropped = await rows(run, `${buildQuery(p, { select: c["group by"] ? `${c["group by"]}, COUNT(*) AS rows_in_group` : "COUNT(*) AS rows_in_group", from: c.from, where: c.where, groupBy: c["group by"], having: `(${c.having}) IS NOT TRUE` })}\nLIMIT 5`);
    const after = await count(run, p, q);
    stages.push({
      clause: "having",
      title: "HAVING — filter whole groups",
      explanation: `HAVING runs after aggregation, so it can test aggregates like ${c.having}${
        groupsBefore !== undefined && after !== undefined ? `: ${groupsBefore} → ${after} groups` : ""
      }.`,
      sql: q,
      rowsIn: groupsBefore,
      rowsOut: after,
      sample: kept,
      removed: dropped.rows.length ? dropped : undefined,
      error: kept.error,
    });
  }

  // 5. Window functions
  if (p.windows.length) {
    const part = /partition\s+by\s+(.+?)(?:\s+order\s+by|\s*$|\s+rows\b|\s+range\b|\s+groups\b)/i.exec(p.windows[0].replace(/^.*?OVER \(/i, "").replace(/\)$/, ""));
    let partitions: Sample | undefined;
    if (part && !grouped) {
      const s = await rows(run, `${buildQuery(p, { select: `${part[1]} AS partition_key, COUNT(*) AS rows_in_partition`, from: c.from, where: c.where, groupBy: "1" })}\nORDER BY rows_in_partition DESC\nLIMIT ${SAMPLE}`);
      if (!s.error) partitions = s;
    }
    stages.push({
      clause: "window",
      title: "Window functions — compute across related rows",
      explanation: `${p.windows.join("; ")}. Window functions run after WHERE/GROUP BY/HAVING and before ORDER BY. Unlike GROUP BY they keep every row: each row gets a value computed over its window${
        part ? ` (rows sharing ${part[1]})` : " (the whole result, since there is no PARTITION BY)"
      }, in the window's own ORDER BY order. That is why you can't filter on a window function in WHERE — wrap it in a subquery or CTE instead.`,
      partitions,
    });
  }

  // 6. SELECT (projection) — no DISTINCT/ORDER/LIMIT yet
  {
    const q = buildQuery(p, { select: c.select ?? "*", ...base });
    const s = await rows(run, limited(q));
    stages.push({
      clause: "select",
      title: "SELECT — compute the output columns",
      explanation: "Expressions and aliases in the SELECT list are evaluated now, which is why ORDER BY can use an alias but WHERE and HAVING cannot.",
      sql: q,
      rowsOut: await count(run, p, q),
      sample: s,
      error: s.error,
    });
  }

  // 7. DISTINCT
  if (p.distinct) {
    const before = stages[stages.length - 1].rowsOut;
    const q = buildQuery(p, { select: `DISTINCT ${c.select}`, ...base });
    const after = await count(run, p, q);
    stages.push({
      clause: "distinct",
      title: "DISTINCT — remove duplicate output rows",
      explanation: `Rows that are identical across every selected column are collapsed${before !== undefined && after !== undefined ? `: ${before} → ${after} rows` : ""}.`,
      sql: q,
      rowsIn: before,
      rowsOut: after,
    });
  }

  // 8. ORDER BY
  if (c["order by"]) {
    stages.push({
      clause: "order by",
      title: "ORDER BY — sort",
      explanation: `Rows are sorted by ${c["order by"]}. Without ORDER BY, SQL guarantees no order at all. Ties keep an unspecified order unless you add a tie-breaker.`,
    });
  }

  // 9. LIMIT / OFFSET
  if (c.limit || c.offset) {
    stages.push({
      clause: "limit",
      title: "LIMIT / OFFSET — keep a slice",
      explanation: `${c.offset ? `Skip ${c.offset} row(s), then ` : ""}${c.limit ? `keep at most ${c.limit}` : "keep the rest"}. This happens last, after sorting.`,
    });
  }

  for (const s of stages) {
    const executed = !volatile.length && !s.error && (s.rowsOut !== undefined || Boolean(s.sample?.columns.length) || Boolean(s.joins?.length) || Boolean(s.partitions));
    s.source = executed ? "executed" : "parsed";
    if (volatile.length) {
      s.error = undefined;
      s.sample = undefined;
      s.removed = undefined;
      s.rowsIn = undefined;
      s.rowsOut = undefined;
      s.joins = s.joins?.map((j) => ({ kind: j.kind, left: j.left, right: j.right, on: j.on }));
      s.partitions = undefined;
    }
  }

  // The final result always comes from running exactly the user's query, once.
  const f = await realRun(sql.replace(/;\s*$/, ""));
  const final = f.success ? { columns: f.columns, rows: f.rows.slice(0, SAMPLE), rowCount: f.row_count ?? f.rows.length } : undefined;
  if (!f.success) stages.push({ clause: "select", title: "Your query has an error", explanation: f.message ?? "", error: f.message ?? "error" });
  return { parsed: p, stages, final, volatile: volatile.length ? volatile : undefined };
}

// ---------------------------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------------------------

const oneLine = (sql: string, max = 70) => {
  const t = sql.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Executable text of a node used as an input of another operation. */
const treeText = (t: SetTree) => (t.kind === "leaf" ? t.sql : t.tail.text ? `${t.core}\n${t.tail.text}` : t.core);
const operand = (t: SetTree) => `(${treeText(t)})`;

/**
 * One stage per set operation (inner operations first), each computed from real queries on its two inputs, then the
 * ORDER BY / LIMIT that apply to the whole operation. A stage shows the query's logical meaning, not PostgreSQL's
 * physical plan (which may hash or sort differently).
 */
async function visualizeSetOp(sql: string, q: SetOpQuery, run: Run, realRun: Run, volatile: string[]): Promise<Visualization> {
  const withPrefix = q.with;
  const prefixed = (body: string) => (withPrefix ? `${withPrefix}\n${body}` : body);
  const ranges: ParsedQuery["ranges"] = {};
  if (q.withRange) ranges.with = q.withRange;
  if (q.tail.ranges.orderBy) ranges["order by"] = q.tail.ranges.orderBy;
  if (q.tail.ranges.limit) ranges.limit = q.tail.ranges.limit;
  if (q.tail.ranges.offset) ranges.offset = q.tail.ranges.offset;
  const parsed: ParsedQuery = { with: withPrefix, clauses: {}, ranges, distinct: false, joins: [], windows: [] };
  const stages: Stage[] = [];
  const executing = !volatile.length;
  let failed = false;
  let opNo = 0;
  let probe = 0;
  const step = new Map<SetOpNode, number>();
  const label = (t: SetTree) => (t.kind === "leaf" ? oneLine(t.sql) : `result of step ${step.get(t)} (${t.keyword})`);

  const countOf = async (query: string) => {
    const r = await run(prefixed(query));
    return r.success ? Number(r.rows[0]?.[0]) : undefined;
  };
  const sampleOf = async (query: string): Promise<Sample & { error?: string }> => {
    const r = await run(prefixed(query));
    return r.success ? { columns: r.columns, rows: r.rows.slice(0, SAMPLE) } : { columns: [], rows: [], error: r.message ?? "query failed" };
  };

  async function opStage(node: SetOpNode): Promise<Stage> {
    step.set(node, ++opNo);
    ranges[node.op] = node.range;
    const L = operand(node.left);
    const R = operand(node.right);
    const comb = setExpr(L, node.op, node.all, R);
    const name = opName(node.op, node.all);
    const base: Stage = { clause: node.op, title: `${stageTitle(node.op, node.all)}`, explanation: "", range: node.range };
    const intro = `Inputs: left is ${label(node.left)}; right is ${label(node.right)}.`;
    if (!executing) {
      return { ...base, title: `${stageTitle(node.op, node.all)} (not executed)`, explanation: `${intro} ${ruleText(node.op, node.all)} Intermediate rows aren't shown because the query uses ${volatile.join(", ")}, which return different values on each run.` };
    }
    // Names (from the left input) and a validity check for each input on its own.
    const [nl, nr] = await Promise.all([sampleOf(`SELECT * FROM ${L} AS _l LIMIT 0`), sampleOf(`SELECT * FROM ${R} AS _r LIMIT 0`)]);
    const types = async (query: string): Promise<string[] | undefined> => {
      const r = await run(prefixed(typeProbeSql(`_df_so_${++probe}`, query)));
      return r.success ? r.rows.map((x) => String(x[0])) : undefined;
    };
    const [tl, tr, tc] = await Promise.all([types(`SELECT * FROM ${L} AS _l`), types(`SELECT * FROM ${R} AS _r`), types(`SELECT * FROM (${comb}) AS _c`)]);
    const unavailable: SetOpData["unavailable"] = {};
    if (!tl || !tr) unavailable.types = "PostgreSQL could not describe the result columns of an input (it may be invalid on its own).";

    const names = nl.columns.length ? nl.columns : nr.columns;
    const width = Math.max(nl.columns.length, nr.columns.length, tl?.length ?? 0, tr?.length ?? 0);
    const pairs: ColumnPair[] = Array.from({ length: width }, (_, i) => ({
      position: i + 1,
      name: nl.columns[i] ?? "(missing on the left)",
      left: tl?.[i],
      right: tr?.[i],
      result: tc?.[i],
      same: tl?.[i] !== undefined && tl[i] === tr?.[i],
    }));

    // The operation itself, run for real: PostgreSQL decides whether it is valid.
    const resultRun = await run(prefixed(`SELECT * FROM (${comb}) AS _r LIMIT ${SAMPLE}`));
    const lSampleSimple = () => sampleOf(`SELECT * FROM ${L} AS _l LIMIT ${SAMPLE}`);
    const rSampleSimple = () => sampleOf(`SELECT * FROM ${R} AS _r LIMIT ${SAMPLE}`);
    if (!resultRun.success) {
      const message = resultRun.message ?? "The set operation failed.";
      const [ls, rs, lc, rc] = await Promise.all([lSampleSimple(), rSampleSimple(), countOf(countSql(L)), countOf(countSql(R))]);
      const notes = [message];
      if (nl.columns.length && nr.columns.length && nl.columns.length !== nr.columns.length) notes.push(`The left input has ${nl.columns.length} column(s) and the right input has ${nr.columns.length}; ${node.op.toUpperCase()} needs the same number on both sides.`);
      failed = true;
      const data: SetOpData = {
        op: node.op, all: node.all, left: ls, right: rs, leftCount: lc, rightCount: rc, leftLabel: label(node.left), rightLabel: label(node.right),
        compat: { ok: false, notes }, pairs, error: message, result: { columns: [], rows: [] }, rule: ruleText(node.op, node.all), unavailable,
      };
      return { ...base, explanation: `${intro} PostgreSQL rejected this ${name}: ${message}`, sql: prefixed(comb), setOp: data, error: message };
    }

    const n = nl.columns.length;
    // Rows both inputs have: distinct values, or per copy (min of the counts) for the ALL variants of EXCEPT.
    const interAll = node.op === "except" && node.all;
    const inter = setExpr(L, "intersect", interAll, R);
    const needInter = node.op !== "intersect";
    const [lc, rc, resCount, ld, rd, interSample, interCount] = await Promise.all([
      countOf(countSql(L)), countOf(countSql(R)), countOf(countSql(`(${comb})`)),
      countOf(distinctCountSql(L, n)), countOf(distinctCountSql(R, n)),
      needInter ? sampleOf(`SELECT * FROM (${inter}) AS _m LIMIT ${SAMPLE}`) : Promise.resolve(undefined),
      needInter ? countOf(countSql(`(${inter})`)) : Promise.resolve(undefined),
    ]);
    // Per-row fate of the sampled input rows (copy number among identical rows, identical rows on the other side).
    const markSide = async (self: string, other: string, side: "left" | "right"): Promise<SetSample> => {
      const r = await run(prefixed(markedSampleSql(self, other, n, SAMPLE)));
      if (!r.success) {
        unavailable.marks = `The per-row check could not run: ${r.message ?? "query failed"}`;
        return sampleOf(`SELECT * FROM ${self} AS _s LIMIT ${SAMPLE}`);
      }
      return {
        columns: side === "left" ? nl.columns : nr.columns,
        rows: r.rows.map((x) => x.slice(0, n)),
        marks: r.rows.map((x) => rowMark(node.op, node.all, side, Number(x[n]), Number(x[n + 1]))),
      };
    };
    const [left, right] = await Promise.all([markSide(L, R, "left"), markSide(R, L, "right")]);

    // Matched and removed rows come from real derived queries, never from the sample.
    const resultSample: SetSample = { columns: resultRun.columns, rows: resultRun.rows.slice(0, SAMPLE) };
    let matched: SetSample | undefined;
    let removed: SetSample | undefined;
    let matchedCount: number | undefined;
    let removedCount: number | undefined;
    const fromQuery = async (query: string, extra?: string): Promise<[SetSample | undefined, number | undefined]> => {
      const [r, c] = await Promise.all([sampleOf(`SELECT * FROM (${query}) AS _x LIMIT ${SAMPLE}`), countOf(countSql(`(${query})`))]);
      if (r.error) {
        unavailable.removed = r.error;
        return [undefined, c];
      }
      return [{ columns: extra ? [...nl.columns, extra] : nl.columns, rows: r.rows }, c];
    };
    if (node.op === "union") {
      if (interSample && !interSample.error) matched = { columns: nl.columns, rows: interSample.rows };
      else if (interSample?.error) unavailable.matched = interSample.error;
      matchedCount = interCount;
      if (node.all) {
        removed = { columns: nl.columns, rows: [] };
        removedCount = 0;
      } else {
        const g = await sampleOf(collapsedSql(L, R, n, SAMPLE));
        if (g.error) unavailable.removed = g.error;
        else removed = { columns: [...nl.columns, "copies_removed"], rows: g.rows };
        removedCount = lc !== undefined && rc !== undefined && resCount !== undefined ? lc + rc - resCount : undefined;
      }
    } else if (node.op === "intersect") {
      matched = resultSample;
      matchedCount = resCount;
      [removed, removedCount] = await fromQuery(onlyOneSideSql(L, R, n, node.all), "only_in");
    } else {
      // EXCEPT: the rows the right input has are exactly the left rows it removes, so they are shown once, as removed.
      if (interSample && !interSample.error) removed = { columns: nl.columns, rows: interSample.rows };
      else if (interSample?.error) unavailable.removed = interSample.error;
      removedCount = interCount;
      matchedCount = node.all ? undefined : interCount;
    }

    const data: SetOpData = {
      op: node.op, all: node.all, left, right, leftCount: lc, rightCount: rc, leftLabel: label(node.left), rightLabel: label(node.right),
      compat: { ok: true, notes: [] }, pairs, result: resultSample, resultCount: resCount,
      leftDistinct: ld, rightDistinct: rd, matched, removed, matchedCount, removedCount,
      matchedLabel: matchedLabel(node.op, node.all), removedLabel: removedLabel(node.op, node.all),
      rule: ruleText(node.op, node.all), unavailable,
    };
    if (lc === undefined || rc === undefined || resCount === undefined) data.unavailable = { ...unavailable, counts: "A row count could not be obtained." };
    data.compat.notes = [
      `${n} column(s) on both sides. Output names come from the left input: ${names.join(", ")}.`,
      ...pairs.filter((p) => !p.same && p.left && p.right).map((p) => `Column ${p.position} (${p.name}): ${p.left} and ${p.right} are combined as ${p.result ?? "a common type"}.`),
    ];
    data.arithmetic = arithmetic(data);
    const out = resCount;
    const numbers = lc !== undefined && rc !== undefined ? ` ${lc} left row(s) and ${rc} right row(s)` : "";
    const outcome =
      out === undefined ? "" :
      node.op === "union" && node.all ? ` Every row is kept: ${out} row(s).` :
      node.op === "union" ? ` ${removedCount ?? "Some"} duplicate row(s) were removed: ${out} row(s) remain.` :
      node.op === "intersect" ? ` ${out} ${node.all ? "row(s) are shared copies" : "distinct row(s) appear in both inputs"}.` :
      ` ${out} row(s) remain after the right input removed ${removedCount ?? "some"} ${node.all ? "left row(s)" : "distinct left row(s)"}.`;
    return { ...base, explanation: `${intro}${numbers ? ` They have${numbers}.` : ""}${outcome} ${ruleText(node.op, node.all)}`, sql: prefixed(comb), rowsIn: lc !== undefined && rc !== undefined ? lc + rc : undefined, rowsOut: out, sample: resultSample, removed: removed && removed.rows.length ? { columns: removed.columns, rows: removed.rows } : undefined, setOp: data };
  }

  /** ORDER BY / LIMIT that apply to `baseText` as a whole, after the set operation(s) inside it. */
  async function tailStages(baseText: string, tail: SetTail, scope: string) {
    if (!tail.text || failed) return;
    const orderOnly = `${baseText}\nORDER BY ${tail.orderBy}`;
    if (tail.orderBy) {
      const st: Stage = {
        clause: "order by", range: tail.ranges.orderBy,
        title: "ORDER BY: sort the whole result",
        explanation: `Rows are sorted by ${tail.orderBy}${scope}. It applies to the combined result, not to one input, and can only name output columns (by name or position) because the set operation has already produced them. Without ORDER BY, SQL guarantees no order, and UNION/INTERSECT/EXCEPT often return rows in the order of an internal hash or sort.`,
        sql: prefixed(orderOnly),
      };
      if (executing) {
        const s = await sampleOf(`SELECT * FROM (${orderOnly}) AS _o LIMIT ${SAMPLE}`);
        const c = await countOf(countSql(`(${orderOnly})`));
        st.sample = s.error ? undefined : s;
        st.rowsOut = c;
        st.rowsIn = stages[stages.length - 1]?.rowsOut;
        st.error = s.error;
        if (s.error) failed = true;
      }
      stages.push(st);
    }
    if (tail.limit || tail.offset || tail.fetch) {
      const full = `${baseText}\n${tail.text}`;
      const st: Stage = {
        clause: "limit", range: tail.ranges.limit ?? tail.ranges.offset,
        title: "LIMIT / OFFSET: keep a slice of the whole result",
        explanation: `${tail.offset ? `Skip ${tail.offset} row(s), then ` : ""}${tail.limit ? `keep at most ${tail.limit}` : tail.fetch ? `keep ${tail.fetch}` : "keep the rest"}${scope}. This is the last step and applies after the set operation${tail.orderBy ? " and the sort" : ", so without ORDER BY which rows survive is not defined"}.`,
        sql: prefixed(full),
      };
      if (executing) {
        const before = stages[stages.length - 1]?.rowsOut;
        const s = await sampleOf(`SELECT * FROM (${full}) AS _o LIMIT ${SAMPLE}`);
        const c = await countOf(countSql(`(${full})`));
        st.sample = s.error ? undefined : s;
        st.rowsIn = before;
        st.rowsOut = c;
        st.error = s.error;
        if (s.error) failed = true;
      }
      stages.push(st);
    }
  }

  async function emit(node: SetOpNode) {
    if (node.left.kind === "op") await emit(node.left);
    if (node.right.kind === "op") await emit(node.right);
    if (failed) return;
    stages.push(await opStage(node));
    if (node.tail.text && !failed) await tailStages(node.core, node.tail, " (inside parentheses)");
  }

  const root = q.root as SetOpNode;
  await emit(root);
  if (!failed) await tailStages(sql.slice(root.range[0], root.range[1]), q.tail, "");

  for (const s of stages) s.source = executing && (s.setOp || s.rowsOut !== undefined || s.sample) ? "executed" : "parsed";

  // The final result always comes from running exactly the user's query, once.
  const f = await realRun(sql.replace(/;\s*$/, ""));
  const final = f.success ? { columns: f.columns, rows: f.rows.slice(0, SAMPLE), rowCount: f.row_count ?? f.rows.length } : undefined;
  if (!f.success) stages.push({ clause: "select", title: "Your query has an error", explanation: f.message ?? "", error: f.message ?? "error", source: "executed" });
  else if (executing && !failed && stages.length) {
    // The last stage is the whole query: show the real result there, so the stage and the final result are one and the same.
    const last = stages[stages.length - 1];
    last.sample = { columns: final!.columns, rows: final!.rows };
    last.rowsOut = final!.rowCount;
    if (last.setOp) {
      last.setOp.result = { columns: final!.columns, rows: final!.rows };
      last.setOp.resultCount = final!.rowCount;
      last.setOp.arithmetic = arithmetic(last.setOp);
    }
  }
  return { parsed, stages, final, volatile: volatile.length ? volatile : undefined };
}
