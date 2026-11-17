import { describe, expect, it } from "vitest";
import { formatStandardSql } from "../utils/formatSql";

describe("Format SQL (query visualizer)", () => {
  it("puts each clause on its own line with upper-case keywords", () => {
    const out = formatStandardSql("select c.country, count(*) as orders from customers c join orders o on o.customer_id = c.customer_id where o.freight > 10 group by c.country having count(*) >= 3 order by orders desc limit 5");
    const lines = out.split("\n").map((l) => l.trim());
    for (const kw of ["SELECT", "FROM", "JOIN", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT"]) expect(lines.some((l) => l.startsWith(kw)), kw).toBe(true);
  });
  it("does not change what the query means: same tokens, same order", () => {
    const sql = "SELECT a, b FROM t WHERE a > 1 AND b IS NOT NULL ORDER BY a";
    const tokens = (s: string) => s.replace(/\s+/g, " ").toLowerCase().split(/[\s,]+/).filter(Boolean);
    expect(tokens(formatStandardSql(sql))).toEqual(tokens(sql));
  });
  it("leaves an empty editor alone", () => {
    expect(formatStandardSql("   ")).toBe("   ");
  });
});
