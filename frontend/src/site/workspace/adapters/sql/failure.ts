/**
 * Why a SQL answer failed, in categories a learner can act on. Rules fire only on evidence that exists:
 *  - PostgreSQL's own error text (syntax, grouping, aggregate and window misuse, ambiguity, division by zero, a timeout);
 *  - the grader's own result comparison (`submit` and `diagnose` in lib/resultCompare.ts: row counts, extra or missing rows,
 *    duplicate rows, rounding, NULL against 0, column differences);
 *  - the learner's SQL text, but only together with a failing result or error, and worded as "possible" when it is a guess.
 * Wording says which kind of evidence a message rests on: "PostgreSQL reported", "The comparison shows", "Possible", "Found in your SQL".
 */
import type { FeedbackItem, RunStatus } from "../../types";
import type { SubmitResult } from "../../../../types";
import { explainError } from "../../../lib/errorHelp";
import { lint } from "../../../lib/compareSolutions";
import { maskSql } from "./sqlText";

export const CATEGORY = {
  syntax: "syntax",
  join: "join logic",
  filter: "filtering",
  aggregation: "aggregation",
  grouping: "grouping",
  window: "window logic",
  nulls: "NULL handling",
  performance: "performance",
  columns: "output columns",
  ordering: "ordering",
  hidden: "hidden test",
  safety: "read-only",
  other: "other",
} as const;

export interface SqlFacts { join: boolean; innerJoinOnly: boolean; outerJoin: boolean; where: boolean; groupBy: boolean; aggregate: boolean; window: boolean; distinct: boolean; limit: boolean; orderBy: boolean; crossProduct: boolean; literalFilter: boolean }

/** What the SQL text contains (not what it means). Used only to make a result-based hint specific. */
export function sqlFacts(sql: string): SqlFacts {
  const m = maskSql(sql).toLowerCase();
  const outerJoin = /\b(left|right|full)(\s+outer)?\s+join\b/.test(m);
  const join = /\bjoin\b/.test(m) || /\bfrom\s+[\w."]+(\s+(as\s+)?\w+)?\s*,\s*[\w."]/.test(m);
  return {
    join, outerJoin, innerJoinOnly: join && !outerJoin,
    where: /\bwhere\b/.test(m),
    groupBy: /\bgroup\s+by\b/.test(m),
    aggregate: /\b(count|sum|avg|min|max|string_agg|array_agg)\s*\(/.test(m),
    window: /\bover\s*[(\w]/.test(m),
    distinct: /\bdistinct\b/.test(m),
    limit: /\blimit\b/.test(m),
    orderBy: /\border\s+by\b/.test(m),
    crossProduct: /\bcross\s+join\b/.test(m) || (/\bfrom\s+[\w."]+(\s+(as\s+)?\w+)?\s*,\s*[\w."]/.test(m) && !/\bwhere\b/.test(m)),
    literalFilter: /\bwhere\b[^;]*?(=|<>|!=|<|>)\s*('[^']*'|\d)/.test(sql.replace(/--.*$/gm, "").toLowerCase()),
  };
}

const lineOf = (sql: string, position?: number | null) => (position && position > 0 ? sql.slice(0, position - 1).split("\n").length : undefined);

/** Classify a PostgreSQL error message. Always returns one item. */
export function classifyError(sql: string, message: string, opts: { status?: RunStatus; type?: string | null; line?: number } = {}): FeedbackItem {
  const f = sqlFacts(sql);
  const first = message.split("\n")[0];
  const help = explainError(message);
  const item = (category: string, text: string, suggestion?: string): FeedbackItem => ({ category, message: text, line: opts.line, suggestion: suggestion ?? help?.fix });
  if (opts.status === "timeout" || opts.type === "TIMEOUT") {
    return item(CATEGORY.performance, "The query ran longer than the time limit and was stopped.",
      f.crossProduct
        ? "Found in your SQL: a cross join, or tables listed with commas and no WHERE. Every row of one table is paired with every row of the other. Add the join condition."
        : "Check that every JOIN has an ON condition that links the tables, and filter early with WHERE.");
  }
  if (/read-only transaction|permission denied/i.test(message)) return item(CATEGORY.safety, "PostgreSQL refused this statement because the exercise is read-only.", "Write a SELECT. Changes are not allowed in a graded exercise.");
  if (/syntax error/i.test(message)) return item(CATEGORY.syntax, `PostgreSQL reported a syntax error: ${first}`);
  if (/must appear in the GROUP BY clause or be used in an aggregate function/i.test(message)) return item(CATEGORY.grouping, `PostgreSQL reported: ${first}`, help?.fix);
  if (/aggregate functions are not allowed in|aggregate function calls cannot be nested/i.test(message)) return item(CATEGORY.aggregation, `PostgreSQL reported: ${first}`, help?.fix);
  if (/window functions? (are not allowed|calls cannot be nested)/i.test(message)) return item(CATEGORY.window, `PostgreSQL reported: ${first}`, help?.fix);
  if (/is ambiguous|missing FROM-clause entry|invalid reference to FROM-clause|cannot be referenced from this part of the query/i.test(message) && f.join) return item(CATEGORY.join, `PostgreSQL reported: ${first}`, help?.fix ?? "Prefix each column with its table alias.");
  if (/division by zero/i.test(message)) return item(CATEGORY.nulls, `PostgreSQL reported: ${first}`, help?.fix);
  if (/each (union|intersect|except) query must have the same number of columns|UNION types .* cannot be matched/i.test(message)) return item(CATEGORY.columns, `PostgreSQL reported: ${first}`, help?.fix);
  if (/(column|relation|function|operator|type) .*does not exist|invalid input syntax for type|could not identify/i.test(message)) return item(CATEGORY.syntax, `PostgreSQL could not resolve a name or a type, before reading any rows: ${first}`, help?.fix);
  return item(CATEGORY.other, `PostgreSQL reported: ${first}`, help?.fix);
}

/** Feedback for a query that ran but did not match, from the grader's own result (`submit`) and the SQL text. */
export function classifyMismatch(sql: string, r: SubmitResult): FeedbackItem[] {
  const f = sqlFacts(sql);
  const out: FeedbackItem[] = [];
  const add = (category: string, message: string, suggestion?: string) => out.push({ category, message, suggestion });
  const said = (re: RegExp) => r.feedback.some((x) => re.test(x));
  const diff = r.diff ?? null;
  const missing = diff?.missingCount ?? 0;
  const extra = diff?.extraCount ?? 0;
  const yours = r.your_row_count ?? undefined;
  const expected = r.expected_row_count ?? undefined;

  if (r.hidden_failed) {
    add(CATEGORY.hidden, "Your query matches the sample data but not the hidden test data (rows the visible data does not have).");
    if (f.literalFilter) add(CATEGORY.filter, "Found in your SQL: a filter on a fixed value. A value copied from the sample data can be wrong for other data.", "Express the rule (a comparison to a subquery, a window, or a column) instead of the value you saw.");
    if (f.innerJoinOnly) add(CATEGORY.join, "Possible: an INNER JOIN drops rows with no match. The hidden data has a customer with no orders and a product with no stock.", "If those rows should appear, use LEFT JOIN and test for NULL.");
    if (f.limit) add(CATEGORY.ordering, "Possible: LIMIT picks an arbitrary row when there are ties. The hidden data has a tie for the latest date.", "Add a tie-breaker to ORDER BY, or use a window function that keeps ties.");
    return out;
  }
  if (said(/column names and column order|Same columns, different order|Rename column|Missing column|Unexpected column/i)) {
    add(CATEGORY.columns, "The comparison shows different output columns (names, number, or order).", r.feedback.find((x) => /Rename|Missing|Unexpected|Same columns|Expected columns/i.test(x)));
    return out;
  }
  if (said(/order is not|ordering may be required/i)) {
    add(CATEGORY.ordering, "The comparison shows the right rows in a different order.", r.feedback.find((x) => /Expected order/i.test(x)) ?? "Add or fix ORDER BY (and a tie-breaker).");
  }
  const dupLine = r.feedback.find((x) => /duplicate row\(s\) but otherwise the right rows/.test(x));
  if (dupLine) {
    if (f.join) add(CATEGORY.join, `The comparison shows duplicate rows and otherwise the right rows. Found in your SQL: a join. ${dupLine}`, "Check how many rows match on the join key. Aggregate first, or use DISTINCT or EXISTS.");
    else add(CATEGORY.grouping, `The comparison shows duplicate rows and otherwise the right rows. ${dupLine}`, "Add DISTINCT, or GROUP BY the columns that should be unique.");
  } else if (extra > 0 && missing === 0) {
    add(CATEGORY.filter, `The comparison shows every expected row plus ${extra} extra. ${f.where ? "Possible: a condition in WHERE is too loose." : "Found in your SQL: there is no WHERE."}`, "Tighten the filter so only the expected rows remain.");
  } else if (missing > 0 && extra === 0) {
    add(CATEGORY.filter, `The comparison shows ${missing} expected row(s) missing. ${f.where ? "Possible: a condition in WHERE is too strict." : ""}`.trim(), "Loosen the filter, or check the comparison operators.");
    if (f.innerJoinOnly) add(CATEGORY.join, "Possible: an INNER JOIN drops rows that have no match; the expected result may keep them.", "Try LEFT JOIN and filter on the right-hand key being NULL where you need the unmatched rows.");
  } else if (missing > 0 && extra > 0) {
    const rounding = r.feedback.find((x) => /differ only by rounding/.test(x));
    const nullZero = r.feedback.find((x) => /NULL vs 0/.test(x));
    if (nullZero) add(CATEGORY.nulls, `The comparison shows ${nullZero}`, "COALESCE(value, 0) turns a missing value into 0.");
    if (rounding) add(f.aggregate ? CATEGORY.aggregation : CATEGORY.other, `The comparison shows ${rounding}`, "Round at the same place as the reference: after aggregating, with ROUND(x::numeric, 2).");
    if (!nullZero && !rounding) {
      if (f.window) add(CATEGORY.window, `Possible: ${missing} expected row(s) are missing and ${extra} unexpected row(s) appear. Found in your SQL: a window function; check PARTITION BY, ORDER BY and the frame.`);
      else if (f.groupBy || f.aggregate) add(yours !== undefined && expected !== undefined && yours !== expected ? CATEGORY.grouping : CATEGORY.aggregation, `Possible: ${missing} expected row(s) are missing and ${extra} unexpected row(s) appear. Found in your SQL: ${f.groupBy ? "GROUP BY" : "an aggregate"}; check what is grouped and what is aggregated.`);
      else add(CATEGORY.filter, `The comparison shows ${missing} expected row(s) missing and ${extra} unexpected row(s).`, "Compare the sample rows below with your conditions.");
    }
  } else if (yours !== undefined && expected !== undefined && yours !== expected) {
    add(f.groupBy ? CATEGORY.grouping : CATEGORY.filter, `The comparison shows ${yours} row(s) where ${expected} are expected.`, "Check your filtering and grouping.");
  }
  if (out.length === 0) add(CATEGORY.other, r.message, r.feedback[0]);
  // SQL-text findings that are known NULL traps, only now that the answer is wrong.
  for (const n of lint(sql)) if (/NULL/.test(n.text) && !out.some((o) => o.category === CATEGORY.nulls)) add(CATEGORY.nulls, `Found in your SQL: ${n.text}`);
  return out;
}

/** Everything the adapter knows when a run or a graded run failed. */
export function explainSqlFailure(sql: string, status: RunStatus, error: { type?: string; message: string; line?: number } | undefined, submit: SubmitResult | null | undefined): FeedbackItem[] {
  if (error) return [classifyError(sql, error.message, { status, type: error.type, line: error.line })];
  if (submit && !submit.correct) return classifyMismatch(sql, submit);
  return [];
}

export { lineOf };
