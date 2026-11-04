import { compareResults, rowDiff } from "./resultCompare";
import { complexity, detectApproaches } from "./sqlClauses";
import { parsePlan, type PlanNode } from "../components/PlanTree";
import type { Run } from "./visualize";

export interface SolutionReport {
  sql: string;
  ok: boolean;
  error?: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  approaches: string[];
  complexity: ReturnType<typeof complexity>;
  /** Median of repeated runs after one warm-up, in ms. */
  medianMs?: number;
  runsMs: number[];
  plan?: PlanNode | null;
  planCost?: number;
  notes: Note[];
}

export interface Note {
  level: "warn" | "info";
  text: string;
}

export interface Comparison {
  a: SolutionReport;
  b: SolutionReport;
  equivalent: boolean;
  message: string;
  diff?: { missing: unknown[][]; extra: unknown[][]; missingCount: number; extraCount: number };
  environment: { version: string; runs: number; tables: { name: string; rows: number; indexes: string[] }[] };
}

/** Deterministic, rule-based observations. They describe behaviour, they don't rank solutions. */
export function lint(sql: string): Note[] {
  const s = sql.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
  const notes: Note[] = [];
  if (/\bnot\s+in\s*\(\s*select\b/i.test(s))
    notes.push({ level: "warn", text: "NOT IN (subquery) returns no rows if the subquery yields any NULL. NOT EXISTS doesn't have this trap." });
  if (/\bleft\s+(outer\s+)?join\b/i.test(s) && /\bcount\s*\(\s*\*\s*\)/i.test(s))
    notes.push({ level: "warn", text: "COUNT(*) after a LEFT JOIN counts the NULL-padded row, so unmatched rows report 1, not 0. COUNT(right.key) counts matches only." });
  if (/=\s*null\b|<>\s*null\b|!=\s*null\b/i.test(s))
    notes.push({ level: "warn", text: "Comparing with = NULL / <> NULL is never true. Use IS NULL / IS NOT NULL." });
  if (/\blimit\b/i.test(s) && !/\border\s+by\b/i.test(s))
    notes.push({ level: "warn", text: "LIMIT without ORDER BY returns an arbitrary subset; the result can change between runs." });
  if (/\bselect\s+distinct\b/i.test(s) && /\bgroup\s+by\b/i.test(s))
    notes.push({ level: "info", text: "DISTINCT together with GROUP BY is usually redundant: grouped rows are already unique on the grouping columns." });
  if (/\bunion\b(?!\s+all)/i.test(s))
    notes.push({ level: "info", text: "UNION removes duplicates (an extra sort/hash step). Use UNION ALL when duplicates are impossible or wanted." });
  if (/\bfrom\s+[a-z_][\w.]*(\s+\w+)?\s*,\s*[a-z_]/i.test(s))
    notes.push({ level: "info", text: "Comma-separated FROM is an implicit cross join; the join condition lives in WHERE. Explicit JOIN … ON is easier to read and harder to get wrong." });
  if (/\bselect\s+\*/i.test(s))
    notes.push({ level: "info", text: "SELECT * returns every column, so the result shape changes if the table does. Listing columns is more robust." });
  if (/\bover\s*\(\s*\)/i.test(s))
    notes.push({ level: "info", text: "OVER () with no PARTITION BY computes over the whole result set." });
  if (/\b(where|on)\b[^;]*\b(lower|upper|date_trunc|extract|cast)\s*\(\s*[a-z_]+\.[a-z_]+/i.test(s))
    notes.push({ level: "info", text: "A function wrapped around a column in WHERE/ON stops a plain index on that column from being used. An expression index or rewriting the condition can help." });
  return notes;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined;
};

function tablesIn(sql: string): string[] {
  return [...new Set([...sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\b/gi)].map((m) => m[1].toLowerCase()))];
}

async function report(sql: string, run: Run, runs: number): Promise<SolutionReport> {
  const body = sql.trim().replace(/;\s*$/, "");
  const base = { sql: body, approaches: detectApproaches(body), complexity: complexity(body), notes: lint(body), runsMs: [] as number[] };
  const first = await run(body); // also the warm-up run
  if (!first.success) return { ...base, ok: false, error: first.message ?? "error", columns: [], rows: [], rowCount: 0 };
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await run(body);
    times.push(performance.now() - t);
  }
  const ex = await run(`EXPLAIN (FORMAT JSON) ${body}`);
  const plan = ex.success ? parsePlan(ex.rows[0]?.[0]) : null;
  return {
    ...base,
    ok: true,
    columns: first.columns,
    rows: first.rows,
    rowCount: first.row_count ?? first.rows.length,
    medianMs: median(times),
    runsMs: times.map((t) => Math.round(t * 10) / 10),
    plan,
    planCost: plan?.["Total Cost"],
  };
}

export async function compareSolutions(a: string, b: string, run: Run, opts: { ordered?: boolean; runs?: number } = {}): Promise<Comparison> {
  const runs = opts.runs ?? 5;
  // Interleave nothing: each query gets its own warm-up and the same number of timed runs.
  const ra = await report(a, run, runs);
  const rb = await report(b, run, runs);

  const v = await run("SELECT version()");
  const tables = [...new Set([...tablesIn(a), ...tablesIn(b)])];
  const env: Comparison["environment"] = { version: v.success ? String(v.rows[0]?.[0]).split(" on ")[0] : "unknown", runs, tables: [] };
  if (tables.length) {
    const list = tables.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
    const idx = await run(`SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1, 2`);
    for (const t of tables) {
      const c = await run(`SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}"`);
      if (!c.success) continue; // a CTE name, not a table
      env.tables.push({ name: t, rows: Number(c.rows[0]?.[0]), indexes: idx.success ? idx.rows.filter((r) => r[0] === t).map((r) => String(r[1])) : [] });
    }
  }

  if (!ra.ok || !rb.ok) {
    return { a: ra, b: rb, equivalent: false, message: "One of the queries has an error, so results can't be compared.", environment: env };
  }
  const cmp = compareResults(ra.columns, ra.rows, rb.columns, rb.rows, Boolean(opts.ordered));
  const diff = !cmp.match && ra.columns.length === rb.columns.length ? rowDiff(ra.rows, rb.rows) : undefined;
  return {
    a: ra,
    b: rb,
    equivalent: cmp.match,
    message: cmp.match
      ? `Both queries return the same ${ra.rowCount} row(s)${opts.ordered ? " in the same order" : " (order ignored)"} on this data. That is evidence, not proof: different data could still separate them.`
      : ra.columns.length !== rb.columns.length
        ? `The queries return different columns (${ra.columns.length} vs ${rb.columns.length}), so their rows can't be matched.`
        : `The results differ: A returns ${ra.rowCount} row(s), B returns ${rb.rowCount}${
            diff && !diff.missingCount && !diff.extraCount ? " — same rows, different order or column names" : ""
          }.`,
    diff,
    environment: env,
  };
}
