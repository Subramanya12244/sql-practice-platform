/**
 * Post-submit review of a SQL solution. Correctness is never decided here: it comes from the
 * grader (the query was run and its rows compared). This module only adds commentary, and labels
 * every finding by how it was obtained:
 *  - verified:  measured or checked by running the queries (row equality, timings, plan cost)
 *  - heuristic: a rule applied to the SQL text (readability, NULL traps, structure). Rules can be wrong
 *  - info:      explanation of a concept or a trade-off, not a claim about this query
 * A query that differs from the reference is never marked wrong for being different, and no
 * approach is called faster without a measurement on this dataset.
 */
import { compareSolutions, lint, type Comparison } from "./compareSolutions";
import { complexity, detectApproaches } from "./sqlClauses";
import type { Run } from "./visualize";

export type Basis = "verified" | "heuristic" | "info";
export type Area = "correctness" | "readability" | "structure" | "aggregation" | "joins" | "nulls" | "performance" | "alternatives";

export interface Finding { id: string; area: Area; basis: Basis; title: string; text: string }

export interface SqlReview {
  findings: Finding[];
  /** Approaches detected in the learner's query (CTE, JOIN, Correlated subquery ...). */
  concepts: string[];
  alternative?: { approaches: string[]; sql: string; sameRows: boolean | null; tradeoff: string };
  notAssessed: string[];
  /** One line about where the measurements were taken. */
  measuredOn?: string;
}

const SMALL = 10_000;
const NOT_ASSESSED = [
  "How these queries behave on much larger tables than the practice data.",
  "Whether an index would help: that depends on the data and the other queries on the table.",
  "Team style preferences such as keyword case or alias naming.",
];

/** A neutral, conditional explanation of how two approaches differ. Never says one is faster. */
export function tradeoff(mine: string[], other: string[]): string {
  const has = (a: string[], x: string) => a.includes(x);
  const base = "Speed depends on the data size, the indexes and the planner. Use the measured times above, or the Solution comparison tool, to check on this data.";
  if (has(mine, "Correlated subquery") && !has(other, "Correlated subquery"))
    return `A correlated subquery is, in concept, evaluated against each outer row. PostgreSQL can often rewrite simple ones into a join, though not in every case. The alternative states the same idea set-wise with ${other.join(" + ") || "a different structure"}, which is usually easier to extend. ${base}`;
  if (has(other, "Correlated subquery") && !has(mine, "Correlated subquery"))
    return `The alternative uses a correlated subquery, which reads closely to the business rule ("for each row, look up..."), while yours expresses it as ${mine.join(" + ")}. ${base}`;
  if (has(mine, "JOIN") && (has(other, "EXISTS") || has(other, "NOT EXISTS")))
    return `EXISTS stops at the first match and cannot multiply rows; a JOIN can repeat rows when the other side has several matches, so it may need DISTINCT or GROUP BY. ${base}`;
  if ((has(mine, "EXISTS") || has(mine, "NOT EXISTS")) && has(other, "JOIN"))
    return `A JOIN returns columns from both sides and can repeat rows when there are several matches; EXISTS only tests for presence. ${base}`;
  if (has(other, "CTE") && !has(mine, "CTE"))
    return `A CTE gives each step a name, which helps when a query has several stages. In PostgreSQL it is usually planned like an inline subquery. ${base}`;
  if (has(mine, "CTE") && !has(other, "CTE"))
    return `Your CTE names the steps, which reads well. The alternative inlines them. ${base}`;
  if (has(other, "Window function") && !has(mine, "Window function"))
    return `A window function keeps every row and adds the calculation beside it; GROUP BY collapses rows. Which fits depends on whether you need the detail rows. ${base}`;
  if (has(mine, "Window function") && !has(other, "Window function"))
    return `Your window function keeps the detail rows next to the calculation; the alternative collapses or joins instead. ${base}`;
  return `Both are valid ways to get the same rows. ${base}`;
}

const areaOf = (text: string): Area =>
  /NULL/i.test(text) ? "nulls" : /JOIN|COUNT\(\*\)/i.test(text) ? "joins" : /GROUP BY|DISTINCT|aggregate/i.test(text) ? "aggregation" : /LIMIT|ORDER BY|UNION|SELECT \*|OVER \(\)/i.test(text) ? "structure" : /index|function wrapped/i.test(text) ? "performance" : "readability";

export interface ReviewInput {
  sql: string;
  referenceSql: string;
  sortRequired: boolean;
  /** The grader's verdict. The review never changes it. */
  graderCorrect: boolean;
  /** Learner (a) against reference (b), when the comparison could run. */
  comparison?: Comparison | null;
}

export function reviewSql({ sql, referenceSql, sortRequired, graderCorrect, comparison }: ReviewInput): SqlReview {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const concepts = detectApproaches(sql);
  const code = sql.replace(/--.*$/gm, "");

  add(graderCorrect
    ? { id: "correct", area: "correctness", basis: "verified", title: "Correct result", text: "Your query was run and returns the expected rows. A different structure from the reference is fine: only the result is graded." }
    : { id: "not-yet", area: "correctness", basis: "verified", title: "Not matching yet", text: "Your query ran but its rows do not match the expected result, so the notes below are about its structure only." });

  // Heuristic rules from the shared lint, filed by area.
  for (const n of lint(sql)) add({ id: `lint:${n.text.slice(0, 24)}`, area: areaOf(n.text), basis: "heuristic", title: n.level === "warn" ? "Worth checking" : "Style note", text: n.text });

  // Order.
  const hasOrder = /\border\s+by\b/i.test(code);
  if (sortRequired && !hasOrder && !findings.some((f) => /LIMIT without ORDER BY/.test(f.text))) add({ id: "order-missing", area: "structure", basis: "heuristic", title: "Row order", text: "This question expects a specific order, but the query has no ORDER BY, so the order is not guaranteed." });
  if (!sortRequired && hasOrder) add({ id: "order-extra", area: "structure", basis: "info", title: "Row order", text: "The question does not require an order. ORDER BY is harmless here, but it adds a sort step you could leave out." });

  // Readability from structure.
  const c = complexity(sql);
  if (c.nesting >= 4 || c.subqueries >= 3) add({ id: "nested", area: "readability", basis: "heuristic", title: "Deep nesting", text: `The query nests ${c.nesting} levels deep with ${c.subqueries} subqueries. Naming the steps with CTEs often makes this easier to read and to debug.` });
  if (c.lines === 1 && code.trim().length > 140) add({ id: "oneline", area: "readability", basis: "heuristic", title: "Long single line", text: "The whole query is on one line. Putting each clause on its own line makes it easier to read and review." });
  if (c.joins >= 1 && (code.match(/\b(?:from|join)\s+[a-z_][\w.]*\s+(?:as\s+)?[a-z]\b/gi) ?? []).length >= 3) add({ id: "alias", area: "readability", basis: "heuristic", title: "Short aliases", text: "Several tables use one-letter aliases. They are fine for two tables; with more, short meaningful names (for example ord, cust) are easier to follow." });

  // Measurements.
  let measuredOn: string | undefined;
  let alternative: SqlReview["alternative"];
  if (comparison && comparison.a.ok && comparison.b.ok) {
    const rows = Math.max(0, ...comparison.environment.tables.map((t) => t.rows));
    const largest = comparison.environment.tables.length ? `the largest table has ${rows.toLocaleString()} rows` : "table sizes unavailable";
    measuredOn = `${comparison.environment.version}, ${comparison.environment.runs} timed runs after a warm-up, ${largest}.`;
    const ta = comparison.a.medianMs, tb = comparison.b.medianMs;
    if (ta != null && tb != null) {
      const same = Math.abs(ta - tb) < Math.max(1, Math.min(ta, tb) * 0.25);
      add({ id: "timing", area: "performance", basis: "verified", title: "Measured time", text: same
        ? `Yours and the reference ran in about the same time on this data (${ta.toFixed(1)} ms and ${tb.toFixed(1)} ms, median).`
        : `Yours took ${ta.toFixed(1)} ms and the reference ${tb.toFixed(1)} ms (median). That is a measurement on this practice data on this device, not a claim about other data.` });
    }
    if (comparison.a.planCost != null && comparison.b.planCost != null) add({ id: "plan", area: "performance", basis: "verified", title: "Planner estimate", text: `PostgreSQL estimated a cost of ${comparison.a.planCost.toFixed(1)} for yours and ${comparison.b.planCost.toFixed(1)} for the reference (EXPLAIN). Costs are estimates in arbitrary units.` });
    if (rows < SMALL && rows > 0) add({ id: "small-data", area: "performance", basis: "info", title: "Small data", text: `On tables this small (up to ${rows.toLocaleString()} rows) almost any correct query is fast. Differences between approaches matter on larger tables.` });

    const refApproaches = detectApproaches(referenceSql);
    const same = refApproaches.join("|") === concepts.join("|");
    if (!same && referenceSql.trim()) alternative = { approaches: refApproaches, sql: referenceSql, sameRows: comparison.equivalent, tradeoff: tradeoff(concepts, refApproaches) };
    else add({ id: "same-approach", area: "alternatives", basis: "info", title: "Same approach", text: "Your approach matches the reference solution's, so there is no structurally different alternative to compare." });
  } else if (comparison === null || comparison === undefined) {
    // Comparison not run (for example the reference could not be executed): say so rather than guess.
    add({ id: "no-measure", area: "performance", basis: "info", title: "Not measured", text: "No timings were taken, so nothing is claimed about speed." });
  } else {
    add({ id: "compare-failed", area: "performance", basis: "info", title: "Comparison unavailable", text: "One of the queries could not be run for the comparison, so nothing is claimed about speed." });
  }

  const order: Basis[] = ["verified", "heuristic", "info"];
  findings.sort((a, b) => order.indexOf(a.basis) - order.indexOf(b.basis));
  return { findings, concepts, alternative, notAssessed: NOT_ASSESSED, measuredOn };
}

/** Run the comparison (a few timed executions, all rolled back) and build the review. Never throws. */
export async function runReview(input: Omit<ReviewInput, "comparison">, run: Run): Promise<SqlReview> {
  let comparison: Comparison | null = null;
  try {
    if (input.referenceSql.trim()) comparison = await compareSolutions(input.sql, input.referenceSql, run, { ordered: input.sortRequired });
  } catch {
    comparison = null;
  }
  return reviewSql({ ...input, comparison });
}
