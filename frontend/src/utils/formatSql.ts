import { format } from "sql-formatter";

/**
 * Formats SQL in a standard “river” style:
 *
 * SELECT c.city,
 *        c.country
 * FROM customers c
 *
 * UNION
 *
 * SELECT …
 */
export function formatStandardSql(sql: string): string {
  const input = sql.trim();
  if (!input) return sql;

  const formatted = format(input, {
    language: "postgresql",
    keywordCase: "upper",
    indentStyle: "tabularLeft",
    tabWidth: 2,
    expressionWidth: 80,
    linesBetweenQueries: 1,
    denseOperators: false,
    logicalOperatorNewline: "before",
  });

  const lines = formatted.split("\n").map((l) => l.replace(/\s+$/g, ""));
  let continuationIndent = 7;
  const river: string[] = [];

  for (const line of lines) {
    // TabularLeft pads clause keywords with spaces: "SELECT    col" / "FROM      t"
    const clause = line.match(/^([A-Z][A-Z0-9_]*(?:\s+[A-Z]+)?)\s{2,}(.*)$/);
    if (clause) {
      const [, keyword, rest] = clause;
      continuationIndent = keyword.length + 1;
      river.push(rest ? `${keyword} ${rest}` : keyword);
      continue;
    }

    if (/^\s{2,}\S/.test(line)) {
      river.push(`${" ".repeat(continuationIndent)}${line.trimStart()}`);
      continue;
    }

    river.push(line);
  }

  const withSetOpGaps: string[] = [];
  for (const line of river) {
    if (/^(UNION(?:\s+ALL)?|INTERSECT(?:\s+ALL)?|EXCEPT(?:\s+ALL)?)$/i.test(line)) {
      if (withSetOpGaps.length && withSetOpGaps[withSetOpGaps.length - 1] !== "") {
        withSetOpGaps.push("");
      }
      withSetOpGaps.push(line);
      withSetOpGaps.push("");
    } else {
      withSetOpGaps.push(line);
    }
  }

  let out = withSetOpGaps.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  if (/;\s*$/.test(input) && !/;\s*$/.test(out)) {
    out += ";";
  }
  return out;
}
