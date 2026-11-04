/** Plain-language help for the PostgreSQL errors learners hit most. */
export interface ErrorHelp {
  title: string;
  fix: string;
  guide?: { slug: string; label: string };
}

const RULES: { test: RegExp; help: (m: RegExpMatchArray) => ErrorHelp }[] = [
  {
    test: /column "([^"]+)" must appear in the GROUP BY clause or be used in an aggregate function/i,
    help: (m) => ({
      title: "Column not grouped",
      fix: `\`${m[1]}\` is selected but not grouped. Add it to GROUP BY, or wrap it in an aggregate such as MAX(${m[1].split(".").pop()}).`,
      guide: { slug: "group-by-having", label: "GROUP BY and HAVING" },
    }),
  },
  {
    test: /aggregate functions are not allowed in WHERE/i,
    help: () => ({
      title: "Aggregate in WHERE",
      fix: "WHERE runs before grouping, so it can't see SUM/COUNT/AVG. Move that condition to HAVING, or compute the aggregate in a CTE first.",
      guide: { slug: "group-by-having", label: "GROUP BY and HAVING" },
    }),
  },
  {
    test: /window functions are not allowed in (WHERE|HAVING)/i,
    help: () => ({
      title: "Window function in a filter",
      fix: "Window functions run after WHERE and HAVING. Compute it in a CTE or subquery, then filter the outer query (e.g. WHERE rn <= 3).",
      guide: { slug: "top-n-per-group", label: "Top N per group" },
    }),
  },
  {
    test: /column reference "([^"]+)" is ambiguous/i,
    help: (m) => ({
      title: "Ambiguous column",
      fix: `More than one joined table has \`${m[1]}\`. Prefix it with the table alias, e.g. o.${m[1]}.`,
      guide: { slug: "inner-join", label: "INNER JOIN" },
    }),
  },
  {
    test: /missing FROM-clause entry for table "([^"]+)"/i,
    help: (m) => ({
      title: "Unknown table alias",
      fix: `\`${m[1]}\` is used as a table or alias but never appears in FROM/JOIN. Check the alias spelling, or join that table.`,
    }),
  },
  {
    test: /column "([^"]+)" does not exist/i,
    help: (m) => ({
      title: "Unknown column",
      fix: /^[A-Z]/.test(m[1]) || m[1].includes(" ")
        ? `\`${m[1]}\` doesn't exist. Strings need single quotes ('${m[1]}'); double quotes mean an identifier.`
        : `\`${m[1]}\` isn't a column here. Check the schema panel, or whether a SELECT alias is used where it isn't visible yet (WHERE/GROUP BY can't see SELECT aliases).`,
    }),
  },
  {
    test: /relation "([^"]+)" does not exist/i,
    help: (m) => ({ title: "Unknown table", fix: `There is no table \`${m[1]}\`. Open the schema panel for the exact table names.` }),
  },
  {
    test: /division by zero/i,
    help: () => ({ title: "Division by zero", fix: "Guard the divisor with NULLIF(divisor, 0) so empty groups give NULL instead of an error.", guide: { slug: "null-handling-coalesce", label: "NULL handling" } }),
  },
  {
    test: /operator does not exist: (\w[\w ]*) [=<>!~]+ (\w[\w ]*)/i,
    help: (m) => ({ title: "Type mismatch", fix: `You're comparing ${m[1]} with ${m[2]}. Cast one side (e.g. value::numeric or '2024-01-01'::date).` }),
  },
  {
    test: /function round\(double precision, integer\) does not exist/i,
    help: () => ({ title: "ROUND on a float", fix: "PostgreSQL's ROUND(x, n) needs numeric. Write ROUND(expression::numeric, 2)." }),
  },
  {
    test: /each (UNION|INTERSECT|EXCEPT) query must have the same number of columns/i,
    help: (m) => ({ title: `${m[1]} column count`, fix: "Every SELECT in a set operation must return the same number of columns, in compatible types.", guide: { slug: "union-vs-union-all", label: "UNION vs UNION ALL" } }),
  },
  {
    test: /more than one row returned by a subquery used as an expression/i,
    help: () => ({ title: "Subquery returned many rows", fix: "A scalar subquery must return one row. Use IN (...), EXISTS, an aggregate, or LIMIT 1 with ORDER BY.", guide: { slug: "correlated-subquery", label: "Correlated subqueries" } }),
  },
  {
    test: /syntax error at or near "([^"]*)"/i,
    help: (m) => ({ title: "Syntax error", fix: `Look just before \`${m[1]}\`: a missing comma, an extra comma before FROM, or a clause in the wrong order (SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT).` }),
  },
];

export function explainError(message: string | null | undefined): ErrorHelp | null {
  if (!message) return null;
  for (const r of RULES) {
    const m = message.match(r.test);
    if (m) return r.help(m);
  }
  return null;
}
