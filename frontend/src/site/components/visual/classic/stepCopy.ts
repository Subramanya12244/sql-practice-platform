/**
 * Plain-language fallbacks for the "Why did it happen?" and "What should I remember?" answers, used only when the teaching card
 * (lib/visual/classic/teach.ts) has not supplied its own. They describe how SQL works in general, never a number or a value:
 * every figure on screen comes from the real run.
 */
import type { TeachKind } from "../../../lib/visual/classic/contract";

const WHY: Record<TeachKind, string> = {
  from: "Every query starts by deciding which table (or tables) to read. Nothing can be filtered or calculated until its rows exist.",
  join: "A JOIN pairs each row with the rows of another table that satisfy its ON condition, so later clauses can use columns from both.",
  where: "WHERE keeps a row only when its condition is true. It runs before grouping, so it decides which rows can be counted or summed at all.",
  group: "GROUP BY puts rows that share the same value into one bucket, so one result row can stand for many input rows.",
  aggregate: "An aggregate function turns each bucket of rows into one value, such as a count, a sum or an average.",
  having: "HAVING filters whole groups after they are built. WHERE cannot do that, because it runs before the groups exist.",
  select: "SELECT picks and calculates the columns you asked for from the rows that survived the earlier clauses.",
  distinct: "DISTINCT keeps the first row of each set of identical rows and drops the repeats.",
  window: "A window function calculates a value across related rows without collapsing them into one row.",
  order: "ORDER BY sorts the rows. Until it runs, a query makes no promise about row order.",
  limit: "LIMIT stops after the first rows in the current order, so what it keeps depends on the ORDER BY before it.",
  setop: "A set operation combines the rows of two queries that return the same columns.",
  subquery: "A subquery is a query inside another query. It runs first so its answer can be used by the outer query.",
  cte: "A CTE gives a query a name so the rest of the statement can read its rows like a table.",
};

const REMEMBER: Record<TeachKind, string> = {
  from: "Start here: the row count at FROM is the most rows any later step can have, unless a join multiplies them.",
  join: "Check the row count after a join. More rows than before means some rows matched more than once.",
  where: "WHERE works on single rows and cannot use an aggregate such as COUNT or SUM.",
  group: "After GROUP BY, each result row is a group, not a single original row.",
  aggregate: "Aggregates ignore NULL values, except COUNT(*), which counts every row.",
  having: "Use WHERE to filter rows and HAVING to filter groups.",
  select: "The names you give with AS exist only from this step on, so WHERE and GROUP BY cannot use them.",
  distinct: "DISTINCT compares whole rows, not single columns.",
  window: "A window function keeps every row. GROUP BY would collapse them.",
  order: "Without ORDER BY the row order is not guaranteed. NULLs sort last in ascending order in PostgreSQL.",
  limit: "LIMIT without ORDER BY returns an arbitrary few rows.",
  setop: "UNION removes duplicates, UNION ALL keeps them, INTERSECT keeps shared rows, EXCEPT keeps rows missing from the right side.",
  subquery: "A subquery that returns more than one row cannot be compared with a plain = or >.",
  cte: "A CTE is a name for a query. It is not stored as a table.",
};

export const whyFallback = (k: TeachKind) => WHY[k];
export const rememberFallback = (k: TeachKind) => REMEMBER[k];
