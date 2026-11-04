import type { ExecuteResult } from "../../types";
import { buildQuery, parseSelect, type JoinPart, type ParsedQuery } from "./sqlClauses";

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

export interface Stage {
  clause: "from" | "where" | "group by" | "having" | "window" | "select" | "distinct" | "order by" | "limit";
  title: string;
  explanation: string;
  /** The derived query that produced this stage's data (shown to the user). */
  sql?: string;
  rowsIn?: number;
  rowsOut?: number;
  sample?: Sample;
  removed?: Sample;
  joins?: JoinStep[];
  partitions?: Sample;
  error?: string;
}

export interface Visualization {
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
export async function visualize(sql: string, run: Run): Promise<Visualization> {
  const p = parseSelect(sql);
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

  const f = await run(sql.replace(/;\s*$/, ""));
  const final = f.success ? { columns: f.columns, rows: f.rows.slice(0, SAMPLE), rowCount: f.row_count ?? f.rows.length } : undefined;
  if (!f.success) stages.push({ clause: "select", title: "Your query has an error", explanation: f.message ?? "", error: f.message ?? "error" });
  return { parsed: p, stages, final };
}
